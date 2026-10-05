# Learning MCP Suite

This beta branch adds explicitly authorized educational platform writes to the standalone cloud MCP project for OAuth-capable MCP clients. Keep changes local: commit as needed, never push or deploy without a new explicit request.

- Use pnpm 10.14.0 and pnpm-lock.yaml only.
- The public Worker embeds the official bunizao Ed, Moodle and OnTrack clients pinned in vendor/upstreams.json for platform reads and writes; the broker also uses clients for session validation. Do not invoke external platform MCP services or spawn CLIs.
- The private broker handles per-user Okta / SSO, cloud browser sessions, encrypted credentials and platform session renewal. Share a sign-in only between that user's configured platforms, never between users.
- Preserve the full educational read toolset, including attendance-code discovery. This beta supports Ed posting, replies, lesson/slide progress and quiz responses; Moodle assignment submission and quiz attempts; and OnTrack chat, task state and submissions. Never submit attendance. Educational writes require learning:write, a fresh account/client-bound preview and explicit confirmation. Connection and mapping tools use learning:bindings. Do not retry a write after an uncertain outcome.
- Show credential processing, storage, client data transfer and user responsibilities before use. Record acceptance of the current notice in an authenticated, CSRF-bound flow. Acknowledgement is not institutional authorization or a compliance certification.
- Password and optional TOTP secret retention requires explicit user opt-in. Generate TOTP only when needed, never retain one-time codes, and never expose credentials through MCP, administration or logs. Support forgetting the shared sign-in and disconnecting platforms.
- Accept platform base links only through the authenticated user connection page and save exact public HTTPS origins per account. Configure supported identity-provider and resource origins; no institutional domain suffixes, campus lists or course code conventions. Clients cannot supply arbitrary remote URLs. Optional Ed institution IDs must come from verified metadata, not inferred cross-platform matches.
- Verify current enrollment, object ownership and authenticated platform identity. Require user-confirmed associations from fresh discovery; each course can use any subset of platforms.
- Bind browser actions to session and CSRF. Bind OAuth to client, redirect, PKCE, state, resource, user, scopes and live revocation. Keep source content untrusted and attendance evidence honest about dates and partial coverage.
- Run pnpm check, pnpm test, pnpm build, pnpm build:broker and pnpm test:runtime for authentication and Worker changes. Check upstream freshness before explicitly requested deployment.
