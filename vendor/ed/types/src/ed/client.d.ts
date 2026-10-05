import type { Comment, Lesson, LessonModule, LessonQuestion, LessonQuestionResponse, LessonSlide, Thread, UserWithCourses } from "./models.js";
export declare class EdApiError extends Error {
    readonly kind: "api" | "auth_expired" | "base_url" | "network" | "upstream";
    readonly statusCode: number;
    constructor(kind: "api" | "auth_expired" | "base_url" | "network" | "upstream", statusCode: number, message: string);
}
export declare class EdAuthExpiredError extends EdApiError {
    constructor(statusCode: number, message: string);
}
export interface SlideAnswerResult {
    correct: boolean | null;
    explanation: unknown;
    slideCompleted: boolean;
    solution: unknown;
}
export interface SlideSubmitResult {
    submitted: boolean;
}
export interface ThreadCreateInput {
    anonymous?: boolean;
    category?: string;
    /** Ed document XML, as produced by markdownToEdDocument. */
    content: string;
    private?: boolean;
    title: string;
    type: string;
}
export interface CommentCreateInput {
    anonymous?: boolean;
    /** Ed document XML, as produced by markdownToEdDocument. */
    content: string;
    private?: boolean;
    type: "answer" | "comment";
}
export interface EdClientOptions {
    apiBaseUrl?: string;
    fetch?: FetchLike;
    maxRetries?: number;
    retryBaseDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
    token: string;
    timeoutMs?: number;
    /** Called once per request. The URL never carries the token, which is a header. */
    trace?: (entry: {
        method: string;
        url: string;
        status: number;
        ms: number;
    }) => void;
}
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export declare class EdClient {
    private cachedUser?;
    private readonly apiBaseUrl;
    private readonly fetch;
    private readonly maxRetries;
    private readonly retryBaseDelayMs;
    private readonly sleep;
    private readonly token;
    private readonly timeoutMs;
    private readonly trace;
    constructor(options: EdClientOptions);
    fetchCourseThread(courseId: number, number: number): Promise<Thread>;
    fetchLesson(lessonId: number, options?: {
        view?: boolean;
    }): Promise<Lesson>;
    fetchSlide(slideId: number, options?: {
        view?: boolean;
    }): Promise<LessonSlide>;
    fetchFile(url: string): Promise<Response>;
    createThread(courseId: number, input: ThreadCreateInput): Promise<Thread>;
    createThreadReply(threadId: number, input: CommentCreateInput): Promise<Comment>;
    createCommentReply(commentId: number, input: CommentCreateInput): Promise<Comment>;
    completeSlide(slideId: number): Promise<void>;
    fetchLessons(courseId: number): Promise<{
        lessons: Lesson[];
        modules: LessonModule[];
    }>;
    fetchSlideQuestionResponses(slideId: number): Promise<LessonQuestionResponse[]>;
    fetchSlideQuestions(slideId: number): Promise<LessonQuestion[]>;
    fetchThread(threadId: number): Promise<Thread>;
    fetchThreads(courseId: number, options?: {
        limit?: number;
        offset?: number;
        sort?: string;
    }): Promise<Thread[]>;
    fetchUser(): Promise<UserWithCourses>;
    fetchUserActivity(userId: number, options?: {
        courseId?: number;
        filterType?: string;
        limit?: number;
        offset?: number;
    }): Promise<unknown[]>;
    submitSlide(slideId: number): Promise<SlideSubmitResult>;
    submitSlideAnswer(questionId: number, choices: number[], options?: {
        amend?: boolean;
    }): Promise<SlideAnswerResult>;
    private requestUser;
    private createComment;
    private get;
    private post;
    private request;
    private send;
}
export declare function isDownloadableLessonFileUrl(value: string | URL): boolean;
