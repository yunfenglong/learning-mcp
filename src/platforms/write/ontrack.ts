import type { OnTrackClient } from "../../../vendor/ontrack/client.js";
import type { WriteArgs } from "../../capabilities/write/index.ts";
import { SuiteError } from "../../errors.ts";
import { required, requireOwner } from "../read/shared.ts";
import { fileManifest, verifyPlan, type WriteContext } from "./shared.ts";
export async function ontrackWrite(
  name: string,
  a: WriteArgs,
  ctx: WriteContext<OnTrackClient>,
  execute = false,
): Promise<unknown> {
  const c = ctx.client,
    projectId = required(ctx.unit.ontrack_project_id, "OnTrack project"),
    unitId = required(ctx.unit.ontrack_unit_id, "OnTrack unit");
  await ctx.enrolled(projectId);
  const project = await c.getProject(projectId);
  requireOwner(project.id, projectId);
  requireOwner(project.unit.id, unitId);
  const unit = await c.getUnit(unitId);
  requireOwner(unit.id, unitId);
  const ref = required(a.task, "task"),
    selected = unit.task_definitions.filter((t) =>
      typeof ref === "number"
        ? t.id === ref
        : t.abbreviation.toLowerCase() === ref.toLowerCase(),
    );
  if (selected.length !== 1)
    throw new SuiteError(
      "ENTITY_NOT_ALLOWED",
      "Choose one task ID or exact abbreviation from this project.",
      403,
    );
  const task = selected[0]!,
    progress = project.tasks.find((t) => t.task_definition_id === task.id);
  if (!progress)
    throw new SuiteError(
      "ENTITY_NOT_ALLOWED",
      "This task is not assigned to the selected project.",
      403,
    );
  const target = {
    project_id: projectId,
    unit_id: unitId,
    task_definition_id: task.id,
    abbreviation: task.abbreviation,
    name: task.name,
    username: ctx.username,
  };
  let changes: unknown,
    warnings: string[] = [],
    irreversible = true;
  if (name === "chat_history" || name === "mark_chat_read") {
    changes = { read_history: true, mark_non_discussion_read: true };
    warnings = [
      "Fetching chat history marks non-discussion comments read; the marker cannot be reversed by this tool.",
    ];
  } else if (name === "send_chat") changes = { message: a.message };
  else if (name === "set_task_state") {
    changes = { state: a.state };
    irreversible = false;
  } else if (name === "submit_task") {
    if (ctx.files.length !== task.upload_requirements.length)
      throw new SuiteError(
        "INVALID_INPUT",
        "Provide one staged file for each upload requirement, in the displayed order.",
      );
    changes = {
      files: fileManifest(ctx.files),
      upload_requirements: task.upload_requirements,
      type: a.type,
      comment: a.comment,
      accept_tii_eula: a.accept_tii_eula,
    };
    warnings = [
      "Submission changes the task workflow. Review the files in requirement order and any required Turnitin agreement.",
    ];
  } else
    throw new SuiteError("TOOL_NOT_ALLOWED", "Unknown OnTrack write.", 403);
  const preview = await verifyPlan(ctx, {
    target,
    changes,
    irreversible,
    warnings,
    state: {
      status: progress?.status ?? "not_started",
      unread: progress?.num_new_comments ?? 0,
      requirements: task.upload_requirements,
    },
  });
  if (!execute) return preview;
  if (name === "chat_history" || name === "mark_chat_read") {
    const comments = await c.getTaskComments(projectId, task.id);
    return name === "chat_history"
      ? { comments, marked_read: true }
      : { marked_read: true, comments_count: comments.length };
  }
  if (name === "send_chat")
    return {
      comment: await c.addTaskComment(
        projectId,
        task.id,
        required(a.message, "message"),
      ),
    };
  if (name === "set_task_state") {
    const updated = await c.updateTaskState(
      projectId,
      task.id,
      required(a.state, "state"),
    );
    requireOwner(updated.task_definition_id, task.id);
    if (updated.status !== a.state)
      throw new SuiteError(
        "WRITE_OUTCOME_UNCERTAIN",
        "OnTrack did not confirm the requested task state. Check the task before another write.",
        409,
      );
    return {
      task: updated,
      previous_status: progress?.status ?? "not_started",
    };
  }
  const uploads = ctx.files.map((f, i) => ({
    key: task.upload_requirements[i]!.key,
    requirementName: task.upload_requirements[i]!.name,
    requirementType: task.upload_requirements[i]!.type,
    path: "",
    filename: f.filename,
    contentType: f.contentType,
    bytes: f.bytes,
  }));
  const receipt = await c.submitTask(projectId, task.id, uploads, {
    type: required(a.type, "type"),
    comment: a.comment,
    acceptTiiEula: a.accept_tii_eula,
  });
  requireOwner(receipt.task_definition_id, task.id);
  if (receipt.status !== a.type)
    throw new SuiteError(
      "WRITE_OUTCOME_UNCERTAIN",
      "OnTrack did not confirm the requested submission state. Check the task before another write.",
      409,
    );
  return {
    task: receipt,
    previous_status: progress?.status ?? "not_started",
    submission_type: a.type,
    processing_async: true,
  };
}
