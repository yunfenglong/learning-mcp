import { HttpClient, type DownloadResponse } from "./http.js";
import type { Project, ProjectSummary, TaskComment, TaskUpdate, Unit, UnitRole } from "./types.js";
import type { PreparedUpload } from "./uploads.js";
import type { WritableTaskState } from "./status.js";
export interface ProjectResourcesArchive {
    readonly projectId: number;
    readonly unitId: number;
    readonly bytes: Uint8Array;
}
export interface AuthMethod {
    readonly method: string;
    readonly redirect_to?: string | null;
}
export declare class OnTrackClient {
    private readonly http;
    constructor(http: HttpClient);
    private readonly projectsByScope;
    getProjects(includeInactive?: boolean): Promise<ProjectSummary[]>;
    getProject(id: number): Promise<Project>;
    getUnit(id: number): Promise<Unit>;
    downloadProjectResources(projectId: number): Promise<ProjectResourcesArchive>;
    downloadTaskSheet(unitId: number, taskDefinitionId: number): Promise<DownloadResponse>;
    downloadTaskResources(unitId: number, taskDefinitionId: number): Promise<DownloadResponse>;
    getTaskComments(projectId: number, taskDefinitionId: number): Promise<TaskComment[]>;
    updateTaskState(projectId: number, taskDefinitionId: number, state: WritableTaskState): Promise<TaskUpdate>;
    addTaskComment(projectId: number, taskDefinitionId: number, message: string): Promise<TaskComment>;
    submitTask(projectId: number, taskDefinitionId: number, uploads: readonly PreparedUpload[], options: {
        readonly type: string;
        readonly comment?: string;
        readonly acceptTiiEula?: boolean;
    }): Promise<TaskUpdate>;
    getRoles(activeOnly?: boolean): Promise<UnitRole[]>;
    getAuthMethod(): Promise<AuthMethod>;
}
