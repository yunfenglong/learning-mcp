import { CliError } from "./errors.js";

export interface AccessCredentials {
  readonly username: string;
  readonly accessToken: string;
}

export interface HttpClientOptions {
  readonly baseUrl: string;
  readonly credentials: AccessCredentials;
  readonly refresh?: (signal: AbortSignal) => Promise<AccessCredentials | void>;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Called once per request. The URL never carries credentials, which are headers. */
  readonly trace?: (entry: { method: string; url: string; status: number; ms: number }) => void;
}

export interface HttpRequestOptions {
  readonly method?: string;
  readonly query?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  readonly body?: BodyInit | null;
  readonly headers?: HeadersInit;
  readonly signal?: AbortSignal;
}

interface HttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly bytes: Uint8Array;
  readonly headers: Headers;
}

export interface DownloadResponse {
  readonly bytes: Uint8Array;
  readonly contentType: string | null;
  readonly filename: string | null;
}

export interface JsonResponse {
  readonly status: number;
  readonly value: unknown;
}

interface ByteRange {
  readonly start: number;
  readonly end: number;
  readonly total: number;
}

const maxDownloadBytes = 256 * 1024 * 1024;
const maxErrorResponseBytes = 64 * 1024;

function archiveTooLarge(): CliError {
  return new CliError("upstream_api", "OnTrack download exceeds the 256 MiB limit");
}

function contentRange(value: string | null): ByteRange | undefined {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(value ?? "");
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total <= end) return undefined;
  return { start, end, total };
}

function requireContentRange(response: HttpResponse, expectedStart: number, expectedTotal?: number): ByteRange {
  const range = contentRange(response.headers.get("Content-Range"));
  if (
    response.status !== 206
    || !range
    || range.start !== expectedStart
    || (expectedTotal !== undefined && range.total !== expectedTotal)
    || response.bytes.length !== range.end - range.start + 1
  ) {
    throw new CliError("upstream_contract", "OnTrack returned an invalid Content-Range response");
  }
  return range;
}

function responseFilename(value: string | null): string | null {
  if (!value) return null;
  const extended = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/iu.exec(value)?.[1];
  let filename: string | undefined;
  if (extended) {
    try {
      filename = decodeURIComponent(extended.trim());
    } catch {
      filename = undefined;
    }
  }
  filename ??= /(?:^|;)\s*filename="([^"]*)"/iu.exec(value)?.[1]
    ?? /(?:^|;)\s*filename=([^;]+)/iu.exec(value)?.[1]?.trim();
  if (!filename) return null;
  const safe = filename.replaceAll("\\", "/").split("/").at(-1)?.replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  return safe && safe !== "." && safe !== ".." ? safe : null;
}

async function responseBytes(response: Response, limit?: number): Promise<Uint8Array> {
  if (limit === undefined) return new Uint8Array(await response.arrayBuffer());
  const range = contentRange(response.headers.get("Content-Range"));
  if (range && range.total > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw archiveTooLarge();
  }
  const lengthHeader = response.headers.get("Content-Length");
  const contentLength = lengthHeader && /^\d+$/u.test(lengthHeader) ? Number(lengthHeader) : undefined;
  if (contentLength !== undefined && contentLength > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw archiveTooLarge();
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  let bytes = new Uint8Array(Math.min(64 * 1024, limit));
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const nextTotal = total + value.length;
    if (nextTotal > limit) {
      await reader.cancel();
      throw archiveTooLarge();
    }
    if (nextTotal > bytes.length) {
      const capacity = Math.min(limit, Math.max(nextTotal, bytes.length * 2));
      const grown = new Uint8Array(capacity);
      grown.set(bytes.subarray(0, total));
      bytes = grown;
    }
    bytes.set(value, total);
    total = nextTotal;
  }
  return bytes.subarray(0, total);
}

async function errorResponseBytes(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const bytes = new Uint8Array(maxErrorResponseBytes);
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return bytes.subarray(0, total);
    if (total + value.length > bytes.length) {
      await reader.cancel();
      return new Uint8Array();
    }
    bytes.set(value, total);
    total += value.length;
  }
}

function upstreamErrorDetail(bytes: Uint8Array): string | undefined {
  if (bytes.length === 0) return undefined;
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const error = Reflect.get(value, "error");
    if (typeof error !== "string") return undefined;
    const safe = error.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
    return safe ? Array.from(safe).slice(0, 500).join("") : undefined;
  } catch {
    return undefined;
  }
}

export class HttpClient {
  readonly #baseUrl: URL;
  readonly #fetch: typeof globalThis.fetch;
  readonly #refresh: ((signal: AbortSignal) => Promise<AccessCredentials | void>) | undefined;
  readonly #timeoutMs: number;
  readonly #signal: AbortSignal | undefined;
  readonly #trace: HttpClientOptions["trace"];
  #credentials: AccessCredentials;
  #refreshing: Promise<void> | undefined;
  #sessionVersion = 0;

