# Domain context

Learning MCP Suite is a cloud MCP service for ChatGPT and other OAuth-capable clients. It runs entirely on Cloudflare: one public suite Worker and one private broker Worker. pnpm owns its package and lockfile.

A **suite user** is identified by the verified sign-in platform, its configured HTTPS origin and its authenticated platform user ID. A fresh Okta / SSO browser login or a verified Ed API token establishes the account. Its OAuth grants, notice acceptance, credentials, platform sessions and course mappings are isolated from other users. The private broker can reuse that user's saved SSO across configured platforms. No independent OIDC application is required; future sign-ins must use the same platform identity anchor.

A **platform connection** is a verified Ed, Moodle or OnTrack account. The broker may reuse one user's SSO cookies between the configured Moodle and OnTrack origins. With explicit retention consent, it also keeps the user's encrypted password and optional TOTP configuration for automatic reauthentication. A one-time MFA code is transient. TOTP does not satisfy Push, Passkey, device checks or provider policy changes.

A **course association** maps a user-selected code, location, year, teaching period and timezone to any subset of platform IDs from fresh enrollment discovery. Codes and campuses are generic strings. Optional Ed institutional filters use raw metadata; title or semester matches never establish institutional identity.

A **usage acceptance** records the current notice version and timestamp after authenticated browser confirmation. The notice explains cloud credential processing, client data transfer and required account/content permissions. It does not grant rights or certify compliance. Attendance discovery returns candidates with evidence and partial coverage, never a submission.

**Platform renewal** is separate from the MCP client’s OAuth refresh. Moodle uses a scoped cookie jar and a session-bound CSRF `sesskey`; OnTrack uses an expiring access token and private refresh cookies. The broker attempts HTTP renewal first, verifies the same platform identity, persists cookie rotation and serializes per-user operations. A rejected session can require browser SSO; a transient upstream failure triggers backoff. Forgetting SSO credentials retains platform sessions and their renewal material; disconnect removes that platform’s session and renewal material.
