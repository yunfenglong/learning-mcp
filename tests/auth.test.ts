import { USAGE_VERSION } from "../src/domain/usage.ts";
import { describe, expect, it } from "vitest";
import { AccountStore, READ_SCOPE, MANAGE_SCOPE } from "../src/auth/state.ts";
import { decrypt, encrypt, digest } from "../src/auth/crypto.ts";
import { finishDiscovery, normalizeCourse } from "../src/accounts/courses.ts";
import { MemoryStore, key, unit } from "./support.ts";
const a = "a".repeat(64),
  b = "b".repeat(64),
  client = {
    id: "chatgpt",
    name: "ChatGPT",
    redirect_uri: "https://chatgpt.com/callback",
  };
async function fixture() {
  const storage = new MemoryStore();
  let now = Date.now();
  const account = new AccountStore(storage, a, key, () => now);
  await account.putProfile({ id: a, name: "Student A" });
  await account.acceptUsage(USAGE_VERSION);
  return { storage, account, tick: (n: number) => (now += n) };
}
describe("account authorization and isolation", () => {
  it("requires the current usage acknowledgement before issuing grants", async () => {
    const store = new MemoryStore(),
      account = new AccountStore(store, a, key);
    await account.putProfile({ id: a });
    await expect(account.approve(client, [READ_SCOPE])).rejects.toMatchObject({
      code: "USAGE_REQUIRED",
    });
    await expect(account.acceptUsage("old-version")).rejects.toMatchObject({
      code: "USAGE_REQUIRED",
    });
    const accepted = await account.acceptUsage(USAGE_VERSION);
    expect(accepted.accepted_at).toBeGreaterThan(0);
    await expect(account.approve(client, [READ_SCOPE])).resolves.toMatchObject({
      account_id: a,
    });
  });
  it("issues grants for the authenticated profile and enforces account, client and scope", async () => {
    const f = await fixture(),
      g = await f.account.approve(client, [READ_SCOPE, MANAGE_SCOPE]);
    await expect(
      f.account.authorize(a, g.id, client.id, [READ_SCOPE]),
    ).resolves.toMatchObject({ account_id: a });
    for (const [account, id, scope] of [
      [b, client.id, [READ_SCOPE]],
      [a, "other", [READ_SCOPE]],
      [a, client.id, []],
      [a, client.id, [READ_SCOPE, "unknown"]],
    ] as const)
      await expect(
        f.account.authorize(account, g.id, id, scope),
      ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("checks live revocation and grant expiry", async () => {
    const f = await fixture(),
      g = await f.account.approve(client, [READ_SCOPE]);
    await f.account.revoke(g.id);
    await expect(
      f.account.authorize(a, g.id, client.id, [READ_SCOPE]),
    ).rejects.toThrow();
    const next = await f.account.approve(client, [READ_SCOPE]);
    f.tick(31 * 86400_000);
    await expect(
      f.account.authorize(a, next.id, client.id, [READ_SCOPE]),
    ).rejects.toThrow();
  });
  it("cannot issue a client grant without an authenticated account profile", async () => {
    await expect(
      new AccountStore(new MemoryStore(), a, key).approve(client, [READ_SCOPE]),
    ).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
  });
  it("stores Ed credentials encrypted and authenticates the account context", async () => {
    const f = await fixture();
    await f.account.putConnection({ token: "secret-ed-a", profile_id: "1" });
    expect(JSON.stringify([...f.storage.data])).not.toContain("secret-ed-a");
    expect((await f.account.getConnection()).token).toBe("secret-ed-a");
    const other = new AccountStore(f.storage, b, key);
    await expect(other.getConnection()).rejects.toMatchObject({
      code: "CREDENTIAL_UNAVAILABLE",
    });
    const record = await encrypt(key, "a", { secret: "x" });
    await expect(decrypt(key, "b", record)).rejects.toThrow();
  });
  it("consumes browser transactions once under concurrency and expires them", async () => {
    const f = await fixture(),
      k = `consent:${await digest("nonce")}`;
    await f.account.ephemeralPut(k, { fingerprint: "f" }, Date.now() + 1000);
    const values = await Promise.all([
      f.account.ephemeralGet(k, true),
      f.account.ephemeralGet(k, true),
    ]);
    expect(values.filter(Boolean)).toHaveLength(1);
    await f.account.ephemeralPut(k, { f: 1 }, Date.now() + 1000);
    f.tick(2000);
    expect(await f.account.ephemeralGet(k)).toBeUndefined();
  });
});
describe("user-confirmed course associations", () => {
  it("binds a slash-separated discovered code without treating its parts as aliases", async () => {
    const f = await fixture();
    await f.account.discovered(
      finishDiscovery(
        [
          normalizeCourse("ed", {
            id: 101,
            code: "CS101/CS201",
            scope_verified: true,
          }),
        ],
        [],
      ),
    );
    const combined = {
      ...unit,
      code: "cs101/cs201",
      moodle_course_id: undefined,
      ontrack_unit_id: undefined,
      ontrack_project_id: undefined,
    };
    expect((await f.account.bind(combined)).unit.code).toBe("CS101/CS201");
    const relabeled = await f.account.bind({ ...combined, code: "CS101" });
    expect(relabeled.unit.code).toBe("CS101");
    expect(relabeled.warnings[0]?.platform_code).toBe("CS101/CS201");
  });
  it("allows any subset of platforms, including an Ed-only course within the deployment scope", async () => {
    const f = await fixture();
    await f.account.discovered(
      finishDiscovery(
        [
          normalizeCourse("ed", {
            id: 101,
            name: "CSC1001 Main",
            code: "CSC1001",
            year: "2026",
            session: "S2",
            scope_verified: true,
          }),
        ],
        [],
      ),
    );
    await f.account.bind({
      ...unit,
      moodle_course_id: undefined,
      ontrack_unit_id: undefined,
      ontrack_project_id: undefined,
    });
    expect(await f.account.units()).toHaveLength(1);
  });
  it("rejects foreign IDs, expired discoveries and courses outside the configured Ed scope", async () => {
    const f = await fixture();
    await expect(f.account.bind(unit)).rejects.toMatchObject({
      code: "DISCOVERY_REQUIRED",
    });
    await f.account.discovered(
      finishDiscovery(
        [
          normalizeCourse("ed", {
            id: 999,
            name: "CSC1001 Main",
            year: "2026",
            session: "S2",
          }),
        ],
        [],
      ),
    );
    await expect(
      f.account.bind({
        ...unit,
        moodle_course_id: undefined,
        ontrack_unit_id: undefined,
        ontrack_project_id: undefined,
      }),
    ).rejects.toMatchObject({ code: "COURSE_NOT_ACCESSIBLE" });
    await f.account.discovered(
      finishDiscovery(
        [
          normalizeCourse("ed", {
            id: 101,
            name: "CSC1001",
            scope_verified: false,
          }),
        ],
        [],
      ),
    );
    await expect(
      f.account.bind({
        ...unit,
        moodle_course_id: undefined,
        ontrack_unit_id: undefined,
        ontrack_project_id: undefined,
      }),
    ).rejects.toMatchObject({ code: "COURSE_NOT_ACCESSIBLE" });
  });
  it("checks OnTrack project-to-unit ownership and semester mismatches", async () => {
    const f = await fixture();
    await f.account.discovered(
      finishDiscovery(
        [
          normalizeCourse("ontrack", {
            id: 404,
            unit: {
              id: 303,
              code: "CSC1001",
              name: "CSC1001 Main 2026 S2",
            },
          }),
        ],
        [],
      ),
    );
    const only = {
      ...unit,
      ed_course_id: undefined,
      moodle_course_id: undefined,
    };
    await expect(
      f.account.bind({ ...only, ontrack_unit_id: 999 }),
    ).rejects.toMatchObject({ code: "COURSE_NOT_ACCESSIBLE" });
    await expect(f.account.bind({ ...only, year: 2025 })).rejects.toMatchObject(
      { code: "COURSE_MISMATCH" },
    );
    await f.account.bind(only);
    await f.account.disconnect("ontrack");
    expect(await f.account.units()).toEqual([]);
  });
  it("does not merge ambiguous matches automatically", () => {
    const result = finishDiscovery(
      [
        normalizeCourse("moodle", {
          id: 1,
          shortname: "CSC1001 2026 S1 Main",
        }),
        normalizeCourse("moodle", {
          id: 2,
          shortname: "CSC1001 2026 S2 Main",
        }),
        normalizeCourse("ed", { id: 3, code: "CSC1001" }),
      ],
      [],
    );
    expect(result.suggestions[0]?.needs_confirmation).toBe(true);
    expect(result.courses[2]?.accessible).toBe(true);
  });
  it("preserves concurrent course associations and removes only the disconnected platform", async () => {
    const f = await fixture();
    await f.account.discovered(
      finishDiscovery(
        [
          normalizeCourse("moodle", {
            id: 202,
            shortname: "CSC1001 2026 S2 Main",
          }),
          normalizeCourse("moodle", {
            id: 203,
            shortname: "CSC2004 2026 S2 Main",
          }),
        ],
        [],
      ),
    );
    const only = {
      ...unit,
      ed_course_id: undefined,
      ontrack_unit_id: undefined,
      ontrack_project_id: undefined,
    };
    await Promise.all([
      f.account.bind(only),
      f.account.bind({
        ...only,
        key: "csc2004-my-2026-s2",
        code: "CSC2004",
        moodle_course_id: 203,
      }),
    ]);
    expect(await f.account.units()).toHaveLength(2);
    await f.account.disconnect("ed");
    expect(await f.account.units()).toHaveLength(2);
    await f.account.disconnect("moodle");
    expect(await f.account.units()).toEqual([]);
  });
  it("keeps mappings during token rotation for the same verified Ed identity", async () => {
    const f = await fixture();
    await f.account.putConnection({ token: "first", profile_id: "1" });
    await f.storage.put("units", [
      {
        ...unit,
        moodle_course_id: undefined,
        ontrack_unit_id: undefined,
        ontrack_project_id: undefined,
      },
    ]);
    await f.account.putConnection({ token: "second", profile_id: "1" });
    expect(await f.account.units()).toHaveLength(1);
    await f.account.putConnection({ token: "other", profile_id: "2" });
    expect(await f.account.units()).toEqual([]);
  });
});
