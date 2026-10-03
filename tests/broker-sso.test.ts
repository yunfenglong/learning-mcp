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
    fixture("https://ontrack.example.edu");
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
    ).toEqual({ username: "a", token: "ontrack-a" });
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
