import type { ProfileTimeAxis } from './store.js';
export type AxisValueFormat = 'epoch_ms' | 'date_string' | 'unknown';
/** epoch 毫秒 → 该时区下的 `YYYY-MM-DD`；时区非法时退化为 UTC，绝不抛错。 */
export declare function isoDateFromEpoch(epochMs: number, zone: string): string;
/**
 * 某时区下"该日 00:00 的 epoch"。
 *
 * 两遍收敛：先用目标日 UTC 午夜的偏移作估计，再按估计时刻的偏移校正一次——
 * 对固定偏移时区（A 股数据里全部如此）一遍即准，对 DST 边界也只在跨日时刻才有差别。
 */
export declare function zoneDayStartMs(date: string, zone: string): number;
/** 某时区下"该日 23:59:59.999 的 epoch"，与 {@link zoneDayStartMs} 同一天。 */
export declare function zoneDayEndMs(date: string, zone: string): number;
/** 把毫秒偏移写成 `+08:00` / `-03:30` / `+00:00`。 */
export declare function formatOffset(offsetMs: number): string;
/**
 * 从列值推断时间轴的形态、偏移与对齐方式。
 *
 * - 全部是数字且都是 86_400_000 的整数倍 → 日粒度 epoch；偏移 = 值 mod 一天；
 * - 全部是 `YYYY-MM-DD` 样式字符串 → date_string（ISO 写法，模型可读，无需换算）；
 * - 其余（秒级 epoch、混合类型、带时间的字符串）→ unknown，**不做猜测**：
 *   宿主宁可让模型看到 `unknown` 并用工具确认，也不要给一个看似合理的错误边界。
 */
export declare function probeTimeAxis(column: string, values: unknown[]): ProfileTimeAxis;
/** 时间轴上的一次边界换算：日历 → 该列里真正可用的值 / 查询下界。 */
export interface AxisBounds {
    /** 日历起点（含）：`>= value_ge` 即"从这一天开始"。 */
    value_ge: number | string;
    /** 日历终点（含）的日末：`<= value_le` 即"到这一天结束"。 */
    value_le: number | string;
    /** 该窗口内 Dataset 首行/末行的日期（无数据时为 null）。 */
    data_from: string | null;
    data_to: string | null;
}
/**
 * 把一条 filter 的日期写法翻译成该时间轴上可比较的值。
 *
 * 三种结果：
 * - `filters`：翻译后的条件（`=` 展开成 `>= value_ge` + `<= value_le` 两条），交给引擎；
 * - `undefined`：这条不需要翻译（值不是日期 / 列不是时间列）；
 * - 抛错：**写法在此列上无意义**（日期字符串落到数值时间列等）。绝不静默放行——
 *   旧行为是 `skip_with_warning` 把该行整条跳过，等于"筛选条件消失、返回全量"，
 *   而模型只会看到一份看起来成功的全量结果（比报错危险得多）。
 */
export declare function translateFilterDateValue(input: {
    axis: ProfileTimeAxis;
    /** 探针看到的日期（升序），period 窗口要用它夹到真实存在的交易日。 */
    dates: string[];
    column: string;
    operator: string;
    value: unknown;
}): {
    operator: string;
    value: unknown;
}[] | undefined;
export interface AxisWindow extends AxisBounds {
    /** 窗口名，例如 `last_3_months`、`ytd`、`2026-10`。 */
    name: string;
    /** 解析出的日历区间（半开：start ≤ 日期 ≤ end）。 */
    start_date: string;
    end_date: string;
}
/**
 * Dataset 模式的时间窗解析结果：把"近 3 个月"这类说法直接翻译成**可直接使用的查询边界**，
 * 并同时给出人类可读的日期与 Dataset 里真实存在的首末日期。
 *
 * 这是 data_junior 侧 `resolve_data_time_range` 的第二形态（第一形态仍是"给 request_data
 * 生成上游时间参数"）。两形态共用同一套 period 解析（`time/tools.ts` 的 resolveZonedPeriod），
 * 避免同一个词在两侧得到不同答案。
 */
