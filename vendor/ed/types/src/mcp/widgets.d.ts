import type { EdClient } from "../ed/client.js";
import { type CourseReference } from "../ed/operations.js";
export interface WidgetResult {
    view: Record<string, unknown>;
    text: string;
}
export declare function buildForumCatchup(client: EdClient, courseReference: CourseReference, days: number): Promise<WidgetResult>;
export declare function buildThreadActivity(client: EdClient, courseReference: CourseReference, weeks: number): Promise<WidgetResult>;
export declare function buildLessonProgress(client: EdClient, courseReference: CourseReference): Promise<WidgetResult>;
export interface GuideInput {
    lessonId: number;
    quiz: {
        answer: number;
        options: string[];
        question: string;
        section: number;
        why: string;
    }[];
    sections: {
        points: string[];
        title: string;
    }[];
}
/**
 * The model writes the guide and its practice questions from the lesson it read.
 * Ed's own quiz questions are never answered here: Ed marks them, so they stay the
 * student's to do, and the widget only says how many there are.
 */
export declare function buildLessonGuide(client: EdClient, input: GuideInput): Promise<WidgetResult>;
