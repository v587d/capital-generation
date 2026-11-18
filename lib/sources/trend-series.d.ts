export type TrendMarket = 'a-share' | 'hk' | 'us';
export type TrendSource = 'tencent' | 'eastmoney';
export type TrendStatus = 'live' | 'closed' | 'previous';
export type TrendPoint = [time: string, price: number, avg: number | null, volume: number | null, amount: number | null];
export interface TrendTarget {
    thscode: string;
    source: TrendSource;
    market: TrendMarket;
    /** Tencent symbol (`sh600519`, `hk00700`), set on the Tencent branch. */
    symbol?: string;
    /** Eastmoney secid (`105.AAPL`), set on the US branch. */
    secid?: string;
    isIndex: boolean;
    volumeUnit: 'lot' | 'share' | null;
    currency: string | null;
}
export interface TrendSeries {
    thscode: string;
    source: TrendSource;
    market: TrendMarket;
    tz: string;
    session_date: string | null;
    session_status: TrendStatus;
    /** Live but no point for >10 trading minutes: the desk says so instead of faking realtime. */
    stale: boolean;
    prev_close: number;
    open: number | null;
    high: number | null;
    low: number | null;
    last: number | null;
    /** Day VWAP; null for indices (an index level has no traded price). */
    avg: number | null;
    volume: number | null;
    amount: number | null;
    volume_unit: 'lot' | 'share' | null;
    currency: string | null;
    points: TrendPoint[];
}
/**
 * Storage identity → upstream request. `undefined` means the chart cannot be drawn at all
 * (US OTC pink and exotic US indices): the caller must not spend a request to find out.
 */
export declare function resolveTrendTarget(item: {
    thscode?: unknown;
    asset_type?: unknown;
}): TrendTarget | undefined;
/** Trading minutes elapsed up to a wall clock; lunch breaks never count as elapsed time. */
export declare function elapsedTradingMinutes(market: TrendMarket, minutes: number): number;
/** One entry point for both branches; `thscode` is filled by the caller, which owns identity. */
export declare function fetchTrendSeries(target: TrendTarget, options: {
    signal: AbortSignal;
    now?: number;
}): Promise<TrendSeries>;
