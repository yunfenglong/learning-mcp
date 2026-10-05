import { z } from "zod";
import { capability, id, unit, body, edThread } from "./shared.ts";
export const edWriteCapabilities = [
  capability(
    "ed",
    "create_thread",
    "Publish Markdown under your own account; upstream posting is only mock-validated.",
    {
      unit,
      title: z.string().min(1).max(300),
      body,
      type: z.enum(["question", "post", "announcement"]).default("question"),
      category: z.string().max(200).default(""),
      anonymous: z.boolean().default(false),
      private: z.boolean().default(false),
    },
  ),
  capability(
    "ed",
    "reply_thread",
    "Reply to a thread or nested comment. Question replies default to answers; others default to comments.",
    edThread,
  ),
  capability(
    "ed",
    "mark_lessons_read",
    "Mark explicitly selected lessons/slides viewed; complete non-quiz slides. Does not answer quizzes.",
    { unit, lesson_ids: z.array(id).min(1).max(50) },
  ),
  capability(
    "ed",
    "mark_slide_read",
    "Mark one slide viewed; complete it only when it is not a quiz.",
    { unit, lesson_id: id, slide_id: id },
  ),
  capability(
    "ed",
    "submit_slide_answer",
    "Save the user-provided choices (zero-based indexes); amend an existing response when requested. May update completion.",
    {
      unit,
      lesson_id: id,
      slide_id: id,
      question_id: id,
      choices: z.array(z.number().int().min(0)).min(1).max(100),
      amend: z.boolean().default(false),
    },
  ),
  capability(
    "ed",
    "submit_slide",
    "Submit the current user’s saved slide answers.",
    { unit, lesson_id: id, slide_id: id },
  ),
] as const;
