/**
 * Wind 金融文档检索客户端（JSON-RPC over HTTP，零依赖）。
 *
 * 线格式为 JSON-RPC 2.0（即 MCP 线协议）：initialize → tools/call，无会话态、
 * 无 SDK、无框架依赖——与 fuyao-rest / anysearch engines 同构的普通 HTTP 客户端。
 * 协议蓝本（Wind 官方 CLI）：github.com/Wind-Alice/AliceMarket 的
 * skills/wind-mcp-skill/scripts/cli.mjs（本地参考副本在 docs/reference/，不入库）。
 */
export const DEFAULT_WIND_ENDPOINT = 'https://mcp.wind.com.cn/vserver_financial_docs/mcp/';
export const WIND_REQUEST_TIMEOUT_MS = 60_000;
export const WIND_MAX_CONTENT_CHARS = 20_000;
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
class WindTransportError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
/** HTTP 状态 → 错误分类（蓝本 HTTP_ERROR_MAP；其余状态一律 NETWORK）。 */
const HTTP_ERROR_CODES = {
    401: 'AUTH',
    429: 'RATE_LIMIT',
    500: 'NETWORK',
    502: 'NETWORK',
    503: 'NETWORK',
    504: 'NETWORK',
};
const RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAYS_MS = [300, 1_000];
function normalizeEndpoint(endpoint) {
    const raw = (endpoint ?? DEFAULT_WIND_ENDPOINT).trim();
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            throw new Error('endpoint must use http or https');
        }
    }
    catch (error) {
        throw new Error(`invalid Wind endpoint: ${errorText(error)}`);
    }
    return raw;
}
/** 响应可能是纯 JSON 或 SSE（取最后一个 data: 行）；蓝本 parseSSE 的等价实现。 */
function parseResponsePayload(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
        try {
            return JSON.parse(trimmed);
        }
        catch {
            // 非 JSON 对象落到下面的 SSE 解析。
        }
    }
    let last;
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('data: '))
            last = line.slice('data: '.length);
    }
    if (last !== undefined) {
        try {
            return JSON.parse(last);
        }
        catch (error) {
            throw new Error(`SSE data 行 JSON 解析失败：${errorText(error)}；原文前 200 字符：${text.slice(0, 200)}`);
        }
    }
    throw new Error(`响应格式无法识别（既非 JSON 也非 SSE）；原文前 200 字符：${text.slice(0, 200)}`);
}
/** 深度裁剪：对象/数组内的字符串字段超过上限时截断（保持结构；超长响应另有 harness 剪枝兜底）。 */
function trimDeep(value, maxChars) {
    if (typeof value === 'string')
        return value.length > maxChars ? value.slice(0, maxChars) : value;
    if (Array.isArray(value))
        return value.map((item) => trimDeep(item, maxChars));
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            out[key] = trimDeep(item, maxChars);
        }
        return out;
    }
    return value;
}
function firstContentText(result) {
    const content = result.content;
    if (!Array.isArray(content) || content.length === 0)
        return undefined;
    const first = content[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
        const record = first;
        if (record.type === 'text' && typeof record.text === 'string')
            return record.text;
    }
    return undefined;
}
/** JSON-RPC error 字段 → 可读文本。 */
function rpcErrorText(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        return undefined;
    const record = payload;
    if (record.error === undefined || record.error === null)
        return undefined;
    const error = record.error;
    if (typeof error === 'string' && error)
        return error;
    if (error && typeof error === 'object' && !Array.isArray(error)) {
        const message = error.message;
        if (typeof message === 'string' && message)
            return message;
    }
    return JSON.stringify(error).slice(0, 2_000);
}
/**
 * 三层业务错误解包（蓝本 mcpRequest 后半段）：Wind 把业务错误包在 content[0].text
 * 的 JSON 字符串里，必须二次解析——mcp_tool_error_code / error{} / data.code 三种形态。
 */
