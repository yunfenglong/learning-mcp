import {
  launch,
  type Browser,
  type BrowserContext,
  type Page,
} from "@cloudflare/playwright";
import { SuiteError } from "../src/errors.ts";
import {
  MFA_MAX_ERRORS,
  MFA_TTL_MS,
  mfaError,
  mfaMethodSchema,
  validateOtp,
  type MfaChallenge,
  type ProviderMfaMethod,
} from "../src/auth/mfa.ts";
import { scopedCookies } from "../src/platforms/session-cookies.ts";
import { autoLogin, submitVerificationCode } from "./shared-auth.ts";
import { discoverMfa, inspectMfa } from "./mfa-page.ts";
import { generateTotp, parseTotp } from "./totp.ts";
import { bounded, browserSignInError, oktaIdentitySchema } from "./sso.ts";
import { z } from "zod";

export interface InteractiveInput {
  username: string;
  password: string;
  remember?: boolean;
  remember_totp?: boolean;
  totp_secret?: string;
  mfa_code?: string;
}
export interface CompletedSignIn {
  provider: string;
  input: InteractiveInput;
  result: { session: z.infer<typeof oktaIdentitySchema>; cookies: any[] };
}
/** One volatile transaction in one private DO. Eviction fails closed; no OTP is stored. */
export class InteractiveSignIn {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private provider = "";
  private origins: string[] = [];
  private input?: InteractiveInput;
  private expires = 0;
  private errors = 0;
  private methods: ProviderMfaMethod[] = [];

