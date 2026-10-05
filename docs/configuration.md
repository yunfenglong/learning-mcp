# Configuration reference

Configure the suite in [`wrangler.jsonc`](../wrangler.jsonc) and the broker in [`broker/wrangler.jsonc`](../broker/wrangler.jsonc). The checked-in values are examples. Keep the broker's public routes, `workers_dev` and preview URLs disabled.

## Variables

| Variable           | Worker | Value                                                                                                                                               |
| ------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LEGAL_CONFIG`     | Suite  | Optional JSON object with instance operator and privacy contact disclosures; see below.                                                             |
| `ISSUER`           | Suite  | Exact public HTTPS origin, matching the deployed route or workers.dev origin.                                                                       |
| `PLATFORM_CONFIG`  | Suite  | Optional Ed configuration; Moodle and OnTrack addresses belong to each user connection.                                                             |
| `SSO_PROVIDERS`    | Both   | JSON array of supported provider types and exact HTTPS origins, described below.                                                                    |
| `RESOURCE_ORIGINS` | Suite  | Optional JSON array of HTTPS origins or leading subdomain wildcard rules for Ed files and Moodle file redirects; provider defaults described below. |
| `LOGIN_ORIGINS`    | Broker | JSON array of exact HTTPS origins needed by the platform SSO flow. The platform origin is also allowed.                                             |

Users enter Moodle and OnTrack base links when connecting a platform on their authenticated account page. The broker validates and saves the exact public HTTPS origin in that user's encrypted connection storage. It uses the saved address for platform reads, sign-in and renewal. Worker variables do not need Moodle or OnTrack addresses. To use a different address, disconnect that platform and connect it again; course associations must be confirmed again.

`RESOURCE_ORIGINS` is a reusable resource-host policy, not a list of deployment-specific CDN distributions. If omitted, it defaults to:

```json
[
  "https://edusercontent.com",
  "https://*.edusercontent.com",
  "https://*.cloudfront.net"
]
```

New hosts within these CDN families work without adding an individual origin. An explicit array replaces the defaults; `[]` disables off-platform file destinations. To support another provider, configure its verified CDN-owned suffix or exact HTTPS origin in the private deployment configuration. Never publish account-specific domains, signed file URLs or live course information in the repository.

Wildcard rules support only a leading `*.` and match complete subdomain labels, including nested subdomains. They do not match the apex domain, lookalike suffixes, a different protocol or a different port. For example `https://*.cdn.example.edu` matches `https://new.cdn.example.edu`, but not `https://cdn.example.edu` or `https://new.cdn.example.edu:8443`. Bare `*`, wildcard top-level names, IP literals, internal hostnames, URL credentials, paths, queries and fragments are rejected. Configure suffixes owned by the resource provider, not public registry or institutional suffixes.

Ed files must still come from freshly verified lesson/thread metadata and meet the official client's supported URL rules. They receive no platform credentials and cannot redirect. Moodle files start at freshly discovered links on the user's saved platform origin; only file redirects can reach a matching resource destination. Cookies and authentication headers stay on the saved Moodle origin. Every redirect is rechecked, with a maximum of five redirects and no HTTP downgrades or URL credentials. MCP callers cannot supply remote URLs. Same-origin Moodle attachments need no additional resource rule. This policy is separate from the broker's SSO browser origins and does not broaden API or identity-provider access.

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

Course associations are created by users from fresh discovery. Course codes may contain letters, digits, dots, underscores, hyphens and slashes, such as `CS101/CS201`, up to 64 characters. A slash-separated code is preserved as one complete code, not treated as aliases. Course keys use letters, digits, underscores and hyphens; use the key returned by `course_units` when a code is ambiguous. The example course association is illustrative; it is not a deployment variable or a seed record.

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

## Personal deployments and legal pages

The public routes `/privacy`, `/terms` and `/data-controls` describe this instance, not all instances of the public repository. The person who controls a deployment is its operator; the repository author or maintainer is not automatically the operator of someone else's instance.

Set `LEGAL_CONFIG` on the suite Worker to a JSON string. All fields are optional; missing details are disclosed as unpublished rather than filled with fictional information:

```json
{
  "operator_name": "Your instance operator",
  "contact_email": "privacy@example.com",
  "processing_regions": "Describe your actual Cloudflare configuration and processing regions.",
  "retention_details": "Describe your actual infrastructure log/backup retention and account deletion process."
}
```

These are illustrative public disclosures, not secrets. Use a privacy contact appropriate for your own instance. Values are validated and escaped as text, never executed as HTML. `retention_details` and `processing_regions` describe actual operations; they do not configure deletion jobs or Cloudflare residency controls. Do not promise a region or deletion deadline that your deployment cannot meet. Application-held platform access and opted-in credentials have no automatic age-based deletion; account controls remove the specified records, while full account deletion is not a self-service feature.

The bundled privacy notice and terms use the version in `src/domain/usage.ts`. Bump that version for material changes, including material changes to deployment disclosures. Deploy matching suite and broker versions. Authenticated confirmation records the notice version, terms version and timestamp. Users can always remove access without accepting new terms. Password retention and additional TOTP retention use separate default-off choices; TOTP retention requires password retention. Saved broker records include the retention choices, notice version and time without recording one-time codes. Existing saved credentials are not silently deleted on update; users can remove them explicitly.
