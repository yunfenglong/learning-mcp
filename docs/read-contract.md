# Read semantics and maintenance

The capability catalog in `src/capabilities/` is the source of truth for public educational tools. Each platform definition records the public name, strict Zod input schema, backend operation, scope and optional MCP App metadata. `index.ts` generates registration, the public `capability_catalog` result and the backend read allowlist. Account connection/binding tools remain in `src/mcp/server.ts` and use their existing OAuth scopes.

`src/platforms/read/contracts.ts` derives argument and operation types from these definitions; adapters inject verified platform IDs after public arguments. Each platform handler has an exhaustive operation check: adding a catalog operation without implementing it fails `pnpm check`. The platform clients use declarations generated from the pinned source, rather than a permissive index signature. Generated declarations and bundles are hashed in `vendor/upstreams.json`.

The execution files are grouped under `src/platforms/read/`: `ed.ts`, `moodle.ts` and `ontrack.ts` implement platform reads; `contracts.ts`, `shared.ts`, `files.ts`, `error.ts` and `ontrack-json.ts` provide their types and shared output handling. `moodle-files.ts` handles bounded file redirects. Session construction and transport stay in `src/platforms/direct.ts` and `network.ts`.

MCP display code lives in `src/mcp/views/ed/` with its document registration, browser script and raw-import declaration. Ed prompt registration lives in `src/mcp/prompts/ed.ts`; `src/mcp/server.ts` owns shared tool registration and HTTP transport.

## Boundaries

The public tool selects a user-confirmed course; the adapter resolves that binding to platform IDs. The direct backend checks current enrollment and authenticated platform identity. Handlers check object ownership or membership before returning details, quiz responses or files. Neither caller-supplied URLs nor guessed associations authorize access. Independent enrollment listing, platform identity and OnTrack teaching-role discovery do not grant access to unbound course content.

Course keys and unambiguous user-confirmed codes replace upstream free-form course references. Moodle sections accept a number (including zero) or an exact section name; activities accept an ID or exact name from the selected course. OnTrack tasks accept a definition ID or exact abbreviation from the linked project. Ed thread IDs and course-local numbers are separate tools. Slides require their parent lesson so ownership can be verified before questions or responses are fetched.

Authentication and renewal remain in the shared direct backend and private broker. A refused write/management operation fails before platform connection. The output boundary continues to redact session material from metadata, text and errors. Binary resources are created only by the file-delivery helper; source content cannot manufacture an embedded resource by imitating its JSON shape.

## Read behavior and limits

- **Ed:** lesson/slide reads explicitly use `view: false`. Saved quiz responses are filtered to the authenticated user. Thread search uses the upstream word matching and filters, with at most ten upstream pages; `offset` refers to the unfiltered stream. Activity is scoped to the selected linked course. The four interactive views use upstream view builders with a small display-only MCP App. Practice questions remain local; the view makes no platform requests or writes. Clients without MCP App support still receive text and structured data. The two prompts prepare read workflows without posting.
- **Moodle:** home, deadlines, grades, title search, news and forum search can span linked courses when `unit` is omitted. Discussion posts support `limit`, `offset` and selecting a post. Forum searches and deadlines report bounded coverage. Activity details come from the pinned official client, including the fields the site permits it to read. Quiz review accepts only an attempt listed for that user's selected quiz. Site permissions still determine what answers and feedback are visible.
- **OnTrack:** unit reads preserve the complete client-normalized unit and personal project; date objects are explicitly serialized so their private fields do not disappear. Scheduled task rows use the upstream snapshot helper for effective dates, consideration extensions and status/grade labels, with the bound course timezone. Task listings merge definitions with current progress and allow status filtering. Unread counts come from the project snapshot without fetching comments. Task PDF text extraction runs inside the Worker and returns page ranges; it does not transcribe scans or diagrams. Retrieve the original PDF when extraction is insufficient.

Files are returned as native MCP embedded resources with a name, MIME type, byte count and SHA-256 manifest. Clients need to support embedded binary resources. Individual files and Moodle batches are limited to 16 MiB. A task PDF is limited to 200 pages and a request to 50 pages. No server-local paths or upload channel are exposed.

Moodle download/sync returns explicit failures and continuation offsets. Sync exports page/book HTML with executable content removed and same-site images embedded where possible. Its offline CSP permits only data images. The caller stores the manifest and supplies known hashes; unchanged content is fetched to calculate its hash, then its bytes are omitted. This is a stateless transfer protocol, not a server-side filesystem mirror. Batches can be retried with a smaller limit after a size error. Image or file failures retain partial coverage.

Ed attachment requests accept only freshly listed file metadata. Resource destinations must match the suite's `RESOURCE_ORIGINS` rules; no Ed credentials go to these origins and redirects are refused. Moodle downloads start at freshly discovered links on the account's saved site. File redirects can reach matching resource origins, with at most five redirects and no platform credentials sent off-site. The default provider rules cover Edusercontent and CloudFront subdomains without publishing instance-specific hosts. Operators can replace the defaults with exact origins or verified CDN suffix rules. Unconfigured destinations fail with `RESOURCE_ORIGIN_NOT_ALLOWED`, without exposing signed query parameters or triggering session renewal. This does not add browser SSO origins. See [configuration](configuration.md).

Ed and Moodle refuse partial range responses and truncated uncompressed bodies instead of delivering corrupt files. OnTrack uses its upstream client's validated range assembly. Vendor transports sometimes wrap fetch errors; a per-read async boundary preserves safe suite failures through those wrappers. Batch failures use the same public classification as individual downloads, without forwarding vendor messages or error bodies.

## Excluded side effects

[The generated reference](capabilities.md#writes-awaiting-approval) lists all omitted platform writes. OnTrack chat-history GET is included there because the upstream endpoint marks non-discussion comments read. It is not exposed as a read-only tool. Runtime, deployment, login/logout CLI, installation, configuration, keepalive and diagnostic management commands are excluded from the platform capability catalog. Suite connection and authentication controls retain their existing implementation.

No attendance submission is implemented. Repository policy also forbids updating learning progress; listing such upstream operations is not authorization to enable them. Any future write integration needs explicit user approval and a compatible repository policy.

## Changing a capability

1. Review the pinned upstream method and its side effects. Change the platform definition and corresponding handler together; keep authenticated identity, current enrollment and ownership checks.
2. Use the public schema's inferred types. Do not add a separate public tool-name list, allowlist or manual parameter declaration. Keep platform normalization in its handler and reusable file/authentication logic at the shared boundary.
3. Add tests for the behavior or security boundary affected by the change. Run `pnpm capabilities:docs`, then `pnpm capabilities:check`, `pnpm upstreams verify` and the repository's required validation commands.
4. When changing upstream versions, run `pnpm upstreams sync`, review source and API changes, and regenerate/validate. `pnpm upstreams sync --locked` changes the bundled exports and generated declarations while retaining the pinned versions and commits. Never edit generated vendor files by hand. Check upstream freshness before an explicitly requested deployment.

Validation for Worker/authentication changes is `pnpm check`, `pnpm test`, `pnpm build`, `pnpm build:broker` and `pnpm test:runtime`. Runtime tests use actual Worker transports and platform fixtures; they do not prove a live institution's SSO, permissions or file-host configuration.
