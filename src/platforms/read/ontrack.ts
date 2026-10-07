import {
  buildProjectSnapshot,
  CivilDate,
  Instant,
} from "../../../vendor/ontrack/client.js";
import type { OnTrackClient } from "../../../vendor/ontrack/client.js";
import type { OnTrackReadArgs, OnTrackOperation } from "./contracts.ts";
import { taskMarkdown } from "./ontrack-pdf.ts";
import { SuiteError } from "../../errors.ts";
import { learningFile } from "./files.ts";
import {
  requireOwner,
  page,
  required,
  unhandledRead,
  type ReadContext,
} from "./shared.ts";

export async function ontrackRead(
  name: OnTrackOperation,
  a: OnTrackReadArgs,
  ctx: ReadContext<OnTrackClient>,
) {
  const c = ctx.client;
  if (name === "courses")
    return {
      ...page(await c.getProjects(a.include_inactive ?? false), a, 200),
    };
  if (name === "get_user") {
    // The project list is authenticated; /api/auth/method alone is public and proves no identity.
    const projects = await c.getProjects(true);
    const ids = [
      ...new Set(projects.flatMap((v) => (v.user_id ? [v.user_id] : []))),
    ];
    if (ids.length > 1)
      throw new SuiteError(
        "ACCOUNT_CHANGED",
        "OnTrack returned conflicting account identities. Reconnect OnTrack.",
        409,
      );
    if (
      ctx.profile &&
      (ctx.profile.username !== ctx.username ||
        (ids.length && ctx.profile.id !== null && ctx.profile.id !== ids[0]))
    )
      throw new SuiteError(
        "ACCOUNT_CHANGED",
        "OnTrack profile does not match the current account.",
        409,
      );
    return {
      user: {
        first_name: null,
        last_name: null,
        email: null,
        nickname: null,
        ...ctx.profile,
        username: ctx.username,
        id: ids[0] ?? ctx.profile?.id ?? null,
      },
      profile_source: ctx.profile
        ? "authenticated_session"
        : "unavailable_until_session_renewal",
      base_url: ctx.config.platforms.ontrack?.site_url,
      authentication: await c.getAuthMethod(),
      authenticated: true,
    };
  }
  if (name === "roles")
    return { ...page(await c.getRoles(a.active_only ?? true), a, 200) };
  const bound = ctx.config.units.find((u) =>
    a.project_id !== undefined
      ? u.ontrack_project_id === a.project_id
      : u.ontrack_unit_id === a.unit_id,
  );
  if (!bound?.ontrack_project_id || !bound.ontrack_unit_id)
    throw new SuiteError(
      "UNIT_NOT_ALLOWED",
      "Bind this OnTrack project first.",
      403,
    );
  await ctx.enrolled(bound.ontrack_project_id);
  const project = await c.getProject(bound.ontrack_project_id);
  requireOwner(project.id, bound.ontrack_project_id);
  requireOwner(project.unit.id, bound.ontrack_unit_id);
  if (name === "unit_file") {
    const file = await c.downloadProjectResources(project.id);
    requireOwner(file.unitId, bound.ontrack_unit_id);
    requireOwner(file.projectId, project.id);
    return {
      file: await learningFile(
        file.bytes,
        `unit-${bound.ontrack_unit_id}-resources.zip`,
        "application/zip",
        ctx.output,
      ),
    };
  }
  const unit = await c.getUnit(bound.ontrack_unit_id);
  requireOwner(unit.id, bound.ontrack_unit_id);
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: bound.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const snapshot = buildProjectSnapshot(
    {
      ...project,
      flexible_dates: unit.allow_flexible_dates ?? project.flexible_dates,
    },
    unit,
    {
      now: Instant.parse(now.toISOString()),
      today: CivilDate.parse(date),
    },
  );

  const tasks = unit.task_definitions.map((definition) => {
    const progress =
      project.tasks.find((v) => v.task_definition_id === definition.id) ?? null;
    return {
      ...definition,
      ...progress,
      ...snapshot.tasks.find((row) => row.task_definition_id === definition.id),
      id: progress?.id ?? definition.id,
      task_definition_id: definition.id,
      status: progress?.status ?? "not_started",
      definition,
      progress,
    };
  });
  if (name === "get_unit") {
    return {
      unit,
      project,
      scheduled_tasks: snapshot.tasks,
      timezone: bound.timezone,
    };
  }
  if (name === "list_tasks") {
    const p = page(
      snapshot.tasks
        .map((row) =>
          tasks.find((v) => v.task_definition_id === row.task_definition_id)!,
        )
        .filter(Boolean)
        .filter((v) => !a.status?.length || a.status.includes(v.status)),
      a,
      200,
    );
    return {
      project_id: project.id,
      tasks: p.results,
      total: p.total,
      offset: p.offset,
      has_more: p.has_more,
    };
  }
  if (name === "unread")
    return {
      project_id: project.id,
      tasks: tasks
        .filter((v) => v.progress)
        .map((v) => ({
          task_definition_id: v.task_definition_id,
          abbreviation: v.abbreviation,
          name: v.name,
          status: v.status,
          unread_comments: v.progress?.num_new_comments ?? 0,
          unread: v.progress?.num_new_comments ?? 0,
        })),
      total: tasks.reduce((n, v) => n + (v.progress?.num_new_comments ?? 0), 0),
    };
  const selected = tasks.filter((v) =>
    a.task_definition_id !== undefined
      ? v.task_definition_id === a.task_definition_id
      : v.abbreviation.toLowerCase() === String(a.task).toLowerCase(),
  );
  if (selected.length !== 1)
    throw new SuiteError(
      "ENTITY_NOT_ALLOWED",
      "Choose one task definition ID or exact abbreviation from this project.",
      403,
    );
  const chosen = required(selected[0], "task");
  const task = chosen.definition;
  if (!chosen.progress && (name === "get_task" || project.tasks.length > 0))
    throw new SuiteError(
      "ENTITY_NOT_ALLOWED",
      "This task is not assigned to the selected project.",
      403,
    );
  if (name === "get_task")
    return {
      project_id: project.id,
      unit_id: unit.id,
      task,
      summary: snapshot.tasks.find((row) => row.task_definition_id === task.id),
      progress: chosen.progress,
    };
  if ((a.resources ? task.has_task_resources : task.has_task_sheet) === false)
    throw new SuiteError(
      "FILE_NOT_FOUND",
      "This task has no requested resource.",
      404,
    );
  const download = a.resources
    ? await c.downloadTaskResources(unit.id, task.id)
    : await c.downloadTaskSheet(unit.id, task.id);
  if (download.filename?.toLowerCase() === "filenotfound.pdf")
    throw new SuiteError(
      "FILE_NOT_FOUND",
      "OnTrack returned its missing-file placeholder.",
      404,
    );
  if (
    !a.resources &&
    (download.contentType !== "application/pdf" ||
      new TextDecoder().decode(download.bytes.subarray(0, 5)) !== "%PDF-")
  )
    throw new SuiteError(
      "UPSTREAM_CONTRACT_ERROR",
      "OnTrack did not return a valid task sheet PDF.",
      502,
    );
  if (a.resources && !download.filename)
    throw new SuiteError(
      "UPSTREAM_CONTRACT_ERROR",
      "OnTrack returned task resources without a filename.",
      502,
    );
  if (name === "task_file")
    return {
      file: await learningFile(
        download.bytes,
        download.filename ??
          `${task.abbreviation}.${a.resources ? "zip" : "pdf"}`,
        download.contentType ??
          (a.resources ? "application/zip" : "application/pdf"),
        ctx.output,
      ),
    };
  if (name === "task_read") {
    return taskMarkdown(download.bytes, task.name, a.page ?? 1, a.pages ?? 200);
  }
  return unhandledRead(name);
}
