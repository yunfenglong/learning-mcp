import { describe, expect, it } from "vitest";
import { loadConfig, type Env } from "../src/config.ts";
import { unitSchema } from "../src/domain/units.ts";
import { finishDiscovery, normalizeCourse } from "../src/accounts/courses.ts";
import { unit } from "./support.ts";
describe("generic deployment scope", () => {
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
