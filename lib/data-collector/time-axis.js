import { DatasetQueryError } from './query.js';
import { dateParts, periodInputOf, resolveZonedPeriod, zoneOffsetMsByDiff } from '../time/tools.js';
/**
 * Dataset 时间轴：把「日历」与「列里的时间值」双向对齐。
 *
 * 为什么必须由宿主做（2026-09-23 真机会话实测，问题单 session 1e44050e）：
 * data_junior 拿到 `time_facts.covered_from = 1695571200000` 之后，要判断覆盖到哪一天、
 * 能不能做 52 周窗口、月末锚点是多少，只能自己把 epoch 换算成日历；而 `query_dataset` 的
 * filter 值又只接受毫秒，于是"2026-08-23 是多少毫秒"这类问题被反复心算。
 * 结果是单步思考 41,961 字符里绝大部分是时间戳算术，且口径随时可能算错（它自己在思考里
 * 写了 "Risky"）。时间换算是**确定性计算**，属于宿主：
 *
 * 1. 正向（值 → 日历）：{@link isoFromAxisValue} 供 profile 的 time_facts 输出 ISO；
 * 2. 反向（日历 → 值）：{@link resolveAxisWindow} 把 ISO 日期/相对期解析成该列自己的边界值；
 * 3. 语义：{@link probeTimeAxis} 从**列自身观测到的偏移**推断时区，绝不猜。
 *
 * 日线数据里 `date_ms` = 当地午夜 00:00 的 epoch（实测 1695571200000 = 2023-09-25 00:00 +08:00
 * = UTC 前一天 16:00），所以"当天"的边界必须按该列的偏移算：值同时满足
 * `>= dayStart` 与 `<= dayEnd` 才算落在这一天。
 */
/** 一天的毫秒数。 */
const DAY_MS = 86_400_000;
/**
 * 从"当地午夜的 epoch"反解时区偏移。
 *
 * 列里的值就是某地 00:00 的瞬间，所以它对一天的余数恰好是"UTC 当天几点"，
 * 时区偏移 = 该余数的**相反数**：A 股数据余数 57_600_000（UTC 16:00）⇒ +08:00。
 * 余数先归一到 `(-12h, +12h]`（超半天即换到前一天），否则 +08:00 会被读成 -16:00。
 */
function zoneOffsetFromMidnightValue(value) {
    const remainder = value % DAY_MS;
    const utcHourOfDay = remainder > DAY_MS / 2 ? remainder - DAY_MS : remainder;
    return -utcHourOfDay;
}
/** 推断出的偏移必须落在真实时区范围内（UTC-12:00 ~ UTC+14:00）。 */
const MIN_OFFSET_MS = -12 * 3_600_000;
const MAX_OFFSET_MS = 14 * 3_600_000;
/**
 * 把数值列当 epoch 毫秒的必要量级。秒级 epoch（10 位，约 1.7e9）与毫秒级（13 位，约 1.8e12）
 * 差三个数量级：不加这道闸门时，秒级时间戳会被误判成"日粒度 epoch"（1.7e9 恰好是 86400 的
 * 整数倍），于是所有窗口边界整体错到 1970 年附近。1e11 ms ≈ 1973 年，足以把两者分开。
 */
