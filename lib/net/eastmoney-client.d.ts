/**
 * Shared eastmoney network face: one process-wide throttle and one request path for both data
 * planes (Hub datasets and web_retriever text). Eastmoney limits by egress IP, so two throttles
 * equal no throttle. Throttling/status mapping live only here; SSRF checking, when needed, is
 * injected via `transport` and owned by the caller's `createHttpRequester`.
 */
/** 1 request/second, below eastmoney's >5/s trigger and within its cumulative windows. */
export declare const EASTMONEY_MIN_INTERVAL_MS = 1000;
export interface EastmoneyFetchInit {
    headers?: Record<string, string>;
    signal?: AbortSignal;
}
export interface EastmoneyResponse {
    status: number;
    headers?: Headers;
    text: string;
}
export interface EastmoneyClient {
    /**
       * Send and read text: serialization, minimum interval, headers, status classification. No JSON
       * or error codes; callers keep their own semantics.
       */
    fetchText(url: string, init?: EastmoneyFetchInit): Promise<EastmoneyResponse>;
    /** Separate from fetchText because data-plane test doubles only provide `json()`, and parse failures classify here. */
    fetchJson(url: string, init?: EastmoneyFetchInit): Promise<unknown>;
}
/** Transport error; `status` is set only when upstream returned an HTTP error status. */
export declare class EastmoneyTransportError extends Error {
    readonly status?: number | undefined;
    constructor(message: string, status?: number | undefined);
}
export interface EastmoneyTransportResponse {
    status: number;
    headers?: Headers;
    text(): Promise<string>;
    json(): Promise<unknown>;
}
/** Injectable transport; defaults to bare fetch, web_retriever injects its SSRF-gated implementation. */
export type EastmoneyTransport = (url: string, init: {
    headers: Record<string, string>;
    signal?: AbortSignal;
}) => Promise<EastmoneyTransportResponse>;
export declare function createEastmoneyClient(options?: {
    userAgent?: string;
    minIntervalMs?: number;
    throttle?: <T>(task: () => Promise<T>) => Promise<T>;
    transport?: EastmoneyTransport;
}): EastmoneyClient;
/** Process-wide throttle: both clients (different transports) hit the same egress IP, so they share one. */
export declare function sharedEastmoneyThrottle(): <T>(task: () => Promise<T>) => Promise<T>;
/** Process-wide client for the data plane (bare fetch), sharing the process throttle. */
export declare function sharedEastmoneyClient(): EastmoneyClient;
