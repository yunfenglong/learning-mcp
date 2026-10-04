import { escapeHtml as e } from "./common.ts";

const css = `
:root {
  color-scheme: light;
  --ink: #302d28;
  --muted: #6d685f;
  --paper: #f8f5ed;
  --white: #fcfaf5;
  --line: #d9d2c5;
  --accent: #975037;
  --soft: #eee9df;
  --danger: #943b2b;
}
* {
  box-sizing: border-box;
}
html {
  scroll-behavior: smooth;
  scroll-padding-top: 2rem;
}
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font:
    15px/1.6 "Helvetica Neue",
    "Segoe UI",
    sans-serif;
  -webkit-font-smoothing: antialiased;
}
a {
  color: var(--accent);
  text-underline-offset: 4px;
}
p {
  margin: 0 0 1rem;
  text-wrap: pretty;
}
h1,
h2,
h3 {
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 400;
  line-height: 1.15;
  text-wrap: balance;
}
h1 {
  font-size: clamp(2.1rem, 4.4vw, 3.6rem);
  letter-spacing: -0.045em;
  margin: 0.6rem 0 1.25rem;
}
h2 {
  font-size: 1.65rem;
  letter-spacing: -0.035em;
  margin: 0 0 0.7rem;
}
h3 {
  font-size: 1.2rem;
  letter-spacing: -0.025em;
  margin: 0 0 0.4rem;
}
strong {
  font-weight: 600;
}
button,
input,
select,
textarea {
  font: inherit;
}
button,
a,
input,
select,
textarea,
summary {
  transition:
    background 0.18s,
    border-color 0.18s,
    transform 0.18s;
}
button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
}
.skip {
  position: absolute;
  left: 1rem;
  top: -5rem;
  z-index: 20;
  background: white;
  padding: 1rem;
}
.skip:focus {
  top: 1rem;
}
.site-header {
  height: 100px;
  border-bottom: 1px solid var(--line);
  max-width: 1240px;
  padding: 0 3rem;
  margin: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  text-decoration: none;
  color: var(--ink);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.03em;
}
.brand-mark {
  font-family: Georgia, serif;
  font-size: 32px;
  font-weight: 400;
  line-height: 1;
}
.header-note {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 12px;
  color: var(--muted);
}
.status.connected:before {
  content: "";
  width: 6px;
  height: 6px;
  background: var(--accent);
}
main {
  max-width: 1240px;
  margin: auto;
  padding: 2rem 3rem 5rem;
}
.site-footer {
  max-width: 1144px;
  margin: auto;
  border-top: 1px solid var(--line);
  padding: 1.5rem 0 2.5rem;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  color: var(--muted);
  font-size: 12px;
}
.site-footer p {
  margin: 0;
  max-width: 46rem;
}
.eyebrow {
  font-size: 12px;
  letter-spacing: 0.08em;
  font-weight: 600;
  color: var(--accent);
}
.muted {
  font-size: 14px;
  color: var(--muted);
}
.small {
  font-size: 12px;
}
.intro {
  max-width: 41rem;
  color: var(--muted);
  font-size: 17px;
}
.button,
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.7rem;
  min-height: 44px;
  padding: 0.7rem 1.2rem;
  border: 1px solid var(--ink);
  background: var(--ink);
  color: white;
  font-weight: 600;
  font-size: 14px;
  text-decoration: none;
  cursor: pointer;
}
button:hover,
.button:hover {
  background: #4c463d;
  border-color: #4c463d;
}
button:active,
.button:active {
  transform: translateY(1px);
}
button.secondary,
.button.secondary {
  background: transparent;
  border-color: var(--line);
  color: var(--ink);
}
button.secondary:hover,
.button.secondary:hover {
  background: var(--soft);
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.text-link {
  font-size: 14px;
  font-weight: 600;
}
.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: 1.5rem;
}
.hero {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 5rem;
  padding: 3rem 0 4rem;
  align-items: center;
}
.hero .small {
  margin-top: 1rem;
}
.hero h1 {
  font-size: clamp(2.8rem, 5.6vw, 4.5rem);
  max-width: 38rem;
}
.hero-visual {
  padding: 1rem 0;
  position: relative;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.visual-label {
  display: flex;
  justify-content: space-between;
  font: 11px/1.5 monospace;
  letter-spacing: 0.03em;
  color: var(--muted);
  margin-bottom: 1.5rem;
}
.platform-preview {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 0;
  border-bottom: 1px solid var(--line);
}
.platform-preview:last-of-type {
  border: 0;
}
.platform-preview p {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.platform-icon {
  width: 32px;
  height: 40px;
  display: grid;
  place-items: center;
  color: var(--accent);
  font:
    28px/1 Georgia,
    serif;
  flex-shrink: 0;
}
.visual-caption {
  margin: 1.5rem 0 0;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
  font-size: 13px;
}
.workflow {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2.5rem;
  border-top: 1px solid var(--line);
  padding: 2.5rem 0 3rem;
}
.step-number {
  font-size: 12px;
  color: var(--muted);
  display: block;
  margin-bottom: 0.7rem;
  font-variant-numeric: tabular-nums;
}
.workflow p {
  font-size: 14px;
  color: var(--muted);
}
.page-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 2rem;
  margin: 1rem 0 2rem;
}
.page-heading h1 {
  font-size: 2.7rem;
  margin-bottom: 0.6rem;
}
.page-heading p {
  margin: 0;
}
.identity {
  max-width: 100%;
  overflow-wrap: anywhere;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  font-size: 13px;
  color: var(--muted);
}
.avatar {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-bottom: 1px solid var(--line);
  display: grid;
  place-items: center;
  color: var(--muted);
  font-family: Georgia, serif;
}
.section-nav {
  display: flex;
  gap: 2rem;
  border-bottom: 1px solid var(--line);
  margin-bottom: 2rem;
}
.section-nav a {
  padding: 0.8rem 0;
  text-decoration: none;
  font-size: 14px;
  color: var(--muted);
}
.section-nav a:hover {
  color: var(--ink);
}
.platform-list {
  display: grid;
}
.platform-entry {
  border-top: 1px solid var(--line);
}
.platform-entry:last-child {
  border-bottom: 1px solid var(--line);
}
.platform-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.5rem 0;
}
.platform-name {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.platform-name p {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  padding: 0.25rem 0;
}
.status.connected {
  color: var(--ink);
}
.platform-settings {
  margin: 0;
}
.platform-settings > summary {
  padding: 0 0 1.25rem;
  font-size: 13px;
}
.platform-body {
  padding: 0 0 1.5rem;
  max-width: 48rem;
}
.platform-body form {
  max-width: 42rem;
}
.disconnect {
  margin: 1.5rem 0 0;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
}
.disconnect > summary {
  color: var(--danger);
}
.disconnect button {
  color: var(--danger);
}
.section {
  padding: 2.5rem 0;
  border-bottom: 1px solid var(--line);
}
.section-heading {
  display: grid;
  grid-template-columns: 16rem 1fr;
  gap: 2rem;
}
.section-heading > div:first-child p {
  color: var(--muted);
  font-size: 14px;
}
.empty {
  padding: 0.25rem 0 0.75rem;
}
.empty p {
  font-size: 14px;
  color: var(--muted);
  margin: 0.4rem 0 1rem;
}
.empty h3 {
  font-size: 21px;
}
.row {
  padding: 1.2rem 0;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.row form {
  margin: 0;
}
.settings-end {
  padding-top: 2rem;
}
.settings-end > form {
  margin-top: 1.5rem;
}
.inline {
  display: inline;
}
.fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 1.5rem;
}
.auth-layout {
  display: grid;
  grid-template-columns: 1fr 1.1fr;
  gap: 5rem;
  align-items: start;
  padding: 1.5rem 0 3rem;
  max-width: 1040px;
  margin: auto;
}
.auth-intro {
  padding: 2rem 0;
}
.auth-intro h1 {
  font-size: 3.4rem;
  max-width: 24rem;
}
.auth-intro > p {
  max-width: 25rem;
  color: var(--muted);
}
.journey {
  list-style: none;
  padding: 0;
  margin: 2.5rem 0;
}
.journey li {
  display: flex;
  gap: 1rem;
  padding: 0 0 1.8rem;
  color: var(--muted);
  font-size: 13px;
}
.journey li:last-child {
  padding-bottom: 0;
}
.journey .step-dot {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
  font-size: 12px;
}
.journey .current {
  color: var(--ink);
}
.journey .current .step-dot {
  background: var(--ink);
  color: white;
  border-color: var(--ink);
}
.journey strong {
  display: block;
  font-size: 14px;
}
.auth-panel {
  border-left: 1px solid var(--line);
  padding: 2rem 0 2rem 2.5rem;
}
.auth-panel h2 {
  font-size: 1.85rem;
}
.auth-panel > p {
  font-size: 14px;
  color: var(--muted);
}
.auth-panel form > button:not(.secondary) {
  width: 100%;
  margin-top: 1rem;
}
.auth-panel .alternative {
  border-top: 1px solid var(--line);
  padding-top: 1.25rem;
  margin-top: 1.5rem;
}
.auth-panel .alternative > summary {
  font-weight: 500;
  font-size: 14px;
}
.auth-notice {
  max-width: 1040px;
  margin: auto;
}
.auth-panel .help {
  font-size: 12px;
  color: var(--muted);
  margin: 0.5rem 0 1rem;
}
.auth-panel label {
  font-size: 13px;
}
.auth-panel fieldset {
  margin: 1.5rem 0;
}
form {
  margin: 0;
}
label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin: 1rem 0 0.4rem;
}
input:not([type="checkbox"]):not([type="hidden"]),
select,
textarea {
  display: block;
  width: 100%;
  min-width: 0;
  margin-top: 0.45rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--line);
  background: var(--white);
  color: var(--ink);
  min-height: 44px;
  font-weight: 400;
}
input::placeholder {
  color: #8b8377;
}
input:hover,
select:hover,
textarea:hover {
  border-color: #a89b88;
}
input[readonly] {
  background: var(--white);
}
input[type="checkbox"] {
  accent-color: var(--accent);
  margin: 3px 0 0;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.check,
label:has(input[type="checkbox"]) {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.5;
}
.check span {
  display: block;
}
.check small {
  display: block;
  color: var(--muted);
  margin-top: 0.2rem;
}
fieldset {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 1rem 0;
  padding: 0.6rem 0 0;
  min-width: 0;
}
legend {
  font-size: 12px;
  font-weight: 500;
  padding: 0 0.6rem 0 0;
}
fieldset p {
  font-size: 12px;
  color: var(--muted);
  margin: 0.5rem 0;
}
details {
  margin: 1rem 0;
}
summary {
  cursor: pointer;
  font-weight: 500;
}
summary::marker {
  color: var(--accent);
}
details > form {
  margin-top: 1rem;
}
details p {
  margin-top: 0.8rem;
}
.method {
  border-bottom: 1px solid var(--line);
  margin: 0;
  padding: 1.25rem 0;
}
.method > summary {
  font-size: 14px;
}
.method .optional {
  float: right;
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
}
.method p {
  font-size: 13px;
  color: var(--muted);
}
.method button {
  width: 100%;
}
.method .code {
  font-family: monospace;
  font-size: 20px;
  letter-spacing: 0.3em;
}
.mfa-meta {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--line);
  padding: 0.8rem 0 1rem;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.cancel button {
  background: transparent;
  color: var(--muted);
  border: 0;
  font-weight: 400;
  padding: 0.5rem 0;
  min-height: 44px;
}
.error {
  color: var(--danger);
  border-top: 2px solid var(--danger);
  border-bottom: 1px solid var(--line);
  padding: 1rem 0;
  margin: 1rem 0;
}
.error p {
  margin: 0;
  font-size: 14px;
}
.error-code {
  display: block;
  font: 11px/1.6 monospace;
  overflow-wrap: anywhere;
  margin-top: 0.6rem;
}
.authorization {
  max-width: 800px;
  margin: 1rem auto;
}
.authorization h1 {
  font-size: 2.6rem;
}
.authorization dd {
  margin: 0 0 1rem;
  overflow-wrap: anywhere;
  font-size: 13px;
  color: var(--muted);
}
.authorization dt {
  font-size: 12px;
  font-weight: 600;
}
.authorization .auth-panel {
  border-left: 0;
  border-top: 1px solid var(--line);
  padding: 2rem 0;
}
.authorization .auth-panel form > button {
  width: auto;
}
.error-page {
  max-width: 620px;
  margin: 3rem auto;
  padding: 1rem 0;
}
.error-page h1 {
  font-size: 2.5rem;
}
.notice {
  margin: 2rem 0;
  padding: 2rem 0;
  border-top: 1px solid var(--line);
}
.notice h2 {
  font-size: 1.45rem;
}
.notice-intro {
  color: var(--muted);
  max-width: 45rem;
  font-size: 14px;
}
.notice-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.5rem 3rem;
}
.notice-grid h3 {
  font:
    500 14px/1.5 "Helvetica Neue",
    "Segoe UI",
    sans-serif;
  margin-bottom: 0.5rem;
}
.notice-grid p {
  font-size: 13px;
  color: var(--muted);
  margin: 0;
}
.notice-note {
  padding: 1rem 0;
  border-top: 1px solid var(--line);
  font-size: 13px;
  color: var(--muted);
  margin: 1.5rem 0 0;
}
.callout {
  padding: 1rem 0;
  border-top: 1px solid var(--accent);
  border-bottom: 1px solid var(--line);
  margin: 1rem 0 2rem;
  font-size: 14px;
}
pre {
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 13px/1.5 monospace;
}
@media (max-width: 900px) {
  .hero,
  .auth-layout {
    gap: 2rem;
  }
  .hero-visual {
    padding: 1rem 0;
  }
  .section-heading {
    grid-template-columns: 12rem 1fr;
    gap: 1.5rem;
  }
  .auth-intro h1 {
    font-size: 2.5rem;
  }
}
@media (max-width: 680px) {
  .site-header {
    height: 76px;
    padding: 0 1.25rem;
  }
  .header-note {
    font-size: 11px;
  }
  .brand {
    font-size: 15px;
  }
  main {
    padding: 1rem 1.25rem 3rem;
  }
  .site-footer {
    margin: 0 1.25rem;
    flex-direction: column;
  }
  .hero,
  .auth-layout {
    grid-template-columns: 1fr;
    gap: 1.5rem;
    padding: 1rem 0 2.5rem;
  }
  .hero h1 {
    font-size: 3rem;
  }
  .hero-visual {
    padding: 1rem 0;
  }
  .workflow {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  .workflow > div {
    display: grid;
    grid-template-columns: 2rem 1fr;
    column-gap: 0.8rem;
  }
  .workflow p {
    grid-column: 2;
  }
  .workflow .step-number {
    margin-top: 0.2rem;
  }
  .auth-intro {
    padding: 0.5rem 0;
  }
  .auth-intro h1 {
    font-size: 2.3rem;
    max-width: none;
  }
  .auth-intro > p {
    max-width: none;
  }
  .journey {
    display: flex;
    gap: 1rem;
    margin: 1.5rem 0 0;
  }
  .journey li {
    flex: 1;
    gap: 0.5rem;
    padding: 0;
    font-size: 11px;
  }
  .journey strong {
    font-size: 12px;
  }
  .journey li small {
    display: none;
  }
  .auth-panel {
    padding: 1.5rem 0 0;
    border-left: 0;
    border-top: 1px solid var(--line);
  }
  .notice-grid,
  .fields,
  .section-heading {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  .notice {
    padding-top: 1.5rem;
  }
  .page-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 1rem;
  }
  .page-heading h1 {
    font-size: 2.2rem;
  }
  .section-nav {
    gap: 1.25rem;
  }
  .section-nav a {
    font-size: 13px;
  }
  .platform-heading {
    padding: 1.25rem 0;
  }
  .platform-body {
    padding: 0 0 1rem;
  }
  .platform-settings > summary {
    padding: 0 0 1rem;
  }
  .platform-name {
    gap: 0.7rem;
  }
  .platform-name p {
    font-size: 12px;
  }
  .platform-icon {
    width: 36px;
    height: 36px;
  }
  .platform-name h3 {
    font-size: 17px;
  }
  .section {
    padding: 2rem 0;
  }
  .row {
    align-items: flex-start;
    flex-direction: column;
  }
  .error-page {
    padding: 1rem 0;
    margin: 1rem 0;
  }
  .error-page h1 {
    font-size: 2rem;
  }
  .mfa-meta {
    flex-wrap: wrap;
  }
}
@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
  * {
    transition: none !important;
  }
}
`;

