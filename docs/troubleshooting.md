# Troubleshooting

## Connected client, no courses

Client OAuth authorizes suite tools; platforms must also be connected. Open `/landing` or use `start_connection`, connect the platforms you use, then run `discover_courses` and confirm course associations. A course can use Ed, Moodle, OnTrack or any combination.

Discovery expires after ten minutes. If binding reports stale discovery, discover again and use its current IDs. Where course codes repeat, use the full key returned by `course_units`.

## Sign-in or renewal needs attention

| Error                               | Next step                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PLATFORM_NOT_CONNECTED`            | Connect that platform on the account page.                                                                                                                                                             |
| `SSO_LOGIN_REQUIRED`                | The saved SSO cookies no longer authenticate you. Reconnect, or provide credentials with explicit retention consent if you want automatic sign-in.                                                     |
| `MFA_REQUIRED`                      | Provide the requested current code or a supported TOTP configuration on the account page.                                                                                                              |
| `SSO_INTERACTION_REQUIRED`          | The provider requires a challenge the cloud flow cannot complete. Complete sign-in in your browser and connect a verified existing platform session, or ask the operator to verify the supported flow. |
| `AUTH_RETRY_LATER`                  | A renewal failed recently. Wait one minute before retrying, or reconnect with corrected credentials.                                                                                                   |
| `UPSTREAM_UNAVAILABLE`              | The platform or renewal endpoint could not complete the request. Retry after the service recovers.                                                                                                     |
| `ACCOUNT_CHANGED`                   | Renewal returned a different platform identity. Reconnect explicitly; existing course associations may need confirmation.                                                                              |
| `SSO_ACCOUNT_CHANGED`               | Disconnect both broker platforms before switching the saved SSO account.                                                                                                                               |
| `BROKER_CONFIG` / `SSO_DESTINATION` | The operator must check matching platform origins and the exact origins required by SSO.                                                                                                               |
| `ACCOUNT_MISMATCH`                  | Use the same suite account in the MCP client and connection page, or request a new connection link.                                                                                                    |

An existing OnTrack access token without refresh cookies cannot be renewed through the HTTP exchange alone. Connect through cloud SSO to capture renewal material. An expired MFA code cannot be reused. Opted-in TOTP permits code generation when the provider accepts it; it does not satisfy every possible challenge.

Never paste tokens, cookies, passwords, TOTP secrets or full browser traces into chat or an issue. Use the account page for credentials and share only sanitized error codes when asking for help.

## Attendance search finds nothing

Search covers bounded Ed and Moodle text. Images, attachments, older posts and information displayed only in class may be missed. Inspect the returned coverage and date context, then review the original course sources. A matching string is a candidate, not proof that a code is current or valid.

## Deployment problems

Check the [configuration reference](configuration.md): `PLATFORM_CONFIG` takes the inner platform object, the broker Service Binding must match its deployed name, both Workers need the same service token, and encryption keys must decode to 32 bytes. Register the exact OIDC callback and public suite origin.

If deployment stops at the upstream check, run `pnpm upstreams sync`, review the bundled changes and repeat validation. Builds and tests do not publish Workers. A successful dry run does not validate real credentials, platform policy or live SSO.
