import { buildDataKey } from '../data-collector/hub.js';
import { getDataTimeContract } from '../time/tools.js';
import { isLikelyIndex, normalizeSecurityCodes, parseSecurityCode, requireTencentSecurity } from './security-code.js';
// 港美股快照、smartbox 与那条**唯一的**出口节流链都在内核里；本文件只留能力定义与 K 线 / 分笔编排。
// 为什么必须共用：两条独立节流等于没有限流，两份字段位序表迟早只会修好一份（AGENTS.md §9.7）。
import { QUOTE_URL, fetchOffshoreIndexQuotes, fetchOffshoreQuotes, isRecord, normalizeHkCode, normalizeOffshoreIndexCode, normalizeUsCode, numberOrNull, requiredNumber, resolveUsKlineSymbol, sourceError, tencentGetText as getText, } from './tencent-public-core.js';
const TICK_URL = 'https://stock.gtimg.cn/data/index.php';
const KLINE_HOSTS = [
    'https://web.ifzq.gtimg.cn',
    'https://proxy.finance.qq.com/ifzqgtimg',
    'https://ifzq.gtimg.cn',
];
const HOST_COOLDOWN_MS = 120_000;
const KLINE_MINUTES = new Set(['m1', 'm5', 'm15', 'm30', 'm60']);
const KLINE_PERIODS = new Set(['day', 'week', 'month', 'm1', 'm5', 'm15', 'm30', 'm60']);
const KLINE_SPAN_DAYS = { day: 700, week: 3650, month: 18250 };
const MAX_TICK_PAGES = 300;
const TICK_SESSION_END = '15:00:59';
const hostDownUntil = new Map();
const quoteOutput = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            code: { type: 'string' },
            tencent_symbol: { type: 'string' },
            name: { type: 'string' },
            price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            last_close: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            open: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            change_amt: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            high: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            low: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            amount_wan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            turnover_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            pe_ttm: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            amplitude_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            float_mcap_yi: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            mcap_yi: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            pb: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            limit_up: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            limit_down: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            vol_ratio: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            pe_static: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            is_stale: { type: 'boolean' },
            stale_reason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        },
        additionalProperties: true,
    },
};
const klineOutput = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            code: { type: 'string' },
            tencent_symbol: { type: 'string' },
            adjust: { type: 'string' },
            date: { type: 'string' },
            datetime: { type: 'string' },
            open: { type: 'number' },
            high: { type: 'number' },
            low: { type: 'number' },
            close: { type: 'number' },
            volume: { type: 'number' },
            turnover_rate_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        },
        additionalProperties: true,
    },
};
const ticksOutput = {
    type: 'object',
    properties: {
        date: { type: 'string' },
        code: { type: 'string' },
        tencent_symbol: { type: 'string' },
        rows: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    time: { type: 'string' },
                    seq: { type: 'integer' },
                    price: { type: 'number' },
                    change: { type: 'number' },
                    volume: { type: 'number' },
                    amount: { type: 'number' },
                    side: { enum: ['B', 'S', 'M'] },
                },
                additionalProperties: true,
            },
        },
        missing_seq: { type: 'array', items: { type: 'integer' } },
    },
    required: ['date', 'code', 'tencent_symbol', 'rows', 'missing_seq'],
    additionalProperties: true,
};
function assertKnown(values, allowed) {
    for (const key of Object.keys(values))
        if (!allowed.includes(key))
            throw new Error(`unsupported parameter: ${key}`);
}
function strictDate(value, name) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new Error(`parameter ${name} must be YYYY-MM-DD`);
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
        throw new Error(`parameter ${name} must be a valid YYYY-MM-DD date`);
    return value;
}
function integer(value, name, min, max) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
        throw new Error(`parameter ${name} must be an integer from ${min} to ${max}`);
    return value;
}
function parseJson(text, context) {
    if (!text.trim())
        throw sourceError(`Tencent ${context} returned an empty response`, 'tencent_empty_response');
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (error) {
        throw sourceError(`Tencent ${context} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`, 'tencent_invalid_response');
    }
    if (!isRecord(parsed))
        throw sourceError(`Tencent ${context} returned ${Array.isArray(parsed) ? 'an array' : typeof parsed}, expected an object`, 'tencent_invalid_response');
    return parsed;
}
function parseCodeParams(params, name = 'code') {
    const code = requireTencentSecurity(parseSecurityCode(params[name], name), name);
    return { code, canonical: code.canonical };
}
function normalizeQuote(params) {
    if (!isRecord(params))
        throw new Error('params must be an object');
    assertKnown(params, ['codes']);
    const codes = normalizeSecurityCodes(params.codes, 'codes', 50).map((code) => requireTencentSecurity(code, 'codes').canonical);
    return { codes };
}
function normalizeKline(params) {
    if (!isRecord(params))
        throw new Error('params must be an object');
    assertKnown(params, ['code', 'period', 'adjust', 'start', 'end', 'count']);
    const { code } = parseCodeParams(params);
    if (code.market === 'BJ')
        throw new Error('parameter code: Tencent K-line endpoint supports SH/SZ only');
    const period = params.period === undefined ? 'day' : String(params.period).toLowerCase();
    if (!KLINE_PERIODS.has(period))
        throw new Error('parameter period must be day/week/month/m1/m5/m15/m30/m60');
    const adjust = params.adjust === undefined ? undefined : String(params.adjust).toLowerCase();
    if (adjust !== undefined && !['qfq', 'hfq', 'none'].includes(adjust))
        throw new Error('parameter adjust must be qfq, hfq, or none');
    const start = params.start === undefined ? undefined : strictDate(params.start, 'start');
    const end = params.end === undefined ? undefined : strictDate(params.end, 'end');
    if (end !== undefined && start === undefined)
        throw new Error('parameter end requires start');
    if (start !== undefined && end !== undefined && start > end)
        throw new Error('parameter start must not be later than end');
    const count = params.count === undefined ? undefined : integer(params.count, 'count', 1, KLINE_MINUTES.has(period) ? 320 : 640);
    if (KLINE_MINUTES.has(period) && adjust !== undefined && adjust !== 'none')
        throw new Error('parameter adjust must be none for minute K-lines');
    if (KLINE_MINUTES.has(period) && (start !== undefined || end !== undefined))
        throw new Error('parameter start/end are only supported for day/week/month K-lines');
    return {
        code: code.canonical,
        period,
        ...(adjust === undefined ? {} : { adjust }),
        ...(start === undefined ? {} : { start }),
        ...(end === undefined ? {} : { end }),
        ...(count === undefined ? {} : { count }),
    };
}
function normalizeTicks(params) {
    if (!isRecord(params))
        throw new Error('params must be an object');
    assertKnown(params, ['code']);
    const { code } = parseCodeParams(params);
    if (code.isIndex)
        throw new Error('parameter code must be a stock or ETF, not an index');
    if (code.market === 'BJ')
        throw new Error('parameter code: Tencent tick endpoint supports SH/SZ only');
    return { code: code.canonical };
}
function parseQuoteRows(text, requested) {
    const rows = [];
    for (const line of text.split(';')) {
        const match = /^v_(sh|sz)(\d{6})="([^"]*)"/.exec(line.trim());
        if (!match)
            continue;
        const symbol = `${match[1]}${match[2]}`;
        const code = requested.get(symbol);
        if (!code)
            continue;
        const values = match[3].split('~');
        if (values.length < 53)
            throw sourceError(`Tencent quote ${symbol} returned ${values.length} fields, expected at least 53`, 'tencent_invalid_response');
        const value = (index) => numberOrNull(values[index]);
        const row = {
            code: code.canonical,
            tencent_symbol: symbol,
            name: values[1] ?? '',
            price: value(3),
            last_close: value(4),
            open: value(5),
            change_amt: value(31),
            change_pct: value(32),
            high: value(33),
            low: value(34),
            amount_wan: value(37),
            turnover_pct: value(38),
            pe_ttm: value(39),
            amplitude_pct: value(43),
            float_mcap_yi: value(44),
            mcap_yi: value(45),
            pb: value(46),
            limit_up: value(47),
            limit_down: value(48),
            vol_ratio: value(49),
            pe_static: value(52),
        };
        const stale = row.amount_wan === 0 && row.price !== null && row.price === row.last_close;
        row.is_stale = stale;
        row.stale_reason = stale
            ? (code.market === 'BJ' && /^(43|83|87)/.test(code.digits) ? 'possible migrated BJ legacy code' : 'zero turnover and price equals previous close')
            : null;
        rows.push(row);
    }
    return rows;
}
async function executeQuote(params, signal) {
    const codes = normalizeSecurityCodes(params.codes, 'codes', 50).map((code) => requireTencentSecurity(code, 'codes'));
    const requested = new Map(codes.map((code) => [code.tencentSymbol, code]));
    const text = await getText(`${QUOTE_URL}${codes.map((code) => code.tencentSymbol).join(',')}`, signal, 'gbk');
    const rows = parseQuoteRows(text, requested);
    if (rows.length === 0) {
        if (text.includes('v_pv_none_match'))
            throw new Error('Tencent returned no matching securities');
        throw sourceError('Tencent quote returned no usable rows', 'tencent_empty_response');
    }
    return { data: rows, schema: quoteOutput };
}
function defaultParamRejection(payload) {
    return payload.msg === 'param error';
}
async function callKlineHosts(transport, signal) {
    const errors = [];
    const rejected = transport.isParamRejection ?? defaultParamRejection;
    for (const host of KLINE_HOSTS) {
        if ((hostDownUntil.get(host) ?? 0) > Date.now())
            continue;
        try {
            const url = `${host}${transport.path}?param=${encodeURIComponent(transport.param)}`;
            const payload = parseJson(await getText(url, signal), `${transport.label} ${host}`);
            if (rejected(payload)) {
                throw sourceError(`Tencent rejected the ${transport.label} parameter (${String(payload.msg ?? '') || `code ${String(payload.code)}`}): ${transport.param}`, 'tencent_invalid_param');
            }
            if (isRecord(payload.data) && !transport.isEmpty(payload.data))
                return payload.data;
            errors.push(`${host}: empty data`);
            hostDownUntil.set(host, Date.now() + HOST_COOLDOWN_MS);
        }
        catch (error) {
            // 取消与参数性失败都原样抛出，**先于**一切拉黑/换机逻辑（docs/dev/web-retriever.md §4.2「取消原样抛出」）。
            if (error instanceof Error && error.name === 'AbortError')
                throw error;
            if (error.code === 'tencent_invalid_param')
                throw error;
            errors.push(`${host}: ${error instanceof Error ? error.message : String(error)}`);
            hostDownUntil.set(host, Date.now() + HOST_COOLDOWN_MS);
        }
    }
    throw sourceError(`Tencent ${transport.label} endpoints unavailable: ${errors.join('; ')}`, 'tencent_kline_unavailable');
}
async function callKline(path, param, signal) {
    return { data: await callKlineHosts({ path, param, label: 'K-line', isEmpty: (data) => Object.keys(data).length === 0 }, signal) };
}
function addDays(date, days) {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}
function todayUtc() {
    return new Date().toISOString().slice(0, 10);
}
function parseKlineRows(data, symbol, canonical, period, adjust, start, end) {
    const node = data[symbol];
    if (!isRecord(node))
        throw sourceError(`Tencent K-line ${symbol} response has no symbol node`, 'tencent_invalid_response');
    const key = adjust === 'none' ? period : `${adjust}${period}`;
    const items = node[key] ?? node[period];
    if (!Array.isArray(items))
        throw sourceError(`Tencent K-line ${symbol} response has no ${key}/${period} array`, 'tencent_invalid_response');
    if (key !== period && Array.isArray(node[key]) && node[key].length === 0 && Array.isArray(node[period]) && node[period].length > 0) {
        throw sourceError(`Tencent K-line ${symbol} returned empty ${key} beside non-empty raw ${period}`, 'tencent_invalid_response');
    }
    const rows = [];
    for (const item of items) {
        if (!Array.isArray(item) || item.length < 6)
            throw sourceError(`Tencent K-line ${symbol} row shape changed`, 'tencent_invalid_response');
        const date = String(item[0]);
        if (start !== undefined && end !== undefined && (date < start || date > end))
            throw sourceError(`Tencent K-line ${symbol} returned out-of-range date ${date}`, 'tencent_invalid_response');
        rows.push({
            code: canonical,
            tencent_symbol: symbol,
            adjust,
            date,
            open: requiredNumber(item[1], 'open'),
            high: requiredNumber(item[3], 'high'),
            low: requiredNumber(item[4], 'low'),
            close: requiredNumber(item[2], 'close'),
            volume: requiredNumber(item[5], 'volume'),
        });
    }
    return rows;
}
async function executeKline(params, signal) {
    const code = requireTencentSecurity(parseSecurityCode(params.code, 'code'), 'code');
    const period = String(params.period ?? 'day');
    const adjust = String(params.adjust ?? (KLINE_MINUTES.has(period) ? 'none' : 'qfq'));
    const start = params.start;
    const end = params.end;
    const count = Number(params.count ?? (KLINE_MINUTES.has(period) ? 320 : 320));
    const symbol = code.tencentSymbol;
    if (KLINE_MINUTES.has(period)) {
        const result = await callKline('/appstock/app/kline/mkline', `${symbol},${period},,${count}`, signal);
        const node = result.data[symbol];
        if (!isRecord(node) || !Array.isArray(node[period]))
            throw sourceError(`Tencent minute K-line ${symbol} response has no ${period} array`, 'tencent_invalid_response');
        const rows = [];
        const seen = new Set();
        for (const item of node[period]) {
            if (!Array.isArray(item) || item.length < 6)
                throw sourceError(`Tencent minute K-line ${symbol} row shape changed`, 'tencent_invalid_response');
            const stamp = String(item[0]);
            if (seen.has(stamp))
                throw sourceError(`Tencent minute K-line ${symbol} contains duplicate ${stamp}`, 'tencent_invalid_response');
            seen.add(stamp);
            rows.push({
                code: code.canonical,
                tencent_symbol: symbol,
                adjust: 'none',
                datetime: stamp.length === 12 ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ${stamp.slice(8, 10)}:${stamp.slice(10, 12)}` : stamp,
                open: requiredNumber(item[1], 'open'),
                high: requiredNumber(item[3], 'high'),
                low: requiredNumber(item[4], 'low'),
                close: requiredNumber(item[2], 'close'),
                volume: requiredNumber(item[5], 'volume'),
                turnover_rate_pct: item.length > 7 ? (numberOrNull(item[7]) === null ? null : numberOrNull(item[7]) / 100) : null,
            });
        }
        if (rows.length === 0)
            throw new Error(`Tencent minute K-line ${symbol} returned no rows`);
        return { data: rows, schema: klineOutput };
    }
    const last = end ?? todayUtc();
    const windows = [];
    if (start !== undefined) {
        const span = KLINE_SPAN_DAYS[period];
        let cursor = start;
        while (cursor <= last) {
            const stop = cursor <= last ? (addDays(cursor, span - 1) < last ? addDays(cursor, span - 1) : last) : last;
            windows.push([cursor, stop, 640]);
            cursor = addDays(stop, 1);
        }
    }
    else {
        windows.push(['', '', count]);
    }
    const all = [];
    const seen = new Set();
    for (const [windowStart, windowEnd, windowCount] of windows) {
        const result = await callKline('/appstock/app/fqkline/get', `${symbol},${period},${windowStart},${windowEnd},${windowCount},${adjust === 'none' ? '' : adjust}`, signal);
        for (const row of parseKlineRows(result.data, symbol, code.canonical, period, adjust, windowStart || undefined, windowEnd || undefined)) {
            const key = row.date;
            if (seen.has(key))
                throw sourceError(`Tencent K-line ${symbol} contains duplicate ${key}`, 'tencent_invalid_response');
            seen.add(key);
            if (Number(row.open) <= 0 || Number(row.high) <= 0 || Number(row.low) <= 0 || Number(row.close) <= 0)
                throw sourceError(`Tencent ${adjust} K-line ${symbol} contains a non-positive price`, 'tencent_invalid_response');
            all.push(row);
        }
    }
    all.sort((left, right) => String(left.date).localeCompare(String(right.date)));
    if (all.length === 0)
        throw new Error(`Tencent K-line ${symbol} returned no rows`);
    return { data: all, schema: klineOutput };
}
function parseSnapshot(text, symbol) {
    const match = new RegExp(`v_${symbol}="([^"]*)"`).exec(text);
    if (!match)
        throw new Error(`Tencent quote returned no snapshot for ${symbol}`);
    const fields = match[1].split('~');
    if (fields.length < 36 || !/^\d{14}$/.test(fields[30] ?? ''))
        throw sourceError(`Tencent quote snapshot ${symbol} shape changed`, 'tencent_invalid_response');
    const parts = String(fields[35]).split('/');
    if (parts.length !== 3)
        throw sourceError(`Tencent quote snapshot ${symbol} amount field changed`, 'tencent_invalid_response');
    const date = `${fields[30].slice(0, 4)}-${fields[30].slice(4, 6)}-${fields[30].slice(6, 8)}`;
    return { date, clock: fields[30].slice(8), amount: requiredNumber(parts[2], 'amount') };
}
async function executeTicks(params, signal) {
    const code = requireTencentSecurity(parseSecurityCode(params.code, 'code'), 'code');
    if (isLikelyIndex(code))
        throw new Error(`parameter code ${code.canonical} is an index; Tencent ticks require a stock or ETF`);
    const symbol = code.tencentSymbol;
    const before = parseSnapshot(await getText(`${QUOTE_URL}${symbol}`, signal, 'gbk'), symbol);
    if (before.amount === 0)
        throw new Error(`${symbol} has no turnover for ${before.date}`);
    const rows = [];
    const missingSeq = [];
    for (let page = 0; page < MAX_TICK_PAGES; page += 1) {
        const url = new URL(TICK_URL);
        url.searchParams.set('appn', 'detail');
        url.searchParams.set('action', 'data');
        url.searchParams.set('c', symbol);
        url.searchParams.set('p', String(page));
        const text = (await getText(url.toString(), signal, 'gbk')).trim();
        if (!text)
            break;
        const match = new RegExp(`^v_detail_data_${symbol}=\\[(\\d+),"([^"]*)"\\];?$`).exec(text);
        if (!match || Number(match[1]) !== page)
            throw sourceError(`Tencent ticks ${symbol} page ${page} shape changed`, 'tencent_invalid_response');
        if (!match[2])
            break;
        for (const raw of match[2].split('|')) {
            const fields = raw.split('/');
            if (fields.length !== 7 || !/^\d{2}:\d{2}:\d{2}$/.test(fields[1]) || !['B', 'S', 'M'].includes(fields[6]))
                throw sourceError(`Tencent ticks ${symbol} page ${page} row shape changed`, 'tencent_invalid_response');
            const row = {
                time: fields[1],
                seq: integer(Number(fields[0]), 'source seq', 0, Number.MAX_SAFE_INTEGER),
                price: requiredNumber(fields[2], 'price'),
                change: requiredNumber(fields[3], 'change'),
                volume: requiredNumber(fields[4], 'volume'),
                amount: requiredNumber(fields[5], 'amount'),
                side: fields[6],
            };
            const expected = rows.length === 0 ? 0 : Number(rows[rows.length - 1].seq) + 1;
            if (row.seq < expected || (rows.length > 0 && String(row.time) < String(rows[rows.length - 1].time)))
                throw sourceError(`Tencent ticks ${symbol} sequence or time moved backwards`, 'tencent_invalid_response');
            if (row.seq > expected) {
                if (row.time <= TICK_SESSION_END)
                    throw sourceError(`Tencent ticks ${symbol} has missing continuous-session sequence ${expected}-${row.seq - 1}`, 'tencent_incomplete');
                for (let seq = expected; seq < row.seq; seq += 1)
                    missingSeq.push(seq);
            }
            rows.push(row);
        }
    }
    if (rows.length === 0)
        throw new Error(`${symbol} returned no tick rows`);
    const after = parseSnapshot(await getText(`${QUOTE_URL}${symbol}`, signal, 'gbk'), symbol);
    if (after.date !== before.date)
        throw sourceError(`Tencent ticks crossed trading day ${before.date} -> ${after.date}`, 'tencent_incomplete');
    const continuousAmount = rows.filter((row) => String(row.time) <= TICK_SESSION_END).reduce((sum, row) => sum + Number(row.amount), 0);
    if (after.amount === before.amount && Math.abs(continuousAmount - before.amount) > before.amount * 0.001 + 1000)
        throw sourceError(`Tencent ticks ${symbol} amount ${continuousAmount} does not match quote ${before.amount}`, 'tencent_incomplete');
    return {
        data: { date: before.date, code: code.canonical, tencent_symbol: symbol, rows, missing_seq: missingSeq },
        schema: ticksOutput,
    };
}
/**
 * 港美股快照与 A 股快照**不能共用一份字段表**：实测腾讯在同一个 `~` 分隔串里换了列位——
 * 币种 A 股根本没有、港股在第 75 位、美股在第 35 位；换手率港股在第 59 位（分母是**总股本**）、
 * 美股在第 38 位（分母是**流通股本**）；成交额在港股**指数行**是万元级而个股行是元级。
 * 所以两张表各自映射（都在 `tencent-public-core.ts`，host 半边与这里共用），
 * 并且只收能用算术或量级证明的列（§10.2：口径猜错就是话说错）。
 */
function normalizeOffshoreCodes(params, name, perCode) {
    if (!isRecord(params))
        throw new Error('params must be an object');
    const rawValues = Array.isArray(params.codes) ? params.codes : typeof params.codes === 'string' ? params.codes.split(',').map((item) => item.trim()).filter(Boolean) : undefined;
    if (!rawValues || rawValues.length === 0)
        throw new Error(`parameter ${name} must contain at least one code`);
    if (rawValues.length > 50)
        throw new Error(`parameter ${name} accepts at most 50 codes`);
    const symbols = [];
    for (const item of rawValues) {
        const symbol = perCode(item, name);
        if (!symbols.includes(symbol))
            symbols.push(symbol);
    }
    return { codes: symbols };
}
async function executeOffshoreQuote(params, signal, market) {
    // 取数编排（含美股"没回行就剥一段后缀重问"）在内核里，与自选股面板共用一份。
    const rows = await fetchOffshoreQuotes(market, params.codes, signal);
    return { data: rows, schema: market === 'hk' ? hkQuoteOutput : usQuoteOutput };
}
async function executeOffshoreIndexQuote(params, signal, market) {
    // 指数只收点位那一族可证明的列；写法来自检索，身份形状由内核核对（猜写法会静默拿到别的标的）。
    const rows = await fetchOffshoreIndexQuotes(market, params.codes, signal);
    return { data: rows, schema: market === 'hk' ? hkIndexQuoteOutput : usIndexQuoteOutput };
}
const offshoreKlinePaths = {
    hk: { qfq: '/appstock/app/hkfqkline/get', hfq: '/appstock/app/hkfqkline/get', none: '/appstock/app/kline/kline' },
    us: { qfq: '/appstock/app/usfqkline/get', none: '/appstock/app/kline/kline' },
};
/** 港美股 K 线入口：主机轮换全部走 `callKlineHosts`（一份实现），这里只补"序列在哪个 symbol 的哪个键下"。 */
async function callOffshoreKline(path, param, symbol, signal) {
    const data = await callKlineHosts({
        path,
        param,
        label: `${symbol} K-line`,
        isEmpty: (node) => {
            const candidate = isRecord(node) ? node[symbol] : undefined;
            return !isRecord(candidate) || Object.keys(candidate).find((key) => Array.isArray(candidate[key])) === undefined;
        },
        isParamRejection: (payload) => /param/i.test(String(payload.msg ?? '')) || Number(payload.code) === 1 || Number(payload.code) === 11,
    }, signal);
    const node = data[symbol];
    if (!isRecord(node))
        throw sourceError(`Tencent K-line ${symbol} response has no symbol node`, 'tencent_invalid_response');
    const key = Object.keys(node).find((candidate) => Array.isArray(node[candidate]));
    if (key === undefined)
        throw sourceError(`Tencent K-line ${symbol} response has no series array`, 'tencent_invalid_response');
    return node[key];
}
/** K 线行：`[日期, 开, 收, 高, 低, 量, …]`——与 A 股同一套位序，第 6 位是上游附带的回购/分红文本。 */
function parseOffshoreKlineRows(items, canonical, tencentSymbol, period, adjust, market) {
    const rows = [];
    for (const item of items) {
        if (!Array.isArray(item) || item.length < 6)
            throw sourceError(`Tencent ${market} K-line ${tencentSymbol} row shape changed`, 'tencent_invalid_response');
        const date = String(item[0]);
        // 只匹配 `\d{4}-\d{2}-\d{2}` 会把 2026-13-99 这样的假日期放过去，所以要按真历法回读一次。
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (() => { const parsed = new Date(`${date}T00:00:00Z`); return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date; })()) {
            throw sourceError(`Tencent ${market} K-line ${tencentSymbol} has unreadable date ${JSON.stringify(date)}`, 'tencent_invalid_response');
        }
        const open = requiredNumber(item[1], 'open');
        const close = requiredNumber(item[2], 'close');
        const high = requiredNumber(item[3], 'high');
        const low = requiredNumber(item[4], 'low');
        const volume = requiredNumber(item[5], 'volume');
        if (open <= 0 || close <= 0 || high <= 0 || low <= 0 || high < low)
            throw sourceError(`Tencent ${market} K-line ${tencentSymbol} ${date} has an impossible price range`, 'tencent_invalid_response');
        const row = {
            code: canonical,
            tencent_symbol: tencentSymbol,
            adjust,
            period,
            date,
            open,
            high,
            low,
            close,
            volume,
        };
        if (market === 'hk') {
            // 港股复权序列多回两列（第 7/8 位）；实测不复权序列只有七列，这两处就是 null。
            row.turnover_pct = item.length > 7 ? numberOrNull(item[7]) : null;
            row.amount_wan_hkd = item.length > 8 ? numberOrNull(item[8]) : null;
        }
        rows.push(row);
    }
    if (rows.length === 0)
        throw sourceError(`Tencent ${market} K-line ${tencentSymbol} returned no rows`, 'tencent_empty_response');
    return rows;
}
function normalizeOffshoreKline(params, market) {
    if (!isRecord(params))
        throw new Error('params must be an object');
    // start/end 进 allowed 只为了给出**可用**的拒绝理由：默默忽略日期是最坏的一种失败（调用方以为过滤过了）。
    assertKnown(params, ['code', 'period', 'adjust', 'count', 'start', 'end']);
    if (params.start !== undefined || params.end !== undefined)
        throw new Error('start/end are not supported: 实测 hkfqkline 忽略日期区间（带 2024-01-01..2024-03-01 与 count=640 仍回 640 条、最早到 2021-07-30），只有 count 生效');
    const code = market === 'hk' ? normalizeHkCode(params.code, 'code') : normalizeUsCode(params.code, 'code');
    const period = params.period === undefined ? 'day' : String(params.period).toLowerCase();
    if (!['day', 'week', 'month'].includes(period))
        throw new Error('parameter period must be day, week or month (腾讯港美股入口没有分钟线：实测 hk 的 mkline 连接失败、proxy 侧回 code -1)');
    const adjust = params.adjust === undefined ? 'qfq' : String(params.adjust).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(offshoreKlinePaths[market], adjust)) {
        throw new Error(market === 'us'
            ? 'parameter adjust must be qfq or none for US K-lines (实测 usfqkline 把 hfq 请求映射成与不复权完全相同的价格序列，我们不承诺一个给不出后复权的入口)'
            : `parameter adjust ${adjust} is not available for HK K-lines (实测 hk 端点空 adjust 回 bad params，只有 qfq/hfq 与不带复权的 kline/kline 两条)`);
    }
    const count = params.count === undefined ? 320 : integer(params.count, 'count', 1, 640);
    return { code, period, adjust, count };
}
async function executeOffshoreKline(params, signal, market) {
    const code = String(params.code);
    const period = String(params.period);
    const adjust = String(params.adjust);
    const count = Number(params.count);
    // K 线的 symbol 身份：港股就是 hk+5 位；美股必须带交易所后缀，且后缀由快照回答。
    const tencentSymbol = market === 'hk' ? `hk${code}` : await resolveUsKlineSymbol(code, signal);
    const canonical = market === 'hk' ? code : tencentSymbol.slice(2);
    const path = offshoreKlinePaths[market][adjust];
    const param = `${tencentSymbol},${period},,,${count},${adjust === 'none' ? '' : adjust}`;
    const items = await callOffshoreKline(path, param, tencentSymbol, signal);
    return { data: parseOffshoreKlineRows(items, canonical, tencentSymbol, period, adjust, market), schema: market === 'hk' ? hkKlineOutput : usKlineOutput };
}
const hkQuoteOutput = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            code: { type: 'string' }, tencent_symbol: { type: 'string' }, name: { type: 'string' },
            english_name: { type: 'string' }, currency: { type: 'string' },
            price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            last_close: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            open: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            high: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            low: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            change_amt: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            amplitude_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            volume_shares: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '成交量（股，不是手）' },
            amount_hkd: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '成交额（港元，元级）' },
            avg_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            turnover_pct: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '换手率（百分数原值），分母是总股本' },
            total_shares: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            market_cap_yi_hkd: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '总市值（**亿港元**）= 总股本 × 现价 ÷ 1e8；上游没有流通口径' },
            board_lot_shares: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '每手股数（实测腾讯 100、汇丰 400）' },
            quote_time: { type: 'string' },
            is_stale: { type: 'boolean' },
            stale_reason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        },
        additionalProperties: true,
    },
};
const usQuoteOutput = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            code: { type: 'string' }, tencent_symbol: { type: 'string' }, exchange_code: { type: 'string' },
            name: { type: 'string' }, english_name: { type: 'string' }, currency: { type: 'string' },
            price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            last_close: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            open: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            high: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            low: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            change_amt: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            amplitude_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            volume_shares: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '成交量（股，不是手）' },
            amount_usd: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '成交额（美元，元级）' },
            avg_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            turnover_pct: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '换手率（百分数原值），分母是总股本（不是流通股本）' },
            total_shares: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            float_shares: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            float_market_cap_yi_usd: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '流通市值（**亿美元**）= 流通股本 × 现价 ÷ 1e8' },
            market_cap_yi_usd: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '总市值（**亿美元**）= 总股本 × 现价 ÷ 1e8' },
            quote_time: { type: 'string' },
            is_stale: { type: 'boolean' },
            stale_reason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        },
        additionalProperties: true,
    },
};
/**
 * 港美股**指数**快照的输出表：只有点位那一族，且**刻意不收**任何量纲列与币种列。
 *
 * 为什么不收（2026-10-07 真报文）：港股指数行的第 6 / 36 / 37 位两列相等且量级像万元，
 * 美股指数行的第 37 位给了 2.1e14、第 38 / 44 / 45 / 62 / 63 位为空——口径推不出来，
 * 声明一列我们没有把握的东西比少给一列更糟（docs/dev/tool-schema.md §10.2）。
 * 为什么不收币种：上游确实在第 75 / 35 位塞了 `HKD` / `USD`，但指数是无量纲的数。
 */
