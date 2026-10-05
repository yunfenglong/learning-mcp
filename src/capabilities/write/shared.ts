import { z } from "zod";
import type { Platform } from "../../domain/units.ts";
export const id = z.number().int().positive(),
  ref = z.union([id, z.string().min(1).max(200)]),
  unit = z.string().min(1).max(100);
export const body = z.string().min(1).max(20000),
  upload = z.string().regex(/^[a-f0-9]{64}$/);
export const edThread = {
  unit,
  thread_id: id.optional(),
  number: id.optional(),
  comment_id: id.optional(),
  body,
  type: z.enum(["answer", "comment"]).optional(),
  anonymous: z.boolean().default(false),
  private: z.boolean().default(false),
};
export function capability<S extends z.ZodRawShape>(
  platform: Platform,
  operation: string,
  description: string,
  shape: S,
) {
  return {
    name: `${platform}_${operation}`,
    platform,
    operation,
    description: `Beta: prepare a write preview. ${description} Show the entire preview, then call confirm_platform_write only after explicit user confirmation. This call does not execute the mutation.`,
    input: z.object(shape).strict(),
  };
}
