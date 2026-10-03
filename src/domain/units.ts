import { z } from "zod";
import { SuiteError } from "../errors.ts";

const id = z.number().int().positive();
// Shared by the API schema and the browser's Unicode-set input pattern.
export const COURSE_CODE_PATTERN = String.raw`[A-Za-z0-9][A-Za-z0-9_.\/\-]*`;
export const unitSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    code: z
      .string()
      .min(1)
      .max(64)
      .regex(new RegExp(`^${COURSE_CODE_PATTERN}$`))
      .toUpperCase(),
    name: z.string().min(1).max(200),
    campus: z.string().min(1).max(100),
    year: z.number().int().min(2020).max(2100),
    teaching_period: z.string().min(1).max(50),
    timezone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Use an IANA timezone."),
    ed_course_id: id.optional(),
    moodle_course_id: id.optional(),
    ontrack_unit_id: id.optional(),
    ontrack_project_id: id.optional(),
  })
  .strict()
  .refine(
    (unit) =>
      Boolean(
        unit.ed_course_id || unit.moodle_course_id || unit.ontrack_project_id,
      ),
    "Configure at least one platform.",
  )
  .refine(
    (unit) =>
      Boolean(unit.ontrack_unit_id) === Boolean(unit.ontrack_project_id),
    "OnTrack needs both unit and project IDs.",
  );

export type Unit = z.infer<typeof unitSchema>;
export type Platform = "ed" | "moodle" | "ontrack";

export function parseUnits(input: unknown): Unit[] {
  const units = z.array(unitSchema).min(1).max(100).parse(input);
  if (new Set(units.map((unit) => unit.key)).size !== units.length)
    throw new SuiteError("INVALID_CONFIG", "Unit keys must be unique.");
  for (const field of [
    "ed_course_id",
    "moodle_course_id",
    "ontrack_project_id",
  ] as const) {
    const ids = units.flatMap((unit) =>
      unit[field] === undefined ? [] : [unit[field]],
    );
    if (new Set(ids).size !== ids.length)
      throw new SuiteError(
        "INVALID_CONFIG",
        `Each ${field} must belong to one configured unit.`,
      );
  }
  return units;
}

export function resolveUnit(units: readonly Unit[], reference: string): Unit {
  const exact = units.find((unit) => unit.key === reference);
  if (exact) return exact;
  const matches = units.filter((unit) => unit.code === reference.toUpperCase());
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1)
    throw new SuiteError(
      "AMBIGUOUS_UNIT",
      `Choose a unit key: ${matches.map((unit) => unit.key).join(", ")}.`,
    );
  throw new SuiteError(
    "UNIT_NOT_ALLOWED",
    "This unit is not in the Learning course registry.",
    403,
  );
}

export function assertOwnership(
  unit: Unit,
  platform: Platform,
  actual: unknown,
): void {
  const expected =
    platform === "ed"
      ? unit.ed_course_id
      : platform === "moodle"
        ? unit.moodle_course_id
        : unit.ontrack_project_id;
  if (!expected || typeof actual !== "number" || expected !== actual) {
    throw new SuiteError(
      "ENTITY_NOT_ALLOWED",
      "The requested item does not belong to this configured course.",
      403,
    );
  }
}

export function assertDate(value: string): string {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new SuiteError(
      "INVALID_DATE",
      "Use a valid calendar date in YYYY-MM-DD format.",
    );
  }
  return value;
}
