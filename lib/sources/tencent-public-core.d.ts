export declare const QUOTE_URL = "https://qt.gtimg.cn/q=";
export declare const SMARTBOX_URL = "https://smartbox.gtimg.cn/s3/";
export declare const TENCENT_MIN_INTERVAL_MS = 120;
export declare const tencentThrottle: <T>(task: () => Promise<T>) => Promise<T>;
/**
 * ifzq JSON hosts (K-line + intraday trend). One rotation and one cooldown table for both
 * callers: a host that failed for K-lines must not be retried by the trend path 200ms later.
 */
export declare const TENCENT_IFZQ_HOSTS: string[];
export declare const TENCENT_HOST_COOLDOWN_MS = 120000;
/** Shared by every ifzq caller; keyed by host URL. */
export declare const tencentHostDownUntil: Map<string, number>;
export type JsonRecord = Record<string, unknown>;
export declare function isRecord(value: unknown): value is JsonRecord;
export declare function numberOrNull(value: unknown): number | null;
export declare function requiredNumber(value: unknown, field: string): number;
export declare function sourceError(message: string, code?: string): Error;
/** Cancellation does not queue; see `docs/dev/web-retriever.md` §4.2. */
export declare function tencentGetText(url: string, signal: AbortSignal, encoding?: 'utf-8' | 'gbk', init?: RequestInit): Promise<string>;
/** Separate HK/US and A-share field tables: currency 75/35; turnover 59 (total shares) vs 38 (float). */
export declare const HK_QUOTE_FIELDS = 78;
export declare const US_QUOTE_FIELDS = 73;
/** Exchange-local time; separator drifts per row (`/` vs `-`), normalize to hyphen. */
export declare function offshoreQuoteTime(value: unknown): string | null;
/** A-share snapshots give a compact `YYYYMMDDHHMMSS` (Beijing time), not the HK/US spaced form. */
export declare function aShareQuoteTime(value: unknown): string | null;
export declare function snapshotRows(text: string, requested: Set<string>): Array<{
    symbol: string;
    fields: string[];
}>;
/** HK codes are 5 digits; `hk700`/`hk0700` are silently dropped upstream, so left-pad. */
export declare function normalizeHkCode(value: unknown, name: string): string;
/** Snapshot matches only bare US tickers (`usBABA.N` → no row); K-line needs the suffix (`usAAPL` → stale 2011 data). */
export declare function normalizeUsCode(value: unknown, name: string): string;
export declare function usSymbolVariants(ticker: string): string[];
export declare function parseHkQuoteRows(text: string, requested: Set<string>): JsonRecord[];
export declare function parseUsQuoteRows(text: string, requested: Set<string>): Array<{
    symbol: string;
    row: JsonRecord;
}>;
/** Indices: points only; magnitude columns unreadable. No currency. US code has a leading dot, HK is letters. */
export declare function parseOffshoreIndexRows(text: string, requested: Set<string>, market: 'hk' | 'us'): JsonRecord[];
export declare function normalizeOffshoreIndexCode(value: unknown, name: string, market: 'hk' | 'us'): string;
/** HK one batch; US retries only no-row tickers with stripped suffixes. */
export declare function fetchOffshoreQuotes(market: 'hk' | 'us', codes: string[], signal: AbortSignal): Promise<JsonRecord[]>;
export declare function fetchOffshoreIndexQuotes(market: 'hk' | 'us', codes: string[], signal: AbortSignal): Promise<JsonRecord[]>;
export declare function resolveUsKlineSymbol(ticker: string, signal: AbortSignal): Promise<string>;
/** smartbox `v_hint="market~code~name~pinyin~type^…"` (~10); no hit or invalid `t` both return `N`. */
export interface SmartboxCandidate {
    market: string;
    code: string;
    name: string;
    pinyin: string;
    type: string;
}
export declare function parseSmartbox(text: string): SmartboxCandidate[];
export declare const SMARTBOX_MARKETS: string[];
export declare function fetchSmartbox(query: string, market: string, signal: AbortSignal): Promise<SmartboxCandidate[]>;
/** ifzq JSON body: empty / non-JSON / non-object must fail loudly with the host named. */
export declare function parseIfzqPayload(text: string, context: string): JsonRecord;
/** One ifzq request; `param=` is the K-line shape, `query` is for endpoints with their own names. */
export interface IfzqRequest {
    path: string;
    param?: string;
    query?: string;
    label: string;
    /** Error code when every host is exhausted; K-line keeps its historical code. */
    code?: string;
    /** "Host gave nothing": whole data object for A-shares, symbol series for HK/US. */
    isEmpty: (data: JsonRecord) => boolean;
    /**
     * Stop on first param rejection: another host will not fix it, and blacklisting all hosts for
     * 120s spreads one bad call process-wide. HK/US returns `{"code":1,"msg":"bad params"}`.
     */
    isParamRejection?: (payload: JsonRecord) => boolean;
}
/**
 * Rotate the shared ifzq hosts and return the first non-empty `data` object. Cancellation and
 * param failures rethrow before blacklist/rotation; see `docs/dev/web-retriever.md` §4.2.
 */
export declare function callIfzqHosts(request: IfzqRequest, signal: AbortSignal): Promise<JsonRecord>;
