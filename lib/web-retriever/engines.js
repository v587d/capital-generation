/**
 * AnySearch 的最小 REST 客户端。
 *
 * web_retriever 目前只支持一个后端，因此不预留多引擎注册表、动态 loader 或
 * provider 目录。未来真正接入第二个后端时，再根据实际差异抽象接口。
 */
export const DEFAULT_BASE_URL = 'https://api.anysearch.com';
export const REQUEST_TIMEOUT_MS = 60_000;
export const MAX_CONTENT_CHARS = 20_000;
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
function responseData(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const record = raw;
    if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
        return record.data;
    }
    return record;
}
export function normalizeSearchHit(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const record = raw;
    if (typeof record.url !== 'string' || record.url.length === 0)
        return null;
    return {
        url: record.url,
        ...(typeof record.title === 'string' && record.title ? { title: record.title } : {}),
        ...(typeof record.snippet === 'string' && record.snippet ? { snippet: record.snippet } : {}),
        ...(typeof record.content === 'string' && record.content
            ? { content: record.content.slice(0, MAX_CONTENT_CHARS) }
            : {}),
    };
}
export function normalizeSearchResponse(query, raw) {
    const data = responseData(raw);
    if (!data || !Array.isArray(data.results)) {
        return { query, ok: false, sources: [], error: 'AnySearch returned an invalid search response' };
    }
    return {
        query,
        ok: true,
        sources: data.results
            .map(normalizeSearchHit)
            .filter((hit) => hit !== null),
    };
}
export function normalizeFetchResponse(url, raw) {
    const data = responseData(raw);
    if (!data)
        return { url, ok: false, error: 'AnySearch returned an invalid fetch response' };
    const title = typeof data.title === 'string' && data.title ? data.title : undefined;
    const content = typeof data.content === 'string' && data.content
        ? data.content.slice(0, MAX_CONTENT_CHARS)
        : undefined;
    if (!title && !content)
        return { url, ok: false, error: 'fetch returned no content' };
    return { url, ok: true, ...(title ? { title } : {}), ...(content ? { content } : {}) };
}
export function envKey(name) {
    const processLike = globalThis.process;
    return processLike?.env?.[name] || undefined;
}
/** 创建 AnySearch REST 客户端；API key 每次请求重新解析，不缓存。 */
export function createAnySearchClient(baseURL = DEFAULT_BASE_URL, resolveApiKey = async () => envKey('ANYSEARCH_API_KEY')) {
    const root = baseURL.replace(/\/+$/, '');
    try {
        const url = new URL(`${root}/v1/search`);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('baseURL must use http or https');
        }
    }
    catch (error) {
        throw new Error(`invalid AnySearch baseURL: ${errorText(error)}`);
    }
    async function request(path, body, signal) {
        if (signal?.aborted)
            throw new Error('AnySearch request aborted');
        const timeout = new AbortController();
        const onAbort = () => timeout.abort(signal?.reason);
        signal?.addEventListener('abort', onAbort, { once: true });
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            timeout.abort(new Error('AnySearch request timed out'));
        }, REQUEST_TIMEOUT_MS);
        try {
            const apiKey = await resolveApiKey();
            const headers = {
                accept: 'application/json',
                'content-type': 'application/json',
                'user-agent': 'dsh/0.1.4',
                'x-anysearch-client': 'dsh/0.1.4',
            };
            if (apiKey)
                headers.authorization = `Bearer ${apiKey}`;
            let response;
            try {
                response = await fetch(`${root}${path}`, {
                    method: 'POST',
                    redirect: 'error',
                    headers,
                    body: JSON.stringify(body),
                    signal: timeout.signal,
                });
            }
            catch (error) {
                if (timedOut)
                    throw new Error('AnySearch request timed out');
                throw error;
            }
            const text = await response.text();
            let parsed;
            try {
                const value = JSON.parse(text);
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    parsed = value;
                }
            }
            catch {
                // 非 JSON 响应转成下面的明确错误。
            }
            const code = parsed?.code;
            const message = typeof parsed?.message === 'string' && parsed.message ? parsed.message : undefined;
            const errorCode = typeof parsed?.error_code === 'string' ? parsed.error_code : undefined;
            if (!response.ok || (code !== undefined && code !== 0)) {
                const detail = errorCode
                    ? `${message ?? 'request failed'} (${errorCode})`
                    : (message ?? `HTTP ${response.status}`);
                throw new Error(`AnySearch ${path} error: ${detail}`);
            }
            if (!parsed)
                throw new Error(`AnySearch ${path} error: invalid JSON response`);
            return parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
        }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        }
    }
    return {
        search: (requestArgs, signal) => request('/v1/search', requestArgs, signal),
        extract: (requestArgs, signal) => request('/v1/extract', requestArgs, signal),
    };
}
