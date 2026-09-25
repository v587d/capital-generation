import { resolveDatasetTimeWindow } from '../data-collector/time-axis.js';
import { delegatedSession } from '../tool-exec.js';
const jsonObject = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
function render(_args, value) {
    // ToolOutputDefinition.render(args, value)：第一参是入参、第二参才是返回值。
    return [{ type: 'text', text: JSON.stringify(value) }];
}
const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/;
const LAST_YEAR_DAYS = 366;
const TEN_YEAR_DAYS = 3660;
const FIVE_YEAR_DAYS = 1830;
/** 需要 `query_hint`（时间范围提示语）的检索能力，显式点名（见使用处的 ⛔ 注释）。 */
const RETRIEVAL_HINT_CAPABILITIES = new Set(['anysearch_search', 'web_retriever_fetch']);
/** 数据接口时间参数的唯一模型可见契约；不从自然语言 description 反推规则。 */
const DATA_TIME_CONTRACTS = {
    history: { kind: 'epoch_range', fields: ['start', 'end'], maxDays: TEN_YEAR_DAYS },
    tencent_kline: { kind: 'date_range', fields: ['start', 'end'], maxDays: TEN_YEAR_DAYS, warning: '腾讯 K 线的 start/end 仅支持日/周/月；分钟线只能取最近 count 根' },
    index_history: { kind: 'epoch_range', fields: ['start', 'end'], maxDays: TEN_YEAR_DAYS },
    income_statement: { kind: 'epoch_range', fields: ['start', 'end'], maxDays: TEN_YEAR_DAYS },
    balance_sheet: { kind: 'epoch_range', fields: ['start', 'end'], maxDays: TEN_YEAR_DAYS },
    cash_flow: { kind: 'epoch_range', fields: ['start', 'end'], maxDays: TEN_YEAR_DAYS },
    fund_history: { kind: 'epoch_range', fields: ['start', 'end'], maxDays: FIVE_YEAR_DAYS },
    fund_performance_history: { kind: 'epoch_range', fields: ['start', 'end'] },
    fund_indicator_line: { kind: 'nested_epoch_range', fields: ['time_range'], warning: 'time_range 只是该接口的时间片段；indexes 仍须按能力契约另行提供' },
    corporate_actions: { kind: 'date_range', fields: ['from', 'to'] },
    hot_stock_rank_trend: { kind: 'date_range', fields: ['start_date', 'end_date'], maxDays: LAST_YEAR_DAYS },
    hot_stock_history: { kind: 'date', fields: ['date'], maxDays: LAST_YEAR_DAYS },
    dragon_tiger: { kind: 'date', fields: ['date'], maxDays: LAST_YEAR_DAYS, warning: '显式日期必须是交易日；工具不会自动回退到最近交易日' },
    eastmoney_top_buy_sell_market: { kind: 'date_range', fields: ['start_date', 'end_date'], maxDays: LAST_YEAR_DAYS },
    eastmoney_top_buy_sell_ticker: { kind: 'date_range', fields: ['start_date', 'end_date'], maxDays: LAST_YEAR_DAYS },
    eastmoney_lockup_expiry: { kind: 'date_range', fields: ['start_date', 'end_date'] },
    auction_benchmark: { kind: 'date', fields: ['date'], warning: '显式日期必须是交易日；工具不会自动回退到最近交易日' },
    limit_up_pool: { kind: 'date_ms', fields: ['date_ms'], warning: 'date_ms 必须对应交易日；工具不会自动回退到最近交易日' },
    limit_down_pool: { kind: 'date_ms', fields: ['date_ms'], warning: 'date_ms 必须对应交易日；工具不会自动回退到最近交易日' },
    limit_break_pool: { kind: 'date_ms', fields: ['date_ms'], warning: 'date_ms 必须对应交易日；工具不会自动回退到最近交易日' },
    fund_stock_history: { kind: 'date', fields: ['end_date'], warning: 'end_date 必须是可用报告期截止日；如需确认，请先查询 fund_stock_report_dates' },
    fund_bond_history: { kind: 'date', fields: ['end_date'], warning: 'end_date 必须是可用报告期截止日；如需确认，请先查询 fund_bond_report_dates' },
    fund_nav: { kind: 'enum_range', fields: ['range'], enumValues: ['week', 'month', 'tmonth', 'hyear', 'year', 'twoyear', 'tyear', 'fyear'], enumMap: { last_7_days: 'week', last_1_month: 'month', last_3_months: 'tmonth', last_6_months: 'hyear', last_1_year: 'year', last_2_years: 'twoyear', last_3_years: 'tyear', last_5_years: 'fyear' } },
    fund_manager_performance: { kind: 'enum_range', fields: ['range'], enumValues: ['month', 'tmonth', 'year', 'nowyear', 'now'], enumMap: { last_1_month: 'month', last_3_months: 'tmonth', last_1_year: 'year', current_year: 'nowyear', since_inception: 'now' } },
    anysearch_search: { kind: 'date_range', fields: ['start_date', 'end_date'] },
    wind_docs_announcements: { kind: 'date_range', fields: ['start_date', 'end_date'] },
    wind_docs_news: { kind: 'date_range', fields: ['start_date', 'end_date'] },
};
export function getDataTimeContract(capability) {
    const contract = DATA_TIME_CONTRACTS[capability];
    return contract ? { ...contract, fields: [...contract.fields], ...(contract.enumValues ? { enumValues: [...contract.enumValues] } : {}), ...(contract.enumMap ? { enumMap: { ...contract.enumMap } } : {}) } : undefined;
}
/** 校验并规范化 IANA 时区名；undefined 表示宿主本地时区。'UTC'/'GMT' 为合法特殊值。 */
export function resolveTimeZone(timeZone) {
    if (timeZone === undefined)
        return undefined;
    if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) {
        throw new Error('timezone must be an IANA name string (e.g. "Asia/Shanghai")');
    }
    if (timeZone !== 'UTC' && timeZone !== 'GMT' && !IANA_TIME_ZONE.test(timeZone)) {
        throw new Error('timezone must be an IANA name string (e.g. "Asia/Shanghai")');
    }
    let resolved;
    try {
        resolved = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
    }
    catch {
        throw new Error(`unsupported IANA timezone: ${JSON.stringify(timeZone)}`);
    }
    return resolved;
}
/** 宿主进程的本地 IANA 时区名。 */
export function localTimeZone() {
    return new Intl.DateTimeFormat('en-US').resolvedOptions().timeZone;
}
function two(value) {
    return String(value).padStart(2, '0');
}
/**
 * 把 Intl 的 timeZoneName（"GMT+08:00" / "GMT-05:00" / "GMT"）规范化为
 * "+08:00" / "-05:00" / "+00:00"。解析失败返回 null，调用方回退到差值算法。
 */
