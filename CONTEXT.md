# Domain context

Learning MCP Suite is a cloud MCP service for OAuth-capable MCP clients. It runs entirely on Cloudflare: one public suite Worker and one private broker Worker. pnpm owns its package and lockfile.

A **suite user** is identified by a verified identity anchor. Provider sign-in uses the provider type, configured HTTPS origin and stable authenticated user ID; the first provider adapter supports Okta. Ed sign-in uses the verified Ed user ID. Existing platform-based accounts retain their platform origin and user ID anchors and original login entry; provider sign-in creates a separate account and does not merge identities. OAuth grants, notice acceptance, credentials, platform sessions and course mappings are isolated from other users. The private broker can reuse that user's saved SSO across configured platforms. No independent OIDC application is required; future sign-ins must use the same identity anchor.

A **platform connection** is a verified Ed, Moodle or OnTrack account. The broker may reuse one user's SSO cookies between the configured Moodle and OnTrack origins. With explicit retention consent, it also keeps the user's encrypted password and optional TOTP configuration for automatic reauthentication. A one-time MFA code is transient. TOTP does not satisfy Push, Passkey, device checks or provider policy changes.

A **course association** maps a user-selected code, location, year, teaching period and timezone to any subset of platform IDs from fresh enrollment discovery. Codes and campuses are generic strings. Optional Ed institutional filters use raw metadata; title or semester matches never establish institutional identity.

A **usage acceptance** records the current notice version and timestamp after authenticated browser confirmation. The notice explains cloud credential processing, client data transfer and required account/content permissions. It does not grant rights or certify compliance. Attendance discovery returns candidates with evidence and partial coverage, never a submission.

**Platform renewal** is separate from the MCP client’s OAuth refresh. Moodle uses a scoped cookie jar and a session-bound CSRF `sesskey`; OnTrack uses an expiring access token and private refresh cookies. The broker attempts HTTP renewal first, verifies the same platform identity, persists cookie rotation and serializes per-user operations. A rejected session can require browser SSO; a transient upstream failure triggers backoff. Forgetting SSO credentials retains platform sessions and their renewal material; disconnect removes that platform’s session and renewal material.

A **platform base link** is the exact public HTTPS origin supplied by the user on first Connect. The broker saves it per account and uses it for reads, sign-in and renewal. A different base link requires disconnecting and connecting that platform again. Moodle and OnTrack addresses have no deployment default and are not Worker configuration.
