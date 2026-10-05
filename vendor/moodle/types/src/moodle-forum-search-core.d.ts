import type { ForumDiscussion, ForumDiscussionRef, ForumSearchHit } from "./models.js";
export interface ForumSearchSource {
    getForums(courseId?: number): Promise<Array<{
        id: number;
        name: string;
        course_id: number;
        course_name: string;
        url: string;
    }>>;
    getForumDiscussionRefs(forumCmid: number): Promise<ForumDiscussionRef[]>;
    getForumDiscussion(discussionId: number): Promise<ForumDiscussion>;
}
export interface ForumSearchOptions {
    limit?: number;
    courseId?: number;
    forumCmid?: number;
    includePostText?: boolean;
    titlesOnly?: boolean;
    unreadOnly?: boolean;
    sortBy?: "relevance" | "recent";
    maxForums?: number;
    maxDiscussionsPerForum?: number;
    baseUrl?: string;
}
export declare function searchForumContent(source: ForumSearchSource, query: string, options?: ForumSearchOptions): Promise<ForumSearchHit[]>;
export declare function normalizeQuery(value: string): {
    normalized: string;
    tokens: string[];
};
export declare function matchScore(text: string, query: string): number;
export declare function snippetForText(text: string, query: string, maxLen?: number): string;
