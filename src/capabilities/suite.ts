import { z } from "zod";
import { defineRead } from "./definition.ts";
import { resolveUnit } from "../domain/units.ts";

import { findAttendanceCode } from "../workflows/attendance.ts";
import { unit } from "./schemas.ts";

export const suiteCapabilities = [
  defineRead(
    "course_units",
    "List linked courses with campus, teaching period, timezone and platform IDs.",
    {},
    undefined,
    "",
    async (args, { config, adapters }) => ({ units: config.units }),
  ),
  defineRead(
    "find_attendance_code",
    "Find attendance-code candidates in Ed and Moodle text for a class date, with source links, context and explicit search coverage. Date is in the unit's timezone. Does not check or submit to the attendance portal.",
    {
      unit,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      session_type: z.string().trim().min(1).max(50).optional(),
      group: z.string().trim().min(1).max(50).optional(),
    },
    undefined,
    "",
    async (args, { config, adapters }) =>
      findAttendanceCode(resolveUnit(config.units, args.unit), args, adapters),
  ),
] as const;
