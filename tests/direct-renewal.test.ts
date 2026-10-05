import { describe, expect, it, vi } from "vitest";
import { DirectBackend } from "../src/platforms/direct.ts";
import type { Env } from "../src/config.ts";

describe("bundled-client renewal errors", () => {
  it.each([
    [
      503,
      { password: "credential-canary" },
      "UPSTREAM_UNAVAILABLE",
      "HTTP 503",
    ],
    [
      403,
      { token: "credential-canary" },
      "PLATFORM_REQUEST_REJECTED",
      "HTTP 403",
    ],
    [
      200,
      [
        {
          id: 1,
          unit: {
            id: 2,
            code: "ANY1",
            name: "Example",
            start_date: "not-a-date",
          },
        },
      ],
      "UPSTREAM_RESPONSE_INVALID",
      "unit start_date must be a civil date",
    ],
  ])(
    "preserves a safe OnTrack diagnosis for HTTP %s",
    async (status, data, code, message) => {
      const backend = new DirectBackend(
        {
          SSO_BROKER: {
            fetch: async () =>
              Response.json({
                username: "user",
                token: "access",
                profile_id: "user",
              }),
          },
          BROKER_SERVICE_TOKEN: "x".repeat(32),
        } as unknown as Env,
        "a".repeat(64),
        "ontrack",
        {
          issuer: "https://suite.example.com",
          units: [],
          platforms: { ontrack: { site_url: "https://ontrack.example.edu" } },
        },
        vi.fn(async () => Response.json(data, { status })) as typeof fetch,
      );
      await expect(backend.call("list_courses", {})).rejects.toMatchObject({
        code,
        message: expect.stringContaining(message),
      });
      try {
        await backend.call("list_courses", {});
      } catch (error) {
        expect(String(error)).not.toContain("credential-canary");
      }
    },
  );
  it("uses broker-verified Moodle context when the site-info webservice is disabled", async () => {
    const broker = vi.fn(async () =>
      Response.json({
        cookie_name: "MoodleSession",
        cookie_value: "valid",
        sesskey: "key",
        userid: 12,
        profile_id: "12",
        display_name: "Student",
      }),
    );
    const network = vi.fn(async () =>
      Response.json([
        {
          error: true,
          exception: {
            errorcode: "servicenotavailable",
            message: "Disabled service",
          },
        },
      ]),
    );
    const backend = new DirectBackend(
      {
        SSO_BROKER: { fetch: broker },
        BROKER_SERVICE_TOKEN: "x".repeat(32),
      } as unknown as Env,
      "a".repeat(64),
      "moodle",
      {
        issuer: "https://suite.example.com",
        units: [],
        platforms: { moodle: { site_url: "https://moodle.example.edu" } },
      },
      network,
    );
    const client = await backend.api("moodle");
    expect(await client.getSiteInfo()).toMatchObject({
      userid: 12,
      fullname: "Student",
    });
  });
  it("preserves actionable broker errors across the OnTrack refresh callback", async () => {
    const broker = vi.fn(async (request: Request) => {
      if (new URL(request.url).pathname === "/v1/session")
        return Response.json({
          username: "user",
          token: "access",
          profile_id: "user",
        });
      return Response.json(
        {
          code: "MFA_REQUIRED",
          message: "Provide a current code on the account page.",
        },
        { status: 409 },
      );
    });
    const backend = new DirectBackend(
      {
        SSO_BROKER: { fetch: broker },
        BROKER_SERVICE_TOKEN: "x".repeat(32),
      } as unknown as Env,
      "a".repeat(64),
      "ontrack",
      {
        issuer: "https://suite.example.com",
        units: [],
        platforms: { ontrack: { site_url: "https://ontrack.example.edu" } },
      },
      vi.fn(async () => new Response(null, { status: 419 })) as typeof fetch,
    );
    await expect(backend.call("list_courses", {})).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    expect(broker).toHaveBeenCalledTimes(2);
  });
  it("recovers a rejected access token once on HTTP 401", async () => {
    let token = "access-a";
    const broker = vi.fn(async (request: Request) => {
      if (new URL(request.url).pathname === "/v1/renew") token = "access-b";
      return Response.json({ username: "user", token, profile_id: "user" });
    });
    const network = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json([]));
    const backend = new DirectBackend(
      {
        SSO_BROKER: { fetch: broker },
        BROKER_SERVICE_TOKEN: "x".repeat(32),
      } as unknown as Env,
      "a".repeat(64),
      "ontrack",
      {
        issuer: "https://suite.example.com",
        units: [],
        platforms: { ontrack: { site_url: "https://ontrack.example.edu" } },
      },
      network,
    );
    expect(await backend.call("list_courses", {})).toEqual([]);
    expect(network).toHaveBeenCalledTimes(2);
    expect(
      broker.mock.calls.map(([request]) => new URL(request.url).pathname),
    ).toEqual(["/v1/session", "/v1/renew", "/v1/session"]);
  });
});
