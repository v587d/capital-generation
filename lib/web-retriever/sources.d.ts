/**
 * Named sources: source + business params -> ordered, pageable, reproducible rows.
 * Each stays a concrete implementation (no recipe registry); all egress goes
 * through `createHttpRequester` (SSRF/DNS/redirect/size guards, AGENTS.md §9.7).
 */
import { createHttpRequester } from './local-fetch.js';
import type { EastmoneyClient, EastmoneyTransport } from '../net/eastmoney-client.js';
import type { LocalFetchOptions } from './local-fetch.js';
/** Upstream name used in error envelopes and as the `provider_tally` key. */
export type SourceId = 'cls' | 'wscn' | 'cninfo_irm' | 'cninfo' | 'sseinfo' | 'eastmoney' | 'ths' | 'sina';
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
    /** Extra envelope fields (total/page/pages/truncated) for list sources; never item data. */
    meta?: Record<string, unknown>;
}
export declare class SourceError extends Error {
    readonly source: SourceId;
    readonly code: string;
    constructor(source: SourceId, code: string, message: string);
}
/** Named sources return API payloads, not web pages: the 100k-char HTML cap cuts a 50-item
 * CLS telegraph body (measured 106,106 chars) into invalid JSON. Size for JSON, not HTML. */
export declare const SOURCE_MAX_BYTES = 1048576;
export declare const SOURCE_MAX_CHARS = 262144;
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
export declare const CNINFO_PAGE_SIZE_MAX = 30;
/**
 * Day-scoped all-market list from CNINFO (the official A-share disclosure platform).
 * Returns metadata only: the caller must not fetch/parse `document_url` in bulk.
 */
export declare function cninfoAnnouncements(transport: Requester, input: {
    date: string;
    market?: 'all' | 'sz' | 'sh' | 'bj';
    keyword?: string;
    page: number;
    pageSize: number;
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
 * Normalize a feed label to Beijing "YYYY-MM-DD HH:MM"; unknown shapes return undefined so
 * the caller fails the page instead of carrying a blank column. The site mixes absolute
 * question times with relative reply times ("昨天 18:22"): every form must parse or one row
 * fails the page. Relative forms use Beijing wall clock, never host local time.
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
export type AnnouncementMarket = 'A' | 'H' | 'U';
export interface NormalizedAnnouncementCode {
    code: string;
    market: AnnouncementMarket;
}
/**
 * Accept the forms users actually paste (`600519.SH` / `SH600519` / `0700.HK` / `AAPL.O`).
 * The market is inferred only from an unambiguous shape; a mixed list is rejected rather
 * than silently sent to one `ann_type`.
 */
export declare function normalizeAnnouncementCode(value: unknown, market?: AnnouncementMarket | 'auto'): NormalizedAnnouncementCode;
export declare function normalizeAnnouncementCodes(values: unknown, market?: AnnouncementMarket | 'auto'): {
    codes: string[];
    market: AnnouncementMarket;
};
/**
 * Eastmoney republishes issuer announcements; it is a complete issuer-scoped list by day,
 * whereas Wind's NL RAG is semantic and can miss the newest item. The list is the primary
 * path for "what was disclosed"; the authoritative PDF remains cninfo / the issuer.
 */
export declare function eastmoneyAnnouncements(client: EastmoneyClient, input: {
    codes: string[];
    market: AnnouncementMarket;
    startDate: string;
    endDate: string;
    cursor: number;
    pageSize: number;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
export interface AnnouncementBody {
    source: 'eastmoney';
    operation: 'announcement_body';
    art_code: string;
    page: number;
    offset: number;
    page_chars: number;
    total_pages: number;
    is_ai_summary: boolean;
    content: string;
    next_offset?: number;
    next_page?: number;
    done: boolean;
    pdf_url?: string;
    title?: string;
    notice_date?: string;
    note?: string;
}
/**
 * The detail API returns at most 5,000 characters per `page_index`; `page_size` is the
 * total page count, so `done` is knowable without fetching a sentinel page. US filings
 * often return an empty body while still carrying a PDF — that is a fact, not an error.
 */
export declare function eastmoneyAnnouncementBody(client: EastmoneyClient, input: {
    artCode: string;
    page: number;
    offset: number;
    limit: number;
    signal?: AbortSignal;
}): Promise<AnnouncementBody>;
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
