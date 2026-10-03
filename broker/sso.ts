import puppeteer from "@cloudflare/puppeteer";
import { SuiteError } from "../src/errors.ts";
import { safeJsonFetch } from "../src/platforms/network.ts";
import { generateTotp, type TotpConfig } from "./totp.ts";
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
  platform: "moodle" | "ontrack";
  loginOrigins: string[];
  cookies?: any[];
  input?: LoginInput;
}
export async function browserLogin(
  options: BrowserLoginOptions,
): Promise<{ session: unknown; cookies: any[] }> {
  const deadline = Date.now() + 40000;
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
  const browser = await puppeteer.launch(options.binding);
  let context:
    Awaited<ReturnType<typeof browser.createBrowserContext>> | undefined;
  try {
    context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.setRequestInterception(true);
    page.on("request", async (req) => {
      try {
        const u = new URL(req.url());
        if (
          allowed.has(u.origin) &&
          u.protocol === "https:" &&
          !u.username &&
          !u.password
        )
          await req.continue();
        else await req.abort();
      } catch {
        await req.abort().catch(() => {});
      }
    });
    const validCookies = scopedCookies(options.cookies ?? [], [...allowed]);
    if (validCookies.length) await page.setCookie(...validCookies);
    let destination = `${site.origin}${options.platform === "moodle" ? "/login/index.php" : "/"}`;
    if (options.platform === "ontrack") {
      const method = (await safeJsonFetch(
        `${site.origin}/api/auth/method`,
      )) as any;
      if (method.redirect_to) {
        const target = new URL(method.redirect_to, site.origin);
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
        destination = target.toString();
      }
    }
    await page.goto(destination, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    const attempted = new Map<string, number>();
    while (Date.now() < deadline) {
      const current = new URL(page.url());
      if (!allowed.has(current.origin))
        throw new SuiteError(
          "SSO_DESTINATION",
          "SSO navigated outside the configured login origins.",
          403,
        );
      if (current.origin === site.origin) {
        if (options.platform === "moodle") {
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
              await page.cookies(
                `${site.origin}/lib/ajax/service.php`,
                ...[...allowed],
              ),
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
              await page.cookies(
                `${site.origin}/api/auth/access-token`,
                ...[...allowed],
              ),
              [...allowed],
            );
            if (
              !cookies.some(
                (cookie) =>
                  cookie.name === "refresh_token" &&
                  cookieMatches(cookie, `${site.origin}/api/auth/access-token`),
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
      const stage = await page.evaluate(() => {
        const document = (globalThis as any).document;
        const visible = (s: string) => {
          const el = document.querySelector(s);
          return el && el.getBoundingClientRect().height > 0 && !el.disabled
            ? s
            : null;
        };
        const saml = document.querySelector('input[name="SAMLResponse"]')?.form;
        if (saml)
          return { kind: "saml", selector: 'input[name="SAMLResponse"]' };
        for (const s of [
          'input[autocomplete="one-time-code"]',
          'input[name="credentials.passcode"]',
          'input[name="credentials.otp"]',
          'input[name="otp"]',
          'input[name="passcode"]',
          'input[name="code"]',
        ])
          if (visible(s)) return { kind: "mfa", selector: s };
        const digits =
          'input[maxlength="1"][inputmode="numeric"],input[aria-label*="digit" i]';
        if (document.querySelectorAll(digits).length >= 6 && visible(digits))
          return { kind: "digits", selector: digits };
        for (const s of ['input[type="password"]'])
          if (visible(s)) return { kind: "password", selector: s };
        for (const s of [
          'input[name="identifier"]',
          'input[name="username"]',
          "#okta-signin-username",
          'input[autocomplete="username"]',
          'input[type="email"]',
        ])
          if (visible(s)) return { kind: "username", selector: s };
        // Select an enrolled code authenticator; push and device challenges remain interactive.
        for (const el of document.querySelectorAll("button,a,[data-se]")) {
          const text = (el.textContent ?? "").trim();
          if (el.getBoundingClientRect().height <= 0) continue;
          const isCode =
            /^(Google Authenticator|Authenticator app|Enter a code)$/i.test(
              text,
            ) ||
            /^(google_otp|okta_verify-totp|authenticator-app)$/.test(
              el.getAttribute("data-se") ?? "",
            );
          const isChooser =
            /^(Verify with something else|Choose another option|Select another authenticator)$/i.test(
              text,
            );
          const action = isCode
            ? (el.querySelector('button,a,input[type="submit"]') ?? el)
            : isChooser
              ? el
              : null;
          if (action) {
            action.setAttribute("data-suite-totp-action", "");
            return { kind: "factor", selector: "[data-suite-totp-action]" };
          }
        }
        return null;
      });
      if (stage) {
        const step = `${current.origin}${current.pathname}:${stage.kind}`;
        const count = attempted.get(step) ?? 0;
        if (count < (stage.kind === "factor" ? 5 : 2)) {
          if (stage.kind === "saml") {
            attempted.set(step, count + 1);
            await page.evaluate(() => {
              const form = (globalThis as any).document.querySelector(
                'input[name="SAMLResponse"]',
              )?.form;
              if (form)
                (globalThis as any).HTMLFormElement.prototype.submit.call(form);
            });
            await page
              .waitForFunction(
                () =>
                  !(globalThis as any).document.querySelector(
                    'input[name="SAMLResponse"]',
                  ),
                { timeout: 1000 },
              )
              .catch(() => {});
            continue;
          }
          if (!options.input)
            throw new SuiteError(
              "SSO_LOGIN_REQUIRED",
              "The saved SSO session has expired. Connect again with your SSO login.",
              409,
            );
          if (
            ["mfa", "digits", "factor"].includes(stage.kind) &&
            !options.input.mfa_code &&
            !options.input.totp
          )
            throw new SuiteError(
              "MFA_REQUIRED",
              "The provider requested a verification code. Supply a current code or a TOTP secret for automated sign-in.",
              409,
            );
          if (stage.kind === "factor") {
            attempted.set(step, count + 1);
            await page.click(stage.selector);
            await page
              .waitForFunction(
                () =>
                  !(globalThis as any).document.querySelector(
                    "[data-suite-totp-action]",
                  ),
                { timeout: 1000 },
              )
              .catch(() => {});
            continue;
          }
          const value = ["mfa", "digits"].includes(stage.kind)
            ? options.input.totp
              ? await generateTotp(options.input.totp)
              : options.input.mfa_code!
            : stage.kind === "password"
              ? options.input.password
              : options.input.username;
          const username = await page.$(
            'input[name="identifier"],input[name="username"],#okta-signin-username,input[autocomplete="username"]',
          );
          if (stage.kind === "password" && username) {
            await username.click({ clickCount: 3 });
            await username.type(options.input.username);
          }
          if (stage.kind === "digits") {
            const boxes = await page.$$(stage.selector);
            if (boxes.length !== value.length)
              throw new SuiteError(
                "SSO_INTERACTION_REQUIRED",
                "The verification form does not match this code. Reconnect with the required challenge.",
                409,
              );
            for (let i = 0; i < boxes.length; i++) {
              await boxes[i]!.click({ clickCount: 3 });
              await boxes[i]!.type(value[i]!);
            }
          } else {
            await page.click(stage.selector, { clickCount: 3 });
            await page.type(stage.selector, value);
          }
          const submit = await page.$(
            'button[type="submit"],input[type="submit"],button[data-type="save"],[data-se="save"]',
          );
          attempted.set(step, count + 1);
          if (submit) await submit.click();
          else await page.keyboard.press("Enter");
        }
      }
      // Wait on a browser state change, bounded to a second, rather than an unbounded idle sleep.
      await page
        .waitForFunction(
          () => (globalThis as any).document.readyState === "complete",
          { timeout: 1000 },
        )
        .catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new SuiteError(
      "SSO_INTERACTION_REQUIRED",
      "Sign-in needs additional interaction. Use an existing platform session or reconnect after completing MFA.",
      409,
    );
  } finally {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
