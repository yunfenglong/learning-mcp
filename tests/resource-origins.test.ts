import { describe, expect, it } from "vitest";
import { loadConfig, type Env } from "../src/config.ts";
import { resourceOriginAllowed } from "../src/platforms/resource-origins.ts";
import { fetchMoodleFile } from "../src/platforms/read/moodle-files.ts";

const env = { ISSUER: "https://suite.example" } as Env;

describe("generic resource origin rules", () => {
  it("supports new CDN distributions without storing instance-specific origins", () => {
    const config = loadConfig(env);
    for (const origin of [
      "https://first-distribution.cloudfront.net",
      "https://another-distribution.cloudfront.net",
      "https://files.edusercontent.com",
      "https://edusercontent.com",
    ])
      expect(resourceOriginAllowed(origin, config.resourceOrigins ?? [])).toBe(
        true,
      );
    expect(
      resourceOriginAllowed(
        "https://unconfigured.example.edu",
        config.resourceOrigins ?? [],
      ),
    ).toBe(false);
  });
  it("normalizes wildcard rules and preserves explicit overrides, including an empty policy", () => {
    const origins = loadConfig({
      ...env,
      RESOURCE_ORIGINS:
        '["https://*.CDN.example.edu/","https://files.example.edu:8443"]',
    }).resourceOrigins;
    expect(origins).toEqual([
      "https://*.cdn.example.edu",
      "https://files.example.edu:8443",
    ]);
    expect(
      resourceOriginAllowed("https://new.cdn.example.edu/file", origins ?? []),
    ).toBe(true);
    expect(
      resourceOriginAllowed(
        "https://files.example.edu:8443/file",
        origins ?? [],
      ),
    ).toBe(true);
    expect(
      resourceOriginAllowed("https://new.cloudfront.net", origins ?? []),
    ).toBe(false);
    expect(
      loadConfig({ ...env, RESOURCE_ORIGINS: "[]" }).resourceOrigins,
    ).toEqual([]);
  });
  it("matches DNS labels and ports without accepting lookalikes or the wildcard apex", () => {
    const rules = ["https://*.cdn.example.edu"];
    expect(resourceOriginAllowed("https://a.b.cdn.example.edu", rules)).toBe(
      true,
    );
    for (const url of [
      "https://cdn.example.edu",
      "https://badcdn.example.edu",
      "https://cdn.example.edu.evil.example",
      "https://a.cdn.example.edu:8443",
      "http://a.cdn.example.edu",
      "https://user:secret@a.cdn.example.edu",
      "https://127.0.0.1",
      "https://files.internal",
    ])
      expect(resourceOriginAllowed(url, rules), url).toBe(false);
  });
  it.each([
    "*",
    "https://*",
    "https://*.com",
    "https://*.127.0.0.1",
    "https://*.internal",
    "https://*.files.internal",
    "https://foo.*.example.edu",
    "https://*.cdn.example.edu/path",
    "https://*.cdn.example.edu?token=secret",
    "http://*.cdn.example.edu",
    "https://user:secret@*.cdn.example.edu",
  ])("rejects invalid operator rule %s", (rule) => {
    expect(() =>
      loadConfig({ ...env, RESOURCE_ORIGINS: JSON.stringify([rule]) }),
    ).toThrow();
  });
  it("follows a fresh Moodle file through different configured CDN hosts without forwarding credentials", async () => {
    const initial = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://one.cloudfront.net/spec" },
      });
    const calls: RequestInit[] = [];
    const network: typeof fetch = async (input, init) => {
      calls.push(init ?? {});
      expect(new Headers(init?.headers).has("cookie")).toBe(false);
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return String(input).includes("one.cloudfront.net")
        ? new Response(null, {
            status: 302,
            headers: { location: "https://two.cloudfront.net/spec" },
          })
        : new Response("specification");
    };
    const response = await fetchMoodleFile(
      "https://moodle.example.edu",
      "https://moodle.example.edu/pluginfile.php/1/spec",
      { headers: { cookie: "private", authorization: "private" } },
      initial,
      network,
      loadConfig(env).resourceOrigins ?? [],
    );
    expect(await response.text()).toBe("specification");
    expect(calls).toHaveLength(2);
  });
});
