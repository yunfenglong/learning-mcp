import { describe, expect, it } from "vitest";
import { AccountStore } from "../src/auth/state.ts";
import { finishDiscovery, normalizeCourse } from "../src/accounts/courses.ts";
import { MemoryStore, key, unit } from "./support.ts";

const first = {
  ...unit,
  key: "cs101",
  code: "CS101",
  ontrack_unit_id: undefined,
  ontrack_project_id: undefined,
};
const second = {
  ...first,
  key: "cs202",
  code: "CS202",
  ed_course_id: 102,
  moodle_course_id: 203,
};
function discovery() {
  return finishDiscovery(
    [
      normalizeCourse("ed", {
        id: 101,
        code: "CS101",
        year: 2026,
        session: "S2",
        campus: "main",
      }),
      normalizeCourse("moodle", {
        id: 202,
        shortname: "CS101_S2_2026",
        fullname: "Example course",
      }),
      normalizeCourse("ed", {
        id: 102,
        code: "CS202",
        year: 2026,
        session: "S2",
        campus: "main",
      }),
      normalizeCourse("moodle", {
        id: 203,
        shortname: "CS202_S2_2026",
        fullname: "Another course",
      }),
      normalizeCourse("ontrack", { id: 404, unit: { id: 303, code: "CS101" } }),
    ],
    [],
  );
}
async function fixture() {
  let now = Date.now();
  const storage = new MemoryStore();
  const account = new AccountStore(storage, "a".repeat(64), key, () => now);
  await account.discovered(discovery());
  return {
    storage,
    account,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

describe("confirmed batch course bindings", () => {
  it("confirms manually selected courses despite different labels, years, periods and locations", async () => {
    const f = await fixture();
    const chosen = {
      ...first,
      code: "CS102/CS101/CS103",
      year: 2025,
      teaching_period: "custom-term",
      campus: "user-selected-location",
    };
    const preview = await f.account.previewBindings([chosen]);
    expect(preview.courses[0]?.warnings).toContainEqual(
      expect.objectContaining({
        code: "DIFFERENT_COURSE_CONTEXT",
        platform: "ed",
        differences: {
          year: { discovered: 2026, selected: 2025 },
          teaching_period: { discovered: "S2", selected: "custom-term" },
          campus: { discovered: "main", selected: "user-selected-location" },
        },
      }),
    );
    expect(await f.account.units()).toEqual([]);
    await f.account.confirmBindings(preview.preview_id);
    expect(await f.account.units()).toEqual([chosen]);
  });
  it("suggests every slash component without assuming its position, prefix or order", () => {
    const result = finishDiscovery(
      [
        normalizeCourse("ed", { id: 1, code: "CS102/CS101/CS103" }),
        normalizeCourse("ed", { id: 2, code: "MATH-7" }),
        normalizeCourse("moodle", {
          id: 3,
          shortname: "CS103/CS102/CS101_S2_2026",
        }),
        normalizeCourse("moodle", { id: 4, shortname: "CS101_S2_2026" }),
        normalizeCourse("moodle", { id: 5, shortname: "CS1010_S2_2026" }),
        normalizeCourse("moodle", { id: 6, shortname: "OTHER/MATH-7/THIRD" }),
        normalizeCourse("ontrack", { id: 7, unit: { id: 8, code: "CS101" } }),
      ],
      [],
    );
    const composite = result.suggestions.find(
      (s) => s.code === "CS102/CS101/CS103",
    )!;
    expect(composite.course_ids).toEqual([
      { platform: "ed", id: 1 },
      { platform: "moodle", id: 3 },
      { platform: "moodle", id: 4 },
      { platform: "ontrack", id: 7 },
    ]);
    expect(composite.ambiguous).toBe(true);
    expect(composite.needs_confirmation).toBe(true);
    expect(
      result.suggestions.find((s) => s.code === "CS101")?.course_ids,
    ).toContainEqual({ platform: "ed", id: 1 });
    expect(
      result.suggestions.find((s) => s.code === "MATH-7")?.course_ids,
    ).toContainEqual({ platform: "moodle", id: 6 });
    expect(result.courses[0]?.code).toBe("CS102/CS101/CS103");
  });
  it("treats display identifiers as evidence and previews their match to known codes", async () => {
    const f = await fixture();
    const result = await f.account.bind(first);
    expect(result.unit.code).toBe("CS101");
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        platform: "moodle",
        platform_code: "CS101_S2_2026",
        code: "DIFFERENT_PLATFORM_CODE",
      }),
    );
    const suggestion = discovery().suggestions.find((s) => s.code === "CS101")!;
    expect(suggestion.matches).toContainEqual({
      platform: "moodle",
      id: 202,
      evidence: "display_prefix",
    });
    expect(suggestion.needs_confirmation).toBe(true);
  });
  it("previews without editing, then atomically transfers selected links while retaining other platforms", async () => {
    const f = await fixture();
    const old = { ...unit, key: "old-key", code: "CS101" };
    await f.account.bind(old);
    const preview = await f.account.previewBindings([first, second]);
    expect(await f.account.units()).toEqual([old]);
    expect(preview.existing_changes).toContainEqual(
      expect.objectContaining({
        action: "update",
        before: old,
        after: expect.objectContaining({ ontrack_project_id: 404 }),
      }),
    );
    const after = await f.account.confirmBindings(preview.preview_id);
    expect(after.saved).toBe(2);
    const units = await f.account.units();
    expect(units).toHaveLength(3);
    expect(units.find((u) => u.key === "old-key")).toMatchObject({
      ontrack_project_id: 404,
    });
    expect(
      units.find((u) => u.key === "old-key")?.ed_course_id,
    ).toBeUndefined();
    expect(units.find((u) => u.key === "cs101")).toEqual(first);
    expect(units.find((u) => u.key === "cs202")).toEqual(second);
  });
  it("rejects a bad course or duplicate platform ID without deleting existing mappings", async () => {
    const f = await fixture();
    await f.account.bind(first);
    const before = await f.account.units();
    await expect(
      f.account.previewBindings([first, { ...second, moodle_course_id: 999 }]),
    ).rejects.toMatchObject({ code: "COURSE_NOT_ACCESSIBLE" });
    await expect(
      f.account.previewBindings([first, { ...second, ed_course_id: 101 }]),
    ).rejects.toThrow();
    expect(await f.account.units()).toEqual(before);
  });
  it("does not confirm another account's preview, an expired preview or a changed registry", async () => {
    const f = await fixture();
    const preview = await f.account.previewBindings([first]);
    const other = new AccountStore(new MemoryStore(), "b".repeat(64), key);
    await expect(
      other.confirmBindings(preview.preview_id),
    ).rejects.toMatchObject({ code: "BINDING_PREVIEW_EXPIRED" });
    f.tick(601_000);
    await expect(
      f.account.confirmBindings(preview.preview_id),
    ).rejects.toMatchObject({ code: "BINDING_PREVIEW_EXPIRED" });
    expect(await f.account.units()).toEqual([]);
    const fresh = await fixture();
    const draft = await fresh.account.previewBindings([first]);
    await fresh.account.bind(second);
    await expect(
      fresh.account.confirmBindings(draft.preview_id),
    ).rejects.toMatchObject({ code: "BINDING_PREVIEW_CHANGED" });
    expect(await fresh.account.units()).toEqual([second]);
  });
  it("rejects enrollment changes after preview and safely returns a receipt on confirmation retries", async () => {
    const f = await fixture();
    const draft = await f.account.previewBindings([first, second]);
    const changed = discovery();
    changed.courses = changed.courses.filter((c) => c.id !== 203);
    await f.account.discovered(changed);
    await expect(
      f.account.confirmBindings(draft.preview_id),
    ).rejects.toMatchObject({ code: "BINDING_PREVIEW_CHANGED" });
    expect(await f.account.units()).toEqual([]);
    await f.account.discovered(discovery());
    const preview = await f.account.previewBindings([first, second]);
    const results = await Promise.all([
      f.account.confirmBindings(preview.preview_id),
      f.account.confirmBindings(preview.preview_id),
    ]);
    expect(results.every((r) => r.saved === 2)).toBe(true);
    expect(results.filter((r) => "already_confirmed" in r)).toHaveLength(1);
    expect(await f.account.units()).toEqual([first, second]);
  });
  it("keeps same-code semester duplicates and competing prefixes ambiguous", () => {
    const result = finishDiscovery(
      [
        normalizeCourse("ed", {
          id: 1,
          code: "CS101",
          year: 2025,
          session: "S2",
        }),
        normalizeCourse("ed", {
          id: 2,
          code: "CS101",
          year: 2026,
          session: "S2",
        }),
        normalizeCourse("moodle", { id: 3, shortname: "CS101_S2_2026" }),
        normalizeCourse("moodle", { id: 4, shortname: "CS1010_S2_2026" }),
      ],
      [],
    );
    const proposal = result.suggestions.find((s) => s.code === "CS101")!;
    expect(proposal.ambiguous).toBe(true);
    expect(proposal.course_ids).not.toContainEqual({
      platform: "moodle",
      id: 4,
    });
    expect(proposal.needs_confirmation).toBe(true);
    const conflicting = finishDiscovery(
      [
        normalizeCourse("ed", {
          id: 5,
          code: "CS202",
          year: 2025,
          session: "S2",
        }),
        normalizeCourse("moodle", {
          id: 6,
          shortname: "CS202",
          year: 2026,
          session: "S2",
        }),
      ],
      [],
    );
    expect(conflicting.suggestions[0]?.ambiguous).toBe(true);
  });
});
