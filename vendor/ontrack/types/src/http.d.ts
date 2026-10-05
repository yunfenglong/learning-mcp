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
    readonly trace?: (entry: {
        method: string;
        url: string;
        status: number;
        ms: number;
    }) => void;
}
export interface HttpRequestOptions {
    readonly method?: string;
    readonly query?: Readonly<Record<string, string | number | boolean | null | undefined>>;
    readonly body?: BodyInit | null;
    readonly headers?: HeadersInit;
    readonly signal?: AbortSignal;
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
export declare class HttpClient {
    #private;
    constructor(options: HttpClientOptions);
    request(path: string, options?: HttpRequestOptions): Promise<unknown>;
    requestWithStatus(path: string, options?: HttpRequestOptions): Promise<JsonResponse>;
    download(path: string, options?: HttpRequestOptions): Promise<Uint8Array>;
    downloadFile(path: string, options?: HttpRequestOptions): Promise<DownloadResponse>;
}
