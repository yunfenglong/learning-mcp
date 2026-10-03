# Configuration reference

Configure the suite in [`wrangler.jsonc`](../wrangler.jsonc) and the broker in [`broker/wrangler.jsonc`](../broker/wrangler.jsonc). The checked-in values are examples. Keep the broker's public routes, `workers_dev` and preview URLs disabled.

## Variables

| Variable          | Worker | Value                                                                                                   |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `ISSUER`          | Suite  | Exact public HTTPS origin, matching the deployed route or workers.dev origin.                           |
| `PLATFORM_CONFIG` | Suite  | Optional Ed configuration; Moodle and OnTrack addresses belong to each user connection.                 |
| `SSO_PROVIDERS`   | Both   | JSON array of supported provider types and exact HTTPS origins, described below.                        |
| `LOGIN_ORIGINS`   | Broker | JSON array of exact HTTPS origins needed by the platform SSO flow. The platform origin is also allowed. |

Users enter Moodle and OnTrack base links when connecting a platform on their authenticated account page. The broker validates and saves the exact public HTTPS origin in that user's encrypted connection storage. It uses the saved address for platform reads, sign-in and renewal. Worker variables do not need Moodle or OnTrack addresses. To use a different address, disconnect that platform and connect it again; course associations must be confirmed again.

Ed uses `https://edstem.org` automatically. Optional Ed scope can be supplied through the suite's `PLATFORM_CONFIG`:

```json
{ "ed": { "site_url": "https://edstem.org", "institution_ids": [123] } }
```

The number is illustrative; use verified numeric Ed metadata. Platform base links must be HTTPS origins without credentials, application paths, queries or fragments. IP literals and internal hostnames are rejected. Deployments under a path prefix are not supported. Network requests stay on the user's saved origin; MCP tools cannot supply or override addresses. SSO passwords and codes are entered only at the supported identity provider, never into a user-selected platform's login form.

Configure `SSO_PROVIDERS` on **both Workers** as a JSON string. For example:

```json
[{ "type": "okta", "origin": "https://tenant.okta.example" }]
```

Users enter their own provider base link; it must match one of these exact HTTPS origins. Origins are not listed in account pages or public metadata. This setting identifies providers whose current-session identity API is supported; `LOGIN_ORIGINS` separately allows the resource hosts needed during browser sign-in. Adding a host to `LOGIN_ORIGINS` alone does not enable provider sign-in. The first adapter supports Okta; other provider types require an identity-verification adapter. Keep the list empty to offer Ed and existing platform-based sign-in only.

Course associations are created by users from fresh discovery. The example course association is illustrative; it is not a deployment variable or a seed record.

## Bindings

| Binding        | Worker | Resource                                                                              |
| -------------- | ------ | ------------------------------------------------------------------------------------- |
| `OAUTH_KV`     | Suite  | New KV namespace for this suite's OAuth records.                                      |
| `AUTH_STATE`   | Suite  | `AccountState` Durable Object, created by the checked-in migration.                   |
| `SSO_BROKER`   | Suite  | Service Binding to the private broker's actual Worker name.                           |
| `BROKER_STATE` | Broker | `BrokerState` Durable Object, created by the checked-in migration.                    |
| `BROWSER`      | Broker | Browser Run, required for cloud SSO. Existing-session connection can work without it. |

## Secrets

| Secret                   | Worker | Requirement                                                |
| ------------------------ | ------ | ---------------------------------------------------------- |
| `CREDENTIALS_KEY`        | Suite  | Random 32-byte AES-GCM key encoded as Base64.              |
| `BROKER_CREDENTIALS_KEY` | Broker | A separate random 32-byte AES-GCM key encoded as Base64.   |
| `BROKER_SERVICE_TOKEN`   | Both   | Same random token on both Workers, at least 32 characters. |
| `ADMIN_TOKEN`            | Suite  | Optional separate token for grant administration.          |

Set deployed secrets interactively with Wrangler as described in the [deployment guide](deployment.md). Use ignored `.dev.vars` and `broker/.dev.vars` files for local development. User platform tokens, passwords and MFA information are entered on the account page, not in deployment configuration.

Changing an encryption key without re-encrypting existing records makes them unreadable. Keep keys stable across redeployments. Changing issuer, platform identity anchors, namespaces or grant storage can require clients and users to reconnect.

Provider sign-in uses the verified provider type, origin and stable user ID as the account anchor; no independent OIDC application is needed. Keep that provider and account stable. Ed sign-in keeps its verified Ed identity anchor. Existing platform-based accounts keep their platform identity anchors and original login flow; provider sign-in creates a separate account rather than automatically merging identities.
