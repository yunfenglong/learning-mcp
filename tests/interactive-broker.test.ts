import { beforeEach, describe, expect, it, vi } from "vitest";
const flow = vi.hoisted(() => ({
  start: vi.fn(),
  next: vi.fn(),
  close: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      protected ctx: any,
      protected env: any,
    ) {}
  },
}));
vi.mock("@cloudflare/playwright", () => ({ launch: vi.fn() }));
vi.mock("../broker/interactive-sso.ts", () => ({
  InteractiveSignIn: class {
    start = flow.start;
    next = flow.next;
    close = flow.close;
  },
}));
import entrypoint, { BrokerState } from "../broker/worker.ts";
import { MemoryStore, key } from "./support.ts";
import { digest, decrypt } from "../src/auth/crypto.ts";
import { MFA_TTL_MS } from "../src/auth/mfa.ts";
const pendingAccount = "a".repeat(64),
  otherAccount = "b".repeat(64);
function fixture() {
  const stores = new Map<string, MemoryStore>(),
    objects = new Map<string, BrokerState>();
  const env: any = {
    BROKER_CREDENTIALS_KEY: key,
    BROKER_SERVICE_TOKEN: "t".repeat(64),
    BROWSER: {},
    LOGIN_ORIGINS: '["https://tenant.okta.example"]',
    SSO_PROVIDERS: '[{"type":"okta","origin":"https://tenant.okta.example"}]',
  };
  env.BROKER_STATE = {
    idFromName: (id: string) => id,
    get: (id: string) => ({
      fetch: (r: Request) => {
        if (!objects.has(id)) {
          const storage = Object.assign(new MemoryStore(), {
            setAlarm: vi.fn(async () => {}),
          });
          stores.set(id, storage);
          objects.set(id, new BrokerState({ storage } as any, env));
        }
        return objects.get(id)!.fetch(r);
      },
    }),
  };
  const request = (path: string, body: unknown, account = pendingAccount) =>
    new Request(`https://broker${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.BROKER_SERVICE_TOKEN}`,
        "x-suite-account": account,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  return {
    env,
    stores,
    objects,
    request,
    call: (path: string, body: unknown, account = pendingAccount) =>
      entrypoint.fetch(request(path, body, account), env),
  };
}
const start = {
  interactive: true,
  provider: "https://tenant.okta.example",
  input: {
    username: "u",
    password: "password-canary",
    remember: true,
    remember_totp: true,
  },
};
const challenge = {
  status: "mfa_required",
  methods: ["sso_otp"],
  attempts_remaining: 3,
};
beforeEach(() => {
  vi.clearAllMocks();
  flow.start.mockResolvedValue(challenge);
  flow.close.mockResolvedValue(undefined);
});
describe("private interactive sign-in transaction", () => {
  it("routes interactive landing sign-in into one serialized private object without storing credentials", async () => {
    const f = fixture();
    expect(await (await f.call("/v1/authenticate-sso", start)).json()).toEqual(
      challenge,
    );
    expect(f.stores.get(pendingAccount)!.data.size).toBe(0);
    expect(flow.start).toHaveBeenCalledOnce();
    expect((await f.call("/v1/authenticate-sso", start)).status).toBe(409);
    expect(flow.start).toHaveBeenCalledOnce();
    flow.next.mockResolvedValue(challenge);
    expect(
      (
        await f.call("/v1/sign-in/continue", {
          method: "sso_otp",
          mfa_code: "123456",
        })
      ).status,
    ).toBe(200);
    expect(flow.next).toHaveBeenCalledWith({
      method: "sso_otp",
      mfa_code: "123456",
    });
    expect(f.stores.get(pendingAccount)!.data.size).toBe(0);
  });
  it("rejects another transaction account and an evicted transaction; cancellation and alarm close the browser", async () => {
    const f = fixture();
    expect((await f.call("/v1/authenticate-sso", start)).status).toBe(200);
    expect(
      (
        await f.call(
          "/v1/sign-in/continue",
          { method: "sso_otp" },
          otherAccount,
        )
      ).status,
    ).toBe(409);
    const forged = await f.objects
      .get(pendingAccount)!
      .fetch(
        f.request("/v1/sign-in/continue", { method: "sso_otp" }, otherAccount),
      );
    expect(forged.status).toBe(409);
    expect(flow.next).not.toHaveBeenCalled();
    await f.objects.get(pendingAccount)!.alarm();
    expect(flow.close).toHaveBeenCalledOnce();
    expect(
      (await f.call("/v1/sign-in/continue", { method: "sso_otp" })).status,
    ).toBe(409);
    await f.call("/v1/authenticate-sso", start);
    expect((await f.call("/v1/sign-in/cancel", {})).status).toBe(200);
    expect(flow.close).toHaveBeenCalledTimes(2);
  });
  it("derives identity and retains opted-in credentials only after active provider verification", async () => {
    const f = fixture();
    expect((await f.call("/v1/authenticate-sso", start)).status).toBe(200);
    const provider = "https://tenant.okta.example",
      userId = "00uVerified";
    flow.next.mockResolvedValue({
      provider,
      input: start.input,
      result: {
        session: {
          status: "ACTIVE",
          userId,
          expiresAt: new Date(Date.now() + MFA_TTL_MS).toISOString(),
        },
        cookies: [],
      },
    });
    const result = await (
      await f.call("/v1/sign-in/continue", {
        method: "sso_otp",
        mfa_code: "123456",
      })
    ).json();
    const id = await digest(`provider-sso\0okta\0${provider}\0${userId}`);
    expect(result).toEqual({ id, name: "SSO account" });
    expect(f.stores.get(pendingAccount)!.data.size).toBe(0);
    const record: any = await f.stores.get(id)!.get("sso");
    expect(record).toHaveProperty("ciphertext");
    expect(JSON.stringify(record)).not.toContain("password-canary");
    const saved: any = await decrypt(key, `${id}:sso`, record);
    expect(saved.input.password).toBe("password-canary");
    expect(saved.input).not.toHaveProperty("mfa_code");
  });
});
