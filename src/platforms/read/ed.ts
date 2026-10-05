import type { EdClient } from "../../../vendor/ed/client.js";
import type { EdReadArgs, EdOperation } from "./contracts.ts";
import {
  listThreads,
  listLessons,
  parseSinceValue,
  listLessonFiles,
  listThreadFiles,
  threadToMarkdown,
  lessonToMarkdown,
  slideToMarkdown,
  projectThreadDetail,
  buildForumCatchup,
  buildThreadActivity,
  buildLessonProgress,
  buildLessonGuide,
} from "../../../vendor/ed/client.js";
import { SuiteError } from "../../errors.ts";
import { learningFile, responseBytes } from "./files.ts";
import {
  requireOwner,
  page,
  required,
  unhandledRead,
  type ReadContext,
} from "./shared.ts";

export async function edRead(
  name: EdOperation,
  a: EdReadArgs,
  ctx: ReadContext<EdClient>,
) {
  const c = ctx.client,
    course = Number(a.courseId);
  if (name === "get_user")
    return { user: (await c.fetchUser()).user, authenticated: true };
  if (name === "courses") {
    const courses = (await c.fetchUser()).courses.filter(
      (v) => a.include_archived || v.status.toLowerCase() !== "archived",
    );
    // Reuse the institutional metadata check applied by enrollment validation.
    const allowed: typeof courses = [];
    for (const row of courses) {
      try {
        await ctx.enrolled(row.id);
        allowed.push(row);
      } catch (error) {
        if (
          !(error instanceof SuiteError) ||
          error.code !== "COURSE_NOT_ACCESSIBLE"
        )
          throw error;
      }
    }
    const p = page(allowed, a);
    return { courses: p.results, ...p, results: undefined };
  }
  await ctx.enrolled(course);
  // Upstream builders fetch internally; enforce the same ownership checks at that seam.
  const viewClient = new Proxy(c, {
    get(target, property) {
      if (property === "fetchThreads")
        return async (...args: Parameters<EdClient["fetchThreads"]>) => {
          requireOwner(args[0], course);
          const values = await target.fetchThreads(...args);
          for (const value of values) requireOwner(value.courseId, course);
          return values;
        };
      if (property === "fetchLessons")
        return async (id: number) => {
          requireOwner(id, course);
          const values = await target.fetchLessons(id);
          for (const value of [...values.modules, ...values.lessons])
            requireOwner(value.courseId, course);
          return values;
        };
      if (property === "fetchLesson")
        return async (id: number) => {
          const value = await target.fetchLesson(id, { view: false });
          requireOwner(value.courseId, course);
          return value;
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const lesson = async () => {
    const v = await c.fetchLesson(required(a.lessonId, "lesson_id"), {
      view: false,
    });
    requireOwner(v.courseId, course);
    return v;
  };
  const thread = async () => {
    const v =
      a.number !== undefined
        ? await c.fetchCourseThread(course, a.number)
        : await c.fetchThread(required(a.threadId, "thread_id"));
    requireOwner(v.courseId, course);
    return v;
  };
  const slide = async () => {
    // Validate a slide through its selected lesson before requesting questions or saved answers.
    const parent = await lesson();
    if (!parent.slides.some((s) => s.id === a.slideId))
      throw new SuiteError(
        "ENTITY_NOT_ALLOWED",
        "This slide is not part of the selected lesson.",
        403,
      );
    const v = await c.fetchSlide(required(a.slideId, "slide_id"), {
      view: false,
    });
    requireOwner(v.courseId, course);
    requireOwner(v.lessonId, parent.id);
    return v;
  };
  switch (name) {
    case "course":
      return {
        course: (await c.fetchUser()).courses.find((v) => v.id === course),
      };
    case "list_lessons": {
      const lessons = await listLessons(c, course, {
        module: a.module,
        lessonType: a.lesson_type,
        state: a.state,
        status: a.status,
      });
      for (const value of lessons) requireOwner(value.courseId, course);
      return { lessons };
    }
    case "list_modules": {
      const v = await c.fetchLessons(course);
      for (const value of [...v.modules, ...v.lessons])
        requireOwner(value.courseId, course);
      return {
        modules: v.modules.map((m) => ({
          ...m,
          lesson_count: v.lessons.filter((l) => l.moduleId === m.id).length,
        })),
      };
    }
    case "get_lesson":
      return lesson();
    case "get_thread":
    case "get_course_thread": {
      const v = await thread();
      return {
        ...projectThreadDetail(v, {
          includeHtml: a.include_html ?? a.includeHtml ?? true,
        }),
        courseId: v.courseId,
      };
    }
    case "read_thread":
      return { markdown: threadToMarkdown(await thread()) };
    case "read_lesson":
      return { markdown: lessonToMarkdown(await lesson()) };
    case "get_slide":
      return slide();
    case "read_slide":
      return { markdown: slideToMarkdown(await slide()) };
    case "list_slide_questions":
      await slide();
      return {
        questions: await c.fetchSlideQuestions(required(a.slideId, "slide_id")),
      };
    case "list_slide_responses": {
      await slide();
      const user = (await c.fetchUser()).user;
      return {
        responses: (
          await c.fetchSlideQuestionResponses(required(a.slideId, "slide_id"))
        ).filter((v) => v.userId === user.id),
      };
    }
    case "list_threads":
    case "search_threads": {
      const options = {
        courseId: course,
        limit: a.limit ?? 100,
        offset: a.offset ?? 0,
        sort: a.sort ?? "new",
        since: a.since ? parseSinceValue(a.since) : undefined,
        answered: a.answered,
        category: a.category,
        subcategory: a.subcategory,
        threadType: a.thread_type,
        query: a.query,
      };
      const threads = await listThreads(c, options);
      for (const value of threads) requireOwner(value.courseId, course);
      return {
        threads,
        coverage: "bounded",
        offset: options.offset,
        limit: options.limit,
        reason:
          "Filtered searches scan at most ten upstream pages; offset refers to the unfiltered Ed stream.",
      };
    }
    case "list_activity": {
      const user = (await c.fetchUser()).user;
      return {
        activity: await c.fetchUserActivity(user.id, {
          courseId: course,
          filterType: a.filter_type ?? "all",
          limit: a.limit ?? 30,
          offset: a.offset ?? 0,
        }),
      };
    }
    case "list_lesson_files":
      return {
        files: listLessonFiles(await lesson()).filter(
          (v) => a.slideId === undefined || v.slideId === a.slideId,
        ),
      };
    case "list_thread_files":
      return { files: listThreadFiles(await thread()) };
    case "file": {
      const files =
        a.lessonId !== undefined
          ? listLessonFiles(await lesson())
          : listThreadFiles(await thread());
      const selected = files.filter(
        (v) => a.slideId === undefined || v.slideId === a.slideId,
      );
      const file = selected[Number(a.file_index ?? 0)];
      if (!file)
        throw new SuiteError(
          "FILE_NOT_FOUND",
          "Choose a file index from the fresh file listing.",
        );
      const response = await (ctx.read
        ? ctx.read(() => c.fetchFile(file.url))
        : c.fetchFile(file.url));
      return {
        file: await learningFile(
          await responseBytes(response),
          file.filename,
          response.headers.get("content-type") ??
            file.mediaType ??
            "application/octet-stream",
          ctx.output,
        ),
      };
    }
    case "show_forum_catchup":
      return {
        ...(await buildForumCatchup(viewClient, course, a.days ?? 14)),
        coverage: "bounded",
        page_cap: 10,
      };
    case "show_thread_activity":
      return {
        ...(await buildThreadActivity(viewClient, course, a.weeks ?? 12)),
        coverage: "bounded",
        page_cap: 10,
      };
    case "show_lesson_progress":
      return buildLessonProgress(viewClient, course);
    case "show_lesson_guide": {
      await lesson();
      // The upstream builder fetches the lesson without view=true and writes no progress.
      return buildLessonGuide(viewClient, {
        lessonId: required(a.lessonId, "lesson_id"),
        sections: required(a.sections, "sections"),
        quiz: a.quiz ?? [],
      });
    }
  }
  return unhandledRead(name);
}
