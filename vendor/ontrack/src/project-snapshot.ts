import { gradeLabel } from "./grades.js";
import { isFinalStatus, statusLabel } from "./status.js";
import type { Clock, CivilDate } from "./time.js";
import type { Project, Task, TaskDefinition, Unit } from "./types.js";

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

function effectiveDue(project: Project, task: Task, definition: TaskDefinition | undefined): CivilDate | null {
  if (project.flexible_dates) {
    if (task.target_due_date) return task.target_due_date;
    const gradeDate = definition?.grade_due_dates[String(project.target_grade)];
    if (gradeDate) return gradeDate;
  }
  return task.due_date ?? definition?.target_date ?? null;
}

function effectiveStart(project: Project, task: Task, definition: TaskDefinition | undefined): CivilDate | null {
  if (project.flexible_dates) {
    if (task.target_start_date) return task.target_start_date;
    const gradeStart = definition?.grade_start_dates[String(project.target_grade)];
    if (gradeStart) return gradeStart;
  }
  const base = definition?.start_date ?? null;
  if (base && task.extensions !== null && task.extensions < 0) {
    return base.addDays(task.extensions * 7);
  }
  return base;
}

function text(value: { toString(): string } | null | undefined): string | null {
  return value?.toString() ?? null;
}

export function buildProjectSnapshot(project: Project, unit: Unit, clock: Clock): ProjectSnapshot {
  const definitions = new Map(unit.task_definitions.map((definition) => [definition.id, definition]));
  const scheduled = project.tasks.map((task): { due: CivilDate | null; row: TaskRow } => {
    const definition = definitions.get(task.task_definition_id);
    const due = effectiveDue(project, task, definition);
    const start = effectiveStart(project, task, definition);
    const deadline = due?.addDays(project.special_consideration_days) ?? null;
    return { due, row: {
      id: task.id,
      task_definition_id: task.task_definition_id,
      abbreviation: definition?.abbreviation ?? `TD-${task.task_definition_id}`,
      name: definition?.name ?? "Unknown task",
      status: task.status,
      status_label: statusLabel(task.status),
      target_grade: definition?.target_grade ?? null,
      target_grade_label: gradeLabel(definition?.target_grade ?? null, unit.grade_definitions),
      start_date: text(start),
      target_date: text(definition?.target_date),
      target_start_date: text(task.target_start_date),
      target_due_date: text(task.target_due_date),
      due_date: text(due),
      deadline: text(deadline),
      submission_date: text(task.submission_date),
      completion_date: text(task.completion_date),
      moved_to_discuss_at: text(task.moved_to_discuss_at),
      discuss_timeout_expiry_at: text(task.discuss_timeout_expiry_at),
      extensions: task.extensions,
      grade: task.grade,
      grade_label: gradeLabel(task.grade, unit.grade_definitions),
      quality_pts: task.quality_pts,
      include_in_portfolio: task.include_in_portfolio,
      is_overdue: Boolean(deadline && deadline.compare(clock.today) < 0 && !isFinalStatus(task.status)),
      is_discuss_overdue: Boolean(task.discuss_timeout_expiry_at && task.discuss_timeout_expiry_at.compare(clock.now) < 0),
    } };
  });
  scheduled.sort((left, right) => {
    const dueOrder = left.due === null
      ? right.due === null ? 0 : 1
      : right.due === null ? -1 : left.due.compare(right.due);
    if (dueOrder !== 0) return dueOrder;
    const abbreviationOrder = left.row.abbreviation < right.row.abbreviation
      ? -1
      : left.row.abbreviation > right.row.abbreviation ? 1 : 0;
    return abbreviationOrder || left.row.id - right.row.id;
  });
  return { project, unit, tasks: scheduled.map(({ row }) => row) };
}
