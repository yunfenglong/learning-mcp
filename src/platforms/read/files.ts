import { SuiteError } from "../../errors.ts";
import { OutputBoundary } from "../../security/output.ts";

const generatedFiles = new WeakSet<object>();
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export interface LearningFile {
  kind: "learning_file";
  name: string;
  mime_type: string;
  bytes: number;
  sha256: string;
  uri: string;
  blob: string;
}
export function base64(bytes: Uint8Array) {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
}
export async function responseBytes(
  response: Response,
  limit = MAX_FILE_BYTES,
) {
  if (!response.ok)
    throw new SuiteError(
      "FILE_UNAVAILABLE",
      "The platform could not return this file.",
      502,
    );
  const length = Number(response.headers.get("content-length"));
  if (length > limit) {
    await response.body?.cancel();
    throw new SuiteError(
      "FILE_TOO_LARGE",
      "This file exceeds the remote download limit.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new SuiteError(
        "FILE_TOO_LARGE",
        "This file exceeds the remote download limit.",
      );
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function learningFile(
  bytes: Uint8Array,
  name: string,
  mimeType: string,
  output: OutputBoundary,
): Promise<LearningFile> {
  if (bytes.length > MAX_FILE_BYTES)
    throw new SuiteError(
      "FILE_TOO_LARGE",
      "Remote files are limited to 16 MiB each.",
    );
  // Never turn a login page or a session-bearing response into a downloadable artifact.
  const text = new TextDecoder().decode(bytes);
  if (output.redact(text) !== text)
    throw new SuiteError(
      "FILE_CONTAINS_CREDENTIALS",
      "This file contains credential material and cannot be returned.",
      403,
    );
  const safeName =
    name
      .replaceAll("\\", "/")
      .split("/")
      .at(-1)
      ?.replace(/[\u0000-\u001f\u007f]/g, "")
      .trim() || "file";
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = [...hash].map((v) => v.toString(16).padStart(2, "0")).join("");
  const file: LearningFile = {
    kind: "learning_file",
    name: safeName,
    mime_type: mimeType.split(";")[0] || "application/octet-stream",
    bytes: bytes.length,
    sha256,
    uri: `learning-file:///${sha256}/${encodeURIComponent(safeName)}`,
    blob: base64(bytes),
  };
  generatedFiles.add(file);
  return file;
}

export function isLearningFile(value: unknown): value is LearningFile {
  return !!value && typeof value === "object" && generatedFiles.has(value);
}

/** Separate actual binary resources from metadata so clients do not receive duplicate base64. */
export function fileContents(value: unknown) {
  const resources: Array<{
    type: "resource";
    resource: { uri: string; mimeType: string; blob: string };
  }> = [];
  function visit(v: unknown): unknown {
    if (isLearningFile(v)) {
      const file = v;
      resources.push({
        type: "resource",
        resource: { uri: file.uri, mimeType: file.mime_type, blob: file.blob },
      });
      const { blob, kind, ...metadata } = file;
      return metadata;
    }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, item]) => [k, visit(item)]),
      );
    return v;
  }
  return { metadata: visit(value), resources };
}
