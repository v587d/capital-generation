/**
 * Retry budget for `request_data` upstream failures: three attempts per session+capability.
 * Only rate limits, transport failures, timeouts and 5xx count; parameter/credential errors never do.
 */
export const MAX_UPSTREAM_ATTEMPTS = 3;
export const UPSTREAM_RETRY_WINDOW_MS = 5 * 60_000;
const RATE_LIMIT_CODES = new Set(['rate_limited', 'eastmoney_rate_limit', 'tencent_rate_limit']);
const PERMANENT_CODES = new Set([
    'credential_missing', 'capability_closed', 'plan_closed', 'invalid_parameter',
    'request_params_invalid', 'workspace_not_writable', 'upstream_retry_exhausted',
    'tencent_invalid_param', 'tencent_empty_response', 'tencent_invalid_response',
    'eastmoney_invalid_response', 'eastmoney_upstream_error',
]);
const TRANSIENT_CODES = new Set(['tencent_kline_unavailable']);
const PERMANENT_CODE_PREFIXES = [
    'credential_', 'capability_', 'plan_', 'invalid_', 'request_params_',
    'workspace_', 'dataset_', 'upstream_retry_',
];
const PERMANENT_PATTERN = /workspace_not_writable|credential_missing|capability_closed|plan_closed|request_params_invalid|invalid_parameter|unsupported parameter|\bparameter\b[^.]*\bmust\b|API error (?:1002|1003|2004)|HTTP (?:400|401|402|403|404|405|409|410|422)\b/i;
const RATE_LIMIT_PATTERN = /\b429\b|\b4001\b|rate.?limit|too many requests/i;
const TIMEOUT_PATTERN = /request timed out|timed out|timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i;
const TRANSPORT_PATTERN = /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|network error|connection reset|connection refused|TLS|certificate/i;
const SERVER_PATTERN = /HTTP (?:error )?5\d\d|bad gateway|service unavailable|gateway timeout|server error/i;
/** Capability-level substitutes that are actually equivalent enough to hint at; schema still needs a check. */
const UPSTREAM_ALTERNATIVES = Object.freeze({
    index_quote: ['tencent_quote'],
    quote: ['ftshare_ashare_quote', 'tencent_quote'],
    ftshare_ashare_quote: ['quote', 'tencent_quote'],
    history: ['tencent_kline'],
    index_history: ['tencent_kline'],
    tencent_quote: ['quote', 'ftshare_ashare_quote'],
    tencent_kline: ['history', 'index_history'],
});
function codeOf(error) {
    if (!error || typeof error !== 'object')
        return undefined;
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
}
function statusOf(error) {
    if (!error || typeof error !== 'object')
        return undefined;
    const status = error.status;
    return typeof status === 'number' ? status : undefined;
}
function kindOf(error) {
    if (!error || typeof error !== 'object')
        return undefined;
    const kind = error.kind;
    return typeof kind === 'string' ? kind : undefined;
}
function nameOf(error) {
    if (!error || typeof error !== 'object')
        return undefined;
    const name = error.name;
    return typeof name === 'string' ? name : undefined;
}
function permanentCode(code) {
    if (!code)
        return false;
    if (PERMANENT_CODES.has(code))
        return true;
    return PERMANENT_CODE_PREFIXES.some((prefix) => code.startsWith(prefix));
}
/**
 * Classify only failures worth another upstream call. A `fetch failed` is a transport failure, not a
 * rate limit; the two stay separate so the model can report what actually happened.
 */
