// Login selectors, factor selection, step order and waits reuse the deployed shared-auth flow.
// Page state stays inside this request; provider messages and credentials are never logged.
import type { Page } from "@cloudflare/playwright";
import type { LoginInput } from "./sso.ts";
import { generateTotp } from "./totp.ts";
import { safeJsonFetch } from "../src/platforms/network.ts";
import { SuiteError } from "../src/errors.ts";
import { mfaError, validateOtp } from "../src/auth/mfa.ts";
var USERNAME_SELECTORS = [
  "#okta-signin-username",
  'input[name="identifier"]',
  'input[name="username"]',
  'input[autocomplete="username"]',
  'input[type="email"]',
  'input[data-se="o-form-input-username"]',
  'input[id*="username" i]',
  'input[name*="email"]',
  'input[type="text"]:visible',
];
var PASSWORD_SELECTORS = [
  "#okta-signin-password",
  'input[name="password"]',
  'input[autocomplete="current-password"]',
  'input[type="password"]',
  'input[data-se="o-form-input-password"]',
  'input[id*="password" i]',
];
var OTP_SELECTORS = [
  'input[name="credentials.passcode"]',
  'input[name="credentials.otp"]',
  'input[name="otp"]',
  'input[name="code"]',
  'input[name="passcode"]',
  'input[autocomplete="one-time-code"]',
  'input[inputmode="numeric"]',
  'input[type="tel"]',
  'input[id*="code" i]',
  'input[placeholder*="code" i]',
];
export async function fillFirst(
  page: Page,
  selectors2: string[],
  value: string,
) {
  for (const sel of selectors2) {
    try {
      const e = page.locator(sel).first();
      if (await e.isVisible({ timeout: 1500 })) {
        await e.fill(value);
        return true;
      }
    } catch {}
  }
  return false;
}
export async function clickFirst(page: Page, selectors2: string[]) {
  for (const sel of selectors2) {
    try {
      const e = page.locator(sel).first();
      if (await e.isVisible({ timeout: 1200 })) {
        await e.click();
        return true;
      }
    } catch {}
  }
  return false;
}
export async function safeLoginState(page: Page, label: string) {
  try {
    return await page.evaluate((label2) => {
      const visible = (el: any) => {
        const s = (globalThis as any).getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return (
          s.display !== "none" &&
          s.visibility !== "hidden" &&
          r.width > 0 &&
          r.height > 0
        );
      };

      return {
        label: label2,
        hasUsername: !![
          ...(globalThis as any).document.querySelectorAll("input"),
        ].find(
          (el: any) =>
            visible(el) &&
            (el.name === "identifier" ||
              el.name === "username" ||
              el.autocomplete === "username" ||
              el.type === "email"),
        ),
        hasPassword: !![
          ...(globalThis as any).document.querySelectorAll(
            'input[type="password"]',
          ),
        ].find(visible),
        hasOtp: !![
          ...(globalThis as any).document.querySelectorAll("input"),
        ].find(
          (el: any) =>
            visible(el) &&
            (el.autocomplete === "one-time-code" ||
              el.name === "otp" ||
              el.name === "code" ||
              el.name === "passcode" ||
              el.name === "credentials.otp" ||
              (el.name === "credentials.passcode" && el.type !== "password") ||
              el.getAttribute("maxlength") === "1" ||
              /digit/i.test(el.getAttribute("aria-label") ?? "") ||
              el.inputMode === "numeric" ||
              el.type === "tel"),
        ),
        hasSamlResponse: !!(globalThis as any).document.querySelector(
          'input[name="SAMLResponse"]',
        ),
        hasError: !![
          ...(globalThis as any).document.querySelectorAll(
            '[role="alert"], .o-form-error-container, .okta-form-infobox-error',
          ),
        ].find((el: any) => visible(el) && String(el.textContent || "").trim()),
      };
    }, label);
  } catch {
    return {
      label,
      hasUsername: false,
      hasPassword: false,
      hasOtp: false,
      hasSamlResponse: false,
      hasError: false,
    };
  }
}
async function clickTotpFactorSelect(page: Page) {
  try {
    return await page.evaluate(() => {
      const visible = (el: any) => {
        const s = (globalThis as any).getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return (
          s.display !== "none" &&
          s.visibility !== "hidden" &&
          r.width > 0 &&
          r.height > 0
        );
      };
      const textOf = (el: any) =>
        String(el.innerText || el.textContent || el.value || "")
          .replace(/\s+/g, " ")
          .trim();
      const patterns = [
        { kind: "google_authenticator", re: /^Google Authenticator$/i },
        { kind: "authenticator_app", re: /^Authenticator app$/i },
        { kind: "okta_enter_code", re: /^Enter a code$/i },
        { kind: "verification_code", re: /verification code/i },
      ];
      const nodes = [
        ...(globalThis as any).document.querySelectorAll(
          "div,li,span,p,h1,h2,h3,label",
        ),
      ].filter(visible);
      for (const pattern of patterns) {
        for (const node of nodes) {
          const own = textOf(node);
          if (!own || own.length > 160 || !pattern.re.test(own)) continue;
          let row = node;
          for (
            let depth = 0;
            depth < 7 && row;
            depth++, row = row.parentElement
          ) {
            const controls = [
              ...row.querySelectorAll(
                'button,input[type="submit"],a,[role="button"]',
              ),
            ].filter(visible);
            const select =
              controls.find((el: any) =>
                /^(select|choose|continue)$/i.test(textOf(el)),
              ) ||
              controls.find((el: any) => /select|choose/i.test(textOf(el)));
            if (select) {
              select.click();
              return {
                clicked: true,
                kind: pattern.kind,
                control: textOf(select).slice(0, 80),
              };
            }
          }
        }
      }
      return { clicked: false, kind: null, control: null };
    });
  } catch {
    return { clicked: false, kind: null, control: null };
  }
}
async function pressEnterFirst(page: Page, selectors2: string[]) {
  for (const sel of selectors2) {
    try {
      const e = page.locator(sel).first();
      if (await e.isVisible({ timeout: 800 })) {
        await e.press("Enter");
        return true;
      }
    } catch {}
  }
  return false;
}
export async function autoLogin(
  page: Page,
  creds: LoginInput | undefined,
  credentialOrigins?: string[],
  pauseForMfa?: (page: Page) => Promise<boolean>,
) {
  const attempts = { username: 0, password: 0, otp: 0, factor: 0 };
  await page.waitForTimeout(1200);
  for (let step = 0; step < 16; step++) {
    let state = await safeLoginState(page, "step_" + step);
    if (
      creds &&
      credentialOrigins &&
      (state.hasUsername || state.hasPassword || state.hasOtp) &&
      !credentialOrigins.includes(new URL(page.url()).origin)
    )
      throw new SuiteError(
        "SSO_CREDENTIAL_DESTINATION",
        "SSO credentials can only be entered at your supported identity provider. Check the platform base link.",
        403,
      );
    if (!creds && (state.hasUsername || state.hasPassword || state.hasOtp))
      throw new SuiteError(
        "SSO_LOGIN_REQUIRED",
        "The saved SSO session has expired. Connect again with your SSO login.",
        409,
      );
    if (
      pauseForMfa &&
      !state.hasUsername &&
      !state.hasPassword &&
      (await pauseForMfa(page))
    )
      return;
    if (
      state.hasError &&
      (attempts.password > 0 || attempts.username > 0) &&
      !state.hasOtp
    )
      throw mfaError("SSO_CREDENTIALS_REJECTED", 401);
    if (state.hasPassword && attempts.password >= 2)
      throw mfaError("SSO_CREDENTIALS_REJECTED", 401);
    if (state.hasOtp && attempts.otp > 0)
      throw mfaError(creds?.totp ? "MFA_TOTP_REJECTED" : "MFA_CODE_REJECTED");
    if (state.hasOtp && !creds?.totp && !creds?.mfa_code)
      throw new SuiteError(
        "MFA_REQUIRED",
        "The provider requested a verification code. Supply a current code or a TOTP secret for automated sign-in.",
        409,
      );
    if (state.hasSamlResponse) {
      const submitted = await submitSamlHandoff(page);
      if (submitted) {
        await page.waitForTimeout(1800);
        continue;
      }
    }
    if (state.hasPassword && attempts.password < 2) {
      attempts.password++;
      const filled = await fillFirst(
        page,
        PASSWORD_SELECTORS,
        creds?.password || "",
      );
      let clicked = false;
      if (filled) {
        clicked = await clickFirst(page, [
          '[data-se="save"]',
          '[data-se="o-form-button-bar"] input[type="submit"]',
          'button:has-text("Verify")',
          'button:has-text("Sign in")',
          'button:has-text("Next")',
          'input[type="submit"]',
          'button[type="submit"]',
        ]);
        if (!clicked) clicked = await pressEnterFirst(page, PASSWORD_SELECTORS);
      }
      await page.waitForTimeout(3200);
      continue;
    }
    if (state.hasOtp && (creds?.totp || creds?.mfa_code) && attempts.otp < 2) {
      attempts.otp++;
      const code = creds!.totp
        ? await generateTotp(creds!.totp)
        : creds!.mfa_code!;
      validateOtp(code);
      let filled = await fillFirst(page, OTP_SELECTORS, code);
      if (!filled) {
        try {
          const boxes = page.locator(
            'input[aria-label*="digit" i], input[maxlength="1"]',
          );
          const count = await boxes.count();
          if (count >= 6) {
            for (let i = 0; i < Math.min(count, code.length); i++)
              await boxes.nth(i).fill(code[i]!);
            filled = true;
          }
        } catch {}
      }
      let clicked = false;
      if (filled) {
        clicked = await clickFirst(page, [
          '[data-se="save"]',
          '[data-se="o-form-button-bar"] input[type="submit"]',
          'button:has-text("Verify")',
          'button:has-text("Submit")',
          'button:has-text("Next")',
          'input[type="submit"]',
          'button[type="submit"]',
        ]);
        if (!clicked) clicked = await pressEnterFirst(page, OTP_SELECTORS);
      }
      await page.waitForTimeout(4200);
      continue;
    }
    if (state.hasUsername && attempts.username < 2) {
      attempts.username++;
      const filled = await fillFirst(
        page,
        USERNAME_SELECTORS,
        creds?.username || "",
      );
      let clicked = false;
      if (filled) {
        clicked = await clickFirst(page, [
          '[data-se="save"]',
          '[data-se="o-form-button-bar"] input[type="submit"]',
          'button:has-text("Next")',
          'button:has-text("Continue")',
          'input[type="submit"]',
          'button[type="submit"]',
        ]);
        await page.waitForTimeout(3e3);
        const afterClick = await safeLoginState(
          page,
          "username_after_click_" + attempts.username,
        );
        if (afterClick.hasUsername && !afterClick.hasPassword) {
          const entered = await pressEnterFirst(page, USERNAME_SELECTORS);
          if (entered) await page.waitForTimeout(3500);
        }
      }
      continue;
    }
    if ((creds?.totp || creds?.mfa_code) && attempts.factor < 5) {
      attempts.factor++;
      let choice = await clickTotpFactorSelect(page);
      if (!choice.clicked) {
        const switchClicked = await clickFirst(page, [
          "text=/Verify with something else/i",
          "text=/Choose another option/i",
          "text=/Select another authenticator/i",
        ]);
        if (switchClicked) {
          await page.waitForTimeout(1500);
          choice = await clickTotpFactorSelect(page);
        }
      }
      if (choice.clicked) {
        await page.waitForTimeout(2200);
        continue;
      }
    }
    await page.waitForTimeout(1500);
    const afterIdle = await safeLoginState(page, "idle_" + step);
    if (
      !afterIdle.hasUsername &&
      !afterIdle.hasPassword &&
      !afterIdle.hasOtp &&
      !afterIdle.hasSamlResponse
    ) {
      break;
    }
  }
  const finalState = await safeLoginState(page, "final");
  if (finalState.hasOtp)
    throw mfaError(creds?.totp ? "MFA_TOTP_REJECTED" : "MFA_CODE_REJECTED");
  if (finalState.hasPassword || finalState.hasUsername)
    throw mfaError("SSO_CREDENTIALS_REJECTED", 401);
  return;
}

