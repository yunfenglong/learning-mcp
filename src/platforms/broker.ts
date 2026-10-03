import { z } from "zod";
import type { Env } from "../config.ts";
import { SuiteError } from "../errors.ts";
const secret = z
  .string()
  .min(1)
  .max(16000)
  .refine((v) => !/[\r\n;]/.test(v));
export const moodleSessionSchema = z
  .object({
    cookie_name: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    cookie_value: secret,
    sesskey: secret,
    userid: z.number().int().positive(),
    profile_id: z.string().min(1),
    display_name: z.string().optional(),
  })
  .strict();
export const ontrackSessionSchema = z
  .object({
    username: secret,
    token: secret,
    profile_id: z.string().min(1),
    display_name: z.string().optional(),
  })
  .strict();
export type MoodleSession = z.infer<typeof moodleSessionSchema>;
export type OnTrackSession = z.infer<typeof ontrackSessionSchema>;
export async function brokerCall<T>(
  env: Env,
  account: string,
  path: string,
  body: unknown = {},
): Promise<T> {
  if (
    !env.SSO_BROKER ||
    !env.BROKER_SERVICE_TOKEN ||
    env.BROKER_SERVICE_TOKEN.length < 32
  )
    throw new SuiteError(
      "BROKER_NOT_CONFIGURED",
      "Configure the private Okta / SSO broker.",
      503,
    );
  const response = await env.SSO_BROKER.fetch(
    new Request(`https://broker${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.BROKER_SERVICE_TOKEN}`,
        "x-suite-account": account,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    }),
  );
  const v = (await response.json()) as T & { code?: string; message?: string };
  if (!response.ok)
    throw new SuiteError(
      v.code ?? "BROKER_UNAVAILABLE",
      v.message ?? "Reconnect the platform on the account page.",
      response.status,
    );
  return v;
}
