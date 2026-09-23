/**
 * SSRF-gated local HTTP fetcher used after AnySearch extraction fails.
 *
 * Known limitation: DNS is resolved before each request, but the resolved IP is
 * not pinned into the subsequent HTTP connection. A DNS rebinding window remains
 * between validation and connect. Closing that window would require a custom
 * dispatcher; this module keeps the same explicit trade-off as dsh-search-first.
 */
export declare const LOCAL_FETCH_CLIENT_VERSION = "2.1.2";
export declare const LOCAL_FETCH_MAX_URL_LENGTH = 2048;
export type LocalFetchErrorCode = 'ABORTED' | 'TIMEOUT' | 'INVALID_URL' | 'BLOCKED_URL' | 'DNS' | 'REDIRECT' | 'HTTP' | 'TOO_LARGE' | 'UNSUPPORTED_CONTENT_TYPE';
export declare class LocalFetchError extends Error {
    readonly code: LocalFetchErrorCode;
    constructor(code: LocalFetchErrorCode, message: string);
}
export interface LocalFetchOptions {
    timeoutMs: number;
    maxBytes: number;
    maxContentChars: number;
    maxRedirects: number;
    userAgent: string;
    allowPrivate?: boolean;
    resolveAddresses?: (hostname: string, signal: AbortSignal) => Promise<Array<{
        address: string;
        family: number;
    }>>;
}
export interface LocalFetchOutcome {
    url: string;
    status: number;
    title?: string;
    markdown: string;
    truncated: boolean;
}
/** Return true only for an address safe to use as a public outbound target. */
export declare function isPublicIp(address: string): boolean;
export declare function createLocalFetcher(options: LocalFetchOptions): {
    fetch(url: string, signal?: AbortSignal): Promise<LocalFetchOutcome>;
};
