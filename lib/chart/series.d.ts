import type { ChartKind, ChartSeriesType, MarkerPosition, NormalizedChartSpec } from './spec.js';
/** 单张图保留的最大点数（下采样后）。轻量图表在这个量级仍然流畅，且载荷只有几十 KB。 */
export declare const MAX_CHART_POINTS = 2000;
/** 字段候选清单最多回报多少个（错误路径本身也不能变成上下文炸弹）。 */
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
    /** 分类轴专用：合成时间 → 原始标签，运行时用它做刻度与十字线文案。 */
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
 * 从解析好的 JSON 里取出行数组。
 *
 * 真实数据源的同花顺返回常常是 envelope（行数组在 `item` / `data` / `stock_items` …），
 * 所以这里不能只认顶层数组；但也不能乱猜——猜错会让用户看到一张空图或错图。
 * 策略：顶层数组直接用；否则在候选键里找；候选都没有时列出**全部**数组型顶层键让模型
 * 自己指定路径，而不是静默取第一个。
 */
export declare function extractRows(value: unknown): {
    rows: unknown[];
    shape: string;
};
interface ParsedTime {
    /** 交给图表库的值：'YYYY-MM-DD' 字符串（业务日）或 UTC 秒数。 */
    display: string | number;
    /** 用于排序/过滤/对齐的比较键（UTC 秒）。 */
    seconds: number;
    /** 该值是否来自"纯日期"字符串（决定整张图是否用业务日显示）。 */
    dateOnly: boolean;
}
/**
 * 时间值解析。规则必须**确定**（同一份数据在任何机器上得到同一张图）：
 *  - 纯日期 `YYYY-MM-DD` → 业务日字符串，交给图表库按业务日显示（不做时区换算，避免差一天）；
 *  - `YYYY-MM-DD HH:mm[:ss]` 无时区 → 按 UTC 解释（显式规则，不依赖宿主本地时区）；
 *  - 数字/纯数字字符串 → epoch；`>= 1e11` 视为毫秒，否则视为秒；
 *  - 其余字符串 → `Date.parse`；失败即视为该行没有时间。
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
