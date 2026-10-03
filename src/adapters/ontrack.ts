import type { Unit } from "../domain/units.ts";
import { SuiteError } from "../errors.ts";
import { object, rows, type Backend } from "./backend.ts";

export class OnTrackAdapter {
  constructor(private readonly backend: Backend) {}
  private project(unit: Unit) {
    if (!unit.ontrack_project_id)
      throw new SuiteError(
        "PLATFORM_NOT_CONFIGURED",
        "This unit has no OnTrack project.",
      );
    return unit.ontrack_project_id;
  }
  async tasks(unit: Unit) {
    return this.backend.call("list_tasks", { project_id: this.project(unit) });
  }
  async unit(unit: Unit) {
    this.project(unit);
    const result = object(
      await this.backend.call("get_unit", { unit_id: unit.ontrack_unit_id }),
    );
    const actual = object(result.unit ?? result).id;
    if (actual !== unit.ontrack_unit_id)
      throw new SuiteError(
        "ENTITY_NOT_ALLOWED",
        "The OnTrack unit does not match this Learning unit.",
        403,
      );
    return result;
  }
  async task(unit: Unit, taskDefinitionId: number) {
    const list = rows(await this.tasks(unit), "tasks");
    if (
      !list.some(
        (item) =>
          item.task_definition_id === taskDefinitionId ||
          (item.task_definition &&
            object(item.task_definition).id === taskDefinitionId),
      )
    )
      throw new SuiteError(
        "ENTITY_NOT_ALLOWED",
        "This task is not in the configured OnTrack project.",
        403,
      );
    return this.backend.call("get_task", {
      project_id: this.project(unit),
      task_definition_id: taskDefinitionId,
    });
  }
}
