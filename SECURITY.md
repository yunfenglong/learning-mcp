# Security

Report suspected account-isolation failures, credential exposure, authentication bypasses or unsafe network destinations privately. Use the repository's **Security → Report a vulnerability** flow if private reporting is enabled. If it is unavailable, open an issue asking the maintainer for a private contact channel without including exploit details or sensitive data.

Include affected code or version, the expected and observed behavior, and a minimal reproduction using synthetic accounts. Never send real passwords, tokens, cookies, TOTP secrets or private course content. There is no guaranteed response time or security certification.

Operators control deployment configuration and encryption keys. Encryption protects stored records but does not prevent the operator from decrypting them. Keep the broker private, protect deployment access and keys, and verify the complete flow with independent users before offering the service. See [configuration](docs/configuration.md) and [data handling](docs/architecture.md#storage-and-deletion).

MCP results and administration responses redact recognized credential fields, credential-bearing URL parameters and credentials known to the request. Broker session responses are authenticated internal traffic and use `no-store`. Application code does not log credentials, upstream response bodies or browser traces. Course content still goes to the authorized client; this boundary does not automatically classify every kind of personal or sensitive information in arbitrary course text. Cloud sign-in trusts the administrator-configured platform and identity-provider origins.
