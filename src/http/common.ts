import { SuiteError } from "../errors.ts";

export const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  // Native form POSTs use Origin: null under no-referrer (Fetch Standard).
  // Preserve same-origin form Origin; withhold referrers from other origins.
  "referrer-policy": "same-origin",
};
/** The callback has already been validated against this OAuth client's registration. */
export function oauthFormPolicy(callback: string) {
  const url = new URL(callback);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new SuiteError("INVALID_CALLBACK", "Use a valid OAuth callback.");
  return securityHeaders["content-security-policy"].replace(
    "form-action 'self'",
    `form-action 'self' ${url.origin}`,
  );
}
export function responseSecurityHeaders(headers: Headers) {
  for (const [key, value] of Object.entries(securityHeaders)) {
    // Authorization pages scope their form redirects to the validated client's callback.
    if (key === "content-security-policy" && headers.has(key)) continue;
    headers.set(key, value);
  }
  return headers;
}
export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function html(
  content: string,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(content, {
    status,
    headers: {
      ...securityHeaders,
      "content-type": "text/html;charset=utf-8",
      ...headers,
    },
  });
}
export function json(
  content: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(content, {
    status,
    headers: { ...securityHeaders, ...headers },
  });
}
export function cookie(request: Request, name: string) {
  return (
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ""
  );
}
export async function boundedRequest(
  request: Request,
  maxBytes = 32_768,
): Promise<Request> {
  if (!request.body) return request;
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new SuiteError("BODY_TOO_LARGE", "The request is too large.", 413);
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new SuiteError("BODY_TOO_LARGE", "The request is too large.", 413);
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body: bytes });
}
