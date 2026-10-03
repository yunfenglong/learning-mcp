import { beforeEach, describe, expect, it, vi } from "vitest";
const login = vi.hoisted(() => vi.fn());
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      protected ctx: any,
      protected env: any,
    ) {}
  },
}));
vi.mock("../broker/sso.ts", () => ({ browserLogin: login }));
vi.mock("../vendor/moodle/client.js", () => ({
  MoodleClientCore: class {
    constructor(
      private site: string,
      private options: any,
    ) {}
    async getSiteInfo() {
      await this.options.writeSessionCache({ sesskey: "sesskey" });
      return {
        userid: this.options.cookie.value === "changed" ? 2 : 1,
        siteurl: this.site,
        fullname: "User",
      };
    }
  },
}));
import { BrokerState } from "../broker/worker.ts";
import { decrypt } from "../src/auth/crypto.ts";
import { MemoryStore, key } from "./support.ts";
const account = "a".repeat(64),
  seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
function fixture() {
  const storage = new MemoryStore();
  const broker = new BrokerState(
    { storage } as any,
    {
      BROKER_CREDENTIALS_KEY: key,
      BROWSER: {},
      LOGIN_ORIGINS: '["https://tenant.okta.example"]',
      PLATFORM_CONFIG: '{"moodle":{"site_url":"https://moodle.example.edu"}}',
    } as any,
  );
  const call = (path: string, body: any = {}, who = account) =>
    broker.fetch(
      new Request(`https://broker${path}`, {
        method: "POST",
        headers: { "x-suite-account": who, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return { storage, call };
}
beforeEach(() => {
  vi.clearAllMocks();
  login.mockResolvedValue({
    session: { cookie_name: "MoodleSession", cookie_value: "valid" },
    cookies: [{ name: "sid", value: "cookie" }],
  });
});
describe("private credential vault", () => {
  const credentials = {
    username: "user",
    password: "password-secret",
    totp_secret: seed,
    mfa_code: "123456",
  };
  it("retains encrypted password/TOTP only with opt-in, omits one-time codes and supplies them on renewal", async () => {
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
  it("keeps only cookies without retention, removes credentials when retention is unchecked, and supports forgetting", async () => {
    const f = fixture();
    await f.call("/v1/connect", {
      platform: "moodle",
      mode: "sso",
      input: { ...credentials, remember: true },
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
      input: { ...credentials, remember: true },
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
