import { AnySearchError, normalizeFetchResponse, normalizeSearchResponse, shouldFallbackToLocalFetch, } from './engines.js';
import { LocalFetchError } from './local-fetch.js';
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
/** 调用方取消必须原样抛出，不能被降级成"失败信封"。 */
function abortError(signal) {
    return signal.reason ?? new Error('request aborted');
}
/** 无状态的 AnySearch 适配器：不缓存、不排队、不维护回合或材料索引。 */
export class WebRetriever {
    client;
    localFetch;
    constructor(client, localFetch) {
        this.client = client;
        this.localFetch = localFetch;
    }
    async search(query, maxResults, signal) {
        const raw = await this.client.search({
            query,
            ...(maxResults === undefined ? {} : { max_results: maxResults }),
        }, signal);
        return normalizeSearchResponse(query, raw);
    }
    async fetch(url, signal) {
        let trigger;
        try {
            const raw = await this.client.extract({ url }, signal);
            const normalized = normalizeFetchResponse(url, raw);
            if (normalized.ok) {
                return {
                    url,
                    ok: true,
                    via: 'anysearch',
                    ...(normalized.title ? { title: normalized.title } : {}),
                    ...(normalized.content ? { content: normalized.content } : {}),
                    ...(normalized.truncated ? { truncated: true } : {}),
                };
            }
            // "取到了但没有内容"与失败等价，按可回退失败处理。
            trigger = {
                from: 'anysearch',
                code: 'UPSTREAM',
                error: normalized.error ?? 'fetch returned no content',
            };
        }
        catch (error) {
            // 调用方取消：原样抛出，不回退、不吞。
            if (error instanceof AnySearchError && error.code === 'ABORTED')
                throw error;
            const code = error instanceof AnySearchError ? error.code : 'UPSTREAM';
            const message = errorText(error);
            // 非法 URL / 不支持的二进制：本机同样会拒，回退只是白跑一次。
            if (!shouldFallbackToLocalFetch(code)) {
                return { url, ok: false, via: 'anysearch', code, error: message };
            }
            trigger = { from: 'anysearch', code, error: message };
        }
        // 回退前的取消闸门（硬）：调用方已经不要这个结果了，绝不再发一次网络请求。
        if (signal?.aborted)
            throw abortError(signal);
        if (!this.localFetch) {
            return { url, ok: false, via: 'anysearch', code: trigger.code, error: trigger.error };
        }
        try {
            const local = await this.localFetch.fetch(url, signal);
            return {
                url: local.url,
                ok: true,
                via: 'local-http',
                ...(local.title ? { title: local.title } : {}),
                content: local.markdown,
                ...(local.truncated ? { truncated: true } : {}),
                fallback: trigger,
            };
        }
        catch (error) {
            // 本地抓取侧的取消同样原样抛出。
            if (error instanceof LocalFetchError && error.code === 'ABORTED')
                throw error;
            const localMessage = errorText(error);
            const localCode = error instanceof LocalFetchError ? error.code : 'HTTP';
            return {
                url,
                ok: false,
                via: 'anysearch',
                code: trigger.code,
                error: `AnySearch 失败：${trigger.error}；本地直抓也失败：${localMessage}`,
                fallback: trigger,
                local_error: { code: localCode, error: localMessage },
            };
        }
    }
}
