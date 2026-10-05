export interface SubmitFile {
    name: string;
    bytes: Uint8Array;
    path?: string;
}
export interface SubmitAssignmentRequest {
    activityId: number;
    files: SubmitFile[];
    /** Also submit for grading after saving. Moodle treats that as irreversible. */
    final?: boolean;
    /** Remove every file already in the submission before uploading. */
    replace?: boolean;
    /** Tick the site's submission statement when Moodle requires one. */
    acceptStatement?: boolean;
    /** Load and validate everything, but send nothing that changes state. */
    dryRun?: boolean;
    /** Each slow step, in words a person can watch: which file is uploading, when the form is saved. */
    onProgress?: (message: string) => void;
}
export interface SubmissionFileRow {
    name: string;
    bytes?: number;
    url?: string;
}
export interface SubmissionLimits {
    max_bytes?: number;
    max_files?: number;
    area_max_bytes?: number;
    accepted_types?: string[];
}
export interface SubmissionReceipt {
    id: number;
    name: string;
    unit_id?: number;
    url: string;
    action: "planned" | "saved" | "submitted";
    /** False when saving submits for grading at once; absent when Moodle's pages do not show it. */
    draft_stage?: boolean;
    /** The group sharing this submission; absent when it is an individual one. */
    group?: string;
    /** Group members Moodle still waits for before the group's submission counts as submitted. */
    awaiting?: string[];
    submission_status: string;
    grading_status: string;
    due: string;
    time_remaining: string;
    last_modified: string;
    statement?: string;
    statement_accepted?: boolean;
    /** Files Moodle lists in the submission (draft area for a plan, view page after a write). */
    files: SubmissionFileRow[];
    uploads: Array<{
        name: string;
        bytes: number;
        path?: string;
    }>;
    removed: string[];
    limits: SubmissionLimits;
    checked_at: string;
}
export interface AssignSubmitDeps {
    baseUrl: string;
    request(url: string, init?: RequestInit, options?: {
        allowErrorStatus?: boolean;
    }): Promise<Response>;
    /** Moodle refused or mangled a step; message is shown to the user as-is. */
    fail(message: string, moodleErrorCode?: string): Error;
    /** The request cannot succeed as given; the caller can change it. */
    usage(message: string, hint?: string): Error;
    now?: () => Date;
}
type Field = [string, string];
export interface SubmissionForm {
    action: string;
    fields: Field[];
    sesskey: string;
    itemid: string;
    clientId: string;
    contextId: string;
    repoId: string;
    author: string;
    license: string;
    maxBytes: number;
    areaMaxBytes: number;
    maxFiles: number;
    acceptedTypes: string[] | "*";
    statement?: string;
}
export interface ConfirmForm {
    action: string;
    fields: Field[];
    statement?: string;
}
export declare function submitAssignmentFiles(deps: AssignSubmitDeps, request: SubmitAssignmentRequest): Promise<SubmissionReceipt>;
/**
 * A receipt that went through the intent layer has lost its empty lists and objects to
 * stripEmpty. Callers that render it need them back; a first submission has no files
 * and removes nothing, so this is the ordinary case, not an edge.
 */
export declare function submissionReceiptOf(value: unknown): SubmissionReceipt;
export declare function parseSubmissionForm(html: string, deps: Pick<AssignSubmitDeps, "baseUrl" | "fail">): SubmissionForm;
export declare function parseConfirmForm(html: string, deps: Pick<AssignSubmitDeps, "baseUrl" | "fail">): ConfirmForm;
export declare function parseReceiptPage(html: string, activityId: number, baseUrl: string): Omit<SubmissionReceipt, "action" | "uploads" | "removed" | "limits" | "checked_at">;
/**
 * Whether saving keeps a draft: the assignment's "require students to click the submit
 * button" setting. No page states it, but Moodle's rendering gives it away:
 * - the edit form carries the submission statement only when there is no draft stage;
 * - so a statement on the confirm page but not on the edit form means there is one;
 * - "Submit assignment" on the view page is only offered when there is one;
 * - a submitted submission that can still be edited means there is none, because Moodle
 *   locks a submitted submission when there is a draft stage.
 * Anything else is unknown.
 */
export declare function draftStageOf(viewHtml: string, status: string, form: Pick<SubmissionForm, "statement">, confirmHtml?: string): boolean | undefined;
/** Alerts and validation messages on a Moodle page, joined for an error message. */
export declare function noticesOf(html: string): string;
export {};
