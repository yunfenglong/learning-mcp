export class SuiteError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "SuiteError";
  }
}
export function errorStatus(error: unknown, fallback = 500) {
  return error instanceof SuiteError
    ? error.status
    : error instanceof z.ZodError
      ? 400
      : fallback;
}

export function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof SuiteError)
    return { code: error.code, message: error.message };
  if (error instanceof z.ZodError) {
    // Only fixed field descriptions are public. Zod issues can contain credentials.
    const fields: Record<string, { code: string; message: string }> = {
      username: {
        code: "INVALID_USERNAME",
        message: "Enter a valid SSO username (1 to 200 characters).",
      },
      password: {
        code: "INVALID_PASSWORD",
        message: "Enter a valid password (1 to 1000 characters).",
      },
      nonce: {
        code: "INVALID_LOGIN_FORM",
        message: "The sign-in form is invalid. Open the sign-in page again.",
      },
      token: {
        code: "INVALID_TOKEN",
        message: "Enter a valid platform token on the account page.",
      },
      provider: {
        code: "INVALID_PROVIDER",
        message:
          "Enter the public HTTPS base link of your supported SSO provider.",
      },
      method: {
        code: "INVALID_MFA_METHOD",
        message: "Select a verification method offered on the sign-in page.",
      },
      mfa_code: {
        code: "INVALID_OTP",
        message: "Enter a current verification code containing 6 to 8 digits.",
      },
      totp_secret: {
        code: "INVALID_TOTP",
        message:
          "Use a valid Base32 TOTP secret or otpauth://totp URI, not a current code.",
      },
    };
    for (const issue of error.issues) {
      const field = fields[String(issue.path[issue.path.length - 1])];
      if (field) return field;
    }
    return {
      code: "INVALID_INPUT",
      message:
        "One or more request fields are missing or invalid. Check the form and try again.",
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "The request could not be completed.",
  };
}
import { z } from "zod";
