# Deploying Learning MCP Suite

The service consists of one public suite Worker and one private broker Worker in the same Cloudflare account. The public Worker embeds platform clients for educational reads; the broker also uses clients for session validation. Users install no local connector.

## Suite identity

Users sign in on `/login` with a configured Moodle / OnTrack base link, SSO username, password and optional TOTP secret or one-time MFA code. The private broker starts a fresh cloud browser and verifies the resulting platform session before establishing the suite account. Ed users can sign in with a verified API token. No separate OIDC application or callback registration is required.

Accounts are anchored to the verified platform, its origin and its authenticated user ID. Users must return through the same platform for future sign-ins; signing in independently through another platform creates a different suite account. Connect additional platforms from the signed-in account page. Password / TOTP retention requires an explicit checkbox; one-time codes are not stored.

Set `ISSUER` to the exact public HTTPS suite origin. Configure a matching custom domain route, or enable workers.dev and use its exact origin. The checked-in origin is a placeholder, not an active deployment.

## Platform and SSO configuration

`PLATFORM_CONFIG` starts empty. Set it in both Worker configurations using the `platforms` object in [`examples/config.json`](../examples/config.json): the suite includes any enabled Ed/Moodle/OnTrack platforms; the broker includes Moodle/OnTrack. Do not paste the example’s outer object or its `course_association_example` into `PLATFORM_CONFIG`. Both configurations must agree on their shared origins. See the [configuration reference](configuration.md). Moodle and OnTrack accept administrator-configured HTTPS origins with no username, password, path, query or fragment. There is no institution-specific domain allowlist. Ed uses `https://edstem.org`; optional `ed.institution_ids` restricts its courses by verified raw institutional metadata. Models and users cannot override network destinations through tools.

Set broker `LOGIN_ORIGINS` to a JSON array of exact HTTPS origins required by the actual SSO flow, including permitted identity-provider and resource origins. Browser requests outside this set plus the configured platform origin are blocked. Enable Cloudflare Browser Run for its `BROWSER` binding. With no browser binding, verified existing-session connection remains available. The broker supports common Okta username/password/TOTP forms; test the actual login flow before claiming compatibility. Unsupported challenges require user interaction, not bypasses.

Users may supply a one-time MFA code or optional Base32 TOTP secret / otpauth URI. Password and TOTP retention is opt-in. Secrets stay in the private broker and do not appear in MCP output or administrator responses. Sessions are reusable; stored password/TOTP can reauthenticate after expiry when the provider accepts that method. TOTP does not satisfy a provider's Push, Passkey, device requirements or changed authentication policy.

## Cloudflare resources and secrets

Run `pnpm exec wrangler login` to authenticate the deployment account. Create a new KV namespace with `pnpm exec wrangler kv namespace create OAUTH_KV` and set its returned ID on the suite's `OAUTH_KV` binding. Durable Object namespaces are created through the checked-in migrations. Keep the broker's workers.dev and public routes disabled. Its service name must match the suite's `SSO_BROKER` Service Binding.

The default configuration uses the account plan's CPU limits. Explicit `limits.cpu_ms` settings require Workers Paid; Free deployments must omit that setting. Available CPU and Browser Run quotas still depend on the account plan and workload.

Generate two independent 32-byte AES-GCM keys encoded as Base64, one for `CREDENTIALS_KEY` in the suite and another for `BROKER_CREDENTIALS_KEY` in the broker. Generate a separate random broker service token (at least 32 characters), set as `BROKER_SERVICE_TOKEN` on both Workers. Set an optional separate `ADMIN_TOKEN` for private grant administration.

Use pnpm to invoke Wrangler secrets; enter their values interactively:

```sh
pnpm exec wrangler secret put CREDENTIALS_KEY
pnpm exec wrangler secret put BROKER_SERVICE_TOKEN
pnpm exec wrangler secret put BROKER_CREDENTIALS_KEY --config broker/wrangler.jsonc
pnpm exec wrangler secret put BROKER_SERVICE_TOKEN --config broker/wrangler.jsonc
```

Secrets must not be committed or pasted in chat. `.dev.vars` files are ignored for local development. Encryption does not remove the operator's access through its keys. OAuth records use KV; credentials and session state use per-user encrypted Durable Object storage with serialized broker operations. Plan appropriate retention, deletion, access control and key management for your deployment.

For deployment-specific origins and resource IDs, keep separate Wrangler configurations under the ignored `.wrangler/deploy/` directory. Set their entrypoints to the project source and invoke the deployment wrapper with `--config`. Wrangler also accepts a local JSON secrets file through `--secrets-file`, uploading code and secrets together. Restrict these files to the operator, retain stable encryption keys across redeployments, and back them up securely. Do not replace real values with placeholders during a redeployment.

```sh
pnpm run deploy --config .wrangler/deploy/learning-sso-broker.jsonc --secrets-file .wrangler/deploy/broker-secrets.private.json
pnpm run deploy --config .wrangler/deploy/learning-mcp.jsonc --secrets-file .wrangler/deploy/suite-secrets.private.json
```

These operator files must be prepared for the target account; they are not included in the repository. This setup keeps real platform configuration out of project history.

## Usage notice

