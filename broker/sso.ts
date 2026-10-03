import { z } from "zod";
import {
  launch,
  type Browser,
  type BrowserContext,
} from "@cloudflare/playwright";
import {
  autoLogin,
  discoverOnTrackLogin,
  submitSamlHandoff,
} from "./shared-auth.ts";
import { SuiteError } from "../src/errors.ts";
import { type TotpConfig } from "./totp.ts";
import {
  cookieMatches,
  scopedCookies,
} from "../src/platforms/session-cookies.ts";
export interface LoginInput {
  username: string;
  password: string;
  mfa_code?: string;
  totp?: TotpConfig;
}
export interface BrowserLoginOptions {
  binding: Fetcher;
  site: string;
  platform: "moodle" | "ontrack" | "okta";
  loginOrigins: string[];
  cookies?: any[];
  input?: LoginInput;
  credentialOrigins?: string[];
}
export const oktaIdentitySchema = z
  .object({
    status: z.literal("ACTIVE"),
    userId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/),
    expiresAt: z.string().refine((v) => Date.parse(v) > Date.now()),
  })
  .transform((v) => ({
    status: v.status,
    userId: v.userId,
    expiresAt: v.expiresAt,
  }));

const SIGN_IN_MS = 90000;
async function bounded<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new SuiteError(
                "SSO_TIMEOUT",
                "Sign-in took too long. Open the sign-in page and try again.",
                504,
              ),
            ),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export async function browserLogin(
  options: BrowserLoginOptions,
): Promise<{ session: unknown; cookies: any[] }> {
  const site = new URL(options.site),
    allowed = new Set([site.origin, ...options.loginOrigins]);
  for (const origin of allowed) {
    const u = new URL(origin);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash
    )
      throw new SuiteError(
        "BROKER_CONFIG",
        "Configure HTTPS login origins.",
        503,
      );
  }
  let browser: Browser | undefined, context: BrowserContext | undefined;
  let abandoned = false;
  try {
    // Use the same Browser Run library as the working deployed shared-auth service.
    const pending = launch(options.binding, {
      guardrails: {
        allowedDomains: [...allowed].map((origin) => new URL(origin).hostname),
      },
    });
    pending.then(
      async (value) => {
        if (abandoned) await value.close().catch(() => {});
      },
      () => {},
    );
    browser = await bounded(pending, 20000);
    return await bounded(
      (async () => {
        context = await browser!.newContext({ serviceWorkers: "block" });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        await context.route("**/*", async (route) => {
          try {
            const u = new URL(route.request().url());
            if (
              allowed.has(u.origin) &&
              u.protocol === "https:" &&
              !u.username &&
              !u.password
            )
              await route.continue();
            else await route.abort();
          } catch {
            await route.abort().catch(() => {});
          }
        });
        const cookies = scopedCookies(options.cookies ?? [], [...allowed]);
        if (cookies.length)
          await context.addCookies(
            cookies.map((cookie) => ({ ...cookie, path: cookie.path ?? "/" })),
          );
        let destination = `${site.origin}${options.platform === "moodle" ? "/my/" : options.platform === "okta" ? "/login/login.htm" : "/"}`;
        if (options.platform === "ontrack") {
          destination = await discoverOnTrackLogin(site.origin);
          const target = new URL(destination);
          if (
            !allowed.has(target.origin) ||
            target.protocol !== "https:" ||
            target.username ||
            target.password
          )
            throw new SuiteError(
              "BROKER_CONFIG",
              "Allow the site's verified SSO origin in the broker configuration.",
              503,
            );
        }
        await page.goto(destination, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        const capture = async (): Promise<
          { session: unknown; cookies: any[] } | undefined
        > => {
          const current = new URL(page.url());
          if (!allowed.has(current.origin))
            throw new SuiteError(
              "SSO_DESTINATION",
              "SSO navigated outside the configured login origins.",
              403,
            );
          if (current.origin === site.origin) {
            if (options.platform === "okta") {
              // Verify identity in the provider's own browser origin, with its HttpOnly session cookies.
              const identity = await page.evaluate(async () => {
                try {
                  const response = await (globalThis.fetch as any)(
                    "/api/v1/sessions/me",
                    {
                      credentials: "include",
                      redirect: "error",
                      signal: AbortSignal.timeout(5000),
                    },
                  );
                  if (!response.ok) return null;
                  const text = await response.text();
                  return text.length <= 16384 ? JSON.parse(text) : null;
                } catch {
                  return null;
                }
              });
              const verified = oktaIdentitySchema.safeParse(identity);
              if (verified.success)
                return {
                  session: verified.data,
                  cookies: scopedCookies(await context!.cookies([...allowed]), [
                    ...allowed,
                  ]),
                };
            } else if (options.platform === "moodle") {
              const logged = await page.evaluate(() => {
                const cfg = (globalThis as any).M?.cfg;
                return (
                  cfg &&
                  Number(
                    cfg.userId ??
                      cfg.userid ??
                      (globalThis as any).document
                        .querySelector("[data-user-id]")
                        ?.getAttribute("data-user-id") ??
                      (globalThis as any).document
                        .querySelector("[data-userid]")
                        ?.getAttribute("data-userid"),
                  ) > 0 &&
                  Boolean(cfg.sesskey)
                );
              });
              if (logged) {
                const all = scopedCookies(
                  await context!.cookies([
                    `${site.origin}/lib/ajax/service.php`,
                    ...[...allowed],
                  ]),
                  [...allowed],
                );
                const candidate = all.find(
                  (c) =>
                    /^MoodleSession[A-Za-z0-9_-]*$/.test(c.name) &&
                    cookieMatches(c, `${site.origin}/lib/ajax/service.php`),
                );
                if (candidate)
                  return {
                    session: {
                      cookie_name: candidate.name,
                      cookie_value: candidate.value,
                      cookies: scopedCookies(all, [site.origin]),
                    },
                    cookies: all,
                  };
              }
            } else {
              const data: any = await page.evaluate(async () => {
                try {
                  const r = await (globalThis.fetch as any)(
                    "/api/auth/access-token",
                    {
                      method: "POST",
                      credentials: "include",
                      signal: (globalThis as any).AbortSignal.timeout(5000),
                      headers: { "Content-Type": "application/json" },
                      body: '{"delete_auth_token":false}',
                    },
                  );
                  return r.ok ? await r.json() : null;
                } catch {
                  return null;
                }
              });
              if (
                data?.auth_token &&
                data?.user?.username &&
                typeof data.auth_token_expiry === "string" &&
                Date.parse(data.auth_token_expiry) > Date.now()
              ) {
                const cookies = scopedCookies(
                  await context!.cookies([
                    `${site.origin}/api/auth/access-token`,
                    ...[...allowed],
                  ]),
                  [...allowed],
                );
                if (
                  !cookies.some(
                    (cookie) =>
                      cookie.name === "refresh_token" &&
                      cookieMatches(
                        cookie,
                        `${site.origin}/api/auth/access-token`,
                      ),
                  )
                )
                  throw new SuiteError(
                    "SESSION_INVALID",
                    "OnTrack sign-in did not provide a usable refresh cookie. Reconnect the platform.",
                    409,
                  );
                return {
                  session: {
                    username: data.user.username,
                    token: data.auth_token,
                    expires_at: new Date(data.auth_token_expiry).toISOString(),
                  },
                  cookies,
                };
              }
            }
          }
        };
        const existing = await capture();
        if (existing) return existing;
        await autoLogin(page, options.input, options.credentialOrigins);
        await submitSamlHandoff(page);
        // Retain the deployed shared-auth session capture loop after its login handoff.
        for (let i = 0; i < 18; i++) {
          await page.waitForTimeout(1000);
          await submitSamlHandoff(page);
          const session = await capture();
          if (session) return session;
        }
        throw new SuiteError(
          "SSO_INTERACTION_REQUIRED",
          "Sign-in needs additional interaction. Reconnect after completing the provider's required challenge.",
          409,
        );
      })(),
      SIGN_IN_MS,
    );
  } catch (error) {
    if (error instanceof SuiteError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (
      /browser time limit exceeded for today|time limit exceeded for today/i.test(
        message,
      )
    )
      throw new SuiteError(
        "BROWSER_DAILY_LIMIT",
        "The service's daily cloud browser allowance has been used. Try again after it resets.",
        503,
      );
    if (/429|rate limit/i.test(message))
      throw new SuiteError(
        "BROWSER_BUSY",
        "The cloud browser is busy. Try signing in again shortly.",
        503,
      );
    throw new SuiteError(
      "SSO_UNAVAILABLE",
      "The cloud sign-in could not complete. Open the sign-in page and try again.",
      503,
    );
  } finally {
    abandoned = true;
    await bounded(
      context?.close().catch(() => {}) ?? Promise.resolve(),
      3000,
    ).catch(() => {});
    await bounded(
      browser?.close().catch(() => {}) ?? Promise.resolve(),
      3000,
    ).catch(() => {});
  }
}
