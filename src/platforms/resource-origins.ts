import { platformBaseLink } from "./base-link.ts";

/** Provider-wide rules, never deployment or institution hostnames. */
export const DEFAULT_RESOURCE_ORIGINS = [
  "https://edusercontent.com",
  "https://*.edusercontent.com",
  "https://*.cloudfront.net",
] as const;

export function parseResourceOrigins(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30)
    throw new Error("Use at most 30 resource origin rules.");
  return [...new Set(value.map(normalizeRule))];
}

function normalizeRule(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Use HTTPS resource origin rules.");
  const text = value.trim();
  const wildcard = /^https:\/\/\*\./i.test(text);
  const base = wildcard ? text.replace(/^https:\/\/\*\./i, "https://") : text;
  if (base.includes("*"))
    throw new Error("Only a leading wildcard DNS label is supported.");
  const url = new URL(platformBaseLink(base));
  if (url.hostname.endsWith("."))
    throw new Error("Use a canonical DNS hostname.");
  if (
    wildcard &&
    !url.hostname
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
  )
    throw new Error("Use a public DNS suffix for wildcard rules.");
  return wildcard ? `https://*.${url.host}` : url.origin;
}

/** Wildcards match complete subdomain labels and the configured HTTPS port, never the apex. */
export function resourceOriginAllowed(
  target: URL | string,
  rules: readonly string[],
): boolean {
  try {
    const url = target instanceof URL ? target : new URL(target);
    if (url.username || url.password || url.hostname.endsWith("."))
      return false;
    const origin = platformBaseLink(url.origin);
    return rules.some((rule) => {
      const normalized = normalizeRule(rule);
      if (!normalized.startsWith("https://*.")) return normalized === origin;
      const base = new URL(normalized.replace("https://*.", "https://"));
      return (
        url.port === base.port && url.hostname.endsWith(`.${base.hostname}`)
      );
    });
  } catch {
    return false;
  }
}
