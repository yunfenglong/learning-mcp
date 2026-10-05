import { SuiteError } from "../errors.ts";
import { escapeHtml as e } from "./common.ts";
import type { MfaChallenge } from "../auth/mfa.ts";
/** The setup key is optional. Other choices are discovered after provider password verification. */
export const providerVerificationFields = `<fieldset><legend>Optional · TOTP secret</legend><label>Authenticator setup key<input name="totp_secret" type="password" autocomplete="off" maxlength="2048" placeholder="Setup key or otpauth URI"></label><p>Use the setup key for this account, not the changing code in your app. We can check its format; your provider must verify that it is correct.</p><p>Prefer a one-time code? Leave this empty. After your password is verified, choose an available SSO OTP or TOTP method. This key can generate future verification codes. It is saved only if you separately choose to save your password and TOTP setup key.</p></fieldset>`;
/** Platform connection/renewal still accepts a transient current code. */
export const verificationFields = `<fieldset><legend>Verification · if requested</legend><label>Authenticator setup key (TOTP secret, optional)<input name="totp_secret" type="password" autocomplete="off" maxlength="2048"></label><p>This is your authenticator’s setup key. It can generate future verification codes. Saving it requires the separate password and TOTP retention choices.</p><details><summary>Use a one-time code instead</summary><p>Leave the setup key empty and enter a current code. One-time codes are never saved.</p><label>Verification code<input name="mfa_code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6,8}" minlength="6" maxlength="8"></label></details></fieldset>`;
export function mfaForms(nonce: string, challenge: MfaChallenge) {
  const form = (
    method: string,
    title: string,
    fields: string,
    description: string,
  ) =>
    `<details class="method"${method === "totp_secret" ? " open" : ""}><summary>${e(title)}${method === "totp_secret" ? '<span class="optional">Optional</span>' : ""}</summary><form method="post" action="/login"><input type="hidden" name="nonce" value="${e(nonce)}"><input type="hidden" name="mfa_method" value="${method}"><p>${description}</p>${fields}<button${method === "totp_secret" && !challenge.methods.includes("totp") ? " disabled" : ""}>${method === "totp_secret" ? "Verify setup key" : "Continue"}<span aria-hidden="true">→</span></button></form></details>`;
  return (
    form(
      "totp_secret",
      "Authenticator setup key · TOTP secret",
      `<label>Setup key or otpauth URI<input type="password" name="totp_secret" autocomplete="off" maxlength="2048" required${challenge.methods.includes("totp") ? "" : " disabled"}></label>`,
      `We’ll generate a code from this key and ask your provider to verify it. Use the key set up for this account. It is retained only if you chose both password and TOTP retention before sign-in; otherwise it is used for this verification only.${challenge.methods.includes("totp") ? "" : " This option is unavailable because your provider is not offering TOTP."}`,
    ) +
    challenge.methods
      .map((method) =>
        form(
          method,
          method === "totp"
            ? "Authenticator code · TOTP"
            : "One-time code · SSO OTP",
          '<label>Verification code<input class="code" name="mfa_code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6,8}" minlength="6" maxlength="8" placeholder="6–8 digits"></label>',
          method === "totp"
            ? "Enter the current code from your authenticator app. To select this method at your provider first, leave the field empty and continue."
            : "Enter the current code from your SSO provider. Need to request a code? Leave the field empty and continue, then enter the code here.",
        ),
      )
      .join("")
  );
}

export const retentionFields = `<fieldset><legend>Optional · automatic sign-in</legend><p>You can continue without saving either credential. Encrypted SSO and platform sessions are still stored and may renew; when they expire, you may need to sign in again. The deployment operator holds the decryption keys.</p><label class="check"><input name="remember" type="checkbox" value="yes"><span>Save my encrypted password<small>Allow automatic sign-in for my configured platforms until I remove saved sign-in.</small></span></label><label class="check"><input name="remember_totp" type="checkbox" value="yes"><span>Also save my encrypted TOTP setup key<small>Requires password saving. This key can generate future MFA codes. Only a key successfully used for verification is eligible for saving during interactive sign-in.</small></span></label><p><a href="/data-controls" target="_blank" rel="noopener">How to remove saved credentials</a></p></fieldset>`;
export function retentionChoices(form: FormData) {
  const remember = form.get("remember") === "yes";
  const remember_totp = form.get("remember_totp") === "yes";
  if (remember_totp && !remember)
    throw new SuiteError(
      "CONSENT_REQUIRED",
      "Saving a TOTP setup key also requires password retention. Leave both unchecked to use credentials only for this sign-in.",
      403,
    );
  return { remember, remember_totp };
}
