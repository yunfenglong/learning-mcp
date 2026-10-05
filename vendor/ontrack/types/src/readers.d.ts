import type { Project, ProjectSummary, TaskUpdate, TaskComment, Unit, UnitRole, UnitSummary } from "./types.js";
export declare function readUnitSummary(value: unknown): UnitSummary;
export declare function readTaskUpdate(value: unknown): TaskUpdate;
export declare function readProjects(value: unknown): ProjectSummary[];
export declare function readProject(value: unknown): Project;
export declare function readUnit(value: unknown): Unit;
export declare function readRoles(value: unknown): UnitRole[];
export declare function readTaskComment(value: unknown): TaskComment;
export declare function readTaskComments(value: unknown): TaskComment[];
