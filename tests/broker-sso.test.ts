import { afterEach, describe, expect, it, vi } from "vitest";
const launch = vi.hoisted(() => vi.fn());
vi.mock("@cloudflare/puppeteer", () => ({ default: { launch } }));
import { browserLogin } from "../broker/sso.ts";
import { parseTotp, generateTotp } from "../broker/totp.ts";
const site = "https://moodle.example.edu",
  login = "https://tenant.okta.example";
function fixture(url = site, stage: unknown = null) {
  const handlers = new Map<string, (request: any) => Promise<void>>();
  const page = {
    setDefaultTimeout: vi.fn(),
    setRequestInterception: vi.fn(),
    on: vi.fn((name, handler) => handlers.set(name, handler)),
    setCookie: vi.fn(),
    goto: vi.fn(),
    url: () => url,
    evaluate: vi.fn(async (fn: () => unknown) =>
      fn.toString().includes("M?.cfg")
        ? stage === null
        : fn.toString().includes("one-time-code")
          ? stage
          : fn(),
    ),
    cookies: vi.fn(async () => [
      {
        name: "MoodleSession",
        value: "cookie-a",
        domain: ".moodle.example.edu",
      },
    ]),
    click: vi.fn(),
    type: vi.fn(),
    $$: vi.fn(async () => [] as any[]),
    keyboard: { press: vi.fn() },
    $: vi.fn(async () => ({ click: vi.fn(), type: vi.fn() })),
    waitForFunction: vi.fn(async () => {}),
  };
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };
  const browser = {
    createBrowserContext: vi.fn(async () => context),
    close: vi.fn(async () => {}),
  };
  launch.mockResolvedValue(browser);
  return { page, context, browser, handlers };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("isolated broker browser SSO", () => {
  it("verifies an Okta session in the provider browser and returns its stable subject", async () => {
    const f = fixture(login);
    f.page.cookies.mockResolvedValue([
      {
        name: "idx",
        value: "provider-secret",
        domain: "tenant.okta.example",
        path: "/",
      },
    ] as any);
    const fetch = vi.fn(async () =>
      Response.json({
        status: "ACTIVE",
        userId: "00uVerified",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        id: "session-secret",
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await browserLogin({
      binding: {} as Fetcher,
      platform: "okta",
      site: login,
      loginOrigins: [],
    });
    expect(f.page.goto).toHaveBeenCalledWith(
      `${login}/login/login.htm`,
      expect.anything(),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/sessions/me",
      expect.objectContaining({ credentials: "include", redirect: "error" }),
    );
    expect(result.session).toMatchObject({ userId: "00uVerified" });
    expect(result.session).not.toHaveProperty("id");
    expect(f.context.close).toHaveBeenCalledOnce();
    expect(f.browser.close).toHaveBeenCalledOnce();
  });
  it("does not accept a provider session without a verified active subject", async () => {
    const f = fixture(login, {
      kind: "username",
      selector: "input[name=username]",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ status: "ACTIVE", login: "claimed-user" }),
      ),
    );
    await expect(
      browserLogin({
        binding: {} as Fetcher,
        platform: "okta",
        site: login,
        loginOrigins: [],
      }),
    ).rejects.toMatchObject({ code: "SSO_LOGIN_REQUIRED" });
    expect(f.context.close).toHaveBeenCalledOnce();
  });
  it("ignores expired cookies and captures a Moodle session suffix at the AJAX path", async () => {
    const f = fixture();
    f.page.cookies.mockResolvedValue([
      {
        name: "MoodleSession_custom",
        value: "valid",
        domain: "moodle.example.edu",
        path: "/lib",
      },
    ] as any);
    const result = await browserLogin({
      binding: {} as Fetcher,
      platform: "moodle",
      site,
      loginOrigins: [],
      cookies: [
        {
          name: "expired",
          value: "old",
          domain: "moodle.example.edu",
          expires: 1,
        },
      ],
    });
    expect(f.page.setCookie).not.toHaveBeenCalled();
    expect(f.page.cookies.mock.calls[0]).toContain(
      `${site}/lib/ajax/service.php`,
    );
    expect(result.session).toMatchObject({
      cookie_name: "MoodleSession_custom",
    });
  });
  it("submits a SAML handoff before requiring credentials", async () => {
    const f = fixture(login, {
      kind: "saml",
      selector: 'input[name="SAMLResponse"]',
    });
    let submitted = false;
    f.page.evaluate.mockImplementation(async (fn) => {
      if (fn.toString().includes("HTMLFormElement")) {
        submitted = true;
        f.page.url = () => site;
        return null;
      }
      if (fn.toString().includes("M?.cfg")) return true;
      if (fn.toString().includes("one-time-code"))
        return { kind: "saml", selector: 'input[name="SAMLResponse"]' };
      return null;
    });
    await browserLogin({
      binding: {} as Fetcher,
      platform: "moodle",
      site,
      loginOrigins: [login],
    });
    expect(submitted).toBe(true);
    expect(f.page.type).not.toHaveBeenCalled();
  });
  it("fills digit-code fields and uses Enter when the submit control is absent", async () => {
    const f = fixture(login, {
      kind: "digits",
      selector: 'input[maxlength="1"]',
    });
    const boxes = Array.from({ length: 6 }, () => ({
      click: vi.fn(),
      type: vi.fn(),
    }));
    f.page.$$.mockResolvedValue(boxes);
    f.page.$.mockResolvedValue(null as any);
    f.page.keyboard.press.mockImplementation(async () => {
      f.page.url = () => site;
      f.page.evaluate.mockImplementation(async (fn) =>
        fn.toString().includes("M?.cfg") ? true : null,
      );
    });
    await browserLogin({
      binding: {} as Fetcher,
      platform: "moodle",
      site,
      loginOrigins: [login],
      input: { username: "u", password: "p", mfa_code: "123456" },
    });
    boxes.forEach((box, i) =>
      expect(box.type).toHaveBeenCalledWith(String(i + 1)),
    );
    expect(f.page.keyboard.press).toHaveBeenCalledWith("Enter");
  });
  it("creates a fresh context, restores only allowlisted cookies and closes it", async () => {
    const f = fixture();
    const result = await browserLogin({
      binding: {} as Fetcher,
      platform: "moodle",
      site,
      loginOrigins: [login],
      cookies: [
        { name: "sid", value: "this-user", domain: "tenant.okta.example" },
        { name: "sid", value: "foreign", domain: "evil.example" },
      ],
    });
    expect(f.browser.createBrowserContext).toHaveBeenCalledTimes(1);
    expect(f.page.setCookie).toHaveBeenCalledWith({
      name: "sid",
      value: "this-user",
      domain: "tenant.okta.example",
      path: "/",
    });
    expect(result.session).toMatchObject({
      cookie_name: "MoodleSession",
      cookie_value: "cookie-a",
    });
    expect(f.context.close).toHaveBeenCalledOnce();
    expect(f.browser.close).toHaveBeenCalledOnce();
    const allowed = {
      url: () => `${login}/login`,
      continue: vi.fn(),
      abort: vi.fn(),
    };
    const foreign = {
      ...allowed,
      url: () => "https://evil.example/",
      continue: vi.fn(),
      abort: vi.fn(),
    };
    await f.handlers.get("request")!(allowed);
    await f.handlers.get("request")!(foreign);
    expect(allowed.continue).toHaveBeenCalledOnce();
    expect(foreign.abort).toHaveBeenCalledOnce();
  });
  it("requires explicit reauthentication or current MFA when cookies no longer work", async () => {
    const f = fixture(login, { kind: "mfa", selector: 'input[name="otp"]' });
    const options = {
      binding: {} as Fetcher,
      platform: "moodle" as const,
      site,
      loginOrigins: [login],
    };
    await expect(browserLogin(options)).rejects.toMatchObject({
      code: "SSO_LOGIN_REQUIRED",
    });
    await expect(
      browserLogin({
        ...options,
        input: { username: "a", password: "secret" },
      }),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(f.page.type).not.toHaveBeenCalled();
    expect(f.context.close).toHaveBeenCalledTimes(2);
  });
  it("generates a current TOTP during the cloud MFA step without a supplied one-time code", async () => {
    const f = fixture(login, { kind: "mfa", selector: 'input[name="otp"]' });
    const totp = parseTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    f.page.$.mockResolvedValue({
      click: vi.fn(() => {
        f.page.url = () => site;
        f.page.evaluate.mockImplementation(async (fn: () => unknown) =>
          fn.toString().includes("M?.cfg") ? true : fn(),
        );
      }),
      type: vi.fn(),
    });
    try {
      const result = await browserLogin({
        binding: {} as Fetcher,
        platform: "moodle",
        site,
        loginOrigins: [login],
        input: { username: "user", password: "password", totp },
      });
      expect(f.page.type).toHaveBeenCalledWith(
        'input[name="otp"]',
        await generateTotp(totp, now),
      );
      expect(result.session).toMatchObject({ cookie_name: "MoodleSession" });
      expect(f.context.close).toHaveBeenCalledOnce();
    } finally {
      vi.restoreAllMocks();
    }
  });
  it("exchanges OnTrack SSO without deleting existing tokens", async () => {
    const f = fixture("https://ontrack.example.edu");
    f.page.cookies.mockResolvedValue([
      {
        name: "refresh_token",
        value: "refresh",
        domain: "ontrack.example.edu",
        path: "/api/auth",
      },
    ] as any);
    const fetch = vi.fn(async (input: any, init: any) => {
      if (String(input).endsWith("/api/auth/method"))
        return Response.json({
          method: "saml",
          redirect_to: "https://ontrack.example.edu/login",
        });
      expect(input).toBe("/api/auth/access-token");
      expect(JSON.parse(init.body)).toEqual({ delete_auth_token: false });
      return Response.json({
        auth_token: "ontrack-a",
        auth_token_expiry: new Date(Date.now() + 60000).toISOString(),
        user: { username: "a" },
      });
    });
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await browserLogin({
          binding: {} as Fetcher,
          platform: "ontrack",
          site: "https://ontrack.example.edu",
          loginOrigins: [],
        })
      ).session,
    ).toMatchObject({
      username: "a",
      token: "ontrack-a",
      expires_at: expect.any(String),
    });
  });
  it("rejects an SSO redirect outside the configured login origins", async () => {
    const f = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ redirect_to: "https://evil.example/signin" }),
      ),
    );
    await expect(
      browserLogin({
        binding: {} as Fetcher,
        platform: "ontrack",
        site: "https://ontrack.example.edu",
        loginOrigins: [],
      }),
    ).rejects.toMatchObject({ code: "BROKER_CONFIG" });
    expect(f.page.goto).not.toHaveBeenCalled();
    expect(f.context.close).toHaveBeenCalledOnce();
  });
});