const offshoreIndexQuoteProperties = (symbolLabel) => ({
    code: { type: 'string' },
    tencent_symbol: { type: 'string' },
    name: { type: 'string' },
    english_name: { type: 'string' },
    price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    last_close: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    open: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    high: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    low: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    change_amt: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '涨跌百分比原值（点位变化 ÷ 前收，与个股同一口径）' },
    amplitude_pct: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '振幅（百分数原值）=（最高 − 最低）÷ 前收' },
    quote_time: { type: 'string', description: `${symbolLabel}当地时间，不是北京时间` },
});
const hkIndexQuoteOutput = {
    type: 'array',
    items: { type: 'object', properties: offshoreIndexQuoteProperties('香港'), additionalProperties: true },
};
const usIndexQuoteOutput = {
    type: 'array',
    items: { type: 'object', properties: offshoreIndexQuoteProperties('美东'), additionalProperties: true },
};
/** 港美股 K 线的公共列：`[日期, 开, 收, 高, 低, 量]`，量纲是**股**。 */
const offshoreKlineProperties = () => ({
    code: { type: 'string' }, tencent_symbol: { type: 'string' }, adjust: { type: 'string' },
    period: { type: 'string' }, date: { type: 'string' },
    open: { type: 'number' }, high: { type: 'number' }, low: { type: 'number' }, close: { type: 'number' },
    volume: { type: 'number', description: '成交量（股）；不是 A 股 K 线那套"手"' },
});
// 只有**港股复权序列**多回两列，而其中成交额是**万港元**（实测腾讯 2026-10-05 给 366,702.882，
// 当日快照给 3,667,028,820.9 港元，差整整 1e4）。美股的两个可用入口（qfq / none）实测都只回六列，
// 所以美股这张表**没有** amount 字段——不声明一列恒为 null 的东西，那只会让人以为是缺数。
const hkKlineOutput = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            ...offshoreKlineProperties(),
            turnover_pct: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '当日换手率（百分数原值，分母是总股本）；不复权序列为 null' },
            amount_wan_hkd: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '成交额（万港元，不是港元）；不复权序列为 null' },
        },
        additionalProperties: true,
    },
};
const usKlineOutput = { type: 'array', items: { type: 'object', properties: offshoreKlineProperties(), additionalProperties: true } };
function createSource(options) {
    const schema = {
        capability: options.capability,
        time_contract: getDataTimeContract(options.capability),
        name: options.name,
        source: `http:tencent.${options.capability}`,
        data_key: buildDataKey('tencent', 'http', options.capability),
        source_label: 'tencent',
        paginated: options.paginated === true,
        cacheMaxAgeMs: options.cacheMaxAgeMs,
        ...(options.rowShape === undefined ? {} : { rowShape: options.rowShape }),
        summary: options.summary,
        description: options.description,
        input_schema: options.inputSchema,
        output_schema: options.outputSchema,
    };
    const normalize = (params) => {
        if (!isRecord(params))
            throw new Error('params must be an object');
        assertKnown(params, options.allowed);
        return options.normalize(params);
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => {
            if (options.capability === 'tencent_ticks')
                return isRecord(data) && Array.isArray(data.rows);
            return Array.isArray(data) && data.length > 0;
        },
        execute: async (request, signal) => options.execute(normalize(request.params), signal),
    };
}
export function createTencentSources() {
    return [
        createSource({
            capability: 'tencent_quote',
            cacheMaxAgeMs: 60_000,
            name: 'get_tencent_quote',
            summary: '腾讯实时行情、估值、涨跌停和 ETF 快照',
            description: '批量获取 SH/SZ 股票、指数或 ETF 的腾讯实时快照。输入 codes 为完整证券代码数组（如 600519.SH、000001.SZ、000001.SH、510300.SH），返回保留腾讯字段语义的行数组：价格、涨跌、成交额（万元）、换手率、PE/PB、市值和涨跌停价。44 为流通市值、45 为总市值；43 为振幅，不是 PB。腾讯返回成交额为 0 且最新价等于昨收时标记 is_stale=true，不把它当作当日有效成交。BJ 代码当前明确拒绝。',
            inputSchema: { type: 'object', properties: { codes: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', description: '完整证券代码，如 600519.SH' } } }, required: ['codes'], additionalProperties: false },
            outputSchema: quoteOutput,
            paginated: false,
            rowShape: { rootArray: true },
            allowed: ['codes'],
            normalize: normalizeQuote,
            execute: executeQuote,
        }),
        createSource({
            capability: 'tencent_kline',
            cacheMaxAgeMs: 60_000,
            name: 'get_tencent_kline',
            summary: '腾讯日周月复权和分钟 K 线',
            description: '获取单只 SH/SZ 股票、指数或 ETF 的腾讯 K 线。period 为 day/week/month 或 m1/m5/m15/m30/m60；日周月可用 qfq/hfq/none，分钟线只能 none；start/end 仅日周月支持 YYYY-MM-DD，count 日周月最多 640、分钟最多 320。volume 单位为手，腾讯 K 线不提供成交额；分钟返回 turnover_rate_pct，腾讯原始字段为基点后除以 100。内部会按参考 skill 的三个腾讯入口轮换，但不把入口拆成 capability。BJ 代码明确拒绝。',
            inputSchema: { type: 'object', properties: { code: { type: 'string', description: '单只完整证券代码，如 600519.SH' }, period: { type: 'string', enum: ['day', 'week', 'month', 'm1', 'm5', 'm15', 'm30', 'm60'] }, adjust: { type: 'string', enum: ['qfq', 'hfq', 'none'] }, start: { type: 'string', description: '日/周/月起始日期 YYYY-MM-DD' }, end: { type: 'string', description: '日/周/月结束日期 YYYY-MM-DD' }, count: { type: 'integer', minimum: 1, maximum: 640 } }, required: ['code'], additionalProperties: false },
            outputSchema: klineOutput,
            paginated: false,
            rowShape: { rootArray: true },
            allowed: ['code', 'period', 'adjust', 'start', 'end', 'count'],
            normalize: normalizeKline,
            execute: executeKline,
        }),
        createSource({
            capability: 'tencent_ticks',
            name: 'get_tencent_ticks',
            summary: '腾讯最近交易日分笔成交明细',
            description: '获取单只 SH/SZ 股票或 ETF 最近一个交易日的腾讯分笔成交。不是 Level-2 逐笔委托；约 3 秒一笔，volume 单位为手、amount 单位为元，side 为 B/S/M。只有最近交易日，不支持历史、BJ 或指数。收盘后会将连续竞价段成交额与腾讯行情快照核对；缺失的盘后序号写入 missing_seq，连续竞价缺号或成交额不一致会失败。',
            inputSchema: { type: 'object', properties: { code: { type: 'string', description: '单只股票或 ETF 完整代码，如 000001.SZ 或 510300.SH' } }, required: ['code'], additionalProperties: false },
            outputSchema: ticksOutput,
            paginated: false,
            rowShape: { rowKey: 'rows' },
            allowed: ['code'],
            normalize: normalizeTicks,
            execute: executeTicks,
        }),
        createSource({
            capability: 'tencent_hk_quote',
            cacheMaxAgeMs: 60_000,
            name: 'get_tencent_hk_quote',
            summary: '腾讯港股实时快照（港元，无涨跌停）',
            description: '批量获取香港个股的腾讯快照（一次最多 50 只）。代码是**五位数字**（00700，也接受 700 / hk00700 / 00700.HK，内部左补零——实测上游对不补零的 hk700、hk0700 直接不回行）。⛔ 不接受恒生系指数（HSI/HSTECH 一类字母代码）：实测指数行的第 6/37 位与个股不同量纲（hkHSI 两列相等且是万元级，个股是"股"与"港元"），两种单位不许进同一列。currency 回 HKD；price / amount_hkd 是**港元（元级）**；market_cap_yi_hkd 是**亿港元**（实测等于 total_shares × price ÷ 1e8，腾讯 9,092,605,595 × 423 对 38,461.7217）。⛔ **港股没有涨跌停**，本表不提供 limit_up / limit_down，也不要拿 A 股那套规则推断。turnover_pct 的分母是**总股本**（实测 8,709,438 / 9,092,605,595 = 0.096% ≈ 给的 0.10），与美股口径不同。上游 44/45 两列实测恒等（都由总股本×现价得出），所以只给一个市值数，不许当成流通市值。avg_price = amount_hkd ÷ volume_shares（实测逐位相符）。board_lot_shares 是每手股数（实测腾讯 100、汇丰 400）。quote_time 是**交易所当地时间（HKT）**，不是北京时间。快照的 52 周高低两列与日线序列对不上（实测腾讯给 677.2/411 而近 252 个交易日是 683/411；汇丰给 168.916/94.532 而实际 169.7/100.4），窗口口径推不出来，**故不收录**——要区间高低请用 tencent_hk_kline 自己算；PE / PB / 股息率一类的其余列同样因口径未核验而不收录。不存在的代码（实测 hk99999）会被上游静默丢弃：返回行数少于请求行数就是那几个代码不存在或已退市，不是取数失败。成交额为 0 且现价等于昨收时标 is_stale=true（半日市与休市日会命中），不当作当日有效成交。',
            inputSchema: { type: 'object', properties: { codes: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', description: '港股代码，如 00700 或 hk00700' } } }, required: ['codes'], additionalProperties: false },
            outputSchema: hkQuoteOutput,
            paginated: false,
            rowShape: { rootArray: true },
            allowed: ['codes'],
            normalize: (params) => normalizeOffshoreCodes(params, 'codes', normalizeHkCode),
            execute: (params, signal) => executeOffshoreQuote(params, signal, 'hk'),
        }),
        createSource({
            capability: 'tencent_us_quote',
            cacheMaxAgeMs: 60_000,
            name: 'get_tencent_us_quote',
            summary: '腾讯美股快照（美元，交易所当地时间）',
            description: '批量获取美股与在美上市 ADR 的腾讯快照（一次最多 50 只）。代码是字母 ticker（BRK.B 这类带点的级别码可用）。⛔ 写法上有两点是实测出来的：腾讯**快照只认不带交易所后缀的形式**（`usBABA.N` 整行不回、`usBABA` 回），所以两位以上的尾段（.OQ/.AM/.NS）在参数层直接剥掉；**单字母尾段分不清是级别码还是交易所码**（BRK.B 与 BABA.N 都是真实写法），就照原样先问一次、没回行再剥一段重问——猜错只多一轮请求，猜错第二次才是把数据挂到别的标的上。currency 回 USD，price / amount_usd 是**美元（元级）**，float_market_cap_yi_usd 与 market_cap_yi_usd 是**亿美元**（实测两列分别等于流通股本 / 总股本 × 现价 ÷ 1e8：苹果 14,585,108,878 → 48,669.05、14,594,180,000 → 48,699.32）。code 回上游给的带后缀身份（AAPL.OQ / BABA.N），exchange_code 单列后缀（实测只出现 OQ 与 N，是腾讯自有交易所编码，本表不翻译）。⛔ **这不是实时撮合价**：实测 2026-10-05（周一）北京清早取到的最新成交时间是 2026-10-02 16:00:01，收盘后不给新数；腾讯在 K 线响应内嵌的行情节点 0 号位标 `delay`。quote_time 是**交易所当地时间（美东）**，与北京时间差 12/13 小时，跨市场同日比较前先对齐。turnover_pct 的分母是**总股本**（实测 GOOGL 给 0.19 = 23,772,148 ÷ 12,229,934,831，BRK.B 给 0.20 = 4,193,461 ÷ 2,140,709,794；按流通股本算是 0.41 与 0.34，对不上——多级股票类别下两个分母能差一倍，苹果与阿里因为两者接近所以看不出区别）。avg_price = amount_usd ÷ volume_shares（实测 11,087,245,013 / 33,278,552 = 333.16 相符）。美股无涨跌停，不提供相关列。52 周高低两列口径与日线序列对不上（实测苹果 345.34/242.76，近 252 个交易日是 345.34/243.42），**不收录**；PE/PB 一类列因口径未核验同样不收录。盘前盘后行情本表不透出（实测只出现在 K 线响应的 pandata 节点）。不认识的 ticker 被上游静默丢弃，行数少于请求数即那几个代码无效。成交额为 0 且现价等于昨收时标 is_stale=true。',
            inputSchema: { type: 'object', properties: { codes: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', description: '美股 ticker，如 AAPL 或 BRK.B' } } }, required: ['codes'], additionalProperties: false },
            outputSchema: usQuoteOutput,
            paginated: false,
            rowShape: { rootArray: true },
            allowed: ['codes'],
            normalize: (params) => normalizeOffshoreCodes(params, 'codes', normalizeUsCode),
            execute: (params, signal) => executeOffshoreQuote(params, signal, 'us'),
        }),
        createSource({
            capability: 'tencent_hk_index_quote',
            cacheMaxAgeMs: 60_000,
            name: 'get_tencent_hk_index_quote',
            summary: '腾讯港股指数实时点位（无量纲，不含成交与市值）',
            description: '批量获取港股**指数**的腾讯快照点位（一次最多 50 条）。代码是字母指数码，实测可用：HSI 恒生指数、HSTECH 恒生科技指数、HSCEI 国企指数、VHSI 恒指波动率指数（实测 24151.9 / 4184.74 / 8075.59 / 18.13，盘中逐秒在动）。⛔ **写法只能来自检索**（ticker_search 或自选股那一路），不许凭猜：猜错时上游可能静默回别的标的且不报错。⛔ 与 tencent_hk_quote 互斥——五位数字代码属于个股那一路，这里一律拒绝；个股表里也不接受字母指数，因为实测指数行的第 6/36/37 位两列相等且量级像万元，与个股的"股 / 港元"不是同一量纲。本表因此**只声明点位那一族可证明的列**：price / last_close / open / high / low / change_amt / change_pct / amplitude_pct / quote_time；成交量、成交额、换手率、市值**不收录**（口径推不出来，声明一列没把握的东西比少给一列更糟）。**也没有 currency 列**：上游在第 75 位确实给了 HKD，但指数点位是无量纲的数，给它标货币单位是替上游说话。quote_time 是**交易所当地时间（HKT）**。不标 is_stale——个股那条判据（成交额 0 且现价等于昨收）在指数行上不可用；要判断市场此刻开不开盘请看行情快照内嵌的市场状态或对照 tencent_*_quote 的个股行。不存在的代码被上游静默丢弃（实测 hkZVHSI 不回行），行数少于请求数即那几个代码无效，不是取数失败。',
            inputSchema: { type: 'object', properties: { codes: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', description: '港股指数代码，如 HSI 或 HSTECH' } } }, required: ['codes'], additionalProperties: false },
            outputSchema: hkIndexQuoteOutput,
            paginated: false,
            rowShape: { rootArray: true },
            allowed: ['codes'],
            normalize: (params) => normalizeOffshoreCodes(params, 'codes', (value, name) => normalizeOffshoreIndexCode(value, name, 'hk')),
            execute: (params, signal) => executeOffshoreIndexQuote(params, signal, 'hk'),
        }),
        createSource({
            capability: 'tencent_us_index_quote',
            cacheMaxAgeMs: 60_000,
            name: 'get_tencent_us_index_quote',
            summary: '腾讯美股指数点位（无量纲，收盘值为真值）',
            description: '批量获取美股**指数**的腾讯快照点位（一次最多 50 条）。请求写法是**不带前导点的字母码**，实测可用三只：IXIC 纳斯达克（回 .IXIC 27599.89）、DJI 道琼斯（回 .DJI 51521.28）、INX 标普500（回 .INX 7818.93）；返回的 code 已剥掉那个前导点（IXIC / DJI / INX），tencent_symbol 原样回显上游写法供核对。⛔ **标普500 在这里的写法是 INX，不是 SPX**：实测 usSPX / usNDQ / usSOX / usRUT 都不回行，而 usSSPX 会静默回一只 ETF（SSPX.AM，价 31.47）——所以写法必须来自检索，猜写法不仅可能拿不到数，还可能拿到**别人的**数且不报错；本能力靠回显形状（点号在开头）把 ETF 那一类挡在行外。⛔ 与 tencent_us_quote 互斥：AAPL / AAPL.OQ 这类个股写法（点号在中间）在这里一律拒绝。本表只声明点位那一族可证明的列，成交量 / 成交额 / 换手率 / 市值不收录（实测指数行第 37 位给了 2.1e14、第 38/44/45/62/63 位为空）；**也没有 currency 列**（上游第 35 位给了 USD，但点位无量纲）。⛔ **同批指数的 quote_time 彼此不同**：实测同一份响应里 IXIC 是 18:34:12、DJI 是 16:42:37、INX 是 16:40:07——指数的收盘值在各成分结算后才定，晚的时刻不是"更新的数据"。quote_time 是**交易所当地时间（美东）**，与北京时间差 12/13 小时，跨市场同日比较前先对齐。不标 is_stale（判据依赖的成交列在本表不可用）。不认识的代码被上游静默丢弃，行数少于请求数即那几个代码无效。',
            inputSchema: { type: 'object', properties: { codes: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', description: '美股指数代码，如 IXIC、DJI、INX（不带前导点）' } } }, required: ['codes'], additionalProperties: false },
            outputSchema: usIndexQuoteOutput,
            paginated: false,
            rowShape: { rootArray: true },
            allowed: ['codes'],
            normalize: (params) => normalizeOffshoreCodes(params, 'codes', (value, name) => normalizeOffshoreIndexCode(value, name, 'us')),
            execute: (params, signal) => executeOffshoreIndexQuote(params, signal, 'us'),
        }),
        createSource({
            capability: 'tencent_hk_kline',
            cacheMaxAgeMs: 60_000,
            name: 'get_tencent_hk_kline',
            summary: '腾讯港股日周月 K 线（成交量以股计）',
            description: '获取单只港股的腾讯日线/周线/月线。⛔ **没有分钟线**（实测 hk 走 mkline 连接失败、走 proxy 主机回 code -1），要港美股分时本能力覆盖不了。⛔ **不支持日期区间**：实测带 2024-01-01..2024-03-01 的 param 被上游忽略，返回仍是最近 640 条（最早到 2021-07-30），所以这里只有 count（1..640，默认 320），传 start/end 一律拒绝而不是静默忽略。adjust 默认 qfq，可用 qfq / hfq / none——none 不是"空着传"，实测 hkfqkline 空 adjust 回 bad params，不复权走另一个入口。volume 单位是**股**（实测腾讯 2026-10-05 给 8,709,438，与当日快照成交量逐位相同），不是 A 股 K 线那套"手"。turnover_pct 是当日换手率（实测成交量 ÷ 总股本相符）；amount_wan_hkd 是**万港元**（实测 366,702.882 万对快照 3,667,028,820.9 元，差整整 1e4）；不复权序列不给这两列（为 null）。行按上游顺序返回，日期畸形、价格非正或 high < low 一律 tencent_invalid_response，不补 0。指数代码不接受（与快照同一口径）。',
            inputSchema: { type: 'object', properties: { code: { type: 'string', description: '港股代码，如 00700' }, period: { type: 'string', enum: ['day', 'week', 'month'] }, adjust: { type: 'string', enum: ['qfq', 'hfq', 'none'] }, count: { type: 'integer', minimum: 1, maximum: 640 } }, required: ['code'], additionalProperties: false },
            outputSchema: hkKlineOutput,
            paginated: false,
            rowShape: { rootArray: true },
            allowed: ['code', 'period', 'adjust', 'count', 'start', 'end'],
            normalize: (params) => normalizeOffshoreKline(params, 'hk'),
            execute: (params, signal) => executeOffshoreKline(params, signal, 'hk'),
        }),
        createSource({
            capability: 'tencent_us_kline',
            cacheMaxAgeMs: 60_000,
            name: 'get_tencent_us_kline',
            summary: '腾讯美股日周月 K 线（前复权或不复权）',
            description: '获取单只美股（含 ADR）的腾讯日线/周线/月线。⛔ 没有分钟线，不接受指数；⛔ **不支持日期区间**（同港股：只有 count 1..640，默认 320，传 start/end 直接拒绝）。adjust 只接受 **qfq 与 none**：实测 hfq 请求会被上游映射成与不复权**完全相同**的价格序列（苹果 2025-06-26 hfq 给 201.43/201.00，与不复权逐位相同，而 qfq 给 200.46/200.04），所以本能力不提供 hfq——宁可不给，也不给一个名字骗人的序列。⛔ **美股 K 线只有 OHLCV**：实测 qfq 与 none 两个入口都只回六列，成交额与换手率在这里拿不到（多出来的列只出现在被本能力拒绝的 hfq 形态里，而 hfq 回的其实是不复权价格）——要美股成交额请走别的来源，行里也没有 amount / turnover 字段，不要当成缺数。K 线入口需要带交易所后缀的符号：实测裸 `usAAPL` 会回一列 2011 年起的陌生序列、`usAAPL.NS` 静默回 0 行，所以代码先由快照解析出真实后缀（AAPL.OQ）再打 K 线，每行的 tencent_symbol 原样回显解析结果供核对；ticker 认不出来时直接点名"腾讯不认识这个代码"。volume 单位是**股**；日期畸形、价格非正或 high < low 一律响亮失败。',
            inputSchema: { type: 'object', properties: { code: { type: 'string', description: '美股 ticker，如 AAPL 或 BRK.B' }, period: { type: 'string', enum: ['day', 'week', 'month'] }, adjust: { type: 'string', enum: ['qfq', 'none'] }, count: { type: 'integer', minimum: 1, maximum: 640 } }, required: ['code'], additionalProperties: false },
            outputSchema: usKlineOutput,
            paginated: false,
            rowShape: { rootArray: true },
            allowed: ['code', 'period', 'adjust', 'count', 'start', 'end'],
            normalize: (params) => normalizeOffshoreKline(params, 'us'),
            execute: (params, signal) => executeOffshoreKline(params, signal, 'us'),
        }),
    ];
}
