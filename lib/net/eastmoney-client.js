/**
 * Shared eastmoney network face: one process-wide throttle and one request path for both data
 * planes (Hub datasets and web_retriever text). Eastmoney limits by egress IP, so two throttles
 * equal no throttle. Throttling/status mapping live only here; SSRF checking, when needed, is
 * injected via `transport` and owned by the caller's `createHttpRequester`.
 */
import { createRequestThrottle } from './throttle.js';
/** 1 request/second, below eastmoney's >5/s trigger and within its cumulative windows. */
export const EASTMONEY_MIN_INTERVAL_MS = 1000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0';
/** Transport error; `status` is set only when upstream returned an HTTP error status. */
export class EastmoneyTransportError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'EastmoneyTransportError';
    }
}
export function createEastmoneyClient(options = {}) {
    const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    const throttle = options.throttle ?? createRequestThrottle(options.minIntervalMs ?? EASTMONEY_MIN_INTERVAL_MS);
    const transport = options.transport ?? createEastmoneyTransport();
    /** Throttle + send + status check, shared by the text and json paths. */
    const send = (url, init) => throttle(async () => {
        if (init.signal?.aborted) {
            const error = new Error('eastmoney request aborted');
            error.name = 'AbortError';
            throw error;
        }
        let response;
        try {
            response = await transport(url, {
                headers: { 'user-agent': userAgent, ...(init.headers ?? {}) },
                ...(init.signal === undefined ? {} : { signal: init.signal }),
            });
        }
        catch (error) {
            // Abort passes through unchanged so callers can tell cancellation from network failure.
            if (error instanceof Error && error.name === 'AbortError')
                throw error;
            // Errors that already carry a classification code pass through: wrapping would downgrade cancellation to a network failure.
            if (typeof error?.code === 'string')
                throw error;
            throw new EastmoneyTransportError(`eastmoney request failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        // Check status, not response.ok: some test doubles only expose status/text/json.
        if (response.status >= 400) {
            throw new EastmoneyTransportError(`eastmoney returned HTTP ${response.status}`, response.status);
        }
        return response;
    });
    return {
        async fetchText(url, init = {}) {
            const response = await send(url, init);
            return { status: response.status, headers: response.headers, text: await response.text() };
        },
        async fetchJson(url, init = {}) {
            return await (await send(url, init)).json();
        },
    };
}
function createEastmoneyTransport() {
    return (url, init) => globalThis.fetch(url, init);
}
let sharedThrottle;
/** Process-wide throttle: both clients (different transports) hit the same egress IP, so they share one. */
export function sharedEastmoneyThrottle() {
    sharedThrottle ??= createRequestThrottle(EASTMONEY_MIN_INTERVAL_MS);
    return sharedThrottle;
}
let shared;
/** Process-wide client for the data plane (bare fetch), sharing the process throttle. */
export function sharedEastmoneyClient() {
    shared ??= createEastmoneyClient({ throttle: sharedEastmoneyThrottle() });
    return shared;
}
