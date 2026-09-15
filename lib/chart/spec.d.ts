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
    /** 与 x 同口径的时间值；与 index 二选一。 */
    time?: string | number;
    /** 过滤后序列中的 0 基行号。 */
    index?: number;
}
export interface NormalizedChartSpec {
    kind: ChartKind;
    /** time = 有真实时间列；index = 按行序（分类轴），标签由 labels 映射。 */
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
/**
 * 需要 OHLC 四字段（而不是单值字段选择）的 kind。
 *
 * 依据是图表库的数据契约本身：`CandlestickData` 与 `BarData` 都继承 `OhlcData`，
 * 而 `LineData` / `HistogramData` 继承 `SingleValueData`。把单值序列塞进 BarSeries
 * 不会报错，只会画出一张**空图** —— 所以这个约束必须在 spec 层硬拦，
 * 不能指望"模型会写对"（这是实测出来的坑，不是推演）。
 */
export declare const OHLC_KINDS: readonly ChartKind[];
export declare const CHART_SERIES_TYPES: readonly ChartSeriesType[];
export declare const MARKER_POSITIONS: readonly MarkerPosition[];
export declare const MAX_CHART_SERIES = 6;
export declare const MAX_CHART_MARKERS = 50;
export declare const MAX_FIELD_NAME = 128;
export declare const MAX_CHART_TITLE = 200;
/** 面向模型的 kind 说明（错误信息与工具描述共用一处，避免两处措辞漂移）。 */
export declare function describeKinds(): string;
export declare function normalizeChartSpec(raw: unknown): NormalizedChartSpec;
