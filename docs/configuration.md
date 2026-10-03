# Configuration reference

Configure the suite in [`wrangler.jsonc`](../wrangler.jsonc) and the broker in [`broker/wrangler.jsonc`](../broker/wrangler.jsonc). The checked-in values are examples. Keep the broker's public routes, `workers_dev` and preview URLs disabled.

## Variables

| Variable                     | Worker | Value                                                                                                   |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `ISSUER`                     | Suite  | Exact public HTTPS origin, matching the deployed route or workers.dev origin.                           |
| `OIDC_ISSUER`                | Suite  | Exact OIDC issuer; an authorization-server path is allowed here.                                        |
| `OIDC_CLIENT_ID`             | Suite  | Client ID for suite sign-in. Register `/login/callback` on the suite origin.                            |
| `OIDC_ALLOWED_EMAIL_DOMAINS` | Suite  | Optional comma-separated email domains. Empty means no domain filter.                                   |
| `PLATFORM_CONFIG`            | Both   | JSON string containing the enabled platform entries below.                                              |
| `LOGIN_ORIGINS`              | Broker | JSON array of exact HTTPS origins needed by the platform SSO flow. The platform origin is also allowed. |

Use the **`platforms` object** from [`examples/config.json`](../examples/config.json), not the whole file:

```json
{
  "ed": { "site_url": "https://edstem.org" },
  "moodle": { "site_url": "https://moodle.example.edu" },
  "ontrack": { "site_url": "https://ontrack.example.edu" }
}
```

Serialize this object as a string for Wrangler's `vars.PLATFORM_CONFIG`. Remove disabled platforms. The broker needs only Moodle and OnTrack entries, matching the suite's origins. These origins must use HTTPS with no credentials, application path, query or fragment. Deployments under a path prefix are not supported. Optional `ed.institution_ids` can restrict Ed courses using verified numeric metadata.

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
| `OIDC_CLIENT_SECRET`     | Suite  | Set when required by the suite's OIDC application.         |
| `ADMIN_TOKEN`            | Suite  | Optional separate token for grant administration.          |

Set deployed secrets interactively with Wrangler as described in the [deployment guide](deployment.md). Use ignored `.dev.vars` and `broker/.dev.vars` files for local development. User platform tokens, passwords and MFA information are entered on the account page, not in deployment configuration.

Changing an encryption key without re-encrypting existing records makes them unreadable. Keep keys stable across redeployments. Changing issuer, OIDC identity, namespaces or grant storage can require clients and users to reconnect.