function innerBusinessError(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return undefined;
    const record = data;
    const toolErrorCode = record.mcp_tool_error_code;
    if (typeof toolErrorCode === 'number' && toolErrorCode !== 0) {
        return typeof record.mcp_tool_error_msg === 'string' && record.mcp_tool_error_msg
            ? record.mcp_tool_error_msg
            : JSON.stringify(record).slice(0, 2_000);
    }
    if (record.error && typeof record.error === 'object' && !Array.isArray(record.error)) {
        const nested = record.error;
        if (nested.code !== undefined || nested.message !== undefined) {
            return (typeof nested.message === 'string' && nested.message) || JSON.stringify(nested).slice(0, 2_000);
        }
    }
    if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
        const nested = record.data;
        const numeric = typeof nested.code === 'number'
            ? nested.code
            : typeof nested.code === 'string' && /^\d+$/.test(nested.code.trim())
                ? Number(nested.code.trim())
                : null;
        const success = numeric === null || numeric === 0 || (numeric >= 200 && numeric < 300);
        if (!success) {
            return (typeof nested.message === 'string' && nested.message) || JSON.stringify(nested).slice(0, 2_000);
        }
    }
    return undefined;
}
/** JSON-RPC result → WindCallResult：含 isError 与内层业务错误解包。 */
function interpretResult(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, code: 'INVALID', error: 'Wind 返回不可解析（非 JSON-RPC 对象）' };
    }
    const rpcError = rpcErrorText(payload);
    if (rpcError)
        return { ok: false, code: 'BACKEND', error: rpcError };
    const result = payload.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return { ok: false, code: 'INVALID', error: 'Wind 返回缺少 result' };
    }
    const resultRecord = result;
    if (resultRecord.isError === true) {
        const text = firstContentText(resultRecord);
        return { ok: false, code: 'BACKEND', error: text ?? JSON.stringify(resultRecord).slice(0, 2_000) };
    }
    const innerText = firstContentText(resultRecord);
    if (innerText === undefined) {
        return { ok: false, code: 'INVALID', error: 'Wind 返回缺少 content[0].text 文本' };
    }
    let parsed;
    try {
        parsed = JSON.parse(innerText);
    }
    catch {
        parsed = undefined;
    }
    if (parsed === undefined) {
        const content = innerText.slice(0, WIND_MAX_CONTENT_CHARS);
        return { ok: true, content, content_chars: content.length };
    }
    const businessError = innerBusinessError(parsed);
    if (businessError)
        return { ok: false, code: 'BACKEND', error: businessError };
    return { ok: true, data: trimDeep(parsed, WIND_MAX_CONTENT_CHARS) };
}
/** 创建 Wind 文档检索客户端；端点在构造时校验（配置错误立即暴露，与 anysearch 同策略）。 */
export function createWindClient(options) {
    const endpoint = normalizeEndpoint(options.endpoint);
    const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : WIND_REQUEST_TIMEOUT_MS;
    const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    let nextId = 1;
    async function postOnce(method, params, apiKey, signal) {
        if (signal?.aborted)
            throw new WindTransportError('NETWORK', 'Wind 请求已取消');
        const controller = new AbortController();
        const onExternalAbort = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', onExternalAbort, { once: true });
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort(new Error('Wind request timed out'));
        }, timeoutMs);
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                redirect: 'error',
                headers: {
                    accept: 'application/json, text/event-stream',
                    'content-type': 'application/json',
                    authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
                signal: controller.signal,
            });
            if (!response.ok) {
                await response.text().catch(() => '');
                throw new WindTransportError(HTTP_ERROR_CODES[response.status] ?? 'NETWORK', `Wind HTTP ${response.status}`);
            }
            return parseResponsePayload(await response.text());
        }
        catch (error) {
            if (timedOut)
                throw new WindTransportError('NETWORK', `Wind 请求超时（${timeoutMs}ms）`);
            throw error;
        }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onExternalAbort);
        }
    }
    /** 网络级错误按退避重试；HTTP 状态错误与调用方取消不重试（蓝本同款行为）。 */
    async function postRpc(method, params, apiKey, signal) {
        let lastError;
        for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
            try {
                return await postOnce(method, params, apiKey, signal);
            }
            catch (error) {
                if (error instanceof WindTransportError)
                    throw error;
                if (signal?.aborted)
                    throw error;
                lastError = error;
                if (attempt < RETRY_ATTEMPTS) {
                    const delayMs = retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)];
                    if (delayMs > 0)
                        await new Promise((resolve) => setTimeout(resolve, delayMs));
                }
            }
        }
        throw new WindTransportError('NETWORK', `Wind 请求失败（已重试 ${RETRY_ATTEMPTS - 1} 次）：${errorText(lastError)}`);
    }
    return {
        async callTool(toolName, args, signal) {
            try {
                const apiKey = await options.resolveApiKey();
                if (!apiKey) {
                    return { ok: false, code: 'AUTH', error: 'Wind API Key 未配置（credentials 与环境变量均未提供）' };
                }
                const initialized = await postRpc('initialize', {
                    protocolVersion: '2025-03-26',
                    capabilities: {},
                    clientInfo: { name: 'capital-generation', version: '0.1.0' },
                }, apiKey, signal);
                const initError = rpcErrorText(initialized);
                if (initError)
                    return { ok: false, code: 'BACKEND', error: initError };
                const payload = await postRpc('tools/call', {
                    name: toolName,
                    arguments: args,
                    _meta: { clientVersion: '0.1.0' },
                }, apiKey, signal);
                return interpretResult(payload);
            }
            catch (error) {
                if (error instanceof WindTransportError) {
                    return { ok: false, code: error.code, error: error.message };
                }
                return { ok: false, code: 'INVALID', error: `Wind 调用失败：${errorText(error)}` };
            }
        },
    };
}