function normalizeUtcOffset(timeZoneName) {
    if (timeZoneName === 'GMT' || timeZoneName === 'UTC')
        return '+00:00';
    const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(timeZoneName);
    if (!match)
        return null;
    return `${match[1]}${two(Number(match[2]))}:${match[3] ?? '00'}`;
}
/**
 * 差值法计算某 IANA 时区在 now 时刻的 UTC 偏移毫秒数（timeZoneName 缺失时的回退）。
 */
export function zoneOffsetMsByDiff(now, zone) {
    const fields = {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23',
    };
    const read = (parts) => {
        const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        return Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
    };
    const utcParts = new Intl.DateTimeFormat('en-US', { ...fields, timeZone: 'UTC' }).formatToParts(now);
    const zoneParts = new Intl.DateTimeFormat('en-US', { ...fields, timeZone: zone }).formatToParts(now);
    return read(zoneParts) - read(utcParts);
}
/** 当前时刻读数（内部纯函数，便于测试）：now 为 epoch 毫秒。 */
export function readClock(now, timeZone) {
    const zone = resolveTimeZone(timeZone) ?? localTimeZone();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23', weekday: 'long', timeZoneName: 'longOffset',
    });
    const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
    let utcOffset = parts.timeZoneName ? normalizeUtcOffset(parts.timeZoneName) : null;
    if (utcOffset === null) {
        const offsetMs = zoneOffsetMsByDiff(now, zone);
        const sign = offsetMs < 0 ? '-' : '+';
        const abs = Math.abs(offsetMs);
        utcOffset = `${sign}${two(Math.floor(abs / 3_600_000))}:${two(Math.floor((abs % 3_600_000) / 60_000))}`;
    }
    const offsetMinutes = (utcOffset.startsWith('-') ? -1 : 1) * (Number(utcOffset.slice(1, 3)) * 60 + Number(utcOffset.slice(4, 6)));
    return {
        iso_local: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${utcOffset}`,
        iso_utc: new Date(now).toISOString(),
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour}:${parts.minute}:${parts.second}`,
        weekday: parts.weekday,
        timezone: zone,
        utc_offset: utcOffset,
        utc_offset_minutes: offsetMinutes,
        epoch_ms: now,
    };
}
/**
 * 注册时间工具（会话组作用域：主 Agent 与所有子 Agent 均可见，与数据工具同一
 * 注册通道）。模型知识截止日期不是当前时间；涉及"今天/现在/此刻/周几"的判断
 * 必须先调用本工具，绝不凭记忆猜测。
 */
