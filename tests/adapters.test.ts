import { describe, expect, it } from "vitest";
import { EdAdapter } from "../src/adapters/ed.ts";
import { MoodleAdapter } from "../src/adapters/moodle.ts";
import { OnTrackAdapter } from "../src/adapters/ontrack.ts";
import { parseUnits, resolveUnit } from "../src/domain/units.ts";
import { FakeBackend, unit } from "./support.ts";

describe("Learning scope", () => {
  it("requires a key for a course code shared across teaching periods", () => {
    const units = parseUnits([
      unit,
      {
        ...unit,
        key: "csc1001-my-2025-s2",
        year: 2025,
        ed_course_id: 102,
        moodle_course_id: 203,
        ontrack_project_id: 405,
      },
    ]);
    expect(() => resolveUnit(units, "CSC1001")).toThrow(/Choose a unit key/);
    expect(resolveUnit(units, unit.key)).toEqual(unit);
    expect(() => resolveUnit(units, "ABC9999")).toThrow();
  });
  it("rejects cross-course Ed IDs before returning content", async () => {
    const backend = new FakeBackend({
      get_thread: { courseId: 999, content: "private other-course data" },
      get_lesson: { courseId: 999 },
    });
    await expect(new EdAdapter(backend).thread(unit, 1)).rejects.toMatchObject({
      code: "ENTITY_NOT_ALLOWED",
    });
    await expect(new EdAdapter(backend).lesson(unit, 1)).rejects.toMatchObject({
      code: "ENTITY_NOT_ALLOWED",
    });
  });
  it("rejects a Moodle session for another site", async () => {
    const backend = new FakeBackend({
      get_user: { user: { siteurl: "https://attacker.example" } },
    });
    const adapter = new MoodleAdapter(backend, {
      site_url: "https://moodle.example.edu",
    });
    await expect(adapter.unit(unit)).rejects.toMatchObject({
      code: "SITE_NOT_ALLOWED",
    });
    expect(backend.calls).toHaveLength(1);
  });
  it("checks Moodle thread ownership", async () => {
    const backend = new FakeBackend({
      get_user: { user: { siteurl: "https://moodle.example.edu" } },
      thread: { thread: { unit_id: 999 } },
    });
    await expect(
      new MoodleAdapter(backend, {
        site_url: "https://moodle.example.edu",
      }).thread(unit, 1),
    ).rejects.toMatchObject({ code: "ENTITY_NOT_ALLOWED" });
  });
  it("reads full Moodle posts rather than extracting from search snippets", async () => {
    const backend = new FakeBackend({
      get_user: { user: { siteurl: "https://moodle.example.edu" } },
      search_forums: {
        results: [
          {
            unit_id: 202,
            discussion_id: 5,
            post_id: 6,
            name: "Attendance",
            snippet: "wrong truncated code",
          },
        ],
        total: 1,
      },
      thread: {
        thread: {
          id: 5,
          unit_id: 202,
          name: "Attendance",
          posts_total: 1,
          posts: [
            {
              id: 6,
              message_text: "2026-10-03 Attendance code: 1234",
              time_created: 1790992800,
            },
          ],
        },
      },
    });
    const result = await new MoodleAdapter(backend, {
      site_url: "https://moodle.example.edu",
    }).searchAttendance(unit, { date: "2026-10-03" });
    expect(result.evidence[0]!.text).toContain("1234");
    expect(result.evidence[0]!.text).not.toContain("truncated");
    expect(result.coverage.status).toBe("partial");
  });
  it("handles compact Moodle empty-search output", async () => {
    const backend = new FakeBackend({
      get_user: { user: { siteurl: "https://moodle.example.edu" } },
      search_forums: { total: 0 },
    });
    expect(
      (
        await new MoodleAdapter(backend, {
          site_url: "https://moodle.example.edu",
        }).searchAttendance(unit, { date: "2026-10-03" })
      ).evidence,
    ).toEqual([]);
  });
  it("rejects an OnTrack task outside the configured project before fetching it", async () => {
    const backend = new FakeBackend({
      list_tasks: [{ task_definition_id: 5 }],
    });
    await expect(
      new OnTrackAdapter(backend).task(unit, 999),
    ).rejects.toMatchObject({ code: "ENTITY_NOT_ALLOWED" });
    expect(backend.calls).toHaveLength(1);
  });
});
