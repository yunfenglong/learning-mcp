import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OutputBoundary } from "../src/security/output.ts";
import { createServer } from "../src/mcp/server.ts";
import { EdAdapter } from "../src/adapters/ed.ts";
import { MoodleAdapter } from "../src/adapters/moodle.ts";
import { OnTrackAdapter } from "../src/adapters/ontrack.ts";
import { FakeBackend, unit } from "./support.ts";
import { SuiteError, publicError } from "../src/errors.ts";
import type { AccountService } from "../src/accounts/service.ts";

describe("credential output boundary", () => {
  it("redacts nested credential fields and capability URL parameters without removing course content", () => {
    const guard = new OutputBoundary();
    const result = guard.redact({
      key: "course-key",
      code: "123ABC",
      title: "Token parsing",
      tasks: [
        {
          id: 1,
          auth_token: "canary-auth",
          refreshToken: "canary-refresh",
          password: "canary-password",
          cookies: [{ value: "canary-cookie" }],
          content:
            '<a href="https://moodle.example.edu/a?id=1&amp;sesskey=canary-session">Course</a>',
          url: "https://platform.example/a?access_token=canary-access#api_key=canary-key",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("canary-");
    expect(result).toMatchObject({
      key: "course-key",
      code: "123ABC",
      title: "Token parsing",
      tasks: [{ id: 1 }],
    });
  });
  it("redacts known secrets in raw text, encoded links and JSON strings and does not share them between accounts", () => {
    const secret = 'credential-canary+/&"value';
    const guard = new OutputBoundary();
    guard.remember(secret);
    const text = [
      secret,
      encodeURIComponent(secret),
      JSON.stringify(secret).slice(1, -1),
      secret.replace(/&/g, "&amp;").replace(/"/g, "&quot;"),
    ].join(" ");
    const sanitized = guard.redact({ content: text, arbitrary: secret });
    expect(JSON.stringify(sanitized)).not.toContain("credential-canary");
    expect(new OutputBoundary().redact({ content: secret })).toEqual({
      content: secret,
    });
  });
  it("does not reflect arbitrary exceptions or their stack/cause into public errors", () => {
    const error = new Error("password=canary-private", {
      cause: { token: "canary-token" },
    });
    expect(JSON.stringify(publicError(error))).not.toContain("canary");
  });
  it("protects both MCP text and structured output, including actionable errors", async () => {
    const secret = "session-credential-canary";
    const output = new OutputBoundary();
    output.remember(secret);
    const backend = new FakeBackend({
      get_thread: {
        id: 1,
        courseId: unit.ed_course_id,
        title: "Announcement",
        content: `Read me ${secret}`,
        auth_token: "upstream-credential-canary",
        url: "https://course.example/?sesskey=another-credential-canary",
      },
    });
    const server = createServer(
      { issuer: "https://suite.example", units: [unit], platforms: {} },
      {
        ed: new EdAdapter(backend),
        moodle: new MoodleAdapter(new FakeBackend({})),
        ontrack: new OnTrackAdapter(new FakeBackend({})),
      },
      { output, profile: { id: "a".repeat(64) } } as unknown as AccountService,
    );
    const client = new Client({ name: "security-test", version: "1" });
    const [left, right] = InMemoryTransport.createLinkedPair();
    await server.connect(left);
    await client.connect(right);
    try {
      const result = await client.callTool({
        name: "ed_thread",
        arguments: { unit: unit.key, thread_id: 1 },
      });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result)).not.toContain("credential-canary");
      expect(result.structuredContent).toMatchObject({ title: "Announcement" });
      backend.call = async () => {
        throw new SuiteError(
          "UPSTREAM_UNAVAILABLE",
          `Failed with ${secret}`,
          502,
        );
      };
      const failed = await client.callTool({
        name: "ed_thread",
        arguments: { unit: unit.key, thread_id: 1 },
      });
      expect(failed.isError).toBe(true);
      expect(failed.structuredContent).toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
      });
      expect(JSON.stringify(failed)).not.toContain(secret);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
