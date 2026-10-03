# Domain context

Learning MCP Suite is a standalone ChatGPT MCP service on an orphan branch. It runs entirely on Cloudflare: one public suite Worker and one private broker Worker. pnpm owns its package and lockfile.

A **suite user** is identified by verified OIDC issuer and subject. Its OAuth grants, notice acceptance, Ed credentials, platform sessions and course mappings are isolated from other users. Okta is supported through OIDC for suite identity and through a configured platform SSO browser flow for platform access; these are separate credentials.

A **platform connection** is a verified Ed, Moodle or OnTrack account. The broker may reuse one user's SSO cookies between the configured Moodle and OnTrack origins. With explicit retention consent, it also keeps the user's encrypted password and optional TOTP configuration for automatic reauthentication. A one-time MFA code is transient. TOTP does not satisfy Push, Passkey, device checks or provider policy changes.

A **course association** maps a user-selected code, location, year, teaching period and timezone to any subset of platform IDs from fresh enrollment discovery. Codes and campuses are generic strings. Optional Ed institutional filters use raw metadata; title or semester matches never establish institutional identity.

A **usage acceptance** records the current notice version and timestamp after authenticated browser confirmation. The notice explains cloud credential processing, client data transfer and required account/content permissions. It does not grant rights or certify compliance. Full educational reads remain available; there is no blanket metadata-only mode. Attendance discovery returns candidates with evidence and partial coverage, never a submission.
