import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Config, Env } from "../config.ts";
import { READ_SCOPE, MANAGE_SCOPE, type Grant } from "../auth/state.ts";
import { stateCall, globalCall } from "../auth/client.ts";
import { digest, randomToken } from "../auth/crypto.ts";
import { browserSession, checkCsrf } from "../auth/login.ts";
import { USAGE_VERSION, usageLabel, termsApproval } from "../domain/usage.ts";
import { SuiteError } from "../errors.ts";
import { page, noticeDisclosure } from "./ui.ts";
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
      renderAuthorizationPage({
        clientName: client.clientName ?? "MCP client",
        clientId: auth.clientId,
        redirectUri: auth.redirectUri,
        account:
          session.profile.name ??
          session.profile.email ??
          "Learning MCP account",
        manage: auth.scope.includes(MANAGE_SCOPE),
        csrf: session.csrf,
        nonce,
      }),
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
      form.get("terms_consent") !== "accept" ||
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

/** Shared with the local design preview; all client metadata is escaped. */
export function renderAuthorizationPage(input: {
  clientName: string;
  clientId: string;
  redirectUri: string;
  account: string;
  manage: boolean;
  csrf: string;
  nonce: string;
}) {
  return page(
    `<section class="authorization"><span class="eyebrow">Review client access</span><h1>Connect Learning to ${e(input.clientName)}</h1><p class="muted">Signed in as ${e(input.account)}</p><div class="auth-panel"><h2>What this client can access</h2><p>Requested data leaves this service and is received by this client. Review its privacy and AI data-use policies; revoking access cannot recall copies already received. The displayed client name is client-supplied metadata, not an endorsement.</p><p>Read your linked courses, learning materials, deadlines, grades and attendance-code evidence.</p><p>${input.manage ? "Manage your platform connections and course mappings in Learning MCP. These permissions cover setup as well as reading; educational platform operations remain read-only." : "This connection has reading permission only. Connecting platforms or changing course mappings will require an additional permission approval."}</p><p><a href="/landing" target="_blank" rel="noopener">Review your platform connections ↗</a></p><details><summary>Client and return address</summary><dl><dt>Client ID</dt><dd>${e(input.clientId)}</dd><dt>Return address</dt><dd>${e(input.redirectUri)}</dd></dl></details>${noticeDisclosure()}<form method="post"><input type="hidden" name="csrf" value="${e(input.csrf)}"><input type="hidden" name="nonce" value="${e(input.nonce)}"><input type="hidden" name="usage_version" value="${USAGE_VERSION}"><label><input type="checkbox" name="usage_consent" value="accept" required><span>${usageLabel} <a href="#data-notice">Read the notice</a>.</span></label>${termsApproval}<label><input type="checkbox" name="consent" value="allow" required> I approve these permissions for ${e(input.clientName)}.</label><div class="actions"><button name="action" value="allow">Allow access</button><button class="secondary" name="action" value="deny" formnovalidate>Cancel</button></div></form></div></section>`,
    "Review client access",
  );
}
