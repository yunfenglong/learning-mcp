import type {
  FileEntry,
  Activity,
  TodoItem,
  Course,
  Section,
  UserInfo,
  AlertSummary,
  CourseGrades,
  GradeItem,
  ForumSearchHit,
  ForumDiscussionRef,
  ForumPost,
} from "../../../vendor/moodle/types/src/models.js";
import type { MoodleClientCore } from "../../../vendor/moodle/client.js";
import type { MoodleReadArgs, MoodleOperation } from "./contracts.ts";
import {
  resolveSection,
  withChildSections,
  searchSections,
  hasGrade,
  pageGradeReports,
  parseSavedDocumentHtml,
  searchForumContent,
} from "../../../vendor/moodle/client.js";
import { digest } from "../../auth/crypto.ts";
import {
  syncPath,
  syncAction,
  localHash,
  type SyncEntry,
} from "./moodle-sync.ts";
import { SuiteError } from "../../errors.ts";
import { publicError } from "../../errors.ts";
import { platformReadError } from "./error.ts";
import {
  base64,
  learningFile,
  responseBytes,
  MAX_FILE_BYTES,
  type LearningFile,
} from "./files.ts";
import {
  requireOwner,
  page,
  required,
  unhandledRead,
  type ReadContext,
} from "./shared.ts";

