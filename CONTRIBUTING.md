# Contributing

Read [README](README.md), [domain context](CONTEXT.md) and [architecture](docs/architecture.md) before changing behavior. The original code and documentation use the [PolyForm Noncommercial license](LICENSE); bundled clients retain their upstream licenses.

Use Node.js 24 or later and pnpm 10.14.0:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

For authentication or Worker changes, also run `pnpm test:runtime`. It builds both Workers and runs local workerd integration tests. These tests use fixtures; real SSO validation belongs in a configured deployment.

Keep platform reads read-only, credentials outside MCP output, accounts isolated and network destinations administrator-configured. Course associations must come from fresh discovery and user confirmation. Keep attendance search evidence clear about dates and coverage.

Do not edit generated client bundles in `vendor/` directly. Use `pnpm upstreams sync` to refresh official sources, review hashes and licenses, and validate first-party wrappers against the new versions. Prefer focused regression tests for protocol behavior over tests that repeat implementation details.

Describe the problem, resulting behavior and validation in a pull request. Update user-facing documentation when configuration, tools or data handling change. Share sanitized fixtures and error codes; exclude credentials, personal course data and production configuration. Report security vulnerabilities through [SECURITY](SECURITY.md).
