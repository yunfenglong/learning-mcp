import { USAGE_VERSION } from "../src/domain/usage.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@cloudflare/playwright", () => ({ launch: vi.fn() }));
const login = vi.hoisted(() => vi.fn());
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      protected ctx: any,
      protected env: any,
    ) {}
  },
}));
vi.mock("../broker/sso.ts", async (original) => ({
  ...(await original<typeof import("../broker/sso.ts")>()),
  browserLogin: login,
}));
import entrypoint, { BrokerState } from "../broker/worker.ts";
import { decrypt } from "../src/auth/crypto.ts";
import { MemoryStore, key } from "./support.ts";
const account = "a".repeat(64),
  seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
function fixture(browser = true) {
  const storage = new MemoryStore();
  const broker = new BrokerState(
    { storage } as any,
    {
      BROKER_CREDENTIALS_KEY: key,
      BROWSER: browser ? {} : undefined,
      LOGIN_ORIGINS: '["https://tenant.okta.example"]',
      SSO_PROVIDERS: '[{"type":"okta","origin":"https://tenant.okta.example"}]',
    } as any,
  );
  const call = (path: string, body: any = {}, who = account) =>
    broker.fetch(
      new Request(`https://broker${path}`, {
        method: "POST",
        headers: { "x-suite-account": who, "content-type": "application/json" },
        body: JSON.stringify(
          path === "/v1/connect" || path === "/v1/bootstrap"
            ? {
                base_link:
                  body.platform === "moodle"
                    ? "https://moodle.example.edu"
                    : "https://ontrack.example.edu",
                ...body,
              }
            : body,
        ),
      }),
    );
  return { storage, call, env: (broker as any).env };
}
const network = vi.fn(async (input: any, init: any) => {
  const url = new URL(String(input));
  if (url.hostname === "ontrack.example.edu") return Response.json([]);
  const cookie = new Headers(init?.headers).get("cookie") ?? "";
  const userid = cookie.includes("changed") ? 2 : 1;
  if (url.pathname === "/my/")
    return new Response(
      `<script>M.cfg={"sesskey":"sesskey","userid":${userid}}</script><span class="usertext">User</span>`,
    );
  const body = JSON.parse(init?.body ?? "[]");
  if (body[0]?.methodname === "core_session_touch")
    return new Response(null, {
      status: 302,
      headers: { location: "https://moodle.example.edu/login/index.php" },
    });
  return Response.json([
    {
      error: false,
      data: { userid, siteurl: "https://moodle.example.edu", fullname: "User" },
    },
  ]);
});
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.stubGlobal("fetch", network);
  vi.clearAllMocks();
  login.mockResolvedValue({
    session: { cookie_name: "MoodleSession", cookie_value: "valid" },
    cookies: [{ name: "sid", value: "cookie" }],
  });
});
describe("private credential vault", () => {
  it("does not expose retired address migration operations", async () => {
    const f = fixture(false);
    for (const path of [
      "/v1/seed-legacy-sites",
      "/v1/store-legacy-sites",
      "/v1/read-legacy-sites",
    ])
      expect((await f.call(path)).status).toBe(404);
    expect(f.storage.data.size).toBe(0);
  });
  it("does not infer a missing base link from an existing session", async () => {
    const f = fixture(false);
    await f.call("/v1/connect", {
      platform: "moodle",
      mode: "session",
      input: { cookie_name: "MoodleSession", cookie_value: "valid" },
    });
    const original = await f.storage.get("session:moodle");
    await f.storage.delete("site:moodle");
    expect(await (await f.call("/v1/sites")).json()).toEqual({});
    expect((await f.call("/v1/renew", { platform: "moodle" })).status).toBe(
      409,
    );
    expect(await f.storage.get("session:moodle")).toEqual(original);
  });
  it("requires a base link for the first connection and stores it per user without deployment sites", async () => {
    const f = fixture(false);
    const input = { cookie_name: "MoodleSession", cookie_value: "valid" };
    expect(
      (
        await f.call("/v1/connect", {
          platform: "moodle",
          base_link: null,
          mode: "session",
          input,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.call("/v1/connect", {
          platform: "moodle",
          mode: "session",
          input,
        })
      ).status,
    ).toBe(200);
    expect(await (await f.call("/v1/sites")).json()).toEqual({
      moodle: { site_url: "https://moodle.example.edu" },
    });
    expect(JSON.stringify([...f.storage.data])).not.toContain(
      "https://moodle.example.edu",
    );
    expect(
      await (await f.call("/v1/session", { platform: "moodle" })).json(),
    ).toMatchObject({
      site_url: "https://moodle.example.edu",
      cookie_value: "valid",
    });
    expect(
      (
        await f.call("/v1/renew", {
          platform: "moodle",
          expected_base_link: "https://other.example.edu",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.call("/v1/connect", {
          platform: "moodle",
          base_link: "https://other.example.edu",
          mode: "session",
          input,
        })
      ).status,
    ).toBe(409);
    await f.call("/v1/disconnect", { platform: "moodle" });
    expect(await (await f.call("/v1/sites")).json()).toEqual({});
  });
  it("rejects the removed platform login broker route before browser or storage access", async () => {
    const f = fixture();
    const env = { ...f.env, BROKER_SERVICE_TOKEN: "b".repeat(64) };
    const response = await entrypoint.fetch(
      new Request("https://broker/v1/authenticate", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.BROKER_SERVICE_TOKEN}`,
          "x-suite-account": account,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          platform: "moodle",
          input: { username: "u", password: "secret" },
        }),
      }),
      env as any,
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      code: "LOGIN_METHOD_REMOVED",
    });
    expect(login).not.toHaveBeenCalled();
    expect(f.storage.data.size).toBe(0);
  });
  it("anchors provider accounts to verified subjects and saves only scoped, opted-in secrets", async () => {
    const stores = new Map<string, ReturnType<typeof fixture>>();
    const env = {
      ...fixture().env,
      BROKER_SERVICE_TOKEN: "b".repeat(64),
      BROKER_STATE: {
        idFromName: (id: string) => id,
        get: (id: string) => ({
          fetch: (request: Request) => {
            let f = stores.get(id);
            if (!f) {
              f = fixture();
              stores.set(id, f);
            }
            return new BrokerState(
              { storage: f.storage } as any,
              env as any,
            ).fetch(request);
          },
        }),
      },
    };
    const identity = {
      status: "ACTIVE",
      userId: "00uVerified",
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    };
    login.mockResolvedValue({
      session: identity,
      cookies: [
        {
          name: "idx",
          value: "provider-cookie-secret",
          domain: "tenant.okta.example",
          path: "/",
        },
        {
          name: "other",
          value: "foreign-secret",
          domain: "foreign.example",
          path: "/",
        },
      ],
    });
    const authenticate = (
      provider = "https://tenant.okta.example",
      extra = {},
    ) =>
      entrypoint.fetch(
        new Request("https://broker/v1/authenticate-sso", {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.BROKER_SERVICE_TOKEN}`,
            "x-suite-account": "c".repeat(64),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            provider,
            input: {
              username: "claimed-user",
              password: "password-secret",
              totp_secret: seed,
              mfa_code: "123456",
              remember: true,
              remember_totp: true,
              ...extra,
            },
          }),
        }),
        env as any,
      );
    const first = await authenticate();
    expect(first.status).toBe(200);
    const profile = (await first.json()) as any;
    expect(profile.id).toMatch(/^[a-f0-9]{64}$/);
    const stored = await stores.get(profile.id)!.storage.get<any>("sso");
    expect(stored).toHaveProperty("ciphertext");
    const saved = await decrypt<any>(key, `${profile.id}:sso`, stored);
    expect(saved.subject).toBe(identity.userId);
    expect(saved.cookies).toHaveLength(1);
    expect(saved.input.password).toBe("password-secret");
    expect(JSON.stringify(saved)).not.toContain("123456");
    expect(JSON.stringify(profile)).not.toContain(identity.userId);
    expect(
      (
        (await (
          await authenticate("https://tenant.okta.example", {
            username: "alias",
            remember: false,
            remember_totp: false,
          })
        ).json()) as any
      ).id,
    ).toBe(profile.id);
    expect(
      await decrypt<any>(
        key,
        `${profile.id}:sso`,
        await stores.get(profile.id)!.storage.get<any>("sso"),
      ),
    ).not.toHaveProperty("input");
    const calls = login.mock.calls.length;
    expect((await authenticate("https://foreign.example")).status).toBe(400);
    expect(login.mock.calls).toHaveLength(calls);
    login.mockResolvedValueOnce({
      session: { ...identity, userId: "00uOther" },
      cookies: [],
    });
    expect(((await (await authenticate()).json()) as any).id).not.toBe(
      profile.id,
    );
    const count = stores.size;
    const owner = stores.get(profile.id)!;
    const mismatched = await owner.call(
      "/v1/bootstrap-sso",
      {
        provider: "https://tenant.okta.example",
        input: {
          username: "user",
          password: "password-secret",
          remember: true,
          remember_totp: true,
        },
        result: {
          session: { ...identity, userId: "00uDifferent" },
          cookies: [],
        },
      },
      profile.id,
    );
    expect(mismatched.status).toBe(409);
    expect(
      await decrypt<any>(
        key,
        `${profile.id}:sso`,
        await owner.storage.get<any>("sso"),
      ),
    ).toMatchObject({ subject: identity.userId });
    login.mockResolvedValueOnce({
      session: { ...identity, status: "MFA_REQUIRED" },
      cookies: [],
    });
    expect((await authenticate()).status).not.toBe(200);
    expect(stores.size).toBe(count);
  });
  it("rejects browser-origin requests before accessing account storage", async () => {
    const get = vi.fn();
    const secret = "b".repeat(64);
    const response = await entrypoint.fetch(
      new Request("https://broker/v1/session", {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          origin: "https://suite.example",
          "x-suite-account": account,
        },
        body: '{"platform":"moodle"}',
      }),
      { BROKER_SERVICE_TOKEN: secret, BROKER_STATE: { get } } as any,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain(secret);
    expect(get).not.toHaveBeenCalled();
  });
  const credentials = {
    username: "user",
    password: "password-secret",
    totp_secret: seed,
    mfa_code: "123456",
  };
  it("redacts credentials echoed in profile metadata while keeping internal sessions private and noncacheable", async () => {
    const f = fixture(),
      fallback = network.getMockImplementation()!;
    network.mockImplementation(async (input, init) => {
      if (String(input).includes("core_webservice_get_site_info"))
        return Response.json([
          {
            error: false,
            data: {
              userid: 1,
              siteurl: "https://moodle.example.edu",
              fullname: `${credentials.password} ${seed} valid`,
            },
          },
        ]);
      return fallback(input, init);
    });
    try {
      const connected = await f.call("/v1/connect", {
        platform: "moodle",
        mode: "sso",
        input: { ...credentials, remember: true, remember_totp: true },
      });
      expect(connected.status).toBe(200);
      const metadata = await connected.text();
      expect(metadata).not.toContain(credentials.password);
      expect(metadata).not.toContain(seed);
      expect(metadata).not.toContain("valid");
      const status = await f.call("/v1/status");
      const publicMetadata = await status.text();
      expect(publicMetadata).not.toContain(credentials.password);
      expect(publicMetadata).not.toContain(seed);
      const session = await f.call("/v1/session", { platform: "moodle" });
      expect(session.headers.get("cache-control")).toBe("no-store");
      expect(await session.json()).toMatchObject({ cookie_value: "valid" });
    } finally {
      network.mockImplementation(fallback);
    }
  });
  it("validates a lowercase Moodle userid without relying on the site-info service", async () => {
    const f = fixture(false),
      fallback = network.getMockImplementation()!;
    network.mockImplementation(async (input, init) =>
      String(input).includes("/my/")
        ? new Response('<script>M.cfg={"sesskey":"key","userid":12};</script>')
        : Response.json([
            {
              error: true,
              exception: {
                errorcode: "servicenotavailable",
                message: "Disabled service",
              },
            },
          ]),
    );
    try {
      expect(
        await (
          await f.call("/v1/connect", {
            platform: "moodle",
            mode: "session",
            input: { cookie_name: "MoodleSession", cookie_value: "valid" },
          })
        ).json(),
      ).toMatchObject({ ok: true, profile_id: "12" });
    } finally {
      network.mockImplementation(fallback);
    }
  });
  it("separates IdP cookies from refresh material and deletes sessions even after configuration is disabled", async () => {
    const f = fixture();
    login.mockResolvedValueOnce({
      session: {
        username: "user",
        token: "access",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
      cookies: [
        {
          name: "refresh_token",
          value: "refresh",
          domain: "ontrack.example.edu",
          path: "/api/auth",
        },
        {
          name: "username",
          value: "user",
          domain: "ontrack.example.edu",
          path: "/",
        },
        { name: "sid", value: "sso", domain: "tenant.okta.example", path: "/" },
      ],
    });
    expect(
      (
        await f.call("/v1/connect", {
          platform: "ontrack",
          mode: "sso",
          input: credentials,
        })
      ).status,
    ).toBe(200);
    const shared = await decrypt<any>(
      key,
      `${account}:sso`,
      await f.storage.get<any>("sso"),
    );
    expect(shared.cookies.map((c: any) => c.name)).toEqual(["sid"]);
    await f.call("/v1/forget-login");
    expect(await f.storage.get("sso")).toBeUndefined();
    expect(await f.storage.get("refresh:ontrack")).toBeDefined();
    expect(
      (await f.call("/v1/disconnect", { platform: "ontrack" })).status,
    ).toBe(200);
    expect(await f.storage.get("session:ontrack")).toBeUndefined();
    expect(await f.storage.get("refresh:ontrack")).toBeUndefined();
  });
  it("renews Moodle over HTTP, retains full cookie rotation and rejects stale cookie updates", async () => {
    const f = fixture(false);
    expect(
      (
        await f.call("/v1/connect", {
          platform: "moodle",
          mode: "session",
          input: { cookie_name: "MoodleSession", cookie_value: "valid" },
        })
      ).status,
    ).toBe(200);
    const fallback = network.getMockImplementation()!;
    network.mockImplementation(async (input, init) => {
      if (String(input).includes("core_session_touch"))
        return Response.json(
          [
            { error: false, data: null },
            { error: false, data: 1800 },
          ],
          {
            headers: {
              "set-cookie":
                "MoodleSession=rotated; Path=/; Secure; HttpOnly, affinity=sticky; Path=/; Secure",
            },
          },
        );
      expect(new Headers(init?.headers).get("cookie")).toContain(
        "MoodleSession=rotated",
      );
      expect(new Headers(init?.headers).get("cookie")).toContain(
        "affinity=sticky",
      );
      return fallback(input, init);
    });
    try {
      const session = (await (
        await f.call("/v1/renew", { platform: "moodle" })
      ).json()) as any;
      expect(session).toMatchObject({
        cookie_value: "rotated",
        profile_id: "1",
      });
      expect(login).not.toHaveBeenCalled();
      expect(
        await (
          await f.call("/v1/cookies", {
            platform: "moodle",
            expected_cookie_value: "valid",
            cookies: session.cookies,
          })
        ).json(),
      ).toEqual({ ok: false });
      expect(
        await (await f.call("/v1/session", { platform: "moodle" })).json(),
      ).toMatchObject({ cookie_value: "rotated" });
    } finally {
      network.mockImplementation(fallback);
    }
  });
  it.each(["missing-token", "expired-token"])(
    "recovers an invalid OnTrack refresh response through saved SSO: %s",
    async (failure) => {
      login.mockReset();
      const f = fixture();
      const cookies = [
        {
          name: "refresh_token",
          value: "refresh-a",
          domain: "ontrack.example.edu",
          path: "/api/auth",
          secure: true,
        },
      ];
      login
        .mockResolvedValueOnce({
          session: {
            username: "user",
            token: "access-a",
            expires_at: new Date(Date.now() + 120000).toISOString(),
          },
          cookies,
        })
        .mockResolvedValueOnce({
          session: {
            username: "user",
            token: "access-b",
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          },
          cookies: [{ ...cookies[0], value: "refresh-b" }],
        });
      expect(
        (
          await f.call("/v1/connect", {
            platform: "ontrack",
            mode: "sso",
            input: { ...credentials, remember: true, remember_totp: true },
          })
        ).status,
      ).toBe(200);
      const fallback = network.getMockImplementation()!;
      network.mockImplementation(async (input, init) =>
        String(input).endsWith("/api/auth/access-token")
          ? Response.json(
              failure === "missing-token"
                ? {}
                : {
                    auth_token: "expired",
                    auth_token_expiry: new Date(
                      Date.now() - 1000,
                    ).toISOString(),
                    user: { username: "user" },
                  },
            )
          : fallback(input, init),
      );
      try {
        const results = await Promise.all([
          f.call("/v1/session", { platform: "ontrack" }),
          f.call("/v1/session", { platform: "ontrack" }),
        ]);
        for (const result of results) {
          expect(result.status).toBe(200);
          expect(await result.json()).toMatchObject({
            token: "access-b",
            profile_id: "user",
          });
        }
        expect(login).toHaveBeenCalledTimes(2);
        expect(login.mock.calls[1]?.[0].input).toMatchObject({
          username: credentials.username,
          password: credentials.password,
        });
        expect(await f.storage.get("retry_after:ontrack")).toBeUndefined();
        const status = JSON.stringify(
          await (await f.call("/v1/status")).json(),
        );
        expect(status).not.toContain("access-b");
        expect(status).not.toContain("refresh-b");
      } finally {
        network.mockImplementation(fallback);
      }
    },
  );
  it.each(["outage", "changed-account"])(
    "does not start OnTrack browser recovery for %s",
    async (failure) => {
      login.mockReset();
      const f = fixture();
      login.mockResolvedValue({
        session: {
          username: "user",
          token: "access-a",
          expires_at: new Date(Date.now() + 120000).toISOString(),
        },
        cookies: [
          {
            name: "refresh_token",
            value: "refresh-a",
            domain: "ontrack.example.edu",
            path: "/api/auth",
          },
        ],
      });
      await f.call("/v1/connect", {
        platform: "ontrack",
        mode: "sso",
        input: { ...credentials, remember: true, remember_totp: true },
      });
      const fallback = network.getMockImplementation()!;
      network.mockImplementation(async (input, init) =>
        String(input).endsWith("/api/auth/access-token")
          ? failure === "outage"
            ? new Response(null, { status: 503 })
            : Response.json({
                auth_token: "foreign",
                auth_token_expiry: new Date(Date.now() + 3600000).toISOString(),
                user: { username: "different-user" },
              })
          : fallback(input, init),
      );
      try {
        expect(
          await (await f.call("/v1/session", { platform: "ontrack" })).json(),
        ).toMatchObject({
          code:
            failure === "outage" ? "UPSTREAM_UNAVAILABLE" : "ACCOUNT_CHANGED",
        });
        expect(login).toHaveBeenCalledOnce();
      } finally {
        network.mockImplementation(fallback);
      }
    },
  );
  it("proactively refreshes OnTrack once for concurrent reads and keeps refresh material private", async () => {
    const f = fixture(false);
    // Browser SSO supplies refresh cookies; use the encrypted vault fixture to model a previous connection.
    const { encrypt } = await import("../src/auth/crypto.ts");
    await f.storage.put(
      "site:ontrack",
      await encrypt(
        key,
        `${account}:site:ontrack`,
        "https://ontrack.example.edu",
      ),
    );
    await f.storage.put(
      "session:ontrack",
      await encrypt(key, `${account}:session:ontrack`, {
        username: "user",
        token: "access-a",
        profile_id: "user",
        expires_at: new Date(Date.now() + 1000).toISOString(),
      }),
    );
    await f.storage.put(
      "refresh:ontrack",
      await encrypt(key, `${account}:refresh:ontrack`, [
        {
          name: "refresh_token",
          value: "refresh-a",
          domain: "ontrack.example.edu",
          path: "/",
        },
        {
          name: "username",
          value: "user",
          domain: "ontrack.example.edu",
          path: "/",
        },
      ]),
    );
    const fallback = network.getMockImplementation()!;
    let exchanges = 0;
    network.mockImplementation(async (input, init) => {
      if (String(input).endsWith("/api/auth/access-token")) {
        exchanges++;
        return Response.json(
          {
            auth_token: "access-b",
            auth_token_expiry: new Date(Date.now() + 3600000).toISOString(),
            user: { username: "user" },
          },
          {
            headers: {
              "set-cookie": "refresh_token=refresh-b; Path=/; Secure; HttpOnly",
            },
          },
        );
      }
      return fallback(input, init);
    });
    try {
      const results = await Promise.all([
        f.call("/v1/session", { platform: "ontrack" }),
        f.call("/v1/session", { platform: "ontrack" }),
      ]);
      for (const response of results) {
        const data = await response.json();
        expect(data).toMatchObject({ token: "access-b" });
        expect(JSON.stringify(data)).not.toContain("refresh-");
      }
      expect(exchanges).toBe(1);
      expect(login).not.toHaveBeenCalled();
      const stored = await decrypt<any[]>(
        key,
        `${account}:refresh:ontrack`,
        await f.storage.get<any>("refresh:ontrack"),
      );
      expect(stored.find((c) => c.name === "refresh_token").value).toBe(
        "refresh-b",
      );
      const status = JSON.stringify(await (await f.call("/v1/status")).json());
      expect(status).not.toContain("access-b");
      expect(status).not.toContain("refresh-b");
      await f.call("/v1/disconnect", { platform: "ontrack" });
      expect(await f.storage.get("refresh:ontrack")).toBeUndefined();
    } finally {
      network.mockImplementation(fallback);
    }
  });
  it("backs off HTTP outages without launching the browser", async () => {
    const f = fixture();
    await f.call("/v1/connect", {
      platform: "moodle",
      mode: "sso",
      input: credentials,
    });
    const fallback = network.getMockImplementation()!;
    network.mockImplementation(async () => new Response(null, { status: 503 }));
    try {
      expect(
        await (await f.call("/v1/renew", { platform: "moodle" })).json(),
      ).toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
      expect((await f.call("/v1/renew", { platform: "moodle" })).status).toBe(
        429,
      );
      expect(login).toHaveBeenCalledOnce();
    } finally {
      network.mockImplementation(fallback);
    }
  });
  it("retains encrypted password/TOTP only with opt-in, omits one-time codes and supplies them on renewal", async () => {
    const f = fixture();
    expect(
      (
        await f.call("/v1/connect", {
          platform: "moodle",
          mode: "sso",
          input: { ...credentials, remember: true, remember_totp: true },
        })
      ).status,
    ).toBe(200);
    const stored = await decrypt<any>(
      key,
      `${account}:sso`,
      await f.storage.get<any>("sso"),
    );
    expect(stored.input).toMatchObject({
      username: "user",
      password: credentials.password,
      totp: { secret: seed },
    });
    expect(stored.input).not.toHaveProperty("mfa_code");
    const serialized = JSON.stringify([...f.storage.data]);
    expect(serialized).not.toContain(seed);
    expect(serialized).not.toContain(credentials.password);
    expect((await f.call("/v1/renew", { platform: "moodle" })).status).toBe(
      200,
    );
    expect(login.mock.calls[1]![0].input).toMatchObject({
      password: credentials.password,
      totp: { secret: seed },
    });
    const status = JSON.stringify(await (await f.call("/v1/status")).json());
    expect(status).not.toContain(seed);
    expect(status).not.toContain(credentials.password);
    expect(
      (await f.call("/v1/session", { platform: "moodle" }, "b".repeat(64)))
        .status,
    ).not.toBe(200);
  });
  it("does not retain a supplied TOTP secret without its separate opt-in", async () => {
    const f = fixture();
    expect(
      (
        await f.call("/v1/connect", {
          platform: "moodle",
          mode: "sso",
          input: { ...credentials, remember: true },
        })
      ).status,
    ).toBe(200);
    const stored = await decrypt<any>(
      key,
      `${account}:sso`,
      await f.storage.get<any>("sso"),
    );
    expect(stored.input.password).toBe(credentials.password);
    expect(stored.input).not.toHaveProperty("totp");
    expect(stored.retention).toMatchObject({
      password: true,
      totp: false,
      notice_version: USAGE_VERSION,
      accepted_at: expect.any(Number),
    });
    expect((await f.call("/v1/renew", { platform: "moodle" })).status).toBe(
      200,
    );
    expect(login.mock.calls[1]![0].input).not.toHaveProperty("totp");
    const saved = await f.storage.get("sso");
    expect(
      (
        await f.call("/v1/connect", {
          platform: "moodle",
          mode: "sso",
          input: { ...credentials, remember: false, remember_totp: true },
        })
      ).status,
    ).not.toBe(200);
    expect(await f.storage.get("sso")).toEqual(saved);
  });
  it("keeps only cookies without retention, removes credentials when retention is unchecked, and supports forgetting", async () => {
    const f = fixture();
    await f.call("/v1/connect", {
      platform: "moodle",
      mode: "sso",
      input: { ...credentials, remember: true, remember_totp: true },
    });
    await f.call("/v1/connect", {
      platform: "moodle",
      mode: "sso",
      input: { ...credentials, remember: false },
    });
    const stored = await decrypt<any>(
      key,
      `${account}:sso`,
      await f.storage.get<any>("sso"),
    );
    expect(stored).not.toHaveProperty("input");
    await f.call("/v1/forget-login");
    expect(await f.storage.get("sso")).toBeUndefined();
    expect((await f.call("/v1/session", { platform: "moodle" })).status).toBe(
      200,
    );
    await f.call("/v1/disconnect", { platform: "moodle" });
    expect(await f.storage.get("session:moodle")).toBeUndefined();
  });
  it("rejects changed renewal identities and backs off repeated failed logins", async () => {
    const f = fixture();
    await f.call("/v1/connect", {
      platform: "moodle",
      mode: "sso",
      input: { ...credentials, remember: true, remember_totp: true },
    });
    login.mockResolvedValueOnce({
      session: { cookie_name: "MoodleSession", cookie_value: "changed" },
      cookies: [],
    });
    expect(
      await (await f.call("/v1/renew", { platform: "moodle" })).json(),
    ).toMatchObject({ code: "ACCOUNT_CHANGED" });
    login.mockRejectedValueOnce(new Error("provider failed"));
    await f.call("/v1/renew", { platform: "moodle" });
    const calls = login.mock.calls.length;
    expect((await f.call("/v1/renew", { platform: "moodle" })).status).toBe(
      429,
    );
    expect(login.mock.calls).toHaveLength(calls);
  });
});
