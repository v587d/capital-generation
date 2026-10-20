import type { AnySearchClient, AnySearchErrorCode, SearchResult } from './engines.js';
import type { LocalFetchErrorCode } from './local-fetch.js';
/** Which path produced the body; always `'anysearch'` when `ok:false`. */
export type FetchVia = 'anysearch' | 'local-http';
/** The AnySearch failure that triggered fallback. */
export interface FetchFallbackNote {
    from: 'anysearch';
    code: AnySearchErrorCode;
    error: string;
}
/** Why local fetching failed; only when fallback ran and also failed. */
export interface FetchLocalErrorNote {
    code: LocalFetchErrorCode;
    error: string;
}
/** `web_retriever_fetch` receipt; `truncated` covers any truncation path. */
export interface FetchResult {
    url: string;
    ok: boolean;
    via: FetchVia;
    title?: string;
    content?: string;
    truncated?: boolean;
    fallback?: FetchFallbackNote;
    error?: string;
    code?: AnySearchErrorCode;
    local_error?: FetchLocalErrorNote;
}
/** Structural fetcher; omitting it disables fallback (decided in `src/index.ts`). */
export interface LocalFetcherLike {
    fetch(url: string, signal?: AbortSignal): Promise<{
        url: string;
        status: number;
        title?: string;
        markdown: string;
        truncated: boolean;
    }>;
}
/** Stateless AnySearch adapter: no cache, queue, turn or corpus index. */
export declare class WebRetriever {
    private readonly client;
    private readonly localFetch?;
    constructor(client: AnySearchClient, localFetch?: LocalFetcherLike | undefined);
    search(query: string, maxResults?: number, signal?: AbortSignal): Promise<SearchResult>;
    fetch(url: string, signal?: AbortSignal): Promise<FetchResult>;
}