export function registerTimeTool(ctx, store) {
    const tools = ctx.get('tools');
    if (!tools)
        return;
    const definition = {
        name: 'get_local_datetime',
        description: '获取当前真实日期时间的权威读数：宿主机器时钟 + IANA 时区（本地时区名与 UTC 偏移）。' +
            '模型知识截止日期绝不是当前时间；凡涉及"今天/现在/最新/此刻/周几/多少天前"的判断或时间戳换算，' +
            '必须先调用本工具取得当前时刻，涉及数据接口时间范围时改用 resolve_data_time_range，不要自行换算。可选 timezone 参数可指定 IANA 时区显示。',
        parameters: jsonObject({ timezone: { type: 'string', description: '可选 IANA 时区名（如 "Asia/Shanghai"）；缺省为宿主本地时区' } }),
        output: {
            schema: jsonObject({
                iso_local: { type: 'string' },
                iso_utc: { type: 'string' },
                date: { type: 'string' },
                time: { type: 'string' },
                weekday: { type: 'string' },
                timezone: { type: 'string' },
                utc_offset: { type: 'string' },
                utc_offset_minutes: { type: 'integer' },
                epoch_ms: { type: 'integer' },
            }, ['iso_local', 'iso_utc', 'date', 'time', 'weekday', 'timezone', 'utc_offset', 'utc_offset_minutes', 'epoch_ms']),
            render,
        },
        async execute(args, _exec) {
            return readClock(Date.now(), resolveTimeZone(args.timezone));
        },
    };
    ctx.effect(() => tools.register(definition), 'capital-generation.tool(get_local_datetime)');
    ctx.effect(() => tools.register(dataTimeRangeDefinition(store)), 'capital-generation.tool(resolve_data_time_range)');
}
/**
 * period 参数的**唯一归一入口**：接受字面窗口字符串、`{unit,count}`，以及被序列化成
 * 字符串的 `{"unit":"year","count":2}`。
 *
 * 最后一种不是宽容癖好：真机实测模型会这么传（会话 cf464cb6 与 8002e358 各一次，
 * 两次都掉进 `unsupported period` 白跑一轮）。宿主对 QuerySpec 的数组/对象参数早有同一套
 * 宽容解析（`src/data-collector/args.ts`），period 没有理由更严格。
 * 返回值 `undefined` = 调用方没给 period（取数形态按当前日期、Dataset 形态按数据最后一天）。
 */
