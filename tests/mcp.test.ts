import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Config } from "../src/config.ts";
import { EdAdapter } from "../src/adapters/ed.ts";
import { MoodleAdapter } from "../src/adapters/moodle.ts";
import { OnTrackAdapter } from "../src/adapters/ontrack.ts";
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
      expect(tools).toHaveLength(14);
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
    expect(((await tools.json()) as any).result.tools).toHaveLength(14);
  });
});
