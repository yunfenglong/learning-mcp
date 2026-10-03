import { describe, expect, it } from "vitest";
import { loadConfig, type Env } from "../src/config.ts";
import { unitSchema } from "../src/domain/units.ts";
import { finishDiscovery, normalizeCourse } from "../src/accounts/courses.ts";
import { unit } from "./support.ts";
describe("generic deployment scope", () => {
  const env = (moodle: string, ontrack = "https://tasks.company.example") =>
    ({
      ISSUER: "https://suite.example",
      PLATFORM_CONFIG: JSON.stringify({
        moodle: { site_url: moodle },
        ontrack: { site_url: ontrack },
      }),
    }) as Env;
  it("accepts unrelated administrator-configured HTTPS hosts, including an empty deployment", () => {
    expect(
      loadConfig(env("https://courses.school.example")).platforms.moodle
        ?.site_url,
    ).toBe("https://courses.school.example");
    expect(
      loadConfig({
        ...env("https://courses.school.example"),
        PLATFORM_CONFIG: "{}",
      }).platforms,
    ).toEqual({});
  });
  it("rejects insecure origins, credentials and non-origin URL components", () => {
    for (const site of [
      "http://courses.example",
      "https://user:password@courses.example",
      "https://courses.example/path",
      "https://courses.example/?token=x",
      "https://courses.example/#fragment",
    ])
      expect(() => loadConfig(env(site))).toThrow();
  });
  it("accepts only explicitly configured provider types and HTTPS origins", () => {
    const base = env("https://courses.example");
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
