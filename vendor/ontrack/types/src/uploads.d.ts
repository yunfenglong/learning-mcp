import type { UploadRequirement, UploadRequirementType } from "./types.js";
export interface PreparedUpload {
    readonly key: string;
    readonly requirementName: string;
    readonly requirementType: UploadRequirementType;
    readonly path: string;
    readonly filename: string;
    readonly contentType: string;
    readonly bytes: Uint8Array;
}
export declare function prepareUploads(paths: readonly string[], requirements: readonly UploadRequirement[], signal?: AbortSignal): Promise<PreparedUpload[]>;
