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
      usage_version: "2026-10-03",
      action: "allow",
      ...extra,
    }),
  });
describe("OAuth consent for ChatGPT", () => {
  it("rejects consent without usage acknowledgement and lets the browser correct it", async () => {
    const f = await fixture(),
      page = await authorize(get(), f.env, f.config);
    const text = await page.text();
    expect(text).toContain("TOTP secret");
    expect(text).toContain("sent to ChatGPT");
    const nonce = text.match(/name="nonce" value="([a-f0-9]+)"/)![1]!;
    await expect(
      authorize(post(nonce, { usage_consent: "" }), f.env, f.config),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    expect((await authorize(post(nonce), f.env, f.config)).status).toBe(302);
    expect(await f.account.usage()).toMatchObject({ version: "2026-10-03" });
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
  it("binds platform sign-in to browser, notice, origin and a single-use nonce", async () => {
    const f = await fixture();
    f.config.platforms.moodle = { site_url: "https://moodle.example.edu" };
    const fetch = vi.fn(async (_request: Request) =>
      Response.json({ id, name: "Verified account" }),
    );
    f.env.SSO_BROKER = { fetch } as any;
    f.env.BROKER_SERVICE_TOKEN = "b".repeat(64);
    const start = await startLogin(
      new Request("https://suite.example/login"),
      f.env,
      f.config,
    );
    const nonce = (await start.text()).match(
      /name="nonce" value="([a-f0-9]+)"/,
    )![1]!;
    const browser = start.headers.get("set-cookie")!.split(";")[0]!;
    const submit = (extra = {}, origin = f.config.issuer, cookie = browser) =>
      finishLogin(
        new Request("https://suite.example/login", {
          method: "POST",
          headers: { origin, cookie },
          body: new URLSearchParams({
            nonce,
            platform: "moodle",
            base_link: "https://moodle.example.edu",
            username: "claimed-user",
            password: "password-canary",
            usage_version: "2026-10-03",
            usage_consent: "accept",
            ...extra,
          }),
        }),
        f.env,
        f.config,
      );
    await expect(submit({}, "https://evil.example")).rejects.toMatchObject({
      code: "INVALID_ORIGIN",
    });
    await expect(submit({}, f.config.issuer, "")).rejects.toMatchObject({
      code: "LOGIN_FAILED",
    });
    await expect(submit({ usage_consent: "" })).rejects.toMatchObject({
      code: "USAGE_REQUIRED",
    });
    expect(fetch).not.toHaveBeenCalled();
    const signed = await submit();
    expect(signed.status).toBe(303);
    expect(signed.headers.get("set-cookie")).toContain(
      "__Host-learning-session=",
    );
    expect(JSON.stringify(await f.account.profile())).not.toContain(
      "claimed-user",
    );
    expect(await f.account.usage()).toMatchObject({ version: "2026-10-03" });
    const forwarded = fetch.mock.calls[0]![0] as Request;
    expect(new URL(forwarded.url).pathname).toBe("/v1/authenticate");
    expect(await forwarded.json()).toMatchObject({
      input: { password: "password-canary", remember: false },
    });
    await expect(submit()).rejects.toMatchObject({ code: "LOGIN_FAILED" });
    expect(fetch).toHaveBeenCalledOnce();
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
