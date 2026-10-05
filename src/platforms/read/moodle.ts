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
} from "../../../vendor/moodle/client.js";
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
) {
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
  const fetchFile = async (entry: FileEntry) => {
    const response = await read(() =>
      c.requestAbsolute(safeFileUrl(entry.url)),
    );
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
    case "unit": {
      const contents = await sections(first.id);
      const chosen =
        a.section === undefined
          ? contents
          : withChildSections(
              resolveSection(a.section, contents).section,
              contents,
            );
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
      const review = await c.getQuizAttempt(
        required(a.attempt_id, "attempt_id"),
      );
      requireOwner(review.course_id, first.id);
      // Moodle review quiz_id is the quiz instance ID, whereas activity_id is a course-module ID.
      requireOwner(review.id, a.attempt_id);
      return { attempt: review };
    }
    case "forums": {
      const forums = await c.getForums(first.id);
      for (const value of forums) requireOwner(value.course_id, first.id);
      return { forums };
    }
    case "forum": {
      const selected = await forum(required(a.forum_id, "forum_id"));
      return {
        forum: selected,
        ...page(await c.getForumDiscussionRefs(selected.id), a),
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
      if (a.forum_id !== undefined)
        await forum(required(a.forum_id, "forum_id"));
      const hits: Array<ForumSearchHit & { unit_id: number; name: string }> =
        [];
      for (const course of courses) {
        const values = await c.searchForumContent({
          query: required(a.query, "query"),
          courseId: course.id,
          forumCmid: a.forum_id,
          includePostText: a.include_post_text ?? a.includePostText ?? true,
          titlesOnly: a.titles_only,
          unreadOnly: a.unread_only,
          sortBy: a.sort ?? a.sortBy ?? "recent",
          limit: (a.offset ?? 0) + (a.limit ?? 30) + 1,
          maxForums: a.max_forums ?? a.maxForums ?? 10,
          maxDiscussionsPerForum:
            a.max_discussions_per_forum ?? a.maxDiscussionsPerForum ?? 20,
        });
        for (const hit of values) requireOwner(hit.course_id, course.id);
        hits.push(
          ...values.map((v) => ({
            ...v,
            unit_id: course.id,
            name: v.discussion_subject,
          })),
        );
      }
      return {
        ...page(hits, a, 30),
        coverage: "bounded",
        max_forums: a.max_forums ?? 10,
        max_discussions_per_forum: a.max_discussions_per_forum ?? 20,
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
        manifest: Array<{
          source: string;
          sha256: string;
          name: string;
          bytes: number;
          unchanged: boolean;
        }> = [],
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
      const offset = a.offset ?? 0,
        limit = a.limit ?? 20;
      const chosen = candidates.slice(offset, offset + limit);
      let used = 0;
      for (const { found, entry, source } of chosen) {
        try {
          let file: LearningFile;
          if (entry) file = await fetchFile(entry);
          else {
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
                if (!/^image\/(png|jpeg|gif|webp)$/.test(type)) {
                  await img.body?.cancel();
                  continue;
                }
                const bytes = await responseBytes(img, 1024 * 1024);
                imageBytes += bytes.length;
                if (imageBytes > 4 * 1024 * 1024)
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
          const unchanged = a.known_hashes?.includes(file.sha256) ?? false;
          if (!unchanged && used + file.bytes > MAX_FILE_BYTES)
            throw new SuiteError(
              "BATCH_TOO_LARGE",
              "Select fewer files or download this file individually; one batch is limited to 16 MiB.",
            );
          manifest.push({
            source,
            sha256: file.sha256,
            name: file.name,
            bytes: file.bytes,
            unchanged,
          });
          if (!unchanged) {
            used += file.bytes;
            files.push(file);
          }
        } catch (error) {
          errors.push({ source, activity_id: found.id, ...failure(error) });
        }
      }
      const next = offset + chosen.length;
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
      };
    }
  }
  return unhandledRead(name);
}
