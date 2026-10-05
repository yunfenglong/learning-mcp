import type { QuizAttemptReview } from "./models.js";
export interface QuizDeps {
    baseUrl: string;
    request(url: string, init?: RequestInit, options?: {
        allowErrorStatus?: boolean;
    }): Promise<Response>;
    /** Moodle refused or mangled a step; the message is shown to the user as-is. */
    fail(message: string, moodleErrorCode?: string): Error;
    /** The request cannot succeed as given; the caller can change it. */
    usage(message: string, hint?: string): Error;
}
export type QuestionKind = "choice" | "multi" | "text" | "info" | "unsupported";
export interface AttemptOption {
    /** Letter shown to the user: a, b, c... */
    key: string;
    /** The input this option belongs to; boxes of a multiple choice each have their own. */
    field: string;
    /** The value Moodle stores for that input. */
    value: string;
    text: string;
    chosen: boolean;
}
export interface AttemptQuestion {
    slot: number;
    /** Moodle's display number; "i" for an information block. */
    number: string;
    type: string;
    kind: QuestionKind;
    state: string;
    text: string;
    /** The input a written or single-choice answer is posted to. */
    field?: string;
    options?: AttemptOption[];
    /** Current free-text answer, when the question takes one. */
    answer?: string;
}
export interface AttemptNavEntry {
    slot: number;
    number: string;
    page: number;
    state: string;
}
export interface AttemptPage {
    attempt: number;
    quiz_id: number;
    name: string;
    /** "sequential" quizzes move forward only: opening the next page locks the current one for good. */
    navigation_method: "free" | "sequential";
    page: number;
    pages: number;
    questions: AttemptQuestion[];
    navigation: AttemptNavEntry[];
    url: string;
}
export interface AttemptSummary {
    attempt: number;
    quiz_id: number;
    name: string;
    rows: Array<{
        number: string;
        state: string;
        page: number;
    }>;
    url: string;
}
export interface AttemptFinishReceipt {
    attempt: number;
    quiz_id: number;
    name: string;
    /** Question states as the summary listed them just before finishing. */
    summary: AttemptSummary["rows"];
    review?: QuizAttemptReview;
    /** Attempt row from the quiz page when the site withholds the review. */
    result?: {
        status: string;
        marks: string;
        grade: string;
        completed: string;
    };
    url: string;
}
type Field = [string, string];
/** What starting would do, read from the quiz page before anything is sent. */
export interface QuizStartPlan {
    quiz_id: number;
    name: string;
    /** Moodle continues an attempt in progress rather than starting another. */
    action: "start" | "continue";
    time_limit: string;
    attempts_allowed: string;
    attempts_used: number;
    grading_method: string;
    url: string;
}
export interface StartOptions {
    /** Asked once when the quiz has an access password; null means the person declined. */
    password?: () => Promise<string | null>;
}
/**
 * Reads what starting would mean, so the person agrees to a time limit or a last attempt
 * before the CLI clicks through Moodle's own pre-flight form. Sends nothing.
 */
export declare function planQuizStart(deps: QuizDeps, quizId: number): Promise<QuizStartPlan>;
export declare function startQuizAttempt(deps: QuizDeps, quizId: number, options?: StartOptions): Promise<AttemptPage>;
/**
 * Shows one page of an attempt; without a page, the one the attempt is on. In a sequential
 * quiz, opening the next page locks the current one for good, so that happens only when
 * the caller says `advance`, after the person agreed; any other page is refused.
 */
export declare function getAttemptPage(deps: QuizDeps, attemptId: number, quizId: number, page?: number, options?: {
    advance?: boolean;
}): Promise<AttemptPage>;
export interface AnswerRequest {
    attemptId: number;
    quizId: number;
    /** Display number of the question, as `moodle quiz show` lists it. */
    question: string;
    /** Option letters ("b", "a,c") for choice questions; the response text otherwise. */
    value: string;
}
/** Saves one answer and returns the page it lives on, re-read after the save. */
export declare function answerQuizQuestion(deps: QuizDeps, request: AnswerRequest): Promise<AttemptPage>;
export declare function getAttemptSummary(deps: QuizDeps, attemptId: number, quizId: number): Promise<AttemptSummary>;
/** Submits every saved answer for grading. Moodle treats this as final. */
export declare function finishQuizAttempt(deps: QuizDeps, attemptId: number, quizId: number): Promise<AttemptFinishReceipt>;
interface ParsedForm {
    action: string;
    fields: Field[];
}
interface ParsedAttemptPage extends AttemptPage {
    form: ParsedForm;
}
export declare function parseAttemptPage(html: string, url: string, deps: Pick<QuizDeps, "baseUrl" | "fail">): ParsedAttemptPage;
export declare function noticesOf(html: string): string;
export {};
