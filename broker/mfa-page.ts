import type { Page } from "@cloudflare/playwright";
import type { ProviderMfaMethod } from "../src/auth/mfa.ts";
import { clickFirst, safeLoginState } from "./shared-auth.ts";

/** Only fixed method identifiers leave the browser, never provider text or DOM. */
export async function inspectMfa(page: Page, select?: ProviderMfaMethod) {
  const state = await safeLoginState(page, "mfa");
  const result = await page.evaluate((wanted) => {
    const doc = (globalThis as any).document;
    const visible = (el: any) => {
      const s = (globalThis as any).getComputedStyle(el),
        r = el.getBoundingClientRect();
      return (
        s.display !== "none" &&
        s.visibility !== "hidden" &&
        r.width > 0 &&
        r.height > 0
      );
    };
    const text = (el: any) =>
      String(el.innerText || el.textContent || el.value || "")
        .replace(/\s+/g, " ")
        .trim();
    const kind = (raw: string): "totp" | "sso_otp" | undefined => {
      const value = raw.replace(/^Verify with\s+/i, "");
      if (
        /^(Google Authenticator|Authenticator app|Authenticator code|Time.based.*|TOTP.*)$/i.test(
          value,
        )
      )
        return "totp";
      if (
        /^(Enter a code|Verification code|SMS.*|Email.*|Phone.*code.*|Okta Verify.*code.*)$/i.test(
          value,
        )
      )
        return "sso_otp";
    };
    const methods = new Set<"totp" | "sso_otp">();
    let clicked = false;
    let active: "totp" | "sso_otp" | undefined;
    for (const node of [
      ...doc.querySelectorAll(
        "h1,h2,h3,label,div,li,span,p,button,a,input[type=submit]",
      ),
    ].filter(visible)) {
      const value = text(node);
      if (!value || value.length > 100) continue;
      const method = kind(value);
      if (!method) continue;
      // Headings describe the active challenge. Selection rows describe alternatives.
      if (/^H[123]$/.test(node.tagName)) active = method;
      let control: any;
      if (["BUTTON", "A", "INPUT"].includes(node.tagName)) control = node;
      else {
        for (
          let row = node, depth = 0;
          row && depth < 4;
          row = row.parentElement, depth++
        ) {
          if (text(row).length > 250) break;
          control = [
            ...row.querySelectorAll(
              "button,a,input[type=submit],[role=button]",
            ),
          ]
            .filter(visible)
            .find((el: any) => /^(Select|Choose|Continue)$/i.test(text(el)));
          if (control) break;
        }
      }
      if (control || /^H[123]$/.test(node.tagName)) methods.add(method);
      if (control && method === wanted && !clicked) {
        control.click();
        clicked = true;
      }
    }
    return { methods: [...methods], active, clicked };
  }, select);
  if (state.hasOtp) {
    result.active = result.active === "totp" ? "totp" : "sso_otp";
    if (!result.methods.includes(result.active))
      result.methods.push(result.active);
  }
  return { ...result, hasOtp: state.hasOtp, hasError: state.hasError };
}
export async function discoverMfa(page: Page) {
  let state = await inspectMfa(page);
  {
    // Reveal alternatives only through the provider's own switcher.
    if (
      await clickFirst(page, [
        "text=/Verify with something else/i",
        "text=/Choose another option/i",
        "text=/Select another authenticator/i",
      ])
    ) {
      await page.waitForTimeout(1000);
      state = await inspectMfa(page);
    }
  }
  return state;
}
