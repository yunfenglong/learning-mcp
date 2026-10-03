# Learning MCP Suite

[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm_Noncommercial-6C47FF)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](docs/deployment.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-5FA04E?logo=nodedotjs&logoColor=white)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-10.14.0-F69220?logo=pnpm&logoColor=white)](package.json)

A cloud-hosted [Model Context Protocol](https://modelcontextprotocol.io/) server for Ed Discussion, Moodle and OnTrack. Connect your accounts once, link the platforms each course uses, and access learning materials through an OAuth-capable MCP client.

Runs on Cloudflare Workers with a private Okta / SSO broker. Users do not need to install a local connector.

## Features

- **Ed Discussion** — browse lessons, threads and replies.
- **Moodle** — read course materials, deadlines, grades, feedback and forum discussions.
- **OnTrack** — read projects, tasks and progress.
- **Course connections** — discover enrolled courses and confirm associations across any combination of platforms.
- **Attendance-code search** — find candidates in Ed and Moodle text, with source links and dates. Does not submit attendance.
- **Cloud SSO** — reuse platform sessions and optionally retain encrypted credentials for automatic sign-in.
- **Per-user access** — separate accounts, configurable platform origins, scoped OAuth grants and revocation controls.

Learning-platform operations are read-only. Connection and course-association tools manage the user's own suite account.

## Project status

Both Workers build and have unit and workerd integration tests. Authentication tests use controlled fixtures; live SSO compatibility depends on the configured platforms and identity provider. Treat a real two-user deployment check as part of setup.

## Self-hosting

### Requirements

- Node.js 24 or later and pnpm 10.14.0.
- A Cloudflare account with Workers, KV and Durable Objects; Browser Run for cloud SSO.
- A supported Okta SSO provider for provider sign-in, or an Ed API token for Ed sign-in.
- Access to the platforms you want to enable.

### Setup

1. Install dependencies:

   ```sh
   pnpm install --frozen-lockfile
   ```

2. Configure the public Worker in [`wrangler.jsonc`](wrangler.jsonc) and the private broker in [`broker/wrangler.jsonc`](broker/wrangler.jsonc). Set the public HTTPS origin, OAuth KV namespace, broker Service Binding and platform origins. Use the `platforms` object in [`examples/config.json`](examples/config.json) as `PLATFORM_CONFIG`; the whole example file is not a Worker configuration. See the [configuration reference](docs/configuration.md).
3. Create the required resources and set the encryption keys and broker service token. Follow the [deployment guide](docs/deployment.md) for the exact bindings and secret commands. Keep secrets out of source control.
4. Validate and deploy the broker first, then the public Worker:

   ```sh
   pnpm check
   pnpm test
   pnpm test:runtime
   pnpm deploy:broker
   pnpm run deploy
   ```

Deployment checks bundled client integrity and current upstream commits before publishing. If upstream sources have changed, run `pnpm upstreams sync`, review the changes and repeat validation.

Set `SSO_PROVIDERS` on both Workers to the supported provider entries described in the configuration reference. Provider sign-in verifies an Okta session before creating the suite account; learning platforms are connected afterwards. Existing platform-based accounts remain accessible through their original sign-in entry.

The checked-in hostnames and resource IDs are placeholders. Live platform SSO compatibility must be verified for your deployment.

For Cloudflare's official deployment button and the current two-Worker setup requirements, see [Deploy to Cloudflare](docs/deployment.md#deploy-to-cloudflare-button).

## Usage

Use any client that supports remote MCP over Streamable HTTP and this service's OAuth authorization flow, including PKCE S256 and resource indicators. Client brand is not restricted; availability depends on the client's own MCP support. Authorization pages display the registered client name.

Use your deployed server's MCP endpoint:

```text
https://YOUR_SUITE_HOST/mcp
```

1. Connect an OAuth-capable MCP client. Sign in with your supported SSO provider base link, username, password and optional TOTP, or with an Ed API token. Use the same provider account or Ed account for future sign-ins. Existing platform-based accounts can use their original sign-in entry.
2. Read and accept the data handling notice before entering credentials, then approve the client's requested access.
3. Open `https://YOUR_SUITE_HOST/landing`, or ask the client to connect a platform using `start_connection`.
4. Add the other platforms to the same account: Ed uses an API token; Moodle and OnTrack use the configured SSO flow or an existing platform session. All three can be connected together. Moodle and OnTrack can reuse your saved SSO when available, with your approval. Enter credentials on the connection page.
5. Discover your enrolled courses and confirm which platform courses belong together. This works through MCP tools or the connection page.
6. Ask about course materials, discussions, deadlines, grades, tasks or attendance-code evidence.

For example:

- “Show my connected courses and upcoming Moodle deadlines.”
- “Find the Ed discussion about this week's assignment.”
- “Show my OnTrack tasks and their current status.”
- “Look for an attendance code in today's course announcements and include the sources.”

Users can remove course associations, disconnect platforms, forget saved sign-in credentials and revoke client access from the connection page.

## Available tools

| Category    | Tools                                                                                 |
| ----------- | ------------------------------------------------------------------------------------- |
| Account     | `get_profile`, `connection_status`, `start_connection`, `disconnect_platform`         |
| Courses     | `discover_courses`, `bind_course`, `unbind_course`, `course_units`                    |
| Ed          | `ed_lessons`, `ed_lesson`, `ed_threads`, `ed_thread`                                  |
| Moodle      | `moodle_unit`, `moodle_due`, `moodle_grades`, `moodle_search_forums`, `moodle_thread` |
| OnTrack     | `ontrack_unit`, `ontrack_tasks`, `ontrack_task`                                       |
| Attendance  | `find_attendance_code`                                                                |
| Diagnostics | `upstream_versions`                                                                   |

OAuth scopes are `learning:read`, `learning:bindings` and `offline_access`. Platform reads check enrollment and object ownership; course associations require user confirmation.

## Authentication and data handling

Suite sign-in establishes your identity. Moodle and OnTrack also need their own platform sessions; signing in to the suite does not automatically grant access to them.

The broker renews platform sessions over HTTP before using the cloud browser: Moodle session touch and cookie rotation, and OnTrack refresh-cookie exchange with access-token expiry checks. With explicit opt-in, it can store an encrypted password and optional TOTP secret and generate fresh verification codes during sign-in. Push approvals, passkeys, device verification or changed provider policies may require user interaction. One-time MFA codes are not retained.

Credentials and platform sessions are encrypted in per-user Durable Object storage; OAuth records use KV. An operator holding the encryption keys can access stored credentials. **Forget saved sign-in** removes the saved password, TOTP secret and shared SSO cookies while retaining platform sessions, including OnTrack refresh cookies. Disconnect a platform to remove its session and renewal material. Disconnecting both broker platforms also removes the shared sign-in.

The service and the infrastructure providers used by its operator process credentials and course data, and requested content is sent to the authorized MCP client. Users see a versioned notice before connecting platforms or granting client access. Users and operators must have the necessary permissions for automated access, credential delegation and content transfer. Accepting the notice does not establish platform approval or waive operator obligations.

This is an independent project. Platform origins are configurable and there are no institution-specific defaults. Attendance search covers Ed and Moodle text; it may miss images, attachments or codes shown only in class.

## Development

| Command                | Purpose                                               |
| ---------------------- | ----------------------------------------------------- |
| `pnpm dev`             | Start the local public Worker development server      |
| `pnpm check`           | Check TypeScript types                                |
| `pnpm test`            | Run unit tests                                        |
| `pnpm test:runtime`    | Build both Workers and run runtime integration tests  |
| `pnpm build`           | Build the public Worker without deploying             |
| `pnpm build:broker`    | Build the private broker without deploying            |
| `pnpm upstreams check` | Check bundled source integrity and upstream freshness |
| `pnpm upstreams sync`  | Refresh bundled client sources                        |

Local development requires the relevant bindings and configuration. Use ignored `.dev.vars` files for local secrets. See the [deployment guide](docs/deployment.md) for configuration and end-to-end validation.

For optional grant administration, configure `LEARNING_MCP_URL` and `LEARNING_ADMIN_TOKEN`, then use `pnpm admin grants ACCOUNT_ID` or `pnpm admin revoke ACCOUNT_ID GRANT_ID`. The administrator API lists and revokes grants; it does not expose credentials.

See [architecture and session renewal](docs/architecture.md), [troubleshooting](docs/troubleshooting.md), [contributing](CONTRIBUTING.md) and [security reporting](SECURITY.md).

## Acknowledgements

Platform clients are bundled from bunizao's [edstem-cli](https://github.com/bunizao/edstem-cli), [moodle-cli](https://github.com/bunizao/moodle-cli) and [ontrack-cli](https://github.com/bunizao/ontrack-cli). The public Worker uses them for learning-platform reads; the private broker also uses clients to verify platform sessions. The broker is the only separate service.

Pinned versions, commit hashes and file hashes are recorded in [`vendor/upstreams.json`](vendor/upstreams.json). Each bundled client retains its upstream MIT license notice under `vendor/`.

## License

The project's original code and documentation are available under the [PolyForm Noncommercial License 1.0.0](LICENSE). This is a source-available license that permits noncommercial use, modification and redistribution under its terms. It also expressly permits use by specified organizations, including educational institutions and charities, regardless of funding. Commercial use outside the license's permitted purposes is not authorized.

Third-party clients and dependencies retain their own licenses. The bundled bunizao clients remain MIT-licensed; see [NOTICE](NOTICE) and the license files in `vendor/`.
