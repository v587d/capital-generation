import { DatasetQueryError } from './query.js';
import { dateParts, periodInputOf, resolveZonedPeriod, zoneOffsetMsByDiff } from '../time/tools.js';
/**
 * Dataset time axis: aligns calendar dates with the values stored in a column. `date_ms` is
 * local-midnight epoch, so a day means `>= dayStart && <= dayEnd` under the column's observed
 * offset. These conversions are deterministic host work, never left to the model.
 */
const DAY_MS = 86_400_000;
/** Recover the zone offset from local-midnight epochs: offset = -(value mod day), normalized to (-12h, +12h]. */
function zoneOffsetFromMidnightValue(value) {
    const remainder = value % DAY_MS;
    const utcHourOfDay = remainder > DAY_MS / 2 ? remainder - DAY_MS : remainder;
    return -utcHourOfDay;
}
/** Inferred offset must lie in UTC-12:00 .. UTC+14:00. */
const MIN_OFFSET_MS = -12 * 3_600_000;
const MAX_OFFSET_MS = 14 * 3_600_000;
/** Epoch must be >= 1e11: second-level epochs can also look day-aligned and would land near 1970. */
const MIN_EPOCH_MS = 100_000_000_000;
/** Offsets matching these get an IANA name; anything else is rendered as UTC±HH:MM. */
const CANONICAL_ZONES = [
    { zone: 'Asia/Shanghai', offsetMs: 8 * 3_600_000 },
    { zone: 'UTC', offsetMs: 0 },
];
function isRecordLike(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function cellOf(row, column) {
    if (!isRecordLike(row))
        return { present: false, value: undefined };
    return Object.prototype.hasOwnProperty.call(row, column)
        ? { present: true, value: row[column] }
        : { present: false, value: undefined };
}
function readDateParts(epochMs, zone) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
            .formatToParts(epochMs);
        const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
    }
    catch {
        return undefined;
    }
}
function readCalendarDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match)
        throw new Error(`date must use YYYY-MM-DD: ${JSON.stringify(value)}`);
    const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month || check.getUTCDate() !== parts.day) {
        throw new Error(`invalid calendar date: ${value}`);
    }
    return parts;
}
function shiftCalendarDate(value, unit, amount) {
    const parts = dateParts(value);
    if (unit === 'day') {
        const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
        date.setUTCDate(date.getUTCDate() + amount);
        return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    }
    const totalMonths = parts.year * 12 + parts.month - 1 + amount * (unit === 'quarter' ? 3 : 1);
    const year = Math.floor(totalMonths / 12);
    const month = totalMonths % 12 + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(parts.day, lastDay)).padStart(2, '0')}`;
}
function finiteNumbers(values) {
    return values.filter((value) => typeof value === 'number' && Number.isFinite(value));
}
/** Epoch to zone-local YYYY-MM-DD; an invalid zone falls back to UTC and never throws. */
export function isoDateFromEpoch(epochMs, zone) {
    const parts = readDateParts(epochMs, zone) ?? readDateParts(epochMs, 'UTC');
    if (parts === undefined)
        return new Date(epochMs).toISOString().slice(0, 10);
    return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}
/** Zone-local midnight, two-pass convergence; fixed-offset zones are exact on the first pass. */
export function zoneDayStartMs(date, zone) {
    const parts = readCalendarDate(date);
    const utcMidnight = Date.UTC(parts.year, parts.month - 1, parts.day);
    const estimated = utcMidnight - zoneOffsetMsByDiff(utcMidnight, zone);
    return utcMidnight - zoneOffsetMsByDiff(estimated, zone);
}
export function zoneDayEndMs(date, zone) {
    return zoneDayStartMs(shiftCalendarDate(date, 'day', 1), zone) - 1;
}
export function formatOffset(offsetMs) {
    const sign = offsetMs < 0 ? '-' : '+';
    const abs = Math.abs(offsetMs);
    const hours = Math.floor(abs / 3_600_000);
    const minutes = Math.floor((abs % 3_600_000) / 60_000);
    return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
function zoneForOffset(offsetMs) {
    const canonical = CANONICAL_ZONES.find((entry) => entry.offsetMs === offsetMs);
    return canonical ? canonical.zone : `UTC${formatOffset(offsetMs)}`;
}
/** Infer format, offset and alignment from observed values only; anything else is `unknown`, never guessed. */
export function probeTimeAxis(column, values) {
    const present = values.filter((value) => value !== null && value !== undefined);
    if (present.length === 0)
        return { column, value_format: 'unknown' };
    const numbers = finiteNumbers(present);
    if (numbers.length === present.length) {
        // Daily granularity means every value shares one intra-day remainder, not remainder 0: local
        // midnight is 16:00 UTC for A-share data, so `value % DAY_MS === 0` would reject the whole column.
        const offsetMs = zoneOffsetFromMidnightValue(numbers[0]);
        const dayAligned = numbers.every((value) => Number.isSafeInteger(value)
            && value >= MIN_EPOCH_MS
            && zoneOffsetFromMidnightValue(value) === offsetMs);
        const usable = offsetMs >= MIN_OFFSET_MS && offsetMs <= MAX_OFFSET_MS;
        return {
            column,
            value_format: 'epoch_ms',
            ...(dayAligned && usable
                ? { time_zone: zoneForOffset(offsetMs), utc_offset: formatOffset(offsetMs), aligned_to: 'local_midnight' }
                : { aligned_to: 'unknown' }),
        };
    }
    const strings = present.filter((value) => typeof value === 'string');
    const allDateLike = strings.length === present.length && strings.every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value.trim()));
    if (allDateLike)
        return { column, value_format: 'date_string', aligned_to: 'calendar_day' };
    return { column, value_format: 'unknown' };
}
/**
 * Translate a date-like filter value into comparable bounds. Dates mean whole days: `=` expands
 * to >=/<=, while `>`, `<`, `in` and `!=` fail loudly instead of silently shifting a day.
 */
export function translateFilterDateValue(input) {
    const { axis, dates, column, operator, value } = input;
    if (column !== axis.column || axis.value_format === 'unknown')
        return undefined;
    const asDate = typeof value === 'string' ? dateFromText(value) : undefined;
    const asPeriod = isRecordLike(value) ? periodInputOf(value.period) : undefined;
    // `in`: recognize dates element-wise; the value counts as a date form if any element is a date.
    const inDates = operator === 'in' && Array.isArray(value)
        ? value.filter((item) => typeof item === 'string' && dateFromText(item) !== undefined)
        : [];
    if (asDate === undefined && asPeriod === undefined && inDates.length === 0)
        return undefined;
    const label = asDate ?? (asPeriod === undefined ? inDates.join(',') : `${asPeriod}(period)`);
    const range = /^(>=|<=|=|>|<)$/.exec(operator);
    if (range === null) {
        // `in`/`!=` cannot express whole-day exclusion or multi-day sets without changing semantics.
        throw new DatasetQueryError('query_type_conflict', `filter ${column} cannot take a date-like value with operator ${operator}; dates always mean whole days, so write the range you want with >= and <= (got ${label})`);
    }
    // Strict comparisons would shift the window by a day; fail loudly instead.
    if (operator === '>' || operator === '<') {
        throw new DatasetQueryError('query_type_conflict', `filter ${column} cannot take a date-like value with operator ${operator}; a date means the whole day, so use >= (or <=) instead of comparison ${operator} (for a window, pass YYYY-MM-DD or { period })`);
    }
    const resolve = (date) => (axis.value_format === 'date_string'
        ? { start: date, end: date }
        : { start: zoneDayStartMs(date, axis.time_zone ?? 'UTC'), end: zoneDayEndMs(date, axis.time_zone ?? 'UTC') });
    const bounds = asDate !== undefined
        ? resolve(asDate)
        : (() => {
            const window = resolveAxisWindow({ axis, dates, period: asPeriod });
            return { start: window.value_ge, end: window.value_le };
        })();
    switch (operator) {
        case '>=':
            return [{ operator: '>=', value: bounds.start }];
        case '<=':
            return [{ operator: '<=', value: bounds.end }];
        case '=':
            return [{ operator: '>=', value: bounds.start }, { operator: '<=', value: bounds.end }];
        default:
            throw new DatasetQueryError('query_type_conflict', `filter ${column} cannot exclude a whole day by ${label} with ${operator}; ask for the days you want with >= / <= instead`);
    }
}
function dateFromText(value) {
    const text = value.trim();
    const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (full) {
        try {
            readCalendarDate(text);
            return text;
        }
        catch {
            return undefined;
        }
    }
    const month = /^(\d{4})-(\d{2})$/.exec(text);
    if (month) {
        const index = Number(month[2]);
        return index >= 1 && index <= 12 ? `${month[1]}-${month[2]}-01` : undefined;
    }
    const year = /^(\d{4})$/.exec(text);
    return year ? `${year[1]}-01-01` : undefined;
}
export function periodName(period) {
    if (period === undefined)
        return 'all';
    if (typeof period === 'string')
        return period.trim() === '' ? 'all' : period.trim();
    return `${period.count}_${period.unit}`;
}
export function resolveDatasetTimeWindow(input) {
    const { axis, dates } = input;
    if (axis.value_format === 'unknown') {
        throw new Error(`Dataset ${input.dataset_id} has no usable time axis: ${axis.column} values are neither epoch-day milliseconds nor YYYY-MM-DD strings; inspect the column before composing time filters`);
    }
    const sorted = [...new Set(dates)].sort();
    const window = resolveAxisWindow({ axis, dates: sorted, period: input.period, anchorDate: input.anchorDate, zone: input.zone });
    const from = window.data_from;
    const to = window.data_to;
    const warnings = [];
    if (from !== null && from !== window.start_date)
        warnings.push(`窗口起点 ${window.start_date} 在数据里没有对应行（非交易日或超出覆盖范围），实际首日 ${from}`);
    if (to !== null && to !== window.end_date)
        warnings.push(`窗口终点 ${window.end_date} 在数据里没有对应行，实际末日 ${to}`);
    return {
        mode: 'dataset',
        format: axis.value_format,
        timezone: input.zone ?? axis.time_zone ?? 'UTC',
        time_column: axis.column,
        period: window.name,
        range: { start_date: window.start_date, end_date: window.end_date },
        data: {
            from,
            to,
            days: from === null || to === null ? null : sorted.filter((date) => date >= from && date <= to).length,
        },
        bounds: { bound_ge: window.value_ge, bound_le: window.value_le, inclusive: true },
        bounds_are_intraday: axis.value_format === 'epoch_ms',
        dataset: { covered_from: sorted[0], covered_to: sorted[sorted.length - 1] },
        warnings,
    };
}
function boundsFor(axis, startDate, endDate) {
    if (axis.value_format === 'date_string') {
        return { value_ge: startDate, value_le: endDate, data_from: startDate, data_to: endDate };
    }
    const zone = axis.time_zone ?? 'UTC';
    return {
        value_ge: zoneDayStartMs(startDate, zone),
        value_le: zoneDayEndMs(endDate, zone),
        data_from: startDate,
        data_to: endDate,
    };
}
/**
 * Resolve a calendar window into bounds on this axis. First/last data dates clamp to dates that
 * actually exist; when the anchor is beyond the last data date, the end extends by one session.
 */
export function resolveAxisWindow(input) {
    const { axis, dates } = input;
    const zone = input.zone ?? axis.time_zone ?? 'UTC';
    const sorted = [...new Set(dates)].sort();
    if (sorted.length === 0)
        throw new Error('dataset has no usable time values on the time axis');
    const anchor = input.anchorDate ?? sorted[sorted.length - 1];
    // An anchor at the dataset end must not extend into the future; only an anchor beyond the data may.
    const anchorIsDatasetEnd = anchor === sorted[sorted.length - 1];
    // Name is display-only: object periods must reach the resolver as-is (`2_year` is not a valid period).
    const period = periodName(input.period);
    const resolved = resolveZonedPeriod(input.period ?? 'all', anchor);
    const clipped = clampToDates(sorted, resolved.start, resolved.end, { anchor, extend: !anchorIsDatasetEnd });
    if (clipped === undefined) {
        throw new Error(`period ${period} covers no rows in this Dataset (dataset covers ${sorted[0]} ~ ${sorted[sorted.length - 1]})`);
    }
    return {
        name: period,
        start_date: resolved.start,
        end_date: resolved.end,
        ...boundsFor(axis, resolved.start, resolved.end),
        data_from: clipped.from,
        data_to: clipped.to,
    };
}
/** Clamp to existing dates: first >= start, last <= end (optionally one session past). */
function clampToDates(sorted, start, end, boundary) {
    const inside = sorted.filter((date) => date >= start && date <= end);
    if (inside.length === 0)
        return undefined;
    const from = inside[0];
    const to = inside[inside.length - 1];
    const next = sorted[sorted.indexOf(to) + 1];
    const extended = boundary.extend && next !== undefined && end <= boundary.anchor ? next : to;
    return { from, to: extended };
}
/** Single value representing a whole day: local midnight on epoch axes, the date itself otherwise. */
export function axisValueForDate(axis, date) {
    if (axis.value_format === 'date_string')
        return date;
    return zoneDayStartMs(date, axis.time_zone ?? 'UTC');
}
/** Collect distinct axis dates in ascending order, capped at MAX_AXIS_DATES; used to clamp windows. */
export const MAX_AXIS_DATES = 20_000;
export function readAxisDates(input) {
    const { axis, rows } = input;
    const limit = input.limit ?? MAX_AXIS_DATES;
    if (axis.value_format === 'unknown')
        return [];
    const zone = axis.time_zone ?? 'UTC';
    const dates = [];
    const seen = new Set();
    for (const row of rows) {
        if (dates.length >= limit)
            break;
        const cell = cellOf(row, axis.column);
        if (!cell.present || cell.value === null || cell.value === undefined)
            continue;
        const date = axis.value_format === 'date_string'
            ? (typeof cell.value === 'string' ? cell.value.trim() : undefined)
            : (typeof cell.value === 'number' && Number.isFinite(cell.value) ? isoDateFromEpoch(cell.value, zone) : undefined);
        if (date === undefined || seen.has(date))
            continue;
        seen.add(date);
        dates.push(date);
    }
    return dates.sort();
}
/** Default windows for time_facts; windows with no data are omitted rather than returned empty. */
export const DEFAULT_WINDOW_PERIODS = ['last_1_month', 'last_3_months', 'last_1_year', 'ytd'];
export function defaultAxisWindows(input) {
    const windows = [];
    for (const period of DEFAULT_WINDOW_PERIODS) {
        try {
            const window = resolveAxisWindow({ axis: input.axis, dates: input.dates, period });
            if (window.data_from === null)
                continue;
            windows.push(window);
        }
        catch {
        }
    }
    return windows;
}