const MIN_EPOCH_MS = 100_000_000_000;
/** 能一键还原成 IANA 名的常见股票/基金数据时区（只有偏移等于它时才用名字，避免误标）。 */
const CANONICAL_ZONES = [
    { zone: 'Asia/Shanghai', offsetMs: 8 * 3_600_000 },
    { zone: 'UTC', offsetMs: 0 },
];
function isRecordLike(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
/** 行内取列值：与 store 的 profileCell 同义，只为不把 store 的私有实现引到这里。 */
function cellOf(row, column) {
    if (!isRecordLike(row))
        return { present: false, value: undefined };
    return Object.prototype.hasOwnProperty.call(row, column)
        ? { present: true, value: row[column] }
        : { present: false, value: undefined };
}
/** 某时刻在某时区下的日历年月日；时区非法或 Intl 不可用时返回 undefined。 */
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
/** `YYYY-MM-DD` 的严格解析：非法日期在这里就响亮失败，不带进任何换算。 */
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
/** 日历天数推进：只按日/周/月/季度算，调用方只用到这三种。 */
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
/** epoch 毫秒 → 该时区下的 `YYYY-MM-DD`；时区非法时退化为 UTC，绝不抛错。 */
export function isoDateFromEpoch(epochMs, zone) {
    const parts = readDateParts(epochMs, zone) ?? readDateParts(epochMs, 'UTC');
    if (parts === undefined)
        return new Date(epochMs).toISOString().slice(0, 10);
    return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}
/**
 * 某时区下"该日 00:00 的 epoch"。
 *
 * 两遍收敛：先用目标日 UTC 午夜的偏移作估计，再按估计时刻的偏移校正一次——
 * 对固定偏移时区（A 股数据里全部如此）一遍即准，对 DST 边界也只在跨日时刻才有差别。
 */
export function zoneDayStartMs(date, zone) {
    const parts = readCalendarDate(date);
    const utcMidnight = Date.UTC(parts.year, parts.month - 1, parts.day);
    const estimated = utcMidnight - zoneOffsetMsByDiff(utcMidnight, zone);
    return utcMidnight - zoneOffsetMsByDiff(estimated, zone);
}
/** 某时区下"该日 23:59:59.999 的 epoch"，与 {@link zoneDayStartMs} 同一天。 */
export function zoneDayEndMs(date, zone) {
    return zoneDayStartMs(shiftCalendarDate(date, 'day', 1), zone) - 1;
}
/** 把毫秒偏移写成 `+08:00` / `-03:30` / `+00:00`。 */
export function formatOffset(offsetMs) {
    const sign = offsetMs < 0 ? '-' : '+';
    const abs = Math.abs(offsetMs);
    const hours = Math.floor(abs / 3_600_000);
    const minutes = Math.floor((abs % 3_600_000) / 60_000);
    return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
/** 偏移落到常见数据时区时返回 IANA 名，否则返回 `UTC+08:00` 形态的说明串。 */
function zoneForOffset(offsetMs) {
    const canonical = CANONICAL_ZONES.find((entry) => entry.offsetMs === offsetMs);
    return canonical ? canonical.zone : `UTC${formatOffset(offsetMs)}`;
}
/**
 * 从列值推断时间轴的形态、偏移与对齐方式。
 *
 * - 全部是数字且都是 86_400_000 的整数倍 → 日粒度 epoch；偏移 = 值 mod 一天；
 * - 全部是 `YYYY-MM-DD` 样式字符串 → date_string（ISO 写法，模型可读，无需换算）；
 * - 其余（秒级 epoch、混合类型、带时间的字符串）→ unknown，**不做猜测**：
 *   宿主宁可让模型看到 `unknown` 并用工具确认，也不要给一个看似合理的错误边界。
 */
export function probeTimeAxis(column, values) {
    const present = values.filter((value) => value !== null && value !== undefined);
    if (present.length === 0)
        return { column, value_format: 'unknown' };
    const numbers = finiteNumbers(present);
    if (numbers.length === present.length) {
        // 日粒度 = 每个值都等于"某天 + 同一个日内偏移"，且这个偏移落在合法时区范围内。
        // 只检查 `value % DAY_MS === 0` 是不够的：A 股数据的当地午夜等于 UTC 前一天 16:00，
        // 余数是 57_600_000 而不是 0——按那个判据会把整列判成 unknown（实测踩过）。
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
 * 把一条 filter 的日期写法翻译成该时间轴上可比较的值。
 *
 * 三种结果：
 * - `filters`：翻译后的条件（`=` 展开成 `>= value_ge` + `<= value_le` 两条），交给引擎；
 * - `undefined`：这条不需要翻译（值不是日期 / 列不是时间列）；
 * - 抛错：**写法在此列上无意义**（日期字符串落到数值时间列等）。绝不静默放行——
 *   旧行为是 `skip_with_warning` 把该行整条跳过，等于"筛选条件消失、返回全量"，
 *   而模型只会看到一份看起来成功的全量结果（比报错危险得多）。
 */
export function translateFilterDateValue(input) {
    const { axis, dates, column, operator, value } = input;
    if (column !== axis.column || axis.value_format === 'unknown')
        return undefined;
    const asDate = typeof value === 'string' ? dateFromText(value) : undefined;
    const asPeriod = isRecordLike(value) ? periodInputOf(value.period) : undefined;
    // `in` 的数组形态：逐个识别，一个日期都不认识才算"不是日期写法"。
    const inDates = operator === 'in' && Array.isArray(value)
        ? value.filter((item) => typeof item === 'string' && dateFromText(item) !== undefined)
        : [];
    if (asDate === undefined && asPeriod === undefined && inDates.length === 0)
        return undefined;
    const label = asDate ?? (asPeriod === undefined ? inDates.join(',') : `${asPeriod}(period)`);
    const range = /^(>=|<=|=|>|<)$/.exec(operator);
    if (range === null) {
        // `in` / `!=` 在"整天"语义下表达的都是"排除"或"多天集合"：前者要求把每个日期
        // 展开成两条边界（会被 filter 上限打回），后者根本不是范围查询。
        // 与其给一个差一天的答案，不如让模型改用 >= / <= 明确写出要哪些天。
        throw new DatasetQueryError('query_type_conflict', `filter ${column} cannot take a date-like value with operator ${operator}; dates always mean whole days, so write the range you want with >= and <= (got ${label})`);
    }
    // 日期只有"整天"的语义：> 与 < 会把边界挪到前一天/后一天的 23:59:59.999，
    // 等于悄悄换一个窗口——宁可响亮失败，也不给一个差一天的答案。
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
/** `YYYY-MM-DD` / `YYYY-MM` / `YYYY` → 该区间的首日；其余文本返回 undefined。 */
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
/** period 的可读名字：对象形态写成 `2_year`，省略或空串写成 `all`。 */
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
export function resolveAxisWindow(input) {
    const { axis, dates } = input;
    const zone = input.zone ?? axis.time_zone ?? 'UTC';
    const sorted = [...new Set(dates)].sort();
    if (sorted.length === 0)
        throw new Error('dataset has no usable time values on the time axis');
    const anchor = input.anchorDate ?? sorted[sorted.length - 1];
    // 锚点就是 Dataset 最后一天时，"到锚点为止"不该再往后认一天（那是把窗口拖到未来）；
    // 只有当锚点明确超出现有数据、且窗口末端被截断时，末日的下一个交易日才属于该窗口。
    const anchorIsDatasetEnd = anchor === sorted[sorted.length - 1];
    // 名字只用于展示：对象形态的 period（`{unit,count}`）必须**原样**交给解析器，
    // 不能先转成展示名再解析（`2_year` 不是合法 period，会掉进 unsupported period）。
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
/** 把窗口夹到真实存在的日期：起点取"第一个 ≥ start"，终点取"最后一个 ≤ end"。 */
function clampToDates(sorted, start, end, boundary) {
    const inside = sorted.filter((date) => date >= start && date <= end);
    if (inside.length === 0)
        return undefined;
    const from = inside[0];
    const to = inside[inside.length - 1];
    // 窗口末端被前截（末日在锚点之前）、且该日之后确实还有下一个交易日时，才把它认进来。
    // 锚点就是数据最后一天时不延伸：那时窗口本来就该"到锚点为止"，多认一天是拖到未来。
    const next = sorted[sorted.indexOf(to) + 1];
    const extended = boundary.extend && next !== undefined && end <= boundary.anchor ? next : to;
    return { from, to: extended };
}
/**
 * 单值 → 该列里代表"这一天"的取值。
 *
 * `epoch_ms` 轴取当地午夜（value_ge 与 value_le 相等时的那个值），`date_string` 轴原样返回。
 * 用于 filter 的 `=` / `in`：先把日期压成单值，再交给引擎做相等比较。
 */
export function axisValueForDate(axis, date) {
    if (axis.value_format === 'date_string')
        return date;
    return zoneDayStartMs(date, axis.time_zone ?? 'UTC');
}
/**
 * 读一份 Dataset 的时间轴（形态 + 已出现的日期清单）。
 *
 * 日期清单只用于把窗口夹到真实存在的交易日，所以按升序逐行收集、遇到更早的值才插入，
 * 到上限即停：`date_ms` 数据是有序的，正常情况下一次遍历就装满。
 */
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
/** profile 的 `time_facts.windows`：最常见的几个窗口，让模型不必自己算锚点。
 *
 * 只给"数据里确实存在"的窗口；空窗口不出现，避免模型拿一个空区间去查询再困惑。
 */
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
            // 数据覆盖不到这个窗口（例如上市不足一年）时不输出该窗口，不是错误。
        }
    }
    return windows;
}
