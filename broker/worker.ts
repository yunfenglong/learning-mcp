import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { MoodleClientCore } from "../vendor/moodle/client.js";
import { HttpClient, OnTrackClient } from "../vendor/ontrack/client.js";
import {
  decrypt,
  encrypt,
  equalSecret,
  type EncryptedRecord,
} from "../src/auth/crypto.ts";
import { SuiteError, publicError } from "../src/errors.ts";
import { boundedRequest, json } from "../src/http/common.ts";
import { OutputBoundary } from "../src/security/output.ts";
import { platformFetch } from "../src/platforms/network.ts";
import {
  moodleSessionSchema,
  ontrackSessionSchema,
} from "../src/platforms/broker.ts";
import { browserLogin, type LoginInput } from "./sso.ts";
import { parseTotp } from "./totp.ts";
import {
  cookieFetch,
  cookiesSchema,
  scopedCookies,
  sessionCookies,
  cookieMatches,
  type SessionCookie,
} from "../src/platforms/session-cookies.ts";
import {
  moodleContext,
  refreshOnTrack,
  sessionFailure,
  touchMoodle,
} from "./renewal.ts";
export interface BrokerEnv {
  BROKER_STATE: DurableObjectNamespace;
  BROKER_SERVICE_TOKEN: string;
  BROKER_CREDENTIALS_KEY: string;
  PLATFORM_CONFIG: string;
  LOGIN_ORIGINS: string;
  BROWSER?: Fetcher;
}
const platform = z.enum(["moodle", "ontrack"]),
  accountSchema = z.string().regex(/^[a-f0-9]{64}$/);
const secret = z
  .string()
  .min(1)
  .max(16000)
  .refine((v) => !/[\r\n;]/.test(v));
const inputSchema = z
  .object({
    username: z.string().min(1).max(200),
    password: z.string().min(1).max(1000),
    mfa_code: z.string().max(20).optional(),
    totp_secret: z.string().min(1).max(2048).optional(),
    remember: z.boolean().optional(),
  })
  .strict();
