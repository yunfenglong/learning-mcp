import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "node-html-parser";
const launch = vi.hoisted(() => vi.fn());
vi.mock("@cloudflare/playwright", () => ({ launch }));
import { browserLogin } from "../broker/sso.ts";
import { autoLogin } from "../broker/shared-auth.ts";
import { parseTotp } from "../broker/totp.ts";
import { InteractiveSignIn } from "../broker/interactive-sso.ts";
import { inspectMfa } from "../broker/mfa-page.ts";
import { MFA_TTL_MS } from "../src/auth/mfa.ts";
const site = "https://moodle.example.edu",
  login = "https://tenant.okta.example";
function fixture(
  options: { url?: string; markup?: string; logged?: boolean } = {},
) {
  let url = options.url ?? site,
    logged = options.logged ?? true;
  let markup = options.markup ?? "",
    submit: () => void = () => {
      logged = true;
      markup = "";
    };
  const filled = vi.fn(),
    clicks = vi.fn();
  const cookies = vi.fn(async (_urls?: string | string[]) => [
    {
      name: "MoodleSession_custom",
      value: "cookie-a",
      domain: "moodle.example.edu",
      path: "/lib",
    },
    {
      name: "idx",
      value: "provider-secret",
      domain: "tenant.okta.example",
      path: "/",
    },
    {
      name: "refresh_token",
      value: "refresh-secret",
      domain: "ontrack.example.edu",
      path: "/api/auth",
    },
  ]);
  const root = () => {
    const document = parse(markup);
    for (const el of document.querySelectorAll("*")) {
      Object.assign(el, {
        getBoundingClientRect: () => ({
          width: 100,
          height: el.getAttribute("hidden") !== undefined ? 0 : 30,
        }),
        name: el.getAttribute("name"),
        type: el.getAttribute("type") ?? "text",
        autocomplete: el.getAttribute("autocomplete"),
        inputMode: el.getAttribute("inputmode"),
        parentElement: el.parentNode,
        click: () => {
          clicks(el.textContent);
          submit();
        },
      });
    }
    return document;
  };
  const page = {
    setDefaultTimeout: vi.fn(),
    goto: vi.fn(),
    url: () => url,
    waitForTimeout: vi.fn(async () => {}),
    waitForLoadState: vi.fn(async () => {}),
    evaluate: vi.fn(async (fn: (...args: any[]) => any, arg?: unknown) => {
      if (fn.toString().includes("/api/v1/sessions/me"))
        return logged
          ? {
              status: "ACTIVE",
              userId: "00uVerified",
              expiresAt: new Date(Date.now() + 600000).toISOString(),
              id: "session-secret",
            }
          : null;
      if (fn.toString().includes("M?.cfg")) return logged;
      if (fn.toString().includes("/api/auth/access-token"))
        return logged
          ? {
              auth_token: "access-secret",
              user: { username: "u" },
              auth_token_expiry: new Date(Date.now() + 600000).toISOString(),
            }
          : null;
      vi.stubGlobal("document", root());
      vi.stubGlobal("getComputedStyle", () => ({
        display: "block",
        visibility: "visible",
      }));
      vi.stubGlobal("HTMLFormElement", {
        prototype: {
          submit: () => {
            submit();
          },
        },
      });
      return fn(arg);
    }),
    locator: vi.fn((selector: string) => {
      const find = () => {
        if (selector.startsWith("text=/"))
          return root()
            .querySelectorAll("button,a")
            .filter((el) =>
              /Verify with something else|Choose another option|Select another authenticator/i.test(
                el.textContent,
              ),
            );
        const text = selector.match(/^button:has-text\("([^"]+)"\)$/)?.[1];
        if (text)
          return root()
            .querySelectorAll("button")
            .filter((el) => el.textContent.includes(text));
        return root().querySelectorAll(selector.replace(":visible", ""));
      };
      const make = (index: number) => ({
        first: () => make(0),
        nth: (i: number) => make(i),
        count: async () => find().length,
        isVisible: async () => {
          const el = find()[index];
          return !!el && el.getAttribute("hidden") === undefined;
        },
        fill: async (value: string) => {
          if (!find()[index]) throw new Error("Missing element");
          filled(selector, value);
        },
        click: async () => {
          const el = find()[index];
          if (!el) throw new Error("Missing element");
          clicks(el.textContent);
          submit();
        },
        press: async () => {
          submit();
        },
      });
      return make(0);
    }),
  };
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
    cookies,
    addCookies: vi.fn(),
    route: vi.fn(),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {}),
  };
  launch.mockResolvedValue(browser);
  return {
    page,
    context,
    browser,
    filled,
    clicks,
    setSubmit: (fn: () => void) => {
      submit = fn;
    },
    setMarkup: (value: string) => {
      markup = value;
    },
    verify: () => {
      logged = true;
      markup = "";
    },
    navigate: (value: string) => {
      url = value;
    },
  };
}
const okta = {
  binding: {} as Fetcher,
  platform: "okta" as const,
  site: login,
  loginOrigins: [],
};
const moodle = {
  binding: {} as Fetcher,
  platform: "moodle" as const,
  site,
  loginOrigins: [login],
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
describe("shared-auth browser SSO", () => {
  it("stops rejected generated codes with a specific MFA error before session capture", async () => {
    const f = fixture({
      url: login,
      logged: false,
      markup: '<input name="otp"><input type="submit">',
    });
    f.setSubmit(() => {});
    await expect(
      browserLogin({
        ...okta,
        input: {
          username: "u",
          password: "p",
          totp: parseTotp("JBSWY3DPEHPK3PXP"),
        },
      }),
    ).rejects.toMatchObject({ code: "MFA_TOTP_REJECTED" });
    expect(f.filled).toHaveBeenCalledTimes(1);
    expect(f.browser.close).toHaveBeenCalledOnce();
  });
  it("never fills SSO credentials into a user-selected platform origin", async () => {
    const f = fixture({
      url: site,
      logged: false,
      markup: '<input type="password"><input type="submit">',
    });
    await expect(
      browserLogin({
        ...moodle,
        credentialOrigins: [login],
        input: { username: "u", password: "provider-secret" },
      }),
    ).rejects.toMatchObject({ code: "SSO_CREDENTIAL_DESTINATION" });
    expect(f.filled).not.toHaveBeenCalled();
    expect(f.browser.close).toHaveBeenCalledOnce();
  });
  it("verifies the provider's active subject and never returns its session ID", async () => {
    const f = fixture({ url: login });
    const result = await browserLogin(okta);
    expect(result.session).toMatchObject({ userId: "00uVerified" });
    expect(result.session).not.toHaveProperty("id");
    expect(f.browser.newContext).toHaveBeenCalledOnce();
    expect(f.context.close).toHaveBeenCalledOnce();
    expect(f.browser.close).toHaveBeenCalledOnce();
  });
  it("uses the deployed shared-auth password handling for credentials.passcode", async () => {
    const f = fixture({
      url: login,
      logged: false,
      markup:
        '<input name="credentials.passcode" type="password"><input type="submit">',
    });
    await browserLogin({
      ...okta,
      input: {
        username: "u",
        password: "correct-password",
        totp: parseTotp("JBSWY3DPEHPK3PXP"),
      },
    });
    expect(f.filled).toHaveBeenCalledWith(
      'input[type="password"]',
      "correct-password",
    );
    expect(f.filled).not.toHaveBeenCalledWith(
      'input[name="credentials.passcode"]',
      expect.stringMatching(/^\d{6}$/),
    );
  });
  it("selects an authenticator whose label and Select button are separate siblings", async () => {
    const f = fixture({
      url: login,
      logged: false,
      markup:
        "<div><h3>Google Authenticator</h3><div><button>Select</button></div></div><div><h3>Okta Verify</h3><button>Select</button></div>",
    });
    f.setSubmit(() => {
      f.setMarkup('<input name="otp"><input type="submit">');
      f.setSubmit(f.verify);
    });
    await browserLogin({
      ...okta,
      input: { username: "u", password: "p", mfa_code: "123456" },
    });
    expect(f.clicks).toHaveBeenCalledWith("Select");
    expect(f.filled).toHaveBeenCalledWith('input[name="otp"]', "123456");
  });
  it("opens the alternate authenticator chooser before selecting a code factor", async () => {
    const f = fixture({
      url: login,
      logged: false,
      markup: "<button>Verify with something else</button>",
    });
    f.setSubmit(() => {
      f.setMarkup(
        "<div><h3>Authenticator app</h3><button>Select</button></div>",
      );
      f.setSubmit(() => {
        f.setMarkup('<input name="otp"><input type="submit">');
        f.setSubmit(f.verify);
      });
    });
    await browserLogin({
      ...okta,
      input: { username: "u", password: "p", mfa_code: "123456" },
    });
    expect(f.clicks.mock.calls.map((call) => call[0])).toEqual([
      "Verify with something else",
      "Select",
      "",
    ]);
  });
  it("generates TOTP and does not require or prefer a separate MFA code", async () => {
    vi.spyOn(Date, "now").mockReturnValue(59000);
    const f = fixture({
      url: login,
      logged: false,
      markup: '<input name="otp"><input type="submit">',
    });
    await browserLogin({
      ...okta,
      input: {
        username: "u",
        password: "p",
        mfa_code: "000000",
        totp: parseTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"),
      },
    });
    expect(f.filled).toHaveBeenCalledWith('input[name="otp"]', "287082");
  });
  it("uses the existing username Enter fallback when clicking has not advanced the page", async () => {
    const f = fixture({
      url: login,
      logged: false,
      markup: '<input name="identifier"><button>Next</button>',
    });
    let attempts = 0;
    f.setSubmit(() => {
      if (++attempts > 1) f.verify();
    });
    await browserLogin({ ...okta, input: { username: "u", password: "p" } });
    expect(f.filled).toHaveBeenCalledWith('input[name="identifier"]', "u");
    expect(attempts).toBe(2);
  });
  it("submits SAML without requiring credentials", async () => {
    const f = fixture({
      url: login,
      logged: false,
      markup: '<form><input name="SAMLResponse"></form>',
    });
    f.setSubmit(() => {
      f.verify();
      f.navigate(site);
    });
    await browserLogin(moodle);
    expect(f.filled).not.toHaveBeenCalled();
  });
  it("rejects an expired session that needs fresh credentials", async () => {
    const f = fixture({
      url: login,
      logged: false,
      markup: '<input name="identifier">',
    });
    await expect(browserLogin(okta)).rejects.toMatchObject({
      code: "SSO_LOGIN_REQUIRED",
    });
    expect(f.context.close).toHaveBeenCalledOnce();
  });
  it("reports a missing MFA code without logging or returning provider text", async () => {
    fixture({
      url: login,
      logged: false,
      markup: '<input name="otp"><div role="alert">secret provider text</div>',
    });
    await expect(
      browserLogin({ ...okta, input: { username: "u", password: "p" } }),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });
  it("captures suffixed Moodle cookies at the AJAX path and filters stored cookies", async () => {
    const f = fixture();
    const result = await browserLogin({
      ...moodle,
      cookies: [
        {
          name: "expired",
          value: "old",
          domain: "moodle.example.edu",
          expires: 1,
        },
        { name: "foreign", value: "other", domain: "other.example" },
      ],
    });
    expect(f.page.goto).toHaveBeenCalledWith(`${site}/my/`, expect.anything());
    expect(f.context.addCookies).not.toHaveBeenCalled();
    expect(f.context.cookies).toHaveBeenCalledWith(
      expect.arrayContaining([`${site}/lib/ajax/service.php`]),
    );
    expect(result.session).toMatchObject({
      cookie_name: "MoodleSession_custom",
    });
  });
  it("restores scoped cookies in a new isolated context", async () => {
    const f = fixture();
    await browserLogin({
      ...moodle,
      cookies: [
        { name: "MoodleSession", value: "saved", domain: "moodle.example.edu" },
      ],
    });
    expect(f.context.addCookies).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "MoodleSession",
        value: "saved",
        path: "/",
      }),
    ]);
    const handler = f.context.route.mock.calls[0]![1];
    const route = {
      request: () => ({ url: () => "https://evil.example/" }),
      continue: vi.fn(),
      abort: vi.fn(),
    };
    await handler(route);
    expect(route.abort).toHaveBeenCalledOnce();
    expect(route.continue).not.toHaveBeenCalled();
  });
  it("refuses SSO destinations outside the configured origins", async () => {
    fixture({ url: "https://evil.example/" });
    await expect(browserLogin(moodle)).rejects.toMatchObject({
      code: "SSO_DESTINATION",
    });
  });
  it("discovers OnTrack SSO and requires a usable refresh cookie", async () => {
    const url = "https://ontrack.example.edu";
    const f = fixture({ url });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ redirect_to: `${login}/app/sso` })),
    );
    const result = await browserLogin({
      ...moodle,
      platform: "ontrack",
      site: url,
    });
    expect(f.page.goto).toHaveBeenCalledWith(
      `${login}/app/sso`,
      expect.anything(),
    );
    expect(result.session).toMatchObject({
      token: "access-secret",
      username: "u",
    });
    f.context.cookies.mockResolvedValue([]);
    await expect(
      browserLogin({ ...moodle, platform: "ontrack", site: url }),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });
  it("bounds a stalled browser launch and closes a late browser without using it", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let resolve!: (value: typeof f.browser) => void;
    launch.mockReturnValue(
      new Promise((value) => {
        resolve = value;
      }),
    );
    const pending = expect(browserLogin(okta)).rejects.toMatchObject({
      code: "SSO_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(20001);
    await pending;
    resolve(f.browser);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.browser.close).toHaveBeenCalledOnce();
    expect(f.browser.newContext).not.toHaveBeenCalled();
  });
  it("bounds browser cleanup without losing a verified result", async () => {
    vi.useFakeTimers();
    const f = fixture({ url: login });
    f.context.close.mockReturnValue(new Promise(() => {}));
    f.browser.close.mockReturnValue(new Promise(() => {}));
    const result = browserLogin(okta);
    await vi.advanceTimersByTimeAsync(6001);
    expect((await result).session).toMatchObject({ userId: "00uVerified" });
  });
  it("reuses the deployed step order and waits without real browser delays in tests", async () => {
    const f = fixture({
      url: login,
      logged: false,
      markup:
        '<input name="credentials.passcode" type="password"><input type="submit">',
    });
    await autoLogin(f.page as any, { username: "u", password: "p" });
    expect(f.page.waitForTimeout).toHaveBeenCalledWith(1200);
    expect(f.page.waitForTimeout).toHaveBeenCalledWith(3200);
  });
});

