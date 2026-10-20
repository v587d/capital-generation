/**
 * FTShare (非凸科技 `market.ft.tech/gateway`): capital flows, quote/K-line, calendars, block trades,
 * SW industry, futures/metals; the only source for A-share flow history, BJ quotes and futures.
 * ⛔ Only numbers verifiable in a logged raw response; free tier 10 QPS/burst 20 (we cap ~8 QPS).
 * ⛔ Credentials resolve per call; 403 route_not_allowed = plan_closed, never retry (cf. Fuyao 2004).
 */
import type { Context } from '@deepseek-ai/cordis';
import type { DataSource } from '../data-collector/hub.js';
type JsonRecord = Record<string, unknown>;
export declare const FTSHARE_MIN_INTERVAL_MS = 120;
type FtshareFailureKind = 'credential_missing' | 'rate_limited' | 'plan_closed' | 'invalid_parameter' | 'http_error' | 'upstream_error' | 'invalid_response';
export declare class FtshareError extends Error {
    readonly kind: FtshareFailureKind;
    readonly status?: number;
    readonly code?: number;
    constructor(kind: FtshareFailureKind, message: string, details?: {
        status?: number;
        code?: number;
    });
}
export interface FtshareRequester {
    getJson(path: string, search: URLSearchParams, signal: AbortSignal): Promise<JsonRecord>;
}
/** Key resolved per call; constructing the client touches no credentials. */
export declare function createFtshareClient(resolveApiKey: () => Promise<string | undefined>, baseUrl?: string): FtshareRequester;
/** Credentials first, env fallback; never gate registration on key availability or cache a rejection. */
export declare function resolveFtshareApiKey(ctx: Context, credentialRef?: string): Promise<string | undefined>;
export declare function createFtshareSources(resolveApiKey: () => Promise<string | undefined>): DataSource[];
export {};
