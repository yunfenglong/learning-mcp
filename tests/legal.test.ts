import { describe, expect, it } from "vitest";
import { loadConfig, type Env } from "../src/config.ts";
import { legalPage } from "../src/http/legal.ts";
import { retentionChoices } from "../src/http/sign-in-fields.ts";

describe("deployment disclosures and retention choices", () => {
  it("escapes public operator configuration and never substitutes repository ownership", async () => {
    const config = loadConfig({
      ISSUER: "https://suite.example",
      LEGAL_CONFIG: JSON.stringify({
        operator_name: '<script>alert("operator")</script>',
        contact_email: "privacy@example.com",
        processing_regions: "<b>Operator-provided region details</b>",
        retention_details: "<b>Operator-provided retention details</b>",
      }),
    } as Env);
    const text = await legalPage(
      new Request("https://suite.example/privacy"),
      config,
    ).text();
    expect(text).not.toContain("<script>");
    expect(text).not.toContain("<b>Operator-provided");
    expect(text).toContain("&lt;script&gt;");
    expect(text).toContain('href="mailto:privacy@example.com"');
    expect(text).toContain("not automatically make someone the operator");
    const missing = await legalPage(
      new Request("https://suite.example/privacy"),
      loadConfig({ ISSUER: "https://suite.example" } as Env),
    ).text();
    expect(missing).toContain("A privacy contact has not yet been published");
    expect(missing).toContain("does not promise a deletion deadline");
  });
  it("rejects invalid contact configuration instead of rendering an unsafe link", () => {
    expect(() =>
      loadConfig({
        ISSUER: "https://suite.example",
        LEGAL_CONFIG: '{"contact_email":"javascript:alert(1)"}',
      } as Env),
    ).toThrow();
  });
  it("requires an additional positive TOTP choice alongside password retention", () => {
    const form = new FormData();
    expect(retentionChoices(form)).toEqual({
      remember: false,
      remember_totp: false,
    });
    form.set("remember", "yes");
    expect(retentionChoices(form)).toEqual({
      remember: true,
      remember_totp: false,
    });
    form.set("remember_totp", "yes");
    expect(retentionChoices(form)).toEqual({
      remember: true,
      remember_totp: true,
    });
    form.delete("remember");
    expect(() => retentionChoices(form)).toThrow();
  });
});
