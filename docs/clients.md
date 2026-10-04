# Connect an MCP client

Learning MCP supports remote MCP over Streamable HTTP with OAuth. Use `https://YOUR_SUITE_HOST/mcp` as the server URL. The server advertises its authorization endpoints and supports client ID metadata documents, dynamic client registration, PKCE S256 and resource indicators. Credentials are entered on the service's account page, outside the chat.

## ChatGPT

1. Open ChatGPT Settings → Security and login and enable Developer mode. Availability depends on the account and workspace policy.
2. Open ChatGPT Plugins, select the plus button, and create a connection named **Learning MCP** with the server URL `https://YOUR_SUITE_HOST/mcp`.
3. Use OAuth for authentication. Let the client discover the server's authorization configuration and identify or register its OAuth client; deployment secrets are not client credentials.
4. Follow the service's sign-in page, review the data handling notice, and approve reading plus connection management (`learning:read learning:bindings`). This lets the client connect platforms and bind courses during setup. Educational platform operations remain read-only. Use the same supported SSO provider account or Ed identity as any existing platform connections.
5. Install the plugin in your personal plugins, start a new conversation with it enabled, and ask “Show my connected platforms and courses.”
6. Connect additional platforms through `start_connection` or `https://YOUR_SUITE_HOST/landing`. Discover courses, ask the client to preview their associations together, review the selected platforms and any changes to existing mappings, then confirm the batch once. Do not remove old mappings before replacing them.

These steps follow OpenAI's [connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt) and [plugin quickstart](https://developers.openai.com/plugins/quickstart). OAuth discovery and registration are described in the [authentication guide](https://developers.openai.com/plugins/build/auth).

## Other clients

Use the same MCP URL with any client supporting the service's OAuth flow. The suite displays the registered client name on the authorization page. Availability and setup screens depend on the client.

## Connection checks

### Use only one platform

Connect only the platforms you want. For Moodle alone, connect Moodle, discover its enrolled courses, then preview and confirm mappings containing only `moodle_course_id`. Ask the client to use Moodle tools for those courses. Ed and OnTrack connections are not required. The same MCP connection can later include other platforms. The tool list currently includes all supported platforms; seeing an Ed or OnTrack tool does not mean you must connect it.

### OAuth checks

- An unauthenticated request to `/mcp` returns `401` with a `WWW-Authenticate` challenge pointing to protected resource metadata.
- `/.well-known/oauth-protected-resource/mcp` describes the canonical MCP resource and authorization server.
- `/.well-known/oauth-authorization-server` publishes authorization, token and client registration endpoints.
- After changing the server origin, create a connection using the new URL and authorize it again. The new browser session does not inherit cookies from the old hostname.
- After changing tool metadata, refresh the connection in the client and start a new conversation.
- A client previously authorized with only `learning:read` needs one permission upgrade before it can connect platforms or bind courses. Refresh the connection and approve `learning:bindings`; this is separate from token expiry. Existing read-only grants continue to work for reading.

Do not paste SSO passwords, TOTP secrets, platform tokens or deployment secrets into chat or client configuration. Enter platform credentials only on the account connection page.
