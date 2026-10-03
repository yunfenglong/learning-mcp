# Native browser form regression

Run this fixture using Node.js 24 or later:

```sh
node --experimental-transform-types tests/browser/origin-check.mjs
```

Open `http://localhost:4179` in a real browser and click **Check form submission**. The page must show **PASS: same-origin form accepted**. The fixture imports the application's actual HTTP response headers and uses a native form, with no scripted fetch, credentials or platform calls. A `no-referrer` policy instead produces `Origin: null` and the failure signal. Stop the server after checking.

This complements the workerd tests, whose synthetic requests set Origin explicitly and cannot reproduce a browser's header generation. After deployment, also submit synthetic data with an unsupported provider from the real login page. It must reach **This SSO provider is not supported by this service**, rather than **Open the sign-in page again**. Never use real credentials for this check.
