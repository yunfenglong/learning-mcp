import type { Tone } from "@bunizao/cli-kit";
export declare const writableTaskStates: readonly ["not_started", "working_on_it", "need_help"];
export type WritableTaskState = (typeof writableTaskStates)[number];
export declare function writableTaskState(value: string): WritableTaskState;
export declare function statusLabel(key: string): string;
export declare function isFinalStatus(key: string): boolean;
export declare function isSubmittedStatus(key: string): boolean;
/**
 * How each status reads to the student: green when the work is in, yellow while it
 * is with them or the tutor, red when something is asked of them or has gone wrong.
 */
export declare const STATUS_TONES: Readonly<Record<string, Tone>>;
