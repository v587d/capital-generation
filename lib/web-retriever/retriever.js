import { AnySearchError, normalizeFetchResponse, normalizeSearchResponse, shouldFallbackToLocalFetch, } from './engines.js';
import { LocalFetchError } from './local-fetch.js';
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Caller cancellation must rethrow, never become a failure envelope. */
function abortError(signal) {
    return signal.reason ?? new Error('request aborted');
}
/** Stateless AnySearch adapter: no cache, queue, turn or corpus index. */
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
            // "Fetched but empty" is equivalent to failure and is fallback-eligible.
            trigger = {
                from: 'anysearch',
                code: 'UPSTREAM',
                error: normalized.error ?? 'fetch returned no content',
            };
        }
        catch (error) {
            // Caller cancel: rethrow, no fallback.
            if (error instanceof AnySearchError && error.code === 'ABORTED')
                throw error;
            const code = error instanceof AnySearchError ? error.code : 'UPSTREAM';
            const message = errorText(error);
            // Invalid URL / unsupported content: local would reject too, fallback is wasted.
            if (!shouldFallbackToLocalFetch(code)) {
                return { url, ok: false, via: 'anysearch', code, error: message };
            }
            trigger = { from: 'anysearch', code, error: message };
        }
        // Hard cancel gate before fallback: never spend another request on an abandoned result.
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
            // Cancel raised on the local side also rethrows as-is.
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
