import { z } from "zod";
import type { Env } from "../config.ts";
import { SuiteError } from "../errors.ts";
import { cookiesSchema } from "./session-cookies.ts";
import { platformBaseLink } from "./base-link.ts";
const site = z.string().transform(platformBaseLink).optional();
const secret = z
  .string()
  .min(1)
  .max(16000)
  .refine((v) => !/[\r\n;]/.test(v));
export const moodleSessionSchema = z
  .object({
    cookie_name: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    cookie_value: secret,
    cookies: cookiesSchema.optional(),
    sesskey: secret,
    userid: z.number().int().positive(),
    profile_id: z.string().min(1),
    display_name: z.string().optional(),
    site_url: site,
  })
  .strict();
export const ontrackProfileSchema = z.object({
  id: z.number().int().positive().nullable(),
  username: z.string().max(200).nullable(),
  first_name: z.string().max(500).nullable(),
  last_name: z.string().max(500).nullable(),
  email: z.string().max(500).nullable(),
  nickname: z.string().max(500).nullable(),
});
export function ontrackProfile(data: Record<string, unknown>) {
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return ontrackProfileSchema.parse({
    id: typeof data.id === "number" ? data.id : null,
    username: text(data.username),
    first_name: text(data.first_name ?? data.firstName),
    last_name: text(data.last_name ?? data.lastName),
    email: text(data.email),
    nickname: text(data.nickname),
  });
}
export const ontrackSessionSchema = z
  .object({
    username: secret,
    token: secret,
    user: ontrackProfileSchema.optional(),
    expires_at: z.string().datetime().optional(),
    profile_id: z.string().min(1),
    display_name: z.string().optional(),
    site_url: site,
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
      signal: AbortSignal.timeout(120000),
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
