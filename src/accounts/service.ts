import { z } from "zod";
import type { Config, Env } from "../config.ts";
import type { Platform, Unit } from "../domain/units.ts";
import type { Profile, Connection } from "../auth/state.ts";
import { stateCall, globalCall } from "../auth/client.ts";
import { digest, randomToken } from "../auth/crypto.ts";
import { brokerCall } from "../platforms/broker.ts";
import { DirectBackend } from "../platforms/direct.ts";
import { discover } from "./courses.ts";
import upstreams from "../../vendor/upstreams.json";
export class AccountService {
  readonly backends: Record<Platform, DirectBackend>;
  constructor(
    readonly env: Env,
    readonly profile: Profile,
    readonly config: Config,
  ) {
    this.backends = {
      ed: new DirectBackend(env, profile.id, "ed", config),
      moodle: new DirectBackend(env, profile.id, "moodle", config),
      ontrack: new DirectBackend(env, profile.id, "ontrack", config),
    };
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
    } catch {
      /* Missing connection. */
    }
    let platforms: unknown;
    try {
      const status = z.object({
        status: z.enum(["connected", "not_connected", "unavailable"]),
        display_name: z.string().max(200).optional(),
        profile_id: z.string().max(200).optional(),
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
    return { ed, platforms };
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
    const v = await discover(this.config, this.backends);
    return stateCall(this.env, this.profile.id, "/discovery", v);
  }
  async bind(unit: Unit) {
    return stateCall(this.env, this.profile.id, "/bind", unit);
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
  versions() {
    return {
      suite: "0.3.0",
      upstreams: Object.fromEntries(
        Object.entries(upstreams).map(([k, v]) => [
          k,
          { version: v.version, sha: v.sha, repository: v.repository },
        ]),
      ),
    };
  }
}