  async close() {
    const context = this.context,
      browser = this.browser;
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
    this.input = undefined;
    await Promise.allSettled([
      bounded(context?.close() ?? Promise.resolve(), 3000),
      bounded(browser?.close() ?? Promise.resolve(), 3000),
    ]);
  }
  private async capture(): Promise<CompletedSignIn | undefined> {
    if (!this.page || new URL(this.page.url()).origin !== this.provider) return;
    const value = await this.page.evaluate(async () => {
      try {
        const response = await (globalThis.fetch as any)(
          "/api/v1/sessions/me",
          {
            credentials: "include",
            redirect: "error",
            signal: AbortSignal.timeout(5000),
          },
        );
        if (!response.ok) return null;
        const text = await response.text();
        return text.length <= 16384 ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    });
    const identity = oktaIdentitySchema.safeParse(value);
    if (!identity.success) return;
    const input = this.input!;
    return {
      provider: this.provider,
      input: {
        username: input.username,
        password: input.password,
        remember: input.remember,
        remember_totp: input.remember_totp,
      },
      result: {
        session: identity.data,
        cookies: scopedCookies(
          await this.context!.cookies(this.origins),
          this.origins,
        ),
      },
    };
  }
  private challenge(error?: SuiteError): MfaChallenge {
    return {
      status: "mfa_required",
      methods: this.methods,
      attempts_remaining: MFA_MAX_ERRORS - this.errors,
      ...(error ? { error: { code: error.code, message: error.message } } : {}),
    };
  }
  async start(
    binding: Fetcher,
    provider: string,
    origins: string[],
    input: InteractiveInput,
  ): Promise<MfaChallenge | CompletedSignIn> {
    try {
      return await bounded(
        this.begin(binding, provider, origins, input),
        60000,
      );
    } catch (error) {
      await this.close();
      throw browserSignInError(error);
    }
  }
  private async begin(
    binding: Fetcher,
    provider: string,
    origins: string[],
    input: InteractiveInput,
  ): Promise<MfaChallenge | CompletedSignIn> {
    await this.close();
    // Parse before opening the browser. A format check cannot prove account ownership.
    const totp = input.totp_secret ? parseTotp(input.totp_secret) : undefined;
    if (input.mfa_code) validateOtp(input.mfa_code);
    this.provider = provider;
    this.origins = [...new Set([provider, ...origins])];
    this.input = {
      username: input.username,
      password: input.password,
      remember: input.remember,
      remember_totp: input.remember_totp,
    };
    this.expires = Date.now() + MFA_TTL_MS;
    this.errors = 0;
    this.methods = [];
    try {
      const pending = launch(binding, {
        keep_alive: MFA_TTL_MS,
        guardrails: {
          allowedDomains: this.origins.map((v) => new URL(v).hostname),
        },
      });
      pending.then(
        (browser) => {
          if (!this.input) void browser.close().catch(() => {});
        },
        () => {},
      );
      this.browser = await bounded(pending, 20000);
      this.context = await this.browser.newContext({ serviceWorkers: "block" });
      await this.context.route("**/*", async (route) => {
        const u = new URL(route.request().url());
        if (
          u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          this.origins.includes(u.origin)
        )
          await route.continue();
        else await route.abort();
      });
      this.page = await this.context.newPage();
      this.page.setDefaultTimeout(5000);
      await this.page.goto(`${provider}/login/login.htm`, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await autoLogin(
        this.page,
        { username: input.username, password: input.password },
        [provider],
        async (page) => {
          const mfa = await discoverMfa(page);
          this.methods = mfa.methods;
          return !!mfa.methods.length;
        },
      );
      const done = await this.capture();
      if (done) {
        await this.close();
        return done;
      }
      if (!this.methods.length)
        throw new SuiteError(
          "SSO_INTERACTION_REQUIRED",
          "The provider requires a challenge this service cannot use. Start a new sign-in.",
          409,
        );
      if (totp || input.mfa_code)
        return await this.next({
          method: totp ? "totp_secret" : "sso_otp",
          ...(totp
            ? { totp_secret: input.totp_secret }
            : { mfa_code: input.mfa_code }),
        });
      return this.challenge();
    } catch (error) {
      await this.close();
      throw browserSignInError(error);
    }
  }
  async next(value: unknown): Promise<MfaChallenge | CompletedSignIn> {
    try {
      return await bounded(this.advance(value), 45000);
    } catch (error) {
      await this.close();
      throw browserSignInError(error);
    }
  }
  private async advance(
    value: unknown,
  ): Promise<MfaChallenge | CompletedSignIn> {
    if (!this.page || Date.now() >= this.expires) {
      await this.close();
      throw mfaError("MFA_SESSION_EXPIRED");
    }
    const page = this.page;
    try {
      const done = await this.capture();
      if (done) {
        await this.close();
        return done;
      }
      if (new URL(page.url()).origin !== this.provider)
        throw new SuiteError(
          "SSO_CREDENTIAL_DESTINATION",
          "Verification can only be completed at your supported identity provider.",
          403,
        );
      const data = z
        .object({
          method: mfaMethodSchema,
          mfa_code: z.string().max(20).optional(),
          totp_secret: z.string().max(2048).optional(),
        })
        .strict()
        .parse(value);
      const method: ProviderMfaMethod =
        data.method === "totp_secret" ? "totp" : data.method;
      if (!this.methods.includes(method))
        throw mfaError("MFA_METHOD_UNAVAILABLE", 400);
      // Validate before selecting or submitting the provider challenge.
      const totp =
        data.method === "totp_secret"
          ? parseTotp(data.totp_secret ?? "")
          : undefined;
      const code = totp
        ? await generateTotp(totp)
        : data.mfa_code
          ? validateOtp(data.mfa_code)
          : undefined;
      let state = await inspectMfa(page);
      if (state.active !== method || !state.hasOtp) {
        if (!state.methods.includes(method)) state = await discoverMfa(page);
        const selected = await inspectMfa(page, method);
        if (!selected.clicked && !(state.active === method && state.hasOtp))
          throw mfaError("MFA_METHOD_UNAVAILABLE", 400);
        await page.waitForTimeout(1200);
      }
      if (!code)
        return this.challenge(
          new SuiteError(
            "MFA_CODE_REQUIRED",
            "The selected method is ready. Enter its current verification code; leave other method fields empty.",
            409,
          ),
        );
      await submitVerificationCode(page, code);
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(1000);
        const complete = await this.capture();
        if (complete) {
          if (totp && this.input?.remember && this.input.remember_totp)
            complete.input.totp_secret = data.totp_secret;
          await this.close();
          return complete;
        }
        const current = await inspectMfa(page);
        if (current.hasError) break;
      }
      throw mfaError(totp ? "MFA_TOTP_REJECTED" : "MFA_CODE_REJECTED");
    } catch (error) {
      if (
        error instanceof SuiteError &&
        [
          "INVALID_TOTP",
          "INVALID_OTP",
          "MFA_TOTP_REJECTED",
          "MFA_CODE_REJECTED",
          "MFA_METHOD_UNAVAILABLE",
          "MFA_FORM_UNSUPPORTED",
        ].includes(error.code)
      ) {
        if (++this.errors < MFA_MAX_ERRORS) {
          // Rediscover from the live page; don't retain a rejected secret or code.
          this.methods = (await discoverMfa(page)).methods;
          return this.challenge(error);
        }
        await this.close();
        throw mfaError("MFA_ATTEMPTS_EXCEEDED", 429);
      }
      await this.close();
      throw error;
    }
  }
}
