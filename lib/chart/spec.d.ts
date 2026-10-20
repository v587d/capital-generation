export type ChartKind = 'line' | 'area' | 'column' | 'candlestick' | 'bar';
export type ChartSeriesType = 'line' | 'area' | 'column';
export type MarkerPosition = 'aboveBar' | 'belowBar' | 'inBar';
export interface ChartSeriesSpec {
    field: string;
    label: string;
    type: ChartSeriesType;
}
export interface ChartOhlcSpec {
    open: string;
    high: string;
    low: string;
    close: string;
}
export interface ChartMarkerSpec {
    text: string;
    position: MarkerPosition;
    /** Time value matching x; mutually exclusive with index. */
    time?: string | number;
    /** 0-based row index into the filtered series. */
    index?: number;
}
export interface NormalizedChartSpec {
    kind: ChartKind;
    /** time = real time column; index = row order (category axis, labels mapped at render time). */
    axis: 'time' | 'index';
    timeField?: string;
    series: ChartSeriesSpec[];
    ohlc?: ChartOhlcSpec;
    volume?: {
        field: string;
    };
    markers: ChartMarkerSpec[];
    range?: {
        from?: string | number;
        to?: string | number;
    };
    title?: string;
}
export declare const CHART_KINDS: readonly ChartKind[];
/** OHLC kinds need four fields (library OhlcData vs SingleValueData); a single-value series in
 * BarSeries silently draws an empty chart, so reject it at the spec layer. */
export declare const OHLC_KINDS: readonly ChartKind[];
export declare const CHART_SERIES_TYPES: readonly ChartSeriesType[];
export declare const MARKER_POSITIONS: readonly MarkerPosition[];
export declare const MAX_CHART_SERIES = 6;
export declare const MAX_CHART_MARKERS = 50;
export declare const MAX_FIELD_NAME = 128;
export declare const MAX_CHART_TITLE = 200;
/** Shared model-facing kind description so error text and tool docs cannot drift. */
export declare function describeKinds(): string;
export declare function normalizeChartSpec(raw: unknown): NormalizedChartSpec;
