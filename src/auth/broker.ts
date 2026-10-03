import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import type { Env } from "../config.ts";
import { publicError, SuiteError } from "../errors.ts";
import { AccountStore, type Profile, type Store } from "./state.ts";
import type { Discovery } from "../accounts/courses.ts";
export class AccountState extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== "POST")
        throw new SuiteError("METHOD_NOT_ALLOWED", "Use POST.", 405);
      const { account, body: v } = z
        .object({
          account: z.string().regex(/^(?:[a-f0-9]{64}|identity)$/),
          body: z.any(),
        })
        .strict()
        .parse(await request.json());
      const state = new AccountStore(
        this.ctx.storage as unknown as Store,
        account,
        this.env.CREDENTIALS_KEY,
      );
      let result: unknown;
      switch (new URL(request.url).pathname) {
        case "/login/rate":
          if (account !== "identity")
            throw new SuiteError(
              "ACCESS_DENIED",
              "Invalid login operation.",
              403,
            );
          z.string()
            .regex(/^loginrate:[a-f0-9]{64}$/)
            .parse(v.key);
          result = await this.ctx.storage.transaction(async (storage) => {
            const previous = await storage.get<{
              count: number;
              expires_at: number;
            }>(v.key);
            const current =
              previous && previous.expires_at > Date.now()
                ? previous
                : { count: 0, expires_at: Date.now() + 600_000 };
            if (current.count >= 20)
              throw new SuiteError(
                "AUTH_RETRY_LATER",
                "Too many sign-in attempts. Try again later.",
                429,
              );
            await storage.put(v.key, { ...current, count: current.count + 1 });
            return { ok: true };
          });
          break;
        case "/profile/put":
          result = await state.putProfile(v as Profile);
          break;
        case "/profile":
          result = await state.profile();
          break;
        case "/usage":
          result = await state.usage();
          break;
        case "/usage/accept":
          result = await state.acceptUsage(v.version);
          break;
        case "/usage/check":
          await state.requireUsage();
          result = { ok: true };
          break;
        case "/approve":
          result = await state.approve(v.client, v.scopes);
          break;
        case "/authorize":
          result = await state.authorize(
            account,
            v.grant_id,
            v.client_id,
            v.scopes,
          );
          break;
        case "/grants":
          result = await state.grants();
          break;
        case "/revoke":
          result = await state.revoke(v.grant_id);
          break;
        case "/units":
          result = { units: await state.units() };
          break;
        case "/bind":
          result = await state.bind(v);
          break;
        case "/unbind":
          result = await state.unbind(z.string().min(1).max(100).parse(v.key));
          break;
        case "/discovery/get":
          result = (await this.ctx.storage.get("discovery")) ?? null;
          break;
        case "/discovery":
          result = await state.discovered(v as Discovery);
          break;
        case "/connection/put":
          result = await state.putConnection(v);
          break;
        case "/connection/get":
          result = await state.getConnection();
          break;
        case "/disconnect":
          result = await state.disconnect(
            z.enum(["ed", "moodle", "ontrack"]).parse(v.platform),
          );
          break;
        case "/ephemeral/put":
          validateKey(v.key);
          result = await state.ephemeralPut(
            v.key,
            v.value,
            z.number().int().parse(v.expires_at),
          );
          break;
        case "/ephemeral/get":
          validateKey(v.key);
          result = (await state.ephemeralGet(v.key, Boolean(v.take))) ?? null;
          break;
        case "/ephemeral/delete":
          validateKey(v.key);
          await this.ctx.storage.delete(v.key);
          result = { ok: true };
          break;
        default:
          throw new SuiteError("NOT_FOUND", "Unknown account operation.", 404);
      }
      await this.ctx.storage.setAlarm(Date.now() + 600_000);
      return Response.json(result, {
        headers: { "cache-control": "no-store" },
      });
    } catch (error) {
      return Response.json(publicError(error), {
        status: error instanceof SuiteError ? error.status : 400,
      });
    }
  }
  async alarm() {
    await new AccountStore(
      this.ctx.storage as unknown as Store,
      "identity",
      this.env.CREDENTIALS_KEY,
    ).cleanup();
  }
}
function validateKey(key: unknown) {
  z.string()
    .regex(/^(?:login|session|consent|connect):[a-f0-9]{64}$/)
    .parse(key);
}
