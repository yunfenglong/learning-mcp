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
import { boundedRequest } from "../src/http/common.ts";
import { platformFetch } from "../src/platforms/network.ts";
import {
  moodleSessionSchema,
  ontrackSessionSchema,
} from "../src/platforms/broker.ts";
import { browserLogin, type LoginInput } from "./sso.ts";
import { parseTotp } from "./totp.ts";
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
      })
      .strict()
      .parse(input);
    let snapshot: any;
    const c = new MoodleClientCore(site, {
      cookie: { name: candidate.cookie_name, value: candidate.cookie_value },
      fetchImpl: platformFetch(site, fetchImpl, true),
      writeSessionCache: async (v: any) => {
        snapshot = v;
      },
    });
    const user = await c.getSiteInfo();
    if (
      !Number.isSafeInteger(user.userid) ||
      user.userid <= 0 ||
      new URL(user.siteurl).origin !== new URL(site).origin ||
      !snapshot?.sesskey
    )
      throw new SuiteError(
        "SESSION_INVALID",
        "Moodle did not return a verified Learning account.",
        409,
      );
    return moodleSessionSchema.parse({
      ...candidate,
      sesskey: snapshot.sesskey,
      userid: user.userid,
      profile_id: String(user.userid),
      display_name: String(user.fullname ?? "").slice(0, 200),
    });
  }
  const candidate = z
    .object({ username: secret, token: secret })
    .strict()
    .parse(input);
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
    try {
      const account = accountSchema.parse(
          request.headers.get("x-suite-account"),
        ),
        path = new URL(request.url).pathname;
      const data = (await request.json()) as any;
      const configs = JSON.parse(this.env.PLATFORM_CONFIG) as Record<
        string,
        { site_url: string }
      >;
      const load = async <T>(key: string) => {
        const record = await this.ctx.storage.get<EncryptedRecord>(key);
        return record
          ? decrypt<T>(
              this.env.BROKER_CREDENTIALS_KEY,
              `${account}:${key}`,
              record,
            )
          : undefined;
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
        return Response.json(status);
      }
      if (path === "/v1/forget-login") {
        await this.ctx.storage.delete("sso");
        await this.ctx.storage.delete("retry_after");
        return Response.json({ ok: true });
      }
      const p = platform.parse(data.platform),
        site = configs[p]?.site_url;
      if (!site || !platformOrigin(site))
        throw new SuiteError(
          "BROKER_CONFIG",
          "Configure this platform's configured HTTPS origin.",
          503,
        );
      if (path === "/v1/disconnect") {
        await this.ctx.storage.delete(`session:${p}`);
        await this.ctx.storage.delete(`renewed:${p}`);
        if (
          !(await this.ctx.storage.get(
            `session:${p === "moodle" ? "ontrack" : "moodle"}`,
          ))
        )
          await this.ctx.storage.delete("sso");
        await this.ctx.storage.delete("retry_after");
        return Response.json({ ok: true });
      }
      if (path === "/v1/session") {
        const v = await load<unknown>(`session:${p}`);
        if (!v)
          throw new SuiteError(
            "PLATFORM_NOT_CONNECTED",
            `Connect ${p} on the account page.`,
            409,
          );
        return Response.json(v);
      }
      if (path !== "/v1/connect" && path !== "/v1/renew")
        throw new SuiteError("NOT_FOUND", "Unknown broker route.", 404);
      const previous = await load<any>(`session:${p}`);
      if (path === "/v1/renew") {
        if (
          ((await this.ctx.storage.get<number>("retry_after")) ?? 0) >
          Date.now()
        )
          throw new SuiteError(
            "AUTH_RETRY_LATER",
            "Sign-in failed recently. Wait before retrying or reconnect with updated credentials.",
            429,
          );
        const renewed =
          (await this.ctx.storage.get<number>(`renewed:${p}`)) ?? 0;
        if (previous && Date.now() - renewed < 10000)
          return Response.json(previous);
      }
      let candidate: unknown, login: SavedLogin | undefined;
      if (path === "/v1/connect" && data.mode === "session") {
        candidate = data.input;
      } else {
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
          await this.ctx.storage.put("retry_after", Date.now() + 60000);
          throw error;
        }
        candidate = result.session;
        login = {
          cookies: result.cookies,
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
      let verified: any;
      try {
        verified = await validateSession(site, p, candidate);
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
      await this.ctx.storage.delete("retry_after");
      if (path === "/v1/renew")
        await this.ctx.storage.put(`renewed:${p}`, Date.now());
      else await this.ctx.storage.delete(`renewed:${p}`);
      if (login) await save("sso", login);
      // Credentials leave the broker only through its authenticated internal session/renew contract.
      return Response.json(
        path === "/v1/renew"
          ? verified
          : {
              ok: true,
              platform: p,
              profile_id: verified.profile_id,
              display_name: verified.display_name,
            },
      );
    } catch (error) {
      return Response.json(publicError(error), {
        status: error instanceof SuiteError ? error.status : 400,
      });
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
      return Response.json(publicError(error), {
        status: error instanceof SuiteError ? error.status : 400,
      });
    }
  },
} satisfies ExportedHandler<BrokerEnv>;
