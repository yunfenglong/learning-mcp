import { USAGE_VERSION } from "../src/domain/usage.ts";
import { describe, expect, it, vi } from "vitest";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Config, Env } from "../src/config.ts";
import { AccountStore, READ_SCOPE, MANAGE_SCOPE } from "../src/auth/state.ts";
import { authorize, requestFingerprint } from "../src/http/authorize.ts";
import { admin } from "../src/http/admin.ts";
import { boundedRequest } from "../src/http/common.ts";
import { digest } from "../src/auth/crypto.ts";
import {
  safeReturn,
  checkCsrf,
  startLogin,
  finishLogin,
} from "../src/auth/login.ts";
import { MemoryStore, key } from "./support.ts";
const id = "a".repeat(64),
  sessionToken = "s".repeat(64).replace(/s/g, "a"),
  csrf = "csrf-a";
async function fixture() {
  const store = new MemoryStore(),
    global = new AccountStore(store, "identity", key),
    account = new AccountStore(new MemoryStore(), id, key);
  await account.putProfile({ id, name: "Student" });
  await global.ephemeralPut(
    `session:${await digest(sessionToken)}`,
    { profile: { id, name: "Student" }, csrf },
    Date.now() + 600000,
  );
  const auth: AuthRequest = {
    responseType: "code",
    clientId: "client-a",
    redirectUri: "https://chatgpt.com/callback",
    scope: [READ_SCOPE, MANAGE_SCOPE],
    state: "a",
    codeChallenge: "challenge",
    codeChallengeMethod: "S256",
    resource: "https://suite.example/mcp",
    issuer: "https://suite.example",
  };
  const complete = vi.fn(async (_v: any) => ({
    redirectTo: "https://chatgpt.com/callback?code=issued",
  }));
  const env = {
    ADMIN_TOKEN: "x".repeat(64),
    AUTH_STATE: {
      idFromName: (name: string) => name,
      get: (name: string) => ({
        fetch: async (request: Request) => {
          const { body: v } = (await request.json()) as any;
          const state = name === "identity" ? global : account;
          let result: any;
          switch (new URL(request.url).pathname) {
            case "/profile/put":
              result = await state.putProfile(v);
              break;
            case "/login/rate":
              result = { ok: true };
              break;
            case "/ephemeral/put":
              result = await state.ephemeralPut(v.key, v.value, v.expires_at);
              break;
            case "/ephemeral/get":
              result = (await state.ephemeralGet(v.key, v.take)) ?? null;
              break;
            case "/usage/accept":
              result = await state.acceptUsage(v.version);
              break;
            case "/approve":
              result = await state.approve(v.client, v.scopes);
              break;
            case "/revoke":
              result = await state.revoke(v.grant_id);
              break;
            case "/grants":
              result = await state.grants();
              break;
            default:
              throw new Error("Unknown state call");
          }
          return Response.json(result);
        },
      }),
    },
    OAUTH_PROVIDER: {
      parseAuthRequest: async () => auth,
      lookupClient: async () => ({ clientName: "<script>evil</script>" }),
      completeAuthorization: complete,
    },
  } as unknown as Env;
  const config: Config = {
    issuer: "https://suite.example",
    units: [],
    platforms: {},
  };
  return { global, account, auth, complete, env, config };
}
const get = () =>
  new Request("https://suite.example/authorize", {
    headers: { cookie: `__Host-learning-session=${sessionToken}` },
  });
const post = (
  nonce: string,
  extra: Record<string, string> = {},
  origin = "https://suite.example",
) =>
  new Request("https://suite.example/authorize", {
    method: "POST",
    headers: { origin, cookie: `__Host-learning-session=${sessionToken}` },
    body: new URLSearchParams({
      nonce,
      csrf,
      consent: "allow",
      usage_consent: "accept",
      usage_version: USAGE_VERSION,
      action: "allow",
      ...extra,
    }),
  });
