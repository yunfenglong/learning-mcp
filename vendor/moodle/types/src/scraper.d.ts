import { type SiteLabels } from "./site-labels.js";
import { HTMLElement } from "node-html-parser";
import type { QuizAttemptReview, Assignment, CourseGrades, Folder, ForumDiscussion, ForumDiscussionRef, Link, Page, PageContext, Quiz, Resource, Section } from "./models.js";
export interface MoodlePageError {
    message: string;
    code?: string;
}
export declare function parseMoodleErrorHtml(html: string): MoodlePageError | null;
/**
 * Moodle answers an activity the user can see but not open (restricted, hidden) by
 * redirecting to the course page with a notice, and every activity parser would read
 * that page as the activity. The page's context and body id both name what it is.
 * A page carrying neither (a frameset, a served HTML file) is not judged.
 */
export declare function isOtherMoodlePage(html: string, type: string, cmid: number): boolean;
/** Why Moodle refused the activity: its availability conditions, or the hidden notice. */
export declare function parseUnavailableNotice(html: string): string;
export declare function parsePageContext(html: string, baseUrl: string): PageContext;
export declare function parseCourseContentsHtml(html: string, baseUrl: string): Section[];
export declare function parseCourseSectionNumbers(html: string, courseId: number): number[];
export declare function parseCourseGradesUrl(html: string, baseUrl: string): string;
export declare function parseCourseIdFromPageHtml(html: string): number | null;
export declare function hasCourseGradesHtml(html: string): boolean;
export declare function parseCourseGradesHtml(html: string, courseId: number, baseUrl: string): CourseGrades;
export declare function parseGradeOverviewRows(html: string, baseUrl: string): Record<number, {
    course_name: string;
    grade: string;
    url: string;
}>;
export declare function parseAssignmentHtml(html: string, assignmentId: number, baseUrl: string, labels?: SiteLabels): Assignment;
export declare function parseQuizHtml(html: string, quizId: number, baseUrl: string, labels?: SiteLabels): Quiz;
export declare function parseQuizReviewHtml(html: string, attemptId: number, baseUrl: string, labels?: SiteLabels): QuizAttemptReview;
export declare function blockText(node: HTMLElement | null | undefined): string;
export declare function parseResourceHtml(html: string, resourceId: number, baseUrl: string): Resource;
export declare function parseLinkHtml(html: string, linkId: number, baseUrl: string): Link;
export declare function parsePageHtml(html: string, pageId: number, baseUrl: string): Page;
export declare function parseSavedDocumentHtml(html: string, baseUrl: string): HTMLElement | undefined;
export declare function parseFolderHtml(html: string, folderId: number, baseUrl: string): Folder;
export declare function parseForumDiscussionHtml(html: string, baseUrl: string, discussionId: number): ForumDiscussion;
export declare function parseForumViewCmidFromDiscussionHtml(html: string): number | null;
export declare function parseForumDiscussionRefsHtml(html: string, baseUrl: string): ForumDiscussionRef[];
export declare function parseForumGroupsHtml(html: string): Array<[number, string]>;
export declare function parseForumGroupIdsHtml(html: string): number[];
export declare function parseForumDiscussionGroupHtml(html: string): [number, string];
/** The theme decides the markup every scraper reads, so a support report names it. */
export declare function parseSiteTheme(html: string): string | undefined;
