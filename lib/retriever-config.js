/** web_retriever configuration surface: types, defaults, and consumer-side default filling.
 * Kept free of Cordis imports so role entries can reuse it without cycling through `index.js`. */
import { LOCAL_FETCH_CLIENT_VERSION } from './web-retriever/local-fetch.js';
/** Sole default source for both the schema and `resolveLocalFetchConfig()`.
 * timeoutMs 30000 matches dsh-web-fetch-http; 15s misreads slow proxy failover as TIMEOUT.
 * maxContentChars applies to raw HTML before markdown conversion, so size it for HTML.
 * userAgent is a product token: a bare version looks like a crawler to WAFs. */
export const LOCAL_FETCH_DEFAULTS = {
    enabled: true,
    timeoutMs: 30_000,
    maxBytes: 524_288,
    maxContentChars: 100_000,
    maxRedirects: 5,
    userAgent: '@v587d/capital-generation',
};
/** Empty endpoint/model defer to `src/ocr/client.ts`; pollBudgetMs 0 defers to its DEFAULT_WAIT_BUDGET_MS. */
export const PADDLE_OCR_DEFAULTS = {
    endpoint: '',
    credentialRef: 'PADDLE_OCR_TOKEN',
    model: '',
    pollBudgetMs: 0,
};
/** Consumers fill defaults themselves: `apply()` can receive a raw object that never passed the schema. */
export function resolveLocalFetchConfig(config) {
    const source = config ?? {};
    // UA tri-state: unset → product default; empty string → plugin version; explicit value → as-is.
    const userAgent = source.userAgent ?? LOCAL_FETCH_DEFAULTS.userAgent;
    return {
        enabled: source.enabled !== false,
        timeoutMs: source.timeoutMs ?? LOCAL_FETCH_DEFAULTS.timeoutMs,
        maxBytes: source.maxBytes ?? LOCAL_FETCH_DEFAULTS.maxBytes,
        maxContentChars: source.maxContentChars ?? LOCAL_FETCH_DEFAULTS.maxContentChars,
        maxRedirects: source.maxRedirects ?? LOCAL_FETCH_DEFAULTS.maxRedirects,
        userAgent: userAgent || LOCAL_FETCH_CLIENT_VERSION,
    };
}
