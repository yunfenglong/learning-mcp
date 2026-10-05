export declare function hasGrade(grade: string): boolean;
export declare function pageGradeReports<T, R extends {
    items: T[];
}>(reports: readonly R[], limit: number, offset: number): {
    pages: (R & {
        items: T[];
    })[];
    matched: number;
    returned: number;
    offset: number;
    has_more: boolean;
};
