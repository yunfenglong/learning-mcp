# Error codes and messages

Generated from suite and private broker source with `pnpm errors:catalog`. Browser error pages and JSON errors include the code and a sanitized message. A code can have different messages for different operations; placeholders describe context, never credentials. OAuth protocol errors from the OAuth library are separate. Unexpected exceptions remain `INTERNAL_ERROR` so private provider text is not exposed.

For sign-in, `INVALID_TOTP` checks encoding and supported parameters; it cannot prove a secret belongs to the account. `MFA_TOTP_REJECTED` and `MFA_CODE_REJECTED` mean the provider did not complete verification, not proof of which provider-side setting caused it. Interactive sign-in submits each code once, stops after 3 validation/verification errors across methods, and expires after 5 minutes. Password/SSO errors do not establish an authenticated suite session.

| Code | Public messages |
| --- | --- |
| `ACCESS_DENIED` | Invalid login operation.<br>Account mismatch.<br>Client authorization is missing, expired or revoked.<br>Invalid Learning authorization. |
| `ACCOUNT_CHANGED` | Reconnect Ed to confirm this account.<br>Reconnect the platform to confirm this account.<br>Reconnect Moodle to confirm this account.<br>Reconnect OnTrack to confirm this account.<br>OnTrack returned conflicting account identities. Reconnect OnTrack.<br>Renewal returned a different account. Reconnect explicitly.<br>Sign-in identity could not be verified. |
| `ACCOUNT_MISMATCH` | Sign in with the same account used by your MCP client, or open a new connection link. |
| `AMBIGUOUS_UNIT` | Choose a unit key: {matches.map((unit) => unit.key).join(", ")}. |
| `AUTH_RETRY_LATER` | Too many sign-in attempts. Try again later.<br>Sign-in failed recently. Wait before retrying or reconnect with updated credentials. |
| `AUTHORIZATION_FAILED` | Start a new connection. |
| `BASE_LINK_REQUIRED` | Enter the platform base link when connecting this account. |
| `BATCH_TOO_LARGE` | Select fewer files or download this file individually; one batch is limited to 16 MiB. |
| `BINDING_PREVIEW_CHANGED` | Courses or mappings changed. Review a fresh preview before confirming; no mappings have changed. |
| `BINDING_PREVIEW_EXPIRED` | Create a fresh binding preview. No mappings have changed. |
| `BODY_TOO_LARGE` | The request is too large. |
| `BROKER_CONFIG` | Configure HTTPS login origins.<br>Allow the site's verified SSO origin in the broker configuration. |
| `BROKER_NOT_CONFIGURED` | Configure the private Okta / SSO broker. |
| `BROKER_UNAVAILABLE` | Reconnect the platform on the account page. |
| `BROWSER_BUSY` | The cloud browser is busy. Try signing in again shortly. |
| `BROWSER_DAILY_LIMIT` | The service's daily cloud browser allowance has been used. Try again after it resets. |
| `CONSENT_REQUIRED` | Approve the requested permissions.<br>Confirm the disconnect.<br>Confirm removal of the saved sign-in.<br>Approve this connection.<br>Saving a TOTP setup key also requires password retention. Leave both unchecked to use credentials only for this sign-in. |
| `COURSE_DISCOVERY_UNAVAILABLE` | Course discovery for {platform} did not complete. Retry discover_courses and check its platform error before binding. Existing mappings have not changed. |
| `COURSE_NOT_ACCESSIBLE` | Choose a verified course discovered for this account.<br>This course is no longer enrolled for the connected account. |
| `CREDENTIAL_UNAVAILABLE` | Reconnect this platform or check the credential encryption key. |
| `DIFFERENT_COURSE_CONTEXT` | Platform semester or location details differ from your chosen mapping. Review these details before confirming; they do not prevent a manual association. |
| `DIFFERENT_PLATFORM_CODE` | This platform uses a different course identifier. Confirm the selected course and teaching period. |
| `DISCOVERY_REQUIRED` | Refresh enrolled courses before confirming a mapping.<br>Refresh enrolled courses before reviewing mappings. |
| `ED_IDENTITY_UNVERIFIED` | Ed did not return a verified account. Sign in again with a valid Ed token. |
| `ED_LOGIN_FAILED` | The Ed token could not be verified. Check the token and try again.<br>Ed did not return a verified account. |
| `ED_TOKEN_REJECTED` | The Ed token could not be verified. Enter a valid token for your account. |
| `ENTITY_NOT_ALLOWED` | The OnTrack unit does not match this Learning unit.<br>This task is not in the configured OnTrack project.<br>The requested item does not belong to this configured course.<br>This slide is not part of the selected lesson.<br>Choose one activity ID or exact name from the selected course.<br>This forum is not part of the selected course.<br>Choose one of your attempts listed by this quiz.<br>Choose one task definition ID or exact abbreviation from this project.<br>This object does not belong to the selected course. |
| `FILE_CONTAINS_CREDENTIALS` | This file contains credential material and cannot be returned.<br>This image contains credential material. |
| `FILE_NOT_FOUND` | Choose a file index from the fresh file listing.<br>Choose a file index returned by this activity.<br>This page has no readable document. |
| `FILE_TOO_LARGE` | Platform response exceeds its remote size limit.<br>This file exceeds the remote download limit.<br>Remote files are limited to 16 MiB each.<br>This document contains too many inline images.<br>Task sheets are limited to 200 pages. |
| `FILE_UNAVAILABLE` | The platform could not return this file. |
| `INCOMPLETE_COURSE_CONTEXT` | Some platforms omit semester or location details. Check the selected courses before confirming. |
| `INSUFFICIENT_SCOPE` | This client has read-only access. Authorize learning:bindings to connect platforms or change course mappings. This is a permission upgrade, not an expired login; reading remains available. |
| `INTERNAL_ERROR` | The request could not be completed. |
| `INVALID_BASE_LINK` | Enter a public HTTPS platform base link, without a path, query, fragment or credentials. |
| `INVALID_CALLBACK` | Use a valid OAuth callback. |
| `INVALID_CLIENT` | Unknown client. |
| `INVALID_CONFIG` | The credential encryption key must be base64 encoded.<br>The credential encryption key must contain 32 bytes.<br>Configure the suite HTTPS origin and platform origins.<br>Unit keys must be unique.<br>Each {field} must belong to one configured unit. |
| `INVALID_CONNECTION` | Open a new connection link.<br>Open the correct platform connection. |
| `INVALID_CONSENT` | Open the consent page again.<br>This consent belongs to another request or browser.<br>Consent has already been consumed. |
| `INVALID_DATE` | Use a valid calendar date in YYYY-MM-DD format. |
| `INVALID_DESTINATION` | Use a configured HTTPS service. |
| `INVALID_HOST` | Use the configured Learning MCP origin. |
| `INVALID_INPUT` | Choose a linked course.<br>Provide exactly one lesson_id or thread_id.<br>Provide exactly one thread_id or course-local number.<br>Provide exactly one task_definition_id or task abbreviation.<br>One or more request fields are missing or invalid. Check the form and try again.<br>The selected page is outside this task sheet.<br>Provide {label}. |
| `INVALID_LOGIN_FORM` | The sign-in form is invalid. Open the sign-in page again. |
| `INVALID_MFA_METHOD` | Select a verification method offered on the sign-in page. |
| `INVALID_ORIGIN` | Open the sign-in page again.<br>Open the account page again.<br>Use private administration. |
| `INVALID_OTP` | Enter a current verification code containing 6 to 8 digits. One-time codes are not saved.<br>Enter a current verification code containing 6 to 8 digits. |
| `INVALID_PASSWORD` | Enter a valid password (1 to 1000 characters). |
| `INVALID_PROVIDER` | Enter the public HTTPS base link of your supported SSO provider. |
| `INVALID_RESOURCE` | Request the Learning MCP resource. |
| `INVALID_RETURN` | Invalid sign-in return address. |
| `INVALID_SCOPE` | Unsupported permission.<br>Request supported Learning permissions. |
| `INVALID_TOKEN` | Enter a valid platform token on the account page. |
| `INVALID_TOTP` | Use a valid Base32 TOTP secret or otpauth://totp URI, not a current code.<br>Use a valid Base32 TOTP secret or otpauth://totp URI. Do not enter a current verification code. |
| `INVALID_USERNAME` | Enter a valid SSO username (1 to 200 characters). |
| `LOGIN_FAILED` | Sign-in belongs to another browser or has expired.<br>Start a new sign-in. |
| `LOGIN_METHOD_REMOVED` | Platform sign-in has been removed. Sign in with your SSO provider or Ed API token. |
| `LOGIN_REQUIRED` | Sign in to Learning MCP.<br>Start sign-in again. |
| `METHOD_NOT_ALLOWED` | Use POST.<br>Use GET or POST.<br>Use GET. |
| `MFA_ATTEMPTS_EXCEEDED` | Verification stopped after 3 errors. Start a new sign-in and check your secret or use another available method. |
| `MFA_CODE_REJECTED` | The provider did not accept this code. It may be incorrect, expired or already used. Enter a fresh code for the selected method. |
| `MFA_CODE_REQUIRED` | The selected method is ready. Enter its current verification code; leave other method fields empty. |
| `MFA_FORM_UNSUPPORTED` | The provider's verification form could not be used. Start a new sign-in or select another available method. |
| `MFA_METHOD_UNAVAILABLE` | This verification method is not offered by the current SSO page. Choose an available method. |
| `MFA_REQUIRED` | The provider requested a verification code. Supply a current code or a TOTP secret for automated sign-in. |
| `MFA_SESSION_EXPIRED` | This verification session expired. Start a new sign-in.<br>This verification session has expired or is no longer available. Start a new sign-in. |
| `MFA_TOTP_REJECTED` | The provider did not accept the generated TOTP code. Check that the setup secret belongs to this account and authenticator, and check its digits, period and clock settings. You can choose another available method. |
| `NOT_FOUND` | Unknown account operation.<br>Unknown administration route.<br>Unknown account action.<br>Unknown MCP route.<br>Unknown route.<br>Unknown broker route. |
| `PKCE_REQUIRED` | PKCE S256 is required. |
| `PLATFORM_NOT_CONFIGURED` | This unit has no Ed course.<br>Connect Moodle and enter its base link.<br>This unit has no Moodle course.<br>This unit has no OnTrack project.<br>Bind at least one Moodle course before reading course content. |
| `PLATFORM_NOT_CONNECTED` | Connect Ed on the account page.<br>Connect {this.platform} and enter its base link on your account page.<br>Connect {p} on the account page.<br>Connect Moodle on the account page.<br>Connect the platform on the account page. |
| `PLATFORM_REQUEST_REJECTED` | OnTrack rejected the request with HTTP {status}.<br>OnTrack rejected the request. |
| `PLATFORM_SESSION_EXPIRED` | Reconnect this platform on the account page.<br>OnTrack rejected the platform session. Reconnect OnTrack on the account page.<br>Moodle returned a sign-in page instead of a file.<br>Moodle did not return an authenticated account. Reconnect the platform.<br>Moodle could not verify this session. Reconnect or retry later.<br>Moodle removed its session cookie. Reconnect the platform. |
| `PLATFORM_SITE_CHANGED` | Disconnect this platform before connecting a different base link.<br>This platform connection has changed. Open a new request. |
| `PLATFORM_UNAVAILABLE` | This platform is not configured.<br>The {platform} read failed. Check its connection. |
| `QUERY_CREDENTIAL` | Credentials must not appear in request URLs. |
| `RESOURCE_ORIGIN_NOT_ALLOWED` | The operator must configure this Ed file's exact HTTPS origin in RESOURCE_ORIGINS. |
| `SESSION_INVALID` | OnTrack did not return a valid renewed session.<br>OnTrack sign-in did not provide a usable refresh cookie. Reconnect the platform.<br>Moodle could not verify this session.<br>Moodle did not return an authenticated account.<br>Moodle removed its session cookie. Reconnect the platform.<br>The OnTrack access token has expired. Reconnect the platform.<br>OnTrack did not validate this account.<br>The platform session could not be verified. Sign in to the platform and try again. |
| `SITE_NOT_ALLOWED` | The authenticated Moodle site does not match your saved base link.<br>Credentials cannot be sent to file resource origins.<br>Platform requests must stay on the configured Learning site.<br>Only a file returned by this course on its saved Moodle site can be downloaded. |
| `SSO_ACCOUNT_CHANGED` | Disconnect Moodle and OnTrack before connecting a different SSO account. |
| `SSO_CREDENTIAL_DESTINATION` | Verification can only be completed at your supported identity provider.<br>SSO credentials can only be entered at your supported identity provider. Check the platform base link. |
| `SSO_CREDENTIALS_REJECTED` | The provider did not accept the username or password, or has blocked sign-in. Check your account details before trying again. |
| `SSO_DESTINATION` | SSO navigated outside the configured login origins. |
| `SSO_INTERACTION_REQUIRED` | The provider requires a challenge this service cannot use. Start a new sign-in.<br>Sign-in needs additional interaction. Reconnect after completing the provider's required challenge. |
| `SSO_LOGIN_REQUIRED` | The saved SSO session has expired. Connect again with your SSO login.<br>Connect with your SSO login first. |
| `SSO_NOT_CONFIGURED` | Configure cloud browser SSO.<br>Browser SSO is unavailable. Connect with an existing platform session. |
| `SSO_PROVIDER_UNAVAILABLE` | This SSO provider is not supported by this service. |
| `SSO_TIMEOUT` | Sign-in took too long. Open the sign-in page and try again. |
| `SSO_UNAVAILABLE` | The cloud sign-in could not complete. Open the sign-in page and try again. |
| `STATE_UNAVAILABLE` | Account state is unavailable. |
| `TOOL_NOT_ALLOWED` | Client platform mismatch.<br>Only approved platform reads are available.<br>Unhandled read operation: {operation} |
| `UNAUTHORIZED` | Administrator authentication required.<br>Private broker authentication required. |
| `UNIT_NOT_ALLOWED` | This unit is not in the Learning course registry.<br>Bind this OnTrack project first. |
| `UPSTREAM_CONTRACT_ERROR` | Unexpected platform response.<br>Unexpected platform list.<br>OnTrack did not return a PDF task sheet. |
| `UPSTREAM_RESPONSE_INVALID` | OnTrack returned a response the platform client could not read.{detail} |
| `UPSTREAM_UNAVAILABLE` | The service could not complete this request.<br>OnTrack returned HTTP {status}. Retry later.<br>OnTrack could not complete the network request. Retry later.<br>Moodle could not renew this session. Retry later.<br>OnTrack could not renew this session. Retry later.<br>OnTrack returned an invalid renewal response.<br>Moodle could not verify this session. Retry later.<br>Moodle could not verify this session.<br>Moodle could not verify this session. Reconnect or retry later. |
| `USAGE_REQUIRED` | Review and accept the current usage notice.<br>Review the current usage notice.<br>Read and accept the usage notice on the account page.<br>Accept the usage notice. |
