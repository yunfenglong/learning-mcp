import {
  verificationFields,
  retentionFields,
  retentionChoices,
} from "./sign-in-fields.ts";
import { z } from "zod";
import { EdClient } from "../../vendor/ed/client.js";
import type { Config, Env } from "../config.ts";
import type { Platform, Unit } from "../domain/units.ts";
import { COURSE_CODE_PATTERN } from "../domain/units.ts";
import { AccountService } from "../accounts/service.ts";
import type { Discovery } from "../accounts/courses.ts";
import {
  browserSession,
  requireBrowser,
  checkCsrf,
  SESSION_COOKIE,
} from "../auth/login.ts";
import { globalCall, stateCall } from "../auth/client.ts";
import { digest } from "../auth/crypto.ts";
import { connectionSchema, type Grant } from "../auth/state.ts";
import { brokerCall } from "../platforms/broker.ts";
import { platformFetch } from "../platforms/network.ts";
import { platformBaseLink } from "../platforms/base-link.ts";
import {
  USAGE_VERSION,
  usageNotice,
  usageLabel,
  termsApproval,
  type UsageAcceptance,
} from "../domain/usage.ts";
import { SuiteError } from "../errors.ts";
import { escapeHtml as e, html, cookie } from "./common.ts";
const platformSchema = z.enum(["ed", "moodle", "ontrack"]);
export { page } from "./ui.ts";
import { page } from "./ui.ts";
function hidden(csrf: string, ticket?: string) {
  return `<input type="hidden" name="csrf" value="${e(csrf)}">${ticket ? `<input type="hidden" name="ticket" value="${e(ticket)}">` : ""}`;
}
function removalControls(csrf: string, grants: Grant[]) {
  return `<section class="notice"><h2>Prefer to remove access?</h2><p>You can remove access without accepting the updated notice or terms. <a href="/data-controls">See what each action removes</a>.</p>${grants
    .filter((g) => !g.revoked && g.expires_at > Date.now())
    .map(
      (g) =>
        `<form method="post" action="/account/revoke">${hidden(csrf)}<input type="hidden" name="grant_id" value="${e(g.id)}"><button class="secondary">Revoke ${e(g.client_name)}</button></form>`,
    )
    .join(
      "",
    )}<form method="post" action="/account/forget-login">${hidden(csrf)}<label><input type="checkbox" name="confirm" value="yes" required> Remove shared saved sign-in; keep platform sessions</label><button class="secondary">Remove saved sign-in</button></form><form method="post" action="/account/disconnect">${hidden(csrf)}<label>Platform to disconnect<select name="platform"><option value="ed">Ed</option><option value="moodle">Moodle</option><option value="ontrack">OnTrack</option></select></label><label><input type="checkbox" name="confirm" value="yes" required> Delete this platform's stored access</label><button class="secondary">Disconnect platform</button></form><form method="post" action="/account/logout">${hidden(csrf)}<button class="secondary">Sign out</button></form></section>`;
}
interface Ticket {
  account: string;
  platform: Platform;
}
async function checkTicket(
  env: Env,
  ticket: string,
  account: string,
  take = false,
): Promise<Ticket | null> {
  if (!ticket) return null;
  if (!/^[a-f0-9]{64}$/.test(ticket))
    throw new SuiteError(
      "INVALID_CONNECTION",
      "Open a new connection link.",
      403,
    );
  const v = await globalCall<Ticket | null>(env, "/ephemeral/get", {
    key: `connect:${await digest(ticket)}`,
    take,
  });
  if (!v || v.account !== account)
    throw new SuiteError(
      "ACCOUNT_MISMATCH",
      "Sign in with the same account used by your MCP client, or open a new connection link.",
      403,
    );
  return v;
}
export async function landing(request: Request, env: Env, config: Config) {
  if (request.method !== "GET")
    throw new SuiteError("METHOD_NOT_ALLOWED", "Use GET.", 405);
  const session = await browserSession(request, env),
    url = new URL(request.url);
  if (!session)
    return html(
      page(
        `<section class="hero"><div><span class="eyebrow">Ed · Moodle · OnTrack</span><h1>Less switching.<br>More learning.</h1><p class="intro">Bring your course materials, discussions and deadlines into the MCP client you use. Choose the platforms and courses to connect.</p><div class="actions"><a class="button" href="/login?return_to=${e(encodeURIComponent(url.pathname === "/" ? "/landing" : url.pathname + url.search))}">Connect your accounts <span aria-hidden="true">→</span></a><a class="text-link" href="#how-it-works">How it works</a></div><p class="muted small">Read-only access. You control the connections.</p></div><aside class="hero-visual" aria-label="Supported learning platforms"><div class="visual-label"><span>Your learning platforms</span><span>One workspace</span></div><div class="platform-preview"><span class="platform-icon" aria-hidden="true">E</span><div><strong>Ed Discussion</strong><p>Discussions &amp; lessons</p></div></div><div class="platform-preview"><span class="platform-icon" aria-hidden="true">M</span><div><strong>Moodle</strong><p>Materials, deadlines &amp; grades</p></div></div><div class="platform-preview"><span class="platform-icon" aria-hidden="true">O</span><div><strong>OnTrack</strong><p>Tasks &amp; project progress</p></div></div><p class="visual-caption">Connect any combination your courses use.</p></aside></section><section class="workflow" id="how-it-works" aria-label="How it works"><div><span class="step-number">01</span><h3>Sign in to your account</h3><p>Use SSO or an Ed API token. Complete verification when your provider requests it.</p></div><div><span class="step-number">02</span><h3>Connect your platforms</h3><p>Add the accounts you use, then review and confirm which courses belong together.</p></div><div><span class="step-number">03</span><h3>Return to your client</h3><p>Authorize your MCP client to read the connected course information you request.</p></div></section>${usageNotice}`,
      ),
    );
  const accepted = await stateCall<UsageAcceptance | null>(
    env,
    session.profile.id,
    "/usage",
  );
  if (
    accepted?.version !== USAGE_VERSION ||
    accepted.terms_version !== USAGE_VERSION
  ) {
    const { grants } = await stateCall<{ grants: Grant[] }>(
      env,
      session.profile.id,
      "/grants",
    );
    return html(
      page(
        `${usageNotice}<form method="post" action="/account/usage">${hidden(session.csrf)}<input type="hidden" name="version" value="${USAGE_VERSION}"><input type="hidden" name="ticket" value="${e(url.searchParams.get("ticket") ?? "")}"><label><input type="checkbox" name="confirm" value="yes" required> ${usageLabel}</label>${termsApproval}<button>Accept and continue</button></form>${removalControls(session.csrf, grants)}`,
      ),
    );
  }
  const ticket = url.searchParams.get("ticket") ?? "",
    context = await checkTicket(env, ticket, session.profile.id),
    service = new AccountService(env, session.profile, config);
  const units = (
    await stateCall<{ units: Unit[] }>(env, session.profile.id, "/units")
  ).units;
  const discovery = await stateCall<Discovery | null>(
    env,
    session.profile.id,
    "/discovery/get",
  );
  const grants = (
    await stateCall<{ grants: Grant[] }>(env, session.profile.id, "/grants")
  ).grants;
  const status = (await service.status()) as any;
  const fields = hidden(session.csrf, ticket);
  const edConnected = status.ed.status === "connected";
  const card = (p: Platform, title: string, body: string) => {
    const state =
      p === "ed"
        ? status.ed.status
        : (status.platforms[p]?.status ?? "unavailable");
    const connected = state === "connected";
    const stateLabel: Record<string, string> = {
      connected: "Connected",
      not_connected: "Not connected",
      unavailable: "Unavailable",
      expired: "Sign-in needed",
      error: "Needs attention",
      reauthentication_required: "Sign-in needed",
    };
    const description =
      p === "ed"
        ? "Discussions & lessons"
        : p === "moodle"
          ? "Materials, deadlines & grades"
          : "Tasks & project progress";
    return `<section class="platform-entry"><div class="platform-heading"><div class="platform-name"><span class="platform-icon" aria-hidden="true">${p === "ed" ? "E" : p === "moodle" ? "M" : "O"}</span><div><h3>${title}</h3><p>${description}</p></div></div><span class="status${connected ? " connected" : ""}">${e(stateLabel[state] ?? "Needs attention")}</span></div><details class="platform-settings"${!connected || context?.platform === p ? " open" : ""}><summary>${connected ? "Manage connection" : "Connect " + title}</summary><div class="platform-body">${body}${connected ? `<details class="disconnect"><summary>Disconnect ${title}</summary><p class="muted">Remove this platform’s stored session and renewal data.</p><form method="post" action="/account/disconnect">${hidden(session.csrf)}<input type="hidden" name="platform" value="${p}"><label><input type="checkbox" name="confirm" value="yes" required> I want to disconnect ${title}</label><button class="secondary">Disconnect ${title}</button></form></details>` : ""}</div></details></section>`;
  };
  const platformForm = (p: Platform) => {
    const savedSite = status.platforms[p]?.site_url ?? "";
    const baseField = `<label>${p === "moodle" ? "Moodle" : "OnTrack"} address<input name="base_link" type="url" required maxlength="2048" placeholder="https://your-platform.example.edu" value="${e(savedSite)}"${savedSite ? " readonly" : ""}></label><p class="muted">${savedSite ? "This is the address saved for your account. To use a different address, disconnect this platform first." : "Use the website address where you open this platform. We save it after verifying the connection."}</p>`;
    const sso = status.platforms.auth_modes?.includes("sso");
    const reuse =
      sso && status.platforms.has_sso
        ? `<form method="post" action="/account/platform">${fields}${baseField}<input type="hidden" name="platform" value="${p}"><input type="hidden" name="mode" value="reuse"><label><input name="confirm" type="checkbox" value="yes" required> Use my saved SSO account to connect ${p === "moodle" ? "Moodle" : "OnTrack"}</label><button>Connect with saved SSO</button></form>`
        : "";
    return `<p class="muted">${p === "moodle" ? "Materials, deadlines and grades." : "Task definitions and project progress."}</p>${reuse}${sso ? `<details ${context?.platform === p ? "open" : ""}><summary>Use different SSO sign-in details</summary><form method="post" action="/account/platform">${fields}${baseField}<input type="hidden" name="platform" value="${p}"><input type="hidden" name="mode" value="sso"><label>SSO username<input name="username" autocomplete="username" required maxlength="200"></label><label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="1000"></label>${verificationFields}${retentionFields}<label><input name="confirm" type="checkbox" value="yes" required> Connect this account</label><button>Connect ${p === "moodle" ? "Moodle" : "OnTrack"}</button></form></details>` : ""}<details><summary>Use an existing platform session</summary><p class="muted">Sign in to ${p === "moodle" ? "Moodle" : "OnTrack"} in your browser, then provide its session here. Session information stays outside the chat. It is verified and stored encrypted to allow future reads and session renewal. The deployment operator holds decryption keys. <a href="/privacy" target="_blank" rel="noopener">Review credential handling</a>.</p><form method="post" action="/account/platform">${fields}${baseField}<input type="hidden" name="platform" value="${p}"><input type="hidden" name="mode" value="session">${p === "moodle" ? `<label>Moodle session cookie<input name="cookie_value" type="password" autocomplete="off" required maxlength="16000"></label><label>Session cookie name<input name="cookie_name" value="MoodleSession" required maxlength="100" pattern="[A-Za-z0-9_-]+"></label>` : `<label>OnTrack username<input name="username" autocomplete="off" required maxlength="200"></label><label>OnTrack access token<input name="token" type="password" autocomplete="off" required maxlength="16000"></label>`}<label><input name="confirm" type="checkbox" value="yes" required> I approve access to this platform account</label><button>Verify and connect</button></form></details>`;
  };
  const edForm = `<p class="muted">Discussions and lessons.${edConnected ? ` Connected as ${e(status.ed.display_name ?? "your Ed account")}.` : ""}</p><details ${context?.platform === "ed" ? "open" : ""}><summary>${edConnected ? "Reconnect" : "Connect"} Ed</summary><form method="post" action="/account/ed">${fields}<label>Ed API token<input name="token" type="password" autocomplete="off" required maxlength="16000"></label><label><input name="confirm" type="checkbox" value="yes" required> I approve access to this Ed account</label><button>Verify and connect</button></form></details>`;
  const options = (p: Platform) =>
    (discovery?.courses ?? [])
      .filter((c) => c.platform === p)
      .map(
        (c) =>
          `<option value="${c.id}" ${c.accessible ? "" : "disabled"}>${e(c.name)} · ${c.id}${c.accessible ? "" : " · unavailable for this connection"}</option>`,
      )
      .join("");
  const mapping = discovery
    ? `<details open><summary>Link a course across platforms</summary><p class="muted">Choose the platforms used by this course. Leave others empty. Use your agreed course code; platform display identifiers may differ. Keep year and teaching period separate, and check campus and semester before saving.</p><form method="post" action="/account/bind">${hidden(session.csrf)}<div class="fields"><label>Course code<input name="code" placeholder="CSC1001" required maxlength="64" pattern="${e(COURSE_CODE_PATTERN)}"></label><label>Course name<input name="name" required maxlength="200"></label><label>Campus / location<input name="campus" placeholder="main or online" required maxlength="100"></label><label>Year<input name="year" type="number" min="2020" max="2100" required></label><label>Teaching period<input name="teaching_period" placeholder="S2" required maxlength="50"></label><label>Timezone<input name="timezone" placeholder="UTC or an IANA timezone" required></label><label>Ed course<select name="ed_course_id"><option value="">No Ed course</option>${options("ed")}</select></label><label>Moodle course<select name="moodle_course_id"><option value="">No Moodle course</option>${options("moodle")}</select></label><label>OnTrack project<select name="ontrack_project_id"><option value="">No OnTrack project</option>${options("ontrack")}</select></label></div><button>Save course link</button></form></details><details><summary>Review discovered courses</summary>${discovery.courses.map((c) => `<p>${e(c.platform)} / ${e(c.name)} <span class="muted">${e(c.code ?? "")} · ${e(c.year ?? "year unknown")} · ${e(c.teaching_period ?? "period unknown")} · ${e(c.campus ?? "campus unknown")}</span><br><small>${e(c.institution_basis)}</small></p>`).join("") || "<p>No courses found. Check your platform connections.</p>"}</details>`
    : "";
  return html(
    page(
      `<div class="page-heading"><div><span class="eyebrow">Your workspace</span><h1>Connections</h1><p class="muted">Choose what your MCP client can read.</p></div><div class="identity"><span class="avatar" aria-hidden="true">${e((session.profile.name ?? session.profile.email ?? "L").slice(0, 1).toUpperCase())}</span><span>${e(session.profile.name ?? session.profile.email ?? "Learning MCP user")}</span></div></div><nav class="section-nav" aria-label="Connection sections"><a href="#platforms">Platforms</a><a href="#courses">Courses</a><a href="#clients">Client access</a><a href="#sign-in">Saved sign-in</a></nav>${context ? `<div class="callout" role="status">Your MCP client requested a connection to ${e(context.platform)}. Connect that platform below, then return to your client.</div>` : ""}<section id="platforms"><div class="section-heading"><div><h2>Learning platforms</h2><p>Connect the platforms you use. Each course can use any combination.</p><p>After connecting, return to your MCP client to continue.</p></div><div class="platform-list">${card("ed", "Ed Discussion", edForm)}${card("moodle", "Moodle", platformForm("moodle"))}${card("ontrack", "OnTrack", platformForm("ontrack"))}</div></div></section><section class="section" id="courses"><div class="section-heading"><div><h2>Your courses</h2><p>Review your enrolled courses and link the platforms used by each course.</p></div><div>${units.map((u) => `<div class="row"><div><strong>${e(u.code)} / ${e(u.name)}</strong><div class="muted">${e(u.campus)} · ${u.year} ${e(u.teaching_period)} · ${[u.ed_course_id ? "Ed" : "", u.moodle_course_id ? "Moodle" : "", u.ontrack_project_id ? "OnTrack" : ""].filter(Boolean).join(" + ")}</div></div><form method="post" action="/account/unbind">${hidden(session.csrf)}<input type="hidden" name="key" value="${e(u.key)}"><button class="secondary">Unlink course</button></form></div>`).join("") || '<div class="empty"><h3>Find your courses</h3><p>Connect a platform, then find your enrolled courses. You’ll review and confirm each course link before it is saved.</p></div>'}<form class="actions" method="post" action="/account/discover">${hidden(session.csrf)}<button>Find enrolled courses <span aria-hidden="true">→</span></button></form>${mapping}</div></div></section><section class="section" id="clients"><div class="section-heading"><div><h2>Client access</h2><p>Manage the MCP clients you’ve authorized to read your learning data.</p></div><div>${
        grants
          .filter((g) => !g.revoked && g.expires_at > Date.now())
          .map(
            (g) =>
              `<div class="row"><div><strong>${e(g.client_name)}</strong><div class="muted">${e(g.scopes.join(", "))}</div></div><form method="post" action="/account/revoke">${hidden(session.csrf)}<input type="hidden" name="grant_id" value="${e(g.id)}"><button class="secondary">Revoke access</button></form></div>`,
          )
          .join("") ||
        '<div class="empty"><h3>No clients connected</h3><p>Open your MCP client and connect it to Learning MCP. You’ll review its requested permissions before granting access.</p></div>'
      }</div></div></section><section class="section" id="sign-in"><div class="section-heading"><div><h2>Saved sign-in</h2><p>Control the credentials used to renew your platform sessions. <a href="/data-controls">Compare removal options</a>.</p></div><div><details><summary>Remove saved sign-in</summary><p class="muted">Delete the shared password, TOTP secret and SSO browser cookies. Existing platform sessions and their renewal cookies stay connected.</p><form method="post" action="/account/forget-login">${hidden(session.csrf)}<label><input type="checkbox" name="confirm" value="yes" required> I want to remove my saved sign-in</label><button class="secondary">Remove saved sign-in</button></form></details></div></div></section><div class="settings-end">${usageNotice}<form method="post" action="/account/logout">${hidden(session.csrf)}<button class="secondary">Sign out</button><p class="muted small">Signing out leaves your platform connections in place.</p></form></div>`,
      "Your connections",
    ),
  );
}
export async function accountAction(
  request: Request,
  env: Env,
  config: Config,
) {
  if (request.method !== "POST")
    throw new SuiteError("METHOD_NOT_ALLOWED", "Use POST.", 405);
  const session = await requireBrowser(request, env),
    form = await request.formData();
  checkCsrf(request, session, form.get("csrf"), config.issuer);
  const action = new URL(request.url).pathname,
    service = new AccountService(env, session.profile, config),
    ticket = String(form.get("ticket") ?? "");
  if (action === "/account/usage") {
    if (form.get("confirm") !== "yes" || form.get("terms_consent") !== "accept")
      throw new SuiteError("USAGE_REQUIRED", "Accept the usage notice.", 403);
    await stateCall(env, session.profile.id, "/usage/accept", {
      version: form.get("version"),
    });
    return new Response(null, {
      status: 303,
      headers: {
        location: `/landing${ticket ? `?ticket=${encodeURIComponent(ticket)}` : ""}`,
      },
    });
  }
  if (
    ![
      "/account/logout",
      "/account/revoke",
      "/account/disconnect",
      "/account/forget-login",
    ].includes(action)
  )
    await stateCall(env, session.profile.id, "/usage/check");
  const context = await checkTicket(env, ticket, session.profile.id);
  if (action === "/account/ed") {
    if (context && context.platform !== "ed")
      throw new SuiteError(
        "INVALID_CONNECTION",
        "Open the correct platform connection.",
        403,
      );
    if (form.get("confirm") !== "yes")
      throw new SuiteError("CONSENT_REQUIRED", "Approve this connection.");
    const token = z
      .string()
      .min(1)
      .max(16000)
      .refine((s) => !/[\r\n]/.test(s))
      .parse(form.get("token"));
    const api = new EdClient({
      token,
      apiBaseUrl: "https://edstem.org/api/",
      fetch: platformFetch("https://edstem.org"),
      maxRetries: 0,
    });
    let user: any;
    try {
      user = (await api.fetchUser()).user;
    } catch {
      throw new SuiteError(
        "ED_LOGIN_FAILED",
        "The Ed token could not be verified. Check the token and try again.",
        409,
      );
    }
    if (!Number.isSafeInteger(user.id) || user.id <= 0)
      throw new SuiteError(
        "ED_LOGIN_FAILED",
        "Ed did not return a verified account.",
        409,
      );
    if (ticket) await checkTicket(env, ticket, session.profile.id, true);
    await stateCall(
      env,
      session.profile.id,
      "/connection/put",
      connectionSchema.parse({
        token,
        profile_id: String(user.id),
        display_name: String(user.name ?? "").slice(0, 200),
      }),
    );
  } else if (action === "/account/platform") {
    const platform = z.enum(["moodle", "ontrack"]).parse(form.get("platform"));
    if (context && context.platform !== platform)
      throw new SuiteError(
        "INVALID_CONNECTION",
        "Open the correct platform connection.",
        403,
      );
    if (form.get("confirm") !== "yes")
      throw new SuiteError("CONSENT_REQUIRED", "Approve this connection.");
    const mode = z.enum(["sso", "reuse", "session"]).parse(form.get("mode"));
    const input =
      mode === "reuse"
        ? null
        : mode === "sso"
          ? {
              username: String(form.get("username") ?? ""),
              password: String(form.get("password") ?? ""),
              mfa_code: String(form.get("mfa_code") ?? ""),
              ...retentionChoices(form),
              ...(form.get("totp_secret")
                ? { totp_secret: String(form.get("totp_secret")) }
                : {}),
            }
          : platform === "moodle"
            ? {
                cookie_name: String(form.get("cookie_name") ?? "MoodleSession"),
                cookie_value: String(form.get("cookie_value") ?? ""),
              }
            : {
                username: String(form.get("username") ?? ""),
                token: String(form.get("token") ?? ""),
              };
    if (ticket) await checkTicket(env, ticket, session.profile.id, true);
    await brokerCall(env, session.profile.id, "/v1/connect", {
      platform,
      base_link: platformBaseLink(form.get("base_link")),
      mode: mode === "reuse" ? "sso" : mode,
      input,
    });
    await stateCall(env, session.profile.id, "/disconnect", { platform });
  } else if (action === "/account/forget-login") {
    if (form.get("confirm") !== "yes")
      throw new SuiteError(
        "CONSENT_REQUIRED",
        "Confirm removal of the saved sign-in.",
      );
    await brokerCall(env, session.profile.id, "/v1/forget-login");
  } else if (action === "/account/discover") await service.discover();
  else if (action === "/account/bind") {
    const discovery = await stateCall<Discovery | null>(
      env,
      session.profile.id,
      "/discovery/get",
    );
    const project = Number(form.get("ontrack_project_id"));
    const code = String(form.get("code") ?? "").toUpperCase(),
      year = Number(form.get("year")),
      campus = String(form.get("campus")),
      period = String(form.get("teaching_period"));
    const keyLabel = `${code}-${campus}-${year}-${period}`
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-");
    const unit: Record<string, unknown> = {
      // A slash-containing code must not overwrite a different hyphenated code.
      key: code.includes("/")
        ? `${keyLabel.slice(0, 87)}-${(await digest(JSON.stringify([code, campus, year, period]))).slice(0, 12)}`
        : keyLabel,
      code,
      name: String(form.get("name") ?? ""),
      year,
      campus,
      teaching_period: period,
      timezone: String(form.get("timezone")),
    };
    for (const field of ["ed_course_id", "moodle_course_id"]) {
      const id = Number(form.get(field));
      if (id) unit[field] = id;
    }
    if (project) {
      unit.ontrack_project_id = project;
      unit.ontrack_unit_id = discovery?.courses.find(
        (c) => c.platform === "ontrack" && c.id === project,
      )?.unit_id;
    }
    await stateCall(env, session.profile.id, "/bind", unit);
  } else if (action === "/account/unbind")
    await service.unbind(z.string().min(1).max(100).parse(form.get("key")));
  else if (action === "/account/disconnect") {
    if (form.get("confirm") !== "yes")
      throw new SuiteError("CONSENT_REQUIRED", "Confirm the disconnect.");
    await service.disconnect(platformSchema.parse(form.get("platform")));
  } else if (action === "/account/revoke")
    await stateCall(env, session.profile.id, "/revoke", {
      grant_id: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(form.get("grant_id")),
    });
  else if (action === "/account/logout") {
    await globalCall(env, "/ephemeral/delete", {
      key: `session:${await digest(cookie(request, SESSION_COOKIE))}`,
    });
    return new Response(null, {
      status: 303,
      headers: {
        location: "/landing",
        "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      },
    });
  } else throw new SuiteError("NOT_FOUND", "Unknown account action.", 404);
  return new Response(null, { status: 303, headers: { location: "/landing" } });
}
