import {
  writeCapabilities,
  type WriteArgs,
} from "../capabilities/write/index.ts";
import { resolveUnit } from "../domain/units.ts";
import { SuiteError } from "../errors.ts";
import type { StagedFile, WriteOwner } from "./write-store.ts";
import { z } from "zod";
import { platformConfigSchema, type Config, type Env } from "../config.ts";
import type { Platform, Unit } from "../domain/units.ts";
import type { Profile, Connection } from "../auth/state.ts";
import { stateCall, globalCall } from "../auth/client.ts";
import { digest, randomToken } from "../auth/crypto.ts";
import { brokerCall } from "../platforms/broker.ts";
import { DirectBackend } from "../platforms/direct.ts";
import { discover } from "./courses.ts";
import upstreams from "../../vendor/upstreams.json";
import { OutputBoundary } from "../security/output.ts";
export class AccountService {
  readonly output = new OutputBoundary();
  readonly backends: Record<Platform, DirectBackend>;
  constructor(
    readonly env: Env,
    readonly profile: Profile,
    readonly config: Config,
  ) {
    this.output.remember(
      env.CREDENTIALS_KEY,
      env.BROKER_SERVICE_TOKEN,
      env.ADMIN_TOKEN,
    );
    this.backends = {
      ed: new DirectBackend(
        env,
        profile.id,
        "ed",
        config,
        globalThis.fetch,
        this.output,
      ),
      moodle: new DirectBackend(
        env,
        profile.id,
        "moodle",
        config,
        globalThis.fetch,
        this.output,
      ),
      ontrack: new DirectBackend(
        env,
        profile.id,
        "ontrack",
        config,
        globalThis.fetch,
        this.output,
      ),
    };
  }
  async loadSites() {
    const sites = z
      .object({
        moodle: platformConfigSchema.optional(),
        ontrack: platformConfigSchema.optional(),
      })
      .strict()
      .parse(await brokerCall(this.env, this.profile.id, "/v1/sites"));
    delete this.config.platforms.moodle;
    delete this.config.platforms.ontrack;
    Object.assign(this.config.platforms, sites);
  }
  async status() {
    let ed: unknown = { platform: "ed", status: "not_connected" };
    try {
      const c = await stateCall<Connection>(
        this.env,
        this.profile.id,
        "/connection/get",
      );
      ed = {
        platform: "ed",
        status: "connected",
        display_name: c.display_name,
      };
      this.output.rememberSession(c);
    } catch {
      /* Missing connection. */
    }
    let platforms: unknown;
    try {
      const status = z.object({
        status: z.enum(["connected", "not_connected", "unavailable"]),
        display_name: z.string().max(200).optional(),
        profile_id: z.string().max(200).optional(),
        site_url: z.string().optional(),
      });
      platforms = z
        .object({
          moodle: status,
          ontrack: status,
          auth_modes: z.array(z.enum(["session", "sso"])).optional(),
          has_sso: z.boolean().optional(),
        })
        .parse(await brokerCall(this.env, this.profile.id, "/v1/status"));
    } catch {
      platforms = {
        moodle: { status: "unavailable" },
        ontrack: { status: "unavailable" },
      };
    }
    return this.output.redact({ ed, platforms });
  }
  async start(platform: Platform) {
    const ticket = randomToken();
    await globalCall(this.env, "/ephemeral/put", {
      key: `connect:${await digest(ticket)}`,
      value: { account: this.profile.id, platform },
      expires_at: Date.now() + 600_000,
    });
    return {
      url: `${this.config.issuer}/landing?ticket=${ticket}`,
      expires_in: 600,
      requires_user_sign_in: true,
    };
  }
  async discover() {
    await this.loadSites();
    const v = await discover(this.config, this.backends);
    return stateCall(this.env, this.profile.id, "/discovery", v);
  }
  async bind(unit: Unit) {
    return stateCall(this.env, this.profile.id, "/bind", unit);
  }
  async previewBindings(courses: Unit[]) {
    return stateCall(this.env, this.profile.id, "/bindings/preview", {
      courses,
    });
  }
  async confirmBindings(preview_id: string) {
    return stateCall(this.env, this.profile.id, "/bindings/confirm", {
      preview_id,
    });
  }
  async unbind(key: string) {
    return stateCall(this.env, this.profile.id, "/unbind", { key });
  }
  async disconnect(platform: Platform) {
    if (platform !== "ed")
      await brokerCall(this.env, this.profile.id, "/v1/disconnect", {
        platform,
      });
    return stateCall(this.env, this.profile.id, "/disconnect", { platform });
  }
  async upload(
    owner: WriteOwner,
    operation: "start" | "chunk" | "finish" | "cancel",
    args: unknown,
  ) {
    return stateCall(this.env, this.profile.id, `/writes/upload/${operation}`, {
      owner,
      ...(operation === "start" || operation === "chunk"
        ? { input: args }
        : (args as object)),
    });
  }
  private async staged(
    owner: WriteOwner,
    ids: string[] = [],
  ): Promise<StagedFile[]> {
    if (!ids.length) return [];
    const files = await stateCall<
      Array<Omit<StagedFile, "bytes"> & { bytes: string }>
    >(this.env, this.profile.id, "/writes/upload/files", { owner, ids });
    return files.map((f) => ({
      ...f,
      bytes: Uint8Array.from(atob(f.bytes), (c) => c.charCodeAt(0)),
    }));
  }
  async previewWrite(
    owner: WriteOwner,
    platform: Platform,
    operation: string,
    input: unknown,
  ) {
    const capability = writeCapabilities.find(
      (c) => c.platform === platform && c.operation === operation,
    );
    if (!capability)
      throw new SuiteError("TOOL_NOT_ALLOWED", "Unsupported beta write.", 403);
    const args = capability.input.parse(input) as WriteArgs;
    const unit = resolveUnit(this.config.units, String(args.unit));
    const files = await this.staged(owner, args.upload_ids);
    const prepared = await this.backends[platform].prepareWrite(
      operation,
      args,
      unit,
      files,
    );
    const preview = await stateCall<Record<string, unknown>>(
      this.env,
      this.profile.id,
      "/writes/preview",
      {
        owner,
        payload: {
          platform,
          operation,
          args,
          unit,
          fingerprint: prepared.fingerprint,
        },
      },
    );
    return { ...preview, beta: true, plan: prepared.plan };
  }
  async confirmWrite(owner: WriteOwner, preview_id: string) {
    const claimed = await stateCall<{
      duplicate: boolean;
      receipt?: unknown;
      payload?: {
        platform: Platform;
        operation: string;
        args: WriteArgs;
        unit: Unit;
        fingerprint: string;
      };
    }>(this.env, this.profile.id, "/writes/claim", { owner, preview_id });
    if (claimed.duplicate)
      return { receipt: claimed.receipt, already_executed: true };
    const payload = claimed.payload!;
    try {
      const unit = resolveUnit(this.config.units, payload.unit.key);
      if (JSON.stringify(unit) !== JSON.stringify(payload.unit))
        throw new SuiteError(
          "WRITE_PREVIEW_CHANGED",
          "The course binding changed. Review a fresh preview.",
          409,
        );
      const files = await this.staged(owner, payload.args.upload_ids);
      const prepared = await this.backends[payload.platform].prepareWrite(
        payload.operation,
        payload.args,
        unit,
        files,
      );
      if (prepared.fingerprint !== payload.fingerprint)
        throw new SuiteError(
          "WRITE_PREVIEW_CHANGED",
          "The platform state changed. Review a fresh preview before executing.",
          409,
        );
      if (prepared.plan.requirements?.length)
        throw new SuiteError(
          "WRITE_ACCEPTANCE_REQUIRED",
          "Review the preview and prepare it again with the required final-submission or declaration acceptance options.",
          409,
        );
      // Preflight can await network calls; reload mappings before the mutation.
      const { units: freshUnits } = await stateCall<{ units: Unit[] }>(
        this.env,
        this.profile.id,
        "/units",
      );
      const currentUnit = freshUnits.find((v) => v.key === unit.key);
      if (!currentUnit || JSON.stringify(currentUnit) !== JSON.stringify(unit))
        throw new SuiteError(
          "WRITE_PREVIEW_CHANGED",
          "The course binding changed. Review a fresh preview.",
          409,
        );
      // Recheck the live grant after preflight and immediately before the mutation.
      await stateCall(this.env, this.profile.id, "/authorize", {
        ...owner,
        scopes: ["learning:read", "learning:write"],
      });
      let receipt: unknown;
      try {
        receipt = this.output.redact(
          await this.backends[payload.platform].executeWrite(
            payload.operation,
            payload.args,
            unit,
            files,
          ),
        );
        await stateCall(this.env, this.profile.id, "/writes/result", {
          owner,
          preview_id,
          receipt,
          success: true,
        });
      } catch {
        throw new SuiteError(
          "WRITE_OUTCOME_UNCERTAIN",
          "A write step may have executed. Check the platform before preparing another write; this preview will not execute again.",
          409,
        );
      }
      return { receipt, beta: true };
    } catch (error) {
      await stateCall(this.env, this.profile.id, "/writes/result", {
        owner,
        preview_id,
        receipt: {
          status: "not_repeated",
          message: "Check the platform before preparing a new write.",
        },
        success: false,
      }).catch(() => {});
      throw error;
    }
  }
  versions() {
    return {
      suite: "0.4.0-beta.1",
      upstreams: Object.fromEntries(
        Object.entries(upstreams).map(([k, v]) => [
          k,
          { version: v.version, sha: v.sha, repository: v.repository },
        ]),
      ),
    };
  }
}
