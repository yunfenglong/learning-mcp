import { type SubmissionReceipt, type SubmitAssignmentRequest } from "./moodle-assign-core.js";
import { type AnswerRequest, type AttemptFinishReceipt, type AttemptPage, type AttemptSummary, type QuizStartPlan, type StartOptions } from "./moodle-quiz-core.js";
import type { AlertSummary, ActivityDetail, Assignment, Course, CourseGrades, Folder, ForumActivityRef, ForumDiscussion, ForumDiscussionRef, ForumSearchHit, Link, Overview, Page, PageContext, Quiz, QuizAttemptReview, Resource, Section, TodoItem, UserInfo } from "./models.js";
export interface AjaxCall {
    methodname: string;
    args?: Record<string, unknown>;
}
export type AjaxBatchResult = {
    ok: true;
    data: unknown;
} | {
    ok: false;
    error: MoodleApiErrorLike;
};
type OptionalAjaxBatchResult = AjaxBatchResult | undefined;
export interface MoodleApiErrorLike extends Error {
    readonly code: string;
    readonly hint?: string;
    readonly moodleErrorCode?: string;
}
export interface MoodleClientErrorAdapter {
    api(message: string, moodleErrorCode?: string): MoodleApiErrorLike;
    notFound(message: string): Error;
    /** The caller asked for something the site cannot do as given; defaults to a usage-coded core error. */
    usage?(message: string, hint?: string): Error;
    isApi(error: unknown): error is MoodleApiErrorLike;
    isLoginRequired(error: unknown): boolean;
}
export declare class MoodleClientCoreError extends Error {
    readonly code: string;
    readonly hint?: string;
    constructor(code: string, message: string, hint?: string);
}
export declare class MoodleClientCoreApiError extends MoodleClientCoreError implements MoodleApiErrorLike {
    readonly moodleErrorCode?: string;
    constructor(message: string, moodleErrorCode?: string);
}
export interface MoodleSessionCookie {
    source?: string;
    name: string;
    value: string;
}
export interface MoodleClientSessionSnapshot {
    baseUrl: string;
    cookieSource?: string;
    cookieName: string;
    cookieValue: string;
    sesskey: string;
    userid: number;
    unavailable?: string[];
    user?: UserInfo;
}
export interface MoodleClientCoreOptions {
    fetchImpl?: typeof fetch;
    cookie: MoodleSessionCookie;
    pageContext?: PageContext;
    sesskey?: string;
    userid?: number;
    userInfo?: UserInfo;
    unavailable?: string[];
    errorAdapter?: MoodleClientErrorAdapter;
    clearSessionCache?: () => Promise<void>;
    writeSessionCache?: (session: MoodleClientSessionSnapshot) => Promise<void>;
    onLoginRequired?: () => Promise<{
        cookie: MoodleSessionCookie;
        pageContext: PageContext;
    }>;
}
export declare class MoodleClientCore {
    readonly baseUrl: string;
    private coursesCache?;
    private readonly contentsCache;
    private readonly unavailable;
    private readonly unavailableListeners;
    private fetchImpl;
    private cookie;
    private sesskey;
    private userid;
    private userInfo;
    private clearSessionCache?;
    private writeSessionCache?;
    private readonly errors;
    private onLoginRequired?;
    private authGeneration;
    private reauthInFlight?;
    private readonly forum;
    private labels?;
    constructor(baseUrl: string, options: MoodleClientCoreOptions | string);
    getSiteInfo(): Promise<UserInfo>;
    getCourses(): Promise<Course[]>;
    private fetchCourses;
    resolveCourseReference(value: string): Promise<number>;
    getCourseContents(courseId: number): Promise<Section[]>;
    private fetchCourseContents;
    getActivities(courseId: number): Promise<Section["activities"]>;
    getActivity(id: number): Promise<ActivityDetail & {
        type: string;
    }>;
    private readActivity;
    private redirectedActivity;
    getTodo(limit?: number, days?: number, courseId?: number): Promise<TodoItem[]>;
    private readActionEvents;
    getAlerts(limit?: number): Promise<AlertSummary>;
    getOverview(todoLimit?: number, todoDays?: number, alertsLimit?: number): Promise<Overview>;
    getCourseGrades(courseId: number): Promise<CourseGrades>;
    getAssignment(id: number): Promise<Assignment>;
    getQuiz(id: number): Promise<Quiz>;
    /**
     * The site's own text for the labels the page readers look for, in the session's
     * language and with any strings the site customised. One call per client; a site that
     * refuses it leaves the readers on the English labels. A request that failed before
     * Moodle answered reads this page in English and asks again for the next one, so one
     * dropped request does not fix a long-lived client on English.
     */
    private siteLabels;
    getQuizAttempt(attemptId: number): Promise<QuizAttemptReview>;
    getResource(id: number): Promise<Resource>;
    getLink(id: number): Promise<Link>;
    getPage(id: number): Promise<Page>;
    getFolder(id: number): Promise<Folder>;
    private getActivityPage;
    private assertActivityPage;
    requestAbsolute(url: string, init?: RequestInit, options?: {
        allowErrorStatus?: boolean;
    }): Promise<Response>;
    /** Uploads files into an assignment and reads the receipt back from the site. */
    submitAssignment(request: SubmitAssignmentRequest): Promise<SubmissionReceipt>;
    /** Starts a new attempt, or resumes the one already in progress, and returns its first page. */
    planQuizStart(quizId: number): Promise<QuizStartPlan>;
    startQuizAttempt(quizId: number, options?: StartOptions): Promise<AttemptPage>;
    getQuizAttemptPage(attemptId: number, quizId: number, page?: number, options?: {
        advance?: boolean;
    }): Promise<AttemptPage>;
    getQuizAttemptSummary(attemptId: number, quizId: number): Promise<AttemptSummary>;
    answerQuizQuestion(request: AnswerRequest): Promise<AttemptPage>;
    /** Submits the attempt for grading. Moodle treats this as final. */
    finishQuizAttempt(attemptId: number, quizId: number): Promise<AttemptFinishReceipt>;
    private quizDeps;
    getNewsForums(courseId?: number): Promise<ForumActivityRef[]>;
    getForumDiscussion(discussionId: number, options?: {
        group?: boolean;
    }): Promise<ForumDiscussion>;
    getForumViewCmid(discussionId: number): Promise<number | null>;
    resolveCourseIdForUrl(url: string): Promise<number | null>;
    getForumDiscussionRefs(forumCmid: number): Promise<ForumDiscussionRef[]>;
    getForums(courseId?: number): Promise<ForumActivityRef[]>;
    searchForumContent(options: {
        query: string;
        limit?: number;
        courseId?: number;
        forumCmid?: number;
        includePostText?: boolean;
        titlesOnly?: boolean;
        unreadOnly?: boolean;
        sortBy?: "relevance" | "recent";
        maxForums?: number;
        maxDiscussionsPerForum?: number;
    }): Promise<ForumSearchHit[]>;
    /**
     * Hears every call the site refuses as disabled, whether it says so now or said so
     * earlier, so a caller can tell which fallback a command took.
     */
    onServiceUnavailable(listener: (name: string) => void): () => void;
    /** Forgets which services earlier sessions found disabled, so the next calls ask the site again. */
    forgetUnavailableServices(): Promise<void>;
    callBatch(requests: AjaxCall[]): Promise<OptionalAjaxBatchResult[]>;
    private call;
    private callBatchValues;
    private callBatchInternal;
    /** Whether the site is known to refuse name; telling the listeners it was gone around. */
    private noteIfUnavailable;
    private ensureSession;
    private get;
    private getAbsolute;
    private requestAbsoluteInternal;
    private getCoursesTimeline;
    private findActivity;
    private scrapeCourseContents;
    private reauthenticate;
    private performReauthentication;
    private applyContext;
    private writeCache;
}
export declare function createMoodleClientCore(baseUrl: string, options: MoodleClientCoreOptions | string): MoodleClientCore;
export {};
