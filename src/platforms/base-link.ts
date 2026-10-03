import { isIP } from "node:net";
import { SuiteError } from "../errors.ts";

/** A user-owned platform destination, supplied only in the authenticated browser flow. */
export function platformBaseLink(value: unknown): string {
  try {
    if (typeof value !== "string" || value.length > 2048) throw new Error();
    const u = new URL(value.trim());
    const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash ||
      !host.includes(".") ||
      isIP(host) ||
      /(?:^|\.)(?:localhost|local|internal|invalid|test|arpa)$/.test(host)
    )
      throw new Error();
    return u.origin;
  } catch {
    throw new SuiteError(
      "INVALID_BASE_LINK",
      "Enter a public HTTPS platform base link, without a path, query, fragment or credentials.",
    );
  }
}
