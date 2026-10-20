export interface WindDocsConfig {
    endpoint?: string;
    credentialRef?: string;
    timeoutMs?: number;
}
export interface LocalFetchConfig {
    enabled?: boolean;
    timeoutMs?: number;
    maxBytes?: number;
    maxContentChars?: number;
    maxRedirects?: number;
    userAgent?: string;
}
/** `pollBudgetMs` must stay below the tool's declared 240000 ms timeout: the margin is for
 * persisting the pending receipt, without which a framework timeout leaves no `doc_id`. */
export interface PaddleOcrConfig {
    endpoint?: string;
    credentialRef?: string;
    model?: string;
    pollBudgetMs?: number;
}
export interface RetrieverConfig {
    baseURL?: string;
    credentialRef?: string;
    windDocs?: WindDocsConfig;
    localFetch?: LocalFetchConfig;
    paddleOcr?: PaddleOcrConfig;
}
/** Sole default source for both the schema and `resolveLocalFetchConfig()`.
 * timeoutMs 30000 matches dsh-web-fetch-http; 15s misreads slow proxy failover as TIMEOUT.
 * maxContentChars applies to raw HTML before markdown conversion, so size it for HTML.
 * userAgent is a product token: a bare version looks like a crawler to WAFs. */
export declare const LOCAL_FETCH_DEFAULTS: Required<LocalFetchConfig>;
/** Empty endpoint/model defer to `src/ocr/client.ts`; pollBudgetMs 0 defers to its DEFAULT_WAIT_BUDGET_MS. */
export declare const PADDLE_OCR_DEFAULTS: Required<PaddleOcrConfig>;
/** Consumers fill defaults themselves: `apply()` can receive a raw object that never passed the schema. */
export declare function resolveLocalFetchConfig(config?: LocalFetchConfig): Required<LocalFetchConfig>;
