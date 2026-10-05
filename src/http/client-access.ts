import type { Grant } from "../auth/state.ts";
import { escapeHtml as e } from "./common.ts";

const permissions: Record<string, string> = {
  "learning:read": "Read learning materials, discussions & progress",
  "learning:bindings": "Manage platform connections & course links",
  offline_access: "Keep access between client sessions",
};
function timestamp(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "Not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not recorded";
  const label = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(date);
  return `<time datetime="${date.toISOString()}">${e(label)} UTC</time>`;
}

/** Render only recorded grant details. Legacy grants have no authorization time. */
export function clientAccess(grant: Grant, csrf: string) {
  return `<article class="client-file"><div class="client-file-heading"><h3>${e(grant.client_name)}</h3><form method="post" action="/account/revoke"><input type="hidden" name="csrf" value="${e(csrf)}"><input type="hidden" name="grant_id" value="${e(grant.id)}"><button class="secondary">Revoke access</button></form></div><dl class="client-facts"><div class="client-permissions"><dt>Permissions</dt><dd><ul>${grant.scopes.map((scope) => `<li>${e(permissions[scope] ?? scope)}</li>`).join("")}</ul></dd></div><div><dt>Authorized</dt><dd>${timestamp(grant.authorized_at)}</dd></div><div><dt>Access expires</dt><dd>${timestamp(grant.expires_at)}</dd></div></dl><details class="client-details"><summary>Client details</summary><dl class="connection-record"><div><dt>Client ID</dt><dd><code>${e(grant.client_id)}</code></dd></div><div><dt>Authorization callback</dt><dd>${e(grant.redirect_uri)}</dd></div></dl></details></article>`;
}
