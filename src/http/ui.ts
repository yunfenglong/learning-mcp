import { escapeHtml as e } from "./common.ts";

import { css } from "./theme.ts";
import { artwork } from "./artwork.ts";
import { usageNotice } from "../domain/usage.ts";

export function page(content: string, title = "Your connections", mode = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Connect your learning platforms and choose what your MCP client can read."><title>${e(title)} · Learning MCP</title><style>${css}</style></head><body class="${e(mode)}"><a class="skip" href="#main">Skip to content</a><header class="site-header"><a class="brand" href="/landing" aria-label="Learning MCP home"><span class="brand-mark">${artwork("brand", "header")}</span><span>Learning MCP</span></a><span class="header-note"><span class="pilot-light" aria-hidden="true"></span>Read-only learning tools</span></header><main id="main"><div class="binder-spine" aria-hidden="true"><i></i><i></i><i></i></div>${content}</main><footer class="site-footer"><details class="service-info"><summary>About &amp; privacy</summary><div><p>Independent service. Learning data is read-only; attendance is never submitted.</p><nav aria-label="Privacy and terms"><a href="/privacy">Privacy notice</a><a href="/terms">Terms of use</a></nav></div></details></footer></body></html>`;
}

export function signInJourney(step: 1 | 2) {
  return `<ol class="journey" aria-label="Sign-in progress"><li class="${step === 1 ? "current" : ""}"${step === 1 ? ' aria-current="step"' : ""}><span class="step-dot">${step === 2 ? "✓" : "1"}</span><span><strong>Account</strong><small>Verify your sign-in details</small></span></li><li class="${step === 2 ? "current" : ""}"${step === 2 ? ' aria-current="step"' : ""}><span class="step-dot">2</span><span><strong>Verification</strong><small>Complete MFA if requested</small></span></li><li><span class="step-dot">3</span><span><strong>Connections</strong><small>Choose your platforms</small></span></li></ol>`;
}

export function errorContent(code: string, message: string, login: boolean) {
  return `<section class="error-page"><span class="eyebrow">${login ? "Sign-in needs attention" : "Connection needs attention"}</span><h1>${code.startsWith("MFA_") ? "Verification stopped" : "We couldn’t complete this step"}</h1><div class="error" role="alert"><p>${e(message)}</p><span class="error-code">Error code: ${e(code)}</span></div><p class="muted">${login ? "Start a new sign-in to try again. Your account will be signed in only after verification succeeds." : "Return to your connections to review the account or platform details."}</p><div class="actions"><a class="button" href="${login ? "/login" : "/landing"}">${login ? "Start a new sign-in" : "Back to connections"}<span aria-hidden="true">→</span></a></div></section>`;
}

/** Keep the current notice available at consent steps without repeating a full page. */
export function noticeDisclosure() {
  return `<details class="notice-file"><summary><span class="notice-file-icon" aria-hidden="true"></span><span>Before you connect<small>Credential handling, data sharing &amp; your responsibilities</small></span></summary>${usageNotice}</details>`;
}
