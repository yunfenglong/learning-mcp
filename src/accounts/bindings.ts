import { SuiteError } from "../errors.ts";
import { parseUnits, type Unit } from "../domain/units.ts";
import type { Discovery } from "./courses.ts";

const links = [
  ["ed", "ed_course_id"],
  ["moodle", "moodle_course_id"],
  ["ontrack", "ontrack_project_id"],
] as const;

export function validateCourseBinding(unit: Unit, discovery: Discovery) {
  const sources = [];
  const warnings = [];
  for (const [platform, field] of links) {
    const id = unit[field];
    if (!id) continue;
    const course = discovery.courses.find(
      (c) => c.platform === platform && c.id === id,
    );
    if (
      !course ||
      !course.accessible ||
      (platform === "ontrack" && course.unit_id !== unit.ontrack_unit_id)
    )
      throw new SuiteError(
        "COURSE_NOT_ACCESSIBLE",
        "Choose a verified course discovered for this account.",
        403,
      );
    const differences = Object.fromEntries(
      (["year", "teaching_period", "campus"] as const).flatMap((field) =>
        course[field] !== undefined && course[field] !== unit[field]
          ? [[field, { discovered: course[field], selected: unit[field] }]]
          : [],
      ),
    );
    if (Object.keys(differences).length)
      warnings.push({
        code: "DIFFERENT_COURSE_CONTEXT",
        platform,
        differences,
        message:
          "Platform semester or location details differ from your chosen mapping. Review these details before confirming; they do not prevent a manual association.",
      });
    sources.push({
      platform,
      id,
      name: course.name,
      platform_code: course.platform_code ?? course.code,
      year: course.year,
      teaching_period: course.teaching_period,
      campus: course.campus,
    });
    // A platform's display identifier is evidence, not the identity of the user's mapping.
    if (course.code && course.code !== unit.code)
      warnings.push({
        code: "DIFFERENT_PLATFORM_CODE",
        platform,
        platform_code: course.platform_code ?? course.code,
        message:
          "This platform uses a different course identifier. Confirm the selected course and teaching period.",
      });
  }
  if (
    sources.length > 1 &&
    sources.some((s) => !s.year || !s.teaching_period || !s.campus)
  )
    warnings.push({
      code: "INCOMPLETE_COURSE_CONTEXT",
      message:
        "Some platforms omit semester or location details. Check the selected courses before confirming.",
    });
  return { course: unit, sources, warnings };
}

export function planCourseBindings(
  current: readonly Unit[],
  courses: Unit[],
  discovery: Discovery,
) {
  const previews = courses.map((course) =>
    validateCourseBinding(course, discovery),
  );
  const existing_changes = [];
  const retained: Unit[] = [];
  for (const before of current) {
    const replacement = courses.find((course) => course.key === before.key);
    if (replacement) {
      existing_changes.push({ before, after: replacement, action: "replace" });
      continue;
    }
    const after = { ...before };
    let changed = false;
    for (const [platform, field] of links) {
      if (
        after[field] &&
        courses.some((course) => course[field] === after[field])
      ) {
        delete after[field];
        if (platform === "ontrack") delete after.ontrack_unit_id;
        changed = true;
      }
    }
    const remains = Boolean(
      after.ed_course_id || after.moodle_course_id || after.ontrack_project_id,
    );
    if (changed)
      existing_changes.push({
        before,
        ...(remains ? { after } : {}),
        action: remains ? "update" : "remove",
      });
    if (remains) retained.push(after);
  }
  const units = parseUnits([...retained, ...courses]);
  return { units, previews, existing_changes };
}
