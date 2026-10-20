/**
 * Named sources: source + business params -> ordered, pageable, reproducible rows.
 * Each stays a concrete implementation (no recipe registry); all egress goes
 * through `createHttpRequester` (SSRF/DNS/redirect/size guards, AGENTS.md §9.7).
 */
import { createHttpRequester } from './local-fetch.js';
import type { EastmoneyClient, EastmoneyTransport } from '../net/eastmoney-client.js';
import type { LocalFetchOptions } from './local-fetch.js';
/** Upstream name used in error envelopes and as the `provider_tally` key. */
export type SourceId = 'cls' | 'wscn' | 'cninfo_irm' | 'sseinfo' | 'eastmoney' | 'ths' | 'sina';
export declare const SOURCE_IDS: readonly SourceId[];
/** Per-item text cap; item count is capped separately by each tool's limit. */
export declare const MAX_ITEM_CHARS = 1200;
/** Max items per output (must match the tool schema maximum). */
export declare const MAX_ITEMS = 50;
export interface SourceItem {
    [key: string]: string | number | null;
}
export interface SourceOutcome {
    source: SourceId;
    operation: string;
    items: SourceItem[];
    /** Upstream cursor for the next page; absent when there is none. */
    next_cursor?: string;
    /** Record upstream scope / known gaps so an empty result is not read as fact. */
    note?: string;
}
export declare class SourceError extends Error {
    readonly source: SourceId;
    readonly code: string;
    constructor(source: SourceId, code: string, message: string);
}
type Requester = ReturnType<typeof createHttpRequester>;
/** Built per source-tool call; lazy transport, configured timeout. */
export declare function createSourceTransport(options: LocalFetchOptions): Requester;
/**
 * Eastmoney shares the other sources' egress gate; throttling stays process-wide.
 * Coded `LocalFetchError`s pass through unwrapped so ABORTED is not downgraded.
 */
export declare function createGatedEastmoneyTransport(requester: Requester): EastmoneyTransport;
/** Local sign `md5(sha1(query sorted by key))`; no API key, so the model passes params, never URLs. */
export declare function clsSign(params: Record<string, string>): string;
export declare function clsTelegraph(transport: Requester, input: {
    limit: number;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
export declare function wscnLives(transport: Requester, input: {
    channel: string;
    limit: number;
    cursor?: string;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
/**
 * Two steps: `keyWord=code` -> `secid` (orgId) -> questions; step two must be POST
 * (GET on the same URL returns 405). Shenzhen only; SSE questions via `sseinfo_qa`.
 */
export declare function cninfoIrm(transport: Requester, input: {
    code: string;
    pageSize: number;
    pageNum: number;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
/**
 * Company list page: 32 companies, ascending by code. uid and code come from the same
 * `<a>` element, so cross-item mispairing is structurally impossible (a windowed regex
 * either misses rows or pairs across them).
 */
export declare function parseCompanyList(content: string): Array<{
    code: string;
    uid: string;
}>;
export declare function resetSseCachesForTest(): void;
/**
 * One uid lookup = 10-13 serial requests, so no per-request timeout can bound it;
 * `uidLocateBudgetMs` exists only so tests can shorten this.
 */
export declare const SSE_UID_LOCATE_TIMEOUT_MS = 60000;
/**
 * Cache layering: pages feed the binary search, the uid cache holds only the resolved
 * code — caching scanned pages there would evict it and turn success into NOT_FOUND.
 */
export declare function resolveSseCompanyUid(transport: Requester, code: string, signal?: AbortSignal): Promise<string>;
/** Split Q/A on the reply block class; per-item id markers differ between the two list kinds. */
export declare function parseSseFeed(text: string): SourceItem[];
/**
 * Normalize to Beijing "YYYY-MM-DD HH:MM" (never host local time). All three observed
 * forms (X分钟前 / 昨天 HH:MM / absolute) must parse or one row fails the page.
 */
export declare function sseTime(text: string, now?: Date): string | undefined;
export declare function sseinfoQa(transport: Requester, input: {
    code?: string;
    kind: string;
    page: number;
    pageSize: number;
    signal?: AbortSignal;
    uidLocateBudgetMs?: number;
}): Promise<SourceOutcome>;
/**
 * Independent CLS/WSCN backup; success `code` is the string "1". The server aggregates
 * CLS content, so title dedupe is the caller's job.
 */
export declare function eastmoneyFastNews(client: EastmoneyClient, input: {
    limit: number;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
/**
 * A missing `cmsArticleWebOld` key is intermittent upstream throttling, not "no news"
 * (which is a present-but-empty array); report UPSTREAM on the missing key.
 */
export declare function eastmoneyStockNews(client: EastmoneyClient, input: {
    code: string;
    limit: number;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
/**
 * No abstract in the list; the per-item PDF link is the only path to the text (via `ocr`).
 * Only bare 6-digit codes work (a prefixed code returns hits=0); EPS fields are strings.
 */
export declare function eastmoneyReports(client: EastmoneyClient, input: {
    code: string;
    pageSize: number;
    pageNo: number;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
/**
 * Always add the exchange prefix: bare codes get a fake empty page for STAR/ChiNext.
 * That page is HTTP 200 and looks like "no reports", so also verify the numbered row count.
 */
export declare function sinaReports(transport: Requester, input: {
    code?: string;
    page: number;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
/**
 * Always prefix the exchange; order matters: BJ segments (43/83/87/920) start with 9/4
 * and must be tested before `9 => sh`; only 900xxx is Shanghai B.
 */
export declare function sinaSymbol(code: string): string;
/**
 * The page declares text/html without charset but is GBK, so decode explicitly
 * (`encoding` is source-only, never a model input). Of its 32 tables, pick the one
 * with 每股收益/均值 headers; the mean is the consensus EPS.
 */
export declare function thsEpsForecast(transport: Requester, input: {
    code: string;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
export {};