const supportedFiles = new Set([
  "resource",
  "folder",
  "assign",
  "page",
  "book",
]);
export async function moodleRead(
  name: MoodleOperation,
  a: MoodleReadArgs,
  ctx: ReadContext<MoodleClientCore>,
): Promise<unknown> {
  const c = ctx.client;
  const read =
    ctx.read ?? (async <T>(operation: () => Promise<T>) => operation());
  const failure = (error: unknown) =>
    publicError(platformReadError("moodle", error));
  if (name === "get_user") return { user: await c.getSiteInfo() };
  const allCourses = await c.getCourses();
  if (name === "courses") {
    const p = page(
      allCourses.filter(
        (v) =>
          !a.query ||
          `${v.shortname} ${v.fullname}`
            .toLowerCase()
            .includes(a.query.toLowerCase()),
      ),
      a,
      200,
    );
    return {
      courses: p.results,
      total: p.total,
      offset: p.offset,
      has_more: p.has_more,
    };
  }
  if (name === "alerts") return c.getAlerts(a.limit ?? 20);
  const ids: number[] =
    a.unit !== undefined || a.courseId !== undefined
      ? [Number(a.unit ?? a.courseId)]
      : (a.courseIds ??
        ctx.config.units.flatMap((u) =>
          u.moodle_course_id ? [u.moodle_course_id] : [],
        ));
  if (!ids.length)
    throw new SuiteError(
      "PLATFORM_NOT_CONFIGURED",
      "Bind at least one Moodle course before reading course content.",
    );
  const courses = allCourses.filter((v) => ids.includes(v.id));
  for (const id of ids) await ctx.enrolled(id);
  if (name === "sync" && courses.length > 1) {
    if (a.activity_id !== undefined || a.section !== undefined)
      throw new SuiteError(
        "INVALID_INPUT",
        "Select one course when choosing an activity or section.",
      );
    const results: Array<Record<string, unknown>> = [];
    let remaining = ctx.maxBatchBytes ?? MAX_FILE_BYTES;
    for (const course of courses) {
      if (remaining <= 0) {
        results.push({
          course_id: course.id,
          unit: ctx.config.units.find((u) => u.moodle_course_id === course.id)
            ?.key,
          coverage: "partial",
          next_offset: a.offset ?? 0,
          has_more: true,
        });
        continue;
      }
      try {
        const result = (await moodleRead(
          "sync",
          {
            ...a,
            unit: course.id,
            courseId: course.id,
            courseIds: [course.id],
          },
          { ...ctx, maxBatchBytes: remaining },
        )) as Record<string, unknown> & { files: LearningFile[] };
        remaining -= result.files.reduce((n, f) => n + f.bytes, 0);
        results.push({
          ...result,
          course_id: course.id,
          unit: ctx.config.units.find((u) => u.moodle_course_id === course.id)
            ?.key,
        });
      } catch (error) {
        results.push({
          course_id: course.id,
          coverage: "partial",
          error: failure(error),
        });
      }
    }
    return {
      courses: results,
      coverage: results.some((v) => v.coverage !== "complete")
        ? "partial"
        : "complete",
      pagination: "per_course",
      dry_run: a.dry_run ?? false,
    };
  }
  const first = required(courses[0], "an enrolled Moodle course");
  const sections = async (course: number) => c.getCourseContents(course);
  const activity = async (ref: number | string) => {
    const contents = await sections(first.id);
    const activities = contents.flatMap((s) => s.activities);
    const candidates =
      typeof ref === "number" || /^\d+$/.test(String(ref))
        ? activities.filter((v) => v.id === Number(ref))
        : activities.filter(
            (v) => v.name.toLowerCase() === String(ref).trim().toLowerCase(),
          );
    if (candidates.length !== 1)
      throw new SuiteError(
        "ENTITY_NOT_ALLOWED",
        "Choose one activity ID or exact name from the selected course.",
        403,
      );
    return required(candidates[0], "activity");
  };
  const detail = async (ref: number | string) => {
    const found = await activity(ref);
    const result = await c.getActivity(found.id);
    if ("course_id" in result && result.course_id)
      requireOwner(result.course_id, first.id);
    if (result.id !== found.id) await activity(result.id);
    return {
      ...result,
      description:
        ("description" in result ? result.description : undefined) ??
        ("description" in found ? found.description : undefined),
      course_id: first.id,
      unit_id: first.id,
    };
  };
  const filesFor = async (ref: number | string) => {
    const found = await activity(ref);
    const full = await detail(ref);
    return {
      found,
      full,
      files:
        ("file_entries" in full ? full.file_entries : undefined) ??
        found.file_entries ??
        [],
    };
  };
  const safeFileUrl = (value: string) => {
    const url = new URL(value, c.baseUrl);
    if (
      url.origin !== new URL(c.baseUrl).origin ||
      url.username ||
      url.password ||
      url.protocol !== "https:" ||
      !(
        /\/(?:pluginfile|webservice\/pluginfile)\.php\//.test(url.pathname) ||
        url.pathname === "/mod/resource/view.php"
      )
    )
      throw new SuiteError(
        "SITE_NOT_ALLOWED",
        "Only a file returned by this course on its saved Moodle site can be downloaded.",
        403,
      );
    return url.href;
  };
  const fetchFile = async (entry: FileEntry, fetched?: Response) => {
    const response =
      fetched ?? (await read(() => c.requestAbsolute(safeFileUrl(entry.url))));
    const type =
      response.headers.get("content-type") ?? "application/octet-stream";
    const bytes = await responseBytes(response);
    if (
      /html/i.test(type) &&
      /(?:name=["'](?:password|username)|id=["']login|\/login\/index\.php)/i.test(
        new TextDecoder().decode(bytes),
      )
    )
      throw new SuiteError(
        "PLATFORM_SESSION_EXPIRED",
        "Moodle returned a sign-in page instead of a file.",
        409,
      );
    return learningFile(bytes, entry.name, type, ctx.output);
  };
  const forum = async (forumId: number) => {
    const found = (await c.getForums(first.id)).find((v) => v.id === forumId);
    if (!found)
      throw new SuiteError(
        "ENTITY_NOT_ALLOWED",
        "This forum is not part of the selected course.",
        403,
      );
    requireOwner(found.course_id, first.id);
    return found;
  };
  const discussion = async (discussionId: number) => {
    const result = await c.getForumDiscussion(discussionId);
    requireOwner(result.course_id, first.id);
    return result;
  };
  switch (name) {
    case "activities":
    case "unit": {
      const contents = await sections(first.id);
      if (a.section !== undefined && a.section_id !== undefined)
        throw new SuiteError(
          "INVALID_INPUT",
          "Choose section or section_id, not both.",
        );
      const chosen =
        a.section_id !== undefined
          ? contents.filter((s) => s.id === a.section_id)
          : a.section === undefined
            ? contents
            : withChildSections(
                resolveSection(a.section, contents).section,
                contents,
              );
      if (name === "activities") {
        const listed = chosen
          .flatMap((s) =>
            s.activities.map((v) => ({
              ...v,
              section_id: s.id,
              section: s.name,
            })),
          )
          .filter((v) => a.include_labels || v.modname !== "label");
        const p = page(listed, a, 200);
        return {
          ...p,
          activities: p.results,
          results: undefined,
          course_id: first.id,
        };
      }
      return { unit: first, sections: chosen };
    }
    case "due": {
      const results: Array<TodoItem & { unit_id: number }> = [];
      for (const course of courses) {
        const rows = await c.getTodo(
          (a.offset ?? 0) + (a.limit ?? 100) + 1,
          a.days ?? 14,
          course.id,
        );
        for (const row of rows) requireOwner(row.course_id, course.id);
        results.push(...rows.map((v) => ({ ...v, unit_id: course.id })));
      }
      const p = page(
        results.sort((x, y) => x.due_at - y.due_at),
        a,
      );
      return {
        due: p.results,
        offset: p.offset,
        has_more: p.has_more,
        coverage: "bounded",
        per_course_limit: (a.offset ?? 0) + (a.limit ?? 100) + 1,
      };
    }
    case "home": {
      const user = await c.getSiteInfo(),
        timezone = user.timezone || "UTC";
      const home: {
        timezone: string;
        today: string;
        timezone_source: string;
        user: UserInfo;
        courses: Array<Course & { current_sections: Section[] }>;
        due: TodoItem[];
        errors: Array<ReturnType<typeof publicError> & { course_id?: number }>;
        alerts?: AlertSummary;
      } = {
        timezone,
        today: new Date().toISOString().slice(0, 10),
        timezone_source: user.timezone ? "platform" : "UTC fallback",
        user,
        courses: [],
        due: [],
        errors: [],
      };
      try {
        home.today = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
      } catch {
        home.timezone = "UTC";
        home.timezone_source = "UTC fallback";
      }
      for (const course of courses) {
        try {
          home.courses.push({
            ...course,
            current_sections: (await sections(course.id)).filter(
              (s) => s.current,
            ),
          });
        } catch (error) {
          home.errors.push({ course_id: course.id, ...failure(error) });
        }
        try {
          const todo = await c.getTodo(a.limit ?? 20, a.days ?? 14, course.id);
          for (const row of todo) requireOwner(row.course_id, course.id);
          home.due.push(...todo);
        } catch (error) {
          home.errors.push({ course_id: course.id, ...failure(error) });
        }
      }
      try {
        home.alerts = await c.getAlerts(a.alerts_limit ?? 5);
      } catch (error) {
        home.errors.push(failure(error));
      }
      return { home, coverage: home.errors.length ? "partial" : "bounded" };
    }
    case "grades": {
      const mode = a.mode ?? "all",
        reports: Array<
          Omit<CourseGrades, "items"> & {
            unit_id: number;
            graded: number;
            ungraded: number;
            total: number;
            items: Array<Omit<GradeItem, "feedback"> & { feedback?: string }>;
          }
        > = [];
      for (const course of courses) {
        const report = await c.getCourseGrades(course.id);
        requireOwner(report.course_id, course.id);
        const scoped = report.items.filter(
          (v) => !a.types?.length || a.types.includes(v.modname),
        );
        const graded = scoped.filter((v) => hasGrade(v.grade)).length;
        reports.push({
          ...report,
          unit_id: course.id,
          graded,
          ungraded: scoped.length - graded,
          total: scoped.length,
          items: scoped
            .filter(
              (v) => mode === "all" || a.include_ungraded || hasGrade(v.grade),
            )
            .map((v) => ({
              ...v,
              feedback: a.include_feedback === false ? undefined : v.feedback,
            })),
        });
      }
      if (mode === "summary")
        return {
          mode,
          grades: reports.map(({ items, ...summary }) => summary),
        };
      const { pages, ...pagination } = pageGradeReports(
        reports,
        a.limit ?? 100,
        a.offset ?? 0,
      );
      return { mode, grades: pages, ...pagination };
    }
    case "find": {
      const found: Array<{
        id: number;
        name: string;
        type?: string;
        score: number;
        unit_id: number;
      }> = [];
      const query = a.query === "*" ? "" : required(a.query, "query");
      for (const course of courses) {
        found.push(...searchSections(course, await sections(course.id), query));
        if (!a.types?.length || a.types.includes("thread")) {
          for (const f of await c.getForums(course.id)) {
            requireOwner(f.course_id, course.id);
            for (const t of await c.getForumDiscussionRefs(f.id))
              if (
                String(query)
                  .toLowerCase()
                  .split(/\s+/)
                  .every((word: string) =>
                    t.subject.toLowerCase().includes(word),
                  )
              )
                found.push({
                  ...t,
                  type: "thread",
                  name: t.subject,
                  unit_id: course.id,
                  score: 50,
                });
          }
        }
      }
      const p = page(
        found
          .filter((v) => !a.types?.length || a.types.includes(v.type ?? ""))
          .sort((x, y) => y.score - x.score),
        a,
        20,
      );
      return { ...p, coverage: "available_course_indexes" };
    }
    case "item":
      return { item: await detail(required(a.activity_id, "activity_id")) };
    case "quiz_show":
    case "attempt": {
      const quiz = await detail(required(a.activity_id, "activity_id"));
      if (
        quiz.type !== "quiz" ||
        !("attempts" in quiz) ||
        !quiz.attempts?.some((v) => v.id === a.attempt_id)
      )
        throw new SuiteError(
          "ENTITY_NOT_ALLOWED",
          "Choose one of your attempts listed by this quiz.",
          403,
        );
      if (name === "quiz_show") {
        // Upstream refuses sequential advancement unless advance=true, which is never passed here.
        return {
          attempt: await c.getQuizAttemptPage(
            required(a.attempt_id, "attempt_id"),
            quiz.id,
            a.page === undefined ? undefined : a.page - 1,
          ),
        };
      }
      const review = await c.getQuizAttempt(
        required(a.attempt_id, "attempt_id"),
      );
      requireOwner(review.course_id, first.id);
      // Moodle review quiz_id is the quiz instance ID, whereas activity_id is a course-module ID.
      requireOwner(review.id, a.attempt_id);
      return { attempt: review };
    }
    case "forums": {
      const forums: Awaited<ReturnType<MoodleClientCore["getForums"]>> = [];
      for (const course of courses) {
        const rows = await c.getForums(course.id);
        for (const value of rows) requireOwner(value.course_id, course.id);
        forums.push(...rows);
      }
      const p = page(forums, a);
      return { ...p, forums: p.results, results: undefined };
    }
    case "forum": {
      const selected = await forum(required(a.forum_id, "forum_id"));
      return {
        forum: selected,
        ...page(
          (await c.getForumDiscussionRefs(selected.id)).filter(
            (v) =>
              !a.query ||
              a.query
                .toLowerCase()
                .split(/\s+/)
                .every((word) => v.subject.toLowerCase().includes(word)),
          ),
          a,
        ),
      };
    }
    case "thread": {
      const result = await discussion(
        required(a.discussion_id, "discussion_id"),
      );
      const posts =
        a.post_id === undefined
          ? result.posts
          : result.posts.filter((v) => v.id === a.post_id);
      const p = page(posts, a, 50);
      return {
        thread: {
          ...result,
          unit_id: result.course_id,
          name: result.subject,
          posts_total: result.posts.length,
          posts: p.results.map((v) => ({
            ...v,
            message_text: v.message_text,
            ...(a.include_html === false ? { message_html: undefined } : {}),
          })),
          offset: p.offset,
          has_more: p.has_more,
        },
      };
    }
    case "search_forums": {
      const options = {
        courseId: courses.length === 1 ? first.id : undefined,
        forumCmid: a.forum_id,
        includePostText: a.include_post_text ?? a.includePostText ?? true,
        titlesOnly: a.titles_only,
        unreadOnly: a.unread_only,
        sortBy: a.sort ?? a.sortBy ?? "recent",
        limit: (a.offset ?? 0) + (a.limit ?? 30) + 1,
        maxForums: a.max_forums ?? a.maxForums ?? 10,
        maxDiscussionsPerForum:
          a.max_discussions_per_forum ?? a.maxDiscussionsPerForum ?? 20,
      };
      let values: ForumSearchHit[];
      if (courses.length === 1) {
        if (a.forum_id !== undefined) await forum(a.forum_id);
        values = await c.searchForumContent({
          query: required(a.query, "query"),
          ...options,
        });
        for (const hit of values) requireOwner(hit.course_id, first.id);
      } else {
        const forums: Awaited<ReturnType<MoodleClientCore["getForums"]>> = [];
        for (const course of courses) {
          const rows = await c.getForums(course.id);
          for (const row of rows) requireOwner(row.course_id, course.id);
          forums.push(...rows);
        }
        if (
          a.forum_id !== undefined &&
          !forums.some((v) => v.id === a.forum_id)
        )
          throw new SuiteError(
            "ENTITY_NOT_ALLOWED",
            "This forum is not in the selected linked courses.",
            403,
          );
        const discussionCourses = new Map<number, number>();
        values = await searchForumContent(
          {
            getForums: async () => forums,
            getForumDiscussionRefs: async (id) => {
              const owner = forums.find((v) => v.id === id);
              if (!owner)
                throw new SuiteError(
                  "ENTITY_NOT_ALLOWED",
                  "Unknown course forum.",
                  403,
                );
              const rows = await c.getForumDiscussionRefs(id);
              for (const row of rows)
                discussionCourses.set(row.id, owner.course_id);
              return rows;
            },
            getForumDiscussion: async (id) => {
              const owner = discussionCourses.get(id);
              if (owner === undefined)
                throw new SuiteError(
                  "ENTITY_NOT_ALLOWED",
                  "Unknown forum discussion.",
                  403,
                );
              const value = await c.getForumDiscussion(id);
              requireOwner(value.course_id, owner);
              return value;
            },
          },
          required(a.query, "query"),
          { ...options, baseUrl: c.baseUrl },
        );
      }
      return {
        ...page(
          values.map((v) => ({
            ...v,
            unit_id: v.course_id,
            name: v.discussion_subject,
          })),
          a,
          30,
        ),
        coverage: "bounded",
        max_forums: options.maxForums,
        max_discussions_per_forum: options.maxDiscussionsPerForum,
      };
    }
    case "news": {
      const refs: Array<
        ForumDiscussionRef & { course_id: number; forum_id: number }
      > = [];
      for (const course of courses)
        for (const f of await c.getNewsForums(course.id)) {
          requireOwner(f.course_id, course.id);
          for (const t of await c.getForumDiscussionRefs(f.id))
            refs.push({ ...t, course_id: course.id, forum_id: f.id });
        }
      const news: Array<
        (typeof refs)[number] & { name: string; post?: ForumPost }
      > = [];
      for (const ref of refs.slice(0, a.scan_limit ?? 100)) {
        const full = await c.getForumDiscussion(ref.id);
        requireOwner(full.course_id, ref.course_id);
        const post = [...full.posts].sort(
          (x, y) => x.time_created - y.time_created,
        )[0];
        news.push({ ...ref, name: ref.subject, post });
      }
      return {
        ...page(
          news.sort(
            (x, y) => (y.post?.time_created ?? 0) - (x.post?.time_created ?? 0),
          ),
          a,
          20,
        ),
        coverage: refs.length > news.length ? "partial" : "complete",
        available: refs.length,
      };
    }
    case "file": {
      const { files } = await filesFor(required(a.activity_id, "activity_id"));
      const selected = files[a.file_index ?? 0];
      if (!selected)
        throw new SuiteError(
          "FILE_NOT_FOUND",
          "Choose a file index returned by this activity.",
        );
      return { file: await fetchFile(selected) };
    }
    case "download":
    case "sync": {
      const contents = await sections(first.id);
      const scoped =
        a.section === undefined
          ? contents
          : withChildSections(
              resolveSection(a.section, contents).section,
              contents,
            );
      const activities =
        a.activity_id !== undefined
          ? [await activity(a.activity_id)]
          : scoped
              .flatMap((s) => s.activities)
              .filter((v) => supportedFiles.has(v.modname));
      const files: LearningFile[] = [],
        manifest: Array<
          {
            source: string;
            sha256: string;
            name: string;
            bytes: number;
            unchanged: boolean;
          } & Partial<SyncEntry>
        > = [],
        errors: Array<
          ReturnType<typeof publicError> & {
            activity_id?: number;
            source?: string;
            part?: string;
          }
        > = [];
      const candidates: Array<{
        found: Activity;
        entry?: FileEntry;
        source: string;
      }> = [];
      for (const found of activities) {
        try {
          if (
            (found.modname === "page" || found.modname === "book") &&
            name === "sync"
          )
            candidates.push({ found, source: `activity:${found.id}` });
          else if (!["page", "book"].includes(found.modname)) {
            const { files: entries } = await filesFor(found.id);
            for (const [index, entry] of entries.entries())
              candidates.push({
                found,
                entry,
                source: `activity:${found.id}:file:${index}`,
              });
          }
        } catch (error) {
          errors.push({ activity_id: found.id, ...failure(error) });
        }
      }
      const previous = (a.previous_manifest ?? []).filter(
        (entry) => entry.course_id === first.id,
      );
      const keys = new Map<string, string>();
      for (const candidate of candidates)
        keys.set(
          candidate.source,
          await digest(
            `${first.id}:${candidate.found.id}:${candidate.entry ? new URL(candidate.entry.url, c.baseUrl).pathname : "html"}`,
          ),
        );
      const actions: object[] = [];
      const offset = a.offset ?? 0,
        limit = a.limit ?? 20;
      const chosen = candidates.slice(offset, offset + limit);
      let used = 0,
        processed = 0;
      for (const { found, entry, source } of chosen) {
        try {
          const key = keys.get(source)!;
          const old = previous.find((v) => v.key === key);
          const section = contents.find((s) =>
            s.activities.some((v) => v.id === found.id),
          );
          const path = syncPath(
            `${first.id}-${first.shortname}`,
            `${section?.section ?? 0}-${section?.name ?? "Course"}`,
            `${found.id}-${found.name}`,
            `${key.slice(0, 12)}-${entry?.name ?? `${found.name}.html`}`,
          );
          let file: LearningFile;
          let etag: string | undefined, last_modified: string | undefined;
          if (entry) {
            const headers = new Headers();
            if (
              name === "sync" &&
              old &&
              localHash(old) !== null &&
              (localHash(old) === old.sha256 || old.path === path)
            ) {
              if (old.etag) headers.set("if-none-match", old.etag);
              if (old.last_modified)
                headers.set("if-modified-since", old.last_modified);
            }
            const response = await read(() =>
              c.requestAbsolute(
                safeFileUrl(entry.url),
                { headers },
                { allowErrorStatus: [...headers].length !== 0 },
              ),
            );
            if (!response.ok && response.status !== 304) {
              await response.body?.cancel();
              throw platformReadError("moodle", {
                code:
                  response.status === 404
                    ? "not_found"
                    : response.status === 401
                      ? "auth"
                      : "upstream",
                message: `HTTP ${response.status}`,
              });
            }
            etag = response.headers.get("etag") ?? undefined;
            last_modified = response.headers.get("last-modified") ?? undefined;
            if (response.status === 304 && old && [...headers].length !== 0) {
              const current: SyncEntry = {
                ...old,
                source,
                section_id: section?.id ?? 0,
                name: entry.name,
                path,
                etag: etag ?? old.etag,
                last_modified: last_modified ?? old.last_modified,
              };
              manifest.push({ ...current, unchanged: true });
              actions.push({ key, ...syncAction(current, old) });
              processed++;
              continue;
            }
            file = await fetchFile(entry, response);
          } else {
            const path =
              found.modname === "book"
                ? `/mod/book/tool/print/index.php?id=${found.id}`
                : `/mod/page/view.php?id=${found.id}`;
            const response = await read(() =>
              c.requestAbsolute(`${c.baseUrl}${path}`),
            );
            const raw = new TextDecoder().decode(await responseBytes(response));
            const content = parseSavedDocumentHtml(raw, c.baseUrl);
            if (!content)
              throw new SuiteError(
                "FILE_NOT_FOUND",
                "This page has no readable document.",
              );
            for (const node of content.querySelectorAll(
              "script, iframe, form, object, embed, input, button",
            ))
              node.remove();
            let imageBytes = 0;
            for (const image of content.querySelectorAll("img[src]")) {
              const url = new URL(
                required(image.getAttribute("src"), "image src"),
                c.baseUrl,
              );
              if (
                url.origin !== new URL(c.baseUrl).origin ||
                !url.pathname.includes("/pluginfile.php/")
              )
                continue;
              try {
                const img = await read(() =>
                  c.requestAbsolute(safeFileUrl(url.href)),
                );
                const type =
                  img.headers.get("content-type")?.split(";")[0] ?? "";
                if (!/^image\/[a-z0-9.+-]+$/i.test(type)) {
                  await img.body?.cancel();
                  throw new SuiteError(
                    "FILE_UNAVAILABLE",
                    "Moodle did not return a readable inline image.",
                    502,
                  );
                }
                const bytes = await responseBytes(img, 5 * 1024 * 1024);
                imageBytes += bytes.length;
                if (imageBytes > 10 * 1024 * 1024)
                  throw new SuiteError(
                    "FILE_TOO_LARGE",
                    "This document contains too many inline images.",
                  );
                const imageText = new TextDecoder().decode(bytes);
                if (ctx.output.redact(imageText) !== imageText)
                  throw new SuiteError(
                    "FILE_CONTAINS_CREDENTIALS",
                    "This image contains credential material.",
                    403,
                  );
                image.setAttribute(
                  "src",
                  `data:${type};base64,${base64(bytes)}`,
                );
              } catch (error) {
                errors.push({
                  activity_id: found.id,
                  part: "image",
                  ...failure(error),
                });
              }
            }
            const html = ctx.output.redact(
              `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'none'"></head><body>${content.toString()}</body></html>`,
            );
            file = await learningFile(
              new TextEncoder().encode(html),
              `${found.name}.html`,
              "text/html",
              ctx.output,
            );
          }
          const current: SyncEntry = {
            key,
            source,
            course_id: first.id,
            activity_id: found.id,
            section_id: section?.id ?? 0,
            name: file.name,
            path,
            sha256: file.sha256,
            bytes: file.bytes,
            ...(etag ? { etag } : {}),
            ...(last_modified ? { last_modified } : {}),
          };
          const previousEntry = old;
          const action = syncAction(current, previousEntry);
          const unchanged = previousEntry
            ? ["unchanged", "rename", "preserve_local"].includes(action.action)
            : (a.known_hashes?.includes(file.sha256) ?? false);
          if (
            !unchanged &&
            !a.dry_run &&
            used + file.bytes > (ctx.maxBatchBytes ?? MAX_FILE_BYTES)
          )
            break;
          manifest.push({ ...current, unchanged });
          if (name === "sync") actions.push({ key, ...action });
          if (!unchanged && !a.dry_run) {
            used += file.bytes;
            files.push(file);
          }
        } catch (error) {
          errors.push({ source, activity_id: found.id, ...failure(error) });
        }
        processed++;
      }
      const next = offset + processed;
      const removed =
        name === "sync" &&
        errors.length === 0 &&
        offset === 0 &&
        next === candidates.length
          ? previous
              .filter(
                (v) =>
                  ![...keys.values()].includes(v.key) &&
                  (a.activity_id === undefined ||
                    activities.some((act) => act.id === v.activity_id)) &&
                  (a.section === undefined ||
                    scoped.some((s) => s.id === v.section_id)),
              )
              .filter(
                (v) =>
                  !actions.some(
                    (action) => (action as { from?: string }).from === v.path,
                  ),
              )
              .map((v) => ({
                key: v.key,
                path: v.path,
                action:
                  localHash(v) !== null && localHash(v) !== v.sha256
                    ? "preserve_local"
                    : "remove",
                reason: "removed_upstream",
              }))
          : [];
      const savedManifest = manifest.map(({ unchanged, ...v }) => v);

      return {
        files,
        manifest,
        errors,
        coverage:
          errors.length || next < candidates.length ? "partial" : "complete",
        offset,
        next_offset: next < candidates.length ? next : null,
        has_more: next < candidates.length,
        total: candidates.length,
        limit,
        unchanged: manifest.filter((v) => v.unchanged).length,
        ...(name === "sync"
          ? {
              actions: [...actions, ...removed],
              saved_manifest: savedManifest,
              dry_run: a.dry_run ?? false,
              removals_complete:
                offset === 0 &&
                next === candidates.length &&
                errors.length === 0,
            }
          : {}),
      };
    }
  }
  return unhandledRead(name);
}