/** A user-triggered verification submits once; never replay an OTP. */
export async function submitVerificationCode(page: Page, code: string) {
  validateOtp(code);
  let filled = await fillFirst(page, OTP_SELECTORS, code);
  if (!filled) {
    const boxes = page.locator(
      'input[aria-label*="digit" i], input[maxlength="1"]',
    );
    const count = await boxes.count();
    if (count === code.length) {
      for (let i = 0; i < count; i++) await boxes.nth(i).fill(code[i]!);
      filled = true;
    }
  }
  if (!filled) throw mfaError("MFA_FORM_UNSUPPORTED");
  const clicked = await clickFirst(page, [
    '[data-se="save"]',
    'button:has-text("Verify")',
    'button:has-text("Submit")',
    'input[type="submit"]',
    'button[type="submit"]',
  ]);
  if (!clicked && !(await pressEnterFirst(page, OTP_SELECTORS)))
    throw mfaError("MFA_FORM_UNSUPPORTED");
}
export async function discoverOnTrackLogin(baseUrl: string) {
  try {
    const data = (await safeJsonFetch(`${baseUrl}/api/auth/method`)) as {
      redirect_to?: string;
    };
    return typeof data?.redirect_to === "string"
      ? new URL(data.redirect_to, baseUrl).toString()
      : baseUrl;
  } catch {
    return baseUrl;
  }
}
export async function submitSamlHandoff(page: Page) {
  let submitted = false;
  try {
    submitted = await page.evaluate(() => {
      const input = (globalThis as any).document.querySelector(
        'input[name="SAMLResponse"]',
      );
      const form = input?.form || input?.closest("form");
      if (!form) return false;
      (globalThis as any).HTMLFormElement.prototype.submit.call(form);
      return true;
    });
  } catch {}
  if (submitted) {
    await page
      .waitForLoadState("domcontentloaded", { timeout: 2e4 })
      .catch(() => {});
    await page.waitForTimeout(1200);
  }
  return submitted;
}
