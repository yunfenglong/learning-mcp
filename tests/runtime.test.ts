import { USAGE_VERSION } from "../src/domain/usage.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { key, unit } from "./support.ts";
const origin = "https://suite.example",
  moodle = "https://moodle.example.edu",
  ontrack = "https://ontrack.example.edu",
  brokerSecret = "b".repeat(64);
let runtime: Miniflare;
interface Connection {
  token: string;
  refresh: string;
  clientId: string;
  cookie: string;
  csrf: string;
  profile: string;
  grant: string;
}
let a: Connection, b: Connection;
let moodleAccountChanged = false,
  moodleExpired = false,
  moodleOutputCanary = false,
  edEnrolled = true;
async function request(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
) {
  return runtime.dispatchFetch(`${origin}${path}`, {
    ...options,
    redirect: "manual",
  });
}
async function platformFixture(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.origin === "https://edstem.org") {
    const token = req.headers.get("authorization");
    const who =
      token === "Bearer ed-user-a"
        ? "a"
        : token === "Bearer ed-user-b"
          ? "b"
          : null;
    if (!who) return new Response(null, { status: 401 });
    const course = who === "a" ? 101 : 102;
    if (url.pathname === "/api/user")
      return Response.json({
        user: {
          id: who === "a" ? 1 : 2,
          name: `Ed ${who}`,
          email: `${who}@student.example.edu`,
        },
        courses: edEnrolled
          ? [
              {
                course: {
                  id: course,
                  code: "CSC1001",
                  name: "Example course",
                  year: "2026",
                  session: "S2",
                  university: { id: 9, name: "Example University" },
                },
                role: { role: "student" },
              },
            ]
          : [],
      });
    if (url.pathname === `/api/courses/${course}/lessons`)
      return Response.json({
        lessons: [{ id: 5, course_id: course, title: `Lesson ${who}` }],
        modules: [],
      });
    if (url.pathname === `/api/courses/${course}/threads`)
      return Response.json({ threads: [] });
    if (url.pathname === "/api/lessons/5") {
      expect(url.searchParams.has("view")).toBe(false);
      return Response.json({
        lesson: {
          id: 5,
          course_id: course,
          title: `Lesson ${who}`,
          slides: [],
        },
      });
    }
    if (url.pathname === "/api/threads/999")
      return Response.json({
        thread: {
          id: 999,
          course_id: 999,
          title: "Foreign course",
          content: "Do not expose this",
        },
      });
  }
  if (url.origin === moodle) {
    const who =
      req.headers.get("cookie") === "MoodleSession=moodle-a"
        ? "a"
        : req.headers.get("cookie") === "MoodleSession=moodle-b"
          ? "b"
          : null;
    if (!who || moodleExpired)
      return new Response(null, {
        status: 302,
        headers: { location: `${moodle}/login/index.php` },
      });
    const userid = who === "a" ? (moodleAccountChanged ? 99 : 7) : 8;
    if (url.pathname === "/my/")
      return new Response(
        `<html><script>M.cfg = {"wwwroot":"${moodle}","sesskey":"session-${who}","userId":${userid}};</script><span class="usertext">Student ${who}</span></html>`,
        { headers: { "content-type": "text/html" } },
      );
    if (url.pathname === "/lib/ajax/service.php") {
      const calls = (await req.json()) as any[];
      return Response.json(
        calls.map((c, i) => ({
          index: i,
          error: false,
          data:
            c.methodname === "core_webservice_get_site_info"
              ? {
                  userid,
                  username: who,
                  fullname: `Student ${who}`,
                  sitename: "Learning",
                  siteurl: moodle,
                }
              : c.methodname === "core_course_get_contents"
                ? [
                    {
                      id: 1,
                      name: "Week 1",
                      section: 0,
                      summary: moodleOutputCanary
                        ? `Cookie moodle-${who}; key session-${who}; signed link ${moodle}/course/view.php?id=202&sesskey=session-${who}&access%5ftoken=upstream-credential-canary`
                        : "",
                      visible: 1,
                      modules: [],
                    },
                  ]
                : c.methodname.includes("courses")
                  ? [
                      {
                        id: who === "a" ? 202 : 203,
                        shortname: "CSC1001 2026 S2 Main",
                        fullname: "Algorithms",
                        visible: 1,
                        startdate: 0,
                      },
                    ]
                  : [],
        })),
      );
    }
  }
  if (url.origin === ontrack) {
    const username = req.headers.get("Username"),
      token = req.headers.get("Auth-Token");
    if (token !== `ontrack-${username}` || !["a", "b"].includes(username ?? ""))
      return new Response(null, { status: 401 });
    if (url.pathname === "/api/projects")
      return Response.json([
        {
          id: username === "a" ? 404 : 405,
          unit: { id: 303, code: "CSC1001", name: "CSC1001 Main 2026 S2" },
          user_id: username === "a" ? 7 : 8,
        },
      ]);
    if (url.pathname === `/api/projects/${username === "a" ? 404 : 405}`)
      return Response.json({
        id: username === "a" ? 404 : 405,
        unit: { id: 303, code: "CSC1001", name: "CSC1001 Main 2026 S2" },
        tasks: [{ id: 600, task_definition_id: 501, status: "not_started" }],
      });
    if (url.pathname === "/api/units/303")
      return Response.json({
        id: 303,
        code: "CSC1001",
        name: "CSC1001 Main 2026 S2",
        task_definitions: [
          { id: 501, abbreviation: "1.1P", name: "Programming basics" },
        ],
      });
  }
  return new Response(null, { status: 404 });
}
beforeAll(async () => {
  const platforms = JSON.stringify({
    ed: { site_url: "https://edstem.org" },
    moodle: { site_url: moodle },
    ontrack: { site_url: ontrack },
  });
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "suite",
          modules: true,
          scriptPath: resolve("dist/worker.js"),
          compatibilityDate: "2026-10-03",
          compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
          kvNamespaces: ["OAUTH_KV"],
          durableObjects: {
            AUTH_STATE: { className: "AccountState", useSQLite: true },
          },
          bindings: {
            ISSUER: origin,
            CREDENTIALS_KEY: key,
            ADMIN_TOKEN: "x".repeat(64),
            PLATFORM_CONFIG: platforms,
            BROKER_SERVICE_TOKEN: brokerSecret,
          },
          serviceBindings: { SSO_BROKER: "broker" },
          outboundService: platformFixture,
        },
        {
          name: "broker",
          modules: true,
          scriptPath: resolve("dist-broker/worker.js"),
          compatibilityDate: "2026-10-03",
          compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
          durableObjects: {
            BROKER_STATE: { className: "BrokerState", useSQLite: true },
          },
          bindings: {
            BROKER_SERVICE_TOKEN: brokerSecret,
            BROKER_CREDENTIALS_KEY: btoa("b".repeat(32)),
            PLATFORM_CONFIG: platforms,
            LOGIN_ORIGINS: "[]",
          },
          outboundService: platformFixture,
        },
      ],
    }),
  );
  await runtime.ready;
});
afterAll(async () => {
  await runtime?.dispose();
});
async function login(subject: string, invalid = false) {
  const started = await request("/login?return_to=%2Flanding");
  expect(started.status).toBe(200);
  const browser = started.headers.get("set-cookie")!.split(";")[0]!;
  const nonce = (await started.text()).match(
    /name="nonce" value="([a-f0-9]+)"/,
  )![1]!;
  const callback = await request("/login", {
    method: "POST",
    headers: {
      origin,
      cookie: browser,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      nonce,
      platform: "ed",
      token: invalid
        ? "invalid-token"
        : subject === "student-b"
          ? "ed-user-b"
          : "ed-user-a",
      usage_consent: "accept",
      usage_version: USAGE_VERSION,
    }).toString(),
  });
  if (invalid) return { callback, cookie: "", csrf: "" };
  if (callback.status !== 303)
    throw new Error(
      `Login failed: ${callback.status} ${await callback.text()}`,
    );
  const cookie = callback.headers
    .get("set-cookie")!
    .match(/__Host-learning-session=[a-f0-9]+/)![0];
  const page = await request("/landing", { headers: { cookie } });
  expect(page.status).toBe(200);
  const csrf = (await page.text()).match(
    /name="csrf" value="([a-f0-9]+)"/,
  )![1]!;
  return { callback, cookie, csrf };
}
async function connect(
  subject: string,
  scope = "learning:read learning:bindings offline_access",
): Promise<Connection> {
  const browser = await login(subject);
  const registered = await request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "ChatGPT fixture",
      redirect_uris: ["https://chatgpt.com/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(registered.status).toBe(201);
  const clientId = ((await registered.json()) as any).client_id;
  const verifier = "v".repeat(64),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "https://chatgpt.com/callback",
    scope,
    state: "chatgpt-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${origin}/mcp`,
  });
  const page = await request(`/authorize?${query}`, {
    headers: { cookie: browser.cookie },
  });
  expect(page.status).toBe(200);
  const nonce = (await page.text()).match(
    /name="nonce" value="([a-f0-9]+)"/,
  )![1]!;
  const approved = await request(`/authorize?${query}`, {
    method: "POST",
    headers: {
      origin,
      cookie: browser.cookie,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      nonce,
      csrf: browser.csrf,
      consent: "allow",
      usage_consent: "accept",
      usage_version: USAGE_VERSION,
      action: "allow",
    }).toString(),
  });
  expect(approved.status).toBe(302);
  const authCode = new URL(approved.headers.get("location")!).searchParams.get(
    "code",
  )!;
  const exchanged = await request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: authCode,
      code_verifier: verifier,
      redirect_uri: "https://chatgpt.com/callback",
      resource: `${origin}/mcp`,
    }).toString(),
  });
  expect(exchanged.status).toBe(200);
  const tokens = (await exchanged.json()) as any;
  const connection = {
    token: tokens.access_token,
    refresh: tokens.refresh_token,
    clientId,
    cookie: browser.cookie,
    csrf: browser.csrf,
    profile: "",
    grant: "",
  };
  connection.profile = (
    await call(connection, "get_profile")
  ).result.structuredContent.id;
  const accountPage = await request("/landing", {
    headers: { cookie: connection.cookie },
  });
  connection.grant = (await accountPage.text()).match(
    /name="grant_id" value="([a-f0-9]+)"/,
  )![1]!;
  return connection;
}
async function call(
  c: Connection,
  name: string,
  args: Record<string, unknown> = {},
) {
  const response = await request("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${c.token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (response.status !== 200)
    return { status: response.status, ...((await response.json()) as any) };
  return (await response.json()) as any;
}
async function action(
  c: Connection,
  path: string,
  fields: Record<string, string>,
) {
  return request(`/account/${path}`, {
    method: "POST",
    headers: {
      origin,
      cookie: c.cookie,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ csrf: c.csrf, ...fields }).toString(),
  });
}
describe("real workerd: ChatGPT OAuth, user binding and in-Worker clients", () => {
  it("requires OAuth and rejects unverified platform sign-in", async () => {
    expect(
      (
        await request("/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    expect((await login("bad", true)).callback.status).toBe(401);
    expect((await request("/landing")).status).toBe(200);
  });
  it("connects two distinct profiles through login, consent and PKCE", async () => {
    a = await connect("student-a");
    b = await connect("student-b");
    expect(a.profile).not.toBe(b.profile);
    expect(a.token).toBeTruthy();
    expect(a.refresh).toBeTruthy();
  });
  it("keeps deployment origins out of account pages and offers all three connections", async () => {
    const pages = [
      await request("/login"),
      await request("/landing"),
      await request("/landing", { headers: { cookie: a.cookie } }),
    ];
    const bodies: string[] = [];
    for (const page of pages) {
      expect(page.status).toBe(200);
      const body = await page.text();
      expect(body).not.toContain(new URL(moodle).hostname);
      expect(body).not.toContain(new URL(ontrack).hostname);
      expect(body).not.toContain("Cloudflare");
      expect(body).toContain("infrastructure providers used by its operator");
      bodies.push(body);
    }
    const connections = bodies[2]!;
    expect(connections).toContain(
      "You can connect Ed, Moodle and OnTrack together in this account",
    );
    expect(connections).toContain('action="/account/ed"');
    for (const platform of ["moodle", "ontrack"])
      expect(connections).toContain(`name="platform" value="${platform}"`);
  });
  it("binds Ed in the browser, discovers courses and calls the embedded upstream client", async () => {
    expect(
      (await action(a, "ed", { token: "ed-user-a", confirm: "yes" })).status,
    ).toBe(303);
    expect(
      (await action(b, "ed", { token: "ed-user-b", confirm: "yes" })).status,
    ).toBe(303);
    const discovered = await call(a, "discover_courses");
    expect(discovered.result.structuredContent.courses[0]).toMatchObject({
      platform: "ed",
      id: 101,
      accessible: true,
    });
    const only = {
      ...unit,
      moodle_course_id: undefined,
      ontrack_project_id: undefined,
      ontrack_unit_id: undefined,
    };
    expect(
      (await call(a, "bind_course", { course: only })).result.isError,
    ).not.toBe(true);
    expect(
      (await call(a, "ed_lessons", { unit: unit.key })).result.structuredContent
        .lessons[0].title,
    ).toBe("Lesson a");
    expect(
      (await call(a, "ed_thread", { unit: unit.key, thread_id: 999 })).result
        .structuredContent.code,
    ).toBe("COURSE_NOT_ACCESSIBLE");
    const bUnits = await call(b, "course_units");
    expect(bUnits.result.structuredContent.units).toEqual([]);
    expect(JSON.stringify(await call(a, "connection_status"))).not.toContain(
      "ed-user-a",
    );
  });
  it("checks current Ed enrolment on detail reads without marking lessons viewed", async () => {
    expect(
      (await call(a, "ed_lesson", { unit: unit.key, lesson_id: 5 })).result
        .structuredContent.title,
    ).toBe("Lesson a");
    edEnrolled = false;
    try {
      expect(
        (await call(a, "ed_lesson", { unit: unit.key, lesson_id: 5 })).result
          .structuredContent.code,
      ).toBe("COURSE_NOT_ACCESSIBLE");
    } finally {
      edEnrolled = true;
    }
  });
  it("rejects another user's connection link, CSRF and foreign course binding", async () => {
    const link = (await call(a, "start_connection", { platform: "ed" })).result
      .structuredContent.url;
    const other = await request(new URL(link).pathname + new URL(link).search, {
      headers: { cookie: b.cookie },
    });
    expect(other.status).toBe(403);
    expect(
      (
        await action(a, "ed", {
          token: "ed-user-b",
          confirm: "yes",
          csrf: "wrong",
        })
      ).status,
    ).toBe(403);
    await call(b, "discover_courses");
    const invalid = {
      ...unit,
      moodle_course_id: undefined,
      ontrack_project_id: undefined,
      ontrack_unit_id: undefined,
    };
    expect(
      (await call(b, "bind_course", { course: invalid })).result
        .structuredContent.code,
    ).toBe("COURSE_NOT_ACCESSIBLE");
  });
  it("validates Moodle and OnTrack sessions in the private broker and keeps users isolated", async () => {
    const connected = await action(a, "platform", {
      platform: "moodle",
      mode: "session",
      cookie_name: "MoodleSession",
      cookie_value: "moodle-a",
      confirm: "yes",
    });
    if (connected.status !== 303)
      throw new Error(
        `Moodle connect: ${connected.status} ${await connected.text()}`,
      );
    expect(
      (
        await action(a, "platform", {
          platform: "ontrack",
          mode: "session",
          username: "a",
          token: "ontrack-a",
          confirm: "yes",
        })
      ).status,
    ).toBe(303);
    const courses = (await call(a, "discover_courses")).result.structuredContent
      .courses;
    expect(
      courses.some((c: any) => c.platform === "moodle" && c.id === 202),
    ).toBe(true);
    expect(
      courses.some((c: any) => c.platform === "ontrack" && c.id === 404),
    ).toBe(true);
    expect(
      (await call(a, "bind_course", { course: unit })).result.isError,
    ).not.toBe(true);
    const connections = (await call(a, "connection_status")).result
      .structuredContent;
    expect(connections.ed.status).toBe("connected");
    expect(connections.platforms.moodle.status).toBe("connected");
    expect(connections.platforms.ontrack.status).toBe("connected");
    const status = JSON.stringify(connections);
    expect(status).not.toContain("moodle-a");
    expect(status).not.toContain("ontrack-a");
    expect(
      (await call(b, "connection_status")).result.structuredContent.platforms
        .moodle.status,
    ).toBe("not_connected");
    const stub = await runtime.getWorker("broker");
    for (const headers of [
      { authorization: `Bearer ${a.token}` },
      { authorization: `Bearer ${brokerSecret}`, origin },
    ]) {
      const denied = await stub.fetch("https://broker/v1/session", {
        method: "POST",
        headers: {
          ...headers,
          "x-suite-account": a.profile,
          "content-type": "application/json",
        },
        body: '{"platform":"moodle"}',
      });
      if ("origin" in headers) {
        // Miniflare's proxy rejects Origin before invoking the Worker.
        expect(denied.status).toBe(403);
        expect(await denied.clone().text()).toBe("Invalid Origin header");
      } else {
        expect(denied.status).toBe(401);
        expect(denied.headers.get("cache-control")).toBe("no-store");
      }
      expect(await denied.text()).not.toContain("moodle-a");
    }
    expect(
      (
        await stub.fetch("https://broker/v1/status", {
          method: "POST",
          headers: {
            "x-suite-account": a.profile,
            "content-type": "application/json",
          },
          body: "{}",
        })
      ).status,
    ).toBe(401);
  });
  it("reads Moodle sections and OnTrack tasks using the embedded clients", async () => {
    const course = (await call(a, "moodle_unit", { unit: unit.code })).result;
    expect(course.isError, JSON.stringify(course)).not.toBe(true);
    expect(course.structuredContent.unit.id).toBe(202);
    const task = (
      await call(a, "ontrack_task", {
        unit: unit.code,
        task_definition_id: 501,
      })
    ).result;
    expect(task.isError, JSON.stringify(task)).not.toBe(true);
    expect(task.structuredContent.progress.task_definition_id).toBe(501);
    const denied = (
      await call(a, "ontrack_task", {
        unit: unit.code,
        task_definition_id: 999,
      })
    ).result;
    expect(denied.structuredContent.code).toBe("ENTITY_NOT_ALLOWED");
  });
  it("rejects a Moodle session whose authenticated profile changes", async () => {
    moodleAccountChanged = true;
    try {
      expect(
        (await call(a, "moodle_unit", { unit: unit.code })).result
          .structuredContent.code,
      ).toBe("ACCOUNT_CHANGED");
    } finally {
      moodleAccountChanged = false;
    }
  });
  it("removes real session canaries from text and structured MCP responses", async () => {
    moodleOutputCanary = true;
    try {
      const result = (await call(a, "moodle_unit", { unit: unit.code })).result;
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.unit.id).toBe(202);
      expect(JSON.stringify(result)).not.toContain("moodle-a");
      expect(JSON.stringify(result)).not.toContain("session-a");
      expect(JSON.stringify(result)).not.toContain(
        "upstream-credential-canary",
      );
      expect(JSON.stringify(result)).toContain("[REDACTED]");
    } finally {
      moodleOutputCanary = false;
    }
    for (const name of [
      "password",
      "totp_secret",
      "refresh_token",
      "client_secret",
    ]) {
      const response = await request(
        `/healthz?${name}=query-credential-canary`,
      );
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain("query-credential-canary");
    }
  });
  it("requests broker renewal after a Moodle login redirect without exposing session material", async () => {
    moodleExpired = true;
    try {
      const result = (await call(a, "moodle_unit", { unit: unit.code })).result;
      expect(result.structuredContent.code).toBe("SSO_NOT_CONFIGURED");
      expect(JSON.stringify(result)).not.toContain("moodle-a");
    } finally {
      moodleExpired = false;
    }
  });
  it("limits a read-only client to reads and rotates refresh tokens without changing identity", async () => {
    const reader = await connect("reader", "learning:read offline_access");
    const denied = (await call(reader, "start_connection", { platform: "ed" }))
      .result;
    expect(denied.structuredContent.code).toBe("INSUFFICIENT_SCOPE");
    expect(denied._meta["mcp/www_authenticate"][0]).toContain(
      "insufficient_scope",
    );
    const response = await request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: reader.clientId,
        refresh_token: reader.refresh,
        resource: `${origin}/mcp`,
      }).toString(),
    });
    expect(response.status).toBe(200);
    const refreshed = (await response.json()) as any;
    expect(
      (await call({ ...reader, token: refreshed.access_token }, "get_profile"))
        .result.structuredContent.id,
    ).toBe(reader.profile);
    expect(refreshed.refresh_token).not.toBe(reader.refresh);
  });
  it("publishes OAuth policies, the profile schema and exact upstream commits", async () => {
    const response = await request("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${a.token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const tools = ((await response.json()) as any).result.tools;
    expect(tools).toHaveLength(22);
    expect(tools.find((t: any) => t.name === "get_profile")).toMatchObject({
      _meta: { "openai/profile": true },
      outputSchema: { required: ["id"] },
    });
    expect(
      tools.find((t: any) => t.name === "bind_course").securitySchemes[0]
        .scopes,
    ).toContain("learning:bindings");
    expect(
      (await call(a, "upstream_versions")).result.structuredContent.upstreams.ed
        .sha,
    ).toHaveLength(40);
  });
  it("revokes one user's access immediately without revoking the other user", async () => {
    expect((await action(a, "revoke", { grant_id: a.grant })).status).toBe(303);
    expect((await call(a, "course_units")).status).toBe(403);
    expect((await call(b, "get_profile")).result.structuredContent.id).toBe(
      b.profile,
    );
    const refreshed = await request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: a.clientId,
        refresh_token: a.refresh,
        resource: `${origin}/mcp`,
      }).toString(),
    });
    expect(refreshed.status).toBe(400);
    expect(((await refreshed.json()) as any).error).toBe("invalid_grant");
  });
  it("limits unauthenticated sign-in attempts before upstream credential verification", async () => {
    let limited = false;
    for (let i = 0; i < 21; i++) {
      const attempt = await login("bad", true);
      const text = await attempt.callback.text();
      expect(text).not.toContain("invalid-token");
      if (attempt.callback.status === 429) {
        expect(JSON.parse(text).code).toBe("AUTH_RETRY_LATER");
        limited = true;
        break;
      }
      expect(attempt.callback.status).toBe(401);
    }
    expect(limited).toBe(true);
  });
});
