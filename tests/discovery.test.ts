import { describe, expect, it } from "vitest";
import { discover } from "../src/accounts/courses.ts";
import { SuiteError } from "../src/errors.ts";

describe("partial course discovery", () => {
  it("keeps successful platforms and exposes the failed platform's actionable error", async () => {
    const result = await discover(
      {
        issuer: "https://suite.example",
        units: [],
        platforms: {
          ed: { site_url: "https://edstem.org" },
          ontrack: { site_url: "https://ontrack.example.edu" },
        },
      },
      {
        ed: { call: async () => [{ id: 1, code: "ANY1" }] },
        moodle: { call: async () => [] },
        ontrack: {
          call: async () => {
            throw new SuiteError(
              "MFA_REQUIRED",
              "Provide a current code on the account page.",
              409,
            );
          },
        },
      },
    );
    expect(result.courses).toHaveLength(1);
    expect(result.coverage).toContainEqual({
      platform: "ontrack",
      status: "unavailable",
      error: {
        code: "MFA_REQUIRED",
        message: "Provide a current code on the account page.",
      },
    });
    expect(result.coverage).toContainEqual({
      platform: "moodle",
      status: "not_configured",
    });
  });
  it("does not expose unexpected exceptions in discovery output", async () => {
    const backend = {
      call: async () => {
        throw new Error("password=credential-canary");
      },
    };
    const result = await discover(
      {
        issuer: "https://suite.example",
        units: [],
        platforms: { ontrack: { site_url: "https://ontrack.example.edu" } },
      },
      { ed: backend, moodle: backend, ontrack: backend },
    );
    expect(result.coverage[2]).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
    expect(JSON.stringify(result)).not.toContain("credential-canary");
  });
});
