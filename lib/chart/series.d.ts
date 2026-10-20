import type { ChartKind, ChartSeriesType, MarkerPosition, NormalizedChartSpec } from './spec.js';
/** Post-downsample point cap; keeps the payload tens of KB and rendering fluid. */
export declare const MAX_CHART_POINTS = 2000;
/** Error-path hints are capped too; an error must not become a context bomb. */
export declare const MAX_FIELD_HINTS = 15;
export interface ChartSeriesPayload {
    id: string;
    label: string;
    type: ChartSeriesType;
    data: Array<{
        time: number | string;
        value: number;
    }>;
}
export interface ChartOhlcPayload {
    label: string;
    data: Array<{
        time: number | string;
        open: number;
        high: number;
        low: number;
        close: number;
    }>;
}
export interface ChartVolumePayload {
    label: string;
    data: Array<{
        time: number | string;
        value: number;
        direction?: 'up' | 'down';
    }>;
}
export interface ChartPayload {
    chart_id: string;
    title: string;
    kind: ChartKind;
    axis: 'time' | 'index';
    series: ChartSeriesPayload[];
    ohlc?: ChartOhlcPayload;
    volume?: ChartVolumePayload;
    markers: Array<{
        time: number | string;
        text: string;
        position: MarkerPosition;
    }>;
    /** Category axis: synthetic time → original label for ticks and crosshair. */
    labels?: Record<string, string>;
    meta: {
        points: number;
        original_points: number;
        downsampled: boolean;
        time_field?: string;
        axis: 'time' | 'index';
        source_kind: 'dataset' | 'path';
        dataset_id?: string;
        source_label?: string;
        captured_at?: number;
        skipped_rows: number;
        warnings: string[];
    };
}
/**
 * Sources often wrap rows in an envelope (item/data/stock_items); prefer known keys, and list
 * candidates instead of silently guessing when several arrays match.
 */
export declare function extractRows(value: unknown): {
    rows: unknown[];
    shape: string;
};
interface ParsedTime {
    /** Value handed to the library: 'YYYY-MM-DD' business day, or UTC seconds. */
    display: string | number;
    /** Comparison key (UTC seconds) for sort/filter/alignment. */
    seconds: number;
    /** True when the value came from a date-only string; decides business-day rendering. */
    dateOnly: boolean;
}
/**
 * Deterministic across machines: date-only stays a business-day string (no TZ shift), naive
 * datetime is UTC, numbers >= 1e11 are epoch ms, unparseable means the row has no time.
 */
export declare function parseTimeValue(value: unknown): ParsedTime | undefined;
export interface BuildChartPayloadInput {
    chart_id: string;
    spec: NormalizedChartSpec;
    rows: readonly unknown[];
    meta: {
        source_kind: 'dataset' | 'path';
        dataset_id?: string;
        source_label?: string;
        captured_at?: number;
    };
}
export declare function buildChartPayload(input: BuildChartPayloadInput): ChartPayload;
export {};
