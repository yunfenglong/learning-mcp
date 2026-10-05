import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorStatus, publicError } from "../src/errors.ts";
import {
  validateOtp,
  mfaMethodSchema,
  mfaChallengeSchema,
} from "../src/auth/mfa.ts";
describe("public error granularity", () => {
  it("rejects removed Push methods in requests and challenge responses", () => {
    expect(mfaMethodSchema.safeParse("push").success).toBe(false);
    expect(
      mfaChallengeSchema.safeParse({
        status: "mfa_required",
        methods: ["push"],
        attempts_remaining: 3,
      }).success,
    ).toBe(false);
  });
  it("names invalid form fields without exposing Zod issue data", () => {
    const result = z
      .object({ password: z.string().max(3) })
      .safeParse({ password: "private-password-canary" });
    if (result.success) throw new Error("Expected invalid password");
    expect(publicError(result.error)).toMatchObject({
      code: "INVALID_PASSWORD",
    });
    expect(JSON.stringify(publicError(result.error))).not.toContain("canary");
    expect(errorStatus(result.error)).toBe(400);
    const unknown = new z.ZodError([
      {
        code: "custom",
        path: ["credential-canary"],
        message: "private-provider-text",
      },
    ]);
    expect(publicError(unknown)).toMatchObject({ code: "INVALID_INPUT" });
    expect(JSON.stringify(publicError(unknown))).not.toContain("canary");
  });
  it("validates current codes without trimming, echoing or accepting secret material", () => {
    expect(validateOtp("012345")).toBe("012345");
    expect(validateOtp("12345678")).toBe("12345678");
    for (const code of [
      "12345",
      "123456789",
      "12 3456",
      " 123456",
      "JBSWY3DPEHPK3PXP",
    ])
      expect(() => validateOtp(code)).toThrow(
        expect.objectContaining({ code: "INVALID_OTP" }),
      );
  });
});
