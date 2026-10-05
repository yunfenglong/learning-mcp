export declare function fetchWithSession(input: string, init: RequestInit, moodleOrigin: string, cookie: {
    name: string;
    value: string;
}, fetchImpl?: typeof fetch): Promise<Response>;
/**
 * Node reports every transport problem as "fetch failed", which tells the user
 * nothing about which host went missing or whether they simply timed out. This
 * module is bundled into the Worker, so it stays free of CLI dependencies and
 * the callers map it onto their own error type.
 */
export declare class RequestFailed extends Error {
    readonly host: string;
    readonly timedOut: boolean;
    constructor(host: string, timedOut: boolean, cause?: string);
}
