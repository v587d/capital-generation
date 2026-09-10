import { normalizeFetchResponse, normalizeSearchResponse } from './engines.js';
/** 无状态的 AnySearch 适配器：不缓存、不排队、不维护回合或材料索引。 */
export class WebRetriever {
    client;
    constructor(client) {
        this.client = client;
    }
    async search(query, maxResults, signal) {
        const raw = await this.client.search({
            query,
            ...(maxResults === undefined ? {} : { max_results: maxResults }),
        }, signal);
        return normalizeSearchResponse(query, raw);
    }
    async fetch(url, signal) {
        const raw = await this.client.extract({ url }, signal);
        return normalizeFetchResponse(url, raw);
    }
}
