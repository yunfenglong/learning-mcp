import type { Platform, Unit } from "../domain/units.ts";
import type { Config } from "../config.ts";
import { object, rows } from "../adapters/backend.ts";
export interface DiscoveredCourse {
  platform: Platform;
  id: number;
  unit_id?: number;
  name: string;
  code?: string;
  year?: number;
  teaching_period?: string;
  campus?: Unit["campus"];
  accessible: boolean;
  institution_basis: string;
}
export interface Discovery {
  courses: DiscoveredCourse[];
  coverage: Array<{ platform: Platform; status: string }>;
  suggestions: Array<{
    code: string;
    course_ids: Array<{ platform: Platform; id: number }>;
    needs_confirmation: boolean;
  }>;
  expires_at: number;
}
export function normalizeCourse(
  platform: Platform,
  input: unknown,
): DiscoveredCourse {
  const row = object(input),
    unit = platform === "ontrack" ? object(row.unit) : row;
  const name = String(
      unit.name ?? row.fullname ?? row.name ?? row.shortname ?? "",
    ).slice(0, 200),
    text = `${unit.code ?? row.shortname ?? ""} ${name} ${row.session ?? ""} ${row.year ?? ""}`;
  const code =
      String(unit.code ?? row.shortname ?? "")
        .split(/\s+/)[0]
        ?.toUpperCase() || undefined,
    year = text.match(/\b(20\d{2})\b/)?.[1];
  const period = text.match(/\b(?:S|SEMESTER\s*)([12])\b/i)?.[1];
  const campus =
    typeof (unit.campus ?? row.campus) === "string"
      ? String(unit.campus ?? row.campus).slice(0, 100)
      : undefined;
  return {
    platform,
    id: Number(row.id),
    ...(platform === "ontrack" ? { unit_id: Number(unit.id) } : {}),
    name,
    ...(code ? { code } : {}),
    ...(year ? { year: Number(year) } : {}),
    ...(period ? { teaching_period: `S${period}` } : {}),
    ...(campus ? { campus } : {}),
    accessible: platform !== "ed" || row.scope_verified !== false,
    institution_basis:
      platform === "ed"
        ? row.scope_verified === false
          ? "Outside the configured Ed institution scope"
          : "Verified enrollment; deployment Ed scope"
        : "Verified enrollment at the configured platform origin",
  };
}
export function finishDiscovery(
  courses: DiscoveredCourse[],
  coverage: Discovery["coverage"],
): Discovery {
  const codes = [...new Set(courses.flatMap((c) => (c.code ? [c.code] : [])))];
  return {
    courses,
    coverage,
    suggestions: codes.map((code) => ({
      code,
      course_ids: courses
        .filter((c) => c.code === code)
        .map((c) => ({ platform: c.platform, id: c.id })),
      needs_confirmation: true,
    })),
    expires_at: Date.now() + 10 * 60_000,
  };
}
export async function discover(
  config: Config,
  backends: Record<
    Platform,
    { call(name: string, args: Record<string, unknown>): Promise<unknown> }
  >,
): Promise<Discovery> {
  const names = ["ed", "moodle", "ontrack"] as const;
  const settled = await Promise.allSettled(
    names.map((p) =>
      config.platforms[p]
        ? backends[p].call("list_courses", {})
        : Promise.resolve(null),
    ),
  );
  const courses: DiscoveredCourse[] = [],
    coverage: Discovery["coverage"] = [];
  settled.forEach((result, i) => {
    const platform = names[i]!;
    if (result.status === "rejected") {
      coverage.push({ platform, status: "unavailable" });
      return;
    }
    if (result.value === null) {
      coverage.push({ platform, status: "not_configured" });
      return;
    }
    coverage.push({ platform, status: "available" });
    for (const row of rows(result.value, "courses")) {
      const c = normalizeCourse(platform, row);
      if (Number.isSafeInteger(c.id) && c.id > 0) courses.push(c);
    }
  });
  return finishDiscovery(courses, coverage);
}
