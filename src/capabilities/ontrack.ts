import { z } from "zod";
import { defineRead, definePlatformRead } from "./definition.ts";
import { resolveUnit } from "../domain/units.ts";
import { SuiteError } from "../errors.ts";

import { unit, pagination, taskReference } from "./schemas.ts";
const id = z.number().int().positive();

export const ontrackCapabilities = [
  definePlatformRead(
    "ontrack_user",
    "Read the authenticated platform identity without credentials.",
    {},
    "ontrack",
    "get_user",
    "account",
  ),
  definePlatformRead(
    "ontrack_courses",
    "Discover verified platform enrollments without creating course associations.",
    { ...pagination, include_inactive: z.boolean().default(false) },
    "ontrack",
    "courses",
    "account",
  ),
  defineRead(
    "ontrack_unit",
    "Read an OnTrack unit and its task definitions from your connected account.",
    { unit },
    "ontrack",
    "get_unit",
    async (args, { config, adapters }) =>
      adapters.ontrack.unit(resolveUnit(config.units, args.unit)),
  ),
  defineRead(
    "ontrack_tasks",
    "List tasks in a configured OnTrack project.",
    {
      unit,
      ...pagination,
      status: z.array(z.string().min(1).max(100)).min(1).max(20).optional(),
    },
    "ontrack",
    "list_tasks",
    async (args, { config, adapters }) =>
      adapters.ontrack.tasks(resolveUnit(config.units, args.unit), args),
  ),
  defineRead(
    "ontrack_task",
    "Read a task that appears in the configured OnTrack project.",
    { unit, ...taskReference },
    "ontrack",
    "get_task",
    async (args, { config, adapters }) => {
      if ((args.task_definition_id === undefined) === (args.task === undefined))
        throw new SuiteError(
          "INVALID_INPUT",
          "Provide exactly one task_definition_id or task abbreviation.",
        );
      return adapters.ontrack.read(
        "get_task",
        resolveUnit(config.units, args.unit),
        args,
      );
    },
  ),
  definePlatformRead(
    "ontrack_roles",
    "List current or historical teaching roles for the authenticated OnTrack account; no teaching actions are exposed.",
    { active_only: z.boolean().default(true), ...pagination },
    "ontrack",
    "roles",
    "account",
  ),
  definePlatformRead(
    "ontrack_unread",
    "Read per-task unread comment counts from the project snapshot, without requesting chat history or changing read status.",
    { unit },
    "ontrack",
    "unread",
    "course",
  ),
  definePlatformRead(
    "ontrack_task_read",
    "Read task-sheet PDF text as paged Markdown, without executing PDF JavaScript or loading remote resources. Image-only content requires the task PDF file.",
    {
      unit,
      ...taskReference,
      page: id.default(1),
      pages: z.number().int().min(1).max(50).default(20),
    },
    "ontrack",
    "task_read",
    "course",
  ),
  definePlatformRead(
    "ontrack_task_file",
    "Return a task-sheet PDF or task-resources archive as a real MCP file; verify project/unit/task ownership first. 16 MiB maximum.",
    { unit, ...taskReference, resources: z.boolean().default(false) },
    "ontrack",
    "task_file",
    "course",
  ),
  definePlatformRead(
    "ontrack_unit_file",
    "Return the linked project's full unit-resources ZIP as a real MCP file, up to 16 MiB.",
    { unit },
    "ontrack",
    "unit_file",
    "course",
  ),
] as const;
