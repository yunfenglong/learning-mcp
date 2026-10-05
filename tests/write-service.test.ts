import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      protected ctx: unknown,
      protected env: unknown,
    ) {}
  },
}));
import { AccountState } from "../src/auth/broker.ts";
import { AccountStore, READ_SCOPE, WRITE_SCOPE } from "../src/auth/state.ts";
import { AccountService } from "../src/accounts/service.ts";
import type { Config, Env } from "../src/config.ts";
import { USAGE_VERSION } from "../src/domain/usage.ts";
import { ontrackWrite } from "../src/platforms/write/ontrack.ts";
import type { OnTrackClient } from "../vendor/ontrack/client.js";
import { OutputBoundary } from "../src/security/output.ts";
import { prepared } from "../src/platforms/write/shared.ts";
import { MemoryStore, key, unit } from "./support.ts";

afterEach(() => vi.useRealTimers());
async function fixture() {
  const account = "a".repeat(64),
    storage = new MemoryStore();
  let scheduled: number | null = null;
  const durableStorage = Object.assign(storage, {
    getAlarm: async () => scheduled,
    setAlarm: async (time: number) => {
      scheduled = time;
    },
  });
  const env = {
    CREDENTIALS_KEY: key,
    AUTH_STATE: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: (r: Request) => object.fetch(r) }),
    },
  } as unknown as Env;
  const object = new AccountState(
    { storage: durableStorage } as unknown as DurableObjectState,
    env,
  );
  const state = new AccountStore(storage, account, key);
  await state.putProfile({ id: account });
  await state.acceptUsage(USAGE_VERSION);
  const grant = await state.approve(
    {
      id: "writer",
      name: "Writer",
      redirect_uri: "https://client.example/callback",
    },
    [READ_SCOPE, WRITE_SCOPE],
  );
  await storage.put("units", [unit]);
  const owner = { client_id: grant.client_id, grant_id: grant.id };
  const config: Config = {
    issuer: "https://suite.example",
    units: [unit],
    platforms: {},
  };
  const service = new AccountService(env, { id: account }, config);
  const plan = await prepared({
    target: { course: 101 },
    changes: { body: "User body" },
    irreversible: true,
    warnings: [],
  });
  const prepare = vi
    .spyOn(service.backends.ed, "prepareWrite")
    .mockResolvedValue(plan);
  const execute = vi
    .spyOn(service.backends.ed, "executeWrite")
    .mockResolvedValue({ id: 90 });
  const preview = () =>
    service.previewWrite(owner, "ed", "create_thread", {
      unit: unit.key,
      title: "User title",
      body: "User body",
    });
  return {
    service,
    state,
    storage,
    object,
    owner,
    prepare,
    execute,
    plan,
    preview,
    alarm: () => scheduled,
  };
}

describe("write confirmation and retention boundaries", () => {
  it("rechecks bindings changed while platform preflight awaited network calls", async () => {
    const f = await fixture(),
      preview = await f.preview();
    f.prepare.mockImplementationOnce(async () => {
      await f.storage.put("units", [{ ...unit, ed_course_id: 999 }]);
      return f.plan;
    });
    await expect(
      f.service.confirmWrite(f.owner, String(preview.preview_id)),
    ).rejects.toMatchObject({ code: "WRITE_PREVIEW_CHANGED" });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("rechecks a grant revoked during preflight before executing", async () => {
    const f = await fixture(),
      preview = await f.preview();
    f.prepare.mockImplementationOnce(async () => {
      await f.state.revoke(f.owner.grant_id);
      return f.plan;
    });
    await expect(
      f.service.confirmWrite(f.owner, String(preview.preview_id)),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("reports uncertainty if receipt persistence is denied after an executed write", async () => {
    const f = await fixture(),
      preview = await f.preview();
    f.execute.mockImplementationOnce(async () => {
      await f.state.revoke(f.owner.grant_id);
      return { id: 90 };
    });
    await expect(
      f.service.confirmWrite(f.owner, String(preview.preview_id)),
    ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNCERTAIN" });
    await expect(
      f.service.confirmWrite(f.owner, String(preview.preview_id)),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("checks the reviewed plan again at the actual platform execution boundary", async () => {
    const send = vi.fn();
    const context = {
      config: { issuer: "https://suite.example", units: [unit], platforms: {} },
      output: new OutputBoundary(),
      unit,
      files: [],
      username: "student",
      enrolled: async () => {},
      client: {
        getProject: async () => ({
          id: 404,
          unit: { id: 303 },
          tasks: [{ task_definition_id: 501, status: "not_started" }],
        }),
        getUnit: async () => ({
          id: 303,
          task_definitions: [
            {
              id: 501,
              abbreviation: "1.1P",
              name: "Task",
              upload_requirements: [],
            },
          ],
        }),
        addTaskComment: send,
      } as unknown as OnTrackClient,
    };
    const plan = (await ontrackWrite(
      "send_chat",
      { unit: unit.key, task: 501, message: "Reviewed message" },
      context,
    )) as { fingerprint: string };
    await expect(
      ontrackWrite(
        "send_chat",
        { unit: unit.key, task: 501, message: "Changed message" },
        { ...context, expectedFingerprint: plan.fingerprint },
        true,
      ),
    ).rejects.toMatchObject({ code: "WRITE_PREVIEW_CHANGED" });
    expect(send).not.toHaveBeenCalled();
    await ontrackWrite(
      "send_chat",
      { unit: unit.key, task: 501, message: "Reviewed message" },
      { ...context, expectedFingerprint: plan.fingerprint },
      true,
    );
    expect(send).toHaveBeenCalledExactlyOnceWith(404, 501, "Reviewed message");
  });
  it("keeps cleanup scheduled through idle periods and does not postpone it on continued requests", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    const f = await fixture(),
      started = Date.now();
    const upload = (await f.service.upload(f.owner, "start", {
      filename: "essay.txt",
      content_type: "text/plain",
      size: 4,
      sha256: "a".repeat(64),
    })) as { upload_id: string };
    expect(f.alarm()).toBe(started + 600_000);
    vi.setSystemTime(started + 60_000);
    await f.service.upload(f.owner, "chunk", {
      upload_id: upload.upload_id,
      offset: 0,
      data: btoa("test"),
    });
    expect(f.alarm()).toBe(started + 600_000);
    vi.setSystemTime(started + 600_000);
    await f.object.alarm();
    expect(f.storage.data.has(`upload:${upload.upload_id}`)).toBe(true);
    expect(f.alarm()).toBe(started + 900_000);
    vi.setSystemTime(started + 900_000);
    await f.object.alarm();
    expect(
      [...f.storage.data.keys()].filter((k) => k.startsWith("upload")),
    ).toEqual([]);
    expect(f.alarm()).toBe(started + 30 * 86_400_000);
  });
});
