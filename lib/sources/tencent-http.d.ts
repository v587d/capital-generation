import type { DataSource } from '../data-collector/hub.js';
/**
 * One daily series for a UI pane: always day/qfq, one request per symbol, no paging.
 * It runs the same executors and row parsers as `get_kline` (a second parser would drift), and it is
 * the only place that knows the desk shows 万股 for 科创板 while the main board reports 手.
 */
export declare function fetchDailyBars(input: {
    thscode: string;
}, signal: AbortSignal, count?: number): Promise<{
    thscode: string;
    adjust: 'qfq';
    bars: Array<{
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
    }>;
    volume_unit: 'lot' | 'share';
}>;
export declare function createTencentSources(): DataSource[];
