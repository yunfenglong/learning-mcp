import { createServer } from "node:http";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "node-html-parser";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Reuse Wrangler's pinned bundler; no additional package or lockfile is needed.
const require = createRequire(
  realpathSync(join(root, "node_modules/wrangler/package.json")),
);
const { build } = require("esbuild");
const temporary = await mkdtemp(join(tmpdir(), "learning-mcp-ui-"));
const renderer = join(temporary, "renderer.mjs");
await build({
  stdin: {
    contents:
      'export { renderAuthorizationPage } from "./src/http/authorize.ts"; export { startLogin, renderMfaPage } from "./src/auth/login.ts"; export { landing } from "./src/http/landing.ts"; export { legalPage } from "./src/http/legal.ts"; export { page, errorContent } from "./src/http/ui.ts"; export { digest } from "./src/auth/crypto.ts"; export { USAGE_VERSION } from "./src/domain/usage.ts";',
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: renderer,
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  logLevel: "silent",
});
const {
  legalPage,
  renderAuthorizationPage,
  startLogin,
  renderMfaPage,
  landing,
  page,
  errorContent,
  digest,
  USAGE_VERSION,
} = await import(pathToFileURL(renderer).href);
const issuer = "https://ui-preview.example",
  sessionToken = "d".repeat(64),
  sessionKey = `session:${await digest(sessionToken)}`;
const config = {
  issuer,
  units: [],
  ssoProviders: [{ type: "okta", origin: "https://sso.preview.example" }],
  platforms: { ed: { site_url: "https://edstem.org" } },
};
const profile = { id: "a".repeat(64), name: "Demo student" };
// Isolated sample records: never fetched from a platform or saved to an account.
const sampleUnits = [
  {
    key: "algorithms",
    code: "CSC204",
    name: "Algorithms & data structures",
    campus: "Online",
    year: 2026,
    teaching_period: "S2",
    timezone: "UTC",
    ed_course_id: 204,
    moodle_course_id: 5204,
  },
  {
    key: "interaction",
    code: "DES112",
    name: "Interaction design",
    campus: "Online",
    year: 2026,
    teaching_period: "S2",
    timezone: "UTC",
    moodle_course_id: 5112,
  },
];
const sampleDiscovery = {
  courses: sampleUnits.flatMap((unit) => [
    ...(unit.ed_course_id
      ? [
          {
            platform: "ed",
            id: unit.ed_course_id,
            name: unit.name,
            code: unit.code,
            year: unit.year,
            teaching_period: unit.teaching_period,
            campus: unit.campus,
            accessible: true,
            institution_basis: "Preview fixture: sample enrollment",
          },
        ]
      : []),
    {
      platform: "moodle",
      id: unit.moodle_course_id,
      name: unit.name,
      code: unit.code,
      year: unit.year,
      teaching_period: unit.teaching_period,
      campus: unit.campus,
      accessible: true,
      institution_basis: "Preview fixture: sample enrollment",
    },
  ]),
  coverage: [],
  suggestions: [],
  expires_at: Date.now() + 600_000,
};
const sampleGrants = [
  {
    id: "preview-grant",
    client_name: "Sample MCP client",
    client_id: "preview-client-01",
    redirect_uri: "https://client.preview.example/oauth/callback",
    scopes: ["learning:read", "learning:bindings", "offline_access"],
    authorized_at: Date.now() - 2 * 86_400_000,
    revoked: false,
    expires_at: Date.now() + 86_400_000,
  },
];
const platformStatus = {
  auth_modes: ["session", "sso"],
  has_sso: true,
  moodle: {
    status: "connected",
    display_name: "Demo student",
    site_url: "https://moodle.preview.example",
  },
  ontrack: { status: "not_connected" },
};
const env = {
  BROKER_SERVICE_TOKEN: "preview-only".padEnd(64, "x"),
  SSO_BROKER: {
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/v1/sign-in-metadata")
        return Response.json({
          username: "demo.student",
          base_link: "https://sso.preview.example",
        });
      if (path !== "/v1/status")
        throw new Error(
          "No real broker operations are available in this UI preview.",
        );
      return Response.json(platformStatus);
    },
  },
  AUTH_STATE: {
    idFromName: (value) => value,
    get: () => ({
      fetch: async (request) => {
        const { body } = await request.json();
        switch (new URL(request.url).pathname) {
          case "/ephemeral/put":
            return Response.json({ ok: true });
          case "/ephemeral/get":
            return Response.json(
              body.key === sessionKey
                ? { profile, csrf: "preview-csrf" }
                : null,
            );
          case "/usage":
            return Response.json({
              version: USAGE_VERSION,
              terms_version: USAGE_VERSION,
            });
          case "/units":
            return Response.json({ units: sampleUnits });
          case "/discovery/get":
            return Response.json(sampleDiscovery);
          case "/grants":
            return Response.json({ grants: sampleGrants });
          case "/connection/get":
            return Response.json({ display_name: "Demo student" });
          default:
            throw new Error(
              "No account mutations are available in this UI preview.",
            );
        }
      },
    }),
  },
};
const challenge = {
  status: "mfa_required",
  methods: ["totp", "sso_otp"],
  attempts_remaining: 3,
};
const routes = [
  ["/", "Landing"],
  ["/login", "Sign in"],
  ["/privacy", "Privacy"],
  ["/terms", "Terms"],
  ["/data-controls", "Data controls"],
  ["/preview/notice-update", "Notice update"],
  ["/preview/mfa", "MFA"],
  ["/preview/mfa-error", "MFA error"],
  ["/preview/error", "Stopped"],
  ["/preview/connections", "Connections"],
  ["/preview/empty", "Empty workspace"],
  ["/preview/permissions", "Client access"],
];
function previewDocument(source, current) {
  const document = parse(source);
  // Credential fields contain only fixtures and cannot receive real credentials.
  const values = {
    provider: "https://sso.preview.example",
    username: "demo.student",
    password: "preview-only",
    token: "preview-only-token",
    mfa_code: "123456",
    totp_secret: "",
    cookie_value: "",
  };
  for (const input of document.querySelectorAll("input"))
    if (Object.hasOwn(values, input.getAttribute("name"))) {
      input.setAttribute("value", values[input.getAttribute("name")]);
      input.setAttribute("readonly", "");
    }
  const nav = `<aside aria-label="Preview navigation" style="padding:8px 3vw;background:#eee9df;border-bottom:1px solid #d9d2c5;font:12px/1.5 system-ui;display:flex;align-items:center;flex-wrap:wrap;gap:8px 20px"><strong>Design preview</strong><span style="color:#6d685f">Sample data · no account changes</span><nav style="display:flex;flex-wrap:wrap;gap:6px 16px">${routes.map(([url, title]) => `<a href="${url}"${url === current ? ' aria-current="page" style="font-weight:700"' : ""}>${title}</a>`).join("")}</nav></aside>`;
  return document.toString().replace(/(<body[^>]*>)/, `$1${nav}`);
}
const port = Number(process.env.LEARNING_UI_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Choose a local preview port between 1024 and 65535.");
const server = createServer(async (request, response) => {
  const path = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  if (request.method === "POST") {
    // Discard the body; never parse, log, store or forward form values.
    request.resume();
    response.writeHead(303, {
      location: path === "/login" ? "/preview/mfa" : "/preview/connections",
      "cache-control": "no-store",
    });
    response.end();
    return;
  }
  if (request.method !== "GET") {
    response.writeHead(405);
    response.end();
    return;
  }
  try {
    let source;
    if (["/privacy", "/terms", "/data-controls"].includes(path))
      source = await legalPage(new Request(`${issuer}${path}`), config).text();
    else if (path === "/preview/notice-update") {
      const pendingEnv = {
        ...env,
        AUTH_STATE: {
          ...env.AUTH_STATE,
          get: () => ({
            fetch: async (request) =>
              new URL(request.url).pathname === "/usage"
                ? Response.json(null)
                : env.AUTH_STATE.get().fetch(request),
          }),
        },
      };
      source = await (
        await landing(
          new Request(`${issuer}/landing`, {
            headers: { cookie: `__Host-learning-session=${sessionToken}` },
          }),
          pendingEnv,
          config,
        )
      ).text();
    } else if (path === "/login")
      source = await (
        await startLogin(new Request(`${issuer}/login`), env, config)
      ).text();
    else if (["/", "/landing"].includes(path))
      source = await (
        await landing(new Request(`${issuer}/landing`), env, config)
      ).text();
    else if (["/preview/connections", "/preview/empty"].includes(path))
      source = await (
        await landing(
          new Request(`${issuer}/landing`, {
            headers: { cookie: `__Host-learning-session=${sessionToken}` },
          }),
          path === "/preview/empty"
            ? {
                ...env,
                AUTH_STATE: {
                  ...env.AUTH_STATE,
                  get: () => ({
                    fetch: async (request) => {
                      const path = new URL(request.url).pathname;
                      if (path === "/units")
                        return Response.json({ units: [] });
                      if (path === "/discovery/get") return Response.json(null);
                      if (path === "/grants")
                        return Response.json({ grants: [] });
                      return env.AUTH_STATE.get().fetch(request);
                    },
                  }),
                },
              }
            : env,
          config,
        )
      ).text();
    else if (path === "/preview/mfa")
      source = renderMfaPage("b".repeat(64), challenge);
    else if (path === "/preview/mfa-error")
      source = renderMfaPage("b".repeat(64), {
        ...challenge,
        attempts_remaining: 2,
        error: {
          code: "MFA_TOTP_REJECTED",
          message:
            "The provider did not accept the generated TOTP code. Check your account's setup key or choose another available method.",
        },
      });
    else if (path === "/preview/permissions")
      source = renderAuthorizationPage({
        clientName: "Your MCP client",
        clientId: "preview-client",
        redirectUri: "https://client.preview.example/callback",
        account: "Demo student",
        manage: true,
        csrf: "preview-csrf",
        nonce: "b".repeat(64),
      });
    else if (path === "/preview/error")
      source = page(
        errorContent(
          "MFA_ATTEMPTS_EXCEEDED",
          "Verification stopped after 3 errors. Start a new sign-in and check your setup key or use another available method.",
          true,
        ),
        "Verification stopped",
      );
    else {
      response.writeHead(404);
      response.end("Unknown preview page.");
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html;charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    });
    response.end(previewDocument(source, path));
  } catch {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end("This preview page could not be rendered.");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Frontend preview: http://127.0.0.1:${port}`),
);
async function cleanup() {
  server.close();
  await rm(temporary, { recursive: true, force: true });
  process.exit(0);
}
process.once("SIGINT", cleanup);
process.once("SIGTERM", cleanup);
