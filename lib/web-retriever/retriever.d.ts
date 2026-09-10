import { AnySearchClient, FetchResult, SearchResult } from './engines.js';
/** 无状态的 AnySearch 适配器：不缓存、不排队、不维护回合或材料索引。 */
export declare class WebRetriever {
    private readonly client;
    constructor(client: AnySearchClient);
    search(query: string, maxResults?: number, signal?: AbortSignal): Promise<SearchResult>;
    fetch(url: string, signal?: AbortSignal): Promise<FetchResult>;
}
