import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const header = z
  .string()
  .max(1000)
  .regex(/^[\x20-\x7e]+$/);
const relativePath = z
  .string()
  .min(1)
  .max(1000)
  .refine(
    (v) =>
      !v.startsWith("/") &&
      !/[\\\x00-\x1f]/.test(v) &&
      v.split("/").every((p) => p && p !== "." && p !== ".."),
  );
export const syncManifestEntry = z
  .object({
    key: hash,
    source: z.string().max(200),
    course_id: z.number().int().positive(),
    activity_id: z.number().int().positive(),
    section_id: z.number().int(),
    name: z.string().min(1).max(500),
    path: relativePath,
    sha256: hash,
    bytes: z.number().int().min(0),
    etag: header.optional(),
    last_modified: header.optional(),
    // Omission means the caller asserts the last saved version is still present.
    // null means missing; a different hash means locally modified.
    local_sha256: hash.nullable().optional(),
  })
  .strict();
export type SyncEntry = z.infer<typeof syncManifestEntry>;
