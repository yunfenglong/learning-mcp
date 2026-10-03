import { lstat, readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import { CliError } from "./errors.js";
import type { UploadRequirement, UploadRequirementType } from "./types.js";

const maxFileBytes = 100 * 1024 * 1024;
const maxTotalBytes = 100 * 1024 * 1024;

export interface PreparedUpload {
  readonly key: string;
  readonly requirementName: string;
  readonly requirementType: UploadRequirementType;
  readonly path: string;
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

const contentTypes: Readonly<Record<string, string>> = {
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".zip": "application/zip",
};

export async function prepareUploads(
  paths: readonly string[],
  requirements: readonly UploadRequirement[],
  signal?: AbortSignal,
): Promise<PreparedUpload[]> {
  if (paths.length !== requirements.length) {
    throw new CliError("usage", `Task requires ${requirements.length} files, but received ${paths.length}. Files must follow the requirement order.`);
  }
  const uploads: PreparedUpload[] = [];
  let totalBytes = 0;
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index]!;
    const requirement = requirements[index]!;
    const before = await lstat(path).catch(() => undefined);
    if (!before?.isFile() || before.isSymbolicLink()) {
      throw new CliError("usage", `Upload ${index + 1} must be a readable regular file: ${path}`);
    }
    if (before.size <= 0) throw new CliError("usage", `Upload ${index + 1} is empty: ${path}`);
    if (before.size > maxFileBytes) throw new CliError("usage", `Upload ${index + 1} exceeds the 100 MiB local safety limit: ${path}`);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(path, { signal }));
    } catch {
      if (signal?.aborted) throw new CliError("cancellation", "Submission preparation cancelled");
      throw new CliError("usage", `Upload ${index + 1} must be readable: ${path}`);
    }
    const after = await lstat(path).catch(() => undefined);
    if (
      !after?.isFile()
      || after.isSymbolicLink()
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== bytes.length
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs
    ) {
      throw new CliError("usage", `Upload ${index + 1} changed while it was being read: ${path}`);
    }
    totalBytes += bytes.length;
    if (totalBytes > maxTotalBytes) throw new CliError("usage", "Uploads exceed the 100 MiB total limit");
    const filename = basename(path);
    uploads.push({
      key: requirement.key,
      requirementName: requirement.name,
      requirementType: requirement.type,
      path,
      filename,
      contentType: contentTypes[extname(filename).toLowerCase()] ?? "application/octet-stream",
      bytes,
    });
  }
  return uploads;
}
