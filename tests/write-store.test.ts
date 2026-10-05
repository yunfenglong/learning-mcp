import { describe, it, expect } from "vitest";
import { WriteStore, type WriteOwner } from "../src/accounts/write-store.ts";
import { AccountStore, READ_SCOPE, WRITE_SCOPE } from "../src/auth/state.ts";
import { USAGE_VERSION } from "../src/domain/usage.ts";
import { MemoryStore, key } from "./support.ts";
const owner: WriteOwner = { grant_id: "g".repeat(64), client_id: "client-a" };
const hash = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
async function fixture() {
  const storage = new MemoryStore();
  let now = Date.now();
  return {
    storage,
    writes: new WriteStore(storage, "a".repeat(64), key, () => now),
    tick: (ms: number) => (now += ms),
  };
}
describe("encrypted beta write state", () => {
  it("stages bytes by offset, verifies hash and rejects another client", async () => {
    const f = await fixture(),
      bytes = new TextEncoder().encode("private-file-canary");
    const upload = await f.writes.start(owner, {
      filename: "essay.txt",
      content_type: "text/plain",
      size: bytes.length,
      sha256: await hash(bytes),
    });
    const chunk = {
      upload_id: upload.upload_id,
      offset: 0,
      data: btoa("private-file-canary"),
    };
    await expect(
      f.writes.finish(owner, upload.upload_id),
    ).rejects.toMatchObject({ code: "UPLOAD_INCOMPLETE" });
    await f.writes.chunk(owner, chunk);
    expect(await f.writes.chunk(owner, chunk)).toMatchObject({
      duplicate: true,
      received: bytes.length,
    });
    await expect(
      f.writes.chunk(owner, { ...chunk, data: btoa("changed-file-canary") }),
    ).rejects.toMatchObject({ code: "UPLOAD_OFFSET" });
    await f.writes.finish(owner, upload.upload_id);
    expect((await f.writes.files(owner, [upload.upload_id]))[0]!.bytes).toEqual(
      bytes,
    );
    await expect(
      f.writes.files({ ...owner, client_id: "other" }, [upload.upload_id]),
    ).rejects.toMatchObject({ code: "WRITE_NOT_ALLOWED" });
    await expect(
      new WriteStore(f.storage, "b".repeat(64), key).files(owner, [
        upload.upload_id,
      ]),
    ).rejects.toMatchObject({ code: "CREDENTIAL_UNAVAILABLE" });
    const serialized = JSON.stringify([...f.storage.data]);
    expect(serialized).not.toContain("private-file-canary");
    expect(serialized).not.toContain("essay.txt");
    expect(serialized).not.toContain(owner.grant_id);
    await f.writes.cancel(owner, upload.upload_id);
    expect(f.storage.data.size).toBe(0);
  });
  it("rejects wrong hashes, arbitrary paths, oversized files and expires from the original upload start", async () => {
    const f = await fixture();
    await expect(
      f.writes.start(owner, {
        filename: "../essay.txt",
        content_type: "text/plain",
        size: 4,
        sha256: "a".repeat(64),
      }),
    ).rejects.toThrow();
    await expect(
      f.writes.start(owner, {
        filename: "essay.txt",
        content_type: "text/plain",
        size: 16 * 1024 * 1024 + 1,
        sha256: "a".repeat(64),
      }),
    ).rejects.toThrow();
    const upload = await f.writes.start(owner, {
      filename: "essay.txt",
      content_type: "text/plain",
      size: 4,
      sha256: "a".repeat(64),
    });
    await f.writes.chunk(owner, {
      upload_id: upload.upload_id,
      offset: 0,
      data: btoa("test"),
    });
    await expect(
      f.writes.finish(owner, upload.upload_id),
    ).rejects.toMatchObject({ code: "UPLOAD_HASH_MISMATCH" });
    f.tick(900001);
    await expect(
      f.writes.finish(owner, upload.upload_id),
    ).rejects.toMatchObject({ code: "WRITE_EXPIRED" });
  });
  it("claims a confirmation once under concurrency, returns receipts and never repeats an uncertain write", async () => {
    const f = await fixture(),
      preview = await f.writes.preview(owner, { body: "private-post-canary" });
    await expect(
      f.writes.claim(
        { ...owner, grant_id: "b".repeat(64) },
        preview.preview_id,
      ),
    ).rejects.toMatchObject({ code: "WRITE_NOT_ALLOWED" });
    const claims = await Promise.allSettled([
      f.writes.claim(owner, preview.preview_id),
      f.writes.claim(owner, preview.preview_id),
    ]);
    expect(claims.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await f.writes.result(owner, preview.preview_id, { id: 123 }, true);
    expect(await f.writes.claim(owner, preview.preview_id)).toMatchObject({
      receipt: { id: 123 },
      duplicate: true,
    });
    expect(JSON.stringify([...f.storage.data])).not.toContain(
      "private-post-canary",
    );
    const failed = await f.writes.preview(owner, { body: "x" });
    await f.writes.claim(owner, failed.preview_id);
    await f.writes.result(
      owner,
      failed.preview_id,
      { status: "unknown" },
      false,
    );
    await expect(
      f.writes.claim(owner, failed.preview_id),
    ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNCERTAIN" });
    const unused = await f.writes.preview(owner, {});
    f.tick(900001);
    await expect(
      f.writes.claim(owner, unused.preview_id),
    ).rejects.toMatchObject({ code: "WRITE_EXPIRED" });
  });
  it("keeps write authority independent of bindings and checks live revocation", async () => {
    const store = new AccountStore(new MemoryStore(), "a".repeat(64), key);
    await store.putProfile({ id: "a".repeat(64) });
    await store.acceptUsage(USAGE_VERSION);
    const client = {
      id: "client-a",
      name: "Client",
      redirect_uri: "https://client.example/callback",
    };
    const read = await store.approve(client, [READ_SCOPE]);
    await expect(
      store.authorize(store.account, read.id, client.id, [
        READ_SCOPE,
        WRITE_SCOPE,
      ]),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    const write = await store.approve(client, [READ_SCOPE, WRITE_SCOPE]);
    await expect(
      store.authorize(store.account, write.id, client.id, [
        READ_SCOPE,
        WRITE_SCOPE,
      ]),
    ).resolves.toMatchObject({ id: write.id });
    await store.revoke(write.id);
    await expect(
      store.authorize(store.account, write.id, client.id, [
        READ_SCOPE,
        WRITE_SCOPE,
      ]),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
});