export interface DatasetTimeResolution {
    mode: 'dataset';
    format: 'epoch_ms' | 'date_string';
    timezone: string;
    time_column: string;
    period: string;
    /** 解析出的日历区间（名义区间）。 */
    range: {
        start_date: string;
        end_date: string;
    };
    /** 该区间内**真实存在**的首末日期（非交易日自动夹到相邻交易日）。 */
    data: {
        from: string | null;
        to: string | null;
        days: number | null;
    };
    /** 可直接使用的边界：`{column: time_column, operator: '>=', value: bound_ge}`。 */
    bounds: {
        bound_ge: number | string;
        bound_le: number | string;
        inclusive: boolean;
    };
    bounds_are_intraday: boolean;
    /** Dataset 的完整覆盖范围（ISO 形态）。 */
    dataset: {
        covered_from: string;
        covered_to: string;
    };
    /** 名义区间与真实数据不一致等必须让模型知道的事实（协议要求"warnings 必须遵守"）。 */
    warnings: string[];
}
/** period 的两种写法：字面窗口（`last_3_months`）或 `{unit,count}`。 */
export type PeriodInput = string | {
    unit: string;
    count: number;
};
/** period 的可读名字：对象形态写成 `2_year`，省略或空串写成 `all`。 */
export declare function periodName(period: PeriodInput | undefined): string;
export declare function resolveDatasetTimeWindow(input: {
    dataset_id: string;
    axis: ProfileTimeAxis;
    dates: string[];
    period?: PeriodInput;
    anchorDate?: string;
    zone?: string;
}): DatasetTimeResolution;
/**
 * 把「日历窗口」解析成该时间轴上可用的边界值。
 *
 * `data_from` / `data_to` 用**该列自己的粒度**把窗口夹到真实存在的日期上：
 * 窗口起点落在周末/节假日时前移到下一个有数据的日期，终点回退到最后一个有数据的日期。
 * 这样"近 1 个月"这类窗口不会因为非交易日而给出空结果。
 */
/**
 * 把「日历窗口」解析成该时间轴上可用的边界值。
 *
 * `data_from` / `data_to` 用**该列自己的粒度**把窗口夹到真实存在的日期上：窗口首日落在
 * 周末/节假日时前移到下一个有数据的日期，末日回退到最后一个有数据的日期。
 *
 * 锚点本身是非交易日时（例如"以周日为锚的近 1 周"）末日**再往后认一天**：
 * 名义窗口 [9/14, 9/20] 里最后一个交易日是 9/18，而锚点想表达的"最近一周"其实该到 9/21。
 * 这不是猜测：只有当紧邻末日的下一个日期确实存在、且它晚于锚点时才会这样延伸。
 */
export declare function resolveAxisWindow(input: {
    axis: ProfileTimeAxis;
    dates: string[];
    period?: PeriodInput;
    anchorDate?: string;
    zone?: string;
}): AxisWindow;
/**
 * 单值 → 该列里代表"这一天"的取值。
 *
 * `epoch_ms` 轴取当地午夜（value_ge 与 value_le 相等时的那个值），`date_string` 轴原样返回。
 * 用于 filter 的 `=` / `in`：先把日期压成单值，再交给引擎做相等比较。
 */
export declare function axisValueForDate(axis: ProfileTimeAxis, date: string): number | string;
/**
 * 读一份 Dataset 的时间轴（形态 + 已出现的日期清单）。
 *
 * 日期清单只用于把窗口夹到真实存在的交易日，所以按升序逐行收集、遇到更早的值才插入，
 * 到上限即停：`date_ms` 数据是有序的，正常情况下一次遍历就装满。
 */
export declare const MAX_AXIS_DATES = 20000;
export declare function readAxisDates(input: {
    axis: ProfileTimeAxis;
    rows: unknown[];
    limit?: number;
}): string[];
/** profile 的 `time_facts.windows`：最常见的几个窗口，让模型不必自己算锚点。
 *
 * 只给"数据里确实存在"的窗口；空窗口不出现，避免模型拿一个空区间去查询再困惑。
 */
export declare const DEFAULT_WINDOW_PERIODS: readonly ["last_1_month", "last_3_months", "last_1_year", "ytd"];
export declare function defaultAxisWindows(input: {
    axis: ProfileTimeAxis;
    dates: string[];
}): AxisWindow[];