interface SavedLogin {
  cookies: any[];
  username: string;
  input?: LoginInput;
}
export async function validateSession(
  site: string,
  p: "moodle" | "ontrack",
  input: unknown,
  fetchImpl: typeof fetch = globalThis.fetch,
) {
  if (p === "moodle") {
    const candidate = z
      .object({
        cookie_name: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
        cookie_value: secret,
        cookies: cookiesSchema.optional(),
      })
      .strict()
      .parse(input);
    let snapshot: any;
    const jar = cookieFetch(
      site,
      sessionCookies(site, candidate),
      platformFetch(site, fetchImpl, true),
    );
    let dashboard: Response;
    try {
      dashboard = await jar.fetch(`${site}/my/`);
    } catch (error) {
      if (error instanceof SuiteError) throw error;
      throw new SuiteError(
        "UPSTREAM_UNAVAILABLE",
        "Moodle could not verify this session. Retry later.",
        502,
      );
    }
    if (!dashboard.ok) {
      await dashboard.body?.cancel();
      throw new SuiteError(
        dashboard.status === 401 || dashboard.status === 403
          ? "SESSION_INVALID"
          : "UPSTREAM_UNAVAILABLE",
        "Moodle could not verify this session.",
        dashboard.status === 401 || dashboard.status === 403 ? 409 : 502,
      );
    }
    const context = moodleContext(await dashboard.text(), site);
    const c = new MoodleClientCore(site, {
      cookie: { name: candidate.cookie_name, value: candidate.cookie_value },
      pageContext: context,
      fetchImpl: jar.fetch,
      writeSessionCache: async (v: any) => {
        snapshot = v;
      },
    });
    let user: any;
    try {
      user = await c.getSiteInfo();
    } catch (error: any) {
      throw new SuiteError(
        ["servicerequireslogin", "invalidsesskey"].includes(
          error?.moodleErrorCode,
        )
          ? "PLATFORM_SESSION_EXPIRED"
          : "UPSTREAM_UNAVAILABLE",
        "Moodle could not verify this session. Reconnect or retry later.",
        ["servicerequireslogin", "invalidsesskey"].includes(
          error?.moodleErrorCode,
        )
          ? 409
          : 502,
      );
    }
    if (
      !Number.isSafeInteger(user.userid) ||
      user.userid <= 0 ||
      new URL(user.siteurl).origin !== new URL(site).origin ||
      !(snapshot?.sesskey ?? context.sesskey)
    )
      throw new SuiteError(
        "SESSION_INVALID",
        "Moodle did not return an authenticated account.",
        409,
      );
    const primary = jar
      .cookies()
      .find(
        (cookie) =>
          cookie.name === candidate.cookie_name &&
          cookieMatches(cookie, `${site}/lib/ajax/service.php`),
      );
    if (!primary)
      throw new SuiteError(
        "SESSION_INVALID",
        "Moodle removed its session cookie. Reconnect the platform.",
        409,
      );
    return moodleSessionSchema.parse({
      ...candidate,
      cookie_value: primary.value,
      cookies: jar.cookies(),
      sesskey: snapshot?.sesskey ?? context.sesskey,
      userid: user.userid,
      profile_id: String(user.userid),
      display_name: String(user.fullname ?? "").slice(0, 200),
    });
  }
  const candidate = z
    .object({
      username: secret,
      token: secret,
      expires_at: z.string().datetime().optional(),
    })
    .strict()
    .parse(input);
  if (candidate.expires_at && Date.parse(candidate.expires_at) <= Date.now())
    throw new SuiteError(
      "SESSION_INVALID",
      "The OnTrack access token has expired. Reconnect the platform.",
      409,
    );
  const client = new OnTrackClient(
    new HttpClient({
      baseUrl: site,
      credentials: {
        username: candidate.username,
        accessToken: candidate.token,
      },
      fetch: platformFetch(site, fetchImpl),
    }),
  );
  const projects = await client.getProjects(false);
  if (!Array.isArray(projects))
    throw new SuiteError(
      "SESSION_INVALID",
      "OnTrack did not validate this account.",
      409,
    );
  return ontrackSessionSchema.parse({
    ...candidate,
    profile_id: candidate.username,
    display_name: candidate.username,
  });
}
export class BrokerState extends DurableObject<BrokerEnv> {
  private queue: Promise<unknown> = Promise.resolve();
  async fetch(request: Request) {
    const operation = this.queue.then(() => this.route(request));
    this.queue = operation.catch(() => {});
    return operation;
  }
  private async route(request: Request): Promise<Response> {
    const output = new OutputBoundary();
    output.remember(
      this.env.BROKER_CREDENTIALS_KEY,
      this.env.BROKER_SERVICE_TOKEN,
    );
    try {
      const account = accountSchema.parse(
          request.headers.get("x-suite-account"),
        ),
        initialPath = new URL(request.url).pathname;
      let path = initialPath;
      const data = (await request.json()) as any;
      const configs = JSON.parse(this.env.PLATFORM_CONFIG) as Record<
        string,
        { site_url: string }
      >;
      const load = async <T>(key: string) => {
        const record = await this.ctx.storage.get<EncryptedRecord>(key);
        const value = record
          ? await decrypt<T>(
              this.env.BROKER_CREDENTIALS_KEY,
              `${account}:${key}`,
              record,
            )
          : undefined;
        output.rememberSession(value);
        return value;
      };
      const save = async (key: string, value: unknown) =>
        this.ctx.storage.put(
          key,
          await encrypt(
            this.env.BROKER_CREDENTIALS_KEY,
            `${account}:${key}`,
            value,
          ),
        );
      if (path === "/v1/status") {
        await load<SavedLogin>("sso");
        const status: Record<string, unknown> = {
          auth_modes: ["session", ...(this.env.BROWSER ? ["sso"] : [])],
          has_sso: Boolean(await this.ctx.storage.get("sso")),
        };
        for (const p of ["moodle", "ontrack"]) {
          const record = await load<any>(`session:${p}`);
          status[p] = record
            ? {
                status: "connected",
                display_name: record.display_name,
                profile_id: record.profile_id,
              }
            : { status: "not_connected" };
        }
        return json(output.redact(status));
      }
      if (path === "/v1/forget-login") {
        await this.ctx.storage.delete("sso");
        await this.ctx.storage.delete("retry_after");
        await this.ctx.storage.delete("retry_after:moodle");
        await this.ctx.storage.delete("retry_after:ontrack");
        return json({ ok: true });
      }
      const p = platform.parse(data.platform);
      if (path === "/v1/disconnect") {
        await this.ctx.storage.delete(`session:${p}`);
        await this.ctx.storage.delete(`renewed:${p}`);
        await this.ctx.storage.delete(`refresh:${p}`);
        if (
          !(await this.ctx.storage.get(
            `session:${p === "moodle" ? "ontrack" : "moodle"}`,
          ))
        )
          await this.ctx.storage.delete("sso");
        await this.ctx.storage.delete(`retry_after:${p}`);
        return json({ ok: true });
      }
      const configuredSite = configs[p]?.site_url;
      if (!configuredSite || !platformOrigin(configuredSite))
        throw new SuiteError(
          "BROKER_CONFIG",
          "Configure this platform's HTTPS origin.",
          503,
        );
      const site = new URL(configuredSite).origin;
      if (path === "/v1/session") {
        const v = await load<unknown>(`session:${p}`);
        if (!v)
          throw new SuiteError(
            "PLATFORM_NOT_CONNECTED",
            `Connect ${p} on the account page.`,
            409,
          );
        const session = v as { expires_at?: string };
        if (
          p === "ontrack" &&
          session.expires_at &&
          Date.parse(session.expires_at) < Date.now() + 5 * 60000
        )
          path = "/v1/renew";
        else return json(v);
      }
      if (path === "/v1/cookies" && p === "moodle") {
        const current = await load<any>("session:moodle");
        if (!current)
          throw new SuiteError(
            "PLATFORM_NOT_CONNECTED",
            "Connect Moodle on the account page.",
            409,
          );
        // A delayed request must not overwrite another request's newer cookie rotation.
        if (secret.parse(data.expected_cookie_value) !== current.cookie_value)
          return json({ ok: false });
        const cookies = scopedCookies(cookiesSchema.parse(data.cookies), [
          site,
        ]);
        const primary = cookies.find(
          (c) =>
            c.name === current.cookie_name &&
            cookieMatches(c, `${site}/lib/ajax/service.php`),
        );
        if (primary)
          await save("session:moodle", {
            ...current,
            cookie_value: primary.value,
            cookies,
          });
        return json({ ok: Boolean(primary) });
      }
      if (path !== "/v1/connect" && path !== "/v1/renew")
        throw new SuiteError("NOT_FOUND", "Unknown broker route.", 404);
      const previous = await load<any>(`session:${p}`);
      if (path === "/v1/renew") {
        if (!previous)
          throw new SuiteError(
            "PLATFORM_NOT_CONNECTED",
            "Connect the platform on the account page.",
            409,
          );
        if (
          ((await this.ctx.storage.get<number>(`retry_after:${p}`)) ?? 0) >
          Date.now()
        )
          throw new SuiteError(
            "AUTH_RETRY_LATER",
            "Sign-in failed recently. Wait before retrying or reconnect with updated credentials.",
            429,
          );
        const renewed =
          (await this.ctx.storage.get<number>(`renewed:${p}`)) ?? 0;
        if (
          previous &&
          Date.now() - renewed < 10000 &&
          (!previous.expires_at ||
            Date.parse(previous.expires_at) > Date.now() + 30000)
        )
          return json(previous);
      }
      let candidate: unknown,
        login: SavedLogin | undefined,
        verified: any,
        refreshCookies: SessionCookie[] | undefined;
      if (path === "/v1/renew") {
        try {
          if (p === "ontrack") {
            const result = await refreshOnTrack(
              site,
              previous,
              (await load<SessionCookie[]>("refresh:ontrack")) ?? [],
            );
            if (result) {
              candidate = result.session;
              refreshCookies = result.cookies;
            }
          } else {
            const jar = cookieFetch(
              site,
              sessionCookies(site, previous),
              platformFetch(site),
            );
            await touchMoodle(site, previous, jar.fetch);
            if (
              !jar
                .cookies()
                .some(
                  (c) =>
                    c.name === previous.cookie_name &&
                    cookieMatches(c, `${site}/lib/ajax/service.php`),
                )
            )
              throw new SuiteError(
                "PLATFORM_SESSION_EXPIRED",
                "Moodle removed its session cookie. Reconnect the platform.",
                409,
              );
            verified = await validateSession(site, p, {
              cookie_name: previous.cookie_name,
              cookie_value: previous.cookie_value,
              cookies: jar.cookies(),
            });
            candidate = verified;
          }
        } catch (error) {
          if (!sessionFailure(error) || p === "ontrack") {
            await this.ctx.storage.put(`retry_after:${p}`, Date.now() + 60000);
            throw error;
          }
        }
      }
      if (path === "/v1/connect" && data.mode === "session") {
        candidate = data.input;
      } else if (!candidate) {
        if (!this.env.BROWSER)
          throw new SuiteError(
            "SSO_NOT_CONFIGURED",
            "Browser SSO is unavailable. Connect with an existing platform session.",
            503,
          );
        const stored = await load<SavedLogin>("sso"),
          fresh =
            path === "/v1/connect" && data.input != null
              ? inputSchema.parse(data.input)
              : undefined;
        const totp = fresh?.totp_secret
          ? parseTotp(fresh.totp_secret)
          : undefined;
        const credentials: LoginInput | undefined = fresh
          ? {
              username: fresh.username,
              password: fresh.password,
              ...(fresh.mfa_code ? { mfa_code: fresh.mfa_code } : {}),
              ...(totp ? { totp } : {}),
            }
          : stored?.input;
        output.remember(
          credentials?.password,
          credentials?.mfa_code,
          credentials?.totp?.secret,
        );
        if (
          fresh &&
          stored &&
          fresh.username.trim().toLowerCase() !==
            stored.username.trim().toLowerCase()
        )
          throw new SuiteError(
            "SSO_ACCOUNT_CHANGED",
            "Disconnect Moodle and OnTrack before connecting a different SSO account.",
            409,
          );
        if (!fresh && !stored)
          throw new SuiteError(
            "SSO_LOGIN_REQUIRED",
            "Connect with your SSO login first.",
            409,
          );
        const origins = z
          .array(z.string().url())
          .max(30)
          .parse(JSON.parse(this.env.LOGIN_ORIGINS));
        let result: Awaited<ReturnType<typeof browserLogin>>;
        try {
          result = await browserLogin({
            binding: this.env.BROWSER,
            site,
            platform: p,
            loginOrigins: origins,
            cookies: stored?.cookies,
            input: credentials,
          });
        } catch (error) {
          await this.ctx.storage.put(`retry_after:${p}`, Date.now() + 60000);
          throw error;
        }
        candidate = result.session;
        if (p === "ontrack")
          refreshCookies = scopedCookies(result.cookies, [site]);
        login = {
          // Keep platform renewal material in its own record, separate from shared IdP cookies.
          cookies: scopedCookies(
            result.cookies,
            origins.filter(
              (origin) =>
                !Object.values(configs).some(
                  (c) =>
                    c.site_url &&
                    new URL(c.site_url).origin === new URL(origin).origin,
                ),
            ),
          ).filter((cookie) => {
            if (/^MoodleSession/.test(cookie.name)) return false;
            const ontrack = configs.ontrack?.site_url;
            return !(
              ontrack &&
              ["refresh_token", "username"].includes(cookie.name) &&
              cookieMatches({ ...cookie, path: "/" }, ontrack)
            );
          }),
          username: fresh?.username ?? stored!.username,
          ...(fresh?.remember
            ? {
                input: {
                  username: fresh.username,
                  password: fresh.password,
                  ...(totp ? { totp } : {}),
                },
              }
            : !fresh && stored?.input
              ? { input: stored.input }
              : {}),
        };
      }
      try {
        verified ??= await validateSession(site, p, candidate);
      } catch (error) {
        if (error instanceof SuiteError) throw error;
        throw new SuiteError(
          "SESSION_INVALID",
          "The platform session could not be verified. Sign in to the platform and try again.",
          409,
        );
      }
      if (path === "/v1/renew" && previous?.profile_id !== verified.profile_id)
        throw new SuiteError(
          "ACCOUNT_CHANGED",
          "Renewal returned a different account. Reconnect explicitly.",
          409,
        );
      await save(`session:${p}`, verified);
      output.rememberSession(verified);
      if (refreshCookies) await save("refresh:ontrack", refreshCookies);
      else if (path === "/v1/connect" && p === "ontrack")
        await this.ctx.storage.delete("refresh:ontrack");
      await this.ctx.storage.delete(`retry_after:${p}`);
      if (path === "/v1/renew")
        await this.ctx.storage.put(`renewed:${p}`, Date.now());
      else await this.ctx.storage.delete(`renewed:${p}`);
      if (login) await save("sso", login);
      // Credentials leave the broker only through its authenticated internal session/renew contract.
      return json(
        path === "/v1/renew"
          ? verified
          : output.redact({
              ok: true,
              platform: p,
              profile_id: verified.profile_id,
              display_name: verified.display_name,
            }),
      );
    } catch (error) {
      return json(
        output.redact(publicError(error)),
        error instanceof SuiteError ? error.status : 400,
      );
    }
  }
}
export function platformOrigin(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname === "/"
    );
  } catch {
    return false;
  }
}
export default {
  async fetch(original: Request, env: BrokerEnv): Promise<Response> {
    try {
      const token =
        original.headers
          .get("authorization")
          ?.match(/^Bearer ([^\s]+)$/)?.[1] ?? "";
      if (
        !env.BROKER_SERVICE_TOKEN ||
        env.BROKER_SERVICE_TOKEN.length < 32 ||
        !(await equalSecret(token, env.BROKER_SERVICE_TOKEN)) ||
        original.headers.has("origin")
      )
        throw new SuiteError(
          "UNAUTHORIZED",
          "Private broker authentication required.",
          401,
        );
      const account = accountSchema.parse(
        original.headers.get("x-suite-account"),
      );
      if (original.method !== "POST")
        throw new SuiteError("METHOD_NOT_ALLOWED", "Use POST.", 405);
      const request = await boundedRequest(original);
      return env.BROKER_STATE.get(env.BROKER_STATE.idFromName(account)).fetch(
        request,
      );
    } catch (error) {
      return json(
        publicError(error),
        error instanceof SuiteError ? error.status : 400,
      );
    }
  },
} satisfies ExportedHandler<BrokerEnv>;
