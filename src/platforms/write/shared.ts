import type { Unit } from "../../domain/units.ts";
import type { StagedFile } from "../../accounts/write-store.ts";
import type { ReadContext } from "../read/shared.ts";
import { digest } from "../../auth/crypto.ts";
export interface WriteContext<C> extends ReadContext<C> {
  unit: Unit;
  files: StagedFile[];
}
export interface WritePlan {
  target: unknown;
  changes: unknown;
  irreversible: boolean;
  warnings: string[];
  state?: unknown;
  requirements?: string[];
}
export async function prepared(plan: WritePlan) {
  return { plan, fingerprint: await digest(JSON.stringify(plan)) };
}
export function fileManifest(files: StagedFile[]) {
  return files.map((f) => ({
    filename: f.filename,
    content_type: f.contentType,
    bytes: f.bytes.length,
    sha256: f.sha256,
  }));
}
