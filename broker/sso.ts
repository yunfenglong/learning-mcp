import puppeteer from "@cloudflare/puppeteer";
import { SuiteError } from "../src/errors.ts";
import { safeJsonFetch } from "../src/platforms/network.ts";
import { generateTotp, type TotpConfig } from "./totp.ts";
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
  const browser = await puppeteer.launch(options.binding),
    context = await browser.createBrowserContext();
  try {
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
    const validCookies = (options.cookies ?? []).filter((c) => {
      const domain = String(c.domain ?? "").replace(/^\./, "");
      return [...allowed].some((o) => {
        const host = new URL(o).hostname;
        return host === domain || host.endsWith(`.${domain}`);
      });
    });
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
    const attempted = new Set<string>();
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
              Number(cfg.userId ?? cfg.userid) > 0 &&
              Boolean(cfg.sesskey)
            );
          });
          if (logged) {
            const all = await page.cookies(...[...allowed]);
            const candidate = all.find(
              (c) =>
                c.name === "MoodleSession" &&
                (site.hostname === c.domain.replace(/^\./, "") ||
                  site.hostname.endsWith(`.${c.domain.replace(/^\./, "")}`)),
            );
            if (candidate)
              return {
                session: {
                  cookie_name: candidate.name,
                  cookie_value: candidate.value,
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
          )
            return {
              session: { username: data.user.username, token: data.auth_token },
              cookies: await page.cookies(...[...allowed]),
            };
        }
      }
      const stage = await page.evaluate(() => {
        const visible = (s: string) => {
          const el = (globalThis as any).document.querySelector(s);
          return el && el.getBoundingClientRect().height > 0 && !el.disabled
            ? s
            : null;
        };
        for (const s of [
          'input[autocomplete="one-time-code"]',
          'input[name="credentials.passcode"]',
          'input[name="otp"]',
          'input[name="passcode"]',
        ])
          if (visible(s)) return { kind: "mfa", selector: s };
        for (const s of ['input[type="password"]'])
          if (visible(s)) return { kind: "password", selector: s };
        for (const s of [
          'input[name="identifier"]',
          'input[name="username"]',
          "#okta-signin-username",
          'input[autocomplete="username"]',
        ])
          if (visible(s)) return { kind: "username", selector: s };
        return null;
      });
      if (stage) {
        const step = `${current.origin}${current.pathname}:${stage.kind}`;
        if (!attempted.has(step)) {
          if (!options.input)
            throw new SuiteError(
              "SSO_LOGIN_REQUIRED",
              "The saved SSO session has expired. Connect again with your SSO login.",
              409,
            );
          if (
            stage.kind === "mfa" &&
            !options.input.mfa_code &&
            !options.input.totp
          )
            throw new SuiteError(
              "MFA_REQUIRED",
              "The provider requested a verification code. Supply a current code or a TOTP secret for automated sign-in.",
              409,
            );
          const value =
            stage.kind === "mfa"
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
          await page.click(stage.selector, { clickCount: 3 });
          await page.type(stage.selector, value);
          const submit = await page.$(
            'button[type="submit"],input[type="submit"],button[data-type="save"]',
          );
          if (!submit)
            throw new SuiteError(
              "SSO_INTERACTION_REQUIRED",
              "This sign-in step requires your browser. Use an existing platform session.",
              409,
            );
          attempted.add(step);
          await submit.click();
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
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
