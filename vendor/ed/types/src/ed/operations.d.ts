import type { EdClient } from "./client.js";
import { type ThreadFilterOptions } from "./filter.js";
import type { Course, Lesson, Thread } from "./models.js";
export type CourseReference = number | string;
export interface ThreadListOptions extends ThreadFilterOptions {
    courseId: CourseReference;
    limit: number;
    offset?: number;
    sort: string;
}
export declare class EdInputError extends Error {
    constructor(message: string);
}
export declare class EdCourseNotFoundError extends EdInputError {
    constructor(message: string);
}
export declare function listThreads(client: EdClient, options: ThreadListOptions): Promise<Thread[]>;
/** Parse a --since / since value into a cutoff, reporting failures as usage errors. */
export declare function parseSinceValue(value: string): Date;
export declare function resolveThread(client: EdClient, reference: string): Promise<Thread>;
/** Ed replies to a question thread default to an answer; other threads take comments. */
export declare function defaultReplyType(threadType: string): "answer" | "comment";
/**
 * Ed accepts a reply under any comment ID, so a mismatched ID would post to another
 * thread while we report the requested one.
 */
export declare function assertCommentInThread(thread: Thread, commentId: number): void;
export interface LessonListOptions {
    lessonType?: string;
    module?: string;
    state?: string;
    status?: string;
}
export declare function listLessons(client: EdClient, courseReference: CourseReference, options?: LessonListOptions): Promise<Lesson[]>;
export declare function listCurrentActivity(client: EdClient, options: {
    courseId?: CourseReference;
    filterType?: string;
    limit: number;
}): Promise<unknown[]>;
export declare function resolveCourseId(client: EdClient, reference: CourseReference): Promise<number>;
export declare function resolveCourse(client: EdClient, reference: CourseReference): Promise<Course>;
export interface LessonReadResult {
    completedSlides: number;
    error?: string;
    id: number;
    partial?: boolean;
    slideCount: number;
    status: string;
    success: boolean;
    title: string;
    viewedSlides: number;
}
export declare function readLessons(client: EdClient, courseId: CourseReference, queries: string[], options?: {
    all?: boolean;
    delaySeconds?: number;
}): Promise<LessonReadResult[]>;
