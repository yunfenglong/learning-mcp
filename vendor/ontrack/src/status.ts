import type { Tone } from "@bunizao/cli-kit";

import { CliError } from "./errors.js";

interface StatusMetadata {
  readonly label: string;
  readonly final: boolean;
  readonly submitted: boolean;
}

const statuses = {
  ready_for_feedback: { label: "Ready for Feedback", final: false, submitted: true },
  not_started: { label: "Not Started", final: false, submitted: false },
  working_on_it: { label: "Working On It", final: false, submitted: false },
  need_help: { label: "Need Help", final: false, submitted: false },
  redo: { label: "Redo", final: false, submitted: false },
  feedback_exceeded: { label: "Feedback Exceeded", final: true, submitted: true },
  fix_and_resubmit: { label: "Resubmit", final: false, submitted: false },
  discuss: { label: "Discuss", final: false, submitted: true },
  demonstrate: { label: "Demonstrate", final: false, submitted: true },
  complete: { label: "Complete", final: true, submitted: true },
  fail: { label: "Fail", final: true, submitted: true },
  time_exceeded: { label: "Time Exceeded", final: true, submitted: true },
  assess_in_portfolio: { label: "Assess in Portfolio", final: true, submitted: true },
  attention_required: { label: "Attention Required", final: false, submitted: true },
  rediscuss: { label: "Rediscuss", final: false, submitted: true },
} as const satisfies Record<string, StatusMetadata>;

export const writableTaskStates = ["not_started", "working_on_it", "need_help"] as const;
export type WritableTaskState = (typeof writableTaskStates)[number];

export function writableTaskState(value: string): WritableTaskState {
  if (!writableTaskStates.includes(value as WritableTaskState)) {
    throw new CliError("usage", `state must be one of: ${writableTaskStates.join(", ")}`);
  }
  return value as WritableTaskState;
}

function metadata(key: string): StatusMetadata | undefined {
  return (statuses as Record<string, StatusMetadata>)[key];
}

export function statusLabel(key: string): string {
  return metadata(key)?.label ?? key;
}

export function isFinalStatus(key: string): boolean {
  return metadata(key)?.final ?? false;
}

export function isSubmittedStatus(key: string): boolean {
  return metadata(key)?.submitted ?? false;
}

/**
 * How each status reads to the student: green when the work is in, yellow while it
 * is with them or the tutor, red when something is asked of them or has gone wrong.
 */
export const STATUS_TONES: Readonly<Record<string, Tone>> = {
  "Ready for Feedback": "success",
  "Not Started": "muted",
  "Working On It": "warning",
  "Need Help": "danger",
  "Redo": "danger",
  "Feedback Exceeded": "danger",
  "Resubmit": "danger",
  "Discuss": "warning",
  "Demonstrate": "warning",
  "Complete": "success",
  "Fail": "danger",
  "Time Exceeded": "danger",
  "Assess in Portfolio": "info",
  "Attention Required": "danger",
  "Rediscuss": "warning",
  ...Object.fromEntries(Object.entries({
    ready_for_feedback: "success", not_started: "muted", working_on_it: "warning", need_help: "danger", redo: "danger",
    feedback_exceeded: "danger", fix_and_resubmit: "danger", discuss: "warning", demonstrate: "warning", complete: "success",
    fail: "danger", time_exceeded: "danger", assess_in_portfolio: "info", attention_required: "danger", rediscuss: "warning",
  } as const)),
};
