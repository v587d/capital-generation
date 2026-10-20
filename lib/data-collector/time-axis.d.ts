import type { ProfileTimeAxis } from './store.js';
export type AxisValueFormat = 'epoch_ms' | 'date_string' | 'unknown';
/** Epoch to zone-local YYYY-MM-DD; an invalid zone falls back to UTC and never throws. */
export declare function isoDateFromEpoch(epochMs: number, zone: string): string;
/** Zone-local midnight, two-pass convergence; fixed-offset zones are exact on the first pass. */
export declare function zoneDayStartMs(date: string, zone: string): number;
export declare function zoneDayEndMs(date: string, zone: string): number;
export declare function formatOffset(offsetMs: number): string;
/** Infer format, offset and alignment from observed values only; anything else is `unknown`, never guessed. */
export declare function probeTimeAxis(column: string, values: unknown[]): ProfileTimeAxis;
/** One calendar-to-column conversion: usable bounds plus the real first/last data dates. */
export interface AxisBounds {
    value_ge: number | string;
    value_le: number | string;
    data_from: string | null;
    data_to: string | null;
}
/**
 * Translate a date-like filter value into comparable bounds. Dates mean whole days: `=` expands
 * to >=/<=, while `>`, `<`, `in` and `!=` fail loudly instead of silently shifting a day.
 */
export declare function translateFilterDateValue(input: {
    axis: ProfileTimeAxis;
    /** Probe dates in ascending order; period windows clamp to real trading days. */
    dates: string[];
    column: string;
    operator: string;
    value: unknown;
}): {
    operator: string;
    value: unknown;
}[] | undefined;
export interface AxisWindow extends AxisBounds {
    name: string;
    start_date: string;
    end_date: string;
}
/**
 * Dataset-mode time window: period -> usable query bounds plus the real first/last dates present.
 * Shares period parsing with capability mode so one phrase cannot mean two things.
 */
export interface DatasetTimeResolution {
    mode: 'dataset';
    format: 'epoch_ms' | 'date_string';
    timezone: string;
    time_column: string;
    period: string;
    range: {
        start_date: string;
        end_date: string;
    };
    data: {
        from: string | null;
        to: string | null;
        days: number | null;
    };
    /** Real dates present in the range; non-trading days clamp to the nearest session. */
    bounds: {
        bound_ge: number | string;
        bound_le: number | string;
        inclusive: boolean;
    };
    bounds_are_intraday: boolean;
    dataset: {
        covered_from: string;
        covered_to: string;
    };
    /** Facts the model must respect (e.g. nominal range differs from actual data). */
    warnings: string[];
}
export type PeriodInput = string | {
    unit: string;
    count: number;
};
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
 * Resolve a calendar window into bounds on this axis. First/last data dates clamp to dates that
 * actually exist; when the anchor is beyond the last data date, the end extends by one session.
 */
export declare function resolveAxisWindow(input: {
    axis: ProfileTimeAxis;
    dates: string[];
    period?: PeriodInput;
    anchorDate?: string;
    zone?: string;
}): AxisWindow;
/** Single value representing a whole day: local midnight on epoch axes, the date itself otherwise. */
export declare function axisValueForDate(axis: ProfileTimeAxis, date: string): number | string;
/** Collect distinct axis dates in ascending order, capped at MAX_AXIS_DATES; used to clamp windows. */
export declare const MAX_AXIS_DATES = 20000;
export declare function readAxisDates(input: {
    axis: ProfileTimeAxis;
    rows: unknown[];
    limit?: number;
}): string[];
/** Default windows for time_facts; windows with no data are omitted rather than returned empty. */
export declare const DEFAULT_WINDOW_PERIODS: readonly ["last_1_month", "last_3_months", "last_1_year", "ytd"];
export declare function defaultAxisWindows(input: {
    axis: ProfileTimeAxis;
    dates: string[];
}): AxisWindow[];
