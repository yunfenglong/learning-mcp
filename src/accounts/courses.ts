import type { Platform, Unit } from "../domain/units.ts";
import type { Config } from "../config.ts";
import { object, rows } from "../adapters/backend.ts";
export interface DiscoveredCourse {
  platform: Platform;
  id: number;
  unit_id?: number;
  name: string;
  code?: string;
  platform_code?: string;
  code_source?: "code" | "shortname";
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
    ambiguous: boolean;
    matches: Array<{
      platform: Platform;
      id: number;
      evidence: "exact_code" | "display_prefix";
    }>;
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
    ...(code
      ? { code_source: unit.code ? ("code" as const) : ("shortname" as const) }
      : {}),
    ...((unit.code ?? row.shortname)
      ? { platform_code: String(unit.code ?? row.shortname).slice(0, 200) }
      : {}),
    ...(year ? { year: Number(year) } : {}),
    ...(period ? { teaching_period: `S${period}` } : {}),
    ...(campus ? { campus } : {}),
    accessible: platform !== "ed" || row.scope_verified !== false,
    institution_basis:
      platform === "ed"
        ? row.scope_verified === false
          ? "Outside the configured Ed institution scope"
          : "Verified enrollment; deployment Ed scope"
        : "Verified enrollment at the account's saved platform base link",
  };
}
export function finishDiscovery(
  courses: DiscoveredCourse[],
  coverage: Discovery["coverage"],
): Discovery {
  const explicit = courses.filter((c) => c.code_source === "code");
  const anchors = explicit.length ? explicit : courses;
  const codes = [...new Set(anchors.flatMap((c) => (c.code ? [c.code] : [])))];
  const groups = codes.map((code) => ({
    code,
    matches: courses.flatMap((c) => {
      const display = (c.platform_code ?? c.code ?? "").toUpperCase();
      const prefix =
        c.code_source === "shortname" &&
        display.startsWith(code) &&
        display.length > code.length &&
        /[^A-Z0-9]/.test(display[code.length]!);
      if (c.code !== code && !prefix) return [];
      return [
        {
          platform: c.platform,
          id: c.id,
          evidence:
            c.code === code
              ? ("exact_code" as const)
              : ("display_prefix" as const),
        },
      ];
    }),
  }));
  // Display prefixes are candidate evidence only, never an automatic identity rule.
  for (const course of courses) {
    if (
      course.code &&
      !groups.some((g) =>
        g.matches.some(
          (c) => c.platform === course.platform && c.id === course.id,
        ),
      )
    )
      groups.push({
        code: course.code,
        matches: [
          { platform: course.platform, id: course.id, evidence: "exact_code" },
        ],
      });
  }
  return {
    courses,
    coverage,
    suggestions: groups.map(({ code, matches }) => {
      const selected = courses.filter((c) =>
        matches.some((m) => m.platform === c.platform && m.id === c.id),
      );
      const conflictingContext = (
        ["year", "teaching_period", "campus"] as const
      ).some(
        (field) =>
          new Set(
            selected.flatMap((c) => (c[field] === undefined ? [] : [c[field]])),
          ).size > 1,
      );
      return {
        code,
        course_ids: matches.map(({ platform, id }) => ({ platform, id })),
        matches,
        ambiguous:
          conflictingContext ||
          matches.some(
            (match) =>
              matches.filter((c) => c.platform === match.platform).length > 1 ||
              groups.filter((g) =>
                g.matches.some(
                  (c) => c.platform === match.platform && c.id === match.id,
                ),
              ).length > 1,
          ),
        needs_confirmation: true,
      };
    }),
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
