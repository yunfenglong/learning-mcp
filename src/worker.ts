import OAuthProvider, {
  AuthorizationError,
  OAuthError,
  type OAuthResourceContext,
} from "@cloudflare/workers-oauth-provider";
import { loadConfig, type Env } from "./config.ts";
import { stateCall } from "./auth/client.ts";
import { READ_SCOPE, MANAGE_SCOPE, type Profile } from "./auth/state.ts";
import { startLogin, finishLogin } from "./auth/login.ts";
import { authorize } from "./http/authorize.ts";
import { landing, accountAction, page } from "./http/landing.ts";
import { admin } from "./http/admin.ts";
import {
  boundedRequest,
  json,
  responseSecurityHeaders,
} from "./http/common.ts";
import { SuiteError, publicError } from "./errors.ts";
import { EdAdapter } from "./adapters/ed.ts";
import { MoodleAdapter } from "./adapters/moodle.ts";
import { OnTrackAdapter } from "./adapters/ontrack.ts";
import { AccountService } from "./accounts/service.ts";
import { handleMcp } from "./mcp/server.ts";
import type { Unit } from "./domain/units.ts";
import { credentialKey } from "./security/output.ts";
export { AccountState } from "./auth/broker.ts";
interface Props {
  account_id: string;
  grant_id: string;
}
export async function protectedMcp(
  request: Request,
  env: Env,
  context: OAuthResourceContext<Props>,
) {
  const config = loadConfig(env);
  if (new URL(request.url).pathname !== "/mcp")
    throw new SuiteError("NOT_FOUND", "Unknown MCP route.", 404);
  const account = context.auth?.userId;
  if (
    !account ||
    !/^[a-f0-9]{64}$/.test(account) ||
    context.auth?.audience !== `${config.issuer}/mcp` ||
    !context.auth.clientId ||
    context.props?.account_id !== account
  )
    throw new SuiteError(
      "ACCESS_DENIED",
      "Invalid Learning authorization.",
      403,
    );
  await stateCall(env, account, "/authorize", {
    grant_id: context.props.grant_id,
    client_id: context.auth.clientId,
    scopes: context.auth.scope,
  });
  config.units = (
    await stateCall<{ units: Unit[] }>(env, account, "/units")
  ).units;
  const profile = await stateCall<Profile>(env, account, "/profile"),
    service = new AccountService(env, profile, config);
  await service.loadSites();
  return handleMcp(
    request,
    config,
    {
      ed: new EdAdapter(service.backends.ed),
      moodle: new MoodleAdapter(
        service.backends.moodle,
        config.platforms.moodle,
      ),
      ontrack: new OnTrackAdapter(service.backends.ontrack),
    },
    service,
    context.auth.scope,
  );
}
export default {
  async fetch(
    original: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    try {
      const config = loadConfig(env),
        url = new URL(original.url);
      if (url.origin !== config.issuer)
        throw new SuiteError(
          "INVALID_HOST",
          "Use the configured Learning MCP origin.",
          403,
        );
      if ([...url.searchParams.keys()].some(credentialKey))
        throw new SuiteError(
          "QUERY_CREDENTIAL",
          "Credentials must not appear in request URLs.",
        );
      const request = await boundedRequest(original);
      const provider = new OAuthProvider<Env>({
        apiRoute: "/mcp",
        apiHandler: {
          fetch: (r, e, c) =>
            protectedMcp(r, e, c as OAuthResourceContext<Props>),
        },
        defaultHandler: {
          fetch: async (r, e) => {
            const p = new URL(r.url).pathname;
            if (p === "/healthz") {
              return json({
                ok: true,
                service: "learning-mcp-suite",
                version: "0.3.0",
              });
            }
            if (p === "/" || p === "/landing") return landing(r, e, config);
            if (p === "/login")
              return r.method === "POST"
                ? finishLogin(r, e, config)
                : startLogin(r, e, config);
            if (p === "/authorize") return authorize(r, e, config);
            if (p.startsWith("/account/")) return accountAction(r, e, config);
            if (p.startsWith("/admin/")) return admin(r, e);
            return json({ code: "NOT_FOUND", message: "Unknown route." }, 404);
          },
        },
        authorizeEndpoint: "/authorize",
        tokenEndpoint: "/oauth/token",
        clientRegistrationEndpoint: "/oauth/register",
        clientIdMetadataDocumentEnabled: true,
        // The provider's default callback logs error descriptions.
        onError: () => {},
        accessTokenTTL: 900,
        refreshTokenTTL: 30 * 86400,
        scopesSupported: [READ_SCOPE, MANAGE_SCOPE, "offline_access"],
        // Advertise the complete setup flow at first connection. Tool guards still
        // permit explicit read-only grants and require bindings for account changes.
        requiredScopes: [READ_SCOPE, MANAGE_SCOPE],
        tokenExchangeCallback: async (options) => {
          try {
            if (
              !options.userId ||
              options.props?.account_id !== options.userId ||
              options.resource !== `${config.issuer}/mcp`
            )
              throw new Error("Invalid grant");
            await stateCall(env, options.userId, "/authorize", {
              grant_id: options.props.grant_id,
              client_id: options.clientId,
              scopes: options.requestedScope,
            });
          } catch {
            throw new OAuthError("invalid_grant", {
              description:
                "The Learning client authorization has expired or was revoked.",
            });
          }
          return {};
        },
        resourceMetadata: {
          resource: `${config.issuer}/mcp`,
          authorization_servers: [config.issuer],
          resource_name: "Learning MCP",
        },
      });
      const response = await provider.fetch(request, env, ctx),
        headers = responseSecurityHeaders(new Headers(response.headers));
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      if (error instanceof AuthorizationError && error.redirectTo)
        return Response.redirect(error.redirectTo, 302);
      if (
        original.headers.get("accept")?.includes("text/html") &&
        !new URL(original.url).pathname.startsWith("/mcp")
      ) {
        const { html, escapeHtml } = await import("./http/common.ts");
        return html(
          page(
            `<span class="eyebrow">Connection needs attention</span><h1>Let's try that again.</h1><p>${escapeHtml(publicError(error).message)}</p>${new URL(original.url).pathname === "/login" ? '<a class="button" href="/login">Return to sign-in</a>' : '<a class="button" href="/landing">Return to your connections</a>'}`,
          ),
          error instanceof SuiteError ? error.status : 500,
        );
      }
      return json(
        publicError(error),
        error instanceof SuiteError ? error.status : 500,
      );
    }
  },
} satisfies ExportedHandler<Env>;
