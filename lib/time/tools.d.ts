import type { Context } from '@deepseek-ai/cordis';
import type { TimeAxisSnapshot } from '../data-collector/store.js';
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
export declare function resolveTimeZone(timeZone: unknown): string | undefined;
export declare function localTimeZone(): string;
/** UTC offset from formatted parts; fallback when timeZoneName is unavailable. */
export declare function zoneOffsetMsByDiff(now: number, zone: string): number;
export declare function readClock(now: number, timeZone?: string): Record<string, unknown>;
/**
 * Two time tools, not role-gated: get_local_datetime is the clock reading, resolve_data_time_range
 * is conversion. Dataset-mode authorization is enforced at call time by src/tool-exec.ts.
 */
export declare function registerTimeTool(ctx: Context, store?: TimeAxisReader): void;
type DateParts = {
    year: number;
    month: number;
    day: number;
};
/**
 * Sole period normalization: literal windows, {unit,count}, and stringified {unit,count} (models
 * really send that). undefined means the caller omitted period.
 */
export declare function periodInputOf(value: unknown): string | {
    unit: string;
    count: number;
} | undefined;
export declare function dateParts(value: string): DateParts;
export declare function shiftDate(value: string, unit: 'day' | 'week' | 'month' | 'quarter' | 'year', amount: number): string;
/** Whole days between two dates, computed at UTC midnight so timezone/DST cannot shift it (one implementation). */
export declare function dayDistance(start: string, end: string): number;
/**
 * Shared single-window resolver; also accepts all, ytd and YYYY-MM. Object periods go to
 * resolvePeriod as-is.
 */
export declare function resolveZonedPeriod(input: unknown, anchor: string): {
    start: string;
    end: string;
};
export declare function resolveDataTimeRange(args: Record<string, unknown>, now?: number): Record<string, unknown>;
export {};
