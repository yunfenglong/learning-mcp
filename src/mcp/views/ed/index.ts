import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ED_VIEW_URI } from "../../../capabilities/schemas.ts";
import browserScript from "./client.js?raw" with { type: "text" };
// Trusted, self-contained browser code; course data arrives separately via MCP Apps.
export const ED_VIEW_HTML = `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>

body{font:15px/1.6 system-ui,sans-serif;color:light-dark(#19232d,#eee);background:light-dark(#fff,#161b21);padding:16px;color-scheme:light dark}h1{font-size:22px}summary,button{cursor:pointer}details{border-bottom:1px solid #8885;padding:12px 0}button{padding:8px 12px;margin:4px;border:1px solid #8888;border-radius:5px;background:transparent;color:inherit}pre{white-space:pre-wrap}progress{width:100%}.note{color:#888}

</style></head><body><main id="view">Waiting for course data…</main>
<script>${browserScript}</script></body></html>`;

export function registerEdView(server: McpServer) {
  server.registerResource(
    "ed_read_view",
    ED_VIEW_URI,
    {
      mimeType: "text/html;profile=mcp-app",
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
    },
    async () => ({
      contents: [
        {
          uri: ED_VIEW_URI,
          mimeType: "text/html;profile=mcp-app",
          text: ED_VIEW_HTML,
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
        },
      ],
    }),
  );
}
