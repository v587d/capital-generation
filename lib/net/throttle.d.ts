/**
 * Serialize requests to one upstream into a chain with a minimum gap. Concurrent callers must not
 * each sleep and then fire together; chaining guarantees the gap after the previous start.
 */
export declare function createRequestThrottle(minIntervalMs: number): <T>(task: () => Promise<T>) => Promise<T>;
