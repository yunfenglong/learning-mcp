import type { GradeDefinition } from "./grades.js";
import type { CivilDate, Instant } from "./time.js";

export interface UnitSummary {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly my_role?: string | null;
  readonly start_date?: CivilDate | null;
  readonly end_date?: CivilDate | null;
  readonly active?: boolean | null;
  readonly allow_flexible_dates?: boolean | null;
}

export interface TaskDefinition {
  readonly id: number;
  readonly abbreviation: string;
  readonly name: string;
  readonly description: string | null;
  readonly target_grade: number | null;
  readonly start_date: CivilDate | null;
  readonly target_date: CivilDate | null;
  readonly due_date: CivilDate | null;
  readonly is_graded: boolean | null;
  readonly max_quality_pts: number | null;
  readonly has_task_sheet?: boolean | null;
  readonly has_task_resources?: boolean | null;
  readonly upload_requirements: readonly UploadRequirement[];
  readonly grade_due_dates: Readonly<Record<string, CivilDate>>;
  readonly grade_start_dates: Readonly<Record<string, CivilDate>>;
}

export type UploadRequirementType = "code" | "document" | "image" | "zip";

export interface UploadRequirement {
  readonly key: string;
  readonly name: string;
  readonly type: UploadRequirementType;
  readonly submission_history: boolean;
}

export interface Task {
  readonly id: number;
  readonly task_definition_id: number;
  readonly status: string;
  readonly due_date: CivilDate | null;
  readonly target_due_date: CivilDate | null;
  readonly target_start_date: CivilDate | null;
  readonly submission_date: CivilDate | null;
  readonly completion_date: CivilDate | null;
  readonly moved_to_discuss_at: Instant | null;
  readonly discuss_timeout_expiry_at: Instant | null;
  readonly extensions: number | null;
  readonly times_assessed: number | null;
  readonly grade: number | null;
  readonly quality_pts: number | null;
  readonly include_in_portfolio: boolean | null;
  readonly num_new_comments?: number;
}

export interface TaskUpdate {
  readonly id: number;
  readonly task_definition_id: number;
  readonly status: string;
}

export interface Project {
  readonly id: number;
  readonly unit: UnitSummary;
  readonly target_grade: number | null;
  readonly submitted_grade: number | null;
  readonly compile_portfolio: boolean | null;
  readonly portfolio_available: boolean | null;
  readonly uses_draft_learning_summary: boolean | null;
  readonly flexible_dates: boolean;
  readonly special_consideration_days: number;
  readonly tasks: readonly Task[];
}

export interface Unit extends UnitSummary {
  readonly description?: string | null;
  readonly grade_definitions: readonly GradeDefinition[];
  readonly task_definitions: readonly TaskDefinition[];
}

export interface ProjectSummary {
  readonly id: number;
  readonly unit: UnitSummary;
  readonly target_grade: number | null;
  readonly portfolio_available: boolean | null;
  readonly user_id: number | null;
  readonly unit_id: number | null;
}

export interface UserView {
  readonly id: number | null;
  readonly username: string | null;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly email: string | null;
  readonly nickname: string | null;
}

export interface UnitRole {
  readonly id: number;
  readonly role: string;
  readonly unit: UnitSummary;
  readonly user: UserView | null;
}

export interface TaskCommentParty {
  readonly id: number;
  readonly first_name: string;
  readonly last_name: string;
  readonly email: string;
}

export interface TaskComment {
  readonly id: number;
  readonly comment: string;
  readonly has_attachment: boolean;
  readonly type: string;
  readonly is_new: boolean;
  readonly reply_to_id: number | null;
  readonly author: TaskCommentParty;
  readonly recipient: TaskCommentParty;
  readonly created_at: string;
  readonly recipient_read_time: string | null;
  readonly status?: string;
}
