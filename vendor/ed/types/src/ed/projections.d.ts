import type { Comment, Course, Lesson, LessonModule, LessonQuestion, LessonQuestionResponse, LessonSlide, Thread, User, UserWithCourses } from "./models.js";
export type JsonObject = Record<string, unknown>;
export declare function projectIdentity(identity: UserWithCourses): JsonObject;
export declare function projectUser(user: User, includePrivate?: boolean): JsonObject;
export declare function projectCourse(course: Course): JsonObject;
export declare function projectModule(module: LessonModule, lessonCount: number): JsonObject;
export declare function projectLessonSummary(lesson: Lesson): JsonObject;
export declare function projectLessonDetail(lesson: Lesson): JsonObject;
export declare function projectSlide(slide: LessonSlide, options?: {
    omitParents?: boolean;
}): JsonObject;
export declare function projectQuestion(question: LessonQuestion): JsonObject;
export declare function projectQuestionResponse(response: LessonQuestionResponse): JsonObject;
export declare function projectThreadSummary(thread: Thread): JsonObject;
export declare function projectThreadDetail(thread: Thread, options?: {
    includeHtml?: boolean;
}): JsonObject;
/**
 * Activity items arrive as raw Ed payloads, so they are projected like everything
 * else rather than passed through: the key names here are the CLI's, not whatever
 * the upstream API happens to send, and the two item shapes are flattened into one.
 */
export declare function projectActivity(items: unknown[]): JsonObject[];
export declare function projectComment(comment: Comment, options?: {
    includeHtml?: boolean;
}): JsonObject;