export function classifyUpstreamFailure(error) {
    if (error === undefined || error === null)
        return null;
    const message = error instanceof Error ? error.message : String(error);
    const code = codeOf(error);
    const status = statusOf(error);
    const kind = kindOf(error);
    if (nameOf(error) === 'AbortError' || code === 'ABORTED' || /\brequest aborted\b/i.test(message))
        return null;
    if (permanentCode(code))
        return null;
    if (kind === 'credential_missing' || kind === 'capability_closed' || kind === 'plan_closed' || kind === 'invalid_parameter')
        return null;
    if (kind === 'rate_limited')
        return { kind: 'rate_limited', message };
    if (code && RATE_LIMIT_CODES.has(code))
        return { kind: 'rate_limited', message };
    if (status === 429)
        return { kind: 'rate_limited', message };
    // Eastmoney IP bans surface as 403; other 403s are plan/permission errors and must not be retried.
    if (status === 403)
        return /eastmoney/i.test(message) ? { kind: 'rate_limited', message } : null;
    if (status === 408)
        return { kind: 'timeout', message };
    if (status !== undefined && status >= 500 && status <= 599)
        return { kind: 'server', message };
    if (code && TRANSIENT_CODES.has(code))
        return { kind: 'transport', message };
    if (/eastmoney HTTP 403/i.test(message))
        return { kind: 'rate_limited', message };
    if (PERMANENT_PATTERN.test(message))
        return null;
    if (RATE_LIMIT_PATTERN.test(message))
        return { kind: 'rate_limited', message };
    if (TIMEOUT_PATTERN.test(message))
        return { kind: 'timeout', message };
    if (TRANSPORT_PATTERN.test(message))
        return { kind: 'transport', message };
    if (SERVER_PATTERN.test(message))
        return { kind: 'server', message };
    return null;
}
/** Per-session+capability consecutive-failure counter; success or a five-minute gap resets it. */
export class UpstreamRetryBudget {
    maxAttempts;
    windowMs;
    now;
    entries = new Map();
    constructor(options = {}) {
        this.maxAttempts = options.maxAttempts ?? MAX_UPSTREAM_ATTEMPTS;
        this.windowMs = options.windowMs ?? UPSTREAM_RETRY_WINDOW_MS;
        this.now = options.now ?? (() => Date.now());
        if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1)
            throw new Error('maxAttempts must be a positive safe integer');
        if (!Number.isFinite(this.windowMs) || this.windowMs <= 0)
            throw new Error('windowMs must be positive');
    }
    inspect(key) {
        const entry = this.liveEntry(key);
        if (!entry)
            return undefined;
        return { attempts: entry.attempts, exhausted: entry.attempts >= this.maxAttempts, failure: entry.failure };
    }
    record(key, failure) {
        const existing = this.liveEntry(key);
        const attempts = existing ? existing.attempts + 1 : 1;
        this.entries.set(key, { attempts, at: this.now(), failure });
        this.prune();
        return { attempts, exhausted: attempts >= this.maxAttempts, failure };
    }
    reset(key) {
        this.entries.delete(key);
    }
    liveEntry(key) {
        const entry = this.entries.get(key);
        if (!entry)
            return undefined;
        if (this.now() - entry.at > this.windowMs) {
            this.entries.delete(key);
            return undefined;
        }
        return entry;
    }
    prune() {
        const now = this.now();
        for (const [key, entry] of this.entries) {
            if (now - entry.at > this.windowMs)
                this.entries.delete(key);
        }
        if (this.entries.size <= 1000)
            return;
        const oldest = [...this.entries.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, this.entries.size - 1000);
        for (const [key] of oldest)
            this.entries.delete(key);
    }
}
export function retryBudgetKey(sessionId, capability) {
    return `${sessionId}\u0000${capability}`;
}
export function alternativesFor(capability) {
    return UPSTREAM_ALTERNATIVES[capability] ?? [];
}
/** Model-visible error; `terminal` is the third failure and carries the stop/report instruction. */
export function upstreamFailureError(input) {
    const maxAttempts = input.maxAttempts ?? MAX_UPSTREAM_ATTEMPTS;
    const alternatives = alternativesFor(input.capability);
    const alternativeText = alternatives.length > 0
        ? `可改用 ${alternatives.join(' / ')}（先用 describe_capability 核对字段、单位与代码范围；切换后在 source_label 注明）。`
        : '没有已核对的等价上游。';
    const state = input.terminal
        ? `已连续 ${input.attempts} 次可重试失败`
        : `第 ${input.attempts}/${maxAttempts} 次可重试失败`;
    const next = input.terminal
        ? `已停止重试：不要再次调用 ${input.capability}，也不要用 wait_agent 等上游恢复。${alternativeText}立即发 data_failed + data_collection_completed，如实回告 lead。`
        : `不要用 wait_agent 等；${alternativeText}若无法切换再重试，最多 ${maxAttempts} 次。`;
    const prefix = input.terminal ? 'upstream_retry_exhausted' : 'upstream_retryable_failure';
    const error = new Error(`${prefix}: ${input.capability} ${state}（${input.failure.kind}: ${input.failure.message}）。${next}`);
    const tagged = error;
    tagged.code = input.terminal ? 'upstream_retry_exhausted' : 'upstream_retryable_failure';
    tagged.attempts = input.attempts;
    tagged.capability = input.capability;
    tagged.alternatives = alternatives;
    return error;
}
