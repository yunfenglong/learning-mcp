# Upstream coverage audit

The beta exposes a corresponding operation for every educational entry point in the reviewed public command/MCP surfaces below. **It is not fully equivalent to the upstream CLIs.** File limits, local filesystem behavior and the verification boundaries below remain material differences. Runtime/deployment management was excluded by scope, and attendance submission remains prohibited.

## Baseline and method

Reviewed sources: [Ed 0.7.2](https://github.com/bunizao/edstem-cli/tree/50570fb8577577d9f73dd556f05dfbbf0e906ecd), [Moodle 0.10.0](https://github.com/bunizao/moodle-cli/tree/698283631b97e7409d4b9b784ab1072a434ded83), [OnTrack 0.3.2](https://github.com/bunizao/ontrack-cli/tree/a8411553bc0edbd599becb0c2f908af9f608d130). `pnpm upstreams check` verified the bundled hashes and that these pins still matched upstream main on 2026-10-07.

The review compared command declarations, MCP registrations, client implementations and CLI execution behavior with the suite's input schemas, adapters, handlers, vendor exports and delivery paths. It found missing behavior even where a similarly named tool already existed. The [generated mapping](capabilities.md#audited-upstream-entry-points) lists canonical educational operations; CLI aliases share a row. Ed MCP prompts map to `ed_triage_unanswered` and `ed_teach_lesson` in `src/mcp/prompts/ed.ts`.

`src/capabilities/coverage.ts` keeps this audit baseline independently of the vendoring lock and exposes limitations through `capability_catalog`. A regression check rejects changed pins or mappings to nonexistent tools. That check prevents silent drift; it does not automatically discover every upstream option or prove behavioral equivalence. Future upstream updates require a new source review.

## Corrections from this review

| Platform | Corrected gaps                                                                                                                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ed       | Cross-course personal activity with linked-course filtering and correct continuation; paged batch attachment delivery; all/query lesson selection and inter-slide delay; functional, explicit host interactions in all four MCP Apps.                                                                                               |
| Moodle   | Activity listing including labels and exact section IDs; cross-course forum listing and globally ranked forum search; forum title queries; read-only running quiz inspection; confirmed quiz access-password callback; cross-course sync, conditional HTTP reads, stable manifest paths and explicit local-change/conflict actions. |
| OnTrack  | Safe authenticated profile fields; assigned-task snapshot semantics and derived fields; upstream PDF-to-Markdown conversion; missing-sheet/resource detection; task assignment checks before writes; Unicode comment length and write-receipt state validation.                                                                     |
| Shared   | Up to 20 staged files, including Moodle's upstream file-count range; safer conditional file redirects; explicit source mappings and remaining limitations.                                                                                                                                                                          |

## Remaining limits

1. **Large files are not at upstream parity.** The suite still caps binary delivery and a staged submission at 16 MiB, 20 staged files per operation and 32 MiB reserved staging per account. OnTrack upstream permits 100 MiB uploads and 256 MiB downloads; Ed/Moodle CLI transfers can also exceed the suite bound. Supporting those sizes needs a streaming delivery/upload execution path: current RPC/base64 and official upload adapters buffer whole files. Increasing constants alone is not a verified solution.
2. **Moodle sync requires a client to apply filesystem actions.** It supplies conditional reads, manifests, paths, conflicts and continuation, but does not create directories, atomically write a local mirror or reproduce CLI concurrency. Removal reconciliation is withheld when the scope cannot finish in one response. Consequently a large paginated course cannot currently obtain a complete pruning plan from one sync cycle. Cross-source identity changes are treated as new files rather than guessed from equal content hashes.
3. **References and scope follow confirmed account bindings.** Arbitrary upstream URLs, local filesystem paths and guessed course associations are not accepted. Cross-course content is limited to confirmed linked enrollments. These are deliberate authorization boundaries. Discovery remains available for unbound enrollments.
4. **HTML and PDF delivery have explicit bounds.** Saved Moodle HTML removes active content and blocks external images; embedded images are limited to 5 MiB each and 10 MiB per document. OnTrack Markdown uses the upstream converter with 200-page/4 MiB bounds and no OCR. Large source PDFs remain subject to the suite's smaller binary limit.
5. **Host interaction and real platform mutations are not end-to-end verified.** MCP App RPC behavior is tested with a synthetic host; actual host rendering and permissions vary. Ed practice answers stay local unless the user requests a review prompt. Upstream Ed posting itself reports mock-only validation, and Moodle quiz support is beta. The suite's tests exercise official clients against synthetic platform responses; no live post, submission, quiz answer or read-marker mutation was made for this audit.

Local login/logout, credential configuration, installation/update, skill generation, command-help formatting, keepalive, doctor, coverage/deployment/connect/revoke/renew CLI commands are outside this educational API. Their absence is intentional. Account connections and renewal use the broker and `learning:bindings` instead.

## Verification evidence

Execution regressions cover ownership, preview freshness, password redaction, activity filtering, attachment continuation, cross-course forum ranking, sync conditional requests and local conflicts, Unicode limits and unexpected write receipts. Runtime tests execute the built Worker and broker using synthetic HTTP fixtures, including PDF conversion and password-protected quiz preflight. The test suite also covers OAuth, encrypted staging, explicit write confirmation, stale previews and uncertain outcomes.

On this revision, `pnpm check`, 238 unit tests, 38 workerd runtime tests, both Worker builds and the generated capability reference check passed. Runtime tests use synthetic platform responses.

Run `pnpm check`, `pnpm test`, `pnpm build`, `pnpm build:broker`, `pnpm test:runtime`, `pnpm capabilities:check` and `pnpm upstreams check` before publishing. This audit does not authorize a push, deployment or live educational write.
