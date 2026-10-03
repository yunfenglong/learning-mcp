import type { Env } from "../config.ts";
import { equalSecret } from "../auth/crypto.ts";
import { stateCall } from "../auth/client.ts";
import { SuiteError } from "../errors.ts";
import { json } from "./common.ts";
import { z } from "zod";
import { OutputBoundary } from "../security/output.ts";
export async function admin(request: Request, env: Env) {
  const token =
    request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1] ?? "";
  if (
    !env.ADMIN_TOKEN ||
    env.ADMIN_TOKEN.length < 32 ||
    !(await equalSecret(token, env.ADMIN_TOKEN))
  )
    throw new SuiteError(
      "UNAUTHORIZED",
      "Administrator authentication required.",
      401,
    );
  if (request.headers.has("origin"))
    throw new SuiteError("INVALID_ORIGIN", "Use private administration.", 403);
  if (request.method !== "POST")
    throw new SuiteError("METHOD_NOT_ALLOWED", "Use POST.", 405);
  const v = z
    .object({
      account_id: z.string().regex(/^[a-f0-9]{64}$/),
      grant_id: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .strict()
    .parse(await request.json());
  const path = new URL(request.url).pathname;
  if (!["/admin/grants", "/admin/revoke"].includes(path))
    throw new SuiteError("NOT_FOUND", "Unknown administration route.", 404);
  const output = new OutputBoundary();
  output.remember(
    env.ADMIN_TOKEN,
    env.CREDENTIALS_KEY,
    env.BROKER_SERVICE_TOKEN,
    env.OIDC_CLIENT_SECRET,
  );
  return json(
    output.redact(
      await stateCall(
        env,
        v.account_id,
        path === "/admin/grants" ? "/grants" : "/revoke",
        { grant_id: v.grant_id },
      ),
    ),
  );
}
