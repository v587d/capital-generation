/**
 * Fuyao request kernel: zero-import leaf shared by the host-plane watchlist package and
 * `fuyao-rest.ts` (base URL, auth header, envelope codes, error text). Do not add validators,
 * capability definitions, or type dependencies here: host code would load the plugin tree.
 */
export const DEFAULT_FUYAO_BASE_URL = 'https://fuyao.aicubes.cn';
export const FUYAO_MAX_PARAM_LENGTH = 2048;
export class FuyaoError extends Error {
    kind;
    status;
    code;
    requestId;
    constructor(kind, message, details = {}) {
        super(message);
        this.name = 'FuyaoError';
        this.kind = kind;
        this.status = details.status;
        this.code = details.code;
        this.requestId = details.requestId;
    }
}
export function normalizeFuyaoBaseUrl(baseUrl) {
    return baseUrl.replace(/\/$/, '');
}
/** Send only declared params; reject bad type/length so misspelled keys are never silently dropped. */
export function fuyaoQuery(params, allowed) {
    const search = new URLSearchParams();
    for (const name of allowed) {
        const value = params[name];
        if (value === undefined)
            continue;
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
            throw new FuyaoError('invalid_parameter', `parameter ${name} must be a string, a number or a boolean`);
        }
        const encoded = String(value);
        if (encoded.length > FUYAO_MAX_PARAM_LENGTH)
            throw new FuyaoError('invalid_parameter', `parameter ${name} exceeds maximum length`);
        search.set(name, encoded);
    }
    return search;
}
/** One Fuyao call returning the envelope; non-zero code, non-2xx and 2004 become `FuyaoError`. */
export async function fuyaoRequest(input) {
    if (!input.apiKey) {
        throw new FuyaoError('credential_missing', 'FUYAO_API_KEY is not configured');
    }
    const query = input.search.toString();
    const response = await fetch(`${normalizeFuyaoBaseUrl(input.baseUrl)}${input.path}${query ? `?${query}` : ''}`, {
        headers: { 'X-api-key': input.apiKey, Accept: 'application/json' },
        signal: input.signal,
    });
    if (response.status === 429) {
        throw new FuyaoError('rate_limited', `Fuyao HTTP error 429`, { status: 429 });
    }
    if (!response.ok)
        throw new FuyaoError('http_error', `Fuyao HTTP error ${response.status}`, { status: response.status });
    const envelope = await response.json();
    // 2004 = capability is AI-client-only and closed to external access; retrying burns quota.
    if (envelope.code === 2004) {
        throw new FuyaoError('capability_closed', 'Fuyao API error 2004: 该数据能力为同花顺 AI 客户端专用，当前未开放外部接入；不要重试，改用其他能力或如实告知用户该能力不可用', { code: 2004, requestId: envelope.request_id });
    }
    // 4001 = rate limited; official guidance says do not retry immediately.
    if (envelope.code === 4001) {
        throw new FuyaoError('rate_limited', `Fuyao API error 4001: ${envelope.message ?? 'request failed'}${envelope.request_id ? ` (request_id: ${envelope.request_id})` : ''}`, { code: 4001, requestId: envelope.request_id });
    }
    // 1002 / 1003 = parameter format/domain errors; watchlist maps these to its own codes.
    if (envelope.code === 1002 || envelope.code === 1003) {
        throw new FuyaoError('invalid_parameter', `Fuyao API error ${envelope.code}: ${envelope.message ?? 'request failed'}${envelope.request_id ? ` (request_id: ${envelope.request_id})` : ''}`, { code: envelope.code, requestId: envelope.request_id });
    }
    if (envelope.code !== 0) {
        throw new FuyaoError('upstream_error', `Fuyao API error ${envelope.code ?? 'unknown'}: ${envelope.message ?? 'request failed'}${envelope.request_id ? ` (request_id: ${envelope.request_id})` : ''}`, { code: envelope.code, requestId: envelope.request_id });
    }
    return envelope;
}
/** Row array lives at `data.item`; `data` may be null. */
export function fuyaoItems(envelope) {
    const data = envelope.data;
    const rows = data?.item;
    return Array.isArray(rows) ? rows : [];
}
/** `data.timestamp` in ms; upstream returns null when there is no data (do not zero-fill). */
export function fuyaoTimestamp(envelope) {
    const data = envelope.data;
    return typeof data?.timestamp === 'number' ? data.timestamp : null;
}
