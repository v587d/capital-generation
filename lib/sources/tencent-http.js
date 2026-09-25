import { buildDataKey } from '../data-collector/hub.js';
import { getDataTimeContract } from '../time/tools.js';
import { createRequestThrottle } from '../net/throttle.js';
import { isLikelyIndex, normalizeSecurityCodes, parseSecurityCode, requireTencentSecurity } from './security-code.js';
const QUOTE_URL = 'https://qt.gtimg.cn/q=';
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
/**
 * 腾讯出口的**唯一**节流链（进程级）。三个端点都按 IP 风控（429 / 空 data / 静默限流），
 * 而模型一次并发多个 quote / kline 调用会把请求成倍打出去。此前只有 `tencent_ticks` 翻页里
 * 有一处 100ms 本地 sleep——并发调用各自 sleep，请求仍同时到达，等于没有 pacing；
 * 现在所有出口（行情、分笔每一页、K 线的每一次换机）都过这一条链，见 `src/net/throttle.ts`。
 * 间隔取 120ms：与原来翻页的节奏同量级，不会因为把风控间隔"调保守"而拖慢 300 页分笔下载。
 */
const TENCENT_MIN_INTERVAL_MS = 120;
const tencentThrottle = createRequestThrottle(TENCENT_MIN_INTERVAL_MS);
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
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function assertKnown(values, allowed) {
    for (const key of Object.keys(values))
        if (!allowed.includes(key))
            throw new Error(`unsupported parameter: ${key}`);
}
function numberOrNull(value) {
    if (value === undefined || value === null || value === '')
        return null;
    if (typeof value === 'boolean')
        throw new Error('source returned boolean where a number was expected');
    const number = typeof value === 'number' ? value : Number(String(value).replaceAll(',', '').trim());
    return Number.isFinite(number) ? number : null;
}
function requiredNumber(value, field) {
    const number = numberOrNull(value);
    if (number === null)
        throw new Error(`source returned an invalid ${field}`);
    return number;
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
function sourceError(message, code = 'tencent_source_error') {
    const error = new Error(message);
    error.code = code;
    return error;
}
async function readResponse(response, encoding) {
    const bytes = await response.arrayBuffer();
    return new TextDecoder(encoding).decode(bytes);
}
async function getText(url, signal, encoding = 'utf-8', init = {}) {
    // 取消不排队：队首那个请求挂住时，把这次取消塞进队列等于把它吞掉（docs/dev/web-retriever.md §4.2「取消原样抛出」）。
    signal.throwIfAborted();
    return tencentThrottle(async () => {
        const response = await fetch(url, {
            ...init,
            headers: { 'User-Agent': 'Mozilla/5.0', ...(init.headers ?? {}) },
            signal,
        });
        const text = await readResponse(response, encoding);
        if (!response.ok)
            throw sourceError(`Tencent HTTP ${response.status} for ${url}`, response.status === 429 ? 'tencent_rate_limit' : 'tencent_http_error');
        return text;
    });
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
async function callKline(path, param, signal) {
    const errors = [];
    for (const host of KLINE_HOSTS) {
        if ((hostDownUntil.get(host) ?? 0) > Date.now())
            continue;
        try {
            const url = `${host}${path}?param=${encodeURIComponent(param)}`;
            const payload = parseJson(await getText(url, signal), `K-line ${host}`);
            if (payload.msg === 'param error')
                throw new Error(`Tencent K-line parameter error: ${param}`);
            if (isRecord(payload.data) && Object.keys(payload.data).length > 0)
                return { data: payload.data, host };
            errors.push(`${host}: empty data`);
            hostDownUntil.set(host, Date.now() + HOST_COOLDOWN_MS);
        }
        catch (error) {
            // 取消原样抛出，**先于**一切拉黑/换机逻辑：一次用户取消或 Hub 超时不得把全部
            // K 线入口进程级拉黑，更不得降级成 `tencent_kline_unavailable`（docs/dev/web-retriever.md §4.2「取消原样抛出」）。
            if (error instanceof Error && error.name === 'AbortError')
                throw error;
            if (error instanceof Error && error.message.includes('parameter error'))
                throw error;
            errors.push(`${host}: ${error instanceof Error ? error.message : String(error)}`);
            hostDownUntil.set(host, Date.now() + HOST_COOLDOWN_MS);
        }
    }
    throw sourceError(`Tencent K-line endpoints unavailable: ${errors.join('; ')}`, 'tencent_kline_unavailable');
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
function createSource(options) {
    const schema = {
        capability: options.capability,
        time_contract: getDataTimeContract(options.capability),
        name: options.name,
        source: `http:tencent.${options.capability}`,
        data_key: buildDataKey('tencent', 'http', options.capability),
        source_label: 'tencent',
        paginated: options.paginated === true,
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
    ];
}