export function page(content: string, title = "Your connections", mode = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Connect your learning platforms and choose what your MCP client can read."><title>${e(title)} · Learning MCP</title><style>${css}</style></head><body class="${e(mode)}"><a class="skip" href="#main">Skip to content</a><header class="site-header"><a class="brand" href="/landing" aria-label="Learning MCP home"><span class="brand-mark" aria-hidden="true">L</span>Learning MCP</a><span class="header-note">Read-only learning tools</span></header><main id="main">${content}</main><footer class="site-footer"><p>Independent service. Connect accounts you have permission to use.<br>Learning data is read-only. Attendance is never submitted.</p><a href="/landing#data-notice">Data &amp; permissions</a></footer></body></html>`;
}

export function signInJourney(step: 1 | 2) {
  return `<ol class="journey" aria-label="Sign-in progress"><li class="${step === 1 ? "current" : ""}"${step === 1 ? ' aria-current="step"' : ""}><span class="step-dot">${step === 2 ? "✓" : "1"}</span><span><strong>Account</strong><small>Verify your sign-in details</small></span></li><li class="${step === 2 ? "current" : ""}"${step === 2 ? ' aria-current="step"' : ""}><span class="step-dot">2</span><span><strong>Verification</strong><small>Complete MFA if requested</small></span></li><li><span class="step-dot">3</span><span><strong>Connections</strong><small>Choose your platforms</small></span></li></ol>`;
}

export function errorContent(code: string, message: string, login: boolean) {
  return `<section class="error-page"><span class="eyebrow">${login ? "Sign-in needs attention" : "Connection needs attention"}</span><h1>${code.startsWith("MFA_") ? "Verification stopped" : "We couldn’t complete this step"}</h1><div class="error" role="alert"><p>${e(message)}</p><span class="error-code">Error code: ${e(code)}</span></div><p class="muted">${login ? "Start a new sign-in to try again. Your account will be signed in only after verification succeeds." : "Return to your connections to review the account or platform details."}</p><div class="actions"><a class="button" href="${login ? "/login" : "/landing"}">${login ? "Start a new sign-in" : "Back to connections"}<span aria-hidden="true">→</span></a></div></section>`;
}
