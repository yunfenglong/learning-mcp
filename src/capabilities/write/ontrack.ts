import { z } from "zod";
import { capability, ref, unit, upload, body } from "./shared.ts";
export const ontrackWriteCapabilities = [
  capability(
    "ontrack",
    "chat_history",
    "Read task chat history; the upstream GET marks non-discussion comments read.",
    { unit, task: ref },
  ),
  capability(
    "ontrack",
    "mark_chat_read",
    "Use the chat-history GET to mark non-discussion comments read.",
    { unit, task: ref },
  ),
  capability(
    "ontrack",
    "send_chat",
    "Send a task chat message under the connected account.",
    { unit, task: ref, message: body },
  ),
  capability("ontrack", "set_task_state", "Change this task’s working state.", {
    unit,
    task: ref,
    state: z.enum(["not_started", "working_on_it", "need_help"]),
  }),
  capability(
    "ontrack",
    "submit_task",
    "Submit staged files in the task’s upload-requirement order; review submission type, comment and Turnitin acceptance.",
    {
      unit,
      task: ref,
      upload_ids: z.array(upload).max(16),
      type: z
        .enum(["ready_for_feedback", "need_help", "assess_in_portfolio"])
        .default("ready_for_feedback"),
      comment: z.string().max(10000).optional(),
      accept_tii_eula: z.boolean().default(false),
    },
  ),
] as const;
