import { z } from "zod";
import { SuiteError } from "../errors.ts";
import {
  decrypt,
  encrypt,
  randomToken,
  digest,
  type EncryptedRecord,
} from "./crypto.ts";
import { parseUnits, type Unit } from "../domain/units.ts";
import type { Discovery } from "../accounts/courses.ts";
import {
  planCourseBindings,
  validateCourseBinding,
} from "../accounts/bindings.ts";
import { USAGE_VERSION, type UsageAcceptance } from "../domain/usage.ts";
export const READ_SCOPE = "learning:read",
  MANAGE_SCOPE = "learning:bindings";
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
  transaction<T>(callback: (store: Store) => Promise<T>): Promise<T>;
}
export interface Profile {
  id: string;
  name?: string;
  email?: string;
}
export interface Grant {
  id: string;
  account_id: string;
  client_id: string;
  client_name: string;
  redirect_uri: string;
  scopes: string[];
  authorized_at?: number;
  expires_at: number;
  revoked: boolean;
}
export const connectionSchema = z
  .object({
    token: z
      .string()
      .min(1)
      .max(16000)
      .refine((v) => !/[\r\n]/.test(v)),
    profile_id: z.string().min(1).max(200),
    display_name: z.string().max(200).optional(),
  })
  .strict();
export type Connection = z.infer<typeof connectionSchema>;
export class AccountStore {
  constructor(
    private readonly store: Store,
    readonly account: string,
    private readonly key: string,
    private readonly now = () => Date.now(),
  ) {}
  async putProfile(profile: Profile) {
    if (profile.id !== this.account)
      throw new SuiteError("ACCESS_DENIED", "Account mismatch.", 403);
    await this.store.put("profile", profile);
    return profile;
  }
  async profile(): Promise<Profile> {
    const v = await this.store.get<Profile>("profile");
    if (!v)
      throw new SuiteError("LOGIN_REQUIRED", "Sign in to Learning MCP.", 401);
    return v;
  }
  async usage(): Promise<UsageAcceptance | null> {
    return (await this.store.get<UsageAcceptance>("usage")) ?? null;
  }
  async acceptUsage(version: unknown) {
    await this.profile();
    if (version !== USAGE_VERSION)
      throw new SuiteError(
        "USAGE_REQUIRED",
        "Review the current usage notice.",
        403,
      );
    const acceptance = {
      version: USAGE_VERSION,
      terms_version: USAGE_VERSION,
      accepted_at: this.now(),
    };
    await this.store.put("usage", acceptance);
    return acceptance;
  }
  async requireUsage() {
    const acceptance = await this.usage();
    if (
      acceptance?.version !== USAGE_VERSION ||
      acceptance.terms_version !== USAGE_VERSION
    )
      throw new SuiteError(
        "USAGE_REQUIRED",
        "Read and accept the usage notice on the account page.",
        403,
      );
  }
  async approve(
    client: { id: string; name: string; redirect_uri: string },
    scopes: string[],
  ) {
    await this.profile();
    await this.requireUsage();
    if (
      !scopes.includes(READ_SCOPE) ||
      scopes.some(
        (s) => ![READ_SCOPE, MANAGE_SCOPE, "offline_access"].includes(s),
      )
    )
      throw new SuiteError("INVALID_SCOPE", "Unsupported permission.");
    const authorizedAt = this.now();
    const grant: Grant = {
      id: randomToken(),
      account_id: this.account,
      client_id: client.id,
      client_name: client.name,
      redirect_uri: client.redirect_uri,
      scopes,
      authorized_at: authorizedAt,
      expires_at: authorizedAt + 30 * 86400_000,
      revoked: false,
    };
    await this.store.put(`grant:${grant.id}`, grant);
    return grant;
  }
  async authorize(
    account: string,
    id: string,
    client: string,
    scopes: readonly string[],
  ) {
    const grant = await this.store.get<Grant>(`grant:${id}`);
    if (
      !grant ||
      account !== this.account ||
      grant.account_id !== account ||
      grant.client_id !== client ||
      grant.revoked ||
      grant.expires_at <= this.now() ||
      !scopes.includes(READ_SCOPE) ||
      scopes.some((s) => !grant.scopes.includes(s))
    )
      throw new SuiteError(
        "ACCESS_DENIED",
        "Client authorization is missing, expired or revoked.",
        403,
      );
    await this.requireUsage();
    return grant;
  }
  async grants() {
    return {
      grants: [
        ...(await this.store.list<Grant>({ prefix: "grant:" })).values(),
      ],
    };
  }
  async revoke(id?: string) {
    for (const [k, v] of await this.store.list<Grant>({ prefix: "grant:" }))
      if (!id || v.id === id) await this.store.put(k, { ...v, revoked: true });
    return { ok: true };
  }
  async putConnection(input: unknown) {
    const v = connectionSchema.parse(input);
    const record = await encrypt(this.key, `${this.account}:ed:v1`, v);
    await this.store.transaction(async (store) => {
      const old = await store.get<EncryptedRecord>("connection:ed");
      const previous = old
        ? await decrypt<Connection>(this.key, `${this.account}:ed:v1`, old)
        : undefined;
      await store.put("connection:ed", record);
      if (previous?.profile_id !== v.profile_id)
        await this.invalidateOn(store, "ed");
    });
    return { ok: true };
  }
  async getConnection(): Promise<Connection> {
    const v = await this.store.get<EncryptedRecord>("connection:ed");
    if (!v)
      throw new SuiteError(
        "PLATFORM_NOT_CONNECTED",
        "Connect Ed on the account page.",
        409,
      );
    return decrypt(this.key, `${this.account}:ed:v1`, v);
  }
  async disconnect(platform: string) {
    await this.store.transaction(async (store) => {
      await store.delete(`connection:${platform}`);
      await this.invalidateOn(store, platform);
    });
    return { ok: true };
  }
  async invalidatePlatform(platform: string) {
    return this.store.transaction((store) =>
      this.invalidateOn(store, platform),
    );
  }
  private async invalidateOn(store: Store, platform: string) {
    await store.delete("discovery");
    const units = (await store.get<Unit[]>("units")) ?? [];
    const names =
      platform === "ed"
        ? ["ed_course_id"]
        : platform === "moodle"
          ? ["moodle_course_id"]
          : ["ontrack_unit_id", "ontrack_project_id"];
    const cleaned = units
      .map((u) => {
        const row = { ...u } as Record<string, unknown>;
        for (const n of names) delete row[n];
        return row as unknown as Unit;
      })
      .filter(
        (u) => u.ed_course_id || u.moodle_course_id || u.ontrack_project_id,
      );
    await store.put("units", cleaned);
  }
  async units(): Promise<Unit[]> {
    return (await this.store.get<Unit[]>("units")) ?? [];
  }
  async bind(input: unknown) {
    const units = parseUnits([input]),
      unit = units[0]!;
    return this.store.transaction(async (store) => {
      const discovery = await store.get<Discovery>("discovery");
      if (!discovery || discovery.expires_at <= this.now())
        throw new SuiteError(
          "DISCOVERY_REQUIRED",
          "Refresh enrolled courses before confirming a mapping.",
          409,
        );
      const preview = validateCourseBinding(unit, discovery);
      const current = ((await store.get<Unit[]>("units")) ?? []).filter(
        (u) => u.key !== unit.key,
      );
      parseUnits([...current, unit]);
      await store.put("units", [...current, unit]);
      return { unit, sources: preview.sources, warnings: preview.warnings };
    });
  }
  async previewBindings(input: unknown) {
    const courses = parseUnits(input);
    return this.store.transaction(async (store) => {
      const discovery = await store.get<Discovery>("discovery");
      if (!discovery || discovery.expires_at <= this.now())
        throw new SuiteError(
          "DISCOVERY_REQUIRED",
          "Refresh enrolled courses before reviewing mappings.",
          409,
        );
      const current = (await store.get<Unit[]>("units")) ?? [];
      const plan = planCourseBindings(current, courses, discovery);
      const preview_id = randomToken();
      const key = `binding-preview:${await digest(preview_id)}`;
      const expires_at = Math.min(discovery.expires_at, this.now() + 600_000);
      const value = {
        courses,
        registry: await digest(JSON.stringify(current)),
        discovery: await digest(JSON.stringify(discovery.courses)),
      };
      await store.put(key, {
        expires_at,
        record: await encrypt(this.key, `${this.account}:${key}`, value),
      });
      return {
        preview_id,
        expires_at,
        needs_confirmation: true,
        courses: plan.previews,
        existing_changes: plan.existing_changes,
        message:
          "Review all course selections and existing changes, then confirm this preview. No mappings have changed.",
      };
    });
  }
  async confirmBindings(input: unknown) {
    const preview_id = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(input);
    const key = `binding-preview:${await digest(preview_id)}`;
    return this.store.transaction(async (store) => {
      const draft = await store.get<{
        expires_at: number;
        record: EncryptedRecord;
      }>(key);
      if (!draft || draft.expires_at <= this.now())
        throw new SuiteError(
          "BINDING_PREVIEW_EXPIRED",
          "Create a fresh binding preview. No mappings have changed.",
          409,
        );
      const value = await decrypt<{
        courses: Unit[];
        registry: string;
        discovery: string;
        receipt?: {
          courses: Unit[];
          saved: number;
          existing_changes: unknown[];
        };
      }>(this.key, `${this.account}:${key}`, draft.record);
      if (value.receipt) return { ...value.receipt, already_confirmed: true };
      const discovery = await store.get<Discovery>("discovery");
      const current = (await store.get<Unit[]>("units")) ?? [];
      if (
        !discovery ||
        discovery.expires_at <= this.now() ||
        (await digest(JSON.stringify(discovery.courses))) !== value.discovery ||
        (await digest(JSON.stringify(current))) !== value.registry
      )
        throw new SuiteError(
          "BINDING_PREVIEW_CHANGED",
          "Courses or mappings changed. Review a fresh preview before confirming; no mappings have changed.",
          409,
        );
      const courses = parseUnits(value.courses);
      const plan = planCourseBindings(current, courses, discovery);
      await store.put("units", plan.units);
      const receipt = {
        courses,
        existing_changes: plan.existing_changes,
        saved: courses.length,
      };
      // A network retry returns the original result without committing the batch again.
      await store.put(key, {
        expires_at: this.now() + 600_000,
        record: await encrypt(this.key, `${this.account}:${key}`, { receipt }),
      });
      return receipt;
    });
  }
  async unbind(key: string) {
    await this.store.transaction(async (store) => {
      await store.put(
        "units",
        ((await store.get<Unit[]>("units")) ?? []).filter((u) => u.key !== key),
      );
    });
    return { ok: true };
  }
  async discovered(value: Discovery) {
    await this.store.put("discovery", value);
    return value;
  }
  async ephemeralPut(key: string, value: unknown, expires_at: number) {
    await this.store.put(key, {
      expires_at,
      record: await encrypt(this.key, `${this.account}:${key}`, value),
    });
    return { ok: true };
  }
  async ephemeralGet<T>(key: string, take = false): Promise<T | undefined> {
    return this.store.transaction(async (s) => {
      const v = await s.get<{ expires_at: number; record: EncryptedRecord }>(
        key,
      );
      if (!v) return undefined;
      if (take || v.expires_at <= this.now()) await s.delete(key);
      return v.expires_at > this.now()
        ? decrypt<T>(this.key, `${this.account}:${key}`, v.record)
        : undefined;
    });
  }
  async cleanup() {
    for (const [k, v] of await this.store.list<{ expires_at?: number }>())
      if (v.expires_at && v.expires_at <= this.now())
        await this.store.delete(k);
  }
}
