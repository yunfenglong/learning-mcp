import { CliError } from "./errors.js";
import { HttpClient, type DownloadResponse } from "./http.js";
import { readProject, readProjects, readRoles, readTaskComment, readTaskComments, readTaskUpdate, readUnit } from "./readers.js";
import type { Project, ProjectSummary, TaskComment, TaskUpdate, Unit, UnitRole } from "./types.js";
import type { PreparedUpload } from "./uploads.js";
import type { WritableTaskState } from "./status.js";

export interface ProjectResourcesArchive {
  readonly projectId: number;
  readonly unitId: number;
  readonly bytes: Uint8Array;
}

function isZip(bytes: Uint8Array): boolean {
  if (bytes.length < 22) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstPossibleOffset = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= firstPossibleOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength !== bytes.length) continue;
    const disk = view.getUint16(offset + 4, true);
    const centralDisk = view.getUint16(offset + 6, true);
    const diskEntries = view.getUint16(offset + 8, true);
    const entries = view.getUint16(offset + 10, true);
    const centralSize = view.getUint32(offset + 12, true);
    const centralOffset = view.getUint32(offset + 16, true);
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== entries || centralOffset + centralSize !== offset) return false;
    if (entries === 0) return centralSize === 0;
    let cursor = centralOffset;
    for (let entry = 0; entry < entries; entry += 1) {
      if (cursor + 46 > offset || view.getUint32(cursor, true) !== 0x02014b50) return false;
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const entryCommentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== 0x04034b50) return false;
      cursor += 46 + nameLength + extraLength + entryCommentLength;
    }
    return cursor === offset;
  }
  return false;
}

export interface AuthMethod {
  readonly method: string;
  readonly redirect_to?: string | null;
}

export class OnTrackClient {
  constructor(private readonly http: HttpClient) {}

  // Resolving a unit reads the list, and so does the command that follows; one
  // process is short enough that reading it twice is only a wasted round trip.
  private readonly projectsByScope = new Map<boolean, Promise<ProjectSummary[]>>();

  async getProjects(includeInactive = false): Promise<ProjectSummary[]> {
    let pending = this.projectsByScope.get(includeInactive);
    if (!pending) {
      pending = this.http.request("api/projects", { query: { include_inactive: includeInactive } }).then(readProjects);
      this.projectsByScope.set(includeInactive, pending);
    }
    return pending;
  }

  async getProject(id: number): Promise<Project> {
    try {
      return readProject(await this.http.request(`api/projects/${id}`));
    } catch (error) {
      if (error instanceof CliError && error.statusCode === 403) {
        throw new CliError(
          "upstream_api",
          `Project ${id} is not accessible. Project arguments use the id from \`ontrack projects --include-inactive\`, not list positions.`,
          403,
        );
      }
      throw error;
    }
  }

  async getUnit(id: number): Promise<Unit> {
    return readUnit(await this.http.request(`api/units/${id}`));
  }

  async downloadProjectResources(projectId: number): Promise<ProjectResourcesArchive> {
    const project = await this.getProject(projectId);
    let bytes: Uint8Array;
    try {
      bytes = await this.http.download(`api/units/${project.unit.id}/all_resources`);
    } catch (error) {
      if (error instanceof CliError && error.statusCode === 401) {
        throw new CliError("upstream_api", `Resources for project ${projectId} are not accessible`, 401);
      }
      throw error;
    }
    if (!isZip(bytes)) {
      throw new CliError("upstream_contract", "OnTrack returned an invalid resource archive");
    }
    return { projectId, unitId: project.unit.id, bytes };
  }

  async downloadTaskSheet(unitId: number, taskDefinitionId: number): Promise<DownloadResponse> {
    return this.http.downloadFile(`api/units/${unitId}/task_definitions/${taskDefinitionId}/task_pdf`, {
      query: { as_attachment: true },
    });
  }

  async downloadTaskResources(unitId: number, taskDefinitionId: number): Promise<DownloadResponse> {
    return this.http.downloadFile(`api/units/${unitId}/task_definitions/${taskDefinitionId}/task_resources`);
  }

  async getTaskComments(projectId: number, taskDefinitionId: number): Promise<TaskComment[]> {
    return readTaskComments(await this.http.request(
      `api/projects/${projectId}/task_def_id/${taskDefinitionId}/comments`,
    ));
  }

  async updateTaskState(projectId: number, taskDefinitionId: number, state: WritableTaskState): Promise<TaskUpdate> {
    return readTaskUpdate(await this.http.request(
      `api/projects/${projectId}/task_def_id/${taskDefinitionId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: state }),
      },
    ));
  }

  async addTaskComment(projectId: number, taskDefinitionId: number, message: string): Promise<TaskComment> {
    try {
      return readTaskComment(await this.http.request(
        `api/projects/${projectId}/task_def_id/${taskDefinitionId}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: new URLSearchParams({ comment: message }),
        },
      ));
    } catch (error) {
      if (error instanceof CliError && error.category === "upstream_api") {
        throw new CliError(
          "upstream_api",
          `Chat message was rejected by OnTrack${error.statusCode ? ` (HTTP ${error.statusCode})` : ""}`,
          error.statusCode,
        );
      }
      throw error;
    }
  }

  async submitTask(
    projectId: number,
    taskDefinitionId: number,
    uploads: readonly PreparedUpload[],
    options: { readonly type: string; readonly comment?: string; readonly acceptTiiEula?: boolean },
  ): Promise<TaskUpdate> {
    const form = new FormData();
    for (const upload of uploads) {
      form.append(upload.key, new Blob([upload.bytes.slice()], { type: upload.contentType }), upload.filename);
    }
    form.append("trigger", options.type);
    if (options.comment !== undefined) form.append("comment", options.comment);
    if (options.acceptTiiEula) form.append("accepted_tii_eula", "true");
    const response = await this.http.requestWithStatus(
      `api/projects/${projectId}/task_def_id/${taskDefinitionId}/submission`,
      { method: "POST", body: form },
    );
    if (response.status !== 201) {
      throw new CliError("upstream_contract", `OnTrack submission returned HTTP ${response.status}; expected HTTP 201`);
    }
    return readTaskUpdate(response.value);
  }

  async getRoles(activeOnly = true): Promise<UnitRole[]> {
    return readRoles(await this.http.request("api/unit_roles", {
      query: { active_only: activeOnly },
    }));
  }

  async getAuthMethod(): Promise<AuthMethod> {
    const value = await this.http.request("api/auth/method");
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new CliError("upstream_contract", "auth method must be an object");
    }
    const method = Reflect.get(value, "method");
    const redirectTo = Reflect.get(value, "redirect_to");
    if (typeof method !== "string" || (redirectTo !== undefined && redirectTo !== null && typeof redirectTo !== "string")) {
      throw new CliError("upstream_contract", "auth method response is invalid");
    }
    return redirectTo === undefined ? { method } : { method, redirect_to: redirectTo };
  }
}
