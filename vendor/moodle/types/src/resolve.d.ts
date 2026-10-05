import type { Activity, Course, Section } from "./models.js";
export interface Candidate {
    id: number;
    name: string;
    code?: string;
    type?: string;
}
export declare class ReferenceError extends Error {
    readonly code: "ambiguous" | "not_found";
    readonly candidates: Candidate[];
    readonly hint = "Run `moodle units` to see this site's names, or refine the reference.";
    constructor(code: "ambiguous" | "not_found", message: string, candidates: Candidate[]);
}
export declare const normalize: (value: string) => string;
export declare const tokensMatch: (text: string, query: string) => boolean;
export declare function resolveUnit(value: string | number, courses: readonly Course[]): Course;
export declare function resolveSection(ref: string | number, sections: readonly Section[]): {
    section: Section;
    positional?: boolean;
};
export declare function currentSection(sections: readonly Section[]): Section | undefined;
export interface SearchMatch extends Candidate {
    unit_id: number;
    unit_code: string;
    section_id: number;
    section: string;
    score: number;
    activity?: Activity;
}
export declare function searchSections(course: Course, sections: readonly Section[], query: string): SearchMatch[];
export declare function sectionLabels(sections: readonly Section[]): Map<number, string>;
export declare function sectionTree(sections: readonly Section[]): Array<{
    section: Section;
    children: Section[];
}>;
export declare function withChildSections(section: Section, sections: readonly Section[]): Section[];
export declare function splitUnitPhrase(phrase: string, courses: readonly Course[]): {
    course: Course;
    query: string;
} | undefined;