The signed-in browser must accept the current notice before platform connection, course discovery or client access. The suite records notice version and timestamp. OAuth consent includes the same acknowledgement and remains tied to the exact client and request. This is disclosure and user confirmation, not proof of institutional approval or a waiver of operator obligations.

Document the actual infrastructure providers and their data handling for your deployment. The supplied Worker deployment uses Cloudflare. Keep configured platform and SSO origins in operator configuration; do not display them in account pages or public metadata. Review the notice against your real deployment: it discloses service and infrastructure-provider processing, client transfer of course/discussion/assessment data, password/TOTP storage, operator key access and deletion controls. Users must have the necessary account, content and AI-use permissions. Institutions and platform rules still apply regardless of the suite's branding. Read tools become available after acceptance and platform connection.

## Validate and publish

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:runtime
pnpm upstreams check
pnpm deploy:broker
pnpm run deploy
```

The broker deploys first. Both build scripts are dry runs; deploy scripts verify bundled source integrity and latest official bunizao commits before publishing. If upstreams have changed, run `pnpm upstreams sync` and repeat validation.

Use two independent users to check OAuth and notice acceptance, cross-account connection link rejection, fresh enrollment discovery, user-confirmed mappings, actual Ed/Moodle/OnTrack reads and source-backed attendance search. Verify both enrolled ownership and optional Ed institution filtering. Test cloud SSO, restored cookies, automatic password/TOTP reauthentication, identity rejection, failed-login backoff, credential forgetting, disconnect deletion and immediate grant revocation. Verify no credentials appear in MCP, administration or logs. Runtime fixtures exercise the protocol but do not establish real provider approval or live SSO compatibility.

MCP client tokens issued by other services are not automatically valid: issuer, scopes, namespaces and grants must match this suite. Clients authorize this service independently.

## Deploy to Cloudflare button

The planned button-based setup uses two deployments in the same Cloudflare account: **Deploy SSO Broker**, followed by **Deploy Learning MCP**. These steps are for the self-hosting operator. ChatGPT users connect to the resulting MCP endpoint and bind their accounts; they do not deploy either Worker.

Cloudflare provides an official README button for public GitHub and GitLab repositories. It does not deploy multiple Workers together. This project is hosted at `yunfenglong/learning-mcp` as a private repository, so it is not a public deployment template. The example below shows button syntax only and is not a working deployment link:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yunfenglong/learning-mcp)
```

Before publishing buttons, publish the generated templates in a public repository and use that repository's URL. The project repository can remain private. Verify that each link selects the intended deployment template and release branch. A root link to a repository whose default branch contains a different application is not a valid suite deployment button.

### Step 1: Deploy SSO Broker

Deploy the private broker first. Set its platform origins and `LOGIN_ORIGINS`, enable Browser Run for the `BROWSER` binding, and supply `BROKER_CREDENTIALS_KEY` and `BROKER_SERVICE_TOKEN` as secrets. Keep public routes, workers.dev and preview URLs disabled. Record the deployed Worker name for the second step; the public suite reaches it through a Service Binding, so the broker needs no public URL.

### Step 2: Deploy Learning MCP

Deploy the public suite and point its `SSO_BROKER` Service Binding at the name from step 1. Set its public `ISSUER` and platform origins. Supply a separate `CREDENTIALS_KEY`, the **same** `BROKER_SERVICE_TOKEN` used by the broker. The Moodle and OnTrack origins must agree between both Workers.

Cloudflare can provision supported resources such as KV and Durable Objects from template configuration. Browser Run enablement and matching settings between the two deployments remain setup tasks. The buttons must explain these tasks rather than promise zero configuration.

### Template preparation and current status

The two deployable templates and their buttons are not implemented yet. The current `broker/` directory imports shared source and dependencies outside that directory; pointing a button directly at it would fail because Cloudflare treats a selected subdirectory as the new repository root. Use the manual deployment instructions above until both templates are prepared and validated.

Prepare the templates as follows:

1. Generate two self-contained directories, planned as `deploy/sso-broker/` and `deploy/learning-mcp/`, from the same project source. Each must include its required source, shared modules, vendored clients, upstream metadata, scripts, Wrangler configuration, `package.json` and pnpm lockfile. Do not maintain separate hand-edited copies of shared code.
2. Give each template its own pnpm build and deploy commands. Preserve bundled-source integrity checks and the latest bunizao upstream check before deployment. Builds must not depend on files outside the selected template directory.
3. Declare resources in each Wrangler configuration. Add placeholder secret names in `.dev.vars.example` or `.env.example` and setup descriptions under `cloudflare.bindings` in `package.json`. Include instructions for the shared broker service token and independent encryption keys; never include real secrets in generated templates or button URLs.
4. Verify that the broker remains private after button deployment, that the public Service Binding targets the deployed broker, and that required bindings and secrets are available. Test each template from an isolated copy, then validate the complete two-user flow in a real Cloudflare account.
5. Publish the templates and replace the README's deployment-guide link with two labeled buttons in deployment order. Verify the final links after the repository name and release branch are settled.

A single setup flow that provisions and deploys both Workers would require a custom deployment workflow. The two-button plan uses Cloudflare's native template flow and keeps the deployment order explicit.

See Cloudflare's [Deploy to Cloudflare documentation](https://developers.cloudflare.com/workers/platform/deploy-buttons/) for supported provisioning, secret prompts and template limitations.
