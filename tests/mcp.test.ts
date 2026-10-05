import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Config } from "../src/config.ts";
import { EdAdapter } from "../src/adapters/ed.ts";
import { MoodleAdapter } from "../src/adapters/moodle.ts";
import { OnTrackAdapter } from "../src/adapters/ontrack.ts";
import { readCapabilities } from "../src/capabilities/index.ts";
import { createServer, handleMcp } from "../src/mcp/server.ts";
import { FakeBackend, unit } from "./support.ts";

const config: Config = {
  issuer: "https://suite.example",
  units: [unit],
  platforms: {},
};
const adapters = () => ({
  ed: new EdAdapter(new FakeBackend({})),
  moodle: new MoodleAdapter(new FakeBackend({})),
  ontrack: new OnTrackAdapter(new FakeBackend({})),
});

describe("MCP contract", () => {
  it("advertises only read-only tools and enforces Learning unit scope", async () => {
    const server = createServer(config, adapters()),
      client = new Client({ name: "test", version: "1" });
    const [left, right] = InMemoryTransport.createLinkedPair();
    await server.connect(left);
    await client.connect(right);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(readCapabilities.length);
      expect(tools.map((t) => t.name).sort()).toEqual(
        readCapabilities.map((c) => c.name).sort(),
      );
      expect(new Set(readCapabilities.map((c) => c.name)).size).toBe(
        readCapabilities.length,
      );
      for (const capability of readCapabilities) {
        const advertised = tools.find((t) => t.name === capability.name)!;
        expect(
          Object.keys(advertised.inputSchema.properties ?? {}).sort(),
        ).toEqual(Object.keys(capability.input.shape).sort());
      }
      const catalog = await client.callTool({
        name: "capability_catalog",
        arguments: {},
      });
      expect(catalog.structuredContent).toMatchObject({
        read_tools: readCapabilities.map((c) => c.name),
      });

      expect(tools.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          "moodle_attempt",
          "moodle_sync",
          "ed_slide_responses",
          "ed_show_lesson_guide",
          "ontrack_task_read",
          "capability_catalog",
        ]),
      );
      expect(
        tools.every((tool) => tool.annotations?.readOnlyHint === true),
      ).toBe(true);
      expect(
        tools.some((tool) => /submit|mark.read|comments|chats/.test(tool.name)),
      ).toBe(false);
      const result = await client.callTool({
        name: "ed_thread",
        arguments: { unit: "OTHER9999", thread_id: 1 },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        code: "UNIT_NOT_ALLOWED",
      });
      const unknown = await client.callTool({
        name: "attendance_submit",
        arguments: {},
      });
      expect(unknown.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("maps pagination and filters to verified platform IDs through the catalog", async () => {
    const backend = new FakeBackend({
      get_user: { user: { siteurl: "https://moodle.example.edu" } },
      search_forums: { results: [] },
    });
    const server = createServer(config, {
      ...adapters(),
      moodle: new MoodleAdapter(backend, {
        site_url: "https://moodle.example.edu",
      }),
    });
    const client = new Client({ name: "test", version: "1" });
    const [left, right] = InMemoryTransport.createLinkedPair();
    await server.connect(left);
    await client.connect(right);
    try {
      const result = await client.callTool({
        name: "moodle_search_forums",
        arguments: {
          unit: unit.key,
          query: "deadline",
          limit: 7,
          offset: 14,
          forum_id: 55,
          titles_only: true,
          unread_only: true,
          sort: "relevance",
          include_post_text: false,
        },
      });
      expect(result.isError).not.toBe(true);
      expect(backend.calls).toEqual([
        { name: "get_user", args: {} },
        {
          name: "search_forums",
          args: expect.objectContaining({
            unit: 202,
            query: "deadline",
            limit: 7,
            offset: 14,
            forum_id: 55,
            titles_only: true,
            unread_only: true,
            sort: "relevance",
            include_post_text: false,
          }),
        },
      ]);
      const rejected = await client.callTool({
        name: "moodle_search_forums",
        arguments: {
          unit: unit.key,
          query: "deadline",
          courseId: 999,
        },
      });
      expect(rejected.isError).toBe(true);
      expect(backend.calls).toHaveLength(2);
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("serves actual Streamable HTTP discovery and tools/list", async () => {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
    };
    const request = (method: string, params?: unknown) =>
      new Request("https://suite.example/mcp", {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          ...(params ? { params } : {}),
        }),
      });
    const initialized = await handleMcp(
      request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
      config,
      adapters(),
    );
    expect(((await initialized.json()) as any).result.serverInfo.name).toBe(
      "learning-mcp-suite",
    );
    const tools = await handleMcp(request("tools/list"), config, adapters());
    expect(((await tools.json()) as any).result.tools).toHaveLength(
      readCapabilities.length,
    );
  });
});
