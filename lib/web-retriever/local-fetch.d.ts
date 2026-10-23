/**
 * SSRF-gated local HTTP fetcher, used after AnySearch extraction fails.
 * Known limit: DNS resolves per request but the IP is not pinned to the connection,
 * so a rebinding window remains (same trade-off as dsh-search-first).
 */
export declare const LOCAL_FETCH_CLIENT_VERSION = "2.9.2";
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
/**
 * Upstream URLs become clickable markdown, so: http(s) only (javascript:/data: execute),
 * no whitespace/control chars (newlines escape the link), no credentials (displayed host
 * != target), length cap. Raw string, not `href`, to avoid percent-encoding non-ASCII;
 * `''` means drop the field, never the item.
 */
export declare function safeUrl(value: unknown, maxChars?: number): string;
/**
 * Gate for a URL fetched by someone else (ocr url form): same shape + public-host
 * check, no request. `allowPrivate` is always false — that risk is not ours to waive.
 * Returns the raw string (href would percent-encode non-ASCII and eat budget).
 */
export declare function assertPublicUrlTarget(value: unknown, signal: AbortSignal, resolveAddresses?: LocalFetchOptions['resolveAddresses']): Promise<string>;
/**
 * Request descriptor shared by `createLocalFetcher` (GET + markdown for fallback)
 * and the named-source tools, so there is exactly one egress gate.
 */
export interface HttpRequest {
    url: string;
    method?: 'GET' | 'POST';
    /** Extra headers (e.g. Referer); source recipes only, never model input. */
    headers?: Record<string, string>;
    /** String body -> x-www-form-urlencoded; FormData sets no content-type (impl supplies the boundary). */
    body?: string | FormData;
    /** Override the accept header for this request. */
    accept?: string;
    /** Body encoding, overrides the response charset. Source-internal: a wrong value silently mojibakes. */
    encoding?: string;
    /**
     * Per-request caps: global ones fit a web page, but parsed OCR JSONL can hit 258 KB
     * and a truncated result is a parse failure, not "a few fewer rows".
     */
    maxBytes?: number;
    maxContentChars?: number;
}
export interface HttpOutcome {
    url: string;
    status: number;
    /** Raw body, no conversion (JSON passes through, HTML stays raw; the tool decides). */
    text: string;
    truncated: boolean;
}
export declare function createHttpRequester(options: LocalFetchOptions): {
    request(request: HttpRequest, signal?: AbortSignal): Promise<HttpOutcome>;
};
/**
 * Fallback fetcher: GET, then choose presentation (JSON raw, HTML -> markdown).
 * Egress, redirects, limits and cancellation all delegate to `createHttpRequester`.
 */
export declare function createLocalFetcher(options: LocalFetchOptions): {
    fetch(url: string, signal?: AbortSignal): Promise<LocalFetchOutcome>;
};
