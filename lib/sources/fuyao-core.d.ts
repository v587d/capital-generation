/**
 * Fuyao request kernel: zero-import leaf shared by the host-plane watchlist package and
 * `fuyao-rest.ts` (base URL, auth header, envelope codes, error text). Do not add validators,
 * capability definitions, or type dependencies here: host code would load the plugin tree.
 */
export declare const DEFAULT_FUYAO_BASE_URL = "https://fuyao.aicubes.cn";
export declare const FUYAO_MAX_PARAM_LENGTH = 2048;
export type FuyaoApiEnvelope = {
    code?: number;
    message?: string;
    request_id?: string;
    data?: unknown;
};
export type FuyaoParams = Record<string, unknown>;
/** Failure kinds: HTTP 429 and code=4001 are rate limits; `closed` is capability-level (retry is futile). */
export type FuyaoFailureKind = 'credential_missing' | 'rate_limited' | 'capability_closed' | 'invalid_parameter' | 'http_error' | 'upstream_error';
export declare class FuyaoError extends Error {
    readonly kind: FuyaoFailureKind;
    readonly status?: number;
    readonly code?: number;
    readonly requestId?: string;
    constructor(kind: FuyaoFailureKind, message: string, details?: {
        status?: number;
        code?: number;
        requestId?: string;
    });
}
export declare function normalizeFuyaoBaseUrl(baseUrl: string): string;
/** Send only declared params; reject bad type/length so misspelled keys are never silently dropped. */
export declare function fuyaoQuery(params: FuyaoParams, allowed: string[]): URLSearchParams;
/** One Fuyao call returning the envelope; non-zero code, non-2xx and 2004 become `FuyaoError`. */
export declare function fuyaoRequest(input: {
    baseUrl: string;
    apiKey: string | undefined;
    path: string;
    search: URLSearchParams;
    signal: AbortSignal;
}): Promise<FuyaoApiEnvelope>;
/** Row array lives at `data.item`; `data` may be null. */
export declare function fuyaoItems(envelope: FuyaoApiEnvelope): FuyaoParams[];
/** `data.timestamp` in ms; upstream returns null when there is no data (do not zero-fill). */
export declare function fuyaoTimestamp(envelope: FuyaoApiEnvelope): number | null;
