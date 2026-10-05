import { EdClient } from "../../vendor/ed/client.js";
import { MoodleClientCore } from "../../vendor/moodle/client.js";
import { OnTrackClient, HttpClient } from "../../vendor/ontrack/client.js";
import type { Config, Env } from "../config.ts";
import type { Platform } from "../domain/units.ts";
import { stateCall } from "../auth/client.ts";
import type { Connection } from "../auth/state.ts";
import { SuiteError } from "../errors.ts";
import { platformFetch, platformFileFetch } from "./network.ts";
import { resourceOriginAllowed } from "./resource-origins.ts";
import { isMoodleFileRequest, fetchMoodleFile } from "./read/moodle-files.ts";
import type {
  EdReadArgs,
  MoodleReadArgs,
  OnTrackReadArgs,
  EdOperation,
  MoodleOperation,
  OnTrackOperation,
} from "./read/contracts.ts";
import { platformOperations } from "../capabilities/index.ts";
import { MAX_FILE_BYTES } from "./read/files.ts";
import { edRead } from "./read/ed.ts";
import { moodleRead } from "./read/moodle.ts";
import { ontrackJson } from "./read/ontrack-json.ts";
import { ontrackRead } from "./read/ontrack.ts";
import {
  brokerCall,
  moodleSessionSchema,
  ontrackSessionSchema,
  type MoodleSession,
} from "./broker.ts";
import {
  cookieFetch,
  cookieMatches,
  sessionCookies,
} from "./session-cookies.ts";
import { object, rows, type Backend } from "../adapters/backend.ts";
import { OutputBoundary } from "../security/output.ts";
import { PlatformReadBoundary } from "./read/error.ts";
interface PlatformClient {
  ed: EdClient;
  moodle: MoodleClientCore;
  ontrack: OnTrackClient;
}
export class DirectBackend implements Backend {
  private readonly reads: PlatformReadBoundary;
  private client?: Promise<EdClient | MoodleClientCore | OnTrackClient>;
  private edInstitution = new Map<number, boolean>();
  private moodleSessionExpired?: SuiteError;
  private ontrackSessionExpired = false;
  private authenticationFailure?: SuiteError;
  private platformUsername?: string;
  private async renew(platform: "moodle" | "ontrack") {
    try {
      const value = await brokerCall(this.env, this.account, "/v1/renew", {
        platform,
        expected_base_link: this.config.platforms[platform]?.site_url,
      });
      this.output.rememberSession(value);
      return value;
    } catch (error) {
      if (error instanceof SuiteError) this.authenticationFailure = error;
      throw error;
    }
  }
  constructor(
    private readonly env: Env,
    readonly account: string,
    readonly platform: Platform,
    private readonly config: Config,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly output = new OutputBoundary(),
  ) {
    this.reads = new PlatformReadBoundary(platform);
  }
  private async connect() {
    const site = this.config.platforms[this.platform]?.site_url;
    if (!site)
      throw new SuiteError(
        "PLATFORM_NOT_CONNECTED",
        `Connect ${this.platform} and enter its base link on your account page.`,
        409,
      );
    if (this.platform === "ed") {
      const c = await stateCall<Connection>(
        this.env,
        this.account,
        "/connection/get",
      );
      this.output.rememberSession(c);
      const client = new EdClient({
        token: c.token,
        apiBaseUrl: "https://edstem.org/api/",
        fetch: this.reads.fetch(async (input, init) => {
          const target = new URL(String(input));
          const resource = target.origin !== "https://edstem.org";
          if (
            resource &&
            !resourceOriginAllowed(target, this.config.resourceOrigins ?? [])
          )
            throw new SuiteError(
              "RESOURCE_ORIGIN_NOT_ALLOWED",
              "This Ed file destination is outside the configured RESOURCE_ORIGINS rules.",
              403,
            );
          if (
            resource &&
            (new Headers(init?.headers).has("authorization") ||
              new Headers(init?.headers).has("cookie"))
          )
            throw new SuiteError(
              "SITE_NOT_ALLOWED",
              "Credentials cannot be sent to file resource origins.",
              403,
            );
          const response = await platformFetch(
            resource ? target.origin : "https://edstem.org",
            this.fetchImpl,
            false,
            resource ? MAX_FILE_BYTES : undefined,
          )(input, init);
          if (new URL(String(input)).pathname === "/api/user" && response.ok) {
            const data = object(await response.clone().json());
            for (const entry of rows(data, "courses")) {
              const row = object(entry.course ?? entry);
              const institution = object(
                row.university ?? row.institution ?? {},
              );
              const institutionId = Number(
                row.university_id ?? row.institution_id ?? institution.id,
              );
              const allowed = this.config.platforms.ed?.institution_ids;
              this.edInstitution.set(
                Number(row.id),
                !allowed?.length || allowed.includes(institutionId),
              );
            }
          }
          return response;
        }),
        maxRetries: 1,
      });
      const user = object(object(await client.fetchUser()).user);
      if (String(user.id) !== c.profile_id)
        throw new SuiteError(
          "ACCOUNT_CHANGED",
          "Reconnect Ed to confirm this account.",
          409,
        );
      return client;
    }
    if (this.platform === "moodle") {
      const c = moodleSessionSchema.parse(
        await brokerCall(this.env, this.account, "/v1/session", {
          platform: "moodle",
          expected_base_link: site,
        }),
      );
      const session = { current: c };
      this.output.rememberSession(c);
      const fetchImpl = this.moodleFetch(site, session);
      const context = (value: MoodleSession) => ({
        sesskey: value.sesskey,
        user_info: {
          userid: value.userid,
          siteurl: site,
          sitename: "",
          fullname: value.display_name || `Moodle user ${value.userid}`,
          username: "",
          firstname: "",
          lastname: "",
          email: "",
        },
      });
      const client = new MoodleClientCore(site, {
        cookie: { name: c.cookie_name, value: c.cookie_value },
        pageContext: context(c),
        fetchImpl,
        onLoginRequired: async () => {
          const refreshed = moodleSessionSchema.parse(
            await this.renew("moodle"),
          );
          if (refreshed.profile_id !== c.profile_id)
            throw new SuiteError(
              "ACCOUNT_CHANGED",
              "Reconnect the platform to confirm this account.",
              409,
            );
          session.current = refreshed;
          return {
            cookie: {
              name: refreshed.cookie_name,
              value: refreshed.cookie_value,
            },
            pageContext: context(refreshed),
          };
        },
      });
      const user = await client.getSiteInfo();
      if (String(user.userid) !== c.profile_id)
        throw new SuiteError(
          "ACCOUNT_CHANGED",
          "Reconnect Moodle to confirm this account.",
          409,
        );
      return client;
    }
    const c = ontrackSessionSchema.parse(
      await brokerCall(this.env, this.account, "/v1/session", {
        platform: "ontrack",
        expected_base_link: site,
      }),
    );
    this.output.rememberSession(c);
    this.platformUsername = c.username;
    return new OnTrackClient(
      new HttpClient({
        baseUrl: site,
        credentials: { username: c.username, accessToken: c.token },
        fetch: this.reads.fetch(async (input, init) => {
          const response = await platformFetch(
            site,
            this.fetchImpl,
            false,
            MAX_FILE_BYTES,
          )(input, init);
          if (response.status === 401) this.ontrackSessionExpired = true;
          return response;
        }),
        refresh: async () => {
          const v = ontrackSessionSchema.parse(await this.renew("ontrack"));
          if (v.profile_id !== c.profile_id)
            throw new SuiteError(
              "ACCOUNT_CHANGED",
              "Reconnect OnTrack to confirm this account.",
              409,
            );
          return { username: v.username, accessToken: v.token };
        },
      }),
    );
  }
  async api<P extends Platform>(platform: P): Promise<PlatformClient[P]> {
    if (platform !== this.platform)
      throw new SuiteError(
        "TOOL_NOT_ALLOWED",
        "Client platform mismatch.",
        403,
      );
    // The discriminant is checked here; callers never receive another platform's client.
    return (this.client ??= this.connect()) as Promise<PlatformClient[P]>;
  }
  private moodleFetch(
    site: string,
    session: { current: MoodleSession },
  ): typeof fetch {
    const apiNetwork = platformFetch(
      site,
      this.fetchImpl,
      true,
      MAX_FILE_BYTES,
    );
    const fileNetwork = platformFileFetch(site, this.fetchImpl, MAX_FILE_BYTES);
    const network: typeof fetch = (input, init) =>
      (isMoodleFileRequest(input, init) ? fileNetwork : apiNetwork)(
        input,
        init,
      );
    let active = session.current;
    const makeJar = () =>
      cookieFetch(
        site,
        sessionCookies(site, session.current),
        network,
        async (cookies, sent) => {
          const primary = cookies.find(
            (c) =>
              c.name === session.current.cookie_name &&
              cookieMatches(c, `${site}/lib/ajax/service.php`),
          );
          const expected = sent.find(
            (c) =>
              c.name === session.current.cookie_name &&
              cookieMatches(c, `${site}/lib/ajax/service.php`),
          );
          const result = await brokerCall<{ ok: boolean }>(
            this.env,
            this.account,
            "/v1/cookies",
            {
              platform: "moodle",
              expected_base_link: site,
              expected_cookie_value:
                expected?.value ?? session.current.cookie_value,
              cookies,
            },
          );
          if (!result.ok) {
            session.current = moodleSessionSchema.parse(
              await brokerCall(this.env, this.account, "/v1/session", {
                platform: "moodle",
              }),
            );
            this.output.rememberSession(session.current);
            return false;
          }
          if (primary) {
            session.current = {
              ...session.current,
              cookie_value: primary.value,
              cookies,
            };
            active = session.current;
            this.output.rememberSession(session.current);
          }
        },
      );
    let jar = makeJar();
    return this.reads.fetch(async (input, init) => {
      try {
        if (active !== session.current) {
          active = session.current;
          jar = makeJar();
        }
        return await (isMoodleFileRequest(input, init)
          ? fetchMoodleFile(
              site,
              input,
              init,
              jar.fetch,
              this.fetchImpl,
              this.config.resourceOrigins ?? [],
            )
          : jar.fetch(input, init));
      } catch (error) {
        // Moodle's upstream transport wraps fetch errors. Preserve the session signal separately.
        if (
          error instanceof SuiteError &&
          error.code === "PLATFORM_SESSION_EXPIRED"
        )
          this.moodleSessionExpired = error;
        throw error;
      }
    });
  }
  async call(name: string, a: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.reads.run(() => this.execute(name, a));
    } catch (error) {
      // Vendor transports may wrap callback failures; retain the broker's actionable error.
      if (this.authenticationFailure) {
        const failure = this.authenticationFailure;
        this.authenticationFailure = undefined;
        this.moodleSessionExpired = undefined;
        this.ontrackSessionExpired = false;
        throw failure;
      }
      if (this.platform === "moodle" && this.moodleSessionExpired) {
        this.moodleSessionExpired = undefined;
        await brokerCall(this.env, this.account, "/v1/renew", {
          platform: "moodle",
        });
        this.client = undefined;
        return this.reads.run(() => this.execute(name, a));
      }
      if (this.platform === "ontrack" && this.ontrackSessionExpired) {
        this.ontrackSessionExpired = false;
        await brokerCall(this.env, this.account, "/v1/renew", {
          platform: "ontrack",
        });
        this.client = undefined;
        return this.reads.run(() => this.execute(name, a));
      }
      throw error;
    }
  }
  private async execute(
    name: string,
    a: Record<string, unknown>,
  ): Promise<unknown> {
    const allowed = platformOperations[this.platform];
    if (
      !allowed.has(name) &&
      name !== "list_courses" &&
      !(this.platform === "moodle" && name === "get_user")
    )
      throw new SuiteError(
        "TOOL_NOT_ALLOWED",
        "Only approved platform reads are available.",
        403,
      );
    const context = {
      config: this.config,
      output: this.output,
      enrolled: (id: number) => this.enrolled(id),
      username: this.platformUsername,
      read: <T>(operation: () => Promise<T>) => this.reads.run(operation),
    };
    if (this.platform === "ed") {
      const c = await this.api("ed");
      if (name === "list_courses")
        return (await c.fetchUser()).courses.map((course) => ({
          ...course,
          scope_verified: this.edInstitution.get(course.id) === true,
        }));
      if (platformOperations.ed.has(name))
        return await edRead(name as EdOperation, a as EdReadArgs, {
          ...context,
          client: c,
        });
    } else if (this.platform === "moodle") {
      const c = await this.api("moodle");
      if (name === "get_user") return { user: await c.getSiteInfo() };
      if (name === "list_courses") return await c.getCourses();
      if (platformOperations.moodle.has(name))
        return await moodleRead(name as MoodleOperation, a as MoodleReadArgs, {
          ...context,
          client: c,
        });
    } else {
      const c = await this.api("ontrack");
      if (name === "list_courses") return await c.getProjects(false);
      if (platformOperations.ontrack.has(name))
        return ontrackJson(
          await ontrackRead(name as OnTrackOperation, a as OnTrackReadArgs, {
            ...context,
            client: c,
            username: this.platformUsername,
          }),
        );
    }
    throw new SuiteError(
      "TOOL_NOT_ALLOWED",
      "Only approved platform reads are available.",
      403,
    );
  }
  private async enrolled(id: number) {
    let enrolled: readonly { id: number }[];
    if (this.platform === "ed")
      enrolled = (await (await this.api("ed")).fetchUser()).courses;
    else if (this.platform === "moodle")
      enrolled = await (await this.api("moodle")).getCourses();
    else enrolled = await (await this.api("ontrack")).getProjects(false);
    if (
      !enrolled.some((v) => v.id === id) ||
      (this.platform === "ed" && this.edInstitution.get(id) !== true)
    )
      throw new SuiteError(
        "COURSE_NOT_ACCESSIBLE",
        "This course is no longer enrolled for the connected account.",
        403,
      );
  }
  async close() {}
}
