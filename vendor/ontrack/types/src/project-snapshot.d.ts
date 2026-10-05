import type { Clock } from "./time.js";
import type { Project, Unit } from "./types.js";
export interface TaskRow {
    readonly id: number;
    readonly task_definition_id: number;
    readonly abbreviation: string;
    readonly name: string;
    readonly status: string;
    readonly status_label: string;
    readonly target_grade: number | null;
    readonly target_grade_label: string;
    readonly start_date: string | null;
    readonly target_date: string | null;
    readonly target_start_date: string | null;
    readonly target_due_date: string | null;
    readonly due_date: string | null;
    readonly deadline: string | null;
    readonly submission_date: string | null;
    readonly completion_date: string | null;
    readonly moved_to_discuss_at: string | null;
    readonly discuss_timeout_expiry_at: string | null;
    readonly extensions: number | null;
    readonly grade: number | null;
    readonly grade_label: string;
    readonly quality_pts: number | null;
    readonly include_in_portfolio: boolean | null;
    readonly is_overdue: boolean;
    readonly is_discuss_overdue: boolean;
}
export interface ProjectSnapshot {
    readonly project: Project;
    readonly unit: Unit;
    readonly tasks: readonly TaskRow[];
}
export declare function buildProjectSnapshot(project: Project, unit: Unit, clock: Clock): ProjectSnapshot;
