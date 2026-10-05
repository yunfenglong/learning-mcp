import { noticeDisclosure } from "../http/ui.ts";
import { z } from "zod";
import { EdClient } from "../../vendor/ed/client.js";
import type { Config, Env } from "../config.ts";
import { digest, randomToken } from "./crypto.ts";
import { globalCall, stateCall } from "./client.ts";
import { connectionSchema, type Profile } from "./state.ts";
import { SuiteError } from "../errors.ts";
import {
  providerVerificationFields as verificationFields,
  mfaForms,
  retentionFields,
  retentionChoices,
} from "../http/sign-in-fields.ts";
import { page, signInJourney } from "../http/ui.ts";
import { cookie, html, escapeHtml as e } from "../http/common.ts";
import { brokerCall } from "../platforms/broker.ts";
import { platformFetch } from "../platforms/network.ts";
import { mfaChallengeSchema, MFA_TTL_MS, type MfaChallenge } from "./mfa.ts";
import { USAGE_VERSION, usageLabel, termsApproval } from "../domain/usage.ts";

export const SESSION_COOKIE = "__Host-learning-session";
export interface BrowserSession {
  profile: Profile;
  csrf: string;
}
interface Login {
  browser: string;
  return_to: string;
  broker_account?: string;
  mfa_expires?: number;
  usage_version?: string;
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
  const return_to = safeReturn(
    new URL(request.url).searchParams.get("return_to") ?? "/landing",
    config.issuer,
  );
  if (await browserSession(request, env))
    return new Response(null, {
      status: 303,
      headers: { location: return_to },
    });
  const nonce = randomToken();
  const existingBrowser = cookie(request, "__Host-learning-login");
  // Each form has its own nonce; opening a second form must not invalidate the first.
  const browser = /^[a-f0-9]{64}$/.test(existingBrowser)
    ? existingBrowser
    : randomToken();
  await globalCall(env, "/ephemeral/put", {
    key: `login:${await digest(nonce)}`,
    value: { browser: await digest(browser), return_to },
    expires_at: Date.now() + 600_000,
  });
  const fields = `<input type="hidden" name="nonce" value="${nonce}"><input type="hidden" name="usage_version" value="${USAGE_VERSION}">`;
  const approval = `<label class="check"><input type="checkbox" name="usage_consent" value="accept" required><span>${usageLabel} <a href="#data-notice">Read the notice</a>.</span></label>${termsApproval}`;
  const providerForm = config.ssoProviders?.length
    ? `<h2>Sign in with SSO</h2><p>Use the account you normally use for your learning platforms.</p><p class="help">Sign-in runs in a cloud browser on Cloudflare. This service processes your credentials and saves encrypted sessions. The deployment operator holds decryption keys. <a href="/privacy" target="_blank" rel="noopener">Read the privacy notice before entering credentials</a>.</p><form method="post" action="/login">${fields}<input type="hidden" name="platform" value="sso"><label>SSO provider address<input name="provider" type="url" required placeholder="https://your-sso.example" maxlength="2048"></label><p class="help">Your supported Okta sign-in address, without a page path.</p><label>Username<input name="username" autocomplete="username" required maxlength="200"></label><label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="1000"></label>${verificationFields}${retentionFields}${approval}<button>Continue to verification <span aria-hidden="true">→</span></button></form>`
    : "";
  const edForm = config.platforms.ed
    ? `<details class="alternative"${providerForm ? "" : " open"}><summary>Use an Ed API token instead</summary><p class="help">Sign in with your Ed account. This service verifies and stores your encrypted Ed token for future reads. You can add other platforms afterwards. <a href="/privacy" target="_blank" rel="noopener">Read the privacy notice before entering your token</a>.</p><form method="post" action="/login">${fields}<input type="hidden" name="platform" value="ed"><label>Ed API token<input name="token" type="password" required autocomplete="off" maxlength="16000"></label>${approval}<button>Sign in with Ed <span aria-hidden="true">→</span></button></form></details>`
    : "";
  return html(
    page(
      `<div class="auth-layout"><section class="auth-intro"><span class="eyebrow">Your learning workspace</span><h1>Start with your account.</h1><p>Sign in, complete verification, then connect the platforms your courses use.</p>${signInJourney(1)}<p class="small">Coming back? Use the same SSO account or Ed account each time. Different sign-in accounts have separate connections.</p></section><section class="auth-panel" aria-label="Sign-in options">${noticeDisclosure()}${providerForm}${edForm}</section></div>`,
      "Sign in",
    ),
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
  const nonce = String(form.get("nonce") ?? "");
  if (!/^[a-f0-9]{64}$/.test(nonce))
    throw new SuiteError(
      "INVALID_LOGIN_FORM",
      "The sign-in form is invalid. Open the sign-in page again.",
    );
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
  if (pending.broker_account) {
    if (
      pending.usage_version !== USAGE_VERSION ||
      Date.now() >= (pending.mfa_expires ?? 0)
    )
      throw new SuiteError(
        "MFA_SESSION_EXPIRED",
        "This verification session expired. Start a new sign-in.",
        409,
      );
    if (!(await globalCall(env, "/ephemeral/get", { key, take: true })))
      throw new SuiteError("LOGIN_FAILED", "Start a new sign-in.", 401);
    if (form.get("action") === "cancel") {
      await brokerCall(env, pending.broker_account, "/v1/sign-in/cancel");
      return new Response(null, {
        status: 303,
        headers: {
          location: `/login?return_to=${encodeURIComponent(pending.return_to)}`,
        },
      });
    }
    const result = await brokerCall<any>(
      env,
      pending.broker_account,
      "/v1/sign-in/continue",
      {
        method: String(form.get("mfa_method") ?? ""),
        ...(form.get("mfa_code")
          ? { mfa_code: String(form.get("mfa_code")) }
          : {}),
        ...(form.get("totp_secret")
          ? { totp_secret: String(form.get("totp_secret")) }
          : {}),
      },
    );
    return completeOrChallenge(result, pending, env);
  }
  if (["moodle", "ontrack"].includes(String(form.get("platform"))))
    throw new SuiteError(
      "LOGIN_METHOD_REMOVED",
      "Platform sign-in has been removed. Sign in with your SSO provider or Ed API token.",
      410,
    );
  if (
    form.get("usage_consent") !== "accept" ||
    form.get("terms_consent") !== "accept" ||
    form.get("usage_version") !== USAGE_VERSION
  )
    throw new SuiteError(
      "USAGE_REQUIRED",
      "Review and accept the current usage notice.",
      403,
    );
  const p = z.enum(["sso", "ed"]).parse(form.get("platform"));
  if (
    p === "sso"
      ? !config.ssoProviders?.length
      : p === "ed" && !config.platforms.ed
  )
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
  if (p === "sso") {
    const provider = z.string().url().max(2048).parse(form.get("provider"));
    const u = new URL(provider);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash ||
      !config.ssoProviders?.some((v) => v.origin === u.origin)
    )
      throw new SuiteError(
        "SSO_PROVIDER_UNAVAILABLE",
        "This SSO provider is not supported by this service.",
        400,
      );
    const broker_account = randomToken();
    const mfa_expires = Date.now() + MFA_TTL_MS;
    const result = await brokerCall<any>(
      env,
      broker_account,
      "/v1/authenticate-sso",
      {
        provider: u.origin,
        interactive: true,
        input: {
          username: String(form.get("username") ?? ""),
          password: String(form.get("password") ?? ""),
          ...retentionChoices(form),
          ...(form.get("totp_secret")
            ? { totp_secret: String(form.get("totp_secret")) }
            : {}),
        },
      },
    );
    return completeOrChallenge(
      result,
      { ...pending, broker_account, mfa_expires, usage_version: USAGE_VERSION },
      env,
    );
  } else {
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
        "ED_TOKEN_REJECTED",
        "The Ed token could not be verified. Enter a valid token for your account.",
        401,
      );
    }
    if (!Number.isSafeInteger(user?.id) || user.id <= 0)
      throw new SuiteError(
        "ED_IDENTITY_UNVERIFIED",
        "Ed did not return a verified account. Sign in again with a valid Ed token.",
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
  }
  return establishSession(profile, pending, env);
}
async function completeOrChallenge(result: any, pending: Login, env: Env) {
  if (result.status === "mfa_required") {
    const challenge = mfaChallengeSchema.parse(result);
    const nonce = randomToken();
    await globalCall(env, "/ephemeral/put", {
      key: `login:${await digest(nonce)}`,
      value: pending,
      expires_at: pending.mfa_expires,
    });
    return html(renderMfaPage(nonce, challenge));
  }
  const profile = z
    .object({
      id: z.string().regex(/^[a-f0-9]{64}$/),
      name: z.string().max(200).optional(),
    })
    .strict()
    .parse(result);
  await stateCall(env, profile.id, "/profile/put", profile);
  return establishSession(profile, pending, env);
}
/** Shared by the live flow and the local UI preview. */
export function renderMfaPage(nonce: string, challenge: MfaChallenge) {
  return page(
    `<div class="auth-layout"><section class="auth-intro"><span class="eyebrow">One more step</span><h1>Verify it’s you.</h1><p>Your password was accepted. Complete the verification requested by your SSO provider to finish signing in.</p>${signInJourney(2)}<p class="small">Only methods available on your provider’s current sign-in page appear here. One-time codes are never saved.</p></section><section class="auth-panel"><h2>Choose a verification method</h2><p>Use a current code, or the setup key for your authenticator.</p>${challenge.error ? `<div class="error" role="alert"><p>${e(challenge.error.message)}</p><span class="error-code">Error code: ${e(challenge.error.code)}</span></div>` : ""}<div class="mfa-meta"><span>${challenge.attempts_remaining} ${challenge.attempts_remaining === 1 ? "attempt" : "attempts"} remaining</span><span>5-minute sign-in window</span></div>${mfaForms(nonce, challenge)}<form class="cancel" method="post" action="/login"><input type="hidden" name="nonce" value="${e(nonce)}"><button name="action" value="cancel">Cancel and start again</button></form></section></div>`,
    "Verify your sign-in",
  );
}
async function establishSession(profile: Profile, pending: Login, env: Env) {
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
