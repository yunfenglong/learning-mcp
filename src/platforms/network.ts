import { SuiteError } from "../errors.ts";
export async function safeJsonFetch(input: string, init: RequestInit = {}) {
  const u = new URL(input);
  if (u.protocol !== "https:" || u.username || u.password)
    throw new SuiteError(
      "INVALID_DESTINATION",
      "Use a configured HTTPS service.",
    );
  const response = await fetch(u, {
    ...init,
    redirect: "manual",
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new SuiteError(
      "UPSTREAM_UNAVAILABLE",
      "The service could not complete this request.",
      502,
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  let size = 0;
  const chunks = [];
  while (true) {
    const n = await reader.read();
    if (n.done) break;
    size += n.value.length;
    if (size > 2 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("Response too large");
    }
    chunks.push(n.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function platformFetch(
  origin: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  allowSameOriginRedirects = false,
  maxBytes = 4 * 1024 * 1024,
): typeof fetch {
  return scopedFetch(
    origin,
    fetchImpl,
    maxBytes,
    allowSameOriginRedirects,
    false,
  );
}

/** Return manual file redirects for the bounded, credential-aware file transfer loop. */
export function platformFileFetch(
  origin: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
): typeof fetch {
  return scopedFetch(origin, fetchImpl, maxBytes, true, true);
}

function scopedFetch(
  origin: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
  allowSameOriginRedirects: boolean,
  allowFileRedirects: boolean,
): typeof fetch {
  const trusted = new URL(origin).origin;
  return async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url,
    );
    if (
      url.origin !== trusted ||
      url.protocol !== "https:" ||
      url.username ||
      url.password
    )
      throw new SuiteError(
        "SITE_NOT_ALLOWED",
        "Platform requests must stay on the configured Learning site.",
        403,
      );
    const response = await fetchImpl(input, {
      ...init,
      redirect: "manual",
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    if (
      !allowFileRedirects &&
      response.status >= 300 &&
      response.status < 400
    ) {
      const target = new URL(response.headers.get("location") ?? url.href, url);
      if (
        !allowSameOriginRedirects ||
        target.origin !== trusted ||
        target.username ||
        target.password ||
        target.pathname.startsWith("/login/")
      ) {
        await response.body?.cancel();
        throw new SuiteError(
          "PLATFORM_SESSION_EXPIRED",
          "Reconnect this platform on the account page.",
          409,
        );
      }
    }
    if (!response.body) return response;
    const rangeTotal = Number(
      response.headers.get("content-range")?.split("/")[1],
    );
    if (
      Number(response.headers.get("content-length")) > maxBytes ||
      rangeTotal > maxBytes
    ) {
      await response.body.cancel();
      throw new SuiteError(
        "FILE_TOO_LARGE",
        "Platform response exceeds its remote size limit.",
      );
    }
    let size = 0;
    const bounded = new Response(
      response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(c, controller) {
            size += c.length;
            if (size > maxBytes)
              throw new SuiteError(
                "FILE_TOO_LARGE",
                "Platform response exceeds its remote size limit.",
              );
            controller.enqueue(c);
          },
        }),
      ),
      { status: response.status, headers: response.headers },
    );
    Object.defineProperty(bounded, "url", { value: response.url || url.href });
    return bounded;
  };
}
