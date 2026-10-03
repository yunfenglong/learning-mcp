import { describe, expect, it, vi } from "vitest";
import { platformFetch, safeJsonFetch } from "../src/platforms/network.ts";
const site = "https://moodle.example.edu";
describe("platform network boundaries", () => {
  it("allows Moodle's own redirect handling within the trusted origin and preserves source URL", async () => {
    const transport = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response("redirect", {
          status: 302,
          headers: { location: "/grade/report/user/index.php?id=202" },
        }),
    );
    const read = platformFetch(site, transport as typeof fetch, true);
    const response = await read(`${site}/course/user.php`);
    expect(response.status).toBe(302);
    expect(response.url).toBe(`${site}/course/user.php`);
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });
  it("never follows login, cross-origin or credential-bearing redirects", async () => {
    for (const target of [
      "/login/index.php",
      "https://evil.example/",
      "https://user:secret@moodle.example.edu/",
    ]) {
      const transport = vi.fn(
        async () =>
          new Response(null, { status: 302, headers: { location: target } }),
      );
      await expect(
        platformFetch(site, transport as typeof fetch, true)(`${site}/my/`),
      ).rejects.toMatchObject({ code: "PLATFORM_SESSION_EXPIRED" });
      expect(transport).toHaveBeenCalledOnce();
    }
    const transport = vi.fn();
    await expect(
      platformFetch(site, transport)("https://evil.example/"),
    ).rejects.toMatchObject({ code: "SITE_NOT_ALLOWED" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects identity metadata redirects without issuing a second fetch", async () => {
    const transport = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/" },
        }),
    );
    vi.stubGlobal("fetch", transport);
    try {
      await expect(
        safeJsonFetch("https://idp.example/.well-known/openid-configuration"),
      ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(transport).toHaveBeenCalledOnce();
  });
});
