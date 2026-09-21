import type { AnySearchClient, AnySearchErrorCode, SearchResult } from './engines.js';
import type { LocalFetchErrorCode } from './local-fetch.js';
/** 最终产出这份正文的来源；`ok:false` 时恒为 `'anysearch'`（主路）。 */
export type FetchVia = 'anysearch' | 'local-http';
/** 触发回退的那次 AnySearch 失败；永远只描述 AnySearch 侧。 */
export interface FetchFallbackNote {
    from: 'anysearch';
    code: AnySearchErrorCode;
    error: string;
}
/** 本地抓取自己失败的原因；只在"回退被尝试且本地也失败"时出现。 */
export interface FetchLocalErrorNote {
    code: LocalFetchErrorCode;
    error: string;
}
/**
 * `web_retriever_fetch` 的回执。
 *
 * - `via`：最终产出这份正文的来源；`ok:false` 时恒为 `'anysearch'`（主路）。
 * - `fallback`：触发回退的那次 AnySearch 失败，永远只描述 AnySearch 侧
 *   （回退成功与"回退尝试后本地也失败"两种情形都会出现）。
 * - `local_error`：本地抓取自己失败的原因，只在"回退被尝试且本地也失败"时出现。
 *   `fallback.error` 是 AnySearch 的错、`local_error.error` 是本地的错，两者不重复。
 * - `truncated`：正文被截断过（AnySearch 侧截断、本地字节截断、本地字符截断、转换省略，任一为真）。
 */
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
/**
 * 本地抓取器的结构类型。构造函数不传 `localFetch` 即"不启用回退"，
 * 由 `src/index.ts` 按配置决定是否传入。
 */
export interface LocalFetcherLike {
    fetch(url: string, signal?: AbortSignal): Promise<{
        url: string;
        status: number;
        title?: string;
        markdown: string;
        truncated: boolean;
    }>;
}
/** 无状态的 AnySearch 适配器：不缓存、不排队、不维护回合或材料索引。 */
export declare class WebRetriever {
    private readonly client;
    private readonly localFetch?;
    constructor(client: AnySearchClient, localFetch?: LocalFetcherLike | undefined);
    search(query: string, maxResults?: number, signal?: AbortSignal): Promise<SearchResult>;
    fetch(url: string, signal?: AbortSignal): Promise<FetchResult>;
}
