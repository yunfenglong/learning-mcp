import {
  buildProjectSnapshot,
  CivilDate,
  Instant,
} from "../../../vendor/ontrack/client.js";
import type { OnTrackClient } from "../../../vendor/ontrack/client.js";
import type { OnTrackReadArgs, OnTrackOperation } from "./contracts.ts";
import { getDocumentProxy } from "unpdf";
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
    return {
      user: { username: ctx.username, id: ids[0] ?? null },
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
  const tasks = unit.task_definitions.map((definition) => {
    const progress =
      project.tasks.find((v) => v.task_definition_id === definition.id) ?? null;
    return {
      ...definition,
      ...progress,
      task_definition_id: definition.id,
      status: progress?.status ?? "not_started",
      definition,
      progress,
    };
  });
  if (name === "get_unit") {
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
    return {
      unit,
      project,
      scheduled_tasks: snapshot.tasks,
      timezone: bound.timezone,
    };
  }
  if (name === "list_tasks") {
    const p = page(
      tasks.filter(
        (v) =>
          !a.status?.length ||
          a.status.includes(v.progress?.status ?? "not_started"),
      ),
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
      tasks: tasks.map((v) => ({
        task_definition_id: v.task_definition_id,
        abbreviation: v.abbreviation,
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
  if (name === "get_task")
    return {
      project_id: project.id,
      unit_id: unit.id,
      task,
      progress: chosen.progress,
    };
  const download = a.resources
    ? await c.downloadTaskResources(unit.id, task.id)
    : await c.downloadTaskSheet(unit.id, task.id);
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
    // No external URLs, PDF scripts, dynamic JavaScript evaluation, fonts or image fetches.
    if (new TextDecoder().decode(download.bytes.subarray(0, 5)) !== "%PDF-")
      throw new SuiteError(
        "UPSTREAM_CONTRACT_ERROR",
        "OnTrack did not return a PDF task sheet.",
        502,
      );
    const options = {
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
    };
    const pdf = await getDocumentProxy(download.bytes.slice(), options);
    try {
      if (pdf.numPages < 1 || pdf.numPages > 200)
        throw new SuiteError(
          "FILE_TOO_LARGE",
          "Task sheets are limited to 200 pages.",
        );
      const start = a.page ?? 1,
        end = Math.min(pdf.numPages, start + (a.pages ?? 20) - 1);
      if (start > pdf.numPages)
        throw new SuiteError(
          "INVALID_INPUT",
          "The selected page is outside this task sheet.",
        );
      const lines: string[] = [`# ${task.name}`];
      for (let index = start; index <= end; index++) {
        const p = await pdf.getPage(index),
          content = await p.getTextContent();
        let text = "";
        for (const item of content.items)
          if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
        lines.push(`## Page ${index}`, text.trim());
        p.cleanup();
      }
      return {
        markdown: lines.join("\n\n"),
        total_pages: pdf.numPages,
        first_page: start,
        last_page: end,
        next_page: end < pdf.numPages ? end + 1 : null,
        coverage: "extractable_text",
        reason:
          "PDF text extraction does not transcribe images or scanned pages.",
      };
    } finally {
      await pdf.loadingTask.destroy();
    }
  }
  return unhandledRead(name);
}
