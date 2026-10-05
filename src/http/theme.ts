/** Shared, CSS-only material system. No remote fonts, scripts or texture assets. */
export const css = `
:root {
  color-scheme: light;
  --ink: #292d29;
  --muted: #65675d;
  --paper: #f6f1e7;
  --white: #fffaf0;
  --line: #cfc6b4;
  --accent: #304b43;
  --soft: #eae3d5;
  --danger: #963e2d;
  --brass: #b18a50;
  --paper-shadow: 0 1px 1px #59492f25, 0 8px 18px #59492f12;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 2rem; }
body {
  min-height: 100dvh;
  margin: 0;
  background: radial-gradient(ellipse at 20% 0%, #eee9df 0%, transparent 65%), repeating-linear-gradient(0deg, #b4aa9910 0 1px, transparent 1px 4px), #d8d2c8;
  color: var(--ink);
  font: 15px/1.6 "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-underline-offset: 4px; }
p { margin: 0 0 1rem; text-wrap: pretty; }
h1, h2, h3 { font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif; font-weight: 500; line-height: 1.2; text-wrap: balance; }
h1 { font-size: clamp(2rem, 3.8vw, 2.8rem); letter-spacing: -.035em; margin: .5rem 0 .6rem; }
h2 { font-size: 1.75rem; letter-spacing: -.025em; margin: 0 0 .6rem; }
h3 { font-size: 1.25rem; margin: 0 0 .4rem; }
strong { font-weight: 600; }
button, input, select, textarea { font: inherit; }
button, a, input, select, textarea, summary { transition: background .18s, border-color .18s, box-shadow .18s, transform .18s; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 3px solid #886226; outline-offset: 4px; }
.sr-only, .platform-choice { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.skip { position: absolute; left: 1rem; top: -5rem; z-index: 3; background: var(--paper); padding: 1rem; }
.skip:focus { top: 1rem; }
.site-header { max-width: 1200px; min-height: 100px; padding: 1.5rem 2rem; margin: auto; display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.brand { display: flex; align-items: center; gap: 1rem; text-decoration: none; color: var(--ink); font-size: 16px; font-weight: 600; letter-spacing: -.025em; }
.brand-mark { display: block; flex-shrink: 0; width: 64px; height: 64px; }
.header-note { display: flex; align-items: center; gap: .6rem; font: 11px/1.5 "Avenir Next", sans-serif; letter-spacing: .02em; color: #55594e; }
.pilot-light, .unlit-light, .status:before { content: ""; flex-shrink: 0; width: 8px; height: 8px; border: 1px solid #5d5e49; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #f8f2d6, #b7a778 65%, #777055); box-shadow: 0 0 0 2px #6b66581a; }
.pilot-light { background: radial-gradient(circle at 35% 30%, #c9d2a7, #71835e 60%, #3c503c); }
main { position: relative; max-width: 1136px; margin: 0 auto; padding: 30px 36px 32px 60px; border: 1px solid #c2b69f; border-radius: 8px 12px 12px 8px; background: linear-gradient(90deg, #e0d5c1 0, #eae1d1 26px, var(--paper) 27px); box-shadow: 0 2px 0 #c7baa1, 0 4px 0 #eee7d7, 0 5px 0 #b7aa91, 0 15px 35px #4f483024, inset 0 1px 0 #fffdf4; }
.binder-spine { position: absolute; top: 0; left: 0; bottom: 0; width: 28px; border-right: 1px solid #bbaf985c; box-shadow: inset -3px 0 5px #80704a10; pointer-events: none; }
.binder-spine i { position: absolute; left: 7px; width: 11px; height: 38px; border: 1px solid #94836c; border-radius: 5px; background: linear-gradient(90deg, #7b7566, #dedbcf 30%, #f7f2dc 45%, #bbb5a0 64%, #7a7465); box-shadow: 2px 3px 3px #67573c30; }
.binder-spine i:nth-child(1) { top: 155px; }
.binder-spine i:nth-child(2) { top: 420px; }
.binder-spine i:nth-child(3) { bottom: 110px; }
.page-heading { display: flex; justify-content: space-between; align-items: center; gap: 2rem; margin: 0 0 1.7rem; }
.page-heading p { margin: 0; }
.eyebrow, .paper-label, .folio-label { font: 600 10px/1.5 "Avenir Next", sans-serif; letter-spacing: .13em; text-transform: uppercase; color: #706344; }
.folio-label { border: 1px solid #c6bda6; padding: .4rem .6rem; white-space: nowrap; transform: rotate(-2deg); }
.muted { font-size: 14px; color: var(--muted); }
.small { font-size: 12px; }
.identity { display: flex; align-items: center; gap: .7rem; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; min-width: 0; }
.section-nav { display: flex; gap: 5px; border-bottom: 1px solid #b8aa8e; margin: 0 0 26px; padding: 0 4px; }
.section-nav a, .section-nav > span { position: relative; padding: 12px 18px 10px; border: 1px solid #c4b69b; border-bottom: 0; border-radius: 7px 7px 0 0; background: linear-gradient(#e9dfca, #dcd0b8); box-shadow: inset 0 1px 0 #fff7e5; text-decoration: none; color: #5d5a4d; font-size: 12px; font-weight: 600; white-space: nowrap; }
.section-nav a:hover { background: #eee6d7; transform: translateY(-2px); }
main:not(:has(.workspace-panel:target)) .section-nav a[href="#platforms"], main:has(#platforms:target) .section-nav a[href="#platforms"], main:has(#courses:target) .section-nav a[href="#courses"], main:has(#clients:target) .section-nav a[href="#clients"], main:has(#sign-in:target) .section-nav a[href="#sign-in"], .welcome-tabs > span:first-child { background: var(--paper); color: var(--accent); box-shadow: inset 0 3px 0 var(--accent), 0 1px 0 var(--paper); }
.workspace-panel { display: none; scroll-margin-top: 240px; }
.workspace-panel:target, .workspace-panels:not(:has(> .workspace-panel:target)) > #platforms { display: block; }
.panel-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 2rem; margin-bottom: 16px; }
.panel-heading h2 { font-size: 1.35rem; }
.panel-heading p { font-size: 12px; color: var(--muted); margin: 0; max-width: 360px; }
.platform-workbench, .welcome-workbench { border: 1px solid #acaa94; border-radius: 7px; background: linear-gradient(90deg, #304b43 0 292px, #e6ddcb 292px); box-shadow: inset 0 1px 1px #fff9e048, 0 3px 0 #c2bba7, 0 7px 14px #4b432517; }
.platform-workbench { position: relative; display: grid; grid-template-columns: 252px minmax(0, 1fr); grid-template-rows: repeat(3, 132px) minmax(0, 1fr); column-gap: 40px; padding: 20px; margin: 0; min-width: 0; }
.platform-slot { display: contents; }
.platform-slot[data-platform="ed"] > label { grid-row: 1; }
.platform-slot[data-platform="moodle"] > label { grid-row: 2; }
.platform-slot[data-platform="ontrack"] > label { grid-row: 3; }
.platform-heading { position: relative; grid-column: 1; margin: 0 0 12px; padding: 16px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 8px; border: 1px solid #19352b; border-radius: 5px; background: linear-gradient(145deg, #52685b, #3b554a 55%, #314b40); color: #f4f0dc; cursor: pointer; box-shadow: inset 0 1px 0 #f1f0ca26, 0 3px 0 #1c362c, 0 4px 5px #172c273b; transition: transform .18s, box-shadow .18s; }
.platform-heading:hover { transform: translateY(-1px); }
.platform-choice:checked + .platform-slot > .platform-heading { background: linear-gradient(140deg, #687869, #52634f); border-color: #bcaa78; box-shadow: inset 0 1px 0 #f1efd64d, 0 2px 0 #223b2d; }
.platform-choice:focus-visible + .platform-slot > .platform-heading { outline: 3px solid #f2d99b; outline-offset: 3px; }
.platform-name { display: flex; align-items: center; gap: 12px; min-width: 0; }
.platform-name strong { font-size: 14px; }
.platform-description { display: block; font-size: 10px; font-weight: 400; color: #d2dacb; }
.platform-icon { display: block; flex-shrink: 0; width: 58px; height: 64px; }
.status { display: inline-flex; align-items: center; gap: 7px; font-size: 11px; color: var(--muted); line-height: 1.4; }
.status:before { width: 7px; height: 7px; background: radial-gradient(circle at 35% 30%, #c6c4b3, #8c8d7d); }
.status.connected:before { border-color: #5d7350; background: radial-gradient(circle at 35% 30%, #e7eed0, #8fa774 60%, #53704c); }
.status.attention:before { background: radial-gradient(circle at 35% 30%, #f6dda8, #c79951 60%, #97652a); }
.platform-heading .status { color: #e5e6d6; padding-left: 70px; }
.platform-sheet { display: none; grid-column: 2; grid-row: 1 / span 4; align-self: stretch; position: relative; min-width: 0; padding: 24px; border: 1px solid #cec4ae; border-radius: 2px 5px 5px 2px; background: linear-gradient(100deg, #ece4d2, #fffaf0 5%, #f6f1e7); box-shadow: var(--paper-shadow); }
.platform-choice:checked + .platform-slot > .platform-sheet { display: block; animation: sheet-in .2s ease-out; }
.sheet-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; border-bottom: 1px solid var(--line); margin-bottom: 20px; padding-bottom: 16px; }
.sheet-heading h2 { margin: 0; font-size: 1.7rem; }
.sheet-heading .status { text-align: right; }
.engraved { font: 600 10px/1.5 "Avenir Next", sans-serif; letter-spacing: .11em; text-transform: uppercase; color: #cbd0b9; text-shadow: 0 1px 1px #183629; }
.platform-body { max-width: 100%; }
.platform-body > p { font-size: 13px; }
.platform-body > details { border-top: 1px solid var(--line); padding: 12px 0; margin: 0; }
.platform-body > details[open] { padding-bottom: 20px; }
.platform-body .disconnect { margin-top: 18px; border-top: 1px solid var(--line); border-bottom: 0; }
.disconnect > summary { color: var(--danger); }
.disconnect button { color: var(--danger); }
.sheet-footnote { border-top: 1px solid var(--line); padding-top: 14px; margin: 22px 0 0; font-size: 11px; color: var(--muted); }
.welcome-workbench { display: grid; grid-template-columns: 292px minmax(0, 1fr); }
.device-rack { padding: 28px 22px; }
.rack-heading { padding: 0 4px 16px; border-bottom: 1px solid #a8b59b30; }
.rack-caption { display: block; color: #d2dacb; font-size: 11px; margin-top: 5px; }
.welcome-device { display: flex; gap: 12px; align-items: center; margin: 18px 0; padding: 14px 12px; border: 1px solid #203a2f; border-radius: 5px; background: linear-gradient(135deg, #526658, #3a5247); box-shadow: inset 0 1px 0 #f4eddc22, 0 3px 0 #203a30; color: #f2efdd; }
.welcome-device strong { font-size: 13px; }
.welcome-device p { font-size: 10px; margin: 2px 0 0; color: #d2dacb; }
.unlit-light { margin-left: auto; width: 6px; height: 6px; background: #89917e; }
.rack-footnote { color: #d2dacb; font-size: 11px; margin: 28px 4px 0; }
.welcome-sheet { padding: 28px 34px; margin: 18px; border: 1px solid var(--line); border-radius: 3px; background: linear-gradient(100deg, #eee6d7, #fffaf0 4%, #f6f1e7); box-shadow: var(--paper-shadow); }
.welcome-sheet h2 { font-size: 2rem; margin-top: 12px; }
.welcome-sheet > p { color: var(--muted); font-size: 14px; max-width: 400px; }
.setup-list { list-style: none; padding: 0; margin: 24px 0; }
.setup-list li { display: flex; align-items: baseline; gap: 16px; padding: 12px 0; border-top: 1px solid var(--line); }
.setup-list li > span { font: 11px/1.5 monospace; color: #887654; }
.setup-list strong { font-size: 13px; }
.setup-list p { margin: 2px 0 0; color: var(--muted); font-size: 12px; }
.button, button { display: inline-flex; align-items: center; justify-content: center; gap: .75rem; min-height: 44px; padding: .7rem 1.2rem; border: 1px solid #8b6a38; border-radius: 5px; background: linear-gradient(#e0c796, #cbae75 50%, #bea064); color: #342b1d; box-shadow: inset 0 1px 0 #fff1c4, 0 3px 0 #886b3f, 0 4px 5px #55402726; font-weight: 600; font-size: 13px; text-decoration: none; cursor: pointer; }
.button:hover, button:hover { background: linear-gradient(#ebd4a3, #d4b983); }
.button:active, button:active { transform: translateY(2px); box-shadow: inset 0 1px 2px #73552d25, 0 1px 0 #886b3f; }
button.secondary, .button.secondary { background: linear-gradient(#faf5e9, #e9e0ce); border-color: #b9ad93; color: var(--ink); box-shadow: inset 0 1px 0 #fffdf6, 0 2px 0 #b9ac90; }
button.secondary:hover, .button.secondary:hover { background: #f8f0de; }
button:disabled { opacity: .55; cursor: not-allowed; transform: none; }
.actions { display: flex; align-items: center; flex-wrap: wrap; gap: 1rem; margin-top: 1.5rem; }
.paper-panel { padding: 26px; border: 1px solid var(--line); border-radius: 3px; background: var(--white); box-shadow: var(--paper-shadow); }
.section-heading { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 28px; }
.section-heading > div:first-child p { color: var(--muted); font-size: 13px; }
.empty { padding: 22px; border: 1px dashed #c9bda5; border-radius: 3px; background: #f3ecdc; }
.empty h3 { font-size: 1.5rem; }
.empty p { font-size: 13px; color: var(--muted); margin: .4rem 0 0; }
.row { position: relative; padding: 18px; margin-bottom: 12px; border: 1px solid var(--line); border-radius: 3px; display: flex; align-items: center; justify-content: space-between; gap: 1rem; background: linear-gradient(100deg, #f0e7d4, #fffaf0 5%); box-shadow: 0 2px 0 #ddd2bd; }
.row strong { font-size: 14px; }
.row .muted { font-size: 12px; margin-top: 5px; }
.row form { flex-shrink: 0; }
.client-file { padding: 22px 24px; margin-bottom: 18px; border-top: 2px solid #b8a785; background: linear-gradient(100deg, #ede4d1, #fffaf0 6%, #f8f3e8); box-shadow: 0 2px 3px #59492f16; }
.client-file-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.client-file-heading h3 { min-width: 0; overflow-wrap: anywhere; margin: 0; font-size: 23px; }
.client-file-heading form { flex-shrink: 0; }
.client-file-heading button { font-size: 12px; min-height: 40px; padding: 8px 12px; }
.client-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin: 22px 0; }
.client-facts dt { font-size: 11px; color: var(--muted); margin-bottom: 5px; }
.client-facts dd { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.client-facts time { font-variant-numeric: tabular-nums; }
.client-permissions { grid-column: 1 / -1; }
.client-permissions ul { margin: 0; padding-left: 18px; }
.client-permissions li + li { margin-top: 3px; }
.client-details { border-top: 1px solid var(--line); }
.client-details summary { font-size: 12px; }
.client-details .connection-record { margin-bottom: 0; }
.client-details code { font-size: 12px; }

.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 1.5rem; }
.inline { display: inline; }
.auth-layout { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 30px; align-items: start; margin: 8px 0 28px; }
.auth-intro { padding: 26px 20px 26px 0; }
.auth-intro h1 { font-size: 2.6rem; max-width: 300px; }
.auth-intro > p { color: var(--muted); font-size: 14px; max-width: 310px; }
.journey { list-style: none; padding: 0; margin: 30px 0; }
.journey li { display: flex; gap: 14px; padding-bottom: 24px; color: var(--muted); font-size: 12px; }
.journey li:last-child { padding-bottom: 0; }
.step-dot { display: grid; place-items: center; flex-shrink: 0; width: 30px; height: 30px; border: 1px solid #bfb297; border-radius: 4px; background: linear-gradient(#f9f3e5, #e0d4bd); box-shadow: inset 0 1px 0 #fff9ea, 0 2px 0 #b9ac92; font-size: 11px; }
.journey .current { color: var(--accent); }
.journey .current .step-dot { background: linear-gradient(#56695b, #304b43); border-color: #304b43; color: #fff8e3; box-shadow: inset 0 1px 0 #95a18a, 0 2px 0 #20392e; }
.journey strong, .journey small { display: block; }
.journey strong { font-size: 13px; }
.auth-panel { min-width: 0; padding: 28px; border: 1px solid var(--line); border-radius: 4px; background: linear-gradient(100deg, #eee5d3, #fffaf0 4%); box-shadow: var(--paper-shadow); }
.auth-panel h2 { font-size: 1.7rem; }
.auth-panel > p { color: var(--muted); font-size: 13px; }
.auth-panel form > button:not(.secondary) { width: 100%; margin-top: 18px; }
.auth-panel .alternative { padding-top: 18px; margin-top: 24px; border-top: 1px solid var(--line); }
.help { font-size: 12px; color: var(--muted); margin: 8px 0 12px; }
form { margin: 0; }
label { display: block; font-size: 13px; font-weight: 500; margin: 16px 0 6px; }
input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea { display: block; width: 100%; min-width: 0; margin-top: 7px; padding: 11px 12px; min-height: 44px; border: 1px solid #bcb39f; border-radius: 4px; background: #f9f5eb; box-shadow: inset 0 2px 3px #54472d13, 0 1px 0 #fffdf4; color: var(--ink); font-weight: 400; }
input::placeholder { color: #77766a; }
input:hover, select:hover, textarea:hover { border-color: #8a866e; }
input[readonly] { background: #ece7da; }
input[type="checkbox"] { accent-color: var(--accent); margin: 3px 0 0; width: 17px; height: 17px; flex-shrink: 0; }
.check, label:has(input[type="checkbox"]) { display: flex; align-items: flex-start; gap: 10px; font-size: 12px; font-weight: 400; line-height: 1.6; }
.check span, .check small { display: block; }
.check small { color: var(--muted); margin-top: 3px; }
fieldset:not(.platform-workbench) { border: 1px solid var(--line); border-radius: 4px; margin: 20px 0; padding: 12px 16px; min-width: 0; background: #eee7d64d; }
legend { font-size: 11px; font-weight: 600; padding: 0 6px; }
fieldset p { font-size: 12px; color: var(--muted); margin: 6px 0; }
details { margin: 16px 0; }
summary { cursor: pointer; font-size: 13px; font-weight: 600; min-height: 30px; padding: 4px 0; }
summary::marker { color: var(--accent); }
details > form { margin-top: 12px; }
details p { margin-top: 10px; font-size: 13px; }
.method { border-bottom: 1px solid var(--line); padding: 16px 0; margin: 0; }
.method .optional { float: right; color: var(--muted); font-size: 11px; font-weight: 400; }
.method p { color: var(--muted); }
.method button { width: 100%; }
.method .code { font: 20px/1.5 monospace; letter-spacing: .3em; }
.mfa-meta { display: flex; justify-content: space-between; gap: 12px; border: 1px solid #c3b18d; border-radius: 3px; background: #eee3cb; padding: 10px 12px; color: #655d4b; font-size: 11px; font-variant-numeric: tabular-nums; }
.cancel button { color: var(--muted); }
.error { color: var(--danger); border: 1px solid #ba7964; border-left: 3px solid var(--danger); background: #f3e6d9; border-radius: 3px; padding: 14px; margin: 16px 0; }
.error p { margin: 0; font-size: 13px; }
.error-code { display: block; font: 11px/1.6 monospace; overflow-wrap: anywhere; margin-top: 8px; }
.authorization { max-width: 740px; margin: 8px auto; }
.authorization h1 { font-size: 2.4rem; }
.authorization dd { margin: 0 0 16px; overflow-wrap: anywhere; font-size: 12px; color: var(--muted); }
.authorization dt { font-size: 12px; font-weight: 600; }
.authorization .auth-panel { margin-top: 24px; }
.error-page { max-width: 620px; margin: 20px auto; padding: 24px; border: 1px solid var(--line); border-radius: 3px; background: var(--white); box-shadow: var(--paper-shadow); }
.error-page h1 { font-size: 2.2rem; }
.notice { margin: 28px 0 16px; padding: 24px; border: 1px solid #c9bea6; border-radius: 4px; background: #eee7d6; box-shadow: inset 0 1px 0 #fff9e8; }
.notice h2 { font-size: 1.35rem; }
.notice-intro { color: var(--muted); max-width: 680px; font-size: 13px; }
.notice-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 30px; }
.notice-grid h3 { font: 600 12px/1.5 "Avenir Next", sans-serif; margin-bottom: 6px; }
.notice-grid p { font-size: 12px; color: #585d51; margin: 0; }
.notice > p:not(.notice-intro) { font-size: 12px; margin-top: 20px; }
.notice-note { padding-top: 14px; border-top: 1px solid #c9bea6; color: #585d51; }
.callout { border: 1px solid #b9ad86; border-left: 3px solid var(--brass); border-radius: 3px; background: #eee4ca; padding: 14px 18px; margin: 16px 0 24px; font-size: 13px; }
pre { overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.6 monospace; }
.legal-page { max-width: 820px; margin: 12px auto 24px; padding: 28px; background: var(--white); border: 1px solid var(--line); border-radius: 3px; box-shadow: var(--paper-shadow); }
.legal-page h1 { font-size: 2.3rem; }
.legal-page h2 { margin-top: 28px; font-size: 1.35rem; }
.legal-page p, .legal-page dd { font-size: 14px; line-height: 1.8; overflow-wrap: anywhere; }
.legal-page .callout h2 { margin-top: 0; }
.legal-table { overflow-x: auto; }
.legal-table table { width: 100%; border-collapse: collapse; font-size: 13px; }
.legal-table th, .legal-table td { padding: 14px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
.legal-table th:first-child { width: 30%; }
.legal-controls dt { font-weight: 600; margin-top: 16px; }
.legal-controls dd { margin: 6px 0 16px; }
.site-footer { max-width: 1136px; padding: 16px 6px 28px; margin: auto; display: flex; justify-content: flex-end; color: #57594f; font-size: 11px; }
.site-footer p { margin: 0; max-width: 600px; }
.site-footer nav { display: flex; gap: 16px; flex-wrap: wrap; align-content: flex-start; }

.material-art { display: block; width: 100%; height: 100%; overflow: visible; }
.notice-file { border: 1px solid #c9bea6; border-radius: 4px; background: linear-gradient(#f3eddc, #e9dfca); box-shadow: inset 0 1px 0 #fff9e8, 0 2px 0 #cbbda1; margin: 22px 0 0; scroll-margin-top: 20px; }
.notice-file > summary { display: flex; align-items: center; gap: 12px; padding: 14px 18px; list-style: none; font-size: 12px; }
.notice-file > summary::-webkit-details-marker { display: none; }
.notice-file > summary:after { content: "+"; margin-left: auto; font-size: 20px; font-weight: 400; color: #756343; }
.notice-file[open] > summary:after { content: "−"; }
.notice-file small { display: block; font-size: 10px; font-weight: 400; color: #686352; margin-top: 2px; }
.notice-file-icon { position: relative; display: block; width: 24px; height: 30px; flex-shrink: 0; border: 1px solid #b8a781; border-radius: 2px; background: repeating-linear-gradient(0deg, transparent 0 5px, #bca982 5px 6px), linear-gradient(120deg, #fff7df, #decca7); background-size: 14px 18px, auto; background-position: center 7px, 0 0; background-repeat: no-repeat; box-shadow: 1px 2px 0 #b6a382; transform: rotate(-5deg); }
.notice-file .notice { scroll-margin-top: 24px; margin: 0; border: 0; border-top: 1px solid #c9bea6; border-radius: 0 0 4px 4px; box-shadow: none; }
.auth-panel > .notice-file { margin: 0 0 24px; }
.auth-panel .notice-file .notice-grid { grid-template-columns: minmax(0, 1fr); }
.service-info { margin: 0; max-width: 390px; }
.service-info > summary { color: #626050; font-size: 11px; min-height: 44px; padding: 10px 4px; text-align: right; }
.service-info > div { padding: 16px; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); box-shadow: var(--paper-shadow); }
.service-info p { font-size: 11px; margin: 0 0 10px; }
.connection-record { margin: 0 0 22px; }
.connection-record dt { font-size: 11px; color: var(--muted); margin-top: 14px; }
.connection-record dd { font-size: 14px; margin: 4px 0 0; overflow-wrap: anywhere; }
.account-exit { margin-top: 28px; padding-top: 22px; border-top: 1px solid var(--line); }
.account-exit form { display: flex; align-items: center; flex-wrap: wrap; gap: 18px; }
.account-exit p { margin: 0; }

@keyframes sheet-in { from { opacity: .6; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 1100px) {
  main { margin: 0 20px; padding: 26px 28px 28px 50px; }
  .site-footer { padding-inline: 24px; }
  .section-nav a, .section-nav > span { padding-inline: 14px; }
  .platform-workbench { grid-template-columns: 222px minmax(0, 1fr); column-gap: 30px; background: linear-gradient(90deg, #304b43 0 257px, #e6ddcb 257px); padding: 18px; }
  .platform-heading { padding: 12px; }
  .platform-sheet { padding: 20px; }
}
@media (max-width: 800px) {
  .page-heading { align-items: flex-start; }
  .folio-label { display: none; }
  .welcome-workbench { grid-template-columns: 230px minmax(0, 1fr); background: linear-gradient(90deg, #304b43 0 230px, #e6ddcb 230px); }
  .device-rack { padding: 22px 14px; }
  .welcome-device { padding: 12px 8px; gap: 8px; }
  .welcome-sheet { padding: 24px; margin: 14px; }
  .auth-layout { gap: 20px; grid-template-columns: minmax(0, .75fr) minmax(0, 1.25fr); }
  .auth-intro h1 { font-size: 2.1rem; }
  .auth-panel { padding: 22px; }
  .section-heading { grid-template-columns: 1fr; gap: 16px; }
  .panel-heading { display: block; }
  .panel-heading p { max-width: none; }
}
@media (max-width: 650px) {
  .site-header { min-height: 86px; padding: 20px 18px; }
  .brand { font-size: 14px; gap: 10px; }
  .brand-mark { width: 52px; height: 52px; }
  .header-note { font-size: 10px; max-width: 90px; }
  main { margin: 0 10px; padding: 22px 16px 24px 24px; background: var(--paper); }
  .binder-spine { width: 9px; }
  .binder-spine i { display: none; }
  h1 { font-size: 1.9rem; }
  .page-heading { flex-direction: column; gap: 12px; margin-bottom: 20px; }
  .page-heading .muted { font-size: 12px; }
  .identity { font-size: 11px; }
  .section-nav { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 3px; padding: 0; margin-bottom: 20px; }
  .section-nav.welcome-tabs { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .section-nav a, .section-nav > span { display: flex; align-items: center; justify-content: center; min-height: 42px; padding: 8px 4px; font-size: 10px; line-height: 1.4; white-space: normal; text-align: center; }
  .welcome-workbench { grid-template-columns: minmax(0, 1fr); background: #304b43; }
  .device-rack { padding: 20px 18px 10px; }
  .rack-heading { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .rack-caption { margin: 0; }
  .welcome-device { margin: 12px 0; padding: 10px 12px; }
  .welcome-device .platform-icon { width: 46px; height: 50px; }
  .welcome-device p { font-size: 11px; }
  .rack-footnote { margin: 16px 4px 0; }
  .welcome-sheet { margin: 12px; padding: 24px 20px; }
  .welcome-sheet h2 { font-size: 1.7rem; }
  .platform-workbench { grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: 92px auto; column-gap: 8px; row-gap: 14px; padding: 12px; background: linear-gradient(#304b43 0 116px, #e6ddcb 116px); }
  .platform-slot[data-platform] > label { grid-row: 1; }
  .platform-slot[data-platform="ed"] > label { grid-column: 1; }
  .platform-slot[data-platform="moodle"] > label { grid-column: 2; }
  .platform-slot[data-platform="ontrack"] > label { grid-column: 3; }
  .platform-heading { padding: 8px 4px; margin: 0; align-items: center; }
  .platform-name { flex-direction: column; gap: 6px; text-align: center; }
  .platform-name strong { font-size: 10px; line-height: 1.3; }
  .platform-name .platform-icon { width: 38px; height: 42px; }
  .platform-heading .platform-description, .platform-heading .status { display: none; }
  .platform-sheet { grid-column: 1 / -1; grid-row: 2; padding: 18px 14px; }
  .sheet-heading { gap: 10px; }
  .sheet-heading h2 { font-size: 1.5rem; }
  .sheet-heading .status { max-width: 90px; font-size: 10px; }
  .paper-label { font-size: 9px; }
  .paper-panel, .notice, .legal-page { padding: 20px 16px; }
  .row { align-items: flex-start; flex-direction: column; padding: 14px; }
  .client-file { padding: 18px 16px; }
  .client-file-heading { flex-direction: column; align-items: flex-start; gap: 10px; }
  .client-facts { grid-template-columns: 1fr; gap: 16px; }

  .fields, .notice-grid, .auth-layout { grid-template-columns: minmax(0, 1fr); }
  .auth-layout { gap: 16px; }
  .auth-intro { padding: 0; }
  .auth-intro h1, .auth-intro > p { max-width: none; }
  .journey { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }
  .journey li { padding: 0; gap: 8px; flex-direction: column; }
  .journey small { display: none; }
  .auth-panel { padding: 20px 16px; }
  .mfa-meta { flex-wrap: wrap; }
  .authorization h1 { font-size: 2rem; }
  .notice-grid { gap: 18px; }
  .site-footer { flex-direction: column; padding: 24px 20px; gap: 14px; }
  .error-page { padding: 16px; }
  .legal-table th, .legal-table td { padding: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *:before, *:after { transition: none !important; animation: none !important; }
}
`;
