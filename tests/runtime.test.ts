import { runInNewContext } from "node:vm";
import { readCapabilities } from "../src/capabilities/index.ts";
import { USAGE_VERSION } from "../src/domain/usage.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { key, unit, taskSheetPdf } from "./support.ts";
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
const moodleAttachments = ["starter.zip", "specification.docx", "rubric.docx"];
const moodleFileBytes = new Uint8Array([80, 75, 3, 4, 255, 0, 17, 99]);
let moodleFileMode:
  | "binary"
  | "external"
  | "allowed"
  | "allowed_other"
  | "denied"
  | "missing"
  | "large" = "binary";
let edCourseCode = "CSC1001";
let ontrackDiscoveryUnavailable = false;
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
    expect(req.method).toBe("GET");
    const course = who === "a" ? 101 : 102;
    const slide = {
      id: 8,
      lesson_id: 5,
      course_id: course,
      type: "pdf",
      title: "Slides",
      file_url: "https://files.edusercontent.com/slides.pdf",
      content: "<p>Slide body</p>",
    };
    const lesson = {
      id: 5,
      course_id: course,
      module_id: 4,
      title: `Lesson ${who}`,
      outline:
        '<p>Lesson body</p><file url="https://files.edusercontent.com/notes.pdf" filename="notes.pdf"></file>',
      slides: [slide],
      type: "lesson",
      state: "published",
      status: "not_started",
      available_at: "2026-01-01T00:00:00Z",
    };
    const thread = {
      id: 11,
      number: 42,
      course_id: course,
      user_id: who === "a" ? 1 : 2,
      title: "Read-only discussion",
      content:
        '<p>Thread body</p><file url="https://files.edusercontent.com/thread.pdf" filename="thread.pdf"></file>',
      document: "Thread body",
      created_at: new Date().toISOString(),
      type: "question",
      category: "General",
      is_seen: false,
    };
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
                  code: edCourseCode,
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
        lessons: [lesson],
        modules: [{ id: 4, course_id: course, name: "Module 1" }],
      });
    if (url.pathname === `/api/courses/${course}/threads`)
      return Response.json({
        threads:
          Number(url.searchParams.get("offset") ?? 0) === 0 ? [thread] : [],
      });
    if (
      url.pathname === "/api/threads/11" ||
      url.pathname === `/api/courses/${course}/threads/42`
    )
      return Response.json({ thread });
    if (url.pathname === `/api/users/${who === "a" ? 1 : 2}/profile/activity`) {
      expect(url.searchParams.get("course_id")).toBe(String(course));
      return Response.json({ items: [{ thread }] });
    }
    if (url.pathname === "/api/lessons/5") {
      expect(url.searchParams.has("view")).toBe(false);
      return Response.json({
        lesson,
      });
    }
    if (url.pathname === "/api/lessons/slides/8") {
      expect(url.searchParams.has("view")).toBe(false);
      return Response.json({ slide });
    }
    if (url.pathname === "/api/lessons/slides/8/questions")
      return Response.json({
        questions: [
          {
            id: 33,
            lesson_slide_id: 8,
            data: { content: "Question", answers: ["A", "B"] },
          },
        ],
      });
    if (url.pathname === "/api/lessons/slides/8/questions/responses")
      return Response.json({
        responses: [
          { question_id: 33, user_id: who === "a" ? 1 : 2, data: [0] },
          { question_id: 33, user_id: 99, data: [1] },
        ],
      });
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
    if (url.pathname === "/course/view.php")
      return new Response(
        '<a href="/grade/report/user/index.php?id=202">Grades</a>',
        { headers: { "content-type": "text/html" } },
      );
    if (url.pathname === "/grade/report/user/index.php")
      return new Response(
        '<h1>Algorithms</h1><table class="user-grade"><tr><th class="rowtitle"><a href="/mod/assign/view.php?id=10">Assignment 2</a></th><td class="column-grade">80</td><td class="column-feedback">Feedback</td></tr></table>',
        { headers: { "content-type": "text/html" } },
      );
    if (url.pathname === "/mod/forum/view.php")
      return new Response(
        `<body class="forumtype-news course-202"><a href="${moodle}/mod/forum/discuss.php?d=77">Announcement</a></body>`,
        { headers: { "content-type": "text/html" } },
      );
    if (url.pathname === "/mod/forum/discuss.php")
      return new Response('<body class="course-202">Discussion</body>', {
        headers: { "content-type": "text/html" },
      });
    if (url.pathname === "/mod/quiz/view.php")
      return new Response(
        `<body id="page-mod-quiz-view" class="course-202"><h1>Quiz 1</h1><div class="card"><h2 class="card-title">Attempt 1</h2><table class="quizreviewsummary"><tr><th>Status</th><td>Finished</td></tr></table><a href="${moodle}/mod/quiz/review.php?attempt=500">Review</a></div></body>`,
        { headers: { "content-type": "text/html" } },
      );
    if (url.pathname === "/mod/quiz/review.php")
      return new Response(
        '<body class="course-202"><a href="/course/view.php?id=202">Algorithms</a><h1>Quiz 1</h1><form class="questionflagsaveform" action="/mod/quiz/review.php?cmid=20"><div class="que"><div class="qtext">Question</div></div></form></body>',
        { headers: { "content-type": "text/html" } },
      );
    if (url.pathname === "/mod/assign/view.php")
      return new Response(
        `<html><body id="page-mod-assign-view" class="course-202"><h1>Assignment 2</h1>${moodleAttachments.map((name) => `<a href="${moodle}/pluginfile.php/202/mod_assign/introattachment/0/${name}?forcedownload=1">${name}</a>`).join("")}</body></html>`,
        { headers: { "content-type": "text/html" } },
      );
    if (url.pathname.startsWith("/pluginfile.php/202/")) {
      if (["external", "allowed", "allowed_other"].includes(moodleFileMode))
        return new Response(null, {
          status: 302,
          headers: {
            location: `https://${moodleFileMode === "external" ? "blocked-files.example.edu" : `${moodleFileMode === "allowed" ? "first" : "second"}-distribution.cloudfront.net`}/attachment.docx?signature=private-file-canary`,
          },
        });
      else if (moodleFileMode === "denied")
        return new Response("Permission denied: upstream-credential-canary", {
          status: 403,
        });
      else if (moodleFileMode === "missing")
        return new Response("Not found: upstream-credential-canary", {
          status: 404,
        });
      else
        return new Response(
          moodleFileMode === "large"
            ? new Uint8Array(16 * 1024 * 1024)
            : moodleFileBytes,
          {
            headers: {
              "content-type":
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "content-length": String(
                moodleFileMode === "large"
                  ? 16 * 1024 * 1024
                  : moodleFileBytes.length,
              ),
              "content-disposition": "attachment; filename=specification.docx",
            },
          },
        );
    }
    if (url.pathname === "/lib/ajax/service.php") {
      const calls = (await req.json()) as any[];
      for (const call of calls)
        expect(call.methodname).not.toMatch(
          /(?:^|_)(?:set|update|submit|create|delete|mark)_/,
        );
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
                      modules: [
                        {
                          id: 10,
                          name: "Assignment 2",
                          modname: "assign",
                          visible: 1,
                          url: `${moodle}/mod/assign/view.php?id=10`,
                        },
                        {
                          id: 55,
                          name: "Announcements",
                          modname: "forum",
                          visible: 1,
                          url: `${moodle}/mod/forum/view.php?id=55`,
                        },
                        {
                          id: 20,
                          name: "Quiz 1",
                          modname: "quiz",
                          visible: 1,
                          url: `${moodle}/mod/quiz/view.php?id=20`,
                        },
                      ],
                    },
                  ]
                : c.methodname === "core_course_get_course_module"
                  ? {
                      cm: {
                        id: c.args.cmid,
                        modname: c.args.cmid === 20 ? "quiz" : "assign",
                        course: 202,
                      },
                    }
                  : c.methodname === "mod_forum_get_discussion_posts"
                    ? {
                        courseid: 202,
                        forumid: 55,
                        groupid: 1,
                        posts: [
                          {
                            id: 78,
                            subject: "Announcement",
                            message: "Read-only announcement",
                            timecreated: 1,
                          },
                        ],
                      }
                    : c.methodname === "mod_forum_get_forums_by_courses"
                      ? [
                          {
                            cmid: 55,
                            type: "news",
                            course: 202,
                            name: "Announcements",
                          },
                        ]
                      : c.methodname.includes("courses")
                        ? [
                            {
                              id: who === "a" ? 202 : 203,
                              shortname: "CSC1001_S2_2026",
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
  if (
    url.origin === "https://first-distribution.cloudfront.net" ||
    url.origin === "https://second-distribution.cloudfront.net" ||
    url.origin === "https://files.edusercontent.com"
  ) {
    expect(req.headers.has("cookie")).toBe(false);
    expect(req.headers.has("authorization")).toBe(false);
    expect(req.headers.has("Auth-Token")).toBe(false);
    return new Response(moodleFileBytes, {
      headers: { "content-type": "application/octet-stream" },
    });
  }
  if (url.origin === ontrack) {
    const username = req.headers.get("Username"),
      token = req.headers.get("Auth-Token");
    if (token !== `ontrack-${username}` || !["a", "b"].includes(username ?? ""))
      return new Response(null, { status: 401 });
    expect(req.method).toBe("GET");
    if (url.pathname === "/api/auth/method")
      return Response.json({ method: "token" });
    if (url.pathname === "/api/unit_roles") return Response.json([]);
    if (
      url.pathname === "/api/units/303/all_resources" ||
      url.pathname === "/api/units/303/task_definitions/501/task_resources"
    )
      return new Response(
        new Uint8Array([80, 75, 5, 6, ...Array(18).fill(0)]),
        { headers: { "content-type": "application/zip" } },
      );
    if (url.pathname === "/api/projects")
      if (ontrackDiscoveryUnavailable)
        return Response.json(
          { token: "upstream-error-canary" },
          { status: 503 },
        );
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
    if (url.pathname === "/api/units/303/task_definitions/501/task_pdf")
      return new Response(taskSheetPdf(), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": "attachment; filename=task.pdf",
        },
      });
  }
  return new Response(null, { status: 404 });
}
beforeAll(async () => {
  const platforms = JSON.stringify({
    ed: { site_url: "https://edstem.org" },
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
            SSO_PROVIDERS:
              '[{"type":"okta","origin":"https://tenant.okta.example"}]',
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
      terms_consent: "accept",
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
  expect(page.headers.get("content-security-policy")).toContain(
    "form-action 'self';",
  );
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
      client_name: "Compatible MCP fixture",
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
  expect(page.headers.get("content-security-policy")).toContain(
    "form-action 'self' https://chatgpt.com;",
  );
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
      terms_consent: "accept",
      usage_version: USAGE_VERSION,
      action: "allow",
    }).toString(),
  });
  expect(approved.status).toBe(302);
  expect(approved.headers.get("content-security-policy")).toContain(
    "form-action 'self' https://chatgpt.com;",
  );
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
describe("real workerd: client OAuth, user binding and in-Worker clients", () => {
  it("serves legal pages without sign-in and rejects writes to them", async () => {
    for (const path of ["/privacy", "/terms", "/data-controls"]) {
      const response = await request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("set-cookie")).toBeNull();
      const text = await response.text();
      expect(text).toContain("Version " + USAGE_VERSION);
      expect(text).toContain("source repository");
      expect((await request(path, { method: "POST" })).status).toBe(405);
    }
  });
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
  it("keeps browser form origin checks strict and makes login errors retryable", async () => {
    const started = await request("/login");
    const text = await started.text();
    const nonce = text.match(/name="nonce" value="([a-f0-9]+)"/)![1]!;
    const cookie = started.headers.get("set-cookie")!.split(";")[0]!;
    for (const invalidOrigin of [
      undefined,
      "null",
      "https://foreign.example",
    ]) {
      const response = await request("/login", {
        method: "POST",
        headers: {
          accept: "text/html",
          cookie,
          ...(invalidOrigin ? { origin: invalidOrigin } : {}),
        },
        body: new URLSearchParams({
          nonce,
          platform: "sso",
          provider: "https://unsupported.example",
          usage_version: USAGE_VERSION,
          usage_consent: "accept",
          terms_consent: "accept",
        }).toString(),
      });
      expect(response.status).toBe(403);
      const error = await response.text();
      expect(error).toContain("Open the sign-in page again.");
      expect(error).toContain('href="/login"');
    }
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
      expect(body).toContain("Cloudflare");
      expect(body).not.toContain("ChatGPT");
      expect(body).not.toContain("tenant.okta.example");
      expect(body).toContain("infrastructure providers used by its operator");
      bodies.push(body);
    }
    expect(bodies[0]).toContain('name="provider"');
    expect(bodies[0]).toContain('name="platform" value="sso"');
    const connections = bodies[2]!;
    expect(connections).toContain("Each course can use any combination.");
    for (const name of ["Ed Discussion", "Moodle", "OnTrack"])
      expect(connections).toContain(`<h3>${name}</h3>`);
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
    ).toBe("ENTITY_NOT_ALLOWED");
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
      base_link: moodle,
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
          base_link: ontrack,
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
  it("reports OnTrack discovery failure and does not mislabel a binding attempt as an inaccessible course", async () => {
    ontrackDiscoveryUnavailable = true;
    try {
      const discovery = (await call(a, "discover_courses")).result
        .structuredContent;
      expect(discovery.coverage).toContainEqual({
        platform: "ontrack",
        status: "unavailable",
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "OnTrack returned HTTP 503. Retry later.",
        },
      });
      expect(JSON.stringify(discovery)).not.toContain("upstream-error-canary");
      expect(
        (await call(a, "bind_course", { course: unit })).result
          .structuredContent.code,
      ).toBe("COURSE_DISCOVERY_UNAVAILABLE");
      expect(
        (await call(a, "course_units")).result.structuredContent.units,
      ).toEqual([unit]);
    } finally {
      ontrackDiscoveryUnavailable = false;
      await call(a, "discover_courses");
    }
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
  it("extracts task-sheet text and delivers real file resources in the Worker runtime", async () => {
    const read = (
      await call(a, "ontrack_task_read", { unit: unit.code, task: "1.1P" })
    ).result;
    expect(read.isError, JSON.stringify(read)).not.toBe(true);
    expect(read.structuredContent.markdown).toContain(
      "Read-only task instructions",
    );
    expect(read.structuredContent.next_page).toBeNull();
    const download = (
      await call(a, "ontrack_task_file", {
        unit: unit.code,
        task_definition_id: 501,
      })
    ).result;
    expect(download.isError, JSON.stringify(download)).not.toBe(true);
    const resource = download.content.find(
      (v: any) => v.type === "resource",
    ).resource;
    expect(resource.mimeType).toBe("application/pdf");
    expect(atob(resource.blob).startsWith("%PDF-")).toBe(true);
    expect(download.structuredContent.file.blob).toBeUndefined();
    expect(JSON.stringify(download)).not.toContain("ontrack-a");
  });
  it("returns the OnTrack username on the first identity read", async () => {
    const result = (await call(a, "ontrack_user")).result;
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.structuredContent.user).toEqual({ username: "a", id: 7 });
    expect(result.structuredContent.authentication.method).toBe("token");
  });
  it("exercises every Ed read tool with real vendor payloads and no platform writes", async () => {
    const inputs: Record<string, Record<string, unknown>> = {
      ed_user: {},
      ed_courses: {},
      ed_course: { unit: unit.key },
      ed_lessons: { unit: unit.key },
      ed_lesson: { unit: unit.key, lesson_id: 5 },
      ed_threads: { unit: unit.key },
      ed_thread: { unit: unit.key, thread_id: 11 },
      ed_search_threads: { unit: unit.key, query: "body" },
      ed_course_thread: { unit: unit.key, number: 42 },
      ed_activity: { unit: unit.key },
      ed_modules: { unit: unit.key },
      ed_lesson_files: { unit: unit.key, lesson_id: 5 },
      ed_thread_files: { unit: unit.key, thread_id: 11 },
      ed_file: { unit: unit.key, lesson_id: 5 },
      ed_read_thread: { unit: unit.key, number: 42 },
      ed_read_lesson: { unit: unit.key, lesson_id: 5 },
      ed_slide: { unit: unit.key, lesson_id: 5, slide_id: 8 },
      ed_read_slide: { unit: unit.key, lesson_id: 5, slide_id: 8 },
      ed_slide_questions: { unit: unit.key, lesson_id: 5, slide_id: 8 },
      ed_slide_responses: { unit: unit.key, lesson_id: 5, slide_id: 8 },
      ed_show_forum_catchup: { unit: unit.key },
      ed_show_thread_activity: { unit: unit.key },
      ed_show_lesson_progress: { unit: unit.key },
      ed_show_lesson_guide: {
        unit: unit.key,
        lesson_id: 5,
        sections: [{ title: "Overview", points: ["Read the lesson"] }],
      },
    };
    expect(Object.keys(inputs).sort()).toEqual(
      readCapabilities
        .filter((c) => c.platform === "ed")
        .map((c) => c.name)
        .sort(),
    );
    const results: Record<string, any> = {};
    for (const [name, args] of Object.entries(inputs)) {
      const result = (await call(a, name, args)).result;
      expect(
        result.isError,
        `${name}: ${JSON.stringify(result.structuredContent)}`,
      ).not.toBe(true);
      results[name] = result;
    }
    expect(results.ed_modules.structuredContent.modules[0].lesson_count).toBe(
      1,
    );
    expect(results.ed_search_threads.structuredContent.threads[0].id).toBe(11);
    expect(results.ed_lesson_files.structuredContent.files).toHaveLength(2);
    expect(results.ed_thread_files.structuredContent.files).toHaveLength(1);
    expect(
      results.ed_slide_questions.structuredContent.questions[0].answers,
    ).toEqual(["A", "B"]);
    expect(
      results.ed_slide_responses.structuredContent.responses.map(
        (v: any) => v.userId,
      ),
    ).toEqual([1]);
    expect(results.ed_read_lesson.structuredContent.markdown).toContain(
      "Lesson body",
    );
    expect(results.ed_read_thread.structuredContent.markdown).toContain(
      "Thread body",
    );
    expect(
      results.ed_file.content.filter((v: any) => v.type === "resource"),
    ).toHaveLength(1);
    for (const kind of [
      "forum_catchup",
      "thread_activity",
      "lesson_progress",
      "lesson_guide",
    ])
      expect(results[`ed_show_${kind}`].structuredContent.view.kind).toBe(kind);
  });
  it("exercises the remaining OnTrack snapshot, discovery and archive reads without chat side effects", async () => {
    for (const [name, args] of Object.entries({
      ontrack_courses: { include_inactive: true },
      ontrack_roles: {},
      ontrack_unit: { unit: unit.key },
      ontrack_tasks: { unit: unit.key, status: ["not_started"] },
      ontrack_unread: { unit: unit.key },
      ontrack_unit_file: { unit: unit.key },
      ontrack_task_file: { unit: unit.key, task: "1.1P", resources: true },
    })) {
      const result = (await call(a, name, args)).result;
      expect(
        result.isError,
        `${name}: ${JSON.stringify(result.structuredContent)}`,
      ).not.toBe(true);
    }
  });
  it("downloads authenticated Moodle assignment attachments through the actual client and Worker transport", async () => {
    const listing = (
      await call(a, "moodle_item", { unit: unit.key, activity_id: 10 })
    ).result;
    expect(listing.isError, JSON.stringify(listing)).not.toBe(true);
    expect(
      listing.structuredContent.item.file_entries.map((f: any) => f.name),
    ).toEqual(moodleAttachments);
    const single = (
      await call(a, "moodle_file", {
        unit: unit.key,
        activity_id: 10,
        file_index: 1,
      })
    ).result;
    expect(single.isError, JSON.stringify(single)).not.toBe(true);
    const resources = single.content.filter((v: any) => v.type === "resource");
    expect(resources).toHaveLength(1);
    expect(Buffer.from(resources[0].resource.blob, "base64")).toEqual(
      Buffer.from(moodleFileBytes),
    );
    expect(single.structuredContent.file.sha256).toBe(
      createHash("sha256").update(moodleFileBytes).digest("hex"),
    );
    const batch = (
      await call(a, "moodle_download", { unit: unit.key, activity_id: 10 })
    ).result;
    expect(batch.isError, JSON.stringify(batch)).not.toBe(true);
    expect(batch.structuredContent.errors).toEqual([]);
    expect(
      batch.content.filter((v: any) => v.type === "resource"),
    ).toHaveLength(3);
  });
  it("exercises every Moodle read tool with the real parser and read-only AJAX", async () => {
    const inputs: Record<string, Record<string, unknown>> = {
      moodle_user: {},
      moodle_courses: {},
      moodle_unit: { unit: unit.key },
      moodle_due: { unit: unit.key },
      moodle_grades: { unit: unit.key },
      moodle_search_forums: { unit: unit.key, query: "announcement" },
      moodle_thread: { unit: unit.key, discussion_id: 77 },
      moodle_home: { unit: unit.key },
      moodle_alerts: {},
      moodle_find: { unit: unit.key, query: "Assignment", types: ["assign"] },
      moodle_item: { unit: unit.key, activity_id: 10 },
      moodle_file: { unit: unit.key, activity_id: 10 },
      moodle_download: { unit: unit.key, activity_id: 10 },
      moodle_sync: { unit: unit.key, activity_id: 10 },
      moodle_news: { unit: unit.key },
      moodle_forums: { unit: unit.key },
      moodle_forum: { unit: unit.key, forum_id: 55 },
      moodle_attempt: { unit: unit.key, activity_id: 20, attempt_id: 500 },
    };
    expect(Object.keys(inputs).sort()).toEqual(
      readCapabilities
        .filter((c) => c.platform === "moodle")
        .map((c) => c.name)
        .sort(),
    );
    const results: Record<string, any> = {};
    for (const [name, args] of Object.entries(inputs)) {
      const result = (await call(a, name, args)).result;
      expect(
        result.isError,
        `${name}: ${JSON.stringify(result.structuredContent)}`,
      ).not.toBe(true);
      results[name] = result.structuredContent;
    }
    expect(results.moodle_home.home.errors).toEqual([]);
    expect(results.moodle_forums.forums[0].id).toBe(55);
    expect(results.moodle_thread.thread.posts[0].subject).toBe("Announcement");
    expect(results.moodle_news.results[0].post.subject).toBe("Announcement");
    expect(results.moodle_grades.grades[0].items[0].grade).toBe("80");
    expect(results.moodle_attempt.attempt.id).toBe(500);
    expect(results.moodle_sync.manifest).toHaveLength(3);
  });
  it("preserves the file transport failure in individual and batch Moodle downloads", async () => {
    moodleFileMode = "external";
    try {
      const single = (
        await call(a, "moodle_file", {
          unit: unit.key,
          activity_id: 10,
          file_index: 1,
        })
      ).result;
      const batch = (
        await call(a, "moodle_download", { unit: unit.key, activity_id: 10 })
      ).result;
      expect({
        single: single.structuredContent,
        batch: batch.structuredContent.errors,
      }).toEqual({
        single: expect.objectContaining({
          code: "RESOURCE_ORIGIN_NOT_ALLOWED",
        }),
        batch: Array.from({ length: 3 }, () =>
          expect.objectContaining({ code: "RESOURCE_ORIGIN_NOT_ALLOWED" }),
        ),
      });
      expect(JSON.stringify({ single, batch })).not.toContain(
        "private-file-canary",
      );
    } finally {
      moodleFileMode = "binary";
    }
  });
  it("follows configured Moodle file redirects without forwarding credentials", async () => {
    moodleFileMode = "allowed";
    try {
      const single = (
        await call(a, "moodle_file", {
          unit: unit.key,
          activity_id: 10,
          file_index: 1,
        })
      ).result;
      expect(single.isError, JSON.stringify(single.structuredContent)).not.toBe(
        true,
      );
      expect(
        single.content.filter((v: any) => v.type === "resource"),
      ).toHaveLength(1);
      expect(JSON.stringify(single)).not.toContain("private-file-canary");
    } finally {
      moodleFileMode = "binary";
    }
  });
  it("downloads and syncs attachments across new CDN distributions using the default provider rules", async () => {
    try {
      for (const mode of ["allowed", "allowed_other"] as const) {
        moodleFileMode = mode;
        for (const name of ["moodle_file", "moodle_download", "moodle_sync"]) {
          const result = (
            await call(a, name, { unit: unit.key, activity_id: 10 })
          ).result;
          expect(
            result.isError,
            `${mode}/${name}: ${JSON.stringify(result.structuredContent)}`,
          ).not.toBe(true);
          expect(
            result.content.filter((v: any) => v.type === "resource"),
          ).toHaveLength(name === "moodle_file" ? 1 : 3);
          if (name !== "moodle_file")
            expect(result.structuredContent.errors).toEqual([]);
          expect(JSON.stringify(result)).not.toContain("private-file-canary");
        }
      }
    } finally {
      moodleFileMode = "binary";
    }
  });
  it.each([
    ["denied", "PLATFORM_REQUEST_REJECTED"],
    ["missing", "FILE_NOT_FOUND"],
  ] as const)(
    "reports the real Moodle %s error without returning upstream bodies",
    async (mode, code) => {
      moodleFileMode = mode;
      try {
        const single = (
          await call(a, "moodle_file", {
            unit: unit.key,
            activity_id: 10,
            file_index: 1,
          })
        ).result;
        const batch = (
          await call(a, "moodle_download", { unit: unit.key, activity_id: 10 })
        ).result;
        expect(single.structuredContent.code).toBe(code);
        expect(batch.structuredContent.errors.map((e: any) => e.code)).toEqual([
          code,
          code,
          code,
        ]);
        expect(JSON.stringify({ single, batch })).not.toContain(
          "upstream-credential-canary",
        );
      } finally {
        moodleFileMode = "binary";
      }
    },
  );
  it("delivers a full 16 MiB Moodle file with a verifiable digest", async () => {
    moodleFileMode = "large";
    try {
      const single = (
        await call(a, "moodle_file", {
          unit: unit.key,
          activity_id: 10,
          file_index: 1,
        })
      ).result;
      expect(
        single?.isError,
        JSON.stringify(single?.structuredContent),
      ).not.toBe(true);
      expect(single.structuredContent.file.bytes).toBe(16 * 1024 * 1024);
      const resource = single.content.find(
        (v: any) => v.type === "resource",
      ).resource;
      const bytes = Buffer.from(resource.blob, "base64");
      expect(bytes.length).toBe(16 * 1024 * 1024);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        single.structuredContent.file.sha256,
      );
    } finally {
      moodleFileMode = "binary";
    }
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
    expect(denied.structuredContent.message).toContain("permission upgrade");
    expect(denied._meta["mcp/www_authenticate"][0]).toContain(
      "insufficient_scope",
    );
    expect(
      (await call(reader, "preview_course_bindings", { courses: [unit] }))
        .result.structuredContent.code,
    ).toBe("INSUFFICIENT_SCOPE");
    expect(
      (
        await call(reader, "confirm_course_bindings", {
          preview_id: "a".repeat(64),
        })
      ).result.structuredContent.code,
    ).toBe("INSUFFICIENT_SCOPE");
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
    const metadata = await request("/.well-known/oauth-protected-resource/mcp");
    expect(((await metadata.json()) as any).scopes_supported).toEqual([
      "learning:read",
      "learning:bindings",
    ]);
    const unauthenticated = await request("/mcp");
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("www-authenticate")).toContain(
      'scope="learning:read learning:bindings"',
    );
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
    const viewResponse = await request("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${a.token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "resources/read",
        params: { uri: "ui://learning/ed-view.html" },
      }),
    });
    const view = ((await viewResponse.json()) as any).result.contents[0];
    expect(view._meta.ui.csp).toEqual({
      connectDomains: [],
      resourceDomains: [],
    });
    const messages: unknown[] = [];
    const script = view.text.match(/<script>([\s\S]*?)<\/script>/)[1];
    // Execute the actual production resource in an isolated browser-shaped context.
    // This catches bundler helper references escaping into embedded browser code.
    runInNewContext(script, {
      document: { getElementById: () => ({}) },
      window: {
        parent: { postMessage: (message: unknown) => messages.push(message) },
        addEventListener: () => {},
      },
    });
    expect(messages).toEqual([
      expect.objectContaining({
        method: "ui/initialize",
        params: expect.objectContaining({
          appInfo: { name: "Learning read view", version: "1.0.0" },
        }),
      }),
    ]);
    const tools = ((await response.json()) as any).result.tools;
    expect(tools).toHaveLength(readCapabilities.length + 10);
    expect(tools.find((t: any) => t.name === "get_profile")).toMatchObject({
      _meta: { "openai/profile": true },
      outputSchema: { required: ["id"] },
    });
    expect(
      tools.find((t: any) => t.name === "bind_course").securitySchemes[0]
        .scopes,
    ).toContain("learning:bindings");
    for (const name of ["preview_course_bindings", "confirm_course_bindings"])
      expect(
        tools.find((t: any) => t.name === name).securitySchemes[0].scopes,
      ).toContain("learning:bindings");
    expect(
      (await call(a, "upstream_versions")).result.structuredContent.upstreams.ed
        .sha,
    ).toHaveLength(40);
  });
  it("previews cross-platform display codes and atomically confirms mappings in the real account state", async () => {
    const before = (await call(a, "course_units")).result.structuredContent
      .units;
    const replacement = {
      ...unit,
      key: "canonical-course",
      code: "CS102/CS101/CS103",
      year: 2025,
      teaching_period: "custom-term",
      campus: "chosen-location",
    };
    const preview = (
      await call(a, "preview_course_bindings", { courses: [replacement] })
    ).result;
    expect(preview.isError).not.toBe(true);
    expect(preview.structuredContent.needs_confirmation).toBe(true);
    expect(preview.structuredContent.courses[0].warnings).toContainEqual(
      expect.objectContaining({ code: "DIFFERENT_COURSE_CONTEXT" }),
    );
    expect(preview.structuredContent.courses[0].warnings).toContainEqual(
      expect.objectContaining({
        platform: "moodle",
        platform_code: "CSC1001_S2_2026",
      }),
    );
    expect(
      (await call(a, "course_units")).result.structuredContent.units,
    ).toEqual(before);
    const preview_id = preview.structuredContent.preview_id;
    expect(
      (await call(b, "confirm_course_bindings", { preview_id })).result
        .structuredContent.code,
    ).toBe("BINDING_PREVIEW_EXPIRED");
    expect(
      (await call(a, "confirm_course_bindings", { preview_id })).result
        .structuredContent.saved,
    ).toBe(1);
    expect(
      (await call(a, "course_units")).result.structuredContent.units,
    ).toEqual([replacement]);
    expect(
      (await call(a, "confirm_course_bindings", { preview_id })).result
        .structuredContent.already_confirmed,
    ).toBe(true);
    expect(
      (await call(a, "ed_lessons", { unit: replacement.key })).result.isError,
    ).not.toBe(true);
  });
  it("reads a Moodle-only mapping without an Ed or OnTrack connection", async () => {
    expect(
      (await call(b, "disconnect_platform", { platform: "ed" })).result.isError,
    ).not.toBe(true);
    expect(
      (
        await action(b, "platform", {
          platform: "moodle",
          base_link: moodle,
          mode: "session",
          cookie_name: "MoodleSession",
          cookie_value: "moodle-b",
          confirm: "yes",
        })
      ).status,
    ).toBe(303);
    const status = (await call(b, "connection_status")).result
      .structuredContent;
    expect(status.ed.status).toBe("not_connected");
    expect(status.platforms.ontrack.status).toBe("not_connected");
    const discovered = (await call(b, "discover_courses")).result
      .structuredContent;
    expect(discovered.courses).toEqual([
      expect.objectContaining({ platform: "moodle", id: 203 }),
    ]);
    const course = {
      ...unit,
      key: "moodle-only",
      code: "MY-COURSE",
      ed_course_id: undefined,
      moodle_course_id: 203,
      ontrack_unit_id: undefined,
      ontrack_project_id: undefined,
    };
    const preview = (
      await call(b, "preview_course_bindings", { courses: [course] })
    ).result;
    expect(preview.isError).not.toBe(true);
    expect(
      (
        await call(b, "confirm_course_bindings", {
          preview_id: preview.structuredContent.preview_id,
        })
      ).result.structuredContent.saved,
    ).toBe(1);
    const read = (await call(b, "moodle_unit", { unit: course.key })).result;
    expect(read.isError, JSON.stringify(read)).not.toBe(true);
    expect(read.structuredContent.unit.id).toBe(203);
    expect(
      (await call(b, "disconnect_platform", { platform: "moodle" })).result
        .isError,
    ).not.toBe(true);
    expect(
      (await action(b, "ed", { token: "ed-user-b", confirm: "yes" })).status,
    ).toBe(303);
  });
  it("accepts slash-separated codes through both MCP and the browser binding form", async () => {
    edCourseCode = "CS102/CS101/CS103";
    try {
      await call(b, "discover_courses");
      const page = await request("/landing", { headers: { cookie: b.cookie } });
      const pattern = (await page.text()).match(
        /name="code"[^>]*pattern="([^"]+)"/,
      )![1]!;
      expect(new RegExp(`^(?:${pattern})$`, "v").test(edCourseCode)).toBe(true);
      const course = {
        ...unit,
        key: "combined-course",
        code: "cs102/cs101/cs103",
        ed_course_id: 102,
        moodle_course_id: undefined,
        ontrack_unit_id: undefined,
        ontrack_project_id: undefined,
      };
      const bound = (await call(b, "bind_course", { course })).result;
      expect(bound.isError).not.toBe(true);
      expect(bound.structuredContent.unit.code).toBe(edCourseCode);
      expect(
        (await call(b, "ed_lessons", { unit: "cs102/cs101/cs103" })).result
          .isError,
      ).not.toBe(true);
      await call(b, "unbind_course", { key: course.key });
      const saved = await action(b, "bind", {
        code: "cs102/cs101/cs103",
        name: unit.name,
        campus: unit.campus,
        year: String(unit.year),
        teaching_period: unit.teaching_period,
        timezone: unit.timezone,
        ed_course_id: "102",
      });
      expect(saved.status).toBe(303);
      const units = (await call(b, "course_units")).result.structuredContent
        .units;
      expect(units).toHaveLength(1);
      expect(units[0].code).toBe(edCourseCode);
      expect(units[0].key).toMatch(/^[a-zA-Z0-9_-]+$/);
      const hyphenatedKey =
        `CS102-CS101-CS103-${unit.campus}-${unit.year}-${unit.teaching_period}`
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, "-");
      expect(units[0].key).not.toBe(hyphenatedKey);
      await call(b, "unbind_course", { key: units[0].key });
    } finally {
      edCourseCode = "CSC1001";
    }
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
