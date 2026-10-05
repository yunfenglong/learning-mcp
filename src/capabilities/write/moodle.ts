import { z } from "zod";
import { capability, ref, unit, upload, id, body } from "./shared.ts";
export const moodleWriteCapabilities = [
  capability(
    "moodle",
    "submit_assignment",
    "Upload staged files, optionally replace all existing files or finally submit. No draft stage means saving submits for grading; final must then be true. Review group effects and the exact required statement.",
    {
      unit,
      activity_id: ref,
      upload_ids: z.array(upload).max(16).default([]),
      final: z.boolean().default(false),
      replace: z.boolean().default(false),
      accept_statement: z.boolean().default(false),
    },
  ),
  capability(
    "moodle",
    "quiz_start",
    "Start or continue a beta quiz attempt. Starting can consume an attempt and immediately start a timer. Password/SEB requirements must be completed on the platform.",
    { unit, quiz_id: ref },
  ),
  capability(
    "moodle",
    "quiz_page",
    "Open an attempt page (one-based). Advancing a sequential quiz permanently locks the previous page.",
    { unit, quiz_id: ref, attempt_id: id, page: id },
  ),
  capability(
    "moodle",
    "quiz_answer",
    "Save the user-provided answer. Choice values are option letters such as b or a,c; text is submitted verbatim.",
    {
      unit,
      quiz_id: ref,
      attempt_id: id,
      question: z.string().min(1).max(20),
      value: body,
    },
  ),
  capability(
    "moodle",
    "quiz_finish",
    "Submit all saved answers and finish the attempt irreversibly.",
    { unit, quiz_id: ref, attempt_id: id },
  ),
] as const;
