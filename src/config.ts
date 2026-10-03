import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import type { Platform, Unit } from "./domain/units.ts";
import { SuiteError } from "./errors.ts";
export interface Env {
  OAUTH_KV: KVNamespace;
  AUTH_STATE: DurableObjectNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  ISSUER: string;
  CREDENTIALS_KEY: string;
  ADMIN_TOKEN?: string;
  PLATFORM_CONFIG: string;
  SSO_PROVIDERS?: string;
  SSO_BROKER?: Fetcher;
  BROKER_SERVICE_TOKEN?: string;
}
export const httpsOrigin = z
  .string()
  .url()
  .refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !u.search &&
      u.pathname === "/"
    );
  }, "Use an HTTPS origin.");
export const ssoProvidersSchema = z
  .array(
    z
      .object({
        type: z.literal("okta"),
        origin: httpsOrigin.transform((v) => new URL(v).origin),
      })
      .strict(),
  )
  .max(10);
export type SsoProvider = z.infer<typeof ssoProvidersSchema>[number];
export const platformConfigSchema = z
  .object({
    site_url: httpsOrigin,
    institution_ids: z.array(z.number().int().positive()).max(10).optional(),
  })
  .strict();
export type PlatformConfig = z.infer<typeof platformConfigSchema>;
export interface Config {
  issuer: string;
  units: Unit[];
  platforms: Partial<Record<Platform, PlatformConfig>>;
  ssoProviders?: SsoProvider[];
}
export function loadConfig(env: Env): Config {
  try {
    const issuer = httpsOrigin.parse(env.ISSUER).replace(/\/$/, "");
    const platforms = z
      .object({
        ed: platformConfigSchema.optional(),
        moodle: platformConfigSchema.optional(),
        ontrack: platformConfigSchema.optional(),
      })
      .strict()
      .parse(JSON.parse(env.PLATFORM_CONFIG));
    if (platforms.ed && platforms.ed.site_url !== "https://edstem.org")
      throw new Error("Use the supported Ed API origin");
    return {
      issuer,
      units: [],
      platforms,
      ssoProviders: ssoProvidersSchema.parse(
        JSON.parse(env.SSO_PROVIDERS ?? "[]"),
      ),
    };
  } catch {
    throw new SuiteError(
      "INVALID_CONFIG",
      "Configure the suite HTTPS origin and platform origins.",
      503,
    );
  }
}
