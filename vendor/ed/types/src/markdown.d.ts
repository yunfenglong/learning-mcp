import type { Lesson, LessonSlide, Thread } from "./ed/models.js";
export declare function threadToMarkdown(thread: Thread): string;
export declare function lessonToMarkdown(lesson: Lesson): string;
export declare function slideToMarkdown(slide: LessonSlide): string;
export declare function renderEdText(source: string, headingOffset?: number): string;
