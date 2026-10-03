import { EdClient } from "../../vendor/ed/client.js";
import { MoodleClientCore } from "../../vendor/moodle/client.js";
import { OnTrackClient, HttpClient } from "../../vendor/ontrack/client.js";
import type { Config, Env } from "../config.ts";
import type { Platform, Unit } from "../domain/units.ts";
import { stateCall } from "../auth/client.ts";
import type { Connection } from "../auth/state.ts";
import { SuiteError } from "../errors.ts";
import { platformFetch } from "./network.ts";
import {
  brokerCall,
  moodleSessionSchema,
  ontrackSessionSchema,
} from "./broker.ts";
import { object, rows, type Backend } from "../adapters/backend.ts";
export class DirectBackend implements Backend {
  private client?: Promise<any>;
  private edInstitution = new Map<number, boolean>();
  private moodleSessionExpired?: SuiteError;
  constructor(
    private readonly env: Env,
    readonly account: string,
    readonly platform: Platform,
    private readonly config: Config,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}
  private async connect() {
    const site = this.config.platforms[this.platform]?.site_url;
    if (!site)
      throw new SuiteError(
        "PLATFORM_NOT_CONFIGURED",
        `This deployment has no ${this.platform} site.`,
        409,
      );
    if (this.platform === "ed") {
      const c = await stateCall<Connection>(
        this.env,
        this.account,
        "/connection/get",
      );
      const client = new EdClient({
        token: c.token,
        apiBaseUrl: "https://edstem.org/api/",
        fetch: async (input: any, init: any) => {
          const response = await platformFetch(
            "https://edstem.org",
            this.fetchImpl,
          )(input, init);
          if (new URL(String(input)).pathname === "/api/user" && response.ok) {
            const data = (await response.clone().json()) as any;
            for (const entry of data.courses ?? []) {
              const row = entry.course ?? entry;
              const institution = row.university ?? row.institution;
              const institutionId = Number(
                row.university_id ?? row.institution_id ?? institution?.id,
              );
              const allowed = this.config.platforms.ed?.institution_ids;
              this.edInstitution.set(
                Number(row.id),
                !allowed?.length || allowed.includes(institutionId),
              );
            }
          }
          return response;
        },
        maxRetries: 1,
      });
      const user = object(object(await client.fetchUser()).user);
      if (String(user.id) !== c.profile_id)
        throw new SuiteError(
          "ACCOUNT_CHANGED",
          "Reconnect Ed to confirm this account.",
          409,
        );
      return client;
    }
    if (this.platform === "moodle") {
      const c = moodleSessionSchema.parse(
        await brokerCall(this.env, this.account, "/v1/session", {
          platform: "moodle",
        }),
      );
      const client = new MoodleClientCore(site, {
        cookie: { name: c.cookie_name, value: c.cookie_value },
        sesskey: c.sesskey,
        userid: c.userid,
        fetchImpl: this.moodleFetch(site),
        onLoginRequired: async () => {
          const refreshed = moodleSessionSchema.parse(
            await brokerCall(this.env, this.account, "/v1/renew", {
              platform: "moodle",
            }),
          );
          if (refreshed.profile_id !== c.profile_id)
            throw new SuiteError(
              "ACCOUNT_CHANGED",
              "Reconnect the platform to confirm this account.",
              409,
            );
          return {
            cookie: {
              name: refreshed.cookie_name,
              value: refreshed.cookie_value,
            },
            pageContext: {
              sesskey: refreshed.sesskey,
              user_info: await new MoodleClientCore(site, {
                cookie: {
                  name: refreshed.cookie_name,
                  value: refreshed.cookie_value,
                },
                fetchImpl: this.moodleFetch(site),
              }).getSiteInfo(),
            },
          };
        },
      });
      const user = await client.getSiteInfo();
      if (String(user.userid) !== c.profile_id)
        throw new SuiteError(
          "ACCOUNT_CHANGED",
          "Reconnect Moodle to confirm this account.",
          409,
        );
      return client;
    }
    const c = ontrackSessionSchema.parse(
      await brokerCall(this.env, this.account, "/v1/session", {
        platform: "ontrack",
      }),
    );
    return new OnTrackClient(
      new HttpClient({
        baseUrl: site,
        credentials: { username: c.username, accessToken: c.token },
        fetch: platformFetch(site, this.fetchImpl),
        refresh: async () => {
          const v = ontrackSessionSchema.parse(
            await brokerCall(this.env, this.account, "/v1/renew", {
              platform: "ontrack",
            }),
          );
          if (v.profile_id !== c.profile_id)
            throw new SuiteError(
              "ACCOUNT_CHANGED",
              "Reconnect OnTrack to confirm this account.",
              409,
            );
          return { username: v.username, accessToken: v.token };
        },
      }),
    );
  }
  async api(): Promise<any> {
    return (this.client ??= this.connect());
  }
  private moodleFetch(site: string): typeof fetch {
    const network = platformFetch(site, this.fetchImpl, true);
    return async (input, init) => {
      try {
        return await network(input, init);
      } catch (error) {
        // Moodle's upstream transport wraps fetch errors. Preserve the session signal separately.
        if (
          error instanceof SuiteError &&
          error.code === "PLATFORM_SESSION_EXPIRED"
        )
          this.moodleSessionExpired = error;
        throw error;
      }
    };
  }
  async call(name: string, a: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.execute(name, a);
    } catch (error) {
      if (this.platform === "moodle" && this.moodleSessionExpired) {
        this.moodleSessionExpired = undefined;
        await brokerCall(this.env, this.account, "/v1/renew", {
          platform: "moodle",
        });
        this.client = undefined;
        return this.execute(name, a);
      }
      throw error;
    }
  }
  private async execute(
    name: string,
    a: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      const c = await this.api();
      if (this.platform === "ed") {
        switch (name) {
          case "list_courses":
            return (await c.fetchUser()).courses.map((course: any) => ({
              ...course,
              scope_verified: this.edInstitution.get(course.id) === true,
            }));
          case "list_lessons":
            await this.enrolled(Number(a.courseId));
            return await c.fetchLessons(a.courseId);
          case "get_lesson": {
            const lesson = await c.fetchLesson(a.lessonId, { view: false });
            await this.enrolled(lesson.courseId);
            return lesson;
          }
          case "list_threads":
            await this.enrolled(Number(a.courseId));
            return {
              threads: await c.fetchThreads(a.courseId, {
                limit: 100,
                offset: 0,
                sort: "new",
              }),
            };
          case "get_thread": {
            const thread = await c.fetchThread(a.threadId);
            await this.enrolled(thread.courseId);
            return thread;
          }
        }
      } else if (this.platform === "moodle") {
        if (name === "get_user") return { user: await c.getSiteInfo() };
        if (name === "list_courses") return await c.getCourses();
        if (name === "thread") {
          const t = await c.getForumDiscussion(a.discussion_id);
          await this.enrolled(t.course_id);
          return {
            thread: {
              ...t,
              unit_id: t.course_id,
              name: t.subject,
              posts_total: t.posts.length,
              posts: t.posts.map((p: any) => ({
                ...p,
                message_text: p.message_text ?? p.message,
                time_created: p.time_created,
              })),
            },
          };
        }
        const course = Number(a.unit ?? a.courseId);
        await this.enrolled(course);
        if (name === "unit") {
          const contents = await c.getCourseContents(course);
          const enrolled = rows(await c.getCourses(), "courses").find(
            (v) => v.id === course,
          );
          return {
            unit: enrolled,
            sections:
              a.section === undefined
                ? contents
                : contents.filter((s: any) => s.section === a.section),
          };
        }
        if (name === "due")
          return {
            due: (await c.getTodo(100, Number(a.days), course)).map(
              (v: any) => ({ ...v, unit_id: v.course_id }),
            ),
          };
        if (name === "grades") {
          const v = await c.getCourseGrades(course);
          return { ...v, grades: [{ ...v, unit_id: v.course_id }] };
        }
        if (name === "search_forums")
          return {
            results: (
              await c.searchForumContent({
                query: a.query,
                courseId: course,
                includePostText: true,
                limit: 30,
                maxForums: 10,
                maxDiscussionsPerForum: 20,
                sortBy: "recent",
              })
            ).map((v: any) => ({
              ...v,
              unit_id: v.course_id,
              name: v.discussion_subject,
            })),
          };
      } else {
        if (name === "list_courses") return await c.getProjects(false);
        if (name === "get_unit") {
          const bound = this.config.units.find(
            (u) => u.ontrack_unit_id === a.unit_id,
          );
          if (!bound)
            throw new SuiteError(
              "UNIT_NOT_ALLOWED",
              "Bind this OnTrack unit first.",
              403,
            );
          await this.enrolled(bound.ontrack_project_id!);
          const project = object(await c.getProject(bound.ontrack_project_id));
          if (object(project.unit).id !== bound.ontrack_unit_id)
            throw new SuiteError(
              "COURSE_MISMATCH",
              "OnTrack project has changed.",
              403,
            );
          return { unit: await c.getUnit(a.unit_id) };
        }
        const project = Number(a.project_id);
        await this.enrolled(project);
        const p = object(await c.getProject(project));
        if (name === "list_tasks") {
          const tasks = rows(p, "tasks");
          if (tasks.length) return { project_id: project, tasks };
          const u = object(await c.getUnit(object(p.unit).id));
          return {
            project_id: project,
            tasks: rows(u, "task_definitions").map((t) => ({
              ...t,
              task_definition_id: t.id,
            })),
          };
        }
        if (name === "get_task") {
          const u = object(await c.getUnit(object(p.unit).id));
          const task = rows(u, "task_definitions").find(
            (t) => t.id === a.task_definition_id,
          );
          if (!task)
            throw new SuiteError(
              "ENTITY_NOT_ALLOWED",
              "Task is outside this project.",
              403,
            );
          return {
            project_id: project,
            unit_id: object(p.unit).id,
            task,
            progress:
              rows(p, "tasks").find(
                (t) => t.task_definition_id === a.task_definition_id,
              ) ?? null,
          };
        }
      }
      throw new SuiteError(
        "TOOL_NOT_ALLOWED",
        "Only approved platform reads are available.",
        403,
      );
    } catch (error) {
      if (error instanceof SuiteError) throw error;
      throw new SuiteError(
        "PLATFORM_UNAVAILABLE",
        `The ${this.platform} read failed. Check its connection.`,
        502,
      );
    }
  }
  private async enrolled(id: number) {
    const c = await this.api();
    let enrolled: any[];
    if (this.platform === "ed") enrolled = (await c.fetchUser()).courses;
    else if (this.platform === "moodle") enrolled = await c.getCourses();
    else enrolled = await c.getProjects(false);
    if (
      !enrolled.some((v) => v.id === id) ||
      (this.platform === "ed" && this.edInstitution.get(id) !== true)
    )
      throw new SuiteError(
        "COURSE_NOT_ACCESSIBLE",
        "This course is no longer enrolled for the connected account.",
        403,
      );
  }
  async close() {}
}
