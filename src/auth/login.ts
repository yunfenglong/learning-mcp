import { z } from "zod";
import { EdClient } from "../../vendor/ed/client.js";
import type { Config, Env } from "../config.ts";
import { digest, randomToken } from "./crypto.ts";
import { globalCall, stateCall } from "./client.ts";
import { connectionSchema, type Profile } from "./state.ts";
import { SuiteError } from "../errors.ts";
import { cookie, html } from "../http/common.ts";
import { brokerCall } from "../platforms/broker.ts";
import { platformFetch } from "../platforms/network.ts";
import { USAGE_VERSION, usageNotice, usageLabel } from "../domain/usage.ts";

export const SESSION_COOKIE = "__Host-learning-session";
export interface BrowserSession {
  profile: Profile;
  csrf: string;
}
interface Login {
  browser: string;
  return_to: string;
}
export function safeReturn(value: string, issuer: string) {
  const u = new URL(value, issuer);
  if (u.origin !== issuer || !["/landing", "/authorize"].includes(u.pathname))
    throw new SuiteError("INVALID_RETURN", "Invalid sign-in return address.");
  return u.pathname + u.search;
}
export async function startLogin(request: Request, env: Env, config: Config) {
  if (request.method !== "GET")
    throw new SuiteError("METHOD_NOT_ALLOWED", "Use GET or POST.", 405);
  const nonce = randomToken(),
    browser = randomToken();
  const return_to = safeReturn(
    new URL(request.url).searchParams.get("return_to") ?? "/landing",
    config.issuer,
  );
  await globalCall(env, "/ephemeral/put", {
    key: `login:${await digest(nonce)}`,
    value: { browser: await digest(browser), return_to },
    expires_at: Date.now() + 600_000,
  });
  const fields = `<input type="hidden" name="nonce" value="${nonce}"><input type="hidden" name="usage_version" value="${USAGE_VERSION}">`;
  const approval = `<label><input type="checkbox" name="usage_consent" value="accept" required> ${usageLabel}</label>`;
  const sso = (["moodle", "ontrack"] as const)
    .filter((p) => config.platforms[p])
    .map(
      (p) =>
        `<option value="${p}">${p === "moodle" ? "Moodle" : "OnTrack"}</option>`,
    )
    .join("");
  return html(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Learning MCP</title><style>body{font:16px system-ui;max-width:720px;margin:6vh auto;padding:24px;line-height:1.6;color:#172f2c}label{display:block;margin:16px 0}input:not([type=checkbox]),select{display:block;width:100%;box-sizing:border-box;padding:10px;font:inherit}button{padding:12px 20px}.notice{border-left:3px solid #375447;padding:8px 20px;margin:24px 0}</style><h1>Sign in with your learning account</h1><p>Verify one platform account to sign in. Then connect Ed, Moodle and OnTrack together from your connections page. Each course can use any combination of platforms.</p><p>To return to this Learning MCP account, sign in with the same platform account you used to create it.</p>${usageNotice}${
      sso
        ? `<form method="post" action="/login">${fields}<label>Sign-in platform<select name="platform">${sso}</select></label><label>Platform base link<input name="base_link" type="url" required placeholder="https://your-platform.example" maxlength="2048"></label><p>Enter the base link you normally use to open this platform. The service must support that platform.</p><label>SSO username<input name="username" autocomplete="username" required maxlength="200"></label><label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="1000"></label><label>TOTP secret or otpauth URI (optional)<input name="totp_secret" type="password" autocomplete="off" maxlength="2048"></label><label>One-time MFA code (optional)<input name="mfa_code" autocomplete="one-time-code" maxlength="20"></label><label><input name="remember" type="checkbox" value="yes"> Save my encrypted password and optional TOTP secret for automatic sign-in</label>${approval}<button>Verify SSO and sign in</button></form>`
        : ""
    }${config.platforms.ed ? `<details${sso ? "" : " open"}><summary>Sign in with an Ed API token</summary><form method="post" action="/login">${fields}<input type="hidden" name="platform" value="ed"><label>Ed API token<input name="token" type="password" required autocomplete="off" maxlength="16000"></label>${approval}<button>Verify Ed and sign in</button></form></details>` : ""}`,
    200,
    {
      "set-cookie": `__Host-learning-login=${browser}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  );
}
export async function finishLogin(request: Request, env: Env, config: Config) {
  if (request.method !== "POST")
    throw new SuiteError("METHOD_NOT_ALLOWED", "Use POST.", 405);
  if (request.headers.get("origin") !== config.issuer)
    throw new SuiteError("INVALID_ORIGIN", "Open the sign-in page again.", 403);
  const form = await request.formData();
  const nonce = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(form.get("nonce"));
  const key = `login:${await digest(nonce)}`;
  const pending = await globalCall<Login | null>(env, "/ephemeral/get", {
    key,
  });
  if (
    !pending ||
    pending.browser !== (await digest(cookie(request, "__Host-learning-login")))
  )
    throw new SuiteError(
      "LOGIN_FAILED",
      "Sign-in belongs to another browser or has expired.",
      401,
    );
  if (
    form.get("usage_consent") !== "accept" ||
    form.get("usage_version") !== USAGE_VERSION
  )
    throw new SuiteError(
      "USAGE_REQUIRED",
      "Review and accept the current usage notice.",
      403,
    );
  const p = z.enum(["ed", "moodle", "ontrack"]).parse(form.get("platform"));
  if (!config.platforms[p])
    throw new SuiteError(
      "PLATFORM_UNAVAILABLE",
      "This platform is not configured.",
      503,
    );
  if (!(await globalCall(env, "/ephemeral/get", { key, take: true })))
    throw new SuiteError("LOGIN_FAILED", "Start a new sign-in.", 401);
  await globalCall(env, "/login/rate", {
    key: `loginrate:${await digest(request.headers.get("cf-connecting-ip") ?? "local")}`,
  });
  let profile: Profile;
  if (p === "ed") {
    const token = connectionSchema.shape.token.parse(form.get("token"));
    let user: any;
    try {
      user = (
        await new EdClient({
          token,
          apiBaseUrl: "https://edstem.org/api/",
          fetch: platformFetch("https://edstem.org"),
          maxRetries: 0,
        }).fetchUser()
      ).user;
    } catch {
      throw new SuiteError(
        "LOGIN_FAILED",
        "The Ed token could not be verified.",
        401,
      );
    }
    if (!Number.isSafeInteger(user?.id) || user.id <= 0)
      throw new SuiteError(
        "LOGIN_FAILED",
        "Ed did not return a verified account.",
        401,
      );
    profile = {
      id: await digest(`platform-sso\0ed\0https://edstem.org\0${user.id}`),
      name: "Ed account",
    };
    await stateCall(env, profile.id, "/profile/put", profile);
    await stateCall(
      env,
      profile.id,
      "/connection/put",
      connectionSchema.parse({
        token,
        profile_id: String(user.id),
        display_name: "Ed account",
      }),
    );
  } else {
    const base = z.string().url().max(2048).parse(form.get("base_link"));
    if (
      new URL(base).origin !== new URL(config.platforms[p]!.site_url).origin ||
      new URL(base).username ||
      new URL(base).password ||
      new URL(base).search ||
      new URL(base).hash
    )
      throw new SuiteError(
        "INVALID_BASE_LINK",
        "Use this platform's configured base link.",
        400,
      );
    profile = z
      .object({
        id: z.string().regex(/^[a-f0-9]{64}$/),
        name: z.string().max(200).optional(),
      })
      .strict()
      .parse(
        await brokerCall(env, randomToken(), "/v1/authenticate", {
          platform: p,
          base_link: base,
          input: {
            username: String(form.get("username") ?? ""),
            password: String(form.get("password") ?? ""),
            mfa_code: String(form.get("mfa_code") ?? ""),
            remember: form.get("remember") === "yes",
            ...(form.get("totp_secret")
              ? { totp_secret: String(form.get("totp_secret")) }
              : {}),
          },
        }),
      );
    await stateCall(env, profile.id, "/profile/put", profile);
  }
  await stateCall(env, profile.id, "/usage/accept", { version: USAGE_VERSION });
  const session = randomToken();
  await globalCall(env, "/ephemeral/put", {
    key: `session:${await digest(session)}`,
    value: { profile, csrf: randomToken() },
    expires_at: Date.now() + 7 * 86400_000,
  });
  const headers = new Headers({ location: pending.return_to });
  headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
  );
  headers.append(
    "set-cookie",
    "__Host-learning-login=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
  );
  return new Response(null, { status: 303, headers });
}
export async function browserSession(
  request: Request,
  env: Env,
): Promise<BrowserSession | null> {
  const value = cookie(request, SESSION_COOKIE);
  if (!/^[a-f0-9]{64}$/.test(value)) return null;
  return globalCall(env, "/ephemeral/get", {
    key: `session:${await digest(value)}`,
  });
}
export async function requireBrowser(
  request: Request,
  env: Env,
): Promise<BrowserSession> {
  const v = await browserSession(request, env);
  if (!v)
    throw new SuiteError("LOGIN_REQUIRED", "Sign in to Learning MCP.", 401);
  return v;
}
export function checkCsrf(
  request: Request,
  session: BrowserSession,
  csrf: unknown,
  issuer: string,
) {
  if (request.headers.get("origin") !== issuer || csrf !== session.csrf)
    throw new SuiteError("INVALID_ORIGIN", "Open the account page again.", 403);
}
