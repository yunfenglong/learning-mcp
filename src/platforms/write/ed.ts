import {
  markdownToEdDocument,
  listLessons,
} from "../../../vendor/ed/client.js";
import type { EdClient } from "../../../vendor/ed/client.js";
import type {
  Thread,
  Comment,
} from "../../../vendor/ed/types/src/ed/models.js";
import type { WriteArgs } from "../../capabilities/write/index.ts";
import { SuiteError } from "../../errors.ts";
import { requireOwner, required } from "../read/shared.ts";
import { verifyPlan, type WriteContext } from "./shared.ts";
function contains(comments: Comment[], id: number): boolean {
  return comments.some((c) => c.id === id || contains(c.comments, id));
}
export async function edWrite(
  name: string,
  a: WriteArgs,
  ctx: WriteContext<EdClient>,
  execute = false,
): Promise<unknown> {
  const c = ctx.client,
    course = required(ctx.unit.ed_course_id, "Ed course");
  await ctx.enrolled(course);
  const user = (await c.fetchUser()).user;
  const lesson = async (id: number) => {
    const l = await c.fetchLesson(id, { view: false });
    requireOwner(l.courseId, course);
    return l;
  };
  const slide = async () => {
    const l = await lesson(required(a.lesson_id, "lesson_id"));
    const s = l.slides.find((s) => s.id === a.slide_id);
    if (!s)
      throw new SuiteError(
        "ENTITY_NOT_ALLOWED",
        "This slide is not part of the selected lesson.",
        403,
      );
    const full = await c.fetchSlide(s.id, { view: false });
    requireOwner(full.courseId, course);
    requireOwner(full.lessonId, l.id);
    return { lesson: l, slide: full };
  };
  if (name === "create_thread" || name === "reply_thread") {
    const content = markdownToEdDocument(required(a.body, "body"));
    let t: Thread | undefined;
    if (name === "reply_thread") {
      if ((a.thread_id === undefined) === (a.number === undefined))
        throw new SuiteError(
          "INVALID_INPUT",
          "Choose exactly one thread_id or course-local number.",
        );
      t =
        a.number !== undefined
          ? await c.fetchCourseThread(course, a.number)
          : await c.fetchThread(required(a.thread_id, "thread_id"));
      requireOwner(t.courseId, course);
      if (
        a.comment_id !== undefined &&
        !contains([...t.answers, ...t.comments], a.comment_id)
      )
        throw new SuiteError(
          "ENTITY_NOT_ALLOWED",
          "This comment is not in the selected thread.",
          403,
        );
    }
    const type = a.type ?? (t?.type === "question" ? "answer" : "comment");
    const plan = {
      target: {
        course_id: course,
        thread_id: t?.id,
        comment_id: a.comment_id,
        user_id: user.id,
      },
      changes: {
        title: a.title,
        body: a.body,
        ed_document: content,
        type: name === "create_thread" ? a.type : type,
        category: a.category,
        anonymous: a.anonymous,
        private: a.private,
      },
      irreversible: true,
      warnings: [
        "Upstream posting has only been verified with mocked Ed responses. The client cannot edit or delete a published post.",
      ],
      state: { thread_title: t?.title },
    };
    const preview = await verifyPlan(ctx, plan);
    if (!execute) return preview;
    const input = { content, anonymous: a.anonymous, private: a.private };
    if (name === "create_thread") {
      const thread = await c.createThread(course, {
        ...input,
        title: required(a.title, "title"),
        category: a.category,
        type: required(a.type, "type"),
      });
      requireOwner(thread.courseId, course);
      return { thread };
    }
    const reply = { ...input, type: type as "answer" | "comment" };
    return {
      comment:
        a.comment_id !== undefined
          ? await c.createCommentReply(a.comment_id, reply)
          : await c.createThreadReply(t!.id, reply),
    };
  }
  if (name === "mark_lessons_read" || name === "mark_slide_read") {
    let ids: number[];
    if (name === "mark_slide_read") ids = [required(a.lesson_id, "lesson_id")];
    else {
      if (a.lesson_ids && (a.queries?.length || a.all))
        throw new SuiteError(
          "INVALID_INPUT",
          "Choose lesson IDs or query/all selection, not both.",
        );
      if (!a.lesson_ids && !a.queries?.length && !a.all)
        throw new SuiteError(
          "INVALID_INPUT",
          "Provide lesson_ids, queries, or all: true.",
        );
      if (a.lesson_ids) ids = a.lesson_ids;
      else {
        const candidates = await listLessons(c, course);
        for (const candidate of candidates)
          requireOwner(candidate.courseId, course);
        ids = candidates
          .filter((l) =>
            (a.queries ?? []).every((q) =>
              `${l.title} ${l.moduleName}`
                .toLowerCase()
                .includes(q.trim().toLowerCase()),
            ),
          )
          .map((l) => l.id);
      }
    }
    const lessons = [];
    for (const id of ids) lessons.push(await lesson(id));
    if (a.lesson_ids && new Set(a.lesson_ids).size !== a.lesson_ids.length)
      throw new SuiteError("INVALID_INPUT", "Choose distinct lesson IDs.");
    const slides = lessons.flatMap((l) =>
      l.slides
        .filter((s) => name === "mark_lessons_read" || s.id === a.slide_id)
        .map((s) => ({
          lesson_id: l.id,
          id: s.id,
          type: s.type,
          action: s.type.toLowerCase() === "quiz" ? "view" : "complete",
        })),
    );
    for (const s of slides) {
      const full = await c.fetchSlide(s.id, { view: false });
      requireOwner(full.courseId, course);
      requireOwner(full.lessonId, s.lesson_id);
    }
    if (!slides.length)
      throw new SuiteError(
        "ENTITY_NOT_ALLOWED",
        "No selected slide belongs to these lessons.",
        403,
      );
    const plan = {
      target: {
        course_id: course,
        user_id: user.id,
        lessons: lessons.map((l) => ({ id: l.id, title: l.title })),
      },
      changes: { slides, delay_seconds: a.delay_seconds ?? 0 },
      irreversible: true,
      warnings: [
        "This changes viewed/completed learning progress. Quiz slides are viewed, never completed without answers.",
      ],
    };
    const preview = await verifyPlan(ctx, plan);
    if (!execute) return preview;
    const receipts: unknown[] = [];
    for (const l of lessons) {
      await c.fetchLesson(l.id, { view: true });
      for (const s of slides.filter((s) => s.lesson_id === l.id)) {
        if (s.action === "view") await c.fetchSlide(s.id, { view: true });
        else await c.completeSlide(s.id);
        if (a.delay_seconds)
          await new Promise((resolve) =>
            setTimeout(resolve, a.delay_seconds! * 1000),
          );
      }
      receipts.push(await c.fetchLesson(l.id, { view: false }));
    }
    return { lessons: receipts };
  }
  const { lesson: l, slide: s } = await slide();
  const questions = await c.fetchSlideQuestions(s.id),
    responses = (await c.fetchSlideQuestionResponses(s.id)).filter(
      (r) => r.userId === user.id,
    );
  const question =
    name === "submit_slide_answer"
      ? questions.find((q) => q.id === a.question_id)
      : undefined;
  if (question) requireOwner(question.slideId, s.id);
  if (name === "submit_slide_answer" && !question)
    throw new SuiteError(
      "ENTITY_NOT_ALLOWED",
      "This question is not in the selected slide.",
      403,
    );
  const choices = a.choices ?? [];
  if (question && !question.multipleSelection && choices.length !== 1)
    throw new SuiteError(
      "INVALID_INPUT",
      "This question accepts exactly one choice.",
    );
  if (
    question &&
    (new Set(choices).size !== choices.length ||
      choices.some((v) => v >= question.answers.length))
  )
    throw new SuiteError(
      "INVALID_INPUT",
      "Choose distinct valid answer indexes.",
    );
  const plan = {
    target: {
      course_id: course,
      lesson_id: l.id,
      slide_id: s.id,
      question_id: question?.id,
      user_id: user.id,
    },
    changes:
      name === "submit_slide_answer"
        ? { choices, amend: a.amend }
        : { submit_saved_responses: true },
    irreversible: true,
    warnings: [
      "This sends the user-provided assessment response and may update completion.",
    ],
    state: { questions, responses },
  };
  const preview = await verifyPlan(ctx, plan);
  if (!execute) return preview;
  if (name === "submit_slide_answer")
    return {
      response: await c.submitSlideAnswer(question!.id, choices, {
        amend: a.amend,
      }),
    };
  if (name === "submit_slide") return { submission: await c.submitSlide(s.id) };
  throw new SuiteError("TOOL_NOT_ALLOWED", "Unknown Ed write.", 403);
}
