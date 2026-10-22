import type { ForumDiscussion } from "./models.js";
import type { SubmitFile } from "./moodle-assign-core.js";
export interface ForumWriteDeps {
    baseUrl: string;
    request(url: string, init?: RequestInit, options?: {
        allowErrorStatus?: boolean;
    }): Promise<Response>;
    call(name: string, args: Record<string, unknown>): Promise<unknown>;
    getDiscussion(discussionId: number): Promise<ForumDiscussion>;
    fail(message: string): Error;
    usage(message: string): Error;
}
export interface ForumPostReceipt {
    id: number;
    discussion_id: number;
    parent_id: number;
    url: string;
}
export declare function replyForumPost(deps: ForumWriteDeps, postId: number, text: string, files?: SubmitFile[]): Promise<ForumPostReceipt>;
export declare function createForumDiscussion(deps: ForumWriteDeps, forumCmid: number, subject: string, text: string): Promise<ForumPostReceipt>;
export declare function setForumSubscription(deps: ForumWriteDeps, forumCmid: number, subscribed: boolean): Promise<{
    forum_id: number;
    subscribed: boolean;
}>;
