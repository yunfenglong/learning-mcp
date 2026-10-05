import { z } from "zod";
export const unit = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe(
    "User-confirmed course key or unambiguous course code from course_units.",
  );
const id = z.number().int().positive();
const text = z.string().trim().min(1).max(200);
export const pagination = {
  limit: z.number().int().min(1).max(200).default(100),
  offset: z.number().int().min(0).max(100000).default(0),
};
export const edThreadOptions = {
  limit: z.number().int().min(1).max(100).default(100),
  offset: pagination.offset,
  since: text.optional(),
  sort: z.enum(["new", "old", "top", "hot"]).default("new"),
  answered: z.boolean().optional(),
  category: text.optional(),
  subcategory: text.optional(),
  thread_type: text.optional(),
};
export const edLessonOptions = {
  module: text.optional(),
  lesson_type: text.optional(),
  state: text.optional(),
  status: text.optional(),
};
export const moodleGradeOptions = {
  ...pagination,
  mode: z.enum(["summary", "graded", "all"]).default("all"),
  types: z.array(text).max(20).optional(),
  include_feedback: z.boolean().default(true),
  include_ungraded: z.boolean().default(false),
};
export const moodleSearchOptions = {
  limit: z.number().int().min(1).max(200).default(30),
  offset: pagination.offset,
  forum_id: id.optional(),
  titles_only: z.boolean().default(false),
  unread_only: z.boolean().default(false),
  sort: z.enum(["relevance", "recent"]).default("recent"),
  max_forums: z.number().int().min(1).max(50).default(10),
  max_discussions_per_forum: z.number().int().min(1).max(100).default(20),
  include_post_text: z.boolean().default(true),
};
export const taskReference = {
  task_definition_id: id.optional(),
  task: text
    .optional()
    .describe(
      "Exact task abbreviation, such as 1.1; use instead of task_definition_id.",
    ),
};
export const section = z.union([z.number().int().min(0), text]);
export const ED_VIEW_URI = "ui://learning/ed-view.html";
