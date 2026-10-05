import { describe, expect, it } from "vitest";
import { parse } from "node-html-parser";
import { clientAccess } from "../src/http/client-access.ts";
import type { Grant } from "../src/auth/state.ts";
const grant: Grant = {
  id: "grant-1",
  account_id: "a".repeat(64),
  client_id: "client-1",
  client_name: "My client",
  redirect_uri: "https://client.example/callback",
  scopes: ["learning:read", "learning:bindings", "offline_access"],
  revoked: false,
  authorized_at: Date.UTC(2026, 9, 5, 7, 30),
  expires_at: Date.UTC(2026, 10, 4, 7, 30),
};
describe("client access record", () => {
  it("shows recorded authorization and expiry, permission meanings, and identifiers without changing revocation", () => {
    const page = parse(clientAccess(grant, "csrf-value"));
    expect(
      page
        .querySelectorAll("time")
        .map((time) => time.getAttribute("datetime")),
    ).toEqual(["2026-10-05T07:30:00.000Z", "2026-11-04T07:30:00.000Z"]);
    expect(page.textContent).toContain("UTC");
    expect(page.textContent).toContain(
      "Manage platform connections & course links",
    );
    expect(page.textContent).toContain("Keep access between client sessions");
    expect(page.querySelector("details")?.hasAttribute("open")).toBe(false);
    expect(page.textContent).toContain(grant.client_id);
    expect(page.textContent).toContain(grant.redirect_uri);
    expect(
      page
        .querySelector('form[action="/account/revoke"] input[name="csrf"]')
        ?.getAttribute("value"),
    ).toBe("csrf-value");
    expect(
      page.querySelector('input[name="grant_id"]')?.getAttribute("value"),
    ).toBe(grant.id);
  });
  it("does not invent dates for legacy grants and escapes client-provided text", () => {
    const content = clientAccess(
      {
        ...grant,
        authorized_at: undefined,
        client_name: "<script>bad</script>",
        client_id: "<img src=x>",
        redirect_uri: 'https://client.example/"<img>',
      },
      "csrf-value",
    );
    expect(content).toContain("Not recorded");
    expect(parse(content).querySelectorAll("time")).toHaveLength(1);
    expect(content).not.toContain("<script>");
    expect(content).not.toContain("<img");
    expect(content).toContain("&lt;script&gt;bad&lt;/script&gt;");
  });
});
