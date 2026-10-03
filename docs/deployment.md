# Deploying Learning MCP Suite

The service consists of one public suite Worker and one private broker Worker in the same Cloudflare account. The public Worker embeds platform clients for educational reads; the broker also uses clients for session validation. Users install no local connector.

## Suite identity

Register a web application with an OIDC provider that supports authorization code flow, PKCE S256 and signed RS256/ES256 ID tokens. Okta supports this flow: [official guide](https://developer.okta.com/docs/guides/implement-grant-type/authcodepkce/main/). Register the exact callback `https://YOUR_SUITE_HOST/login/callback`. Set `OIDC_ISSUER` to the provider's exact issuer, `OIDC_CLIENT_ID`, optional `OIDC_CLIENT_SECRET`, and optional comma-separated `OIDC_ALLOWED_EMAIL_DOMAINS`. An Okta issuer may include an authorization-server path. Configuring a suite OIDC application does not register it as Moodle or OnTrack or grant platform sessions.

Set `ISSUER` to the exact public HTTPS suite origin. Configure a matching custom domain route, or enable workers.dev and use its exact origin. The checked-in origin is a placeholder, not an active deployment.

## Platform and SSO configuration

`PLATFORM_CONFIG` starts empty. Set it in both Worker configurations using the `platforms` object in [`examples/config.json`](../examples/config.json): the suite includes any enabled Ed/Moodle/OnTrack platforms; the broker includes Moodle/OnTrack. Do not paste the example’s outer object or its `course_association_example` into `PLATFORM_CONFIG`. Both configurations must agree on their shared origins. See the [configuration reference](configuration.md). Moodle and OnTrack accept administrator-configured HTTPS origins with no username, password, path, query or fragment. There is no institution-specific domain allowlist. Ed uses `https://edstem.org`; optional `ed.institution_ids` restricts its courses by verified raw institutional metadata. Models and users cannot override network destinations through tools.

Set broker `LOGIN_ORIGINS` to a JSON array of exact HTTPS origins required by the actual SSO flow, including permitted identity-provider and resource origins. Browser requests outside this set plus the configured platform origin are blocked. Enable Cloudflare Browser Run for its `BROWSER` binding. With no browser binding, verified existing-session connection remains available. The broker supports common Okta username/password/TOTP forms; test the actual login flow before claiming compatibility. Unsupported challenges require user interaction, not bypasses.

Users may supply a one-time MFA code or optional Base32 TOTP secret / otpauth URI. Password and TOTP retention is opt-in. Secrets stay in the private broker and do not appear in MCP output or administrator responses. Sessions are reusable; stored password/TOTP can reauthenticate after expiry when the provider accepts that method. TOTP does not satisfy a provider's Push, Passkey, device requirements or changed authentication policy.

## Cloudflare resources and secrets

Run `pnpm exec wrangler login` to authenticate the deployment account. Create a new KV namespace with `pnpm exec wrangler kv namespace create OAUTH_KV` and set its returned ID on the suite's `OAUTH_KV` binding. Durable Object namespaces are created through the checked-in migrations. Keep the broker's workers.dev and public routes disabled. Its service name must match the suite's `SSO_BROKER` Service Binding.

Generate two independent 32-byte AES-GCM keys encoded as Base64, one for `CREDENTIALS_KEY` in the suite and another for `BROKER_CREDENTIALS_KEY` in the broker. Generate a separate random broker service token (at least 32 characters), set as `BROKER_SERVICE_TOKEN` on both Workers. Set `OIDC_CLIENT_SECRET` if the identity provider requires it, and optionally a separate `ADMIN_TOKEN` for private grant administration.

Use pnpm to invoke Wrangler secrets; enter their values interactively:

```sh
pnpm exec wrangler secret put CREDENTIALS_KEY
pnpm exec wrangler secret put OIDC_CLIENT_SECRET
pnpm exec wrangler secret put BROKER_SERVICE_TOKEN
pnpm exec wrangler secret put BROKER_CREDENTIALS_KEY --config broker/wrangler.jsonc
pnpm exec wrangler secret put BROKER_SERVICE_TOKEN --config broker/wrangler.jsonc
```

Secrets must not be committed or pasted in chat. `.dev.vars` files are ignored for local development. Encryption does not remove the operator's access through its keys. OAuth records use KV; credentials and session state use per-user encrypted Durable Object storage with serialized broker operations. Plan appropriate retention, deletion, access control and key management for your deployment.

## Usage notice

The signed-in browser must accept the current notice before platform connection, course discovery or client access. The suite records notice version and timestamp. OAuth consent includes the same acknowledgement and remains tied to the exact client and request. This is disclosure and user confirmation, not proof of institutional approval or a waiver of operator obligations.

Review the notice against your real deployment: it discloses Cloudflare processing, client transfer of course/discussion/assessment data, password/TOTP storage, operator key access and deletion controls. Users must have the necessary account, content and AI-use permissions. Institutions and platform rules still apply regardless of the suite's branding. Read tools become available after acceptance and platform connection.

## Validate and publish

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:runtime
pnpm upstreams check
pnpm deploy:broker
pnpm deploy
```

The broker deploys first. Both build scripts are dry runs; deploy scripts verify bundled source integrity and latest official bunizao commits before publishing. If upstreams have changed, run `pnpm upstreams sync` and repeat validation.

Use two independent users to check OAuth and notice acceptance, cross-account connection link rejection, fresh enrollment discovery, user-confirmed mappings, actual Ed/Moodle/OnTrack reads and source-backed attendance search. Verify both enrolled ownership and optional Ed institution filtering. Test cloud SSO, restored cookies, automatic password/TOTP reauthentication, identity rejection, failed-login backoff, credential forgetting, disconnect deletion and immediate grant revocation. Verify no credentials appear in MCP, administration or logs. Runtime fixtures exercise the protocol but do not establish real provider approval or live SSO compatibility.

MCP client tokens issued by other services are not automatically valid: issuer, scopes, namespaces and grants must match this suite. Clients authorize this service independently.

## Deploy to Cloudflare button

Cloudflare provides an official README button for public GitHub and GitLab repositories:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/OWNER/SUITE_TEMPLATE)
```

Replace the example repository with a published deployment template containing this suite. The template's default branch must contain the intended application. A README link alone does not prepare its resources or configuration.

The current repository is not a turnkey template. Cloudflare's button does not automatically deploy multiple Workers together. The broker must exist before the public Worker's Service Binding can be deployed, and `broker/` currently depends on files and packages outside that directory. Linking a second button directly to that subdirectory would not produce an isolated application.

To offer the official template flow:

1. Prepare a standalone template for each Worker, including all of its source files and dependencies, and provide a separate button for each. Keep the broker private.
2. Declare template resources in each Wrangler configuration. Provide example secret names in `.dev.vars.example` or `.env.example`, with setup descriptions under `cloudflare.bindings` in `package.json`. Supply required values during setup rather than embedding real secrets.
3. Deploy the broker first, then configure the public Worker's binding to its actual deployed name. Both Workers need matching platform configuration and the same broker service token, with separate encryption keys.
4. Finish OIDC callback registration, the public HTTPS origin, platform origins and Browser Run configuration, then test the complete user flow.

For a single setup flow that provisions and deploys both Workers, a custom deployment workflow is needed. It must create the resources, configure both Workers, and deploy them in order; the native button does not orchestrate this automatically. Retain the manual setup below until such a workflow has been implemented and validated.

See Cloudflare's [Deploy to Cloudflare documentation](https://developers.cloudflare.com/workers/platform/deploy-buttons/) for supported provisioning, secret prompts and template limitations.
