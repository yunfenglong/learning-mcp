import { describe, expect, it } from "vitest";
import { loadConfig, type Env } from "../src/config.ts";
import {
  COURSE_CODE_PATTERN,
  resolveUnit,
  unitSchema,
} from "../src/domain/units.ts";
import { finishDiscovery, normalizeCourse } from "../src/accounts/courses.ts";
import { unit } from "./support.ts";
describe("generic deployment scope", () => {
  it("preserves slash-separated course codes in validation and lookup", () => {
    const combined = unitSchema.parse({ ...unit, code: "cs101/cs201" });
    expect(combined.code).toBe("CS101/CS201");
    expect(resolveUnit([combined], "cs101/cs201")).toEqual(combined);
    const browserPattern = new RegExp(`^(?:${COURSE_CODE_PATTERN})$`, "v");
    expect(browserPattern.test(combined.code)).toBe(true);
    for (const code of [
      "CS101\\CS201",
      "CS101\nCS201",
      "CS101<script>",
      "A".repeat(65),
    ])
      expect(unitSchema.safeParse({ ...unit, code }).success).toBe(false);
  });
  const env = () => ({ ISSUER: "https://suite.example" }) as Env;
  it("defaults to Ed and accepts optional verified Ed institution scope", () => {
    expect(loadConfig(env()).platforms).toEqual({
      ed: { site_url: "https://edstem.org" },
    });
    expect(
      loadConfig({
        ...env(),
        PLATFORM_CONFIG: JSON.stringify({
          ed: { site_url: "https://edstem.org", institution_ids: [123] },
        }),
      }).platforms.ed?.institution_ids,
    ).toEqual([123]);
  });
  it("rejects operator-supplied Moodle and OnTrack addresses", () => {
    for (const platform of ["moodle", "ontrack"])
      expect(() =>
        loadConfig({
          ...env(),
          PLATFORM_CONFIG: JSON.stringify({
            [platform]: { site_url: "https://courses.school.example" },
          }),
        }),
      ).toThrow();
  });
  it("supports exact public resource origins and rejects private or malformed origins", () => {
    expect(
      loadConfig({
        ...env(),
        RESOURCE_ORIGINS: '["https://files.edusercontent.com/"]',
      }).resourceOrigins,
    ).toEqual(["https://files.edusercontent.com"]);
    for (const origin of [
      "https://127.0.0.1",
      "https://files.internal",
      "https://files.example/path",
      "https://user:secret@files.example",
    ])
      expect(() =>
        loadConfig({ ...env(), RESOURCE_ORIGINS: JSON.stringify([origin]) }),
      ).toThrow();
  });
  it("rejects insecure origins, credentials and non-origin URL components", () => {
    for (const site of [
      "http://courses.example",
      "https://user:password@courses.example",
      "https://courses.example/path",
      "https://courses.example/?token=x",
      "https://courses.example/#fragment",
    ])
      expect(() =>
        loadConfig({
          ...env(),
          PLATFORM_CONFIG: JSON.stringify({ ed: { site_url: site } }),
        }),
      ).toThrow();
  });
  it("accepts only explicitly configured provider types and HTTPS origins", () => {
    const base = env();
    expect(
      loadConfig({
        ...base,
        SSO_PROVIDERS:
          '[{"type":"okta","origin":"https://tenant.okta.example/"}]',
      }).ssoProviders,
    ).toEqual([{ type: "okta", origin: "https://tenant.okta.example" }]);
    for (const provider of [
      { type: "unknown", origin: "https://tenant.example" },
      { type: "okta", origin: "http://tenant.example" },
      { type: "okta", origin: "https://tenant.example/path" },
    ])
      expect(() =>
        loadConfig({ ...base, SSO_PROVIDERS: JSON.stringify([provider]) }),
      ).toThrow();
  });
  it("supports generic course codes and locations without inferring Ed scope from other courses", () => {
    expect(
      unitSchema.parse({ ...unit, code: "cs-101", campus: "north-campus" }),
    ).toMatchObject({ code: "CS-101", campus: "north-campus" });
    const courses = [
      normalizeCourse("ed", {
        id: 1,
        code: "CS-101",
        campus: "north",
        year: 2026,
        session: "S2",
        scope_verified: false,
      }),
      normalizeCourse("moodle", {
        id: 2,
        shortname: "CS-101 2026 S2",
        campus: "north",
      }),
    ];
    expect(finishDiscovery(courses, []).courses[0]?.accessible).toBe(false);
  });
});