export function periodInputOf(value) {
    if (typeof value === 'string') {
        const text = value.trim();
        if (text.length === 0)
            return undefined;
        if (text.startsWith('{')) {
            try {
                const parsed = JSON.parse(text);
                if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const spec = parsed;
                    if (typeof spec.unit === 'string' && Number.isSafeInteger(spec.count))
                        return { unit: spec.unit, count: Number(spec.count) };
                }
            }
            catch {
                // 解析不了就当字面窗口交给下面的解析器报错：错误信息更具体（列出支持的写法）。
            }
        }
        return text;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const spec = value;
        if (typeof spec.unit === 'string' && Number.isSafeInteger(spec.count))
            return { unit: spec.unit, count: Number(spec.count) };
    }
    return undefined;
}
export function dateParts(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match)
        throw new Error('period dates must use YYYY-MM-DD');
    const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    if (parts.year < 1990)
        throw new Error(`date is outside the supported range: ${value}`);
    const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month || check.getUTCDate() !== parts.day)
        throw new Error(`invalid calendar date: ${value}`);
    return parts;
}
function dateText(parts) { return `${String(parts.year).padStart(4, '0')}-${two(parts.month)}-${two(parts.day)}`; }
export function shiftDate(value, unit, amount) {
    const source = dateParts(value);
    if (unit === 'day' || unit === 'week') {
        // 周就是 7 天；"含锚点当天"的减一天由调用方（resolvePeriod）负责，
        // 这样 ±1 天与 ±1 周只差一个乘数，不会在两处各减一次。
        const date = new Date(Date.UTC(source.year, source.month - 1, source.day));
        date.setUTCDate(date.getUTCDate() + amount * (unit === 'week' ? 7 : 1));
        return dateText({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
    }
    const totalMonths = source.year * 12 + source.month - 1 + amount * (unit === 'quarter' ? 3 : unit === 'year' ? 12 : 1);
    const year = Math.floor(totalMonths / 12);
    const month = totalMonths % 12 + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return dateText({ year, month, day: Math.min(source.day, lastDay) });
}
function localDateAt(epoch, zone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(epoch).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}
function zonedDateEpoch(value, zone, endOfDay = false) {
    const parts = dateParts(value);
    const base = Date.UTC(parts.year, parts.month - 1, parts.day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    return base - zoneOffsetMsByDiff(base, zone);
}
function dayDistance(start, end) {
    const from = dateParts(start);
    const to = dateParts(end);
    return Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000);
}
function resolvePeriod(input, anchor) {
    const period = periodInputOf(input);
    if (period && typeof period === 'object' && !Array.isArray(period)) {
        const spec = period;
        if (!['day', 'week', 'month', 'quarter', 'year'].includes(String(spec.unit)) || typeof spec.count !== 'number' || !Number.isSafeInteger(spec.count) || spec.count < 1)
            throw new Error('period object must be { unit: day|week|month|quarter|year, count: positive integer }');
        const unit = spec.unit;
        const count = spec.count;
        // 与字符串形态同口径：含锚点当天 ⇒ 只有 day 少退一步。
        return { start: shiftDate(anchor, unit, unit === 'day' ? -(count - 1) : -count), end: anchor };
    }
    if (typeof period !== 'string' || period.trim().length === 0)
        throw new Error('period is required');
    const value = period.trim().toLowerCase();
    if (/^\d{4}$/.test(value))
        return { start: `${value}-01-01`, end: `${value}-12-31` };
    if (value === 'today')
        return { start: anchor, end: anchor };
    if (value === 'yesterday') {
        const date = shiftDate(anchor, 'day', -1);
        return { start: date, end: date };
    }
    if (value === 'current_year')
        return { start: `${dateParts(anchor).year}-01-01`, end: anchor };
    if (value === 'previous_year') {
        const year = dateParts(anchor).year - 1;
        return { start: `${year}-01-01`, end: `${year}-12-31` };
    }
    const match = /^last_(\d+)_(day|days|week|weeks|month|months|year|years)$/.exec(value);
    if (!match)
        throw new Error('unsupported period; use today, yesterday, YYYY, current_year, previous_year, last_N_days/weeks/months/years, or {unit,count}');
    const count = Number(match[1]);
    const unit = match[2].replace(/s$/, '');
    // "含锚点当天"的窗口要少退一步：天按 count-1 天回退，周按 count 周回退（周已在
    // shiftDate 里乘 7，两边各减一次就会得到 last_1_week = 0 天的空窗口——实测 bug）。
    return { start: shiftDate(anchor, unit, unit === 'day' ? -(count - 1) : -count), end: anchor };
}
/**
 * 单窗口解析（**共享**入口）：`resolve_data_time_range`（能力参数那个模式）与
 * `time-axis.ts`（Dataset 时间轴模式）都用它，避免两处对同一个 period 词表给出不同答案。
 *
 * `resolvePeriod` 之外再认三种字面窗口：`all`（全区间）、`ytd`（年初到锚点）、
 * `YYYY-MM`（自然月）。它们不新增相对期语义，只是把"年内/某月"这两个最常用的
 * 分析窗口写成模型本来就会用的词。对象形态 `{unit,count}` 原样交给 `resolvePeriod`。
 */
export function resolveZonedPeriod(input, anchor) {
    dateParts(anchor);
    const period = periodInputOf(input);
    if (period === undefined)
        throw new Error('period is required; use today, yesterday, YYYY, YYYY-MM, ytd, current_year, previous_year, all, last_N_days/weeks/months/years, or {unit,count}');
    if (typeof period !== 'string')
        return resolvePeriod(period, anchor);
    const value = period.toLowerCase();
    if (value === 'all')
        return { start: '1990-01-01', end: anchor };
    if (value === 'ytd')
        return { start: `${dateParts(anchor).year}-01-01`, end: anchor };
    const month = /^(\d{4})-(\d{2})$/.exec(value);
    if (month) {
        const year = Number(month[1]);
        const monthIndex = Number(month[2]);
        if (monthIndex < 1 || monthIndex > 12)
            throw new Error(`invalid month in period: ${period}`);
        const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
        return { start: `${month[1]}-${month[2]}-01`, end: `${month[1]}-${month[2]}-${String(lastDay).padStart(2, '0')}` };
    }
    return resolvePeriod(period, anchor);
}
function enumPeriod(contract, period) {
    if (typeof period !== 'string')
        throw new Error('this capability requires a named period such as last_3_months');
    const value = contract.enumMap?.[period.toLowerCase()];
    if (!value || !contract.enumValues?.includes(value))
        throw new Error(`unsupported period for this capability; allowed values: ${Object.keys(contract.enumMap ?? {}).join(', ')}`);
    return value;
}
export function resolveDataTimeRange(args, now = Date.now()) {
    const capability = typeof args.capability === 'string' ? args.capability.trim() : '';
    if (!capability)
        throw new Error('capability is required');
    const contract = getDataTimeContract(capability);
    if (!contract)
        throw new Error(`unsupported time capability: ${capability}`);
    const zone = resolveTimeZone(args.timezone) ?? 'Asia/Shanghai';
    if (contract.kind === 'enum_range') {
        return { mode: 'capability', capability, format: 'enum', timezone: zone, params: { [contract.fields[0]]: enumPeriod(contract, args.period) }, warnings: [] };
    }
    const anchor = typeof args.anchor_date === 'string' ? args.anchor_date.trim() : localDateAt(now, zone);
    dateParts(anchor);
    const resolved = resolvePeriod(args.period, anchor);
    const distance = dayDistance(resolved.start, resolved.end);
    if (contract.maxDays !== undefined && distance > contract.maxDays)
        throw new Error(`${capability} period exceeds the ${contract.maxDays} day interface limit`);
    const startEpoch = zonedDateEpoch(resolved.start, zone);
    const endEpoch = zonedDateEpoch(resolved.end, zone, true);
    const params = {};
    if (contract.kind === 'epoch_range') {
        params.start = startEpoch;
        params.end = endEpoch;
    }
    else if (contract.kind === 'nested_epoch_range')
        params.time_range = JSON.stringify({ time_type: 'DAY_1', start: startEpoch, end: endEpoch });
    else if (contract.kind === 'date_range') {
        params[contract.fields[0]] = resolved.start;
        params[contract.fields[1]] = resolved.end;
    }
    else if (contract.kind === 'date_ms')
        params.date_ms = zonedDateEpoch(resolved.end, zone);
    else
        params[contract.fields[0]] = resolved.end;
    // ⛔ 显式集合而不是 `web_` 前缀：改名 `anysearch_search` 曾让前缀判据静默失配，
    // query_hint 无声消失（schema 仍声明该字段，契约测试也抓不到）。新增检索能力必须点名。
    const queryHint = capability.startsWith('wind_') || RETRIEVAL_HINT_CAPABILITIES.has(capability) ? `${resolved.start} 至 ${resolved.end}` : undefined;
    return {
        mode: 'capability',
        capability,
        format: contract.kind === 'epoch_range' ? 'epoch_ms' : contract.kind === 'nested_epoch_range' ? 'epoch_ms_json' : contract.kind === 'date_ms' ? 'date_ms' : 'date_string',
        timezone: zone,
        range: { start_date: resolved.start, end_date: resolved.end, start_epoch_ms: startEpoch, end_epoch_ms: endEpoch },
        params,
        ...(queryHint ? { query_hint: queryHint } : {}),
        warnings: contract.warning ? [contract.warning] : [],
    };
}
function dataTimeRangeDefinition(store) {
    return {
        name: 'resolve_data_time_range',
        description: '解析时间窗，**两种形态**，绝不自行换算时间戳。① 取数形态：传 capability + period，输出可直接交给 request_data 的时间参数；② Dataset 分析形态：传 dataset_id（可选 time_column）+ period 或 anchor_date，按**该 Dataset 时间列自身的时区偏移**输出可直接用于 query_dataset filters 的边界（bounds.bound_ge/bound_le）与人类可读日期（range/data）。period 支持 today、yesterday、YYYY、YYYY-MM、ytd、current_year、previous_year、all、last_N_days/weeks/months/years，或 {unit,count}。anchor_date 省略时：取数形态用当前 Asia/Shanghai 日期，Dataset 形态用该 Dataset 的最后一天（相对期因此不会因数据陈旧而落空）。交易日与基金报告期不会自动猜测，结果中的 warnings 必须遵守。',
        parameters: jsonObject({
            capability: { type: 'string', description: '形态①：数据能力名，或 anysearch_search / wind_docs_announcements / wind_docs_news' },
            dataset_id: { type: 'string', description: '形态②：已授权的 dataset_id；给出时按该 Dataset 的时间轴解析（此时忽略 capability）。该形态只对**被委派的子 Agent**（如 data_junior）开放' },
            time_column: { type: 'string', description: '形态②可选：显式指定时间列；省略时宿主按列名与取值形态探测' },
            period: { oneOf: [{ type: 'string' }, { type: 'object', properties: { unit: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year'] }, count: { type: 'integer' } }, required: ['unit', 'count'], additionalProperties: false }] },
            anchor_date: { type: 'string', description: '可选锚点日期 YYYY-MM-DD；省略时取数形态用当前 Asia/Shanghai 日期，Dataset 形态用该 Dataset 的最后一天' },
            timezone: { type: 'string', description: '可选 IANA 时区；数据接口默认 Asia/Shanghai' },
        }, ['period']),
        output: {
            schema: jsonObject({
                capability: { type: 'string' },
                mode: { type: 'string' },
                format: { type: 'string' },
                timezone: { type: 'string' },
                time_column: { type: 'string' },
                period: { type: 'string' },
                range: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
                data: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
                bounds: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
                bounds_are_intraday: { type: 'boolean' },
                dataset: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
                params: { type: 'object', additionalProperties: true },
                query_hint: { type: 'string' },
                warnings: { type: 'array', items: { type: 'string' } },
            }, ['mode', 'format', 'timezone', 'warnings']),
            render,
        },
        async execute(args, exec) {
            const datasetId = typeof args.dataset_id === 'string' ? args.dataset_id.trim() : '';
            if (datasetId.length === 0)
                return resolveDataTimeRange(args);
            if (!store)
                throw new Error('Dataset time-range mode is unavailable: the Dataset store is not mounted in this session');
            // ⛔ 不要写 `exec.session`：框架把它放在 `exec.agent.session`（2026-09-23 事故，
            // 会话 66fa9666 里该形态对每个调用方都报 "requires an authorized session"）。
            // Dataset 形态读的是 Dataset 元数据 ⇒ 与 Dataset 系列工具同一道边界：只对**被委派的**
            // 子 Agent 开放（主 Agent 只用取数形态，不直连数据工具）。
            const session = delegatedSession(exec, 'resolve_data_time_range');
            const snapshot = await store.describeTimeAxis({
                session,
                dataset_id: datasetId,
                time_column: typeof args.time_column === 'string' && args.time_column.length > 0 ? args.time_column : undefined,
                signal: exec.signal,
            });
            if (snapshot === undefined) {
                throw new Error(`Dataset ${datasetId} has no detectable time column; pass time_column explicitly or inspect the Dataset first`);
            }
            return resolveDatasetTimeWindow({
                dataset_id: datasetId,
                axis: snapshot.axis,
                dates: snapshot.dates,
                // 对象形态不能在这里被丢掉：`{unit:"year",count:2}`（含它的字符串化写法）都必须走到
                // 解析器，否则会静默退化成 `all`——把"近 2 年"变成"全部历史"。
                period: periodInputOf(args.period),
                anchorDate: typeof args.anchor_date === 'string' ? args.anchor_date.trim() : undefined,
                zone: resolveTimeZone(args.timezone),
            });
        },
    };
}
