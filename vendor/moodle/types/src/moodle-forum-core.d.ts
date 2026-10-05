import type { Course, ForumActivityRef, ForumDiscussion, ForumDiscussionRef, Section } from "./models.js";
export interface ForumAdapter {
    baseUrl: string;
    call: (functionName: string, args: Record<string, unknown>) => Promise<unknown>;
    getPage: (path: string, params: Record<string, string | number>) => Promise<string>;
    getCourses?: () => Promise<Course[]>;
    getCourseContents?: (courseId: number) => Promise<Section[]>;
}
export declare class ForumModule {
    readonly baseUrl: string;
    private readonly callMoodle;
    private readonly loadPage;
    private readonly loadCourses?;
    private readonly loadCourseContents?;
    private readonly forumDiscussionCache;
    private readonly groupResolved;
    private readonly forumDiscussionRefsCache;
    private readonly forumViewCache;
    constructor(options: ForumAdapter);
    getForumDiscussion(discussionId: number, options?: {
        group?: boolean;
    }): Promise<ForumDiscussion>;
    private resolveGroup;
    getForumViewCmid(discussionId: number): Promise<number | null>;
    getForumDiscussionRefs(forumCmid: number): Promise<ForumDiscussionRef[]>;
    private forumViewHtml;
    isNewsForum(forumCmid: number): Promise<boolean>;
    private getCourseForums;
    getForums(courseId?: number): Promise<ForumActivityRef[]>;
    private courseName;
}
