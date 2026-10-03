import { describe, expect, it } from "vitest";
import {
  extractCandidates,
  findAttendanceCode,
} from "../src/workflows/attendance.ts";
import type { Evidence } from "../src/domain/evidence.ts";
import { unit } from "./support.ts";

const date = "2026-10-03";
const source = (text: string, extra: Partial<Evidence> = {}): Evidence => ({
  source: "ed",
  source_id: "1",
  unit_key: unit.key,
  title: "Applied attendance",
  text,
  url: "https://edstem.org/us/courses/101/discussion/1",
  published_at: "2026-10-03T02:00:00Z",
  ...extra,
});

describe("attendance evidence", () => {
  it("requires an explicit code label and preserves evidence", () => {
    const result = extractCandidates(
      unit,
      { date, session_type: "Applied", group: "2" },
      [source("2026-10-03 Applied Group 2\nAttendance code: AB123")],
    );
    expect(result).toMatchObject([
      {
        code: "AB123",
        class_date: date,
        date_basis: "explicit",
        match: "matches_context",
      },
    ]);
    expect(result[0]!.evidence[0]!.excerpt).toContain("AB123");
    expect(
      extractCandidates(unit, { date }, [
        source(
          "Assessment 12345 due today. Attendance code will be posted later.",
        ),
      ]),
    ).toEqual([]);
  });
  it("does not reuse an old code just because a post was published today", () => {
    expect(
      extractCandidates(unit, { date }, [
        source("2026-10-02 Attendance code: 9988"),
      ]),
    ).toEqual([]);
    expect(
      extractCandidates(unit, { date }, [source("Attendance code: 9988")])[0]!
        .match,
    ).toBe("needs_confirmation");
  });
  it("resolves today using the unit timezone", () => {
    const result = extractCandidates(
      { ...unit, timezone: "Asia/Tokyo" },
      { date },
      [
        source("Today's attendance code: 5533", {
          published_at: "2026-10-02T18:00:00Z",
        }),
      ],
    );
    expect(result[0]).toMatchObject({
      class_date: date,
      date_basis: "relative",
      match: "matches_context",
    });
  });
  it("keeps group context separate and rejects evidence from another course", () => {
    const result = extractCandidates(unit, { date, group: "2" }, [
      source(
        "2026-10-03 Group 1 Attendance code: 1111\n\n2026-10-03 Group 2 Attendance code: 2222",
      ),
      source("2026-10-03 Group 2 Attendance code: 3333", { unit_key: "other" }),
    ]);
    expect(result.find((c) => c.code === "1111")!.match).toBe(
      "needs_confirmation",
    );
    expect(result.find((c) => c.code === "2222")!.match).toBe(
      "matches_context",
    );
    expect(result.some((c) => c.code === "3333")).toBe(false);
  });
  it("preserves leading zeroes and deduplicates supporting sources", () => {
    const result = extractCandidates(unit, { date }, [
      source("2026-10-03 Attendance code: 00123"),
      source("2026-10-03 Attendance code: 00123", {
        source: "moodle",
        url: "https://moodle.example.edu/mod/forum/discuss.php?d=1",
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.code).toBe("00123");
    expect(result[0]!.evidence).toHaveLength(2);
  });
  it("reports conflicting codes instead of choosing one", async () => {
    const searched = {
      searchAttendance: async () => ({
        evidence: [
          source("2026-10-03 Attendance code: 1111"),
          source("2026-10-03 Attendance code: 2222"),
        ],
        coverage: {
          source: "ed" as const,
          status: "searched" as const,
          examined: 2,
        },
      }),
    };
    const result = await findAttendanceCode(
      unit,
      { date },
      { ed: searched, moodle: searched },
    );
    expect(result.status).toBe("ambiguous");
  });
  it("does not turn an unavailable source into not_found or reveal its error", async () => {
    const result = await findAttendanceCode(
      unit,
      { date },
      {
        ed: {
          searchAttendance: async () => {
            throw new Error("secret-token");
          },
        },
        moodle: {
          searchAttendance: async () => ({
            evidence: [],
            coverage: { source: "moodle", status: "searched", examined: 0 },
          }),
        },
      },
    );
    expect(result.status).toBe("partial");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
  it("rejects invalid calendar dates", () => {
    expect(() => extractCandidates(unit, { date: "2026-02-30" }, [])).toThrow();
  });
});
