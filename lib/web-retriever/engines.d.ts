/**
 * Minimal AnySearch REST client. No multi-engine registry or provider directory
 * exists until a second backend introduces a real abstraction need.
 */
export interface SearchHit {
    url: string;
    title?: string;
    snippet?: string;
    content?: string;
}
export interface SearchResult {
    query: string;
    ok: boolean;
    sources: SearchHit[];
    error?: string;
}
export interface FetchResult {
    url: string;
    ok: boolean;
    title?: string;
    content?: string;
    truncated?: boolean;
    error?: string;
}
/** Structured error codes; spelling is part of the fallback contract. */
export type AnySearchErrorCode = 'ABORTED' | 'TIMEOUT' | 'NETWORK' | 'AUTH' | 'RATE_LIMIT' | 'HTTP' | 'INVALID_RESPONSE' | 'INVALID_URL' | 'TARGET_BLOCKED' | 'CONTENT_TOO_LARGE' | 'UNSUPPORTED_CONTENT' | 'UPSTREAM';
/** Failure with a code; existing message wording remains part of the assertions. */
export declare class AnySearchError extends Error {
    readonly code: AnySearchErrorCode;
    readonly upstreamCode?: string;
    readonly status?: number;
    constructor(code: AnySearchErrorCode, path: string, detail: string, extra?: {
        upstreamCode?: string;
        status?: number;
    });
}
/** Fall back except for cancellation, invalid URL, and unsupported content type. */
export declare function shouldFallbackToLocalFetch(code: AnySearchErrorCode): boolean;
export interface AnySearchClient {
    search(request: {
        query: string;
        max_results?: number;
    }, signal?: AbortSignal): Promise<unknown>;
    extract(request: {
        url: string;
    }, signal?: AbortSignal): Promise<unknown>;
}
export declare const DEFAULT_BASE_URL = "https://api.anysearch.com";
export declare const REQUEST_TIMEOUT_MS = 60000;
export declare const MAX_CONTENT_CHARS = 20000;
export declare function normalizeSearchHit(raw: unknown): SearchHit | null;
export declare function normalizeSearchResponse(query: string, raw: unknown): SearchResult;
export declare function normalizeFetchResponse(url: string, raw: unknown): FetchResult;
export declare function envKey(name: string): string | undefined;
/** Resolve the API key on every request; do not cache it. */
export declare function createAnySearchClient(baseURL?: string, resolveApiKey?: () => Promise<string | undefined>): AnySearchClient;
