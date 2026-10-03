import { z } from "zod";
import { EdClient } from "../../vendor/ed/client.js";
import type { Config, Env } from "../config.ts";
import type { Platform, Unit } from "../domain/units.ts";
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
import {
  USAGE_VERSION,
  usageNotice,
  usageLabel,
  type UsageAcceptance,
} from "../domain/usage.ts";
import { SuiteError } from "../errors.ts";
import { escapeHtml as e, html, cookie } from "./common.ts";
const platformSchema = z.enum(["ed", "moodle", "ontrack"]);
const css = `:root{--ink:#1e2926;--paper:#f7f5ee;--line:#d6d8cb;--accent:#ba3d2a}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 'Avenir Next','Gill Sans',sans-serif}a{color:inherit;text-underline-offset:4px}header{border-bottom:1px solid var(--line);padding:22px 5vw;display:flex;justify-content:space-between;align-items:center;gap:24px}header strong{font-size:19px;letter-spacing:-.5px}header small{font-size:12px}main{max-width:1140px;margin:auto;padding:64px 32px}h1,h2,h3{font-family:Georgia,'Times New Roman',serif;font-weight:400;line-height:1.13}h1{font-size:clamp(38px,6vw,72px);max-width:760px;margin:18px 0 24px;letter-spacing:-2px}h2{font-size:32px;margin:0 0 20px}h3{font-size:24px;margin:0}.eyebrow{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--accent)}.intro{max-width:620px;margin-bottom:48px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin:32px 0 64px}.card{padding:28px 22px;border-right:1px solid var(--line)}.card:last-child{border-right:0}.status{font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:14px 0;color:#465f53}.section{padding:36px 0;border-top:1px solid var(--line)}label{display:block;font-size:14px;margin:16px 0 6px}input,select,textarea{font:inherit;border:1px solid #aeb8a9;background:#fffefa;width:100%;padding:10px;border-radius:3px;color:var(--ink)}textarea{min-height:120px}input[type=checkbox]{width:auto;margin-right:8px}button,.button{display:inline-block;background:var(--ink);color:#fff;border:1px solid var(--ink);border-radius:3px;padding:11px 18px;font:inherit;cursor:pointer;text-decoration:none;margin-top:16px}button:hover,.button:hover{background:#375447}button.secondary{background:transparent;color:var(--ink)}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.muted{font-size:14px;color:#5c685e}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px}.row{padding:20px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:24px;align-items:center}details{margin:18px 0}summary{cursor:pointer}form{max-width:720px}.notice{border-left:3px solid var(--accent);padding:12px 20px;background:#eceee3;margin:24px 0}.inline{display:inline}.small{font-size:12px}footer{padding:32px 5vw;border-top:1px solid var(--line);font-size:12px}pre{overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 monospace}@media(max-width:760px){main{padding:40px 22px}.grid{grid-template-columns:1fr}.card{border-right:0;border-bottom:1px solid var(--line);padding:24px 0}.card:last-child{border-bottom:0}.fields{grid-template-columns:1fr}.row{align-items:flex-start;flex-direction:column}header{align-items:flex-start;flex-direction:column;gap:4px}h1{letter-spacing:-1px}}`;
export function page(content: string) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Learning MCP Suite · Your connections</title><style>${css}</style><header><strong>Learning MCP Suite</strong><small>Okta · Moodle · Ed · OnTrack</small></header><main>${content}</main><footer>Connect only accounts you are entitled to use. Educational data is read-only. Attendance codes are found with sources; attendance is never submitted.</footer></html>`;
}
function hidden(csrf: string, ticket?: string) {
  return `<input type="hidden" name="csrf" value="${e(csrf)}">${ticket ? `<input type="hidden" name="ticket" value="${e(ticket)}">` : ""}`;
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
      "Sign in with the same account selected in ChatGPT, or open a new connection link.",
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
        `<span class="eyebrow">One connection. Your semester.</span><h1>Your courses,<br>within reach.</h1><p class="intro">Connect your Ed, Moodle and OnTrack accounts. Ask ChatGPT about learning materials, deadlines and attendance-code evidence across the platforms your courses use.</p><a class="button" href="/login?return_to=${e(encodeURIComponent(url.pathname === "/" ? "/landing" : url.pathname + url.search))}">Sign in to connect</a><p class="muted">You choose which platforms and courses to link.</p>${usageNotice}`,
      ),
    );
  const accepted = await stateCall<UsageAcceptance | null>(
    env,
    session.profile.id,
    "/usage",
  );
  if (accepted?.version !== USAGE_VERSION)
    return html(
      page(
        `${usageNotice}<form method="post" action="/account/usage">${hidden(session.csrf)}<input type="hidden" name="version" value="${USAGE_VERSION}"><input type="hidden" name="ticket" value="${e(url.searchParams.get("ticket") ?? "")}"><label><input type="checkbox" name="confirm" value="yes" required> ${usageLabel}</label><button>Accept and continue</button></form>`,
      ),
    );
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
  const card = (p: Platform, title: string, body: string) =>
    `<section class="card"><span class="eyebrow">${p === "ed" ? "01" : p === "moodle" ? "02" : "03"}</span><h3>${title}</h3><div class="status">${e(p === "ed" ? status.ed.status : (status.platforms[p]?.status ?? "unavailable"))}</div>${body}<form method="post" action="/account/disconnect">${hidden(session.csrf)}<input type="hidden" name="platform" value="${p}"><label><input type="checkbox" name="confirm" value="yes" required> Disconnect this platform</label><button class="secondary">Disconnect</button></form></section>`;
  const platformForm = (p: Platform) => {
    const sso = status.platforms.auth_modes?.includes("sso");
    const reuse =
      sso && status.platforms.has_sso
        ? `<form method="post" action="/account/platform">${fields}<input type="hidden" name="platform" value="${p}"><input type="hidden" name="mode" value="reuse"><label><input name="confirm" type="checkbox" value="yes" required> Connect ${e(p)} using my saved SSO account</label><button>Use saved SSO sign-in</button></form>`
        : "";
    return `<p class="muted">${p === "moodle" ? "Materials, deadlines and grades." : "Task definitions and project progress."}</p>${reuse}${sso ? `<details ${context?.platform === p ? "open" : ""}><summary>Connect with Okta / SSO</summary><form method="post" action="/account/platform">${fields}<input type="hidden" name="platform" value="${p}"><input type="hidden" name="mode" value="sso"><label>SSO username<input name="username" autocomplete="username" required maxlength="200"></label><label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="1000"></label><label>TOTP secret or otpauth URI (optional)<input name="totp_secret" type="password" autocomplete="off" maxlength="2048"></label><p class="muted">A TOTP secret lets this service generate future verification codes. Save it only if you authorize automated sign-in.</p><label>MFA code, if requested<input name="mfa_code" autocomplete="one-time-code" maxlength="20"></label><label><input name="remember" type="checkbox" value="yes"> Save my encrypted password and optional TOTP secret for automatic sign-in when sessions expire</label><label><input name="confirm" type="checkbox" value="yes" required> Connect this account</label><button>Connect ${e(p)}</button></form></details>` : ""}<details><summary>Use an existing platform session</summary><p class="muted">Sign in to ${e(config.platforms[p]?.site_url ?? p)} in your browser, then provide its session here. Session information stays outside the chat.</p><form method="post" action="/account/platform">${fields}<input type="hidden" name="platform" value="${p}"><input type="hidden" name="mode" value="session">${p === "moodle" ? `<label>Moodle session cookie<input name="cookie_value" type="password" autocomplete="off" required maxlength="16000"></label><input type="hidden" name="cookie_name" value="MoodleSession">` : `<label>OnTrack username<input name="username" autocomplete="off" required maxlength="200"></label><label>OnTrack access token<input name="token" type="password" autocomplete="off" required maxlength="16000"></label>`}<label><input name="confirm" type="checkbox" value="yes" required> I approve access to this platform account</label><button>Verify and connect</button></form></details>`;
  };
  const edForm = `<p class="muted">Discussions and lessons.${edConnected ? ` Connected as ${e(status.ed.display_name ?? "your Ed account")}.` : ""}</p><details ${context?.platform === "ed" ? "open" : ""}><summary>${edConnected ? "Reconnect" : "Connect"} Ed</summary><form method="post" action="/account/ed">${fields}<label>Ed API token<input name="token" type="password" autocomplete="off" required maxlength="16000"></label><label><input name="confirm" type="checkbox" value="yes" required> I approve access to this Ed account</label><button>Verify and connect</button></form></details>`;
  const options = (p: Platform) =>
    (discovery?.courses ?? [])
      .filter((c) => c.platform === p)
      .map(
        (c) =>
          `<option value="${c.id}" ${c.accessible ? "" : "disabled"}>${e(c.name)} · ${c.id}${c.accessible ? "" : " · institution unconfirmed"}</option>`,
      )
      .join("");
  const mapping = discovery
    ? `<details open><summary>Confirm a course association</summary><p class="muted">Choose the platforms used by this course. Leave others empty. Check campus and semester before saving.</p><form method="post" action="/account/bind">${hidden(session.csrf)}<div class="fields"><label>Course code<input name="code" placeholder="CSC1001" required maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9_.-]*"></label><label>Course name<input name="name" required maxlength="200"></label><label>Campus / location<input name="campus" placeholder="main or online" required maxlength="100"></label><label>Year<input name="year" type="number" min="2020" max="2100" required></label><label>Teaching period<input name="teaching_period" placeholder="S2" required maxlength="50"></label><label>Timezone<input name="timezone" placeholder="UTC or an IANA timezone" required></label><label>Ed course<select name="ed_course_id"><option value="">No Ed course</option>${options("ed")}</select></label><label>Moodle course<select name="moodle_course_id"><option value="">No Moodle course</option>${options("moodle")}</select></label><label>OnTrack project<select name="ontrack_project_id"><option value="">No OnTrack project</option>${options("ontrack")}</select></label></div><button>Save course association</button></form></details><details><summary>Review discovered courses</summary>${discovery.courses.map((c) => `<p>${e(c.platform)} / ${e(c.name)} <span class="muted">${e(c.code ?? "")} · ${e(c.year ?? "year unknown")} · ${e(c.teaching_period ?? "period unknown")} · ${e(c.campus ?? "campus unknown")}</span><br><small>${e(c.institution_basis)}</small></p>`).join("") || "<p>No courses found. Check your platform connections.</p>"}</details>`
    : "";
  return html(
    page(
      `<span class="eyebrow">Your account</span><h1>Your semester,<br>connected.</h1><p class="intro">Signed in as <strong>${e(session.profile.name ?? session.profile.email ?? "Learning MCP user")}</strong>. Connect the platforms your courses use, then return to ChatGPT.</p>${context ? `<div class="notice">ChatGPT requested a connection to ${e(context.platform)} for this account.</div>` : ""}<div class="grid">${card("ed", "Ed Discussion", edForm)}${card("moodle", "Moodle", platformForm("moodle"))}${card("ontrack", "OnTrack", platformForm("ontrack"))}</div><section class="section"><h2>Saved sign-in</h2><p>Remove the shared password, TOTP secret and SSO browser cookies while retaining existing platform sessions.</p><form method="post" action="/account/forget-login">${hidden(session.csrf)}<label><input type="checkbox" name="confirm" value="yes" required> Remove my saved sign-in</label><button class="secondary">Forget saved sign-in</button></form></section><section class="section"><span class="eyebrow">Course connections</span><h2>Your courses</h2>${units.map((u) => `<div class="row"><div><strong>${e(u.code)} / ${e(u.name)}</strong><div class="muted">${e(u.campus)} · ${u.year} ${e(u.teaching_period)} · ${[u.ed_course_id ? "Ed" : "", u.moodle_course_id ? "Moodle" : "", u.ontrack_project_id ? "OnTrack" : ""].filter(Boolean).join(" + ")}</div></div><form method="post" action="/account/unbind">${hidden(session.csrf)}<input type="hidden" name="key" value="${e(u.key)}"><button class="secondary">Remove association</button></form></div>`).join("") || "<p>No courses linked yet. Discover your enrolled courses to begin.</p>"}<form method="post" action="/account/discover">${hidden(session.csrf)}<button>Discover enrolled courses</button></form>${mapping}</section><section class="section"><span class="eyebrow">Client permissions</span><h2>Connected clients</h2>${
        grants
          .filter((g) => !g.revoked && g.expires_at > Date.now())
          .map(
            (g) =>
              `<div class="row"><div>${e(g.client_name)}<div class="muted">${e(g.scopes.join(", "))}</div></div><form method="post" action="/account/revoke">${hidden(session.csrf)}<input type="hidden" name="grant_id" value="${e(g.id)}"><button class="secondary">Revoke access</button></form></div>`,
          )
          .join("") || "<p>No active ChatGPT or other client connection.</p>"
      }</section><details><summary>Data handling and usage notice</summary>${usageNotice}</details><form method="post" action="/account/logout">${hidden(session.csrf)}<button class="secondary">Sign out of this page</button></form>`,
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
    if (form.get("confirm") !== "yes")
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
              remember: form.get("remember") === "yes",
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
    const unit: Record<string, unknown> = {
      key: `${code}-${campus}-${year}-${period}`
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-"),
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