describe("interactive provider MFA", () => {
  const input = { username: "u", password: "password-canary" };
  const otp = '<input name="otp"><input type="submit">';
  it("does not offer or click a provider push challenge", async () => {
    const f = fixture({
      url: login,
      logged: false,
      markup: "<h2>Push notification</h2><button>Send Push</button>",
    });
    const transaction = new InteractiveSignIn();
    await expect(
      transaction.start({} as Fetcher, login, [], input),
    ).rejects.toMatchObject({ code: "SSO_INTERACTION_REQUIRED" });
    expect(f.clicks).not.toHaveBeenCalled();
    expect(f.browser.close).toHaveBeenCalledOnce();
  });
  it("keeps a failed optional setup key out of saved credentials after the password succeeds", async () => {
    const f = fixture({
      url: login,
      logged: false,
      markup: '<input type="password"><input type="submit">',
    });
    let submissions = 0;
    f.setSubmit(() =>
      f.setMarkup(
        "<h2>Google Authenticator</h2>" +
          otp +
          (++submissions > 1
            ? '<div role="alert">private rejection text</div>'
            : ""),
      ),
    );
    const transaction = new InteractiveSignIn();
    const failed = await transaction.start({} as Fetcher, login, [], {
      ...input,
      remember: true,
      remember_totp: true,
      totp_secret: "JBSWY3DPEHPK3PXP",
    });
    expect(failed).toMatchObject({
      status: "mfa_required",
      attempts_remaining: 2,
      methods: ["totp"],
      error: { code: "MFA_TOTP_REJECTED" },
    });
    expect(submissions).toBe(2);
    expect(JSON.stringify(failed)).not.toContain("JBSWY3DPEHPK3PXP");
    expect(f.browser.close).not.toHaveBeenCalled();
    f.setSubmit(() => f.verify());
    const result = await transaction.next({
      method: "totp",
      mfa_code: "012345",
    });
    expect(result).toHaveProperty("result.session.userId", "00uVerified");
    expect(result).not.toHaveProperty("input.totp_secret");
    expect(result).not.toHaveProperty("input.mfa_code");
    expect(f.browser.close).toHaveBeenCalledOnce();
  });
  it("does not use a TOTP secret for a provider-only OTP challenge", async () => {
    const f = fixture({
      url: login,
      logged: false,
      markup: "<h2>Email</h2>" + otp,
    });
    const transaction = new InteractiveSignIn();
    expect(
      await transaction.start({} as Fetcher, login, [], {
        ...input,
        totp_secret: "JBSWY3DPEHPK3PXP",
      }),
    ).toMatchObject({
      methods: ["sso_otp"],
      error: { code: "MFA_METHOD_UNAVAILABLE" },
    });
    expect(f.filled).not.toHaveBeenCalled();
    await transaction.close();
  });
  it("validates secrets before launch and discovers only provider-offered methods", async () => {
    const transaction = new InteractiveSignIn();
    await expect(
      transaction.start({} as Fetcher, login, [], {
        ...input,
        totp_secret: "123456",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TOTP" });
    expect(launch).not.toHaveBeenCalled();
    const f = fixture({
      url: login,
      logged: false,
      markup:
        "<div><span>Google Authenticator</span><button>Select</button></div><div><span>Send a push notification</span><button>Select</button></div>",
    });
    const response = await transaction.start({} as Fetcher, login, [], input);
    expect(response).toMatchObject({
      status: "mfa_required",
      methods: ["totp"],
      attempts_remaining: 3,
    });
    expect(JSON.stringify(response)).not.toContain("password-canary");
    expect(f.filled).not.toHaveBeenCalled();
    await transaction.close();
  });
  it("counts invalid inputs and rejected secrets across method switches, closes at three errors and never replays a code", async () => {
    const f = fixture({
      url: login,
      logged: false,
      markup: "<h2>Authenticator app</h2>" + otp,
    });
    f.setSubmit(() => {});
    const transaction = new InteractiveSignIn();
    await transaction.start({} as Fetcher, login, [], input);
    const first = await transaction.next({
      method: "totp_secret",
      totp_secret: "JBSWY3DPEHPK3PXP",
    });
    expect(first).toMatchObject({
      attempts_remaining: 2,
      error: { code: "MFA_TOTP_REJECTED" },
    });
    expect(f.filled).toHaveBeenCalledTimes(1);
    const second = await transaction.next({
      method: "totp",
      mfa_code: "bad-code-canary",
    });
    expect(second).toMatchObject({
      attempts_remaining: 1,
      error: { code: "INVALID_OTP" },
    });
    expect(f.filled).toHaveBeenCalledTimes(1);
    await expect(
      transaction.next({ method: "totp", mfa_code: "123456" }),
    ).rejects.toMatchObject({ code: "MFA_ATTEMPTS_EXCEEDED" });
    expect(f.filled).toHaveBeenCalledTimes(2);
    expect(f.browser.close).toHaveBeenCalledOnce();
    await expect(
      transaction.next({ method: "sso_otp", mfa_code: "654321" }),
    ).rejects.toMatchObject({ code: "MFA_SESSION_EXPIRED" });
  });
  it("allows requesting a code before entering it and does not consume a verification error", async () => {
    const f = fixture({
      url: login,
      logged: false,
      markup: "<div><span>Email</span><button>Select</button></div>",
    });
    f.setSubmit(() => f.setMarkup(otp));
    const transaction = new InteractiveSignIn();
    await transaction.start({} as Fetcher, login, [], input);
    expect(await transaction.next({ method: "sso_otp" })).toMatchObject({
      attempts_remaining: 3,
      error: { code: "MFA_CODE_REQUIRED" },
    });
    expect(f.clicks).toHaveBeenCalledTimes(1);
    expect(f.filled).not.toHaveBeenCalled();
    f.setSubmit(() => f.verify());
    const result = await transaction.next({
      method: "sso_otp",
      mfa_code: "012345",
    });
    expect(result).toMatchObject({
      result: { session: { status: "ACTIVE", userId: "00uVerified" } },
    });
    expect(result).not.toHaveProperty("input.mfa_code");
    await transaction.close();
  });
  it("supports provider forms with separate code digit inputs", async () => {
    const f = fixture({
      url: login,
      logged: false,
      markup:
        "<h2>Google Authenticator</h2>" +
        '<input maxlength="1">'.repeat(6) +
        '<input type="submit">',
    });
    const transaction = new InteractiveSignIn();
    await transaction.start({} as Fetcher, login, [], input);
    expect(
      await transaction.next({ method: "totp", mfa_code: "012345" }),
    ).toHaveProperty("result.session.userId", "00uVerified");
    expect(f.filled).toHaveBeenCalledTimes(6);
    expect(f.browser.close).toHaveBeenCalledOnce();
  });
  it("expires an abandoned verification transaction and releases its browser", async () => {
    const g = fixture({ url: login, logged: false, markup: otp });
    const expired = new InteractiveSignIn();
    await expired.start({} as Fetcher, login, [], input);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + MFA_TTL_MS + 1);
    await expect(
      expired.next({ method: "sso_otp", mfa_code: "123456" }),
    ).rejects.toMatchObject({ code: "MFA_SESSION_EXPIRED" });
    expect(g.filled).not.toHaveBeenCalled();
    expect(g.browser.close).toHaveBeenCalledOnce();
  });
  it("stores only a successfully verified secret for opted-in retention and never returns a code", async () => {
    const f = fixture({
      url: login,
      logged: false,
      markup: "<h2>Authenticator app</h2>" + otp,
    });
    const transaction = new InteractiveSignIn();
    await transaction.start({} as Fetcher, login, [], {
      ...input,
      remember: true,
      remember_totp: true,
    });
    const seed = "JBSWY3DPEHPK3PXP";
    const result = await transaction.next({
      method: "totp_secret",
      totp_secret: seed,
    });
    expect(result).toMatchObject({
      input: { totp_secret: seed, remember: true, remember_totp: true },
      result: { session: { userId: "00uVerified" } },
    });
    expect(result).not.toHaveProperty("input.mfa_code");
    expect(f.browser.close).toHaveBeenCalledOnce();
    const g = fixture({
      url: login,
      logged: false,
      markup: "<h2>Authenticator app</h2>" + otp,
    });
    const transient = new InteractiveSignIn();
    await transient.start({} as Fetcher, login, [], {
      ...input,
      remember: true,
    });
    expect(
      await transient.next({ method: "totp_secret", totp_secret: seed }),
    ).not.toHaveProperty("input.totp_secret");
    expect(g.browser.close).toHaveBeenCalledOnce();
  });
  it("does not return raw provider text and checks the provider origin before verification", async () => {
    const f = fixture({ url: login, logged: false, markup: otp });
    const transaction = new InteractiveSignIn();
    await transaction.start({} as Fetcher, login, [site], input);
    f.navigate(site);
    await expect(
      transaction.next({ method: "sso_otp", mfa_code: "123456" }),
    ).rejects.toMatchObject({ code: "SSO_CREDENTIAL_DESTINATION" });
    expect(f.filled).not.toHaveBeenCalled();
    expect(f.browser.close).toHaveBeenCalledOnce();
    f.navigate(login);
    f.setMarkup(
      '<h2>Verify with Google Authenticator</h2><input name="otp"><div role="alert">credential-canary</div>',
    );
    expect(JSON.stringify(await inspectMfa(f.page as any))).not.toContain(
      "credential-canary",
    );
  });
});
