/**
 * Retry budget for `request_data` upstream failures: three attempts per session+capability.
 * Only rate limits, transport failures, timeouts and 5xx count; parameter/credential errors never do.
 */
export declare const MAX_UPSTREAM_ATTEMPTS = 3;
export declare const UPSTREAM_RETRY_WINDOW_MS: number;
export type UpstreamFailureKind = 'rate_limited' | 'transport' | 'timeout' | 'server';
export interface UpstreamFailure {
    kind: UpstreamFailureKind;
    message: string;
}
export interface RetryBudgetSnapshot {
    attempts: number;
    exhausted: boolean;
    failure: UpstreamFailure;
}
/**
 * Classify only failures worth another upstream call. A `fetch failed` is a transport failure, not a
 * rate limit; the two stay separate so the model can report what actually happened.
 */
export declare function classifyUpstreamFailure(error: unknown): UpstreamFailure | null;
/** Per-session+capability consecutive-failure counter; success or a five-minute gap resets it. */
export declare class UpstreamRetryBudget {
    readonly maxAttempts: number;
    private readonly windowMs;
    private readonly now;
    private readonly entries;
    constructor(options?: {
        maxAttempts?: number;
        windowMs?: number;
        now?: () => number;
    });
    inspect(key: string): RetryBudgetSnapshot | undefined;
    record(key: string, failure: UpstreamFailure): RetryBudgetSnapshot;
    reset(key: string): void;
    private liveEntry;
    private prune;
}
export declare function retryBudgetKey(sessionId: string, capability: string): string;
export declare function alternativesFor(capability: string): readonly string[];
/** Model-visible error; `terminal` is the third failure and carries the stop/report instruction. */
export declare function upstreamFailureError(input: {
    capability: string;
    failure: UpstreamFailure;
    attempts: number;
    maxAttempts?: number;
    terminal: boolean;
}): Error;
