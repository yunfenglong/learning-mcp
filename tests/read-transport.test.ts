import { describe, expect, it, vi } from "vitest";
import { SuiteError } from "../src/errors.ts";
import {
  PlatformReadBoundary,
  platformReadError,
} from "../src/platforms/read/error.ts";
import { fetchMoodleFile } from "../src/platforms/read/moodle-files.ts";
import { responseBytes } from "../src/platforms/read/files.ts";
import { EdClient } from "../vendor/ed/client.js";

const site = "https://moodle.example.edu";
const file = `${site}/pluginfile.php/1/spec.docx`;

describe("safe vendor error boundaries", () => {
  it("keeps concurrent wrapped failures isolated", async () => {
    const boundary = new PlatformReadBoundary("moodle");
    const fetch = boundary.fetch(async (input) => {
      await Promise.resolve();
      throw new SuiteError(String(input), `Safe failure ${input}`, 403);
    });
    const results = await Promise.allSettled(
      ["A", "B"].map((code) =>
        boundary.run(async () => {
          try {
            await fetch(code);
          } catch (error) {
            throw new Error(`Vendor wrapper: ${(error as Error).message}`);
          }
        }),
      ),
    );
    expect(
      results.map(
        (result) => result.status === "rejected" && result.reason.code,
      ),
    ).toEqual(["A", "B"]);
  });
  it("does not mistake a recovered optional fetch for a later unrelated failure", async () => {
    const boundary = new PlatformReadBoundary("moodle");
    const fetch = boundary.fetch(async () => {
      throw new SuiteError("FILE_TOO_LARGE", "Optional response too large");
    });
    await expect(
      boundary.run(async () => {
        await fetch(file).catch(() => {});
        throw Object.assign(new Error("HTTP 404 credential-canary"), {
          code: "not_found",
        });
      }),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });
  it.each([
    ["auth_expired", 401, "PLATFORM_SESSION_EXPIRED"],
    ["network", 0, "UPSTREAM_UNAVAILABLE"],
    ["upstream", 503, "UPSTREAM_UNAVAILABLE"],
    ["upstream", 403, "PLATFORM_REQUEST_REJECTED"],
  ])(
    "classifies official Ed errors (%s, %s) without exposing their body",
    async (kind, status, code) => {
      const client = new EdClient({
        token: "test",
        maxRetries: 0,
        fetch: async () => {
          if (kind === "network") throw new Error("credential-canary");
          return new Response("credential-canary", { status: Number(status) });
        },
      });
      const error = await client.fetchUser().catch((error) => error);
      const result = platformReadError("ed", error);
      expect(result.code).toBe(code);
      expect(result.message).not.toContain("credential-canary");
    },
  );
});

describe("Moodle file redirect transport", () => {
  it.each([
    [
      "https://blocked.example/spec?token=canary",
      "RESOURCE_ORIGIN_NOT_ALLOWED",
    ],
    ["http://files.example/spec", "SITE_NOT_ALLOWED"],
    ["https://user:canary@files.example/spec", "SITE_NOT_ALLOWED"],
    ["/login/index.php", "PLATFORM_SESSION_EXPIRED"],
  ])(
    "rejects unsafe destination %s before making a request",
    async (destination, code) => {
      const authenticated = vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: destination },
          }),
      );
      const network = vi.fn();
      const error = await fetchMoodleFile(
        site,
        file,
        undefined,
        authenticated,
        network,
        ["https://files.example"],
      ).catch((error) => error);
      expect(error.code).toBe(code);
      expect(error.message).not.toContain("canary");
      expect(authenticated).toHaveBeenCalledOnce();
      expect(network).not.toHaveBeenCalled();
    },
  );
  it("limits redirect cycles and rejects a missing Location", async () => {
    const loop = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: file } }),
    );
    await expect(
      fetchMoodleFile(site, file, undefined, loop, vi.fn(), []),
    ).rejects.toMatchObject({ code: "FILE_REDIRECT_LIMIT" });
    expect(loop).toHaveBeenCalledTimes(6);
    await expect(
      fetchMoodleFile(
        site,
        file,
        undefined,
        async () => new Response(null, { status: 302 }),
        vi.fn(),
        [],
      ),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
  });
  it("strips all platform credentials on each approved resource hop", async () => {
    const authenticated = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://files.example/first" },
        }),
    );
    const network = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) =>
        String(input).endsWith("first")
          ? new Response(null, {
              status: 302,
              headers: { location: "https://second.example/spec" },
            })
          : new Response("spec"),
    );
    const response = await fetchMoodleFile(
      site,
      file,
      {
        headers: {
          Cookie: "private",
          Authorization: "private",
          Username: "private",
          "Auth-Token": "private",
        },
      },
      authenticated,
      network,
      ["https://files.example", "https://second.example"],
    );
    expect(await response.text()).toBe("spec");
    expect(network).toHaveBeenCalledTimes(2);
    for (const [, init] of network.mock.calls) {
      expect([...new Headers(init?.headers).keys()]).toEqual(["accept"]);
      expect(init?.redirect).toBe("manual");
    }
  });
});

describe("file integrity", () => {
  it("refuses a partial range response instead of delivering it as a complete file", async () => {
    await expect(
      responseBytes(
        new Response("ab", {
          status: 206,
          headers: { "content-range": "bytes 0-1/20" },
        }),
      ),
    ).rejects.toMatchObject({ code: "FILE_INCOMPLETE" });
  });
  it("refuses a truncated uncompressed response", async () => {
    await expect(
      responseBytes(
        new Response("ab", { headers: { "content-length": "20" } }),
      ),
    ).rejects.toMatchObject({ code: "FILE_INCOMPLETE" });
  });
  it("does not compare decoded bytes to a compressed Content-Length", async () => {
    expect(
      await responseBytes(
        new Response("decoded body", {
          headers: { "content-length": "2", "content-encoding": "gzip" },
        }),
      ),
    ).toHaveLength(12);
  });
});
