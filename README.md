# Learning MCP Suite

A standalone, fully cloud-hosted MCP suite for ChatGPT/Claude clients, with Okta / SSO, Ed Discussion, Moodle and OnTrack. Each user connects their own accounts and confirms courses spanning any subset of the three platforms. Platform hosts, course codes, locations and timezones are configurable; the project has no institution-specific defaults.

The public Cloudflare Worker embeds the official @bunizao clients. An independent private broker Worker handles encrypted platform sessions and cloud browser SSO. Full course content, discussion, deadlines, grades, task and attendance-code reads are supported. Attendance submission and learning-progress writes are absent.

## User flow

1. ChatGPT connects to `/mcp` using the suite's OAuth authorization.
2. The user signs in to the suite through a configured OIDC provider, including Okta. This verifies suite identity; it does not itself supply platform sessions.
3. Before granting client access or connecting platforms, the user reads and accepts the data handling and usage notice. Acceptance is versioned and recorded for the authenticated account.
4. GPT can call `start_connection` to open an account-bound `/landing` link. Users can also visit the page directly.
5. Connect Ed with an API token. Connect Moodle and OnTrack with the configured cloud SSO flow or existing platform sessions. Credentials belong on this HTTPS page, never in chat.
6. For automatic sign-in, explicitly choose encrypted password/TOTP retention. Supply a Base32 TOTP secret or `otpauth://totp` URI, not an old six-digit code. Without retention, the broker only saves the resulting browser and platform sessions.
7. GPT calls `discover_courses` and confirms course mappings using `bind_course`. The browser page also supports discovery and associations.
8. GPT reads courses and searches attendance-code evidence. Users can remove associations, disconnect platforms, forget the shared sign-in, revoke client grants and sign out.

## Automatic authentication

The broker first reuses saved cookies. If authentication is required and the user authorized credential retention, it supplies the saved username/password and generates a fresh TOTP when the provider requests one. It supports SHA-1, SHA-256 and SHA-512 with six or eight digits, and URI-configured time steps. One-time codes are never stored. MFA methods requiring user interaction (including Push, Passkey and device verification), invalid credentials or changed policies may still require reconnection. No cybersecurity challenges are bypassed.

Each attempt uses a separate cloud browser context, restores only that user's configured-origin cookies, and checks the resulting platform identity. Renewals are serialized per user, reuse very recent renewed sessions, and back off after failed sign-in. A changed identity is rejected. Forgetting the sign-in removes shared cookies/password/TOTP while existing platform sessions remain; disconnecting both broker platforms removes the shared sign-in too.

## Tools

| Tools                                                                                 | Purpose                                                       |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `get_profile`, `connection_status`, `start_connection`                                | Identity and account-bound connection setup                   |
| `discover_courses`, `bind_course`, `unbind_course`, `course_units`                    | Enrolled courses and confirmed mappings                       |
| `disconnect_platform`, `upstream_versions`                                            | Own connections and bundled client versions                   |
| `ed_lessons`, `ed_lesson`, `ed_threads`, `ed_thread`                                  | Ed content                                                    |
| `moodle_unit`, `moodle_due`, `moodle_grades`, `moodle_search_forums`, `moodle_thread` | Moodle content, deadlines, feedback and discussion            |
| `ontrack_unit`, `ontrack_tasks`, `ontrack_task`                                       | OnTrack tasks and progress                                    |
| `find_attendance_code`                                                                | Code candidates with source links, dates and partial coverage |

Ed requires verified enrollment. Administrators may restrict it using independently verified `institution_ids`; no institution restriction is applied by default. Moodle and OnTrack use exact administrator-configured HTTPS origins, with enrollment and ownership checks. Course associations are always user-confirmed.

## Data handling and permissions

The service processes credentials and course data in Cloudflare and sends requested educational content to the authorized MCP client, including ChatGPT. It is independent of institutions and platform providers. Users must have permission for automated access, credential delegation and transfer of requested content, and must follow copyright, privacy, assessment and attendance rules. The usage notice records acknowledgement; it does not establish permission or certify compliance. Operators retain their own obligations, including handling data lawfully and accurately describing deployment practices.

Passwords and TOTP secrets can authorize future sign-ins. They are stored only with explicit retention opt-in, encrypted with an account-bound AES-GCM context in the private broker's Durable Object vault. Platform sessions are also encrypted; Ed credentials use the suite's separate key. Encryption protects stored data but does not make it inaccessible to an operator holding the keys. OAuth provider data uses KV; this vault uses Durable Objects for per-user serialized operations. No shared global credential picker is exposed.

OAuth scopes are `learning:read`, `learning:bindings` and `offline_access`. The browser flows enforce secure cookies and CSRF; grants enforce user/client/resource/scopes, expiry and immediate revocation. Source content is untrusted evidence. Attendance search is bounded to Ed and Moodle text; images, attachments and codes shown only in class can be missed. It never calls an attendance submission endpoint.

## Development and deployment

Use pnpm only:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:runtime
```

Both builds inside the runtime command are dry runs. See [deployment configuration](docs/deployment.md) for Cloudflare resources, OIDC, exact origins, secrets and acceptance checks. This project is not yet production-deployed or verified against a live platform SSO flow.

Official bunizao client sources, MIT notices, release versions, commit hashes and file hashes are included in `vendor/upstreams.json`. Use `pnpm upstreams check` to compare integrity and current upstream commits, and `pnpm upstreams sync` to refresh the pinned sources. Deployment stops if freshness or integrity checks fail.

The optional administrator API only lists or revokes grants, never reads credentials or binds accounts. Configure `LEARNING_MCP_URL` and `LEARNING_ADMIN_TOKEN` privately and run `pnpm admin grants ACCOUNT_ID` or `pnpm admin revoke ACCOUNT_ID GRANT_ID` (or `all`).

This project has its own OAuth issuer, grants, scopes and browser cookies. Previously issued tokens for another service are not automatically compatible. Reauthorization is required for clients of this suite.
