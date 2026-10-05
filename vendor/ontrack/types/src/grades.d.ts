export interface GradeDefinition {
    readonly id: string;
    readonly value: number;
    readonly name: string;
    readonly abbreviation: string;
}
export declare function readGradeDefinitions(value: unknown): GradeDefinition[];
export declare function gradeLabel(value: number | null, definitions: readonly GradeDefinition[]): string;
