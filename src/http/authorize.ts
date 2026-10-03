import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Config, Env } from "../config.ts";
import { READ_SCOPE, MANAGE_SCOPE, type Grant } from "../auth/state.ts";
import { stateCall, globalCall } from "../auth/client.ts";
import { digest, randomToken } from "../auth/crypto.ts";
import { browserSession, checkCsrf } from "../auth/login.ts";
import { USAGE_VERSION, usageNotice, usageLabel } from "../domain/usage.ts";
import { SuiteError } from "../errors.ts";
import { escapeHtml as e, html, oauthFormPolicy } from "./common.ts";
export async function requestFingerprint(request: AuthRequest) {
  return digest(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(request).sort(([a], [b]) => a.localeCompare(b)),
      ),
    ),
  );
}
export async function authorize(
  request: Request,
  env: Env,
  config: Config,
): Promise<Response> {
  const auth = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  if (!auth.codeChallenge || auth.codeChallengeMethod !== "S256")
    throw new SuiteError("PKCE_REQUIRED", "PKCE S256 is required.");
  if (
    auth.scope.some(
      (s) => ![READ_SCOPE, MANAGE_SCOPE, "offline_access"].includes(s),
    ) ||
    !auth.scope.includes(READ_SCOPE)
  )
    throw new SuiteError(
      "INVALID_SCOPE",
      "Request supported Learning permissions.",
    );
  if (auth.resource !== `${config.issuer}/mcp`)
    throw new SuiteError(
      "INVALID_RESOURCE",
      "Request the Learning MCP resource.",
    );
  const client = await env.OAUTH_PROVIDER.lookupClient(auth.clientId);
  if (!client) throw new SuiteError("INVALID_CLIENT", "Unknown client.");
  const callbackHeaders = {
    "content-security-policy": oauthFormPolicy(auth.redirectUri),
  };
  const session = await browserSession(request, env);
  if (!session) {
    if (request.method !== "GET")
      throw new SuiteError("LOGIN_REQUIRED", "Start sign-in again.", 401);
    return new Response(null, {
      status: 302,
      headers: {
        location: `/login?return_to=${encodeURIComponent(new URL(request.url).pathname + new URL(request.url).search)}`,
      },
    });
  }
  const fingerprint = await requestFingerprint(auth);
  if (request.method === "GET") {
    const nonce = randomToken();
    await globalCall(env, "/ephemeral/put", {
      key: `consent:${await digest(nonce)}`,
      value: { fingerprint, account: session.profile.id, csrf: session.csrf },
      expires_at: Date.now() + 600_000,
    });
    return html(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Learning</title><style>body{font:16px system-ui;max-width:650px;margin:8vh auto;padding:24px;color:#172f2c;line-height:1.6}button{padding:12px 20px}dd{overflow-wrap:anywhere;margin:0 0 16px}a{color:#056256}</style><h1>Connect Learning to ${e(client.clientName ?? "MCP client")}</h1><p>Signed in as ${e(session.profile.name ?? session.profile.email ?? "Learning MCP account")}</p><dl><dt>Client</dt><dd>${e(auth.clientId)}</dd><dt>Return address</dt><dd>${e(auth.redirectUri)}</dd></dl><p>Read your linked courses, learning materials, deadlines, grades and attendance-code evidence.</p><p>${auth.scope.includes(MANAGE_SCOPE) ? "Manage your platform connections and course mappings in Learning MCP. These permissions cover setup as well as reading; educational platform operations remain read-only." : "This connection has reading permission only. Connecting platforms or changing course mappings will require an additional permission approval."}</p><p><a href="/landing" target="_blank" rel="noopener">Connect or review Ed, Moodle and OnTrack in this account</a></p>${usageNotice}<form method="post"><input type="hidden" name="csrf" value="${e(session.csrf)}"><input type="hidden" name="nonce" value="${nonce}"><input type="hidden" name="usage_version" value="${USAGE_VERSION}"><label><input type="checkbox" name="usage_consent" value="accept" required> ${usageLabel}</label><br><label><input type="checkbox" name="consent" value="allow" required> I approve these permissions.</label><p><button name="action" value="allow">Connect</button><button name="action" value="deny" formnovalidate>Cancel</button></p></form></html>`,
      200,
      callbackHeaders,
    );
  }
  if (request.method !== "POST")
    throw new SuiteError("METHOD_NOT_ALLOWED", "Use GET or POST.", 405);
  const form = await request.formData();
  checkCsrf(request, session, form.get("csrf"), config.issuer);
  const nonce = String(form.get("nonce") ?? "");
  if (!/^[a-f0-9]{64}$/.test(nonce))
    throw new SuiteError(
      "INVALID_CONSENT",
      "Open the consent page again.",
      403,
    );
  const key = `consent:${await digest(nonce)}`;
  const pending = await globalCall<{
    fingerprint: string;
    account: string;
    csrf: string;
  } | null>(env, "/ephemeral/get", { key });
  if (
    !pending ||
    pending.fingerprint !== fingerprint ||
    pending.account !== session.profile.id ||
    pending.csrf !== session.csrf
  )
    throw new SuiteError(
      "INVALID_CONSENT",
      "This consent belongs to another request or browser.",
      403,
    );
  if (
    form.get("action") !== "deny" &&
    (form.get("action") !== "allow" ||
      form.get("consent") !== "allow" ||
      form.get("usage_consent") !== "accept" ||
      form.get("usage_version") !== USAGE_VERSION)
  )
    throw new SuiteError(
      "CONSENT_REQUIRED",
      "Approve the requested permissions.",
      403,
    );
  if (!(await globalCall(env, "/ephemeral/get", { key, take: true })))
    throw new SuiteError(
      "INVALID_CONSENT",
      "Consent has already been consumed.",
      403,
    );
  if (form.get("action") === "deny") {
    const redirect = new URL(auth.redirectUri);
    redirect.searchParams.set("error", "access_denied");
    redirect.searchParams.set("state", auth.state);
    redirect.searchParams.set("iss", config.issuer);
    return new Response(null, {
      status: 302,
      headers: { ...callbackHeaders, location: redirect.toString() },
    });
  }
  await stateCall(env, session.profile.id, "/usage/accept", {
    version: form.get("usage_version"),
  });
  const grant = await stateCall<Grant>(env, session.profile.id, "/approve", {
    client: {
      id: auth.clientId,
      name: (client.clientName ?? "MCP client").slice(0, 200),
      redirect_uri: auth.redirectUri,
    },
    scopes: auth.scope,
  });
  try {
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: auth,
      userId: session.profile.id,
      metadata: { clientName: grant.client_name },
      scope: auth.scope,
      props: { account_id: session.profile.id, grant_id: grant.id },
    });
    return new Response(null, {
      status: 302,
      headers: { ...callbackHeaders, location: redirectTo },
    });
  } catch {
    await stateCall(env, session.profile.id, "/revoke", { grant_id: grant.id });
    throw new SuiteError(
      "AUTHORIZATION_FAILED",
      "Start a new connection.",
      503,
    );
  }
}