  constructor(options: HttpClientOptions) {
    this.#baseUrl = new URL(options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);
    this.#credentials = options.credentials;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#refresh = options.refresh;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#signal = options.signal;
    this.#trace = options.trace;
  }

  async request(path: string, options: HttpRequestOptions = {}): Promise<unknown> {
    return (await this.requestWithStatus(path, options)).value;
  }

  async requestWithStatus(path: string, options: HttpRequestOptions = {}): Promise<JsonResponse> {
    const response = await this.#response(path, options);
    try {
      return { status: response.status, value: JSON.parse(new TextDecoder().decode(response.bytes)) as unknown };
    } catch {
      throw new CliError("upstream_contract", "OnTrack returned invalid JSON");
    }
  }

  async download(path: string, options: HttpRequestOptions = {}): Promise<Uint8Array> {
    return (await this.downloadFile(path, options)).bytes;
  }

  async downloadFile(path: string, options: HttpRequestOptions = {}): Promise<DownloadResponse> {
    const headers = new Headers(options.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/octet-stream");
    const first = await this.#response(path, { ...options, headers }, maxDownloadBytes);
    const metadata = {
      contentType: first.headers.get("Content-Type")?.split(";", 1)[0]?.trim() || null,
      filename: responseFilename(first.headers.get("Content-Disposition")),
    };
    if (first.status !== 206) return { bytes: first.bytes, ...metadata };

    const initialRange = requireContentRange(first, 0);
    if (initialRange.total > maxDownloadBytes) throw archiveTooLarge();
    const bytes = new Uint8Array(initialRange.total);
    bytes.set(first.bytes, 0);
    let offset = initialRange.end + 1;
    while (offset < initialRange.total) {
      const rangeHeaders = new Headers(headers);
      rangeHeaders.set("Range", `bytes=${offset}-`);
      const response = await this.#response(path, { ...options, headers: rangeHeaders }, maxDownloadBytes);
      const range = requireContentRange(response, offset, initialRange.total);
      bytes.set(response.bytes, offset);
      offset = range.end + 1;
    }
    return { bytes, ...metadata };
  }

  async #response(path: string, options: HttpRequestOptions, responseLimit?: number): Promise<HttpResponse> {
    const url = new URL(path.replace(/^\//, ""), this.#baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const method = (options.method ?? "GET").toUpperCase();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sessionVersion = this.#sessionVersion;
      const startedAt = Date.now();
      const response = await this.#send(url, method, options, responseLimit);
      this.#trace?.({ method, url: url.toString(), status: response.status, ms: Date.now() - startedAt });
      if (response.status === 419 && method === "GET" && attempt === 0 && this.#refresh) {
        if (sessionVersion === this.#sessionVersion) {
          await this.#refreshOnce(options.signal ?? this.#signal ?? new AbortController().signal);
        }
        continue;
      }
      if (response.status === 401 || response.status === 419) {
        throw new CliError("auth", "OnTrack rejected the authenticated session", response.status);
      }
      if (response.status === 404) {
        throw new CliError("not_found", "The requested OnTrack entity does not exist", response.status);
      }
      if (!response.ok) {
        const detail = upstreamErrorDetail(response.bytes);
        throw new CliError("upstream_api", `OnTrack returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`, response.status);
      }
      return response;
    }
    throw new CliError("auth", "OnTrack rejected the refreshed session", 419);
  }

  async #refreshOnce(signal: AbortSignal): Promise<void> {
    this.#refreshing ??= (async () => {
      const refreshed = await this.#refresh?.(signal);
      if (refreshed) this.#credentials = refreshed;
      this.#sessionVersion += 1;
    })().finally(() => {
      this.#refreshing = undefined;
    });
    await this.#refreshing;
  }

  async #send(url: URL, method: string, options: HttpRequestOptions, responseLimit?: number): Promise<HttpResponse> {
    const headers = new Headers(options.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    headers.set("Username", this.#credentials.username);
    headers.set("Auth-Token", this.#credentials.accessToken);
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.#timeoutMs);
    const externalSignal = options.signal ?? this.#signal;
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, timeoutController.signal])
      : timeoutController.signal;
    try {
      const init: RequestInit = { method, headers, signal };
      if (options.body !== undefined) init.body = options.body;
      const response = await this.#fetch(url, init);
      if (!response.ok) {
        return { status: response.status, ok: false, bytes: await errorResponseBytes(response), headers: new Headers(response.headers) };
      }
      return {
        status: response.status,
        ok: response.ok,
        bytes: await responseBytes(response, responseLimit),
        headers: new Headers(response.headers),
      };
    } catch (error) {
      if (error instanceof CliError) throw error;
      if (externalSignal?.aborted) {
        throw new CliError("cancellation", "Request cancelled");
      }
      if (timeoutController.signal.aborted) {
        throw new CliError("network", `OnTrack request timed out after ${this.#timeoutMs}ms`);
      }
      throw new CliError("network", error instanceof Error ? error.message : "Network request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}