describe("OAuth client consent", () => {
  it("explains setup permission while preserving an explicitly read-only consent", async () => {
    const full = await fixture();
    expect(
      await (await authorize(get(), full.env, full.config)).text(),
    ).toContain("These permissions cover setup as well as reading");
    const reader = await fixture();
    reader.auth.scope = [READ_SCOPE];
    const page = await authorize(get(), reader.env, reader.config);
    const text = await page.text();
    expect(text).toContain("reading permission only");
    const nonce = text.match(/name="nonce" value="([a-f0-9]+)"/)![1]!;
    expect(
      (await authorize(post(nonce), reader.env, reader.config)).status,
    ).toBe(302);
    expect(reader.complete.mock.calls[0]![0].scope).toEqual([READ_SCOPE]);
    expect((await reader.account.grants()).grants[0]!.scopes).toEqual([
      READ_SCOPE,
    ]);
  });
  it("permits only the verified client's callback origin on the consent page and redirect", async () => {
    const f = await fixture();
    f.auth.redirectUri = "https://client.example/callback?account=1";
    const page = await authorize(get(), f.env, f.config);
    const policy = page.headers.get("content-security-policy")!;
    expect(policy).toContain("form-action 'self' https://client.example;");
    expect(policy).not.toContain("chatgpt.com");
    expect(policy).not.toContain("account=1");
    const nonce = (await page.text()).match(
      /name="nonce" value="([a-f0-9]+)"/,
    )![1]!;
    const approved = await authorize(post(nonce), f.env, f.config);
    expect(approved.headers.get("content-security-policy")).toBe(policy);
    const second = await authorize(get(), f.env, f.config);
    const deniedNonce = (await second.text()).match(
      /name="nonce" value="([a-f0-9]+)"/,
    )![1]!;
    const denied = await authorize(
      post(deniedNonce, { action: "deny" }),
      f.env,
      f.config,
    );
    expect(denied.headers.get("content-security-policy")).toBe(policy);
  });
  it("uses each OAuth client's supplied name and accepts its own callback", async () => {
    for (const name of ["Claude", "Grok", undefined]) {
      const f = await fixture();
      vi.spyOn(f.env.OAUTH_PROVIDER, "lookupClient").mockResolvedValue({
        clientName: name,
      } as any);
      f.auth.redirectUri = "https://client.example/callback";
      const text = await (await authorize(get(), f.env, f.config)).text();
      expect(text).toContain(`Connect Learning to ${name ?? "MCP client"}`);
      expect(text).not.toContain("ChatGPT");
      const nonce = text.match(/name="nonce" value="([a-f0-9]+)"/)![1]!;
      expect((await authorize(post(nonce), f.env, f.config)).status).toBe(302);
      expect(f.complete.mock.calls[0]![0]).toMatchObject({
        request: { redirectUri: "https://client.example/callback" },
      });
      expect((await f.account.grants()).grants[0]!.client_name).toBe(
        name ?? "MCP client",
      );
    }
  });
  it("rejects consent without usage acknowledgement and lets the browser correct it", async () => {
    const f = await fixture(),
      page = await authorize(get(), f.env, f.config);
    const text = await page.text();
    expect(text).toContain("TOTP secret");
    expect(text).toContain("sent to the MCP client you authorize");
    expect(text).toContain("infrastructure providers used by its operator");
    expect(text).not.toContain("Cloudflare");
    const nonce = text.match(/name="nonce" value="([a-f0-9]+)"/)![1]!;
    await expect(
      authorize(post(nonce, { usage_consent: "" }), f.env, f.config),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    expect((await authorize(post(nonce), f.env, f.config)).status).toBe(302);
    expect(await f.account.usage()).toMatchObject({ version: USAGE_VERSION });
  });
  it("redirects unauthenticated browsers to platform sign-in", async () => {
    const f = await fixture();
    const result = await authorize(
      new Request("https://suite.example/authorize"),
      f.env,
      f.config,
    );
    expect(result.status).toBe(302);
    expect(result.headers.get("location")).toContain("/login?");
  });
  it("escapes client metadata and binds consent to the signed-in user", async () => {
    const f = await fixture(),
      page = await authorize(get(), f.env, f.config),
      text = await page.text();
    expect(text).toContain("&lt;script&gt;");
    expect(text).not.toContain("<script>");
    const nonce = text.match(/name="nonce" value="([a-f0-9]+)"/)![1]!;
    expect((await authorize(post(nonce), f.env, f.config)).status).toBe(302);
    expect(f.complete.mock.calls[0]?.[0]).toMatchObject({
      userId: id,
      props: { account_id: id },
      scope: [READ_SCOPE, MANAGE_SCOPE],
    });
    await expect(authorize(post(nonce), f.env, f.config)).rejects.toThrow();
  });
  it("rejects changed PKCE/state, CSRF and cross-origin requests", async () => {
    const f = await fixture();
    const nonce = (
      await (await authorize(get(), f.env, f.config)).text()
    ).match(/name="nonce" value="([a-f0-9]+)"/)![1]!;
    f.auth.state = "changed";
    await expect(authorize(post(nonce), f.env, f.config)).rejects.toMatchObject(
      { code: "INVALID_CONSENT" },
    );
    await expect(
      authorize(post(nonce, { csrf: "wrong" }), f.env, f.config),
    ).rejects.toMatchObject({ code: "INVALID_ORIGIN" });
    await expect(
      authorize(post(nonce, {}, "https://evil.example"), f.env, f.config),
    ).rejects.toMatchObject({ code: "INVALID_ORIGIN" });
    expect(f.complete).not.toHaveBeenCalled();
  });
  it("requires PKCE, exact resource and supported scopes", async () => {
    const f = await fixture();
    f.auth.codeChallenge = undefined;
    await expect(authorize(get(), f.env, f.config)).rejects.toMatchObject({
      code: "PKCE_REQUIRED",
    });
    f.auth.codeChallenge = "challenge";
    f.auth.resource = "https://other.example/mcp";
    await expect(authorize(get(), f.env, f.config)).rejects.toMatchObject({
      code: "INVALID_RESOURCE",
    });
    f.auth.resource = "https://suite.example/mcp";
    f.auth.scope = ["learning:write"];
    await expect(authorize(get(), f.env, f.config)).rejects.toMatchObject({
      code: "INVALID_SCOPE",
    });
  });
});
describe("browser and administrator boundaries", () => {
  it("reuses an authenticated browser session when opening sign-in and preserves the OAuth return", async () => {
    const f = await fixture();
    const broker = vi.fn();
    f.env.SSO_BROKER = { fetch: broker } as any;
    const target = "/authorize?client_id=client-a&state=state-a";
    const response = await startLogin(
      new Request(
        `https://suite.example/login?return_to=${encodeURIComponent(target)}`,
        {
          headers: { cookie: `__Host-learning-session=${sessionToken}` },
        },
      ),
      f.env,
      f.config,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(target);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(broker).not.toHaveBeenCalled();
  });
  it("does not reuse an expired browser session or allow an external sign-in return", async () => {
    const f = await fixture();
    await f.global.ephemeralPut(
      `session:${await digest(sessionToken)}`,
      { profile: { id }, csrf },
      Date.now() - 1,
    );
    const request = new Request("https://suite.example/login", {
      headers: { cookie: `__Host-learning-session=${sessionToken}` },
    });
    expect((await startLogin(request, f.env, f.config)).status).toBe(200);
    await expect(
      startLogin(
        new Request(
          "https://suite.example/login?return_to=https%3A%2F%2Fother.example%2Fauthorize",
        ),
        f.env,
        f.config,
      ),
    ).rejects.toMatchObject({ code: "INVALID_RETURN" });
  });
  it("keeps a login form valid when another sign-in page opens in the same browser", async () => {
    const f = await fixture();
    f.config.ssoProviders = [
      { type: "okta", origin: "https://tenant.okta.example" },
    ];
    f.env.SSO_BROKER = {
      fetch: vi.fn(async () => Response.json({ id })),
    } as any;
    f.env.BROKER_SERVICE_TOKEN = "b".repeat(64);
    const first = await startLogin(
      new Request("https://suite.example/login"),
      f.env,
      f.config,
    );
    const nonce = (await first.text()).match(
      /name="nonce" value="([a-f0-9]+)"/,
    )![1]!;
    const firstCookie = first.headers.get("set-cookie")!.split(";")[0]!;
    const second = await startLogin(
      new Request("https://suite.example/login", {
        headers: { cookie: firstCookie },
      }),
      f.env,
      f.config,
    );
    const currentCookie = second.headers.get("set-cookie")!.split(";")[0]!;
    const signed = await finishLogin(
      new Request("https://suite.example/login", {
        method: "POST",
        headers: { origin: f.config.issuer, cookie: currentCookie },
        body: new URLSearchParams({
          nonce,
          platform: "sso",
          provider: "https://tenant.okta.example",
          username: "u",
          password: "p",
          usage_consent: "accept",
          usage_version: USAGE_VERSION,
        }),
      }),
      f.env,
      f.config,
    );
    expect(signed.status).toBe(303);
  });
  it("signs in through a supported provider without choosing a learning platform", async () => {
    const f = await fixture();
    f.config.ssoProviders = [
      { type: "okta", origin: "https://tenant.okta.example" },
    ];
    const fetch = vi.fn(async (_request: Request) =>
      Response.json({ id, name: "SSO account" }),
    );
    f.env.SSO_BROKER = { fetch } as any;
    f.env.BROKER_SERVICE_TOKEN = "b".repeat(64);
    const start = await startLogin(
      new Request("https://suite.example/login"),
      f.env,
      f.config,
    );
    const text = await start.text();
    expect(text).toContain('name="provider"');
    expect(text).not.toContain("tenant.okta.example");
    const nonce = text.match(/name="nonce" value="([a-f0-9]+)"/)![1]!;
    const cookie = start.headers.get("set-cookie")!.split(";")[0]!;
    const submit = (extra = {}) =>
      finishLogin(
        new Request("https://suite.example/login", {
          method: "POST",
          headers: { origin: f.config.issuer, cookie },
          body: new URLSearchParams({
            nonce,
            platform: "sso",
            provider: "https://tenant.okta.example",
            username: "user",
            password: "provider-password",
            usage_version: USAGE_VERSION,
            usage_consent: "accept",
            ...extra,
          }),
        }),
        f.env,
        f.config,
      );
    await expect(submit({ usage_consent: "" })).rejects.toMatchObject({
      code: "USAGE_REQUIRED",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect((await submit()).status).toBe(303);
    const forwarded = fetch.mock.calls[0]![0];
    expect(new URL(forwarded.url).pathname).toBe("/v1/authenticate-sso");
    expect(await forwarded.json()).toMatchObject({
      provider: "https://tenant.okta.example",
      input: { remember: false },
    });
    await expect(submit()).rejects.toMatchObject({ code: "LOGIN_FAILED" });
    expect(fetch).toHaveBeenCalledOnce();
    const second = await startLogin(
      new Request("https://suite.example/login"),
      f.env,
      f.config,
    );
    const nextNonce = (await second.text()).match(
      /name="nonce" value="([a-f0-9]+)"/,
    )![1]!;
    await expect(
      finishLogin(
        new Request("https://suite.example/login", {
          method: "POST",
          headers: {
            origin: f.config.issuer,
            cookie: second.headers.get("set-cookie")!.split(";")[0]!,
          },
          body: new URLSearchParams({
            nonce: nextNonce,
            platform: "sso",
            provider: "https://foreign.example",
            username: "user",
            password: "provider-password",
            usage_version: USAGE_VERSION,
            usage_consent: "accept",
          }),
        }),
        f.env,
        f.config,
      ),
    ).rejects.toMatchObject({ code: "SSO_PROVIDER_UNAVAILABLE" });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("removes platform sign-in in the page and rejects crafted legacy submissions", async () => {
    const f = await fixture();
    f.config.ssoProviders = [
      { type: "okta", origin: "https://tenant.okta.example" },
    ];
    f.config.platforms.moodle = { site_url: "https://moodle.example.edu" };
    f.env.SSO_BROKER = { fetch: vi.fn() } as any;
    const start = await startLogin(
      new Request("https://suite.example/login"),
      f.env,
      f.config,
    );
    const text = await start.text();
    expect(text).not.toContain('name="base_link"');
    expect(text).not.toContain("platform-based account");
    const nonce = text.match(/name="nonce" value="([a-f0-9]+)"/)![1]!;
    await expect(
      finishLogin(
        new Request("https://suite.example/login", {
          method: "POST",
          headers: {
            origin: f.config.issuer,
            cookie: start.headers.get("set-cookie")!.split(";")[0]!,
          },
          body: new URLSearchParams({ nonce, platform: "moodle" }),
        }),
        f.env,
        f.config,
      ),
    ).rejects.toMatchObject({ code: "LOGIN_METHOD_REMOVED", status: 410 });
    expect(f.env.SSO_BROKER!.fetch).not.toHaveBeenCalled();
  });
  it("shows only discovered MFA alternatives, rotates browser-bound nonces and preserves the OAuth return", async () => {
    const f = await fixture();
    f.config.ssoProviders = [
      { type: "okta", origin: "https://tenant.okta.example" },
    ];
    const challenge = {
      status: "mfa_required",
      methods: ["sso_otp"],
      attempts_remaining: 3,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(challenge))
      .mockResolvedValueOnce(
        Response.json({
          ...challenge,
          attempts_remaining: 2,
          error: { code: "MFA_CODE_REJECTED", message: "Enter a fresh code." },
        }),
      )
      .mockResolvedValueOnce(Response.json({ id }));
    f.env.SSO_BROKER = { fetch } as any;
    f.env.BROKER_SERVICE_TOKEN = "b".repeat(64);
    const target = "/authorize?client_id=client-a&state=state-a";
    const start = await startLogin(
      new Request(
        `https://suite.example/login?return_to=${encodeURIComponent(target)}`,
      ),
      f.env,
      f.config,
    );
    const nonce = (await start.text()).match(
      /name="nonce" value="([a-f0-9]+)"/,
    )![1]!;
    const browser = start.headers.get("set-cookie")!.split(";")[0]!;
    const submit = (
      nonce: string,
      fields: Record<string, string>,
      cookie = browser,
      origin = f.config.issuer,
    ) =>
      finishLogin(
        new Request("https://suite.example/login", {
          method: "POST",
          headers: { origin, cookie },
          body: new URLSearchParams({ nonce, ...fields }),
        }),
        f.env,
        f.config,
      );
    const first = await submit(nonce, {
      platform: "sso",
      provider: "https://tenant.okta.example",
      username: "u",
      password: "password-canary",
      usage_consent: "accept",
      usage_version: USAGE_VERSION,
    });
    expect(first.headers.get("set-cookie")).toBeNull();
    const page = await first.text();
    expect(page).toContain("SSO OTP");
    expect(page).not.toContain("SSO Push Notification");
    expect(page).not.toContain("TOTP (authenticator code)");
    expect(page).toContain("TOTP secret");
    expect(page).not.toContain("password-canary");
    expect(await f.account.usage()).toBeNull();
    const nextNonce = page.match(/name="nonce" value="([a-f0-9]+)"/)![1]!;
    expect(nextNonce).not.toBe(nonce);
    await expect(submit(nonce, {})).rejects.toMatchObject({
      code: "LOGIN_FAILED",
    });
    await expect(
      submit(nextNonce, { mfa_method: "sso_otp" }, ""),
    ).rejects.toMatchObject({ code: "LOGIN_FAILED" });
    await expect(
      submit(
        nextNonce,
        { mfa_method: "sso_otp" },
        browser,
        "https://evil.example",
      ),
    ).rejects.toMatchObject({ code: "INVALID_ORIGIN" });
    const retry = await submit(nextNonce, {
      mfa_method: "sso_otp",
      mfa_code: "123456",
    });
    const retryPage = await retry.text();
    expect(retryPage).toContain("MFA_CODE_REJECTED");
    expect(retryPage).not.toContain("123456");
    expect(fetch.mock.calls[1]![0].headers.get("x-suite-account")).toBe(
      fetch.mock.calls[0]![0].headers.get("x-suite-account"),
    );
    await expect(
      submit(nextNonce, { mfa_method: "sso_otp", mfa_code: "123456" }),
    ).rejects.toMatchObject({ code: "LOGIN_FAILED" });
    const lastNonce = retryPage.match(/name="nonce" value="([a-f0-9]+)"/)![1]!;
    const signed = await submit(lastNonce, {
      mfa_method: "sso_otp",
      mfa_code: "654321",
    });
    expect(signed.status).toBe(303);
    expect(signed.headers.get("location")).toBe(target);
    expect(signed.headers.get("set-cookie")).toContain(
      "__Host-learning-session",
    );
    expect(await f.account.usage()).toMatchObject({ version: USAGE_VERSION });
  });
  it("rejects arbitrary return URLs and browser CSRF", () => {
    expect(safeReturn("/landing?ticket=abc", "https://suite.example")).toBe(
      "/landing?ticket=abc",
    );
    expect(() =>
      safeReturn("https://evil.example/landing", "https://suite.example"),
    ).toThrow();
    expect(() => safeReturn("/oauth/token", "https://suite.example")).toThrow();
    expect(() =>
      checkCsrf(
        new Request("https://suite.example", {
          headers: { origin: "https://evil.example" },
        }),
        { profile: { id }, csrf },
        csrf,
        "https://suite.example",
      ),
    ).toThrow();
  });
  it("keeps administrator grant actions private", async () => {
    const f = await fixture();
    await expect(
      admin(
        new Request("https://suite.example/admin/revoke", {
          method: "POST",
          body: "{}",
        }),
        f.env,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      admin(
        new Request("https://suite.example/admin/revoke", {
          method: "POST",
          headers: {
            authorization: `Bearer ${f.env.ADMIN_TOKEN}`,
            origin: "https://suite.example",
          },
          body: "{}",
        }),
        f.env,
      ),
    ).rejects.toMatchObject({ code: "INVALID_ORIGIN" });
    await expect(
      boundedRequest(
        new Request("https://suite.example", {
          method: "POST",
          body: "x".repeat(40000),
        }),
      ),
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });
});
