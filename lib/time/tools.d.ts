import type { Context } from '@deepseek-ai/cordis';
import type { TimeAxisSnapshot } from '../data-collector/store.js';
/**
 * 时间工具需要的 Dataset 通道。只依赖 store 的**只读探针**，
 * 因此 time 平面不需要认识 Dataset 的写入、profile 或查询实现。
 */
export interface TimeAxisReader {
    describeTimeAxis(input: {
        session: unknown;
        dataset_id: string;
        time_column?: string;
        signal?: AbortSignal;
    }): Promise<TimeAxisSnapshot | undefined>;
}
export type DataTimeContractKind = 'epoch_range' | 'date_range' | 'date' | 'date_ms' | 'enum_range' | 'nested_epoch_range';
export interface DataTimeContract {
    kind: DataTimeContractKind;
    fields: string[];
    maxDays?: number;
    enumValues?: string[];
    enumMap?: Record<string, string>;
    warning?: string;
}
export declare function getDataTimeContract(capability: string): DataTimeContract | undefined;
/** 校验并规范化 IANA 时区名；undefined 表示宿主本地时区。'UTC'/'GMT' 为合法特殊值。 */
export declare function resolveTimeZone(timeZone: unknown): string | undefined;
/** 宿主进程的本地 IANA 时区名。 */
export declare function localTimeZone(): string;
/**
 * 差值法计算某 IANA 时区在 now 时刻的 UTC 偏移毫秒数（timeZoneName 缺失时的回退）。
 */
export declare function zoneOffsetMsByDiff(now: number, zone: string): number;
/** 当前时刻读数（内部纯函数，便于测试）：now 为 epoch 毫秒。 */
export declare function readClock(now: number, timeZone?: string): Record<string, unknown>;
/**
 * 注册时间工具（会话组作用域：主 Agent 与所有子 Agent 均可见，与数据工具同一
 * 注册通道）。模型知识截止日期不是当前时间；涉及"今天/现在/此刻/周几"的判断
 * 必须先调用本工具，绝不凭记忆猜测。
 */
export declare function registerTimeTool(ctx: Context, store?: TimeAxisReader): void;
type DateParts = {
    year: number;
    month: number;
    day: number;
};
/**
 * period 参数的**唯一归一入口**：接受字面窗口字符串、`{unit,count}`，以及被序列化成
 * 字符串的 `{"unit":"year","count":2}`。
 *
 * 最后一种不是宽容癖好：真机实测模型会这么传（会话 cf464cb6 与 8002e358 各一次，
 * 两次都掉进 `unsupported period` 白跑一轮）。宿主对 QuerySpec 的数组/对象参数早有同一套
 * 宽容解析（`src/data-collector/args.ts`），period 没有理由更严格。
 * 返回值 `undefined` = 调用方没给 period（取数形态按当前日期、Dataset 形态按数据最后一天）。
 */
export declare function periodInputOf(value: unknown): string | {
    unit: string;
    count: number;
} | undefined;
export declare function dateParts(value: string): DateParts;
export declare function shiftDate(value: string, unit: 'day' | 'week' | 'month' | 'quarter' | 'year', amount: number): string;
/**
 * 单窗口解析（**共享**入口）：`resolve_data_time_range`（能力参数那个模式）与
 * `time-axis.ts`（Dataset 时间轴模式）都用它，避免两处对同一个 period 词表给出不同答案。
 *
 * `resolvePeriod` 之外再认三种字面窗口：`all`（全区间）、`ytd`（年初到锚点）、
 * `YYYY-MM`（自然月）。它们不新增相对期语义，只是把"年内/某月"这两个最常用的
 * 分析窗口写成模型本来就会用的词。对象形态 `{unit,count}` 原样交给 `resolvePeriod`。
 */
export declare function resolveZonedPeriod(input: unknown, anchor: string): {
    start: string;
    end: string;
};
export declare function resolveDataTimeRange(args: Record<string, unknown>, now?: number): Record<string, unknown>;
export {};
