import { z } from "zod";
import { SuiteError } from "../errors.ts";

export const mfaMethodSchema = z.enum(["totp_secret", "sso_otp", "totp"]);
export type MfaMethod = z.infer<typeof mfaMethodSchema>;
export type ProviderMfaMethod = Exclude<MfaMethod, "totp_secret">;
export const MFA_MAX_ERRORS = 3;
export const MFA_TTL_MS = 300_000;
export const mfaMessages = {
  INVALID_OTP:
    "Enter a current verification code containing 6 to 8 digits. One-time codes are not saved.",
  MFA_METHOD_UNAVAILABLE:
    "This verification method is not offered by the current SSO page. Choose an available method.",
  MFA_TOTP_REJECTED:
    "The provider did not accept the generated TOTP code. Check that the setup secret belongs to this account and authenticator, and check its digits, period and clock settings. You can choose another available method.",
  MFA_CODE_REJECTED:
    "The provider did not accept this code. It may be incorrect, expired or already used. Enter a fresh code for the selected method.",
  MFA_ATTEMPTS_EXCEEDED:
    "Verification stopped after 3 errors. Start a new sign-in and check your secret or use another available method.",
  MFA_SESSION_EXPIRED:
    "This verification session has expired or is no longer available. Start a new sign-in.",
  MFA_FORM_UNSUPPORTED:
    "The provider's verification form could not be used. Start a new sign-in or select another available method.",
  SSO_CREDENTIALS_REJECTED:
    "The provider did not accept the username or password, or has blocked sign-in. Check your account details before trying again.",
} as const;
export function mfaError(code: keyof typeof mfaMessages, status = 409) {
  return new SuiteError(code, mfaMessages[code], status);
}
export function validateOtp(value: string) {
  if (!/^\d{6,8}$/.test(value)) throw mfaError("INVALID_OTP", 400);
  return value;
}
export const mfaChallengeSchema = z
  .object({
    status: z.literal("mfa_required"),
    methods: z.array(z.enum(["sso_otp", "totp"])).max(2),
    attempts_remaining: z.number().int().min(1).max(MFA_MAX_ERRORS),
    error: z
      .object({ code: z.string().max(100), message: z.string().max(1000) })
      .optional(),
  })
  .strict();
export type MfaChallenge = z.infer<typeof mfaChallengeSchema>;
