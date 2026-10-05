import { z } from "zod";
import { defineRead, definePlatformRead } from "./definition.ts";
import { resolveUnit } from "../domain/units.ts";

import {
  unit,
  pagination,
  edThreadOptions,
  edLessonOptions,
  ED_VIEW_URI,
} from "./schemas.ts";
const id = z.number().int().positive();
const text = z.string().trim().min(1).max(200);

const viewMeta = {
  ui: { resourceUri: ED_VIEW_URI },
  "ui/resourceUri": ED_VIEW_URI,
};
export const edCapabilities = [
  definePlatformRead(
    "ed_user",
    "Read the authenticated platform identity without credentials.",
    {},
    "ed",
    "get_user",
    "account",
  ),
  definePlatformRead(
    "ed_courses",
    "Discover verified platform enrollments without creating course associations.",
    { ...pagination, include_archived: z.boolean().default(false) },
    "ed",
    "courses",
    "account",
  ),
  defineRead(
    "ed_lessons",
    "List Ed lessons within one configured course.",
    { unit, ...edLessonOptions },
    "ed",
    "list_lessons",
    async (args, { config, adapters }) => ({
      lessons: await adapters.ed.lessons(
        resolveUnit(config.units, args.unit),
        args,
      ),
    }),
  ),
  defineRead(
    "ed_lesson",
    "Read an Ed lesson after checking its course ownership.",
    { unit, lesson_id: id },
    "ed",
    "get_lesson",
    async (args, { config, adapters }) =>
      adapters.ed.lesson(resolveUnit(config.units, args.unit), args.lesson_id),
  ),
  defineRead(
    "ed_threads",
    "Read up to 100 recent Ed thread summaries for a linked course.",
    { unit, ...edThreadOptions },
    "ed",
    "list_threads",
    async (args, { config, adapters }) => ({
      threads: await adapters.ed.threads(
        resolveUnit(config.units, args.unit),
        args,
      ),
      coverage: "bounded",
      limit: args.limit,
      offset: args.offset,
      reason:
        "Filtered listings scan at most ten upstream pages; offset skips the unfiltered Ed stream.",
    }),
  ),
  defineRead(
    "ed_thread",
    "Read an Ed thread after checking its course ownership.",
    { unit, thread_id: id, include_html: z.boolean().default(true) },
    "ed",
    "get_thread",
    async (args, { config, adapters }) =>
      adapters.ed.thread(
        resolveUnit(config.units, args.unit),
        args.thread_id,
        args.include_html,
      ),
  ),
  definePlatformRead(
    "ed_course",
    "Read platform metadata for one linked Ed course.",
    { unit },
    "ed",
    "course",
    "course",
  ),
  definePlatformRead(
    "ed_search_threads",
    "Search Ed title/body with all query words and filters. Upstream searches are bounded to ten pages; offset skips the unfiltered stream.",
    { unit, query: text, ...edThreadOptions },
    "ed",
    "search_threads",
    "course",
  ),
  definePlatformRead(
    "ed_course_thread",
    "Read a course-local thread number such as #42 after verifying course ownership.",
    { unit, number: id, include_html: z.boolean().default(true) },
    "ed",
    "get_course_thread",
    "course",
  ),
  definePlatformRead(
    "ed_activity",
    "Read only the signed-in user's posts, answers and comments for a linked course.",
    {
      unit,
      filter_type: z
        .enum(["all", "thread", "answer", "comment"])
        .default("all"),
      limit: z.number().int().min(1).max(50).default(30),
      offset: pagination.offset,
    },
    "ed",
    "list_activity",
    "course",
  ),
  definePlatformRead(
    "ed_modules",
    "List Ed lesson modules and their lesson counts.",
    { unit },
    "ed",
    "list_modules",
    "course",
  ),
  definePlatformRead(
    "ed_lesson_files",
    "List lesson files, PDF slides and content attachments with stable file indexes. Does not download files or mark progress.",
    { unit, lesson_id: id, slide_id: id.optional() },
    "ed",
    "list_lesson_files",
    "course",
  ),
  definePlatformRead(
    "ed_thread_files",
    "List attachments from the thread, answers and nested comments.",
    { unit, thread_id: id },
    "ed",
    "list_thread_files",
    "course",
  ),
  definePlatformRead(
    "ed_file",
    "Return a real file as an embedded MCP binary resource from a freshly verified lesson or thread attachment; 16 MiB maximum. Exact resource origins must be operator-configured.",
    {
      unit,
      lesson_id: id.optional(),
      thread_id: id.optional(),
      slide_id: id.optional(),
      file_index: z.number().int().min(0).max(10000).default(0),
    },
    "ed",
    "file",
    "course",
  ),
  definePlatformRead(
    "ed_read_thread",
    "Render an owned Ed thread and nested replies as upstream Markdown.",
    { unit, thread_id: id.optional(), number: id.optional() },
    "ed",
    "read_thread",
    "course",
  ),
  definePlatformRead(
    "ed_read_lesson",
    "Render a lesson and its slides as upstream Markdown without changing progress.",
    { unit, lesson_id: id },
    "ed",
    "read_lesson",
    "course",
  ),
  definePlatformRead(
    "ed_show_forum_catchup",
    "Interactive unread announcements and new discussions; falls back to text and structured data. Bounded to ten upstream pages.",
    { unit, days: z.number().int().min(1).max(365).default(14) },
    "ed",
    "show_forum_catchup",
    "course",
    viewMeta,
  ),
  definePlatformRead(
    "ed_show_thread_activity",
    "Interactive weekly discussion counts, excluding pinned announcements; bounded to ten upstream pages.",
    { unit, weeks: z.number().int().min(1).max(52).default(12) },
    "ed",
    "show_thread_activity",
    "course",
    viewMeta,
  ),
  definePlatformRead(
    "ed_show_lesson_progress",
    "Interactive released-module lesson completion and unfinished lessons. Reads existing progress only.",
    { unit },
    "ed",
    "show_lesson_progress",
    "course",
    viewMeta,
  ),
  definePlatformRead(
    "ed_show_lesson_guide",
    "Show a client-authored study guide and local practice questions for an owned lesson. Read the lesson first. Never copy, answer or hint at assessed Ed quiz questions. Practice stays inside the widget and is never sent to Ed.",
    {
      unit,
      lesson_id: id,
      sections: z
        .array(
          z
            .object({
              title: text.max(80),
              points: z.array(text.max(300)).min(1).max(5),
            })
            .strict(),
        )
        .min(1)
        .max(8),
      quiz: z
        .array(
          z
            .object({
              question: z.string().trim().min(1).max(400),
              options: z.array(text).min(2).max(5),
              answer: z.number().int().min(0).max(4),
              section: z.number().int().min(0).max(7),
              why: z.string().trim().min(1).max(300),
            })
            .strict(),
        )
        .max(8)
        .default([]),
    },
    "ed",
    "show_lesson_guide",
    "course",
    viewMeta,
  ),
  definePlatformRead(
    "ed_slide",
    "Read a slide, questions or own saved responses after verifying lesson and course ownership. Does not mark viewed or submit.",
    { unit, lesson_id: id, slide_id: id },
    "ed",
    "get_slide",
    "course",
  ),
  definePlatformRead(
    "ed_read_slide",
    "Read a slide, questions or own saved responses after verifying lesson and course ownership. Does not mark viewed or submit.",
    { unit, lesson_id: id, slide_id: id },
    "ed",
    "read_slide",
    "course",
  ),
  definePlatformRead(
    "ed_slide_questions",
    "Read a slide, questions or own saved responses after verifying lesson and course ownership. Does not mark viewed or submit.",
    { unit, lesson_id: id, slide_id: id },
    "ed",
    "list_slide_questions",
    "course",
  ),
  definePlatformRead(
    "ed_slide_responses",
    "Read a slide, questions or own saved responses after verifying lesson and course ownership. Does not mark viewed or submit.",
    { unit, lesson_id: id, slide_id: id },
    "ed",
    "list_slide_responses",
    "course",
  ),
] as const;
