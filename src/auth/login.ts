import { createRemoteJWKSet, jwtVerify, customFetch } from "jose";
import { z } from "zod";
import type { Config, Env } from "../config.ts";
import { digest, randomToken } from "./crypto.ts";
import { globalCall, stateCall } from "./client.ts";
import type { Profile } from "./state.ts";
import { SuiteError } from "../errors.ts";
import { cookie } from "../http/common.ts";
import { safeJsonFetch } from "../platforms/network.ts";
export const SESSION_COOKIE = "__Host-learning-session";
export interface BrowserSession {
  profile: Profile;
  csrf: string;
}
interface Login {
  verifier: string;
  nonce: string;
  browser: string;
  return_to: string;
}
const https = z
  .string()
  .url()
  .refine((v) => {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password && !u.hash;
  });
export function safeReturn(value: string, issuer: string) {
  const u = new URL(value, issuer);
  if (u.origin !== issuer || !["/landing", "/authorize"].includes(u.pathname))
    throw new SuiteError("INVALID_RETURN", "Invalid sign-in return address.");
  return u.pathname + u.search;
}
async function metadata(env: Env) {
  const issuer = https.parse(env.OIDC_ISSUER).replace(/\/$/, "");
  const v = z
    .object({
      issuer: z.string(),
      authorization_endpoint: https,
      token_endpoint: https,
      jwks_uri: https,
    })
    .passthrough()
    .parse(await safeJsonFetch(`${issuer}/.well-known/openid-configuration`));
  if (v.issuer !== env.OIDC_ISSUER)
    throw new SuiteError(
      "OIDC_CONFIG",
      "Identity provider issuer mismatch.",
      503,
    );
  return v;
}
export async function startLogin(request: Request, env: Env, config: Config) {
  const meta = await metadata(env),
    state = randomToken(),
    browser = randomToken(),
    nonce = randomToken(),
    verifier = randomToken();
  const return_to = safeReturn(
    new URL(request.url).searchParams.get("return_to") ?? "/landing",
    config.issuer,
  );
  await globalCall(env, "/ephemeral/put", {
    key: `login:${await digest(state)}`,
    value: { verifier, nonce, browser: await digest(browser), return_to },
    expires_at: Date.now() + 600_000,
  });
  const challenge = btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier),
        ),
      ),
    ),
  )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const target = new URL(meta.authorization_endpoint);
  target.search = new URLSearchParams({
    response_type: "code",
    client_id: env.OIDC_CLIENT_ID,
    redirect_uri: `${config.issuer}/login/callback`,
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      "set-cookie": `__Host-learning-login=${browser}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
export async function finishLogin(request: Request, env: Env, config: Config) {
  const url = new URL(request.url),
    state = url.searchParams.get("state"),
    code = url.searchParams.get("code");
  if (!state || !/^[a-f0-9]{64}$/.test(state) || !code || code.length > 4096)
    throw new SuiteError("LOGIN_FAILED", "Start sign-in again.", 401);
  const key = `login:${await digest(state)}`;
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
  const login = await globalCall<Login | null>(env, "/ephemeral/get", {
    key,
    take: true,
  });
  if (!login)
    throw new SuiteError(
      "LOGIN_FAILED",
      "Sign-in has already been consumed.",
      401,
    );
  const meta = await metadata(env);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: env.OIDC_CLIENT_ID,
    redirect_uri: `${config.issuer}/login/callback`,
    code_verifier: login.verifier,
  });
  if (env.OIDC_CLIENT_SECRET) body.set("client_secret", env.OIDC_CLIENT_SECRET);
  const tokens = z
    .object({ id_token: z.string().max(16000) })
    .passthrough()
    .parse(
      await safeJsonFetch(meta.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
    );
  const jwks = createRemoteJWKSet(new URL(meta.jwks_uri), {
    [customFetch]: async (input, init) =>
      fetch(input, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      }),
  });
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: meta.issuer,
    audience: env.OIDC_CLIENT_ID,
    algorithms: ["RS256", "ES256"],
    maxTokenAge: 600,
    clockTolerance: 5,
  });
  if (
    payload.nonce !== login.nonce ||
    !payload.sub ||
    typeof payload.exp !== "number" ||
    (payload.azp && payload.azp !== env.OIDC_CLIENT_ID) ||
    (Array.isArray(payload.aud) &&
      payload.aud.length > 1 &&
      payload.azp !== env.OIDC_CLIENT_ID)
  )
    throw new SuiteError("LOGIN_FAILED", "Identity verification failed.", 401);
  const domains = (env.OIDC_ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (
    domains.length &&
    (payload.email_verified !== true ||
      typeof payload.email !== "string" ||
      !domains.includes(payload.email.split("@").at(-1)!.toLowerCase()))
  )
    throw new SuiteError(
      "LOGIN_DENIED",
      "Use an allowed, verified account.",
      403,
    );
  const profile: Profile = {
    id: await digest(`${meta.issuer}\0${payload.sub}`),
    ...(typeof payload.name === "string"
      ? { name: payload.name.slice(0, 200) }
      : {}),
    ...(typeof payload.email === "string" && payload.email_verified === true
      ? { email: payload.email.slice(0, 254) }
      : {}),
  };
  await stateCall(env, profile.id, "/profile/put", profile);
  const session = randomToken();
  await globalCall(env, "/ephemeral/put", {
    key: `session:${await digest(session)}`,
    value: { profile, csrf: randomToken() },
    expires_at: Date.now() + 7 * 86400_000,
  });
  const headers = new Headers({ location: login.return_to });
  headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
  );
  headers.append(
    "set-cookie",
    "__Host-learning-login=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
  );
  return new Response(null, { status: 302, headers });
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
