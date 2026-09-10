/**
 * AnySearch 的最小 REST 客户端。
 *
 * web_retriever 目前只支持一个后端，因此不预留多引擎注册表、动态 loader 或
 * provider 目录。未来真正接入第二个后端时，再根据实际差异抽象接口。
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
    error?: string;
}
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
/** 创建 AnySearch REST 客户端；API key 每次请求重新解析，不缓存。 */
export declare function createAnySearchClient(baseURL?: string, resolveApiKey?: () => Promise<string | undefined>): AnySearchClient;
