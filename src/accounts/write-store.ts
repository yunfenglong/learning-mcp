import { z } from "zod";
import type { Store } from "../auth/state.ts";
import {
  decrypt,
  encrypt,
  randomToken,
  type EncryptedRecord,
} from "../auth/crypto.ts";
import { SuiteError } from "../errors.ts";

const token = z.string().regex(/^[a-f0-9]{64}$/);
export const uploadStartSchema = z
  .object({
    filename: z
      .string()
      .min(1)
      .max(200)
      .refine((v) => !/[\\/\x00-\x1f]/.test(v) && ![".", ".."].includes(v)),
    content_type: z
      .string()
      .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i)
      .max(100),
    size: z
      .number()
      .int()
      .min(1)
      .max(16 * 1024 * 1024),
    sha256: token,
  })
  .strict();
export const uploadChunkSchema = z
  .object({
    upload_id: token,
    offset: z.number().int().min(0),
    data: z
      .string()
      .min(4)
      .max(16384)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
  })
  .strict();
export interface WriteOwner {
  grant_id: string;
  client_id: string;
}
interface Upload extends WriteOwner {
  expires_at: number;
  filename: string;
  content_type: string;
  size: number;
  sha256: string;
  offset: number;
  ready: boolean;
  chunks: number;
}
interface Saved {
  expires_at: number;
  bytes?: number;
  record: EncryptedRecord;
}
interface Preview extends WriteOwner {
  payload: unknown;
  status: "pending" | "executing" | "complete" | "failed";
  receipt?: unknown;
}
export interface StagedFile {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  sha256: string;
}
export class WriteStore {
  constructor(
    private store: Store,
    private account: string,
    private key: string,
    private now = () => Date.now(),
  ) {}
  private owner(value: WriteOwner, expected: WriteOwner) {
    if (
      value.grant_id !== expected.grant_id ||
      value.client_id !== expected.client_id
    )
      throw new SuiteError(
        "WRITE_NOT_ALLOWED",
        "This upload or preview belongs to another client authorization.",
        403,
      );
  }
  private async read<T>(s: Store, key: string): Promise<T> {
    const saved = await s.get<Saved>(key);
    if (!saved || saved.expires_at <= this.now())
      throw new SuiteError(
        "WRITE_EXPIRED",
        "Create a fresh upload or write preview.",
        409,
      );
    return decrypt<T>(this.key, `${this.account}:${key}`, saved.record);
  }
  private async save(
    s: Store,
    key: string,
    value: unknown,
    ttl = 900_000,
    bytes?: number,
  ) {
    await s.put(key, {
      expires_at: this.now() + ttl,
      ...(bytes === undefined ? {} : { bytes }),
      record: await encrypt(this.key, `${this.account}:${key}`, value),
    });
  }
  async start(owner: WriteOwner, input: unknown) {
    const data = uploadStartSchema.parse(input),
      upload_id = randomToken();
    await this.store.transaction(async (s) => {
      const active = [
        ...(await s.list<Saved>({ prefix: "upload:" })).values(),
      ].filter((v) => v.expires_at > this.now());
      if (
        active.length >= 16 ||
        active.reduce((n, v) => n + (v.bytes ?? 0), 0) + data.size >
          32 * 1024 * 1024
      )
        throw new SuiteError(
          "UPLOAD_LIMIT",
          "Finish or cancel existing uploads before staging more files.",
          409,
        );
      await this.save(
        s,
        `upload:${upload_id}`,
        {
          ...owner,
          ...data,
          offset: 0,
          chunks: 0,
          ready: false,
          expires_at: this.now() + 900_000,
        },
        900_000,
        data.size,
      );
    });
    return { upload_id, chunk_bytes: 12288, expires_in: 900 };
  }
  async chunk(owner: WriteOwner, input: unknown) {
    const a = uploadChunkSchema.parse(input);
    const bytes = Uint8Array.from(atob(a.data), (c) => c.charCodeAt(0));
    if (btoa(String.fromCharCode(...bytes)) !== a.data)
      throw new SuiteError("INVALID_INPUT", "Use canonical base64.");
    return this.store.transaction(async (s) => {
      const key = `upload:${a.upload_id}`,
        u = await this.read<Upload>(s, key);
      this.owner(u, owner);
      if (a.offset < u.offset) {
        const previous = await this.read<{ data: string }>(
          s,
          `upload-chunk:${a.upload_id}:${a.offset}`,
        );
        if (previous.data === a.data)
          return { received: u.offset, duplicate: true };
      }
      if (u.ready || a.offset !== u.offset || bytes.length + u.offset > u.size)
        throw new SuiteError(
          "UPLOAD_OFFSET",
          "Use the next upload offset without changing previously staged bytes.",
          409,
        );
      await this.save(
        s,
        `upload-chunk:${a.upload_id}:${a.offset}`,
        { data: a.data },
        u.expires_at - this.now(),
      );
      u.offset += bytes.length;
      u.chunks++;
      await this.save(s, key, u, u.expires_at - this.now(), u.size);
      return { received: u.offset, size: u.size };
    });
  }
  private async bytes(s: Store, id: string, u: Upload) {
    const result = new Uint8Array(u.size);
    let offset = 0;
    for (let index = 0; index < u.chunks; index++) {
      const chunk = await this.read<{ data: string }>(
        s,
        `upload-chunk:${id}:${offset}`,
      );
      const bytes = Uint8Array.from(atob(chunk.data), (c) => c.charCodeAt(0));
      result.set(bytes, offset);
      offset += bytes.length;
    }
    if (offset !== u.size)
      throw new SuiteError(
        "UPLOAD_INCOMPLETE",
        "Upload all file bytes before using this file.",
        409,
      );
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", result)),
    ]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== u.sha256)
      throw new SuiteError(
        "UPLOAD_HASH_MISMATCH",
        "The staged file does not match its SHA-256.",
        409,
      );
    return result;
  }
  async finish(owner: WriteOwner, id: string) {
    token.parse(id);
    return this.store.transaction(async (s) => {
      const key = `upload:${id}`,
        u = await this.read<Upload>(s, key);
      this.owner(u, owner);
      if (u.offset !== u.size)
        throw new SuiteError(
          "UPLOAD_INCOMPLETE",
          "Upload all file bytes before finishing.",
          409,
        );
      await this.bytes(s, id, u);
      u.ready = true;
      await this.save(s, key, u, u.expires_at - this.now(), u.size);
      return {
        upload_id: id,
        filename: u.filename,
        content_type: u.content_type,
        size: u.size,
        sha256: u.sha256,
        ready: true,
      };
    });
  }
  async files(owner: WriteOwner, ids: string[]): Promise<StagedFile[]> {
    if (new Set(ids).size !== ids.length || ids.length > 16)
      throw new SuiteError("INVALID_INPUT", "Choose distinct staged files.");
    const files: StagedFile[] = [];
    let total = 0;
    for (const id of ids) {
      token.parse(id);
      const u = await this.read<Upload>(this.store, `upload:${id}`);
      this.owner(u, owner);
      total += u.size;
      if (total > 16 * 1024 * 1024)
        throw new SuiteError(
          "UPLOAD_LIMIT",
          "A write is limited to 16 MiB of staged files.",
        );
      if (!u.ready)
        throw new SuiteError(
          "UPLOAD_INCOMPLETE",
          "Finish this upload before preparing a write.",
          409,
        );
      files.push({
        filename: u.filename,
        contentType: u.content_type,
        sha256: u.sha256,
        bytes: await this.bytes(this.store, id, u),
      });
    }
    return files;
  }
  async cancel(owner: WriteOwner, id: string) {
    token.parse(id);
    await this.store.transaction(async (s) => {
      const u = await this.read<Upload>(s, `upload:${id}`);
      this.owner(u, owner);
      for (const k of (await s.list({ prefix: `upload-chunk:${id}:` })).keys())
        await s.delete(k);
      await s.delete(`upload:${id}`);
    });
    return { cancelled: true };
  }
  async preview(owner: WriteOwner, payload: unknown) {
    const preview_id = randomToken();
    await this.store.transaction(async (s) => {
      if (
        [...(await s.list<Saved>({ prefix: "write:" })).values()].filter(
          (v) => v.expires_at > this.now(),
        ).length >= 100
      )
        throw new SuiteError(
          "WRITE_LIMIT",
          "Too many write previews. Wait for unused previews to expire.",
          429,
        );
      await this.save(s, `write:${preview_id}`, {
        ...owner,
        payload,
        status: "pending",
      });
    });
    return { preview_id, expires_in: 900, requires_confirmation: true };
  }
  async claim(owner: WriteOwner, id: string) {
    token.parse(id);
    return this.store.transaction(async (s) => {
      const key = `write:${id}`,
        v = await this.read<Preview>(s, key);
      this.owner(v, owner);
      if (v.status === "complete")
        return { receipt: v.receipt, duplicate: true as const };
      if (v.status !== "pending")
        throw new SuiteError(
          "WRITE_OUTCOME_UNCERTAIN",
          "This preview was already attempted. Check the platform before preparing another write.",
          409,
        );
      v.status = "executing";
      await this.save(s, key, v, 86400_000);
      return { payload: v.payload, duplicate: false as const };
    });
  }
  async result(
    owner: WriteOwner,
    id: string,
    receipt: unknown,
    success: boolean,
  ) {
    token.parse(id);
    await this.store.transaction(async (s) => {
      const key = `write:${id}`,
        v = await this.read<Preview>(s, key);
      this.owner(v, owner);
      if (v.status !== "executing")
        throw new SuiteError(
          "WRITE_NOT_ALLOWED",
          "This preview is not executing.",
          409,
        );
      await this.save(
        s,
        key,
        { ...owner, status: success ? "complete" : "failed", receipt },
        86400_000,
      );
    });
    return receipt;
  }
}
