import { buildDataKey } from '../data-collector/hub.js';
import { getDataTimeContract } from '../time/tools.js';
import { sharedEastmoneyClient, sharedEastmoneyThrottle, EastmoneyTransportError } from '../net/eastmoney-client.js';
import { normalizeEastmoneyAshareIdentity, normalizeEastmoneyBoardIdentity, normalizeEastmoneySecurityIdentity } from './security-identity.js';
const DATACENTER_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const CLIST_URL = 'https://push2.eastmoney.com/api/qt/clist/get';
const MAX_PAGE_SIZE = 500;
const EASTMONEY_UT = 'bd1d9ddb04089700cf9c27f6f7426281';
const BOARD_TYPES = ['industry', 'concept', 'region'];
const BOARD_FS = { industry: 'm:90+t:2', concept: 'm:90+t:3', region: 'm:90+t:1' };
const SORT_FIELDS = { change_pct: 'f3', main_net_inflow: 'f62', amount: 'f6' };
const GLOBAL_SYMBOLS = {
    SPX: { secid: '100.SPX', name: '标普500', market: 'us', currency: 'USD', unit: 'index_points', timeZone: 'America/New_York', volumeUnit: 'shares', amountUnit: null },
    NDX: { secid: '100.NDX', name: '纳斯达克100', market: 'us', currency: 'USD', unit: 'index_points', timeZone: 'America/New_York', volumeUnit: 'shares', amountUnit: null },
    DJIA: { secid: '100.DJIA', name: '道琼斯', market: 'us', currency: 'USD', unit: 'index_points', timeZone: 'America/New_York', volumeUnit: 'shares', amountUnit: null },
    HSI: { secid: '100.HSI', name: '恒生指数', market: 'hk', currency: 'HKD', unit: 'index_points', timeZone: 'Asia/Hong_Kong', volumeUnit: 'shares', amountUnit: 'HKD' },
    HSCEI: { secid: '100.HSCEI', name: '国企指数', market: 'hk', currency: 'HKD', unit: 'index_points', timeZone: 'Asia/Hong_Kong', volumeUnit: 'shares', amountUnit: 'HKD' },
    N225: { secid: '100.N225', name: '日经225', market: 'jp', currency: 'JPY', unit: 'index_points', timeZone: 'Asia/Tokyo', volumeUnit: 'shares', amountUnit: null },
    SXXP: { secid: '100.SXXP', name: '欧洲斯托克600', market: 'eu', currency: 'EUR', unit: 'index_points', timeZone: 'Europe/London', volumeUnit: 'shares', amountUnit: null },
    FCHI: { secid: '100.FCHI', name: '法国CAC40', market: 'eu', currency: 'EUR', unit: 'index_points', timeZone: 'Europe/Paris', volumeUnit: 'shares', amountUnit: null },
    FTSE: { secid: '100.FTSE', name: '英国富时100', market: 'eu', currency: 'GBP', unit: 'index_points', timeZone: 'Europe/London', volumeUnit: 'shares', amountUnit: null },
    AS51: { secid: '100.AS51', name: '澳大利亚标普200', market: 'au', currency: 'AUD', unit: 'index_points', timeZone: 'Australia/Sydney', volumeUnit: 'shares', amountUnit: null },
    HSAHP: { secid: '100.HSAHP', name: 'AH股溢价', market: 'cross', currency: null, unit: 'index_points', timeZone: 'Asia/Hong_Kong', volumeUnit: 'shares', amountUnit: null },
    UDI: { secid: '100.UDI', name: '美元指数', market: 'fx', currency: null, unit: 'index_points', timeZone: 'America/New_York', volumeUnit: null, amountUnit: null },
    USDCNH: { secid: '133.USDCNH', name: '美元兑离岸人民币', market: 'fx', currency: 'CNH', unit: 'CNH_per_USD', timeZone: 'Asia/Shanghai', volumeUnit: null, amountUnit: null },
    US10Y: { secid: '171.US10Y', name: '美国10年期国债收益率', market: 'rates', currency: null, unit: 'percent', timeZone: 'America/New_York', volumeUnit: null, amountUnit: null },
    US2Y: { secid: '171.US2Y', name: '美国2年期国债收益率', market: 'rates', currency: null, unit: 'percent', timeZone: 'America/New_York', volumeUnit: null, amountUnit: null },
    CL00Y: { secid: '102.CL00Y', name: 'NYMEX原油', market: 'commodity', currency: 'USD', unit: 'USD_per_bbl', timeZone: 'America/New_York', volumeUnit: 'contracts', amountUnit: null },
    GC00Y: { secid: '101.GC00Y', name: 'COMEX黄金', market: 'commodity', currency: 'USD', unit: 'USD_per_oz', timeZone: 'America/New_York', volumeUnit: 'contracts', amountUnit: null },
    HG00Y: { secid: '101.HG00Y', name: 'COMEX铜', market: 'commodity', currency: 'USD', unit: 'USD_per_lb', timeZone: 'America/New_York', volumeUnit: 'contracts', amountUnit: null },
};
const GLOBAL_SYMBOL_NAMES = Object.keys(GLOBAL_SYMBOLS);
const GLOBAL_PERIODS = { day: 101, week: 102, month: 103 };
const MARKET_MARGIN_FILTER = { sse: '(SCDM="007")', szse: '(SCDM="001")', bse: '(SCDM="002")' };
const MARKET_MARGIN_CODE = { '007': 'sse', '001': 'szse', '002': 'bse' };
const topBuySellRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, ticker: { type: 'string' }, name: { type: 'string' }, market: { type: 'string' },
        trade_date: { type: 'string' }, trade_date_ms: { type: 'integer' }, close_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] }, turnover_rate_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        billboard_buy_amt: { oneOf: [{ type: 'number' }, { type: 'null' }] }, billboard_sell_amt: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        billboard_net_amt: { oneOf: [{ type: 'number' }, { type: 'null' }] }, billboard_deal_amt: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        deal_amount_ratio_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] }, deal_net_ratio_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        market_deal_amt: { oneOf: [{ type: 'number' }, { type: 'null' }] }, free_market_cap: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        explanation: { oneOf: [{ type: 'string' }, { type: 'null' }] }, explain: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_market: { oneOf: [{ type: 'string' }, { type: 'null' }] }, trade_id: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        eastmoney_code: { type: 'string' }, eastmoney_market: { type: 'string' },
    },
    additionalProperties: true,
};
const datacenterOutput = (row) => ({
    type: 'object',
    properties: {
        item: { type: 'array', items: row },
        pagination: {
            type: 'object',
            properties: { page: { type: 'integer' }, size: { type: 'integer' }, pages: { type: 'integer' }, total: { type: 'integer' } },
            required: ['page', 'size', 'pages', 'total'], additionalProperties: false,
        },
    },
    required: ['item', 'pagination'],
    additionalProperties: true,
});
const nullableNumber = { oneOf: [{ type: 'number' }, { type: 'null' }] };
const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] };
const globalQuoteRow = {
    type: 'object',
    properties: {
        symbol: { type: 'string' }, eastmoney_code: nullableString, eastmoney_market: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        name: { type: 'string' }, market: { type: 'string' }, currency: nullableString, unit: { type: 'string' },
        price: nullableNumber, prev_close: nullableNumber, change_amt: nullableNumber, change_pct: nullableNumber,
        open: nullableNumber, high: nullableNumber, low: nullableNumber,
        volume: nullableNumber, volume_unit: nullableString, amount: nullableNumber, amount_unit: nullableString,
        quote_time: nullableString, quote_time_utc: nullableString, quote_time_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        quote_time_zone: { type: 'string' }, is_delayed: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
        available: { type: 'boolean' }, reason: nullableString, source: { type: 'string' },
    },
    required: ['symbol', 'name', 'market', 'unit', 'quote_time_zone', 'available', 'source'],
    additionalProperties: false,
};
const globalKlineRow = {
    type: 'object',
    properties: {
        symbol: { type: 'string' }, name: { type: 'string' }, market: { type: 'string' }, currency: nullableString, unit: { type: 'string' },
        trade_date: { type: 'string' }, open: { type: 'number' }, high: { type: 'number' }, low: { type: 'number' }, close: { type: 'number' },
        volume: nullableNumber, volume_unit: nullableString, amount: nullableNumber, amount_unit: nullableString,
        change_pct: nullableNumber, amplitude_pct: nullableNumber, source: { type: 'string' },
    },
    required: ['symbol', 'name', 'market', 'unit', 'trade_date', 'open', 'high', 'low', 'close', 'source'],
    additionalProperties: false,
};
const marketMarginRow = {
    type: 'object',
    properties: {
        trade_date: { type: 'string' }, trade_date_ms: { type: 'integer' },
        market: { type: 'string' }, market_label: nullableString, eastmoney_market_code: { type: 'string' },
        margin_balance: nullableNumber, short_balance: nullableNumber, total_balance: nullableNumber,
        margin_buy: nullableNumber, margin_repay: nullableNumber, margin_net_buy: nullableNumber,
        short_balance_volume: nullableNumber, short_sell_volume: nullableNumber,
        short_repay_volume: nullableNumber, short_net_buy_volume: nullableNumber,
        float_market_cap: nullableNumber, margin_balance_pct: nullableNumber, source: { type: 'string' },
    },
    required: ['trade_date', 'market', 'source'],
    additionalProperties: false,
};
const lockupRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, ticker: { type: 'string' }, name: { type: 'string' },
        free_date: { type: 'string' }, free_date_ms: { type: 'integer' }, free_shares_type: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        free_shares_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] }, total_ratio: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        non_free_shares_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] }, able_free_shares_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        eastmoney_code: { type: 'string' }, eastmoney_market: { type: 'string' },
    },
    additionalProperties: true,
};
const sectorRow = {
    type: 'object',
    properties: {
        board_code: { type: 'string' }, board_name: { type: 'string' }, board_type: { enum: [...BOARD_TYPES] },
        last_price: { oneOf: [{ type: 'number' }, { type: 'null' }] }, change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        change_amount: { oneOf: [{ type: 'number' }, { type: 'null' }] }, volume: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        amount: { oneOf: [{ type: 'number' }, { type: 'null' }] }, amplitude_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        turnover_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] }, pe: { oneOf: [{ type: 'number' }, { type: 'null' }] }, pb: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        eastmoney_server_time: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    },
    additionalProperties: true,
};
const cashflowRow = {
    ...sectorRow,
    properties: {
        ...sectorRow.properties,
        main_net_inflow: { oneOf: [{ type: 'number' }, { type: 'null' }] }, main_net_inflow_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        super_large_net_inflow: { oneOf: [{ type: 'number' }, { type: 'null' }] }, super_large_net_inflow_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        large_net_inflow: { oneOf: [{ type: 'number' }, { type: 'null' }] }, large_net_inflow_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        medium_net_inflow: { oneOf: [{ type: 'number' }, { type: 'null' }] }, medium_net_inflow_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        small_net_inflow: { oneOf: [{ type: 'number' }, { type: 'null' }] }, small_net_inflow_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
};
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function assertKnown(params, allowed) { for (const key of Object.keys(params))
    if (!allowed.includes(key))
        throw new Error(`unsupported parameter: ${key}`); }
function numberOrNull(value) {
    if (value === undefined || value === null || value === '')
        return null;
    const parsed = typeof value === 'number' ? value : Number(String(value).replaceAll(',', '').trim());
    return Number.isFinite(parsed) ? parsed : null;
}
function rounded(value, digits = 4) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
function integer(value, name, min, max) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
        throw new Error(`${name} must be an integer from ${min} to ${max}`);
    return value;
}
function date(value, name) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new Error(`${name} must be YYYY-MM-DD`);
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
        throw new Error(`${name} must be a valid YYYY-MM-DD date`);
    return value;
}
function dateMs(value) { return Date.parse(`${value}T00:00:00+08:00`); }
function textOrNull(value) { return value === undefined || value === null || value === '' ? null : String(value); }
function sourceError(message, code = 'eastmoney_source_error') { const error = new Error(message); error.code = code; return error; }
/**
 * All Eastmoney calls use the process-wide client. Limits are per egress IP (>5/s, >=200/min,
 * >=300/5min bans); two throttles mean no throttle. Error codes stay unchanged.
 */
async function getJson(url, signal, context) {
    let payload;
    try {
        payload = await sharedEastmoneyClient().fetchJson(url, { signal });
    }
    catch (error) {
        if (error instanceof Error && error.name === 'AbortError')
            throw error;
        const status = error instanceof EastmoneyTransportError ? error.status : undefined;
        throw sourceError(status === undefined
            ? `Eastmoney request failed for ${context}: ${error instanceof Error ? error.message : String(error)}`
            : `Eastmoney HTTP ${status} for ${context}`, status === 429 ? 'eastmoney_rate_limit' : 'eastmoney_http_error');
    }
    if (!isRecord(payload))
        throw sourceError(`Eastmoney ${context} returned a non-object response`, 'eastmoney_invalid_response');
    return payload;
}
function requireDatacenterResult(payload, context) {
    // code 9201 = empty result (holiday/no records), a real data gap; treating it as a failure invites retries.
    if (payload.success !== true && Number(payload.code) === 9201)
        return { data: [], pages: 0, count: 0 };
    if (payload.success !== true || Number(payload.code) !== 0 || !isRecord(payload.result))
        throw sourceError(`Eastmoney ${context} failed: ${String(payload.message ?? 'unknown upstream error')} (code ${String(payload.code ?? 'unknown')})`, 'eastmoney_upstream_error');
    return payload.result;
}
function requireRows(result, context) {
    if (!Array.isArray(result.data) || typeof result.pages !== 'number' || typeof result.count !== 'number')
        throw sourceError(`Eastmoney ${context} result shape changed`, 'eastmoney_invalid_response');
    if (!result.data.every(isRecord))
        throw sourceError(`Eastmoney ${context} contains a non-object row`, 'eastmoney_invalid_response');
    return { rows: result.data, pages: result.pages, total: result.count };
}
function pagination(page, size, pages, total) { return { page, size, pages, total }; }
async function eastmoneyTickerExists(ticker, signal) {
    const identity = normalizeEastmoneySecurityIdentity({ secucode: ticker });
    const marketId = identity.eastmoney_market === 'SH' ? '1' : '0';
    const url = new URL('https://push2.eastmoney.com/api/qt/stock/get');
    url.searchParams.set('secid', `${marketId}.${identity.ticker}`);
    url.searchParams.set('fields', 'f57,f58,f107');
    const payload = await getJson(url.toString(), signal, 'ticker metadata');
    return Number(payload.rc) === 0 && isRecord(payload.data)
        && String(payload.data.f57 ?? '') === identity.ticker
        && typeof payload.data.f58 === 'string'
        && String(payload.data.f58).trim().length > 0;
}
function normalizeDateRange(params, allowed) {
    assertKnown(params, allowed);
    const start_date = date(params.start_date, 'start_date');
    const end_date = date(params.end_date, 'end_date');
    if (start_date > end_date)
        throw new Error('start_date must not be later than end_date');
    const page = params.page === undefined ? 1 : integer(params.page, 'page', 1, Number.MAX_SAFE_INTEGER);
    const size = params.size === undefined ? 100 : integer(params.size, 'size', 1, MAX_PAGE_SIZE);
    return { start_date, end_date, page, size };
}
function normalizeTicker(params) {
    assertKnown(params, ['start_date', 'end_date', 'ticker', 'page', 'size']);
    const normalized = normalizeDateRange(params, ['start_date', 'end_date', 'page', 'size', 'ticker']);
    const identity = normalizeEastmoneySecurityIdentity({ secucode: params.ticker });
    return { ...normalized, ticker: identity.thscode };
}
function normalizeBoard(params) {
    assertKnown(params, ['board_type', 'sort_field', 'page', 'size']);
    const board_type = params.board_type === undefined ? 'industry' : String(params.board_type).toLowerCase();
    if (!BOARD_TYPES.includes(board_type))
        throw new Error(`board_type must be one of ${BOARD_TYPES.join(', ')}`);
    const sort_field = params.sort_field === undefined ? 'change_pct' : String(params.sort_field).toLowerCase();
    if (!(sort_field in SORT_FIELDS))
        throw new Error(`sort_field must be one of ${Object.keys(SORT_FIELDS).join(', ')}`);
    const page = params.page === undefined ? 1 : integer(params.page, 'page', 1, Number.MAX_SAFE_INTEGER);
    const size = params.size === undefined ? 100 : integer(params.size, 'size', 1, MAX_PAGE_SIZE);
    return { board_type, sort_field, page, size };
}
function normalizeCashflowBoard(params) {
    assertKnown(params, ['board_type', 'page', 'size']);
    const board_type = params.board_type === undefined ? 'industry' : String(params.board_type).toLowerCase();
    if (!BOARD_TYPES.includes(board_type))
        throw new Error(`board_type must be one of ${BOARD_TYPES.join(', ')}`);
    const page = params.page === undefined ? 1 : integer(params.page, 'page', 1, Number.MAX_SAFE_INTEGER);
    const size = params.size === undefined ? 100 : integer(params.size, 'size', 1, MAX_PAGE_SIZE);
    return { board_type, page, size };
}
function topFilter(params, ticker) {
    const base = `(TRADE_DATE<='${params.end_date}')(TRADE_DATE>='${params.start_date}')`;
    const code = ticker?.replace(/\.(SH|SZ|BJ)$/i, '');
    return code ? `${base}(SECURITY_CODE="${code}")` : base;
}
function normalizeGlobalSymbol(value, name = 'symbol') {
    if (typeof value !== 'string')
        throw new Error(`${name} must be a string`);
    const symbol = value.trim().toUpperCase();
    if (!GLOBAL_SYMBOLS[symbol])
        throw new Error(`${name} must be one of ${GLOBAL_SYMBOL_NAMES.join(', ')}`);
    return symbol;
}
function normalizeGlobalSymbols(params) {
    assertKnown(params, ['symbols']);
    if (!Array.isArray(params.symbols) || params.symbols.length === 0)
        throw new Error('symbols must be a non-empty array');
    if (params.symbols.length > GLOBAL_SYMBOL_NAMES.length)
        throw new Error(`symbols exceeds maximum ${GLOBAL_SYMBOL_NAMES.length}`);
    return { symbols: [...new Set(params.symbols.map((value) => normalizeGlobalSymbol(value, 'symbols[]')))] };
}
function formatQuoteTime(ms, timeZone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
    const hour = parts.hour === '24' ? '00' : parts.hour;
    return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}`;
}
function emptyGlobalQuoteRow(symbol, spec, reason) {
    return {
        symbol, eastmoney_code: null, eastmoney_market: null, name: spec.name, market: spec.market,
        currency: spec.currency, unit: spec.unit,
        price: null, prev_close: null, change_amt: null, change_pct: null, open: null, high: null, low: null,
        volume: null, volume_unit: spec.volumeUnit, amount: null, amount_unit: spec.amountUnit,
        quote_time: null, quote_time_utc: null, quote_time_ms: null, quote_time_zone: spec.timeZone,
        is_delayed: null, available: false, reason, source: 'eastmoney',
    };
}
function parseGlobalQuoteRow(raw, symbol, spec) {
    const price = numberOrNull(raw.f2);
    const seconds = numberOrNull(raw.f124);
    const quoteMs = seconds !== null && seconds > 0 ? Math.round(seconds * 1000) : null;
    const marketId = Number(raw.f13);
    const volume = numberOrNull(raw.f5);
    const amount = numberOrNull(raw.f6);
    return {
        symbol,
        eastmoney_code: textOrNull(raw.f12),
        eastmoney_market: Number.isSafeInteger(marketId) ? marketId : null,
        name: textOrNull(raw.f14) ?? spec.name,
        market: spec.market, currency: spec.currency, unit: spec.unit,
        price,
        prev_close: numberOrNull(raw.f18),
        change_amt: numberOrNull(raw.f4),
        change_pct: numberOrNull(raw.f3),
        open: numberOrNull(raw.f17),
        high: numberOrNull(raw.f15),
        low: numberOrNull(raw.f16),
        volume: spec.volumeUnit && volume !== null && volume > 0 ? volume : null,
        volume_unit: spec.volumeUnit,
        amount: spec.amountUnit && amount !== null && amount > 0 ? amount : null,
        amount_unit: spec.amountUnit,
        quote_time: quoteMs === null ? null : formatQuoteTime(quoteMs, spec.timeZone),
        quote_time_utc: quoteMs === null ? null : new Date(quoteMs).toISOString(),
        quote_time_ms: quoteMs,
        quote_time_zone: spec.timeZone,
        is_delayed: null,
        available: price !== null,
        reason: price === null ? 'no_price' : null,
        source: 'eastmoney',
    };
}
async function executeGlobalQuote(params, signal) {
    const symbols = params.symbols;
    const url = new URL('https://push2.eastmoney.com/api/qt/ulist.np/get');
    url.searchParams.set('fltt', '2');
    url.searchParams.set('secids', symbols.map((symbol) => GLOBAL_SYMBOLS[symbol].secid).join(','));
    url.searchParams.set('fields', 'f12,f13,f14,f2,f3,f4,f5,f6,f15,f16,f17,f18,f124');
    const payload = await getJson(url.toString(), signal, 'global quote');
    if (Number(payload.rc) !== 0 || !isRecord(payload.data) || !Array.isArray(payload.data.diff) || !payload.data.diff.every(isRecord)) {
        throw sourceError('Eastmoney global quote returned a non-list response', 'eastmoney_invalid_response');
    }
    const bySecid = new Map();
    for (const raw of payload.data.diff)
        bySecid.set(`${String(raw.f13 ?? '')}.${String(raw.f12 ?? '')}`, raw);
    const rows = symbols.map((symbol) => {
        const spec = GLOBAL_SYMBOLS[symbol];
        const raw = bySecid.get(spec.secid);
        return raw ? parseGlobalQuoteRow(raw, symbol, spec) : emptyGlobalQuoteRow(symbol, spec, 'symbol_not_returned');
    });
    if (!rows.some((row) => row.available === true)) {
        throw sourceError('Eastmoney global quote returned none of the requested symbols', 'eastmoney_invalid_response');
    }
    return { data: rows, schema: globalQuoteRow };
}
function normalizeGlobalKline(params) {
    assertKnown(params, ['symbol', 'period', 'start_date', 'end_date']);
    const symbol = normalizeGlobalSymbol(params.symbol);
    const period = params.period === undefined ? 'day' : String(params.period).toLowerCase();
    if (!(period in GLOBAL_PERIODS))
        throw new Error(`period must be one of ${Object.keys(GLOBAL_PERIODS).join(', ')}`);
    const start_date = date(params.start_date, 'start_date');
    const end_date = date(params.end_date, 'end_date');
    if (start_date > end_date)
        throw new Error('start_date must not be later than end_date');
    return { symbol, period, start_date, end_date };
}
function parseGlobalKlineRow(line, symbol, spec, name, previousClose) {
    const columns = line.split(',');
    if (columns.length !== 8)
        throw sourceError(`Eastmoney global kline row has ${columns.length} columns, expected 8`, 'eastmoney_invalid_response');
    const tradeDate = dayValue(columns[0]);
    if (tradeDate === null)
        throw sourceError(`Eastmoney global kline row has invalid date ${columns[0]}`, 'eastmoney_invalid_response');
    const [open, close, high, low, volume, amount, amplitude] = columns.slice(1).map(numberOrNull);
    if ([open, close, high, low].some((value) => value === null)) {
        throw sourceError(`Eastmoney global kline row has invalid OHLC for ${tradeDate}`, 'eastmoney_invalid_response');
    }
    const change = previousClose !== null && previousClose > 0
        ? rounded(((close - previousClose) / previousClose) * 100, 4)
        : null;
    return {
        symbol, name, market: spec.market, currency: spec.currency, unit: spec.unit, trade_date: tradeDate,
        open: open, high: high, low: low, close: close,
        volume: spec.volumeUnit && volume !== null && volume > 0 ? volume : null,
        volume_unit: spec.volumeUnit,
        amount: spec.amountUnit && amount !== null && amount > 0 ? amount : null,
        amount_unit: spec.amountUnit,
        change_pct: change,
        amplitude_pct: amplitude,
        source: 'eastmoney',
    };
}
async function executeGlobalKline(params, signal) {
    const spec = GLOBAL_SYMBOLS[String(params.symbol)];
    const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
    url.searchParams.set('secid', spec.secid);
    url.searchParams.set('klt', String(GLOBAL_PERIODS[String(params.period)]));
    url.searchParams.set('fqt', '1');
    url.searchParams.set('beg', String(params.start_date).replaceAll('-', ''));
    url.searchParams.set('end', String(params.end_date).replaceAll('-', ''));
    url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6');
    url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58');
    const payload = await getJson(url.toString(), signal, 'global kline');
    if (Number(payload.rc) !== 0 || !isRecord(payload.data) || !Array.isArray(payload.data.klines)) {
        throw sourceError('Eastmoney global kline returned a non-list response', 'eastmoney_invalid_response');
    }
    if (!payload.data.klines.every((line) => typeof line === 'string')) {
        throw sourceError('Eastmoney global kline contains a non-string row', 'eastmoney_invalid_response');
    }
    const preKPrice = numberOrNull(payload.data.preKPrice);
    const name = textOrNull(payload.data.name) ?? spec.name;
    let previousClose = preKPrice;
    const rows = payload.data.klines.map((line) => {
        const row = parseGlobalKlineRow(line, String(params.symbol), spec, name, previousClose);
        previousClose = Number(row.close);
        return row;
    });
    return { data: rows, schema: globalKlineRow };
}
function normalizeMarketMargin(params) {
    assertKnown(params, ['start_date', 'end_date', 'market', 'page', 'size']);
    const normalized = normalizeDateRange(params, ['start_date', 'end_date', 'market', 'page', 'size']);
    const market = params.market === undefined ? 'all' : String(params.market).toLowerCase();
    if (market !== 'all' && !(market in MARKET_MARGIN_FILTER))
        throw new Error(`market must be one of all, ${Object.keys(MARKET_MARGIN_FILTER).join(', ')}`);
    return { ...normalized, market };
}
function parseMarketMarginRow(raw) {
    const tradeDate = dayValue(raw.DIM_DATE);
    if (tradeDate === null)
        throw sourceError('Eastmoney market margin row has invalid DIM_DATE', 'eastmoney_invalid_response');
    const code = String(raw.SCDM ?? '');
    const market = MARKET_MARGIN_CODE[code];
    if (!market)
        throw sourceError(`Eastmoney market margin row has unknown SCDM ${code || '(empty)'}`, 'eastmoney_invalid_response');
    return {
        trade_date: tradeDate,
        trade_date_ms: dateMs(tradeDate),
        market,
        market_label: textOrNull(raw.XOB_MARKET_0001),
        eastmoney_market_code: code,
        margin_balance: numberOrNull(raw.RZYE),
        short_balance: numberOrNull(raw.RQYE),
        total_balance: numberOrNull(raw.RZRQYE),
        margin_buy: numberOrNull(raw.RZMRE),
        margin_repay: numberOrNull(raw.RZCHE),
        margin_net_buy: numberOrNull(raw.RZJME),
        short_balance_volume: numberOrNull(raw.RQYL),
        short_sell_volume: numberOrNull(raw.RQMCL),
        short_repay_volume: numberOrNull(raw.RQCHL),
        short_net_buy_volume: numberOrNull(raw.RQJMG),
        float_market_cap: numberOrNull(raw.LTSZ),
        margin_balance_pct: numberOrNull(raw.RZYEZB),
        source: 'eastmoney',
    };
}
async function executeMarketMargin(params, signal) {
    const marketFilter = params.market === 'all' ? '' : MARKET_MARGIN_FILTER[String(params.market)];
    const url = new URL(DATACENTER_URL);
    url.searchParams.set('reportName', 'RPTA_WEB_RZRQ_LSSH');
    url.searchParams.set('columns', 'ALL');
    url.searchParams.set('source', 'WEB');
    url.searchParams.set('client', 'WEB');
    url.searchParams.set('sortColumns', 'DIM_DATE');
    url.searchParams.set('sortTypes', '-1');
    url.searchParams.set('pageNumber', String(params.page));
    url.searchParams.set('pageSize', String(params.size));
    url.searchParams.set('filter', `(DIM_DATE>='${String(params.start_date)}')(DIM_DATE<='${String(params.end_date)}')${marketFilter}`);
    const result = requireDatacenterResult(await getJson(url.toString(), signal, 'market margin'), 'market margin');
    const parsed = requireRows(result, 'market margin');
    return {
        data: { item: parsed.rows.map(parseMarketMarginRow), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) },
        schema: datacenterOutput(marketMarginRow),
    };
}
function parseTopRow(raw) {
    // MARKET is free text and redundant when SECUCODE has a suffix; only require it for bare codes,
    // otherwise a whitelist rejects valid billboard pages. Keep the raw `market` field.
    const secucode = typeof raw.SECUCODE === 'string' ? raw.SECUCODE : '';
    const identity = secucode.includes('.')
        ? normalizeEastmoneySecurityIdentity({ secucode })
        : normalizeEastmoneySecurityIdentity({ secucode: raw.SECUCODE, security_code: raw.SECURITY_CODE, market: raw.MARKET });
    const tradeDate = String(raw.TRADE_DATE ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate))
        throw sourceError('Eastmoney billboard row has invalid TRADE_DATE', 'eastmoney_invalid_response');
    return {
        ...identity,
        name: String(raw.SECURITY_NAME_ABBR ?? ''), market: String(raw.MARKET ?? identity.eastmoney_market), trade_date: tradeDate, trade_date_ms: dateMs(tradeDate),
        close_price: numberOrNull(raw.CLOSE_PRICE), change_pct: numberOrNull(raw.CHANGE_RATE), turnover_rate_pct: numberOrNull(raw.TURNOVERRATE),
        billboard_buy_amt: numberOrNull(raw.BILLBOARD_BUY_AMT), billboard_sell_amt: numberOrNull(raw.BILLBOARD_SELL_AMT), billboard_net_amt: numberOrNull(raw.BILLBOARD_NET_AMT), billboard_deal_amt: numberOrNull(raw.BILLBOARD_DEAL_AMT),
        deal_amount_ratio_pct: numberOrNull(raw.DEAL_AMOUNT_RATIO), deal_net_ratio_pct: numberOrNull(raw.DEAL_NET_RATIO), market_deal_amt: numberOrNull(raw.ACCUM_AMOUNT), free_market_cap: numberOrNull(raw.FREE_MARKET_CAP),
        explanation: textOrNull(raw.EXPLANATION), explain: textOrNull(raw.EXPLAIN), trade_market: textOrNull(raw.TRADE_MARKET), trade_id: numberOrNull(raw.TRADE_ID),
    };
}
async function executeBillboard(params, signal, ticker) {
    const url = new URL(DATACENTER_URL);
    url.searchParams.set('reportName', 'RPT_DAILYBILLBOARD_DETAILS');
    url.searchParams.set('columns', 'ALL');
    url.searchParams.set('source', 'WEB');
    url.searchParams.set('client', 'WEB');
    url.searchParams.set('sortColumns', 'TRADE_DATE,SECURITY_CODE');
    url.searchParams.set('sortTypes', '-1,1');
    url.searchParams.set('pageNumber', String(params.page));
    url.searchParams.set('pageSize', String(params.size));
    url.searchParams.set('filter', topFilter(params, ticker));
    const payload = await getJson(url.toString(), signal, 'daily billboard');
    if (ticker && payload.success !== true && Number(payload.code) === 9201) {
        const exists = await eastmoneyTickerExists(ticker, signal);
        if (!exists)
            throw sourceError(`Eastmoney ticker ${ticker} is not a recognized security`, 'eastmoney_invalid_ticker');
        throw sourceError(`Eastmoney ticker ${ticker} has no billboard records from ${params.start_date} to ${params.end_date}`, 'eastmoney_no_billboard_data');
    }
    const result = requireDatacenterResult(payload, 'daily billboard');
    const parsed = requireRows(result, 'daily billboard');
    const item = parsed.rows.map(parseTopRow);
    return { data: { item, pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(topBuySellRow) };
}
function parseLockupRow(raw) {
    const identity = normalizeEastmoneyAshareIdentity(raw.SECURITY_CODE);
    const freeDate = String(raw.FREE_DATE ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(freeDate))
        throw sourceError('Eastmoney lockup row has invalid FREE_DATE', 'eastmoney_invalid_response');
    return {
        ...identity, name: String(raw.SECURITY_NAME_ABBR ?? ''), free_date: freeDate, free_date_ms: dateMs(freeDate), free_shares_type: textOrNull(raw.FREE_SHARES_TYPE),
        free_shares_raw: numberOrNull(raw.FREE_SHARES), total_ratio: numberOrNull(raw.TOTAL_RATIO), non_free_shares_raw: numberOrNull(raw.NON_FREE_SHARES), able_free_shares_raw: numberOrNull(raw.ABLE_FREE_SHARES),
    };
}
async function executeLockup(params, signal) {
    const url = new URL(DATACENTER_URL);
    url.searchParams.set('reportName', 'RPT_LIFT_STAGE');
    url.searchParams.set('columns', 'SECURITY_CODE,SECURITY_NAME_ABBR,FREE_DATE,FREE_SHARES_TYPE,FREE_SHARES,TOTAL_RATIO,NON_FREE_SHARES,ABLE_FREE_SHARES');
    url.searchParams.set('source', 'WEB');
    url.searchParams.set('client', 'WEB');
    url.searchParams.set('sortColumns', 'FREE_DATE');
    url.searchParams.set('sortTypes', '1');
    url.searchParams.set('pageNumber', String(params.page));
    url.searchParams.set('pageSize', String(params.size));
    url.searchParams.set('filter', `(FREE_DATE>='${params.start_date}')(FREE_DATE<='${params.end_date}')`);
    const result = requireDatacenterResult(await getJson(url.toString(), signal, 'lockup calendar'), 'lockup calendar');
    const parsed = requireRows(result, 'lockup calendar');
    return { data: { item: parsed.rows.map(parseLockupRow), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(lockupRow) };
}
function boardParams(params, cashflow) {
    const url = new URL(CLIST_URL);
    url.searchParams.set('pn', String(params.page));
    url.searchParams.set('pz', String(params.size));
    url.searchParams.set('po', '1');
    url.searchParams.set('np', '1');
    url.searchParams.set('ut', EASTMONEY_UT);
    url.searchParams.set('fltt', '2');
    url.searchParams.set('invt', '2');
    url.searchParams.set('fid', cashflow ? 'f62' : SORT_FIELDS[String(params.sort_field)]);
    url.searchParams.set('fs', BOARD_FS[String(params.board_type)]);
    url.searchParams.set('fields', cashflow ? 'f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f124' : 'f12,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f124');
    return url;
}
function requireCList(payload, context) {
    if (Number(payload.rc) !== 0 || !isRecord(payload.data))
        throw sourceError(`Eastmoney ${context} failed: ${String(payload.msg ?? 'unknown upstream error')}`, 'eastmoney_upstream_error');
    return payload.data;
}
function parseBoardRow(raw, boardType, cashflow) {
    const identity = normalizeEastmoneyBoardIdentity(raw.f12, raw.f14, boardType);
    const row = {
        ...identity, last_price: numberOrNull(raw.f2), change_pct: numberOrNull(raw.f3), change_amount: numberOrNull(raw.f4), volume: numberOrNull(raw.f5), amount: numberOrNull(raw.f6), amplitude_pct: numberOrNull(raw.f7), turnover_pct: numberOrNull(raw.f8), pe: numberOrNull(raw.f9), pb: numberOrNull(raw.f10), eastmoney_server_time: numberOrNull(raw.f124),
    };
    if (cashflow)
        Object.assign(row, {
            main_net_inflow: numberOrNull(raw.f62), main_net_inflow_pct: numberOrNull(raw.f184), super_large_net_inflow: numberOrNull(raw.f66), super_large_net_inflow_pct: numberOrNull(raw.f69), large_net_inflow: numberOrNull(raw.f72), large_net_inflow_pct: numberOrNull(raw.f75), medium_net_inflow: numberOrNull(raw.f78), medium_net_inflow_pct: numberOrNull(raw.f81), small_net_inflow: numberOrNull(raw.f84), small_net_inflow_pct: numberOrNull(raw.f87),
        });
    return row;
}
async function executeBoard(params, signal, cashflow) {
    const boardType = String(params.board_type);
    const payload = await getJson(boardParams(params, cashflow).toString(), signal, cashflow ? 'sector cashflow' : 'sector rotation');
    const data = requireCList(payload, cashflow ? 'sector cashflow' : 'sector rotation');
    if (!Array.isArray(data.diff) || typeof data.total !== 'number' || !data.diff.every(isRecord))
        throw sourceError('Eastmoney board result shape changed', 'eastmoney_invalid_response');
    const row = cashflow ? cashflowRow : sectorRow;
    return { data: { item: data.diff.map((raw) => parseBoardRow(raw, boardType, cashflow)), pagination: pagination(Number(params.page), Number(params.size), Math.ceil(data.total / Number(params.size)), data.total) }, schema: { type: 'object', properties: { item: { type: 'array', items: row }, pagination: { type: 'object', additionalProperties: true } }, required: ['item', 'pagination'], additionalProperties: true } };
}
function macroDate(value, format, context) {
    if (format === 'chinese') {
        const match = String(value ?? '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (!match)
            throw sourceError(`Eastmoney ${context} row has an unparseable Chinese date`, 'eastmoney_invalid_response');
        return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    }
    const text = String(value ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
        throw sourceError(`Eastmoney ${context} row has invalid ${context} date`, 'eastmoney_invalid_response');
    return text;
}
const macroRow = (table) => {
    const properties = {};
    const nullableNumber = { oneOf: [{ type: 'number' }, { type: 'null' }] };
    for (const date of table.dates) {
        properties[date.to] = { type: 'string' };
        properties[`${date.to}_ms`] = { type: 'integer' };
    }
    if (table.labelFrom)
        properties.period_label = { oneOf: [{ type: 'string' }, { type: 'null' }] };
    for (const column of table.numbers)
        properties[column.to] = nullableNumber;
    for (const column of table.texts ?? [])
        properties[column.to] = { oneOf: [{ type: 'string' }, { type: 'null' }] };
    return { type: 'object', properties, additionalProperties: true };
};
function parseMacroRow(table, raw) {
    const row = {};
    for (const date of table.dates) {
        const text = macroDate(raw[date.from], date.format, table.context);
        row[date.to] = text;
        row[`${date.to}_ms`] = dateMs(text);
    }
    if (table.labelFrom)
        row.period_label = textOrNull(raw[table.labelFrom]);
    for (const column of table.numbers)
        row[column.to] = numberOrNull(raw[column.from]);
    for (const column of table.texts ?? [])
        row[column.to] = textOrNull(raw[column.from]);
    return row;
}
async function executeMacro(table, params, signal) {
    const url = new URL(DATACENTER_URL);
    url.searchParams.set('reportName', table.reportName);
    url.searchParams.set('columns', 'ALL');
    url.searchParams.set('source', 'WEB');
    url.searchParams.set('client', 'WEB');
    url.searchParams.set('sortColumns', 'REPORT_DATE');
    url.searchParams.set('sortTypes', '-1');
    url.searchParams.set('pageNumber', String(params.page));
    url.searchParams.set('pageSize', String(params.size));
    url.searchParams.set('filter', `(REPORT_DATE>='${params.start_date}')(REPORT_DATE<='${params.end_date}')`);
    const result = requireDatacenterResult(await getJson(url.toString(), signal, table.context), table.context);
    const parsed = requireRows(result, table.context);
    return { data: { item: parsed.rows.map((raw) => parseMacroRow(table, raw)), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(macroRow(table)) };
}
function createMacroSource(table) {
    return createSource({
        capability: table.capability,
        name: table.name,
        summary: table.summary,
        description: table.description,
        inputSchema: dateRangeInput,
        outputSchema: datacenterOutput(macroRow(table)),
        paginated: true,
        rowShape: { rowKey: 'item' },
        allowed: ['start_date', 'end_date', 'page', 'size'],
        normalize: (params) => normalizeDateRange(params, ['start_date', 'end_date', 'page', 'size']),
        execute: (params, signal) => executeMacro(table, params, signal),
    });
}
const MACRO_PERCENT_NOTE = '`_yoy_pct` 是同比、`_mom_pct` 是环比，都是百分数原值（0.8 表示 +0.8%，不是 0.8%×100 的小数形式）；`_ms` 后缀是按 Asia/Shanghai 零点换算的毫秒时间戳。';
const MACRO_TABLES = [
    {
        capability: 'eastmoney_cpi', name: 'get_eastmoney_cpi', context: 'CPI', reportName: 'RPT_ECONOMY_CPI',
        summary: 'CPI 居民消费价格指数（月度，全国/城市/农村）',
        description: `按月获取中国 CPI（东财 datacenter RPT_ECONOMY_CPI，实测 2010-01 起共 224 期，可深翻到 2010 年）。${MACRO_PERCENT_NOTE} \`_index\` 是当月价格指数（上年同月=100，100.8 即同比 +0.8%），\`_ytd_index\` 是本年 1 月至当月的累计指数（上年同期=100）；national / city / rural 三档同口径，实测同期三档同时有值。东财原文月份标签存在 period_label。`,
        dates: [{ from: 'REPORT_DATE', to: 'report_date', format: 'datetime' }], labelFrom: 'TIME',
        numbers: [
            { from: 'NATIONAL_SAME', to: 'national_yoy_pct' }, { from: 'NATIONAL_BASE', to: 'national_index' }, { from: 'NATIONAL_SEQUENTIAL', to: 'national_mom_pct' }, { from: 'NATIONAL_ACCUMULATE', to: 'national_ytd_index' },
            { from: 'CITY_SAME', to: 'city_yoy_pct' }, { from: 'CITY_BASE', to: 'city_index' }, { from: 'CITY_SEQUENTIAL', to: 'city_mom_pct' }, { from: 'CITY_ACCUMULATE', to: 'city_ytd_index' },
            { from: 'RURAL_SAME', to: 'rural_yoy_pct' }, { from: 'RURAL_BASE', to: 'rural_index' }, { from: 'RURAL_SEQUENTIAL', to: 'rural_mom_pct' }, { from: 'RURAL_ACCUMULATE', to: 'rural_ytd_index' },
        ],
    },
    {
        capability: 'eastmoney_ppi', name: 'get_eastmoney_ppi', context: 'PPI', reportName: 'RPT_ECONOMY_PPI',
        summary: 'PPI 工业生产者出厂价格指数（月度）',
        description: `按月获取中国 PPI（RPT_ECONOMY_PPI，实测 2010-01 起共 248 期）。${MACRO_PERCENT_NOTE} 本表**只有同比**：monthly_index 是当月同比指数（上年同月=100），yoy_pct 是同比百分数，ytd_index 是累计指数；上游不提供环比，不要拿相邻两月自行当成环比。`,
        dates: [{ from: 'REPORT_DATE', to: 'report_date', format: 'datetime' }], labelFrom: 'TIME',
        numbers: [{ from: 'BASE', to: 'monthly_index' }, { from: 'BASE_SAME', to: 'yoy_pct' }, { from: 'BASE_ACCUMULATE', to: 'ytd_index' }],
    },
    {
        capability: 'eastmoney_gdp', name: 'get_eastmoney_gdp', context: 'GDP', reportName: 'RPT_ECONOMY_GDP',
        summary: 'GDP 国内生产总值与三次产业（季度累计）',
        description: `按季度获取中国 GDP（RPT_ECONOMY_GDP，实测 2006-Q1 起共 82 期）。${MACRO_PERCENT_NOTE} 金额字段是**年初至报告期的累计值**（如 report_date=2026-06-01 那行是上半年累计），单位按东财标称为亿元——未经逐值核对，只用于量级与趋势比较，不要自行换算成美元或绝对口径写进结论；\`_yoy_pct\` 是同比增长率百分数。primary/secondary/tertiary 为三次产业，gdp_value 与 primary 等字段名里的 ytd 后缀是"累计"而非"同比"。`,
        dates: [{ from: 'REPORT_DATE', to: 'report_date', format: 'datetime' }], labelFrom: 'TIME',
        numbers: [
            { from: 'DOMESTICL_PRODUCT_BASE', to: 'gdp_ytd' }, { from: 'FIRST_PRODUCT_BASE', to: 'primary_ytd' }, { from: 'SECOND_PRODUCT_BASE', to: 'secondary_ytd' }, { from: 'THIRD_PRODUCT_BASE', to: 'tertiary_ytd' },
            { from: 'SUM_SAME', to: 'gdp_yoy_pct' }, { from: 'FIRST_SAME', to: 'primary_yoy_pct' }, { from: 'SECOND_SAME', to: 'secondary_yoy_pct' }, { from: 'THIRD_SAME', to: 'tertiary_yoy_pct' },
        ],
    },
    {
        capability: 'eastmoney_pmi', name: 'get_eastmoney_pmi', context: 'PMI', reportName: 'RPT_ECONOMY_PMI',
        summary: 'PMI 采购经理人指数（制造业与非制造业）',
        description: `按月获取中国 PMI（RPT_ECONOMY_PMI，实测 2010-02 起共 225 期）。manufacturing_pmi / non_manufacturing_pmi 是指数原值（50 为荣枯线，不是百分数）；\`_yoy_pct\` 是东财给出的**同比变化百分数**（小数位很多，属东财计算口径），${MACRO_PERCENT_NOTE} 本表不含新订单、生产、就业等分项指数，只有综合两项。`,
        dates: [{ from: 'REPORT_DATE', to: 'report_date', format: 'datetime' }], labelFrom: 'TIME',
        numbers: [{ from: 'MAKE_INDEX', to: 'manufacturing_pmi' }, { from: 'MAKE_SAME', to: 'manufacturing_yoy_pct' }, { from: 'NMAKE_INDEX', to: 'non_manufacturing_pmi' }, { from: 'NMAKE_SAME', to: 'non_manufacturing_yoy_pct' }],
    },
    {
        capability: 'eastmoney_money_supply', name: 'get_eastmoney_money_supply', context: '货币供应量', reportName: 'RPT_ECONOMY_CURRENCY_SUPPLY',
        summary: 'M0/M1/M2 货币供应量（月度）',
        description: `按月获取人民币 M2 / M1 / M0（RPT_ECONOMY_CURRENCY_SUPPLY，实测 2010-01 起共 224 期）。m2/m1/m0 是**存量原值**，单位按东财标称为亿元（未逐值核对，只做量级与趋势比较）；\`_yoy_pct\` 同比、\`_mom_pct\` 环比为百分数，${MACRO_PERCENT_NOTE} 本表没有 M2-M1 剪刀差，需要就自己按两列相减并写明是派生值。`,
        dates: [{ from: 'REPORT_DATE', to: 'report_date', format: 'datetime' }], labelFrom: 'TIME',
        numbers: [
            { from: 'BASIC_CURRENCY', to: 'm2' }, { from: 'BASIC_CURRENCY_SAME', to: 'm2_yoy_pct' }, { from: 'BASIC_CURRENCY_SEQUENTIAL', to: 'm2_mom_pct' },
            { from: 'CURRENCY', to: 'm1' }, { from: 'CURRENCY_SAME', to: 'm1_yoy_pct' }, { from: 'CURRENCY_SEQUENTIAL', to: 'm1_mom_pct' },
            { from: 'FREE_CASH', to: 'm0' }, { from: 'FREE_CASH_SAME', to: 'm0_yoy_pct' }, { from: 'FREE_CASH_SEQUENTIAL', to: 'm0_mom_pct' },
        ],
    },
    {
        capability: 'eastmoney_rmb_loan', name: 'get_eastmoney_rmb_loan', context: '人民币贷款', reportName: 'RPT_ECONOMY_RMB_LOAN',
        summary: '新增人民币贷款（月度，含负值）',
        description: `按月获取新增人民币贷款（RPT_ECONOMY_RMB_LOAN，实测 2010-01 起共 224 期）。new_loans 是**当月新增额**、ytd_new_loans 是本年累计，单位按东财标称为亿元（未逐值核对）；当月新增**可以为负**（贷款净减少，实测 2025-07 为 -5896），负值是事实、不是脏数据，不要过滤掉。${MACRO_PERCENT_NOTE} 本表是人民银行口径的人民币贷款，不含外币贷款与社融增量。`,
        dates: [{ from: 'REPORT_DATE', to: 'report_date', format: 'datetime' }], labelFrom: 'TIME',
        numbers: [{ from: 'RMB_LOAN', to: 'new_loans' }, { from: 'RMB_LOAN_SAME', to: 'new_loans_yoy_pct' }, { from: 'RMB_LOAN_SEQUENTIAL', to: 'new_loans_mom_pct' }, { from: 'RMB_LOAN_ACCUMULATE', to: 'ytd_new_loans' }, { from: 'LOAN_ACCUMULATE_SAME', to: 'ytd_new_loans_yoy_pct' }],
    },
    {
        capability: 'eastmoney_customs_trade', name: 'get_eastmoney_customs_trade', context: '进出口', reportName: 'RPT_ECONOMY_CUSTOMS',
        summary: '海关进出口金额与同比环比（月度）',
        description: `按月获取出口与进口（RPT_ECONOMY_CUSTOMS，实测 2010-01 起共 224 期）。${MACRO_PERCENT_NOTE} ⛔ **金额字段（export_value / import_value / *_ytd）的计量单位未经核验**：同一列按"千美元"或"万元人民币"解释都能与公开量级对上其一，无法据此定档，所以只能用于趋势与同环比比较，**禁止换算成"元"或"美元"写进结论**；export_yoy_pct / export_mom_pct 等百分数字段口径明确（东财原值）。要绝对额请改走 web_retriever 的海关官方统计材料。本表是海关口径，不含贸易差额字段，需要差额就自己按进出口两列相减并标注派生。`,
        dates: [{ from: 'REPORT_DATE', to: 'report_date', format: 'datetime' }], labelFrom: 'TIME',
        numbers: [
            { from: 'EXIT_BASE', to: 'export_value' }, { from: 'IMPORT_BASE', to: 'import_value' },
            { from: 'EXIT_BASE_SAME', to: 'export_yoy_pct' }, { from: 'IMPORT_BASE_SAME', to: 'import_yoy_pct' },
            { from: 'EXIT_BASE_SEQUENTIAL', to: 'export_mom_pct' }, { from: 'IMPORT_BASE_SEQUENTIAL', to: 'import_mom_pct' },
            { from: 'EXIT_ACCUMULATE', to: 'export_ytd' }, { from: 'IMPORT_ACCUMULATE', to: 'import_ytd' },
            { from: 'EXIT_ACCUMULATE_SAME', to: 'export_ytd_yoy_pct' }, { from: 'IMPORT_ACCUMULATE_SAME', to: 'import_ytd_yoy_pct' },
        ],
    },
    {
        capability: 'eastmoney_retail_sales', name: 'get_eastmoney_retail_sales', context: '社会消费品零售', reportName: 'RPT_ECONOMY_TOTAL_RETAIL',
        summary: '社会消费品零售总额（月度）',
        description: `按月获取社会消费品零售总额（RPT_ECONOMY_TOTAL_RETAIL，实测 2008-10 起共 209 期）。total_retail 是当月额、ytd_total_retail 是本年累计，单位按东财标称为亿元（未逐值核对，只做量级与趋势比较）；${MACRO_PERCENT_NOTE} ⛔ 实测 200 行里有 15 行 total_retail 与 total_retail_yoy_pct 为 **null**、30 行 total_retail_mom_pct 为 null（口径调整与统计口径缺口），null 一律原样保留、不补 0、也不当作 0 增长参与排序。`,
        dates: [{ from: 'REPORT_DATE', to: 'report_date', format: 'datetime' }], labelFrom: 'TIME',
        numbers: [{ from: 'RETAIL_TOTAL', to: 'total_retail' }, { from: 'RETAIL_TOTAL_SAME', to: 'total_retail_yoy_pct' }, { from: 'RETAIL_TOTAL_SEQUENTIAL', to: 'total_retail_mom_pct' }, { from: 'RETAIL_TOTAL_ACCUMULATE', to: 'ytd_total_retail' }, { from: 'RETAIL_ACCUMULATE_SAME', to: 'ytd_total_retail_yoy_pct' }],
    },
    {
        capability: 'eastmoney_deposit_reserve', name: 'get_eastmoney_deposit_reserve', context: '存款准备金率', reportName: 'RPT_ECONOMY_DEPOSIT_RESERVE',
        summary: '存款准备金率调整事件（历次）',
        description: `获取央行**历次存款准备金率调整**（RPT_ECONOMY_DEPOSIT_RESERVE，实测 2007-01 起共 58 条、最新一条 2025-05）。这是**事件表不是月度序列**：一行一次调整，区间内没有调整就是空结果（实测 2025-01..2025-04 返回上游 9201 空，属真实数据缺口，不重试）。report_date 与 announcement/publish_date 口径不同：report_date 与 publish_date 是公告日，effective_date（TRADE_DATE_NEW）才是**生效日**，回答"什么时候开始降"要用 effective_date。large_* / small_* 分别是大型与中小型金融机构存准率（百分数原值，10 表示 10%），large_change_pct / small_change_pct 是本次变动百分点（-0.5 表示下调 0.5 个百分点）。sse_next_change_pct / szse_next_change_pct 是东财附带的**公告次日**上证/深证涨跌幅（百分数），属派生观察值，不要当成市场长期反应。announcement 是央行公告原文，实测 58 条中 30 条为 null。`,
        dates: [
            { from: 'REPORT_DATE', to: 'report_date', format: 'datetime' },
            { from: 'TRADE_DATE_NEW', to: 'effective_date', format: 'datetime' },
            { from: 'PUBLISH_DATE', to: 'publish_date', format: 'chinese' },
        ],
        labelFrom: 'MONTH_DATE',
        numbers: [
            { from: 'INTEREST_RATE_BB', to: 'large_before_pct' }, { from: 'INTEREST_RATE_BA', to: 'large_after_pct' }, { from: 'CHANGE_RATE_B', to: 'large_change_pct' },
            { from: 'INTEREST_RATE_SB', to: 'small_before_pct' }, { from: 'INTEREST_RATE_SA', to: 'small_after_pct' }, { from: 'CHANGE_RATE_S', to: 'small_change_pct' },
            { from: 'NEXT_SH_RATE', to: 'sse_next_change_pct' }, { from: 'NEXT_SZ_RATE', to: 'szse_next_change_pct' },
        ],
        texts: [{ from: 'REMARK', to: 'announcement' }],
    },
];
/** Stock Connect channels: upstream codes 001–006; 001+003=005 (north) and 002+004=006 (south) verified. */
const MUTUAL_CHANNELS = {
    sh_stock_connect: '001',
    hk_connect_sh: '002',
    sz_stock_connect: '003',
    hk_connect_sz: '004',
    north_total: '005',
    south_total: '006',
};
const MUTUAL_CHANNEL_NAMES = Object.keys(MUTUAL_CHANNELS);
const mutualFlowRow = {
    type: 'object',
    properties: {
        trade_date: { type: 'string' }, trade_date_ms: { type: 'integer' },
        channel: { enum: MUTUAL_CHANNEL_NAMES }, channel_code: { type: 'string' },
        deal_amt_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        buy_amt_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        sell_amt_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        net_deal_amt_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        accum_deal_amt_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        deal_num: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        hold_market_cap_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        quota_balance_text: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        index_close_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        index_change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        lead_thscode: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        lead_stock_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    },
    additionalProperties: true,
};
function normalizeMutualFlow(params) {
    const normalized = normalizeDateRange(params, ['start_date', 'end_date', 'channel', 'page', 'size']);
    const channel = params.channel === undefined ? 'north_total' : String(params.channel);
    if (!(channel in MUTUAL_CHANNELS))
        throw new Error(`channel must be one of ${MUTUAL_CHANNEL_NAMES.join(', ')}`);
    return { ...normalized, channel };
}
function parseMutualFlowRow(raw, channel) {
    const tradeDate = String(raw.TRADE_DATE ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate))
        throw sourceError('Eastmoney mutual flow row has invalid TRADE_DATE', 'eastmoney_invalid_response');
    return {
        trade_date: tradeDate,
        trade_date_ms: dateMs(tradeDate),
        channel,
        channel_code: String(raw.MUTUAL_TYPE ?? MUTUAL_CHANNELS[channel]),
        deal_amt_raw: numberOrNull(raw.DEAL_AMT),
        buy_amt_raw: numberOrNull(raw.BUY_AMT),
        sell_amt_raw: numberOrNull(raw.SELL_AMT),
        net_deal_amt_raw: numberOrNull(raw.NET_DEAL_AMT),
        accum_deal_amt_raw: numberOrNull(raw.ACCUM_DEAL_AMT),
        deal_num: numberOrNull(raw.DEAL_NUM),
        hold_market_cap_raw: numberOrNull(raw.HOLD_MARKET_CAP),
        quota_balance_text: textOrNull(raw.QUOTA_BALANCE_TEXT),
        index_close_price: numberOrNull(raw.INDEX_CLOSE_PRICE),
        index_change_pct: numberOrNull(raw.INDEX_CHANGE_RATE),
        lead_thscode: textOrNull(raw.LEAD_STOCKS_CODE),
        lead_stock_name: textOrNull(raw.LEAD_STOCKS_NAME),
    };
}
async function executeMutualFlow(params, signal) {
    const url = new URL(DATACENTER_URL);
    url.searchParams.set('reportName', 'RPT_MUTUAL_DEAL_HISTORY');
    url.searchParams.set('columns', 'ALL');
    url.searchParams.set('source', 'WEB');
    url.searchParams.set('client', 'WEB');
    url.searchParams.set('sortColumns', 'TRADE_DATE');
    url.searchParams.set('sortTypes', '-1');
    url.searchParams.set('pageNumber', String(params.page));
    url.searchParams.set('pageSize', String(params.size));
    url.searchParams.set('filter', `(TRADE_DATE>='${params.start_date}')(TRADE_DATE<='${params.end_date}')(MUTUAL_TYPE="${MUTUAL_CHANNELS[String(params.channel)]}")`);
    const result = requireDatacenterResult(await getJson(url.toString(), signal, 'mutual flow'), 'mutual flow');
    const parsed = requireRows(result, 'mutual flow');
    const channel = String(params.channel);
    return { data: { item: parsed.rows.map((raw) => parseMutualFlowRow(raw, channel)), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(mutualFlowRow) };
}
const mutualQuotaRow = {
    type: 'object',
    properties: {
        trade_date: { type: 'string' }, trade_date_ms: { type: 'integer' },
        channel: { enum: MUTUAL_CHANNEL_NAMES }, channel_code: { type: 'string' },
        channel_label: { type: 'string' }, board: { type: 'string' }, direction: { type: 'string' },
        trade_quota_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        closed_reason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        index_code: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        index_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        board_code: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    },
    additionalProperties: true,
};
/** Quota table has single channels only, no totals. */
const MUTUAL_QUOTA_CHANNELS = { 沪股通: 'sh_stock_connect', 深股通: 'sz_stock_connect', '港股通(沪)': 'hk_connect_sh', '港股通(深)': 'hk_connect_sz' };
const MUTUAL_QUOTA_CODE_CHANNELS = { '001': 'sh_stock_connect', '002': 'hk_connect_sh', '003': 'sz_stock_connect', '004': 'hk_connect_sz' };
function parseMutualQuotaRow(raw) {
    const tradeDate = String(raw.TRADE_DATE ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate))
        throw sourceError('Eastmoney mutual quota row has invalid TRADE_DATE', 'eastmoney_invalid_response');
    const code = String(raw.MUTUAL_TYPE ?? '');
    const channel = MUTUAL_QUOTA_CODE_CHANNELS[code] ?? MUTUAL_QUOTA_CHANNELS[String(raw.MUTUAL_TYPE_NAME ?? '')];
    if (!channel)
        throw sourceError(`Eastmoney mutual quota row has unknown MUTUAL_TYPE ${code || '(blank)'}`, 'eastmoney_invalid_response');
    return {
        trade_date: tradeDate,
        trade_date_ms: dateMs(tradeDate),
        channel,
        channel_code: code,
        channel_label: String(raw.MUTUAL_TYPE_NAME ?? ''),
        board: String(raw.BOARD_TYPE ?? ''),
        direction: raw.FUNDS_DIRECTION === '南向' ? 'south' : raw.FUNDS_DIRECTION === '北向' ? 'north' : String(raw.FUNDS_DIRECTION ?? ''),
        trade_quota_raw: numberOrNull(raw.TRADE_QUOTA),
        closed_reason: textOrNull(raw.CLOSED_REASON),
        index_code: textOrNull(raw.INDEX_CODE),
        index_name: textOrNull(raw.INDEX_NAME),
        board_code: textOrNull(raw.BOARD_CODE),
    };
}
async function executeMutualQuota(params, signal) {
    const url = new URL(DATACENTER_URL);
    url.searchParams.set('reportName', 'RPT_MUTUAL_QUOTA');
    url.searchParams.set('columns', 'ALL');
    url.searchParams.set('source', 'WEB');
    url.searchParams.set('client', 'WEB');
    url.searchParams.set('sortColumns', 'MUTUAL_TYPE');
    url.searchParams.set('sortTypes', '1');
    url.searchParams.set('pageNumber', '1');
    url.searchParams.set('pageSize', '10');
    const result = requireDatacenterResult(await getJson(url.toString(), signal, 'mutual quota'), 'mutual quota');
    const parsed = requireRows(result, 'mutual quota');
    return { data: { item: parsed.rows.map(parseMutualQuotaRow), pagination: pagination(1, 10, parsed.pages, parsed.total) }, schema: datacenterOutput(mutualQuotaRow) };
}
/** Main-capital snapshot: latest trading day only, one row per stock (5199, single TRADE_DATE); older dates return 9201. */
const MAIN_CAPITAL_SORTS = {
    main_net_inflow: 'PRIME_INFLOW',
    change_pct: 'CHANGE_RATE',
    turnover_rate_pct: 'TURNOVERRATE',
    total_score: 'TOTALSCORE',
};
const mainCapitalRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, ticker: { type: 'string' }, name: { type: 'string' },
        trade_date: { type: 'string' }, trade_date_ms: { type: 'integer' },
        close_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        turnover_rate_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        pe_dynamic: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        main_net_inflow: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        super_large_inflow: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        super_large_outflow: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        large_inflow: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        large_outflow: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        main_cost: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        main_cost_20d: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        main_cost_60d: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        super_large_buy_ratio_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        large_buy_ratio_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        prime_ratio_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        prime_ratio_3d_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        prime_ratio_50d_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        org_participate_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        total_score: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        rank: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        rank_up: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        focus: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        participate_type: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    },
    additionalProperties: true,
};
function normalizeMainCapital(params) {
    assertKnown(params, ['ticker', 'sort_field', 'sort_order', 'page', 'size']);
    const sort_field = params.sort_field === undefined ? 'main_net_inflow' : String(params.sort_field);
    if (!(sort_field in MAIN_CAPITAL_SORTS))
        throw new Error(`sort_field must be one of ${Object.keys(MAIN_CAPITAL_SORTS).join(', ')}`);
    const sort_order = params.sort_order === undefined ? 'desc' : String(params.sort_order);
    if (sort_order !== 'desc' && sort_order !== 'asc')
        throw new Error('sort_order must be desc or asc');
    const page = params.page === undefined ? 1 : integer(params.page, 'page', 1, Number.MAX_SAFE_INTEGER);
    const size = params.size === undefined ? 100 : integer(params.size, 'size', 1, MAX_PAGE_SIZE);
    if (params.ticker === undefined)
        return { sort_field, sort_order, page, size };
    return { sort_field, sort_order, page, size, ticker: normalizeEastmoneySecurityIdentity({ secucode: params.ticker }).thscode };
}
function parseMainCapitalRow(raw) {
    const tradeDate = String(raw.TRADE_DATE ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate))
        throw sourceError('Eastmoney main capital row has invalid TRADE_DATE', 'eastmoney_invalid_response');
    // SECUCODE always has a market suffix; never guess from the first digit. A missing suffix is a shape change.
    if (typeof raw.SECUCODE !== 'string' || !raw.SECUCODE.includes('.')) {
        throw sourceError('Eastmoney main capital row lost its market suffix in SECUCODE', 'eastmoney_invalid_response');
    }
    const identity = normalizeEastmoneySecurityIdentity({ secucode: raw.SECUCODE });
    return {
        ...identity,
        name: String(raw.SECURITY_NAME_ABBR ?? ''),
        trade_date: tradeDate,
        trade_date_ms: dateMs(tradeDate),
        close_price: numberOrNull(raw.CLOSE_PRICE),
        change_pct: numberOrNull(raw.CHANGE_RATE),
        turnover_rate_pct: numberOrNull(raw.TURNOVERRATE),
        pe_dynamic: numberOrNull(raw.PE_DYNAMIC),
        main_net_inflow: numberOrNull(raw.PRIME_INFLOW),
        super_large_inflow: numberOrNull(raw.SUPERDEAL_INFLOW),
        super_large_outflow: numberOrNull(raw.SUPERDEAL_OUTFLOW),
        large_inflow: numberOrNull(raw.BIGDEAL_INFLOW),
        large_outflow: numberOrNull(raw.BIGDEAL_OUTFLOW),
        main_cost: numberOrNull(raw.PRIME_COST),
        main_cost_20d: numberOrNull(raw.PRIME_COST_20DAYS),
        main_cost_60d: numberOrNull(raw.PRIME_COST_60DAYS),
        super_large_buy_ratio_raw: numberOrNull(raw.BUY_SUPERDEAL_RATIO),
        large_buy_ratio_raw: numberOrNull(raw.BUY_BIGDEAL_RATIO),
        prime_ratio_raw: numberOrNull(raw.RATIO),
        prime_ratio_3d_raw: numberOrNull(raw.RATIO_3DAYS),
        prime_ratio_50d_raw: numberOrNull(raw.RATIO_50DAYS),
        org_participate_raw: numberOrNull(raw.ORG_PARTICIPATE),
        total_score: numberOrNull(raw.TOTALSCORE),
        rank: numberOrNull(raw.RANK),
        rank_up: numberOrNull(raw.RANK_UP),
        focus: numberOrNull(raw.FOCUS),
        participate_type: textOrNull(raw.PARTICIPATE_TYPE),
    };
}
async function executeMainCapital(params, signal) {
    const url = new URL(DATACENTER_URL);
    url.searchParams.set('reportName', 'RPT_DMSK_TS_STOCKNEW');
    url.searchParams.set('columns', 'ALL');
    url.searchParams.set('source', 'WEB');
    url.searchParams.set('client', 'WEB');
    url.searchParams.set('sortColumns', MAIN_CAPITAL_SORTS[String(params.sort_field)]);
    url.searchParams.set('sortTypes', params.sort_order === 'asc' ? '1' : '-1');
    url.searchParams.set('pageNumber', String(params.page));
    url.searchParams.set('pageSize', String(params.size));
    if (params.ticker)
        url.searchParams.set('filter', `(SECUCODE="${params.ticker}")`);
    const result = requireDatacenterResult(await getJson(url.toString(), signal, 'main capital snapshot'), 'main capital snapshot');
    const parsed = requireRows(result, 'main capital snapshot');
    return { data: { item: parsed.rows.map(parseMainCapitalRow), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(mainCapitalRow) };
}
/** Dividend plans: per-10-share scale comes from `IMPL_PLAN_PROFILE` text; values kept as-is. `IS_KCB`/`PUBLISH_DATE` always null. */
const dividendRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, ticker: { type: 'string' }, name: { type: 'string' },
        report_date: { type: 'string' }, plan_notice_date: { type: 'string' }, notice_date: { type: 'string' },
        equity_record_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        ex_dividend_date: { type: 'string' }, ex_dividend_date_ms: { type: 'integer' },
        ex_dividend_days: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        assign_progress: { type: 'string' }, plan_profile: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        pretax_cash_per_10: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        bonus_shares_per_10: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        converted_shares_per_10: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        bonus_and_converted_per_10: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        total_shares: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        basic_eps: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        book_value_per_share: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        capital_reserve_per_share: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        undistributed_profit_per_share: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        net_profit_yoy_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        dividend_yield_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        post_10d_change_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        pre_10d_change_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        post_30d_change_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: true,
};
function dayValue(value) {
    const text = String(value ?? '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}
function parseDividendRow(raw) {
    if (typeof raw.SECUCODE !== 'string' || !raw.SECUCODE.includes('.')) {
        throw sourceError('Eastmoney dividend row lost its market suffix in SECUCODE', 'eastmoney_invalid_response');
    }
    const exDate = dayValue(raw.EX_DIVIDEND_DATE);
    if (exDate === null)
        throw sourceError('Eastmoney dividend row has invalid EX_DIVIDEND_DATE', 'eastmoney_invalid_response');
    // These three are always populated; equity_record_date may be null until the plan sets one.
    const requiredDates = ['REPORT_DATE', 'PLAN_NOTICE_DATE', 'NOTICE_DATE'].map((key) => {
        const day = dayValue(raw[key]);
        if (day === null)
            throw sourceError(`Eastmoney dividend row is missing ${key}`, 'eastmoney_invalid_response');
        return day;
    });
    const [reportDay, planNoticeDay, noticeDay] = requiredDates;
    return {
        ...normalizeEastmoneySecurityIdentity({ secucode: raw.SECUCODE }),
        name: String(raw.SECURITY_NAME_ABBR ?? ''),
        report_date: reportDay,
        plan_notice_date: planNoticeDay,
        notice_date: noticeDay,
        equity_record_date: dayValue(raw.EQUITY_RECORD_DATE),
        ex_dividend_date: exDate,
        ex_dividend_date_ms: dateMs(exDate),
        ex_dividend_days: numberOrNull(raw.EX_DIVIDEND_DAYS),
        assign_progress: String(raw.ASSIGN_PROGRESS ?? ''),
        plan_profile: textOrNull(raw.IMPL_PLAN_PROFILE),
        pretax_cash_per_10: numberOrNull(raw.PRETAX_BONUS_RMB),
        bonus_shares_per_10: numberOrNull(raw.BONUS_RATIO),
        converted_shares_per_10: numberOrNull(raw.IT_RATIO),
        bonus_and_converted_per_10: numberOrNull(raw.BONUS_IT_RATIO),
        total_shares: numberOrNull(raw.TOTAL_SHARES),
        basic_eps: numberOrNull(raw.BASIC_EPS),
        book_value_per_share: numberOrNull(raw.BVPS),
        capital_reserve_per_share: numberOrNull(raw.PER_CAPITAL_RESERVE),
        undistributed_profit_per_share: numberOrNull(raw.PER_UNASSIGN_PROFIT),
        net_profit_yoy_pct: numberOrNull(raw.PNP_YOY_RATIO),
        dividend_yield_raw: numberOrNull(raw.DIVIDENT_RATIO),
        post_10d_change_raw: numberOrNull(raw.D10_CLOSE_ADJCHRATE),
        pre_10d_change_raw: numberOrNull(raw.BD10_CLOSE_ADJCHRATE),
        post_30d_change_raw: numberOrNull(raw.D30_CLOSE_ADJCHRATE),
    };
}
function normalizeDividend(params) {
    const normalized = normalizeDateRange(params, ['start_date', 'end_date', 'ticker', 'page', 'size']);
    const identity = normalizeEastmoneySecurityIdentity({ secucode: params.ticker });
    return { ...normalized, ticker: identity.thscode };
}
async function executeDividend(params, signal) {
    const url = new URL(DATACENTER_URL);
    url.searchParams.set('reportName', 'RPT_SHAREBONUS_DET');
    url.searchParams.set('columns', 'ALL');
    url.searchParams.set('source', 'WEB');
    url.searchParams.set('client', 'WEB');
    url.searchParams.set('sortColumns', 'EX_DIVIDEND_DATE');
    url.searchParams.set('sortTypes', '-1');
    url.searchParams.set('pageNumber', String(params.page));
    url.searchParams.set('pageSize', String(params.size));
    url.searchParams.set('filter', `(SECUCODE="${params.ticker}")(EX_DIVIDEND_DATE>='${params.start_date}')(EX_DIVIDEND_DATE<='${params.end_date}')`);
    const result = requireDatacenterResult(await getJson(url.toString(), signal, 'dividend plans'), 'dividend plans');
    const parsed = requireRows(result, 'dividend plans');
    return { data: { item: parsed.rows.map(parseDividendRow), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(dividendRow) };
}
/**
 * Holder-count snapshot: `END_DATE` is the report period; `HOLD_NOTICE_DATE` is the disclosure date.
 * New listings have `PRE_HOLDER_NUM=0` and null ratio (no prior period).
 */
const holderRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, ticker: { type: 'string' }, name: { type: 'string' },
        end_date: { type: 'string' }, end_date_ms: { type: 'integer' },
        hold_notice_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        pre_end_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        holder_num: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        pre_holder_num: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        holder_num_change: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        holder_num_ratio_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        avg_market_cap: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        avg_hold_shares: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        total_market_cap: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        total_a_shares: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        close_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        interval_change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        change_shares: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        change_reason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    },
    additionalProperties: true,
};
function parseHolderRow(raw) {
    if (typeof raw.SECUCODE !== 'string' || !raw.SECUCODE.includes('.')) {
        throw sourceError('Eastmoney holder-count row lost its market suffix in SECUCODE', 'eastmoney_invalid_response');
    }
    const endDay = dayValue(raw.END_DATE);
    if (endDay === null)
        throw sourceError('Eastmoney holder-count row has invalid END_DATE', 'eastmoney_invalid_response');
    return {
        ...normalizeEastmoneySecurityIdentity({ secucode: raw.SECUCODE }),
        name: String(raw.SECURITY_NAME_ABBR ?? ''),
        end_date: endDay,
        end_date_ms: dateMs(endDay),
        hold_notice_date: dayValue(raw.HOLD_NOTICE_DATE),
        pre_end_date: dayValue(raw.PRE_END_DATE),
        holder_num: numberOrNull(raw.HOLDER_NUM),
        pre_holder_num: numberOrNull(raw.PRE_HOLDER_NUM),
        holder_num_change: numberOrNull(raw.HOLDER_NUM_CHANGE),
        holder_num_ratio_pct: numberOrNull(raw.HOLDER_NUM_RATIO),
        avg_market_cap: numberOrNull(raw.AVG_MARKET_CAP),
        avg_hold_shares: numberOrNull(raw.AVG_HOLD_NUM),
        total_market_cap: numberOrNull(raw.TOTAL_MARKET_CAP),
        total_a_shares: numberOrNull(raw.TOTAL_A_SHARES),
        close_price: numberOrNull(raw.CLOSE_PRICE),
        interval_change_pct: numberOrNull(raw.INTERVAL_CHRATE),
        change_shares: numberOrNull(raw.CHANGE_SHARES),
        change_reason: textOrNull(raw.CHANGE_REASON),
    };
}
const HOLDER_SORTS = { holder_num: 'HOLDER_NUM', holder_num_ratio_pct: 'HOLDER_NUM_RATIO', total_market_cap: 'TOTAL_MARKET_CAP', end_date: 'END_DATE' };
function normalizeHolder(params) {
    assertKnown(params, ['ticker', 'sort_field', 'sort_order', 'page', 'size']);
    const sort_field = params.sort_field === undefined ? 'holder_num' : String(params.sort_field);
    if (!(sort_field in HOLDER_SORTS))
        throw new Error(`sort_field must be one of ${Object.keys(HOLDER_SORTS).join(', ')}`);
    const sort_order = params.sort_order === undefined ? 'desc' : String(params.sort_order);
    if (sort_order !== 'desc' && sort_order !== 'asc')
        throw new Error('sort_order must be desc or asc');
    const page = params.page === undefined ? 1 : integer(params.page, 'page', 1, Number.MAX_SAFE_INTEGER);
    const size = params.size === undefined ? 100 : integer(params.size, 'size', 1, MAX_PAGE_SIZE);
    if (params.ticker === undefined)
        return { sort_field, sort_order, page, size };
    return { sort_field, sort_order, page, size, ticker: normalizeEastmoneySecurityIdentity({ secucode: params.ticker }).thscode };
}
async function executeHolder(params, signal) {
    const url = new URL(DATACENTER_URL);
    url.searchParams.set('reportName', 'RPT_HOLDERNUMLATEST');
    url.searchParams.set('columns', 'ALL');
    url.searchParams.set('source', 'WEB');
    url.searchParams.set('client', 'WEB');
    url.searchParams.set('sortColumns', HOLDER_SORTS[String(params.sort_field)]);
    url.searchParams.set('sortTypes', params.sort_order === 'asc' ? '1' : '-1');
    url.searchParams.set('pageNumber', String(params.page));
    url.searchParams.set('pageSize', String(params.size));
    if (params.ticker)
        url.searchParams.set('filter', `(SECUCODE="${params.ticker}")`);
    const result = requireDatacenterResult(await getJson(url.toString(), signal, 'holder count snapshot'), 'holder count snapshot');
    const parsed = requireRows(result, 'holder count snapshot');
    return { data: { item: parsed.rows.map(parseHolderRow), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(holderRow) };
}
/**
 * Margin detail: verified identities RZRQYE=RZYE+RQYE, RZRQYECZ=RZYE-RQYE, RZJME=RZMRE-RZCHE,
 * RQJMG=RQMCL-RQCHL. Disclosure freshness differs by market (SH one day ahead of SZ).
 */
const MARGIN_COLUMNS = [
    ['RZYE', 'margin_balance'], ['RQYE', 'short_balance'], ['RZRQYE', 'total_balance'], ['RZRQYECZ', 'balance_gap'],
    ['RZMRE', 'margin_buy'], ['RZCHE', 'margin_repay'], ['RZJME', 'margin_net_buy'],
    ['RQMCL', 'short_sell_volume'], ['RQCHL', 'short_repay_volume'], ['RQJMG', 'short_net_buy_volume'],
    ['RZMRE3D', 'margin_buy_3d'], ['RZMRE5D', 'margin_buy_5d'], ['RZMRE10D', 'margin_buy_10d'],
    ['RZCHE3D', 'margin_repay_3d'], ['RZCHE5D', 'margin_repay_5d'], ['RZCHE10D', 'margin_repay_10d'],
    ['RZJME3D', 'margin_net_buy_3d'], ['RZJME5D', 'margin_net_buy_5d'], ['RZJME10D', 'margin_net_buy_10d'],
    ['RQMCL3D', 'short_sell_volume_3d'], ['RQMCL5D', 'short_sell_volume_5d'], ['RQMCL10D', 'short_sell_volume_10d'],
    ['RQCHL3D', 'short_repay_volume_3d'], ['RQCHL5D', 'short_repay_volume_5d'], ['RQCHL10D', 'short_repay_volume_10d'],
    ['RQJMG3D', 'short_net_buy_volume_3d'], ['RQJMG5D', 'short_net_buy_volume_5d'], ['RQJMG10D', 'short_net_buy_volume_10d'],
    ['SZ', 'total_market_cap'], ['SPJ', 'close_price'], ['ZDF', 'change_pct'],
    ['RCHANGE3DCP', 'change_3d_pct'], ['RCHANGE5DCP', 'change_5d_pct'], ['RCHANGE10DCP', 'change_10d_pct'],
    ['RZYEZB', 'margin_balance_pct'], ['FIN_BALANCE_GR', 'margin_balance_growth_raw'],
];
const marginRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, ticker: { type: 'string' }, name: { type: 'string' },
        trade_date: { type: 'string' }, trade_date_ms: { type: 'integer' },
        market_segment: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        ...Object.fromEntries(MARGIN_COLUMNS.map(([, to]) => [to, { oneOf: [{ type: 'number' }, { type: 'null' }] }])),
    },
    additionalProperties: true,
};
function parseMarginRow(raw, requestedThscode) {
    const day = dayValue(raw.DATE);
    if (day === null)
        throw sourceError('Eastmoney margin row has invalid DATE', 'eastmoney_invalid_response');
    // SCODE has no market suffix, so identity comes from the requested ticker; a mismatched SECUCODE is a row mix-up.
    const secucode = typeof raw.SECUCODE === 'string' ? raw.SECUCODE : '';
    if (secucode && secucode !== requestedThscode) {
        throw sourceError(`Eastmoney margin row SECUCODE ${secucode} does not match requested ${requestedThscode}`, 'eastmoney_invalid_response');
    }
    const row = {
        thscode: requestedThscode,
        ticker: requestedThscode.replace(/\.(SH|SZ|BJ)$/i, ''),
        name: String(raw.SECNAME ?? ''),
        trade_date: day,
        trade_date_ms: dateMs(day),
        market_segment: textOrNull(raw.MARKET),
    };
    for (const [from, to] of MARGIN_COLUMNS)
        row[to] = numberOrNull(raw[from]);
    return row;
}
function normalizeMargin(params) {
    const normalized = normalizeDateRange(params, ['start_date', 'end_date', 'ticker', 'page', 'size']);
    const identity = normalizeEastmoneySecurityIdentity({ secucode: params.ticker });
    return { ...normalized, ticker: identity.thscode };
}
async function executeMargin(params, signal) {
    const url = new URL(DATACENTER_URL);
    url.searchParams.set('reportName', 'RPTA_WEB_RZRQ_GGMX');
    url.searchParams.set('columns', 'ALL');
    url.searchParams.set('source', 'WEB');
    url.searchParams.set('client', 'WEB');
    url.searchParams.set('sortColumns', 'DATE');
    url.searchParams.set('sortTypes', '-1');
    url.searchParams.set('pageNumber', String(params.page));
    url.searchParams.set('pageSize', String(params.size));
    url.searchParams.set('filter', `(SCODE="${String(params.ticker).replace(/\.(SH|SZ|BJ)$/i, '')}")(DATE>='${params.start_date}')(DATE<='${params.end_date}')`);
    const result = requireDatacenterResult(await getJson(url.toString(), signal, 'margin detail'), 'margin detail');
    const parsed = requireRows(result, 'margin detail');
    const thscode = String(params.ticker);
    return { data: { item: parsed.rows.map((raw) => parseMarginRow(raw, thscode)), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(marginRow) };
}
/** Bond list: only terms/dates are populated; price and premium columns are always null (computed elsewhere). */
const BOND_MARKET_SUFFIX = { CNSESH: 'SH', CNSESZ: 'SZ', STAS00: null };
function bondStockIdentity(raw) {
    const digits = String(raw.CONVERT_STOCK_CODE ?? '');
    if (!/^\d{6}$/.test(digits))
        throw sourceError(`Eastmoney convertible bond row has invalid CONVERT_STOCK_CODE ${digits || '(empty)'}`, 'eastmoney_invalid_response');
    return {
        stock_ticker: digits,
        stock_name: String(raw.SECURITY_SHORT_NAME ?? ''),
        // Market only from TRADE_MARKET: 126-prefixed 2007–09 SH bonds and STAS00 stock 400266 would be misattributed. Unknown → null.
        stock_thscode: BOND_MARKET_SUFFIX[String(raw.TRADE_MARKET ?? '')] ? `${digits}.${BOND_MARKET_SUFFIX[String(raw.TRADE_MARKET ?? '')]}` : null,
    };
}
const bondRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, ticker: { type: 'string' }, name: { type: 'string' }, market: { type: 'string' },
        stock_ticker: { type: 'string' }, stock_name: { type: 'string' }, stock_thscode: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        value_date: { type: 'string' }, value_date_ms: { type: 'integer' },
        listing_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        cease_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        expire_date: { type: 'string' },
        delist_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        transfer_start_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        transfer_end_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        bond_expire_years: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        rating: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        rating_agency: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        issue_scale_yi: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        initial_transfer_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        coupon_rate_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        interest_year_start_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        interest_year_end_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        next_cashflow_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        pay_interest_day: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        interest_rate_explain: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        first_preplace_per_share_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        online_lottery_ratio_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        in_conversion_period: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    },
    additionalProperties: true,
};
function parseBondRow(raw) {
    if (typeof raw.SECUCODE !== 'string' || !raw.SECUCODE.includes('.')) {
        throw sourceError('Eastmoney convertible bond row lost its market suffix in SECUCODE', 'eastmoney_invalid_response');
    }
    const valueDate = dayValue(raw.VALUE_DATE);
    if (valueDate === null)
        throw sourceError('Eastmoney convertible bond row is missing VALUE_DATE', 'eastmoney_invalid_response');
    const expireDate = dayValue(raw.EXPIRE_DATE);
    if (expireDate === null)
        throw sourceError('Eastmoney convertible bond row is missing EXPIRE_DATE', 'eastmoney_invalid_response');
    return {
        thscode: raw.SECUCODE,
        ticker: String(raw.SECURITY_CODE ?? ''),
        name: String(raw.SECURITY_NAME_ABBR ?? ''),
        market: String(raw.TRADE_MARKET ?? ''),
        ...bondStockIdentity(raw),
        value_date: valueDate,
        value_date_ms: dateMs(valueDate),
        listing_date: dayValue(raw.LISTING_DATE),
        cease_date: dayValue(raw.CEASE_DATE),
        expire_date: expireDate,
        delist_date: dayValue(raw.DELIST_DATE),
        transfer_start_date: dayValue(raw.TRANSFER_START_DATE),
        transfer_end_date: dayValue(raw.TRANSFER_END_DATE),
        bond_expire_years: numberOrNull(raw.BOND_EXPIRE),
        rating: textOrNull(raw.RATING),
        rating_agency: textOrNull(raw.PARTY_NAME),
        issue_scale_yi: numberOrNull(raw.ACTUAL_ISSUE_SCALE),
        initial_transfer_price: numberOrNull(raw.INITIAL_TRANSFER_PRICE),
        coupon_rate_pct: numberOrNull(raw.COUPON_IR),
        interest_year_start_date: dayValue(raw.IB_START_DATE),
        interest_year_end_date: dayValue(raw.IB_END_DATE),
        next_cashflow_date: dayValue(raw.CASHFLOW_DATE),
        pay_interest_day: textOrNull(raw.PAY_INTEREST_DAY),
        interest_rate_explain: textOrNull(raw.INTEREST_RATE_EXPLAIN),
        first_preplace_per_share_yuan: numberOrNull(raw.FIRST_PER_PREPLACING),
        online_lottery_ratio_pct: numberOrNull(raw.ONLINE_GENERAL_LWR),
        in_conversion_period: textOrNull(raw.IS_CONVERT_STOCK),
    };
}
/** Strip .SH/.SZ/.NQ suffixes; never infer a market. */
function bondCode(value, name) {
    const raw = String(value).toUpperCase();
    const digits = raw.replace(/\.[A-Z]{2,3}$/u, '');
    if (digits !== raw && !/(?:\.SH|\.SZ|\.BJ|\.NQ)$/u.test(raw))
        throw new Error(`${name} has an unrecognized market suffix: ${raw}`);
    if (!/^\d{6}$/.test(digits))
        throw new Error(`${name} must be a six-digit code (a market suffix such as .SH is accepted and ignored)`);
    return digits;
}
function normalizeBondList(params) {
    const normalized = normalizeDateRange(params, ['start_date', 'end_date', 'bond_code', 'stock_code', 'page', 'size']);
    const result = { ...normalized };
    if (params.bond_code !== undefined)
        result.bond_code = bondCode(params.bond_code, 'bond_code');
    if (params.stock_code !== undefined)
        result.stock_code = bondCode(params.stock_code, 'stock_code');
    return result;
}
async function executeBondList(params, signal) {
    const url = new URL(DATACENTER_URL);
    url.searchParams.set('reportName', 'RPT_BOND_CB_LIST');
    url.searchParams.set('columns', 'ALL');
    url.searchParams.set('source', 'WEB');
    url.searchParams.set('client', 'WEB');
    // Use PUBLIC_START_DATE: the only date filter never null (equals VALUE_DATE); LISTING_DATE would drop 8 unlisted bonds.
    url.searchParams.set('sortColumns', 'PUBLIC_START_DATE');
    url.searchParams.set('sortTypes', '-1');
    url.searchParams.set('pageNumber', String(params.page));
    url.searchParams.set('pageSize', String(params.size));
    const filters = [`(PUBLIC_START_DATE>='${params.start_date}')(PUBLIC_START_DATE<='${params.end_date}')`];
    if (params.bond_code !== undefined)
        filters.push(`(SECURITY_CODE="${params.bond_code}")`);
    if (params.stock_code !== undefined)
        filters.push(`(CONVERT_STOCK_CODE="${params.stock_code}")`);
    url.searchParams.set('filter', filters.join(''));
    const result = requireDatacenterResult(await getJson(url.toString(), signal, 'convertible bond list'), 'convertible bond list');
    const parsed = requireRows(result, 'convertible bond list');
    return { data: { item: parsed.rows.map(parseBondRow), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(bondRow) };
}
function createSource(options) {
    const schema = { capability: options.capability, time_contract: getDataTimeContract(options.capability), name: options.name, source: `http:eastmoney.${options.capability}`, data_key: buildDataKey('eastmoney', 'http', options.capability), source_label: 'eastmoney', paginated: options.paginated === true, cacheMaxAgeMs: options.cacheMaxAgeMs, rowShape: options.rowShape, summary: options.summary, description: options.description, input_schema: options.inputSchema, output_schema: options.outputSchema };
    const normalize = (params) => options.normalize(params);
    const validateOutput = options.validateOutput ?? ((data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination));
    return { schema, normalizeParams: normalize, validateOutput, execute: async (request, signal) => options.execute(normalize(request.params), signal) };
}
const dateRangeInput = {
    type: 'object', properties: { start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD' }, end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD' }, page: { type: 'integer', minimum: 1 }, size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE } }, required: ['start_date', 'end_date'], additionalProperties: false,
};
const boardInput = {
    type: 'object', properties: { board_type: { type: 'string', enum: [...BOARD_TYPES] }, sort_field: { type: 'string', enum: Object.keys(SORT_FIELDS) }, page: { type: 'integer', minimum: 1 }, size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE } }, required: [], additionalProperties: false,
};
const cashflowInput = {
    type: 'object', properties: { board_type: { type: 'string', enum: [...BOARD_TYPES] }, page: { type: 'integer', minimum: 1 }, size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE } }, required: [], additionalProperties: false,
};
const mutualFlowInput = {
    type: 'object',
    properties: {
        start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD' },
        end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD' },
        channel: { type: 'string', enum: MUTUAL_CHANNEL_NAMES, description: '渠道，默认 north_total（北向合计）' },
        page: { type: 'integer', minimum: 1 },
        size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
    },
    required: ['start_date', 'end_date'],
    additionalProperties: false,
};
const snapshotInput = { type: 'object', properties: {}, required: [], additionalProperties: false };
const mainCapitalInput = {
    type: 'object',
    properties: {
        ticker: { type: 'string', description: '完整证券代码（带市场后缀，如 600519.SH）；省略则取全市场排名' },
        sort_field: { type: 'string', enum: Object.keys(MAIN_CAPITAL_SORTS), description: '排序列，默认 main_net_inflow' },
        sort_order: { type: 'string', enum: ['desc', 'asc'] },
        page: { type: 'integer', minimum: 1 },
        size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
    },
    required: [],
    additionalProperties: false,
};
const holderInput = {
    type: 'object',
    properties: {
        ticker: { type: 'string', description: '完整证券代码（带市场后缀，如 600519.SH）；省略则取全市场截面' },
        sort_field: { type: 'string', enum: Object.keys(HOLDER_SORTS), description: '排序列，默认 holder_num' },
        sort_order: { type: 'string', enum: ['desc', 'asc'] },
        page: { type: 'integer', minimum: 1 },
        size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
    },
    required: [],
    additionalProperties: false,
};
const tickerRangeInput = {
    type: 'object',
    properties: {
        ticker: { type: 'string', description: '完整证券代码（带市场后缀，如 600519.SH）' },
        start_date: { type: 'string', description: '除权除息日区间起点 YYYY-MM-DD' },
        end_date: { type: 'string', description: '除权除息日区间终点 YYYY-MM-DD' },
        page: { type: 'integer', minimum: 1 },
        size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
    },
    required: ['ticker', 'start_date', 'end_date'],
    additionalProperties: false,
};
const bondListInput = {
    type: 'object',
    properties: {
        start_date: { type: 'string', description: '起息日区间起点 YYYY-MM-DD' },
        end_date: { type: 'string', description: '起息日区间终点 YYYY-MM-DD' },
        bond_code: { type: 'string', description: '可转债代码（六位数字，可带市场后缀）；省略则取区间内全部转债' },
        stock_code: { type: 'string', description: '正股代码（六位数字，可带市场后缀）；与 bond_code 同时给则取交集' },
        page: { type: 'integer', minimum: 1 },
        size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
    },
    required: ['start_date', 'end_date'],
    additionalProperties: false,
};
const globalQuoteInput = {
    type: 'object',
    properties: {
        symbols: {
            type: 'array', minItems: 1, maxItems: GLOBAL_SYMBOL_NAMES.length,
            items: { type: 'string', enum: GLOBAL_SYMBOL_NAMES },
            description: '稳定符号；未知符号在参数层拒绝。可用：SPX/NDX/DJIA/HSI/HSCEI/N225/SXXP/FCHI/FTSE/AS51/HSAHP/UDI/USDCNH/US10Y/US2Y/CL00Y/GC00Y/HG00Y',
        },
    },
    required: ['symbols'],
    additionalProperties: false,
};
const globalKlineInput = {
    type: 'object',
    properties: {
        symbol: { type: 'string', enum: GLOBAL_SYMBOL_NAMES, description: '稳定符号，与 eastmoney_global_quote 同一注册表' },
        period: { type: 'string', enum: Object.keys(GLOBAL_PERIODS), description: '默认 day；只支持日/周/月，没有分钟线' },
        start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD' },
        end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD' },
    },
    required: ['symbol', 'start_date', 'end_date'],
    additionalProperties: false,
};
const marketMarginInput = {
    type: 'object',
    properties: {
        start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD' },
        end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD' },
        market: { type: 'string', enum: ['all', 'sse', 'szse', 'bse'], description: '默认 all；sse 沪市 / szse 深市 / bse 北交所' },
        page: { type: 'integer', minimum: 1 },
        size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
    },
    required: ['start_date', 'end_date'],
    additionalProperties: false,
};
const PROFILING_URL = 'https://push2.eastmoney.com/api/qt/stock/get';
/**
 * push2 secid market digit: SH is `1`, SZ and BJ share `0`. 5x ETFs/LOFs, 588x STAR ETFs and 900x
 * SH B-shares are SH — a `6`-prefix guess routes them to `0.` and upstream answers `data: null`.
 * 92x (BSE since 2024-10) must be tested before 9x. Never derive a market from one leading digit.
 */
function eastmoneySecidMarketId(digits) {
    if (/^92/u.test(digits))
        return '0';
    return /^[569]/u.test(digits) ? '1' : '0';
}
/** A-share market implied by the secid rule: SH when the market digit is 1, else BJ on 4x/8x/92x. */
function eastmoneyAshareMarket(digits) {
    if (eastmoneySecidMarketId(digits) === '1')
        return 'SH';
    return /^(?:4|8|92)/u.test(digits) ? 'BJ' : 'SZ';
}
const TICKER_FORM = /^(?:(\d{6})(?:\.(SH|SZ|BJ))?|(SH|SZ|BJ)(\d{6}))$/u;
/**
 * Canonical `600519.SH` for stock-keyed capabilities. A bare code reads as the A-share of that
 * number (`000001` = 平安银行, not 上证指数); an explicit market that disagrees with the A-share
 * prefix is rejected rather than rewritten, so `000001.SH` cannot silently become 平安银行 rows.
 */
function ashareThscode(value, name = 'ticker') {
    if (typeof value !== 'string')
        throw new Error(`${name} must be a string`);
    const match = TICKER_FORM.exec(value.trim().toUpperCase());
    if (!match)
        throw new Error(`${name} must be a six-digit A-share code, optionally with a market suffix (e.g. 600519 or 600519.SH)`);
    const digits = String(match[1] ?? match[4]);
    const derived = eastmoneyAshareMarket(digits);
    const declared = (match[2] ?? match[3]);
    if (declared !== undefined && declared !== derived) {
        throw new Error(`${name} market ${declared} conflicts with the A-share code prefix (resolved ${derived}); index/ETF-style codes are not accepted`);
    }
    return `${digits}.${derived}`;
}
/** Upstream `20010827`-style compact date; invalid or empty becomes null, never a 1970 timestamp. */
function compactDay(value) {
    const text = String(value ?? '').trim();
    if (!/^\d{8}$/u.test(text))
        return null;
    const day = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    const parsed = new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}
const profileRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, ticker: { type: 'string' }, name: { type: 'string' },
        market: { type: 'string', enum: ['SH', 'SZ', 'BJ'] }, eastmoney_secid: { type: 'string' },
        industry: nullableString,
        total_shares: nullableNumber, float_shares: nullableNumber,
        total_market_cap: nullableNumber, float_market_cap: nullableNumber,
        list_date: nullableString, list_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        pe_dynamic: nullableNumber, pb: nullableNumber,
    },
    required: ['thscode', 'ticker', 'name', 'market', 'eastmoney_secid', 'industry', 'total_shares', 'float_shares', 'total_market_cap', 'float_market_cap', 'list_date', 'list_date_ms', 'pe_dynamic', 'pb'],
    additionalProperties: false,
};
const profileInput = {
    type: 'object',
    properties: {
        ticker: { type: 'string', description: '六位代码或带市场后缀（600519 / 600519.SH / sh600519）；裸代码按 A 股个股解析（000001 = 平安银行，不是上证指数），指数/ETF 不接受' },
    },
    required: ['ticker'],
    additionalProperties: false,
};
function normalizeProfile(params) {
    assertKnown(params, ['ticker']);
    return { ticker: ashareThscode(params.ticker) };
}
function parseProfileRow(data, thscode) {
    const [digits, market] = thscode.split('.');
    if (String(data.f57 ?? '') !== digits || typeof data.f58 !== 'string' || data.f58.trim().length === 0) {
        throw sourceError(`Eastmoney profile response does not match ${thscode}`, 'eastmoney_invalid_response');
    }
    const totalShares = numberOrNull(data.f84);
    // Indexes/funds answer with a code and name but no share capital; reporting them as a "stock
    // profile" would hand back a row of nulls.
    if (totalShares === null || totalShares <= 0) {
        throw sourceError(`Eastmoney profile for ${thscode} has no share capital (indexes and funds are out of scope)`, 'eastmoney_invalid_ticker');
    }
    const listDate = compactDay(data.f189);
    return {
        thscode, ticker: digits, name: data.f58.trim(), market, eastmoney_secid: `${eastmoneySecidMarketId(digits)}.${digits}`,
        industry: textOrNull(data.f127),
        total_shares: totalShares,
        float_shares: numberOrNull(data.f85),
        total_market_cap: numberOrNull(data.f116),
        float_market_cap: numberOrNull(data.f117),
        list_date: listDate,
        list_date_ms: listDate === null ? null : dateMs(listDate),
        // f162 = 市盈率(动态) and f167 = 市净率: verified against datacenter PE_DYNAMIC 21.6075 and
        // price / BPS (1485.75 / 216.9496 = 6.848) for 600519 on 2026-11-20. f9/f23 are not returned here.
        pe_dynamic: numberOrNull(data.f162),
        pb: numberOrNull(data.f167),
    };
}
async function executeProfile(params, signal) {
    const thscode = String(params.ticker);
    const digits = thscode.slice(0, 6);
    const url = new URL(PROFILING_URL);
    url.searchParams.set('fltt', '2');
    url.searchParams.set('invt', '2');
    url.searchParams.set('secid', `${eastmoneySecidMarketId(digits)}.${digits}`);
    url.searchParams.set('fields', 'f57,f58,f84,f85,f116,f117,f127,f162,f167,f189');
    const payload = await getJson(url.toString(), signal, `security profile ${thscode}`);
    if (Number(payload.rc) !== 0)
        throw sourceError(`Eastmoney profile failed for ${thscode}: rc ${String(payload.rc)}`, 'eastmoney_upstream_error');
    if (payload.data === null || payload.data === undefined) {
        throw sourceError(`Eastmoney profile returned no data for ${thscode} (unknown code or wrong secid market)`, 'eastmoney_invalid_ticker');
    }
    if (!isRecord(payload.data))
        throw sourceError('Eastmoney profile returned a non-object data', 'eastmoney_invalid_response');
    return { data: { item: [parseProfileRow(payload.data, thscode)], pagination: pagination(1, 1, 1, 1) }, schema: datacenterOutput(profileRow) };
}
const ST_MARKETS = ['sh', 'sz', 'bj'];
/** Eastmoney risk-warning board: `m:1` SH, `m:0` SZ — the SZ arm also returns BSE codes (see execute). */
const ST_RISK_BOARD_FS = { sh: 'm:1+f:4', sz: 'm:0+f:4' };
/** BSE full A-share list; BSE ST names must be filtered by name, not by the risk-warning flag. */
const ST_BSE_FS = 'm:0+t:81+s:2048';
const ST_CLIST_FIELDS = 'f12,f13,f14,f2,f3,f4,f5,f6,f7,f8';
const ST_PAGE_SIZE = 100;
const ST_MAX_PAGES = 30;
const stStockRow = {
    type: 'object',
    properties: {
        code: { type: 'string' }, name: { type: 'string' }, market: { type: 'string', enum: ['sh', 'sz', 'bj'] },
        share_type: { type: 'string', enum: ['a_share', 'b_share'] }, st_type: { type: 'string', enum: ['ST', '*ST'] },
        price: nullableNumber, change_pct: nullableNumber, change_amount: nullableNumber,
        volume: nullableNumber, amount: nullableNumber, amplitude_pct: nullableNumber, turnover_pct: nullableNumber,
    },
    required: ['code', 'name', 'market', 'share_type', 'st_type', 'price', 'change_pct', 'change_amount', 'volume', 'amount', 'amplitude_pct', 'turnover_pct'],
    additionalProperties: false,
};
const stStockListInput = {
    type: 'object',
    properties: {
        market: { type: 'string', enum: ['all', 'sh', 'sz', 'bj'], description: '默认 all；按市场分别取沪风险警示板 / 深风险警示板 / 北交所全表名称筛' },
    },
    required: [],
    additionalProperties: false,
};
const stStockListOutput = {
    type: 'object',
    properties: {
        item: { type: 'array', items: stStockRow },
        total: { type: 'integer' },
        markets: { type: 'array', items: { type: 'string', enum: [...ST_MARKETS] } },
        by_market: {
            type: 'object',
            properties: { sh: { type: 'integer' }, sz: { type: 'integer' }, bj: { type: 'integer' } },
            required: ['sh', 'sz', 'bj'], additionalProperties: false,
        },
    },
    required: ['item', 'total', 'markets', 'by_market'],
    additionalProperties: false,
};
function normalizeStStockList(params) {
    assertKnown(params, ['market']);
    const market = params.market === undefined ? 'all' : String(params.market).toLowerCase();
    if (market !== 'all' && !ST_MARKETS.includes(market))
        throw new Error(`market must be one of all, ${ST_MARKETS.join(', ')}`);
    return { market };
}
/** `f12`-only classification: BSE legacy 4x/8x and 920x, SH 5x/6x/9x, everything else SZ. */
function stMarketOf(code) {
    if (/^(?:4|8|92)/u.test(code))
        return 'bj';
    if (/^[569]/u.test(code))
        return 'sh';
    return 'sz';
}
async function fetchCListAll(fs, signal, context) {
    const rows = [];
    let total = null;
    for (let page = 1; page <= ST_MAX_PAGES; page += 1) {
        const url = new URL(CLIST_URL);
        url.searchParams.set('pn', String(page));
        url.searchParams.set('pz', String(ST_PAGE_SIZE));
        url.searchParams.set('po', '1');
        url.searchParams.set('np', '1');
        url.searchParams.set('ut', EASTMONEY_UT);
        url.searchParams.set('fltt', '2');
        url.searchParams.set('invt', '2');
        url.searchParams.set('fid', 'f12');
        url.searchParams.set('fs', fs);
        url.searchParams.set('fields', ST_CLIST_FIELDS);
        const data = requireCList(await getJson(url.toString(), signal, context), context);
        if (!Array.isArray(data.diff) || typeof data.total !== 'number' || !data.diff.every(isRecord))
            throw sourceError(`Eastmoney ${context} result shape changed`, 'eastmoney_invalid_response');
        // A list that changes between pages would mix two snapshots; fail instead of returning a blend.
        if (total !== null && data.total !== total)
            throw sourceError(`Eastmoney ${context} total changed from ${total} to ${data.total} while paging; retry`, 'eastmoney_invalid_response');
        total = data.total;
        rows.push(...data.diff);
        if (rows.length >= total || data.diff.length === 0)
            break;
    }
    if (total === null)
        throw sourceError(`Eastmoney ${context} returned no total`, 'eastmoney_invalid_response');
    if (rows.length !== total)
        throw sourceError(`Eastmoney ${context} returned ${rows.length} of ${total} rows`, 'eastmoney_invalid_response');
    return rows;
}
function parseStStockRow(raw, market) {
    const code = String(raw.f12 ?? '');
    const name = String(raw.f14 ?? '').trim();
    if (!/^\d{6}$/u.test(code) || name.length === 0)
        throw sourceError('Eastmoney risk-warning row has an unusable code or name', 'eastmoney_invalid_response');
    // Every SH/SZ risk-warning row must carry the ST marker; a missing one means the flag changed.
    if (!/ST/iu.test(name))
        throw sourceError(`Eastmoney risk-warning row ${code} has no ST marker in its name (${name})`, 'eastmoney_invalid_response');
    return {
        code, name, market, share_type: /^(?:2|9)/u.test(code) ? 'b_share' : 'a_share',
        st_type: name.startsWith('*') ? '*ST' : 'ST',
        // Suspended/halted rows ship `-` in the quote columns; numberOrNull keeps them null, never 0.
        price: numberOrNull(raw.f2),
        change_pct: numberOrNull(raw.f3),
        change_amount: numberOrNull(raw.f4),
        volume: numberOrNull(raw.f5),
        amount: numberOrNull(raw.f6),
        amplitude_pct: numberOrNull(raw.f7),
        turnover_pct: numberOrNull(raw.f8),
    };
}
async function executeStStockList(params, signal) {
    const requested = String(params.market);
    const markets = requested === 'all' ? [...ST_MARKETS] : [requested];
    const rows = [];
    for (const market of markets) {
        if (market === 'bj') {
            const list = await fetchCListAll(ST_BSE_FS, signal, 'BSE full list');
            // An empty BSE list would turn "no data" into "no ST on BSE"; the name filter needs the list.
            if (list.length === 0)
                throw sourceError('Eastmoney BSE full list is empty; refusing to report "no ST on BSE"', 'eastmoney_invalid_response');
            for (const raw of list)
                if (/ST/iu.test(String(raw.f14 ?? '')))
                    rows.push(parseStStockRow(raw, 'bj'));
            continue;
        }
        const board = await fetchCListAll(ST_RISK_BOARD_FS[market], signal, `${market === 'sh' ? 'SH' : 'SZ'} risk-warning board`);
        // Always non-empty in practice: an empty board is an upstream break, not "no ST stocks today".
        if (board.length === 0)
            throw sourceError(`Eastmoney ${market} risk-warning board returned no rows; refusing to call it an empty ST list`, 'eastmoney_invalid_response');
        for (const raw of board) {
            const code = String(raw.f12 ?? '');
            // Verified 2026-11-22: the m:0 board carries 189 BSE codes (186 legacy 430x/83x/87x that are no
            // longer in the BSE list). They belong to the BSE arm, which filters the current list by name.
            if (stMarketOf(code) === 'bj')
                continue;
            if (stMarketOf(code) !== market)
                throw sourceError(`Eastmoney ${market} risk-warning board returned ${code} as ${stMarketOf(code)}`, 'eastmoney_invalid_response');
            rows.push(parseStStockRow(raw, market));
        }
    }
    const seen = new Set();
    for (const row of rows) {
        const code = String(row.code);
        if (seen.has(code))
            throw sourceError(`Eastmoney ST list contains duplicate code ${code}`, 'eastmoney_invalid_response');
        seen.add(code);
    }
    const order = { sh: 0, sz: 1, bj: 2 };
    rows.sort((left, right) => (order[String(left.market)] - order[String(right.market)]) || String(left.code).localeCompare(String(right.code)));
    const by_market = { sh: 0, sz: 0, bj: 0 };
    for (const row of rows)
        by_market[String(row.market)] += 1;
    return {
        data: { item: rows, total: rows.length, markets, by_market },
        schema: stStockListOutput,
    };
}
const EVENT_DEFAULT_SIZE = 100;
/** Optional ticker + optional closed date range + page/size: the shape shared by the event tables. */
function eventInput(options) {
    return {
        type: 'object',
        properties: {
            ticker: { type: 'string', description: options.ticker },
            start_date: { type: 'string', description: options.startDate },
            end_date: { type: 'string', description: options.endDate },
            ...(options.extra ?? {}),
            page: { type: 'integer', minimum: 1 },
            size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
        },
        required: [],
        additionalProperties: false,
    };
}
/** Values-only canonicalization: keys stay exactly those the model declared (§10.7) and a second
 * pass over the result is a no-op. Dates are optional but must come as a pair. */
function normalizeEvent(params, extraKeys = []) {
    assertKnown(params, ['ticker', 'start_date', 'end_date', 'page', 'size', ...extraKeys]);
    const page = params.page === undefined ? 1 : integer(params.page, 'page', 1, Number.MAX_SAFE_INTEGER);
    const size = params.size === undefined ? EVENT_DEFAULT_SIZE : integer(params.size, 'size', 1, MAX_PAGE_SIZE);
    const normalized = { page, size };
    if (params.ticker !== undefined)
        normalized.ticker = ashareThscode(params.ticker);
    const start = params.start_date === undefined ? undefined : date(params.start_date, 'start_date');
    const end = params.end_date === undefined ? undefined : date(params.end_date, 'end_date');
    if ((start === undefined) !== (end === undefined))
        throw new Error('start_date and end_date must be given together');
    if (start !== undefined && end !== undefined) {
        if (start > end)
            throw new Error('start_date must not be later than end_date');
        normalized.start_date = start;
        normalized.end_date = end;
    }
    return normalized;
}
function eventFilter(parts) { return parts.join(''); }
function eventTickerFilter(field, ticker) {
    return ticker === undefined ? [] : [`(${field}="${String(ticker).slice(0, 6)}")`];
}
function eventDateFilter(field, params) {
    return params.start_date === undefined ? [] : [`(${field}>='${String(params.start_date)}')(${field}<='${String(params.end_date)}')`];
}
async function fetchEventPage(spec, signal) {
    const url = new URL(DATACENTER_URL);
    url.searchParams.set('reportName', spec.reportName);
    url.searchParams.set('columns', 'ALL');
    url.searchParams.set('source', 'WEB');
    url.searchParams.set('client', 'WEB');
    url.searchParams.set('sortColumns', spec.sortColumns);
    url.searchParams.set('sortTypes', spec.sortTypes);
    url.searchParams.set('pageNumber', String(spec.page));
    url.searchParams.set('pageSize', String(spec.size));
    if (spec.filter.length > 0)
        url.searchParams.set('filter', spec.filter);
    const result = requireDatacenterResult(await getJson(url.toString(), signal, spec.context), spec.context);
    return requireRows(result, spec.context);
}
/** SECUCODE when the table carries it, else the 6-digit code column with the A-share digit rule. */
function rowIdentity(raw, context, codeField) {
    if (typeof raw.SECUCODE === 'string' && raw.SECUCODE.includes('.'))
        return { ...normalizeEastmoneySecurityIdentity({ secucode: raw.SECUCODE }) };
    const code = String(raw[codeField] ?? '');
    if (!/^\d{6}$/u.test(code))
        throw sourceError(`Eastmoney ${context} row has no usable security code`, 'eastmoney_invalid_response');
    return { ...normalizeEastmoneyAshareIdentity(code) };
}
function eventRowSchema(properties) {
    return {
        type: 'object',
        properties: {
            thscode: { type: 'string' }, ticker: { type: 'string' }, eastmoney_code: { type: 'string' },
            eastmoney_market: { type: 'string', enum: ['SH', 'SZ', 'BJ'] }, name: { type: 'string' },
            ...properties,
        },
        required: ['thscode', 'ticker', 'eastmoney_code', 'eastmoney_market', 'name', ...Object.keys(properties)],
        additionalProperties: false,
    };
}
const institutionResearchRow = eventRowSchema({
    notice_date: { type: 'string' }, notice_date_ms: { type: 'integer' },
    survey_start_date: nullableString, survey_end_date: nullableString,
    org_count: nullableNumber, survey_way: nullableString, reception_place: nullableString, receptionist: nullableString,
});
const institutionResearchInput = eventInput({
    ticker: '个股代码（600519 或 600519.SH）；省略取全市场',
    startDate: '公告日区间起点 YYYY-MM-DD（NOTICE_DATE）',
    endDate: '公告日区间终点 YYYY-MM-DD（NOTICE_DATE）',
});
function normalizeInstitutionResearch(params) { return normalizeEvent(params); }
function parseInstitutionResearchRow(raw) {
    const notice = dayValue(raw.NOTICE_DATE);
    if (notice === null)
        throw sourceError('Eastmoney institution survey row has invalid NOTICE_DATE', 'eastmoney_invalid_response');
    return {
        ...rowIdentity(raw, 'institution survey', 'SECURITY_CODE'),
        name: String(raw.SECURITY_NAME_ABBR ?? ''),
        notice_date: notice,
        notice_date_ms: dateMs(notice),
        survey_start_date: dayValue(raw.RECEIVE_START_DATE),
        survey_end_date: dayValue(raw.RECEIVE_END_DATE),
        org_count: numberOrNull(raw.SUM),
        survey_way: textOrNull(raw.RECEIVE_WAY_EXPLAIN),
        reception_place: textOrNull(raw.RECEIVE_PLACE),
        receptionist: textOrNull(raw.RECEPTIONIST),
    };
}
async function executeInstitutionResearch(params, signal) {
    // Aggregate rows only: NUMBERNEW="1" keeps one row per survey and SUM is the reported org count.
    const filter = eventFilter(['(IS_SOURCE="1")(NUMBERNEW="1")', ...eventTickerFilter('SECURITY_CODE', params.ticker), ...eventDateFilter('NOTICE_DATE', params)]);
    // Sort uniqueness (verified 2026-11-22): NOTICE_DATE 2026-11-01..2026-11-21 = 1728 rows over 4 pages
    // of 500 → 0 duplicate (NOTICE_DATE, SECURITY_CODE, RECEIVE_START_DATE) tuples, 0 duplicate rows.
    const parsed = await fetchEventPage({ reportName: 'RPT_ORG_SURVEYNEW', context: 'institution survey', filter, sortColumns: 'NOTICE_DATE,SECURITY_CODE,RECEIVE_START_DATE', sortTypes: '-1,1,-1', page: Number(params.page), size: Number(params.size) }, signal);
    return { data: { item: parsed.rows.map(parseInstitutionResearchRow), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(institutionResearchRow) };
}
const HOLDER_DIRECTION_CODE = { increase: '增持', decrease: '减持' };
const HOLDER_DIRECTION_TEXT = { 增持: 'increase', 减持: 'decrease' };
const holderChangeRow = eventRowSchema({
    notice_date: { type: 'string' }, notice_date_ms: { type: 'integer' },
    holder_name: { type: 'string' }, direction: { type: 'string', enum: ['increase', 'decrease'] },
    change_shares_10k: nullableNumber, change_pct_total: nullableNumber, change_pct_float: nullableNumber,
    after_hold_shares_10k: nullableNumber, after_pct_total: nullableNumber,
    after_float_hold_shares_10k: nullableNumber, after_pct_float: nullableNumber,
    avg_price: nullableNumber, channel: nullableString, start_date: nullableString, end_date: nullableString,
});
const holderChangeInput = eventInput({
    ticker: '个股代码（600519 或 600519.SH）；省略取全市场',
    startDate: '公告日区间起点 YYYY-MM-DD（NOTICE_DATE）',
    endDate: '公告日区间终点 YYYY-MM-DD（NOTICE_DATE）',
    extra: { direction: { type: 'string', enum: ['increase', 'decrease'], description: '增持 increase / 减持 decrease；省略取两种' } },
});
function normalizeHolderChange(params) {
    const normalized = normalizeEvent(params, ['direction']);
    if (params.direction === undefined)
        return normalized;
    const direction = String(params.direction).toLowerCase();
    if (!(direction in HOLDER_DIRECTION_CODE))
        throw new Error('direction must be one of increase, decrease');
    return { ...normalized, direction };
}
function parseHolderChangeRow(raw) {
    const notice = dayValue(raw.NOTICE_DATE);
    if (notice === null)
        throw sourceError('Eastmoney holder change row has invalid NOTICE_DATE', 'eastmoney_invalid_response');
    const direction = HOLDER_DIRECTION_TEXT[String(raw.DIRECTION ?? '')];
    if (direction === undefined)
        throw sourceError(`Eastmoney holder change row has unknown DIRECTION ${String(raw.DIRECTION ?? '(empty)')}`, 'eastmoney_invalid_response');
    const changeShares = numberOrNull(raw.CHANGE_NUM_SYMBOL);
    // Upstream ships a signed share count plus a separate direction; a mismatch would silently flip
    // 增持 into 减持 for consumers reading only the number.
    if (changeShares !== null && changeShares !== 0 && (changeShares < 0) !== (direction === 'decrease')) {
        throw sourceError('Eastmoney holder change row flips the signed share count against DIRECTION', 'eastmoney_invalid_response');
    }
    return {
        ...rowIdentity(raw, 'holder change', 'SECURITY_CODE'),
        name: String(raw.SECURITY_NAME_ABBR ?? ''),
        notice_date: notice,
        notice_date_ms: dateMs(notice),
        holder_name: String(raw.HOLDER_NAME ?? ''),
        direction,
        change_shares_10k: changeShares,
        // ⛔ AFTER_CHANGE_RATE is the move's share of total shares, not the post-move holding ratio:
        // 000915 moved 213.04万股 → 0.909 here while HOLD_RATIO (holding after) is 24.17.
        change_pct_total: numberOrNull(raw.AFTER_CHANGE_RATE),
        change_pct_float: numberOrNull(raw.CHANGE_FREE_RATIO),
        after_hold_shares_10k: numberOrNull(raw.AFTER_HOLDER_NUM),
        after_pct_total: numberOrNull(raw.HOLD_RATIO),
        after_float_hold_shares_10k: numberOrNull(raw.FREE_SHARES),
        after_pct_float: numberOrNull(raw.FREE_SHARES_RATIO),
        avg_price: numberOrNull(raw.TRADE_AVERAGE_PRICE),
        channel: textOrNull(raw.MARKET),
        start_date: dayValue(raw.START_DATE),
        end_date: dayValue(raw.END_DATE),
    };
}
async function executeHolderChange(params, signal) {
    const directionFilter = params.direction === undefined ? [] : [`(DIRECTION="${HOLDER_DIRECTION_CODE[String(params.direction)]}")`];
    const filter = eventFilter([...directionFilter, ...eventTickerFilter('SECURITY_CODE', params.ticker), ...eventDateFilter('NOTICE_DATE', params)]);
    // Sort uniqueness (verified 2026-11-22): NOTICE_DATE 2026-06-01..2026-11-21 = 2969 rows over 6 pages
    // of 500 → 0 duplicate identity tuples and 0 duplicate rows.
    const parsed = await fetchEventPage({ reportName: 'RPT_SHARE_HOLDER_INCREASE', context: 'holder change', filter, sortColumns: 'NOTICE_DATE,SECURITY_CODE,HOLDER_NAME,START_DATE,END_DATE', sortTypes: '-1,1,1,1,1', page: Number(params.page), size: Number(params.size) }, signal);
    return { data: { item: parsed.rows.map(parseHolderChangeRow), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(holderChangeRow) };
}
/** 001–006 have names; 007/008 appear in the table (63 + 1 of 5846 rows on 2026-11-22) but upstream
 * never names them, so `progress` stays null and `progress_code` keeps the raw code. */
const BUYBACK_PROGRESS = { '001': '董事会预案', '002': '股东大会通过', '003': '股东大会否决', '004': '实施中', '005': '停止实施', '006': '完成实施' };
const BUYBACK_PROGRESS_CODE = Object.fromEntries(Object.entries(BUYBACK_PROGRESS).map(([code, label]) => [label, code]));
const BUYBACK_PROGRESS_NAMES = Object.keys(BUYBACK_PROGRESS_CODE);
const buybackRow = eventRowSchema({
    progress: { oneOf: [{ type: 'string', enum: BUYBACK_PROGRESS_NAMES }, { type: 'null' }] },
    progress_code: { type: 'string' },
    update_date: { type: 'string' }, update_date_ms: { type: 'integer' },
    plan_notice_date: nullableString, latest_notice_date: nullableString, finish_date: nullableString,
    plan_start_date: nullableString, plan_end_date: nullableString,
    price_cap: nullableNumber,
    plan_shares_lower: nullableNumber, plan_shares_upper: nullableNumber,
    plan_amount_lower: nullableNumber, plan_amount_upper: nullableNumber,
    plan_pct_total_lower: nullableNumber, plan_pct_total_upper: nullableNumber,
    done_shares: nullableNumber, done_amount: nullableNumber,
    done_price_low: nullableNumber, done_price_high: nullableNumber,
    objective: nullableString,
});
const buybackInput = eventInput({
    ticker: '个股代码（000333 或 000333.SZ）；省略取全市场',
    startDate: '数据更新日区间起点 YYYY-MM-DD（UPD，不是方案公告日）',
    endDate: '数据更新日区间终点 YYYY-MM-DD（UPD）',
    extra: { progress: { type: 'string', enum: BUYBACK_PROGRESS_NAMES, description: '方案进度；省略取全部（含上游未命名的 007/008 码）' } },
});
function normalizeBuyback(params) {
    const normalized = normalizeEvent(params, ['progress']);
    if (params.progress === undefined)
        return normalized;
    const progress = String(params.progress);
    if (!(progress in BUYBACK_PROGRESS_CODE))
        throw new Error(`progress must be one of ${BUYBACK_PROGRESS_NAMES.join(', ')}`);
    return { ...normalized, progress };
}
function parseBuybackRow(raw) {
    const updateDate = dayValue(raw.UPD);
    if (updateDate === null)
        throw sourceError('Eastmoney buyback row has invalid UPD', 'eastmoney_invalid_response');
    const code = String(raw.REPURPROGRESS ?? '');
    return {
        ...rowIdentity(raw, 'buyback', 'DIM_SCODE'),
        name: String(raw.SECURITYSHORTNAME ?? ''),
        progress: BUYBACK_PROGRESS[code] ?? null,
        progress_code: code,
        update_date: updateDate,
        update_date_ms: dateMs(updateDate),
        plan_notice_date: dayValue(raw.UPDATEDATE),
        latest_notice_date: dayValue(raw.NOTICEDATE),
        finish_date: dayValue(raw.FINISHDATE),
        plan_start_date: dayValue(raw.REPURSTARTDATE),
        plan_end_date: dayValue(raw.REPURENDDATE),
        price_cap: numberOrNull(raw.REPURPRICECAP),
        plan_shares_lower: numberOrNull(raw.REPURNUMLOWER),
        plan_shares_upper: numberOrNull(raw.REPURNUMCAP),
        plan_amount_lower: numberOrNull(raw.REPURAMOUNTLOWER),
        plan_amount_upper: numberOrNull(raw.REPURAMOUNTLIMIT),
        plan_pct_total_lower: numberOrNull(raw.ZSZXX),
        plan_pct_total_upper: numberOrNull(raw.ZSZSX),
        done_shares: numberOrNull(raw.REPURNUM),
        done_amount: numberOrNull(raw.REPURAMOUNT),
        done_price_low: numberOrNull(raw.REPURPRICELOWER1),
        done_price_high: numberOrNull(raw.REPURPRICECAP1),
        objective: textOrNull(raw.REPUROBJECTIVE),
    };
}
async function executeBuyback(params, signal) {
    const progressFilter = params.progress === undefined ? [] : [`(REPURPROGRESS="${BUYBACK_PROGRESS_CODE[String(params.progress)]}")`];
    const filter = eventFilter([...progressFilter, ...eventTickerFilter('DIM_SCODE', params.ticker), ...eventDateFilter('UPD', params)]);
    // Sort uniqueness (verified 2026-11-22): all 5846 rows over 12 pages of 500 → 0 duplicate
    // (DIM_SCODE, REPURCODE) plans and 0 duplicate rows. One row per plan, current state only.
    const parsed = await fetchEventPage({ reportName: 'RPTA_WEB_GETHGLIST_NEW', context: 'buyback', filter, sortColumns: 'UPD,DIM_SCODE,REPURCODE', sortTypes: '-1,1,1', page: Number(params.page), size: Number(params.size) }, signal);
    return { data: { item: parsed.rows.map(parseBuybackRow), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(buybackRow) };
}
const pledgeRow = eventRowSchema({
    stats_date: { type: 'string' }, stats_date_ms: { type: 'integer' },
    industry: nullableString,
    pledge_ratio_pct: nullableNumber, pledged_shares_10k: nullableNumber, pledged_market_cap_10k: nullableNumber,
    pledge_deal_num: nullableNumber, unrestricted_pledged_10k: nullableNumber, restricted_pledged_10k: nullableNumber,
});
const pledgeInput = eventInput({
    ticker: '沪深个股代码（600519 或 600519.SH）；北交所不接受（中国结算统计只覆盖沪深）',
    startDate: '统计日区间起点 YYYY-MM-DD（TRADE_DATE；中国结算按周发布，通常周五）',
    endDate: '统计日区间终点 YYYY-MM-DD（TRADE_DATE）',
});
function normalizePledge(params) {
    const normalized = normalizeEvent(params);
    const ticker = normalized.ticker;
    if (typeof ticker === 'string' && ticker.endsWith('.BJ')) {
        throw new Error(`${ticker} 是北交所证券；中国结算股权质押统计只覆盖沪深（实测 2026-11-20 全市场 2265 行无北交所），本能力不返回北交所数据`);
    }
    return normalized;
}
function parsePledgeRow(raw) {
    const statsDate = dayValue(raw.TRADE_DATE);
    if (statsDate === null)
        throw sourceError('Eastmoney pledge row has invalid TRADE_DATE', 'eastmoney_invalid_response');
    const total = numberOrNull(raw.REPURCHASE_BALANCE);
    const unrestricted = numberOrNull(raw.REPURCHASE_UNLIMITED_BALANCE);
    const restricted = numberOrNull(raw.REPURCHASE_LIMITED_BALANCE);
    // Verified invariant over all 2265 rows of 2026-11-20: 无限售 + 限售 = 合计 (万股).
    if (total !== null && unrestricted !== null && restricted !== null && Math.abs(unrestricted + restricted - total) > Math.max(1, total * 0.001)) {
        throw sourceError(`Eastmoney pledge row ${String(raw.SECURITY_CODE ?? '')} has unrestricted + restricted != total`, 'eastmoney_invalid_response');
    }
    return {
        ...rowIdentity(raw, 'pledge', 'SECURITY_CODE'),
        name: String(raw.SECURITY_NAME_ABBR ?? ''),
        stats_date: statsDate,
        stats_date_ms: dateMs(statsDate),
        industry: textOrNull(raw.INDUSTRY),
        pledge_ratio_pct: numberOrNull(raw.PLEDGE_RATIO),
        pledged_shares_10k: total,
        pledged_market_cap_10k: numberOrNull(raw.PLEDGE_MARKET_CAP),
        pledge_deal_num: numberOrNull(raw.PLEDGE_DEAL_NUM),
        unrestricted_pledged_10k: unrestricted,
        restricted_pledged_10k: restricted,
    };
}
async function executePledge(params, signal) {
    const common = { reportName: 'RPT_CSDC_LIST', context: 'pledge', sortColumns: 'TRADE_DATE,PLEDGE_RATIO,SECURITY_CODE', sortTypes: '-1,-1,1' };
    let filter;
    if (params.ticker !== undefined || params.start_date !== undefined) {
        filter = eventFilter([...eventTickerFilter('SECURITY_CODE', params.ticker), ...eventDateFilter('TRADE_DATE', params)]);
    }
    else {
        // No filters means "latest statistics week", matching the upstream convenience behaviour: one
        // extra 1-row request resolves the date so later pages cannot spill into earlier weeks.
        const latest = await fetchEventPage({ ...common, filter: '', page: 1, size: 1 }, signal);
        const statsDate = latest.rows.length === 0 ? null : dayValue(latest.rows[0].TRADE_DATE);
        if (statsDate === null)
            throw sourceError('Eastmoney pledge table has no statistics date', 'eastmoney_invalid_response');
        filter = `(TRADE_DATE='${statsDate}')`;
    }
    // Sort uniqueness (verified 2026-11-22): 2026-11-20 = 2265 rows over 5 pages of 500 → 0 duplicate
    // (TRADE_DATE, SECURITY_CODE); ratio alone is NOT unique (upstream saw a dup + a missing row).
    const parsed = await fetchEventPage({ ...common, filter, page: Number(params.page), size: Number(params.size) }, signal);
    return { data: { item: parsed.rows.map(parsePledgeRow), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(pledgeRow) };
}
const newStockRow = eventRowSchema({
    apply_code: nullableString, exchange: nullableString, board: nullableString,
    apply_date: { type: 'string' }, apply_date_ms: { type: 'integer' },
    ballot_date: nullableString, pay_date: nullableString, listing_date: nullableString,
    issue_price: nullableNumber, issue_pe: nullableNumber, industry_pe: nullableNumber,
    issue_shares_10k: nullableNumber, online_shares: nullableNumber, apply_upper_shares: nullableNumber,
    top_apply_mktcap_10k: nullableNumber, win_rate_pct: nullableNumber,
    first_close_price: nullableNumber, first_close_change_pct: nullableNumber,
});
const newStockInput = eventInput({
    ticker: '新股代码（920067 或 920067.BJ）；省略取全市场',
    startDate: '申购日区间起点 YYYY-MM-DD（APPLY_DATE）',
    endDate: '申购日区间终点 YYYY-MM-DD（APPLY_DATE）',
});
function normalizeNewStock(params) { return normalizeEvent(params); }
function parseNewStockRow(raw) {
    const applyDate = dayValue(raw.APPLY_DATE);
    if (applyDate === null)
        throw sourceError('Eastmoney new stock row has invalid APPLY_DATE', 'eastmoney_invalid_response');
    const issuePrice = numberOrNull(raw.ISSUE_PRICE);
    return {
        ...rowIdentity(raw, 'new stock', 'SECURITY_CODE'),
        name: String(raw.SECURITY_NAME ?? ''),
        apply_code: textOrNull(raw.APPLY_CODE),
        exchange: textOrNull(raw.TRADE_MARKET),
        // MARKET names the board precisely (上交所科创板 / 深交所创业板); BSE rows leave MARKET null and
        // only carry MARKET_TYPE_NEW = 北交所, so the fallback is the only way to keep board non-null.
        board: textOrNull(raw.MARKET) ?? textOrNull(raw.MARKET_TYPE_NEW),
        apply_date: applyDate,
        apply_date_ms: dateMs(applyDate),
        ballot_date: dayValue(raw.BALLOT_NUM_DATE),
        pay_date: dayValue(raw.BALLOT_PAY_DATE),
        listing_date: dayValue(raw.LISTING_DATE),
        // Null before pricing. Upstream also parks 0 in adjacent price placeholders, so 0 is reported as
        // null (not priced yet) rather than a real zero-yuan offer; all 2 such rows on 2026-11-22 are null.
        issue_price: issuePrice === null || issuePrice <= 0 ? null : issuePrice,
        issue_pe: numberOrNull(raw.AFTER_ISSUE_PE),
        industry_pe: numberOrNull(raw.INDUSTRY_PE),
        issue_shares_10k: numberOrNull(raw.ISSUE_NUM),
        online_shares: numberOrNull(raw.ONLINE_ISSUE_NUM),
        apply_upper_shares: numberOrNull(raw.ONLINE_APPLY_UPPER),
        top_apply_mktcap_10k: numberOrNull(raw.TOP_APPLY_MARKETCAP),
        win_rate_pct: numberOrNull(raw.ONLINE_ISSUE_LWR),
        first_close_price: numberOrNull(raw.CLOSE_PRICE),
        first_close_change_pct: numberOrNull(raw.LD_CLOSE_CHANGE),
    };
}
async function executeNewStock(params, signal) {
    const filter = eventFilter([...eventTickerFilter('SECURITY_CODE', params.ticker), ...eventDateFilter('APPLY_DATE', params)]);
    // Sort uniqueness (verified 2026-11-22): all 5642 rows over 12 pages of 500 → 0 duplicate
    // SECURITY_CODE and 0 duplicate rows; includes upcoming subscriptions (LISTING_DATE null).
    const parsed = await fetchEventPage({ reportName: 'RPTA_APP_IPOAPPLY', context: 'new stock calendar', filter, sortColumns: 'APPLY_DATE,SECURITY_CODE', sortTypes: '-1,-1', page: Number(params.page), size: Number(params.size) }, signal);
    return { data: { item: parsed.rows.map(parseNewStockRow), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(newStockRow) };
}
export function createEastmoneySources() {
    return [
        createSource({ capability: 'eastmoney_top_buy_sell_market', name: 'get_eastmoney_top_buy_sell_market', summary: '东财全市场龙虎榜汇总', description: '按交易日区间分页获取东方财富龙虎榜上榜股票汇总。金额字段单位为元，CHANGE_RATE/TURNOVERRATE/DEAL_*_RATIO 为东财百分数原值；同一股票同日可能因多个上榜原因返回多行，不去重。上游 HTTP 200 但 success=false、code 非 0 或 result 缺失均视为失败，不转换为空数组。', inputSchema: dateRangeInput, outputSchema: datacenterOutput(topBuySellRow), paginated: true, rowShape: { rowKey: 'item' }, allowed: ['start_date', 'end_date', 'page', 'size'], normalize: (params) => normalizeDateRange(params, ['start_date', 'end_date', 'page', 'size']), execute: (params, signal) => executeBillboard(params, signal) }),
        createSource({ capability: 'eastmoney_top_buy_sell_ticker', name: 'get_eastmoney_top_buy_sell_ticker', summary: '东财单票龙虎榜汇总', description: '按单只 A 股和交易日区间获取东方财富龙虎榜汇总。ticker 必须带 SH/SZ/BJ 市场后缀；请求内部转换为 SECURITY_CODE，单票过滤器要求日期使用单引号、代码使用双引号。返回保留同日多条上榜原因；金额单位为元，百分比为东财原值。该能力是上榜股票汇总，不是营业部席位明细。', inputSchema: { type: 'object', properties: { ticker: { type: 'string', description: '完整证券代码，如 600519.SH' }, start_date: { type: 'string' }, end_date: { type: 'string' }, page: { type: 'integer', minimum: 1 }, size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE } }, required: ['ticker', 'start_date', 'end_date'], additionalProperties: false }, outputSchema: datacenterOutput(topBuySellRow), paginated: true, rowShape: { rowKey: 'item' }, allowed: ['ticker', 'start_date', 'end_date', 'page', 'size'], normalize: normalizeTicker, execute: (params, signal) => executeBillboard(params, signal, String(params.ticker)) }),
        createSource({ capability: 'eastmoney_lockup_expiry', name: 'get_eastmoney_lockup_expiry', summary: '东财限售解禁日历', description: '按自然日期区间分页获取东方财富限售解禁日历。已验证字段包括解禁日期、解禁股份类型、FREE_SHARES、TOTAL_RATIO、NON_FREE_SHARES、ABLE_FREE_SHARES；TOTAL_RATIO 是小数比例，股份数量字段以 free_shares_raw 等原始数值保存，单位以东财页面口径为准，未擅自标成股。', inputSchema: dateRangeInput, outputSchema: datacenterOutput(lockupRow), paginated: true, rowShape: { rowKey: 'item' }, allowed: ['start_date', 'end_date', 'page', 'size'], normalize: (params) => normalizeDateRange(params, ['start_date', 'end_date', 'page', 'size']), execute: executeLockup }),
        createSource({ capability: 'eastmoney_sector_rotation', cacheMaxAgeMs: 60_000, name: 'get_eastmoney_sector_rotation', summary: '东财板块行情排名快照', description: '获取东方财富行业、概念或地域板块的查询时点排名快照。默认行业、按涨跌幅排序；board_type 映射为东财 m:90+t:2/3/1。不是历史轮动序列，Dataset 的 captured_at 才是采集时间；板块代码使用 board_code，不归一为证券 ticker。', inputSchema: boardInput, outputSchema: { type: 'object', properties: { item: { type: 'array', items: sectorRow }, pagination: { type: 'object', additionalProperties: true } }, required: ['item', 'pagination'], additionalProperties: true }, paginated: true, rowShape: { rowKey: 'item' }, allowed: ['board_type', 'sort_field', 'page', 'size'], normalize: normalizeBoard, execute: (params, signal) => executeBoard(params, signal, false) }),
        createSource({ capability: 'eastmoney_cashflow_rotation', cacheMaxAgeMs: 60_000, name: 'get_eastmoney_cashflow_rotation', summary: '东财板块资金流快照', description: '获取东方财富行业、概念或地域板块当前资金流快照，默认按主力净流入排序。f62/f66/f72/f78/f84 为金额原值（元），f184/f69/f75/f81/f87 为东财原始占比；当前只承诺查询时点快照，不把未确认的 5 日/10 日字段映射为历史序列。', inputSchema: cashflowInput, outputSchema: { type: 'object', properties: { item: { type: 'array', items: cashflowRow }, pagination: { type: 'object', additionalProperties: true } }, required: ['item', 'pagination'], additionalProperties: true }, paginated: true, rowShape: { rowKey: 'item' }, allowed: ['board_type', 'page', 'size'], normalize: normalizeCashflowBoard, execute: (params, signal) => executeBoard(params, signal, true) }),
        ...MACRO_TABLES.map(createMacroSource),
        createSource({
            capability: 'eastmoney_mutual_flow', name: 'get_eastmoney_mutual_flow',
            summary: '沪深港通成交额与额度状态（按渠道日频）',
            description: '按交易日区间与渠道获取沪深港通成交数据（RPT_MUTUAL_DEAL_HISTORY，实测单渠道日频、可翻到多年前）。channel 六档：北向 sh_stock_connect（沪股通）/ sz_stock_connect（深股通）/ north_total（北向合计，默认），南向 hk_connect_sh / hk_connect_sz / south_total；渠道身份由上游 MUTUAL_TYPE_NAME 自标，实测同一交易日 001+003=005、002+004=006 的成交额加法精确成立。⛔ **北向三档的 buy_amt_raw / sell_amt_raw / net_deal_amt_raw / accum_deal_amt_raw 上游一律为 null**（交易所自 2024-08 起停止披露北向每日买卖明细，实测 2026-09 仍为 null），本能力**不提供"北向净买入"**，谁问就只能给成交额；成交额 deal_amt_raw、成交笔数 deal_num、额度状态 quota_balance_text 与当日领涨股仍披露，南向四档金额字段都有值。金额一律是东财原值（`_raw` 后缀）且**跨渠道计量口径不一致**（配套的额度表里北向 52000 对应官方 520 亿元、南向 42000000000 对应 420 亿元，即同一列两种单位），所以只能在同一渠道内做趋势与相对比较，禁止跨渠道相加、禁止换算成亿元或元写进结论。hold_market_cap_raw 在北向单渠道为 null、北向合计为 0（上游占位，不是"市值为零"）。index_change_pct 是东财附带的相关指数涨跌幅（百分数原值），lead_thscode 带市场后缀。',
            inputSchema: mutualFlowInput, outputSchema: datacenterOutput(mutualFlowRow), paginated: true, rowShape: { rowKey: 'item' },
            allowed: ['start_date', 'end_date', 'channel', 'page', 'size'], normalize: normalizeMutualFlow, execute: executeMutualFlow,
        }),
        createSource({
            capability: 'eastmoney_main_capital_snapshot', cacheMaxAgeMs: 60_000, name: 'get_eastmoney_main_capital_snapshot',
            summary: '东财个股主力资金快照（仅最近交易日）',
            description: '获取东方财富个股主力资金**查询时点快照**（RPT_DMSK_TS_STOCKNEW）。⛔ 上游只保留**最近一个交易日**的全市场一行一股（实测 5199 只、TRADE_DATE 只有当天，带旧日期的过滤器返回 9201 空），本能力**没有历史序列**：不要按日期循环请求，需要历史就改走行情类能力或如实告知用户取不到。默认按主力净流入降序分页；ticker 必须带市场后缀（如 600519.SH），省略则取全市场排名。main_net_inflow 与各档 *_inflow / *_outflow 是东财原值（实测 000501 主力净流入 -3822595，量级对应元）；main_cost / main_cost_20d / main_cost_60d 是主力成本价（元/股，用来判断现价高于还是低于主力成本）；change_pct 与 turnover_rate_pct 是东财百分数原值（0.6011 表示 0.6011%），与本仓其他东财能力同口径。带 `_raw` 后缀的比例列（*_ratio_raw、org_participate_raw）**口径未经核验**：0.1198 既可能读作 0.12% 也可能读作 11.98%，只能做同列相对比较，禁止换算成百分数写进结论。rank / rank_up / total_score / focus 是东财自有的主力资金排名与关注度打分，口径归东财、跨日不可比；participate_type 是上游的参与类型码，原文保留未做翻译。实测 200 行里 CHANGE_RATE 与 TURNOVERRATE 各有 2 行为 null（停牌或当日无成交），null 原样保留不补 0。Dataset 的 captured_at 才是采集时间。',
            inputSchema: mainCapitalInput, outputSchema: datacenterOutput(mainCapitalRow), paginated: true, rowShape: { rowKey: 'item' },
            allowed: ['ticker', 'sort_field', 'sort_order', 'page', 'size'], normalize: normalizeMainCapital, execute: executeMainCapital,
        }),
        createSource({
            capability: 'eastmoney_dividend_plan', name: 'get_eastmoney_dividend_plan',
            summary: '东财分红送配方案明细（按个股与除权日）',
            description: '按单只 A 股与除权除息日区间获取东方财富分红送配方案（RPT_SHAREBONUS_DET，实测全库 56976 条、可翻回 1991 年）。一行一个方案；同一报告期可能同时有年度与中期两条方案，用 report_date 加 ex_dividend_date 区分。四个日期口径不同：report_date 是**报告期**（如 2025-12-31），plan_notice_date 是预案公告日，notice_date 是实施公告日，equity_record_date 是股权登记日（实测 12/200 行为 null——方案尚未定登记日，属正常），ex_dividend_date 是除权除息日；只有 ex_dividend_date_ms 提供毫秒时间轴。送转与派息一律是**每 10 股**口径（上游原文 plan_profile 就写成「10派280.2423元(含税)」，照抄即可核对）：pretax_cash_per_10 为每 10 股税前派息（元），bonus_shares_per_10 为每 10 股送股，converted_shares_per_10 为每 10 股转增，bonus_and_converted_per_10 为送转合计；纯派息方案的三个送转列同时为 null，不是缺数。assign_progress 是方案进度（实测「实施分配」/「董事会决议通过」）；ex_dividend_days 是距除权日天数，**未来为负**（实测 -17）。basic_eps / book_value_per_share / capital_reserve_per_share / undistributed_profit_per_share / net_profit_yoy_pct 是东财随附的每股与利润表指标。带 `_raw` 的三列除权前后涨跌幅与 dividend_yield_raw 的复权与比例口径**未经核验**，只做同列相对比较，禁止换算成百分数写进结论。上游的 IS_KCB 与 PUBLISH_DATE 实测全为 null，本能力不收录，不要当成取数失败；SECURITY_INNER_CODE / ORG_CODE / MARKET_TYPE 等内部编码同样不进取。',
            inputSchema: tickerRangeInput, outputSchema: datacenterOutput(dividendRow), paginated: true, rowShape: { rowKey: 'item' },
            allowed: ['ticker', 'start_date', 'end_date', 'page', 'size'], normalize: normalizeDividend, execute: executeDividend,
        }),
        createSource({
            capability: 'eastmoney_holder_number_snapshot', cacheMaxAgeMs: 60_000, name: 'get_eastmoney_holder_number_snapshot',
            summary: '东财股东户数最新一期截面',
            description: '获取东方财富股东户数的**最新一期截面**（RPT_HOLDERNUMLATEST，实测 5568 只、一股一行）。这是截面不是序列：上游只给每股当前最新一期，取不到历史区间，需要历史就如实告知用户现有能力覆盖不了。end_date 是**报告期**（如 2026-06-30），hold_notice_date 才是**披露日**（实测茅台报告期 2026-06-30、披露 2026-08-15），pre_end_date 是上一期报告期（新股为 null）；时间轴用 end_date_ms，不要把披露日当报告期用。holder_num 是股东户数，pre_holder_num 上期户数，holder_num_change 变动户数，holder_num_ratio_pct 变动比例（百分数原值，21.89 表示 +21.89%）——新股实测 pre_holder_num=0 且 holder_num_ratio_pct=null，这是"无上期可比"，不是取数失败。⛔ 基数极小时比值失真到没有分析价值：实测按 holder_num_ratio_pct 降序前五名上期户数是 60/4/6/7/17（长鑫科技 60 → 3,456,664 户给出 +5,761,006.67%，change_reason 多为「发行融资」即新股上市），比值是东财原值、我们不裁剪，按该列排序或求均值前先剔除这类行。end_date 也只是该股**最新披露的一期**，停更票会停在多年前（实测 601865 停在 2019-02-15），别把"最新一期"读成"最近"。avg_market_cap 户均市值、avg_hold_shares 户均持股数、total_market_cap 总市值、total_a_shares A 股总股本、close_price 收盘价均为东财原值（市值与价格为元级量纲，未逐值核对）；interval_change_pct 是东财给出的区间涨跌幅（百分数原值）；change_shares 与 change_reason 是股本变动数与**中文原因原文**（实测「发行融资」/「资产重组」），原文照存不改写。默认按股东户数降序，可按 holder_num_ratio_pct / total_market_cap / end_date 换排序；ticker 带市场后缀时只返回该只一行。',
            inputSchema: holderInput, outputSchema: datacenterOutput(holderRow), paginated: true, rowShape: { rowKey: 'item' },
            allowed: ['ticker', 'sort_field', 'sort_order', 'page', 'size'], normalize: normalizeHolder, execute: executeHolder,
        }),
        createSource({
            capability: 'eastmoney_mutual_quota', cacheMaxAgeMs: 60_000, name: 'get_eastmoney_mutual_quota',
            summary: '北上南下当日额度与休市状态快照',
            description: '获取四个互连渠道（沪股通 / 深股通 / 港股通(沪) / 港股通(深)）在查询时点当日的额度与开关状态（RPT_MUTUAL_QUOTA，实测全表只有当日四条、没有历史序列）。无参数；Dataset 的 captured_at 才是采集时间，trade_date 是上游给出的日历日。closed_reason 非空表示当日休市（实测 2026-10-05 为「国庆节」）；上游的交易时段字段 start_time / end_time 在实测全部为 null，本能力不收录，不要当成缺口。⛔ trade_quota_raw 的计量口径**跨方向不一致**：北向 52000 对应官方每日额度 520 亿元、南向 42000000000 对应 420 亿元（同一列两种单位），因此两个方向的原值不可直接比较，也不要换算后写进结论；要绝对额度请以交易所官方披露为准。channel 是语义名、channel_label 是上游原文，board 为沪港通/深港通、direction 为 north/south。',
            inputSchema: snapshotInput, outputSchema: datacenterOutput(mutualQuotaRow), paginated: false, rowShape: { rowKey: 'item' },
            allowed: [], normalize: (params) => { assertKnown(params, []); return {}; }, execute: executeMutualQuota,
        }),
        createSource({
            capability: 'eastmoney_margin_trading', name: 'get_eastmoney_margin_trading',
            summary: '个股融资融券明细（按票与交易日）',
            description: '按单只 A 股与交易日区间获取融资融券明细（RPTA_WEB_RZRQ_GGMX，实测 600519 共 3992 个交易日、可翻回约 2010 年）。⛔ **披露新鲜度跨市场不一致**：实测同一天查询沪市（600519）最新到 2026-09-30、深市（000001）最新只有 2026-09-29，深市滞后一个交易日；把两市当天放一起比会得出错误结论，需要同日对齐就自己截到共同日期并写明。金额列单位是元（实测 RZYE=22131853460 即 221 亿元）。余额族：margin_balance 融资余额、short_balance 融券余额、total_balance 两融合计、balance_gap 融资减融券——后两列已用真报文做加减法核对（total=marg…+short、gap=融资-融券，精确成立）。流量族：margin_buy 融资买入额、margin_repay 融资偿还额、margin_net_buy 融资净买入（=买入减偿还，实测精确成立），带 _3d / _5d / _10d 后缀的是**滚动累计而不是日均**，别除以天数。融券流量（short_sell_volume / short_repay_volume / short_net_buy_volume 及其累计）量纲是**股数**，与金额族不可相加。参考列：total_market_cap 总市值（元）、close_price 收盘价（元）、change_pct 当日涨跌幅、change_3d_pct / change_5d_pct / change_10d_pct 区间涨跌幅，均为东财百分数原值；margin_balance_pct 是融资余额占总市值的百分数原值（实测 0.8617 与 RZYE/SZ 一致）。margin_balance_growth_raw 的增长口径未核验，只做同列相对比较。market_segment 是上游市场原文（融资融券_沪证 / 融资融券_深证）。上游的 KCB 标志、TRADE_MARKET(_CODE) 内部编码与不带后缀的 SCODE 不进取；行身份采用请求传入的带市场后缀代码，与上游 SECUCODE 对不上即判 eastmoney_invalid_response。',
            inputSchema: tickerRangeInput, outputSchema: datacenterOutput(marginRow), paginated: true, rowShape: { rowKey: 'item' },
            allowed: ['ticker', 'start_date', 'end_date', 'page', 'size'], normalize: normalizeMargin, execute: executeMargin,
        }),
        createSource({
            capability: 'eastmoney_convertible_bond_list', name: 'get_eastmoney_convertible_bond_list',
            summary: '东财可转债发行清单与条款要素（按起息日）',
            description: '按起息日区间分页获取东方财富可转债发行清单（RPT_BOND_CB_LIST，实测全库 1059 只、起息日 2007-07-02 至今，含已摘牌债与老三板退市债）。⛔ **本表不含行情**：转债现价、正股现价、最新转股价、回售/赎回触发价、PBV 一类列实测 1059/1059 恒为 null，转股溢价率恒为占位值 100——东财页面上那些数是另一条行情接口现算的；要现价或溢价率走别的来源，不要把那些 null 当成取数失败。区间过滤的是**起息日**（实测与网上申购日 1059/1059 相同，所以只留 value_date 一列），不是上市日：实测 8 只「已发行未上市」的 listing_date 为 null，按上市日过滤会把它们静默吞掉。行主体是**债券**——thscode / ticker / name 是转债本身（如 110059.SH），正股在 stock_ticker / stock_name / stock_thscode，两者不要混用。⛔ 正股市场只取上游 TRADE_MARKET（CNSESH=沪、CNSESZ=深），**不许按代码首位推**：实测 15 只 2007-2009 沪市老债代码是 126 开头；老三板退市债（TRADE_MARKET=STAS00，如 404005.NQ，正股 400266）与任何未知市场都不给 stock_thscode（该列为 null）。量纲：issue_scale_yi 是发行规模**亿元**（实测浦发转债 500、南药转债 10.81491 精确到元）；面值与发行价恒为 100 元/张，故不收录；initial_transfer_price 与 first_preplace_per_share_yuan（原股东**每股**可获配的债券面值，元/股）单位是元；coupon_rate_pct 与 online_lottery_ratio_pct（网上发行中签率）是**百分数原值**，0.2 就读作 0.2%。⏱ 随查询日移动的一组：coupon_rate_pct 是**当前计息年度**的票面利率（实测所有非空行的计息区间都跨过查询日，且与阶梯原文逐年对得上——起息 2023-07-18 的福蓉转债给 1.5，正对应「第四年1.50%」），interest_year_start_date / interest_year_end_date / next_cashflow_date 是这个计息年度的起止与付息日；已到期或退市的债这四处实测 467/1059 为 null。完整利率阶梯读 interest_rate_explain——它是上游原文，可能是逐年阶梯，也可能是发行前尚未定案的「预设区间」（实测 126 段老债就是这种），别当成交利率用。bond_expire_years 是**实际存续年数**（等于 expire_date 减 value_date；提前赎回的债按实际终止日算——豫光转债合同 6 年、实测 1.3534），不是合同期限。日期列分职：cease_date 停止交易日、expire_date 到期或终止日、delist_date 摘牌日（null=尚未摘牌；实测 4 条是**将来**日期，即已公告待摘牌）、listing_date 上市日、transfer_start_date / transfer_end_date 转股期起止；cease_date 与 transfer_end_date 实测 180/1059 不一致，故两列都保留。实测 15 只 2007-2009 老债（14 只 126 段沪债加 115003.SZ）没有转股期：transfer_start_date / transfer_end_date / initial_transfer_price / in_conversion_period **同批**为 null，那是产品形态（分离交易可转债）或上游未披露，不是取数失败。in_conversion_period 有值时是上游原文「是/否」，含义是**当前是否处于转股期**（未开始或已结束都给「否」，实测 是:270 / 否:774）。rating 是东财列示的评级原文（实测只有 AAA/AA+/AA/AA-/A+/A 六档，未标明主体还是债项、未标明评级时点，不要当风险结论用），rating_agency 是评级机构名。区间内没有发行就是空结果（上游 code 9201），不要重试。未收录：回售/赎回条款正文（每行数百字符，读条款去看募集说明书）、网上申购上限、ISSUE_TYPE / REDEEM_TYPE / PARAM_NAME / BOND_COMBINE_CODE 等内部编码、FIRST_PROFIT（实测 -898~26946，口径推不出）、TRANSFER_VALUE（与 initial_transfer_price 实测相同却多 8 个 null）。',
            inputSchema: bondListInput, outputSchema: datacenterOutput(bondRow), paginated: true, rowShape: { rowKey: 'item' }, cacheMaxAgeMs: 3_600_000,
            allowed: ['start_date', 'end_date', 'bond_code', 'stock_code', 'page', 'size'], normalize: normalizeBondList, execute: executeBondList,
        }),
        createSource({
            capability: 'eastmoney_global_quote', cacheMaxAgeMs: 60_000, name: 'get_eastmoney_global_quote',
            summary: '东财全球指数/商品/汇率/美债快照',
            description: '批量获取全球指数、商品、汇率、美债收益率、美元指数与 AH 溢价的查询时点快照（东财 push2 ulist，零 key）。symbols 使用稳定符号，未知符号在参数层拒绝，不静默丢行；返回 price / change / open / high / low / prev_close / volume / amount / quote_time / quote_time_utc。⛔ 多数指数、汇率、利率的 amount 实测为 0，输出 null 而不是 0（HSI/HSCEI 例外，带港元成交额）；volume 只在注册表声明可用的符号上给（股票指数为股数、商品为合约张数、汇率/利率为 null）。⛔ VIX / SOX / RUT / DAX / HSTECH / USDJPY 实测无数据，不在承诺范围；免费公开源不承诺实时，is_delayed 留 null。f124=0 时 quote_time 为 null；部分符号未回时逐行 available=false + reason=symbol_not_returned。',
            inputSchema: globalQuoteInput,
            outputSchema: { type: 'array', items: globalQuoteRow },
            paginated: false, rowShape: { rootArray: true },
            allowed: ['symbols'], normalize: normalizeGlobalSymbols, validateOutput: (data) => Array.isArray(data), execute: executeGlobalQuote,
        }),
        createSource({
            capability: 'eastmoney_global_kline', cacheMaxAgeMs: 60_000, name: 'get_eastmoney_global_kline',
            summary: '东财全球指数/商品/汇率/美债日周月 K 线',
            description: '按稳定符号与日期区间获取全球指数、商品、汇率、美债收益率与 AH 溢价的日/周/月 K 线（东财 push2his，零 key）。⛔ 上游第 8 列是振幅 amplitude_pct，不是涨跌幅；change_pct 由前收计算，首根用 preKPrice，preKPrice=0 时首根为 null。指数、汇率、利率的 amount 实测为 0，输出 null；HSI/HSCEI 的 amount 是港元成交额，其余 amount_unit=null。volume 只在注册表声明可用的符号上给。没有分钟线；HSTECH / DAX / VIX 等无数据，不在承诺范围。空区间返回 []，不是取数失败。',
            inputSchema: globalKlineInput,
            outputSchema: { type: 'array', items: globalKlineRow },
            paginated: false, rowShape: { rootArray: true },
            allowed: ['symbol', 'period', 'start_date', 'end_date'], normalize: normalizeGlobalKline, validateOutput: (data) => Array.isArray(data), execute: executeGlobalKline,
        }),
        createSource({
            capability: 'eastmoney_margin_total', name: 'get_eastmoney_margin_total',
            summary: '东财市场级两融合计（按交易所日频）',
            description: '按交易日区间与市场获取 A 股市场级两融汇总（RPTA_WEB_RZRQ_LSSH，实测 8,983 行、2010-03 起）。金额字段单位为元：margin_balance 融资余额、short_balance 融券余额、total_balance 两融合计、margin_buy 融资买入、margin_repay 融资偿还、margin_net_buy 融资净买入；融券量为股数，不能与金额相加。⛔ 深市/北交所披露 T+1：实测同一日期可能只有沪市有行，不能把不完整日期加总；按 market 取单市场或 all 原样返回，缺哪个市场由行本身表达。market 枚举 sse/szse/bse；market_label 是上游原文（融资融券_沪证 / 深证 / 京证）。',
            inputSchema: marketMarginInput,
            outputSchema: datacenterOutput(marketMarginRow),
            paginated: true, rowShape: { rowKey: 'item' },
            allowed: ['start_date', 'end_date', 'market', 'page', 'size'], normalize: normalizeMarketMargin, execute: executeMarketMargin,
        }),
        createSource({
            capability: 'eastmoney_security_profile', cacheMaxAgeMs: 60_000, name: 'get_eastmoney_security_profile',
            summary: '东财个股基本面：行业/股本/市值/上市日/PE/PB',
            description: '获取单只 A 股的东财 push2 基本面快照（stock/get，按 secid 直连）。字段口径已实测核对（2026-11-22，600519）：industry 是东财 f127 行业板块名（实测「白酒Ⅱ」），total_shares/float_shares 为 f84/f85（股，与 datacenter TOTAL_SHARE 1,250,081,601 精确一致），total_market_cap/float_market_cap 为 f116/f117（元，实测等于价×股本 1,857,308,738,685.75），list_date 为 f189（上游 YYYYMMDD「20010827」，转 YYYY-MM-DD 并给 list_date_ms），pe_dynamic 为 f162 动态市盈率（实测 21.61，与 datacenter PE_DYNAMIC 21.60752555 对上），pb 为 f167 市净率（实测 6.85，价格/BPS = 1485.75/216.9496 = 6.848 对上）。市值随价格变动，是查询时点快照，不是历史序列。⛔ 与同花顺口径的 index_membership_by_stock **不是一回事**：这里 industry 只给东财一级/二级板块名一个字符串（如「白酒Ⅱ」），既没有板块代码也不给多板块归属，不能当申万行业或同花顺行业用，两者不可对比、不可拼接。⛔ secid 市场号由 helper 规则决定（沪=1，深/北同为 0；5x ETF、588x 科创 ETF、900x 沪 B 都算沪市，92x 北交所必须先于 9x 判断），不许按首位数字猜：裸 6 位代码按 A 股个股解析（000001 = 平安银行，不是上证指数），显式市场与代码前缀冲突（如 000001.SH 上证指数）直接拒绝。指数/基金不在范围：上游对这类 secid 不给股本，本能力报 eastmoney_invalid_ticker，不回一行 null 冒充。PE/PB 是东财原值：亏损股动态 PE 可为负值，停牌或异常时上游用「-」占位，本能力输出 null（null 不等于 0 倍）。',
            inputSchema: profileInput, outputSchema: datacenterOutput(profileRow), paginated: false, rowShape: { rowKey: 'item' },
            allowed: ['ticker'], normalize: normalizeProfile, execute: executeProfile,
            validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && data.item.length === 1 && isRecord(data.pagination),
        }),
        createSource({
            capability: 'eastmoney_st_stock_list', cacheMaxAgeMs: 300_000, name: 'get_eastmoney_st_stock_list',
            summary: '沪深京 ST/*ST 当日名单（风险警示快照）',
            description: '获取沪深京当日 ST / *ST 名单快照（东财 push2 clist，实测 2026-11-22：沪风险警示板 81 行、深风险警示板 304 行、北交所全表 366 行）。⛔ 北交所口径实测与上游 SKILL 文档不一致，按实测写清：`m:0+f:4` 并不是「只有深市」——实测返回 304 行，其中 189 行是北交所代码（430/830/831/…/873 老号段加 920 新号段），但这 189 行里 186 只在北交所当前 A 股全表（m:0+t:81+s:2048，实测 366 行）里没有对应的 ST 名称行，属老号段僵尸数据；当前北交所真正的 ST 只有 3 只（920575 *ST康乐、920090 *ST同辉、920023 *ST田野），它们既出现在风险警示板里也在北交所全表里。所以本能力按市场分别取：sh 用 m:1+f:4；sz 用 m:0+f:4 并剔除北交所代码；bj 用 m:0+t:81+s:2048 全表按名称含 ST 筛——⛔ 不能直接吃风险警示板，否则会把 186 只僵尸老号段当成北交所 ST 列出来。行按 sh→sz→bj、代码升序，code 唯一（重复即报 upstream 结构变化）。share_type 区分 a_share / b_share（沪 900xxx、深 200xxx 是 B 股；实测沪市 1 只 ST中路B、深市 2 只 ST晨鸣B / *ST皇庭B），⛔ B 股价格与成交额币种不同（沪 B 美元、深 B 港元），不能与 A 股人民币金额相加。单位：price 元（B 股为各自币种）、change_pct %、change_amount 元、volume 手、amount 元、amplitude_pct / turnover_pct %，均为东财原值；停牌行上游给「-」，这里输出 null 而不是 0。⛔ 只有当日快照、没有历史：要回测用的历史 ST 状态请换来源，本能力不提供按日回溯。翻页途中上游 total 变化会直接报错（避免把两份名单拼在一起）；任一风险警示板返回 0 行按上游异常报错，不会被说成「今天没有 ST」。total / by_market 是本次行数与各市场计数，markets 是实际覆盖的市场集合。',
            inputSchema: stStockListInput, outputSchema: stStockListOutput, paginated: false, rowShape: { rowKey: 'item' },
            allowed: ['market'], normalize: normalizeStStockList, execute: executeStStockList,
            validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && typeof data.total === 'number' && Array.isArray(data.markets) && isRecord(data.by_market),
        }),
        createSource({
            capability: 'eastmoney_institution_research', cacheMaxAgeMs: 300_000, name: 'get_eastmoney_institution_research',
            summary: '东财机构调研事件（按公告日，一次调研一行）',
            description: '按公告日区间 / 个股分页获取东方财富机构调研事件（RPT_ORG_SURVEYNEW，取 IS_SOURCE="1" 且 NUMBERNEW="1" 的汇总行：一次调研一行）。实测 2026-11-22：NOTICE_DATE 2026-10-01..2026-11-21 共 2,941 条，688062 共 12 次调研。时间轴有两个：notice_date 是公告日（NOTICE_DATE，start_date/end_date 过滤的就是它，给 notice_date_ms 毫秒轴）；survey_start_date / survey_end_date 是实际接待日（RECEIVE_START_DATE / RECEIVE_END_DATE），通常早于公告日几天。org_count 是上游汇总的参与机构家数（SUM，单位家）——⛔ 实测与逐机构明细行数并不总相等（002053: 1 vs 2、600098: 68 vs 69），它是公司披露口径的家数，不要反推成机构明细条数、也不是去重后的机构个数。survey_way 是调研方式原文（如「特定对象调研,路演活动」）、reception_place 接待地点、receptionist 接待人，均为上游原文不改写。⛔ 本能力只做汇总口径，不提供逐机构明细：上游同一张表可以关掉 NUMBERNEW 换成一行一机构，但那样行语义会变，不做进同一个能力。排序键 NOTICE_DATE 降序 + SECURITY_CODE 升序 + RECEIVE_START_DATE 降序，已实测唯一（1728 行 / 4 页无重复、无漏行）。空结果=区间内没有调研记录（上游 9201，返回空 item + 全零分页），不是取数失败，不要重试。',
            inputSchema: institutionResearchInput, outputSchema: datacenterOutput(institutionResearchRow), paginated: true, rowShape: { rowKey: 'item' },
            allowed: ['ticker', 'start_date', 'end_date', 'page', 'size'], normalize: normalizeInstitutionResearch, execute: executeInstitutionResearch,
        }),
        createSource({
            capability: 'eastmoney_holder_change', cacheMaxAgeMs: 300_000, name: 'get_eastmoney_holder_change',
            summary: '东财重要股东增减持事件（按公告日）',
            description: '按公告日区间 / 个股 / 方向分页获取东方财富重要股东增减持事件（RPT_SHARE_HOLDER_INCREASE）。实测 2026-11-22：NOTICE_DATE 2026-06-01..2026-11-21 共 2,969 条；方向分布（2026-09-01 起 1,248 行）增持 371 / 减持 877，且带符号变动股数的符号与 DIRECTION 100% 一致（代码里对该一致性有断言）。时间轴：notice_date 是公告日（NOTICE_DATE，start_date/end_date 过滤口径，给 notice_date_ms）、start_date / end_date 是变动期间起止。⛔ 字段名陷阱：上游 AFTER_CHANGE_RATE 实测是「本次变动占总股本的比例(%)」，**不是**变动后持股比例——000915 增持 213.04 万股对应 0.909（变动/总股本），变动后持股占比是 HOLD_RATIO = 24.17；本能力把它输出为 change_pct_total 并在描述里钉死，别把它当持股比例用。change_pct_float（CHANGE_FREE_RATIO）是本次变动占流通股比例(%)。after_hold_shares_10k / after_float_hold_shares_10k 是变动后持股数（万股），after_pct_total / after_pct_float 是变动后占公司总股本 / 流通股比例(%)——实测 000915 变动后 5,664.1741 万股 × 24.17% 与总股本自洽。股数单位统一万股，change_shares_10k 带符号（减持为负）。avg_price 是公告披露的成交均价（元/股），实测 1,248 行有 809 行为 null——很多公告不披露，null 不是 0。channel 是变动方式原文（如「二级市场」「大宗交易」「协议转让」）。⛔ 上游 CHANGE_RATE（实测样本 -4.3769）、CLOSE_PRICE 等列口径未核验（疑似公告日行情涨跌幅），不收录，也不要用本能力推断「公告后股价反应」。direction 参数与输出都用 ASCII increase / decrease（上游原文是「增持」「减持」）。排序键 NOTICE_DATE 降序 + SECURITY_CODE 升序 + HOLDER_NAME + START_DATE + END_DATE 升序，已实测唯一（2,969 行 / 6 页无重复、无漏行）。空结果=区间内没有增减持公告，不是失败。',
            inputSchema: holderChangeInput, outputSchema: datacenterOutput(holderChangeRow), paginated: true, rowShape: { rowKey: 'item' },
            allowed: ['ticker', 'start_date', 'end_date', 'direction', 'page', 'size'], normalize: normalizeHolderChange, execute: executeHolderChange,
        }),
        createSource({
            capability: 'eastmoney_buyback', cacheMaxAgeMs: 300_000, name: 'get_eastmoney_buyback',
            summary: '东财回购方案与实施进度（方案一行）',
            description: '按数据更新日区间 / 个股 / 进度分页获取东方财富回购方案（RPTA_WEB_GETHGLIST_NEW，一个方案一行、只给当前状态，没有历史轨迹）。实测 2026-11-22：全表 5,846 行 / 1,949 页；进度码分布 001 董事会预案 115、002 股东大会通过 15、003 股东大会否决 8、004 实施中 445、005 停止实施 125、006 完成实施 5,074、007 63、008 1。⛔ 上游 007/008 两个进度码连东财页面都不给名字，本能力 progress=null、progress_code 保留原码，不猜语义。⛔ 时间轴是三个不同字段，别混：参数 start_date/end_date 过滤的是 UPD（数据更新日，也是排序键，输出 update_date / update_date_ms）；plan_notice_date 来自上游 UPDATEDATE（方案相关公告日，实测 001 预案行等于更新日、004 行早于最新进展公告）、latest_notice_date 来自 NOTICEDATE（最新一次进展公告日，001/007 行为 null）、finish_date 来自 FINISHDATE（完成日）。量纲（实测 600519 精确对上）：股数为股、金额为元——plan_shares_lower/upper（REPURNUMLOWER/REPURNUMCAP，804,864 / 1,609,727 股）、plan_amount_lower/upper（15 亿 / 30 亿元）、done_shares/done_amount（已回购 2,188,614 股 / 2,999,933,749.57 元）、price_cap 回购价格上限（元）、done_price_low/high 已回购价格区间（元）。plan_pct_total_lower/upper 是占总股本%的下限/上限（实测 804,864/1,250,081,601 = 0.0644 与 ZSZXX 0.06427 对上），实测 635/5,846 行这两列为 null（老方案上游不填）。done_* 在未开始实施的方案上为 null（实测 280 行两者皆空），null 不等于 0。progress 参数用 6 个中文名（对应 001–006），无法用 007/008 过滤，但省略 progress 时会返回它们。objective 是上游原文（如「用于依法注销减少注册资本」），不改写。排序键 UPD 降序 + DIM_SCODE 升序 + REPURCODE 升序，已实测唯一（5,846 行 / 12 页无重复方案、无重复行）。空结果=区间内没有回购记录，不是失败。',
            inputSchema: buybackInput, outputSchema: datacenterOutput(buybackRow), paginated: true, rowShape: { rowKey: 'item' },
            allowed: ['ticker', 'start_date', 'end_date', 'progress', 'page', 'size'], normalize: normalizeBuyback, execute: executeBuyback,
        }),
        createSource({
            capability: 'eastmoney_pledge', cacheMaxAgeMs: 3_600_000, name: 'get_eastmoney_pledge',
            summary: '东财股权质押周度统计（仅沪深）',
            description: '获取东方财富股权质押周度统计（RPT_CSDC_LIST，原始来源中国结算，实测 2026-11-22 全表 1,655,524 行、最新统计日 2026-11-20（周五）2,265 只沪深股票）。⛔ **只覆盖沪深、没有北交所**：实测最新统计日 2,265 行里没有任何 4x/8x/92x 北交所代码，用 920982 查上游直接 9201 空结果；所以本能力对北交所 ticker 在参数层直接拒绝，不返回空表冒充「没有质押」（空表说明不了没有质押，只说明本表不覆盖）。不传 ticker 也不传日期时=最近一个统计日全市场：内部先查一次最新 TRADE_DATE 再按当天过滤，避免翻页滑到上一周。时间轴 stats_date 是统计日（TRADE_DATE，按周发布、通常周五；给 stats_date_ms），不是公告日。量纲（实测 301015 精确对上）：pledged_shares_10k 是质押股数（万股，REPURCHASE_BALANCE，18,522.06 万股 ÷ 总股本 = pledge_ratio_pct 35.24% 自洽）、pledged_market_cap_10k 是质押市值（万元，411,374.9526 万元 ≈ 41.1 亿元）、pledge_ratio_pct 质押股数占总股本%。unrestricted_pledged_10k / restricted_pledged_10k 是无限售 / 有限售质押股数（万股），实测 2,265 行全部满足「无限售 + 限售 = 合计」，代码里有该断言，不成立即报上游结构变化。pledge_deal_num 是上游 PLEDGE_DEAL_NUM（笔数口径未独立核验，只做同列相对比较）。industry 是东财行业名原文，空则 null。排序键 TRADE_DATE 降序 + PLEDGE_RATIO 降序 + SECURITY_CODE 升序，已实测唯一（2,265 行 / 5 页无重复、无漏行）——⛔ 只按 PLEDGE_RATIO 排序不唯一，上游曾因此翻页重复 1 行、漏 1 行。空结果=区间里没有统计日（按周发布、通常周五），不是失败。',
            inputSchema: pledgeInput, outputSchema: datacenterOutput(pledgeRow), paginated: true, rowShape: { rowKey: 'item' },
            allowed: ['ticker', 'start_date', 'end_date', 'page', 'size'], normalize: normalizePledge, execute: executePledge,
        }),
        createSource({
            capability: 'eastmoney_new_stock', cacheMaxAgeMs: 3_600_000, name: 'get_eastmoney_new_stock',
            summary: '东财新股申购与发行日历（含未申购排期）',
            description: '按申购日区间 / 个股分页获取东方财富新股申购与发行日历（RPTA_APP_IPOAPPLY，含尚未申购的排期与已上市新股）。实测 2026-11-22：全表 5,642 行、2026 年 139 只、覆盖三个交易所（上交所 / 深交所 / 北交所）。时间轴：apply_date 是申购日（APPLY_DATE，start_date/end_date 过滤口径，给 apply_date_ms）、ballot_date 是摇号中签日（BALLOT_NUM_DATE）、pay_date 是缴款日（BALLOT_PAY_DATE）、listing_date 是上市日（未上市为 null）。exchange 是 TRADE_MARKET 原文（上海证券交易所 / 深圳证券交易所 / 北京证券交易所），board 取 MARKET（如「上交所科创板」「深交所创业板」）——北交所行 MARKET 为 null、只有 MARKET_TYPE_NEW=北交所，故 board 先取 MARKET 再退回 MARKET_TYPE_NEW，否则北交所行会丢板块。量纲（实测对得上）：issue_price 元/股、issue_shares_10k 发行股数（万股，ISSUE_NUM；301661 1375 万股与网上 2,887,500 + 网下 6,737,500 股、战略配售合计自洽）、online_shares 网上发行股数（股）、apply_upper_shares 网上申购上限（股）、win_rate_pct 网上中签率%、issue_pe 发行后市盈率、industry_pe 行业市盈率、first_close_price / first_close_change_pct 上市首日收盘价（元）与首日涨跌幅（%）——实测 5,637 行里 5,629 行满足 close = price×(1+chg/100)，8 行例外是 B 股 / 异常历史行，故两列原值给出、不做二次换算。⛔ ISSUE_PRICE 在定价前是 null（实测全表仅 2 行，均为未上市新股），上游在相邻价格列用 0 占位，本能力把 0 也当 null（未定价），不要把 null 读成 0 元发行。⛔ TOP_APPLY_MARKETCAP 单位虽是万元但口径跨市场不同：沪深是「顶格申购需配市值」（实测 688845 9000 股 → 9 万元、301661 2500 股 → 2.5 万元），北交所是「顶格申购需缴款金额」（实测 920067 708,300 股 × 23.52 元 = 1665.92 万元精确成立），禁止跨市场比较。win_rate_pct 实测全表 559 行为 null（未定价或未公布中签率），null 不是 0。排序键 APPLY_DATE 降序 + SECURITY_CODE 降序，已实测唯一（5,642 行 / 12 页无重复代码、无重复行）。空结果=区间内没有新股，不是失败。',
            inputSchema: newStockInput, outputSchema: datacenterOutput(newStockRow), paginated: true, rowShape: { rowKey: 'item' },
            allowed: ['ticker', 'start_date', 'end_date', 'page', 'size'], normalize: normalizeNewStock, execute: executeNewStock,
        }),
        ...createEastmoneyLimitPoolSources(),
    ];
}
/**
 * push2ex limit pools, dycalchis price anomalies, emappdata stock hot concepts. All three hosts sit
 * outside the push2 egress path; every call still goes through the shared eastmoney client or the
 * process-wide throttle (no private fetch/limiter).
 */
const PUSH2EX_BASE_URL = 'https://push2ex.eastmoney.com';
const PUSH2EX_UT = '7eea3edcaed734bea9cbfc24409ed989';
const PUSH2EX_REFERER = 'https://quote.eastmoney.com/';
/** Upstream caps pagesize at 10k; a pool must be taken in one page because page boundaries are not stable. */
const PUSH2EX_PAGE_SIZE = 10_000;
const ANOMALY_BASE_URL = 'https://dycalchis.eastmoney.com/price-anomaly';
/** Six fixed H5 params: without `team=h5` (and the rest) upstream answers {"result":1001,"msg":"unknow team"}. */
const ANOMALY_H5_PARAMS = { team: 'h5', product: 'EastMoney', client: 'WAP', version: '9001', name: 'WAP', user: '123' };
const ANOMALY_LIST_DEFAULT_SIZE = 200;
const ANOMALY_COUNT_DEFAULT_SIZE = 50;
/** Count-endpoint sorting is applied locally: upstream ignores sortKey/sortDir (5 combinations, identical order). */
const ANOMALY_SORT_FIELDS = { times: 'anomaly_times', deviation_pct: 'deviation_pct', change_pct: 'change_pct', price: 'price', window_days: 'window_days' };
/** 12 rule names taken from the upstream frontend map; unknown codes stay null (no invented text). */
const ANOMALY_RULES = {
    1: '主板连续10个交易日内4次出现同向异常波动',
    2: '创业板连续10个交易日内3次出现同向异常波动',
    3: '科创板连续10个交易日内3次出现同向异常波动',
    4: '连续十个交易日内日收盘价涨跌幅偏离值累计达到+100%',
    5: '连续十个交易日内日收盘价涨跌幅偏离值累计达到-50%',
    6: '连续三十个交易日内日收盘价涨跌幅偏离值累计达到+200%',
    7: '连续三十个交易日内日收盘价涨跌幅偏离值累计达到-70%',
    8: '北交所连续10个交易日内3次出现同向异常波动',
    40: '连续十个交易日内日收盘价涨跌幅偏离值累计达到+150%',
    50: '连续十个交易日内日收盘价涨跌幅偏离值累计达到-60%',
    60: '连续三十个交易日内日收盘价涨跌幅偏离值累计达到+300%',
    70: '连续三十个交易日内日收盘价涨跌幅偏离值累计达到-75%',
};
const HOT_CONCEPT_URL = 'https://emappdata.eastmoney.com/stockrank/getHotStockRankList';
const HOT_CONCEPT_BODY = { appId: 'appId01', globalId: '786e4c21-70dc-435a-93bb-38' };
/** Beijing calendar day. push2ex silently clamps any date later than the latest trading day onto that day. */
function beijingToday() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}
/** `getJson` has no header slot; push2ex wants Referer, so this entry reuses the shared client and mirrors its classification. */
async function getJsonWithHeaders(url, signal, context, headers) {
    let payload;
    try {
        payload = await sharedEastmoneyClient().fetchJson(url, { signal, headers });
    }
    catch (error) {
        if (error instanceof Error && error.name === 'AbortError')
            throw error;
        const status = error instanceof EastmoneyTransportError ? error.status : undefined;
        throw sourceError(status === undefined
            ? `Eastmoney request failed for ${context}: ${error instanceof Error ? error.message : String(error)}`
            : `Eastmoney HTTP ${status} for ${context}`, status === 429 ? 'eastmoney_rate_limit' : 'eastmoney_http_error');
    }
    if (!isRecord(payload))
        throw sourceError(`Eastmoney ${context} returned a non-object response`, 'eastmoney_invalid_response');
    return payload;
}
/**
 * emappdata only speaks POST with a JSON body and the shared client has no body slot, so this entry
 * uses the same process-wide throttle and repeats that client's abort/status/JSON classification.
 */
async function postJsonWithThrottle(url, body, signal, context) {
    let payload;
    try {
        payload = await sharedEastmoneyThrottle()(async () => {
            if (signal.aborted) {
                const error = new Error('eastmoney request aborted');
                error.name = 'AbortError';
                throw error;
            }
            const response = await globalThis.fetch(url, {
                method: 'POST',
                headers: { 'user-agent': 'Mozilla/5.0', 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal,
            });
            if (response.status >= 400) {
                const error = new Error(`eastmoney returned HTTP ${response.status}`);
                error.status = response.status;
                throw error;
            }
            return await response.json();
        });
    }
    catch (error) {
        if (error instanceof Error && error.name === 'AbortError')
            throw error;
        const status = error?.status;
        const statusCode = typeof status === 'number' ? status : undefined;
        throw sourceError(statusCode === undefined
            ? `Eastmoney request failed for ${context}: ${error instanceof Error ? error.message : String(error)}`
            : `Eastmoney HTTP ${statusCode} for ${context}`, statusCode === 429 ? 'eastmoney_rate_limit' : 'eastmoney_http_error');
    }
    if (!isRecord(payload))
        throw sourceError(`Eastmoney ${context} returned a non-object response`, 'eastmoney_invalid_response');
    return payload;
}
/** Row array of plain objects; a non-array or a non-object row is an upstream shape change. */
function poolRowArray(value, context) {
    if (!Array.isArray(value))
        throw sourceError(`Eastmoney ${context} is missing its row array`, 'eastmoney_invalid_response');
    const rows = [];
    for (const row of value) {
        if (!isRecord(row))
            throw sourceError(`Eastmoney ${context} contains a non-object row`, 'eastmoney_invalid_response');
        rows.push(row);
    }
    return rows;
}
function poolNumber(value, field, context) {
    if (value === undefined || value === null || value === '')
        return null;
    const parsed = numberOrNull(value);
    if (parsed === null)
        throw sourceError(`Eastmoney ${context} row has an unreadable ${field}=${String(value)}`, 'eastmoney_invalid_response');
    return parsed;
}
function poolInteger(value, field, context) {
    const parsed = poolNumber(value, field, context);
    if (parsed !== null && !Number.isSafeInteger(parsed))
        throw sourceError(`Eastmoney ${context} row has a non-integer ${field}=${String(value)}`, 'eastmoney_invalid_response');
    return parsed;
}
/** Upstream pool prices are thousandths of a yuan (27710 = 27.71). A non-integer here means a unit change. */
function poolPrice(value, field, context) {
    const parsed = poolNumber(value, field, context);
    if (parsed === null)
        return null;
    if (!Number.isSafeInteger(parsed))
        throw sourceError(`Eastmoney ${context} row has a non-integer ${field}=${String(value)}; pool prices are x1000`, 'eastmoney_invalid_response');
    return parsed / 1000;
}
/** Seal times are HHMMSS integers (92501 = 09:25:01), not Unix seconds: the two must never be mixed. */
function poolSealTime(value, field, context) {
    const parsed = poolInteger(value, field, context);
    if (parsed === null)
        return null;
    if (parsed < 0 || parsed > 235959)
        throw sourceError(`Eastmoney ${context} row has an out-of-range ${field}=${String(value)} (expected HHMMSS)`, 'eastmoney_invalid_response');
    const text = String(parsed).padStart(6, '0');
    const hour = Number(text.slice(0, 2));
    const minute = Number(text.slice(2, 4));
    const second = Number(text.slice(4, 6));
    if (hour > 23 || minute > 59 || second > 59)
        throw sourceError(`Eastmoney ${context} row has an invalid clock time ${field}=${String(value)}`, 'eastmoney_invalid_response');
    return `${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6)}`;
}
/** zttj = { days, ct }: upstream frontend renders ct/days (n/m = n limit-ups in m days) -> "N天M板". */
function poolZtStat(value, context) {
    if (value === undefined || value === null)
        return { days: null, boards: null, text: null };
    if (!isRecord(value))
        throw sourceError(`Eastmoney ${context} row has a malformed zttj`, 'eastmoney_invalid_response');
    const days = poolInteger(value.days, 'zttj.days', context);
    const boards = poolInteger(value.ct, 'zttj.ct', context);
    if (days === null || boards === null)
        throw sourceError(`Eastmoney ${context} row has an incomplete zttj`, 'eastmoney_invalid_response');
    return { days, boards, text: `${days}天${boards}板` };
}
/** m is 1 for SH and 0 for both SZ and BSE, so the market is derived from the code range with the shared helper. */
function poolBaseRow(raw, context, seen) {
    const code = String(raw.c ?? '');
    if (!/^\d{6}$/u.test(code))
        throw sourceError(`Eastmoney ${context} row has an unusable code ${code || '(empty)'}`, 'eastmoney_invalid_response');
    const identity = normalizeEastmoneyAshareIdentity(code);
    const marketCode = poolInteger(raw.m, 'm', context);
    const expectedMarketCode = identity.eastmoney_market === 'SH' ? 1 : 0;
    if (marketCode !== expectedMarketCode) {
        throw sourceError(`Eastmoney ${context} row ${code} carries market code ${String(raw.m)} but its code range is ${identity.eastmoney_market}`, 'eastmoney_invalid_response');
    }
    if (seen.has(code))
        throw sourceError(`Eastmoney ${context} contains duplicate code ${code}; a pool is one row per stock`, 'eastmoney_invalid_response');
    seen.add(code);
    const name = textOrNull(raw.n);
    if (name === null || name.trim().length === 0)
        throw sourceError(`Eastmoney ${context} row ${code} has no name`, 'eastmoney_invalid_response');
    return { thscode: identity.thscode, code, name, market: identity.eastmoney_market };
}
function parseLimitUpRow(raw, context, seen) {
    const base = poolBaseRow(raw, context, seen);
    const stat = poolZtStat(raw.zttj, context);
    return {
        ...base,
        price: poolPrice(raw.p, 'p', context),
        change_pct: poolNumber(raw.zdp, 'zdp', context),
        amount: poolNumber(raw.amount, 'amount', context),
        float_market_cap: poolNumber(raw.ltsz, 'ltsz', context),
        total_market_cap: poolNumber(raw.tshare, 'tshare', context),
        turnover_rate_pct: poolNumber(raw.hs, 'hs', context),
        limit_days: poolInteger(raw.lbc, 'lbc', context),
        first_seal: poolSealTime(raw.fbt, 'fbt', context),
        last_seal: poolSealTime(raw.lbt, 'lbt', context),
        seal_fund: poolNumber(raw.fund, 'fund', context),
        break_times: poolInteger(raw.zbc, 'zbc', context),
        industry: textOrNull(raw.hybk),
        zt_stat: stat.text,
        zt_stat_days: stat.days,
        zt_stat_boards: stat.boards,
    };
}
function parseLimitBreakRow(raw, context, seen) {
    const base = poolBaseRow(raw, context, seen);
    const stat = poolZtStat(raw.zttj, context);
    return {
        ...base,
        price: poolPrice(raw.p, 'p', context),
        limit_price: poolPrice(raw.ztp, 'ztp', context),
        change_pct: poolNumber(raw.zdp, 'zdp', context),
        amount: poolNumber(raw.amount, 'amount', context),
        float_market_cap: poolNumber(raw.ltsz, 'ltsz', context),
        total_market_cap: poolNumber(raw.tshare, 'tshare', context),
        turnover_rate_pct: poolNumber(raw.hs, 'hs', context),
        first_seal: poolSealTime(raw.fbt, 'fbt', context),
        break_times: poolInteger(raw.zbc, 'zbc', context),
        amplitude_pct: poolNumber(raw.zf, 'zf', context),
        speed_pct: poolNumber(raw.zs, 'zs', context),
        industry: textOrNull(raw.hybk),
        zt_stat: stat.text,
        zt_stat_days: stat.days,
        zt_stat_boards: stat.boards,
    };
}
function parseLimitDownRow(raw, context, seen) {
    const base = poolBaseRow(raw, context, seen);
    return {
        ...base,
        price: poolPrice(raw.p, 'p', context),
        change_pct: poolNumber(raw.zdp, 'zdp', context),
        amount: poolNumber(raw.amount, 'amount', context),
        float_market_cap: poolNumber(raw.ltsz, 'ltsz', context),
        total_market_cap: poolNumber(raw.tshare, 'tshare', context),
        pe: poolNumber(raw.pe, 'pe', context),
        turnover_rate_pct: poolNumber(raw.hs, 'hs', context),
        seal_fund: poolNumber(raw.fund, 'fund', context),
        last_seal: poolSealTime(raw.lbt, 'lbt', context),
        board_amount: poolNumber(raw.fba, 'fba', context),
        limit_down_days: poolInteger(raw.days, 'days', context),
        open_times: poolInteger(raw.oc, 'oc', context),
        industry: textOrNull(raw.hybk),
    };
}
/** Yesterday pool: `yfbt`/`ylbc` are yesterday-scoped columns; never feed them through the limit-up parser. */
function parseYesterdayLimitUpRow(raw, context, seen) {
    const base = poolBaseRow(raw, context, seen);
    const stat = poolZtStat(raw.zttj, context);
    return {
        ...base,
        price: poolPrice(raw.p, 'p', context),
        limit_price: poolPrice(raw.ztp, 'ztp', context),
        change_pct: poolNumber(raw.zdp, 'zdp', context),
        amount: poolNumber(raw.amount, 'amount', context),
        float_market_cap: poolNumber(raw.ltsz, 'ltsz', context),
        total_market_cap: poolNumber(raw.tshare, 'tshare', context),
        turnover_rate_pct: poolNumber(raw.hs, 'hs', context),
        amplitude_pct: poolNumber(raw.zf, 'zf', context),
        speed_pct: poolNumber(raw.zs, 'zs', context),
        yesterday_first_seal: poolSealTime(raw.yfbt, 'yfbt', context),
        yesterday_limit_days: poolInteger(raw.ylbc, 'ylbc', context),
        industry: textOrNull(raw.hybk),
        zt_stat: stat.text,
        zt_stat_days: stat.days,
        zt_stat_boards: stat.boards,
    };
}
const limitPoolEnvelope = (row) => ({
    type: 'object',
    properties: {
        item: { type: 'array', items: row },
        trade_date: { type: 'string' },
        server_latest_trade_date: nullableString,
        requested_date_clamped: { type: 'boolean' },
        available: { type: 'boolean' },
        row_count: { type: 'integer' },
        upstream_total: { type: 'integer' },
        note: nullableString,
    },
    required: ['item', 'trade_date', 'server_latest_trade_date', 'requested_date_clamped', 'available', 'row_count', 'upstream_total', 'note'],
    additionalProperties: false,
});
async function executeLimitPool(spec, params, signal) {
    const tradeDate = String(params.trade_date);
    const url = new URL(`${PUSH2EX_BASE_URL}/${spec.endpoint}`);
    url.searchParams.set('ut', PUSH2EX_UT);
    url.searchParams.set('dpt', 'wz.ztzt');
    url.searchParams.set('Pageindex', '0');
    url.searchParams.set('pagesize', String(PUSH2EX_PAGE_SIZE));
    url.searchParams.set('sort', spec.sort);
    url.searchParams.set('date', tradeDate.replaceAll('-', ''));
    const payload = await getJsonWithHeaders(url.toString(), signal, spec.context, { referer: PUSH2EX_REFERER });
    if (Number(payload.rc) !== 0) {
        throw sourceError(`Eastmoney ${spec.context} rejected trade_date ${tradeDate}: rc=${String(payload.rc)}; upstream needs date=YYYYMMDD and answers rc=102/null when it is missing or unreadable`, 'eastmoney_upstream_error');
    }
    if (!isRecord(payload.data))
        throw sourceError(`Eastmoney ${spec.context} returned rc=0 without a data object`, 'eastmoney_invalid_response');
    const data = payload.data;
    const total = poolInteger(data.tc, 'tc', spec.context);
    if (total === null)
        throw sourceError(`Eastmoney ${spec.context} returned no total (tc)`, 'eastmoney_invalid_response');
    const rawRows = poolRowArray(data.pool, spec.context);
    if (rawRows.length !== total) {
        throw sourceError(`Eastmoney ${spec.context} returned ${rawRows.length} of ${total} rows at pagesize=${PUSH2EX_PAGE_SIZE}; a partial pool is not served`, 'eastmoney_invalid_response');
    }
    const latest = compactDay(data.qdate);
    if (latest === null)
        throw sourceError(`Eastmoney ${spec.context} returned an unusable qdate ${String(data.qdate ?? '(missing)')}`, 'eastmoney_invalid_response');
    const clamped = tradeDate > latest;
    const seen = new Set();
    const item = rawRows.map((raw) => spec.parse(raw, spec.context, seen));
    const available = item.length > 0;
    const note = available
        ? (clamped ? `请求日 ${tradeDate} 晚于上游最近交易日 ${latest}：上游把日期夹到 ${latest}，本批行属于 ${latest}，不是请求日。` : null)
        : (clamped
            ? `请求日 ${tradeDate} 晚于上游最近交易日 ${latest}：上游夹到 ${latest}，而该日池为空（tc=0）。`
            : `上游在 ${tradeDate} 返回 tc=0 的空池（非交易日，或早于上游约 15 个交易日的保留窗口；服务器最近交易日 ${latest}）。空池不是取数失败。`);
    return {
        data: { item, trade_date: tradeDate, server_latest_trade_date: latest, requested_date_clamped: clamped, available, row_count: item.length, upstream_total: total, note },
        schema: limitPoolEnvelope(spec.row),
    };
}
function normalizeLimitPool(params) {
    assertKnown(params, ['trade_date']);
    const trade_date = date(params.trade_date, 'trade_date');
    if (trade_date > beijingToday()) {
        throw new Error(`trade_date ${trade_date} is in the future (Beijing today is ${beijingToday()}); upstream would silently serve the latest trading day, so it is rejected here`);
    }
    return { trade_date };
}
const limitPoolInput = {
    type: 'object',
    properties: {
        trade_date: { type: 'string', description: '交易日 YYYY-MM-DD（北京时间）。必填：上游省略 date 直接 rc=102/data=null，没有「最新」默认；今天或更早都接受，未来日期在参数层拒绝' },
    },
    required: ['trade_date'],
    additionalProperties: false,
};
const limitUpRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, market: { type: 'string', enum: ['SH', 'SZ', 'BJ'] },
        price: nullableNumber, change_pct: nullableNumber, amount: nullableNumber,
        float_market_cap: nullableNumber, total_market_cap: nullableNumber, turnover_rate_pct: nullableNumber,
        limit_days: nullableNumber, first_seal: nullableString, last_seal: nullableString,
        seal_fund: nullableNumber, break_times: nullableNumber, industry: nullableString,
        zt_stat: nullableString, zt_stat_days: nullableNumber, zt_stat_boards: nullableNumber,
    },
    required: ['thscode', 'code', 'name', 'market', 'price', 'change_pct', 'amount', 'float_market_cap', 'total_market_cap', 'turnover_rate_pct', 'limit_days', 'first_seal', 'last_seal', 'seal_fund', 'break_times', 'industry', 'zt_stat', 'zt_stat_days', 'zt_stat_boards'],
    additionalProperties: false,
};
const limitBreakRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, market: { type: 'string', enum: ['SH', 'SZ', 'BJ'] },
        price: nullableNumber, limit_price: nullableNumber, change_pct: nullableNumber, amount: nullableNumber,
        float_market_cap: nullableNumber, total_market_cap: nullableNumber, turnover_rate_pct: nullableNumber,
        first_seal: nullableString, break_times: nullableNumber, amplitude_pct: nullableNumber, speed_pct: nullableNumber,
        industry: nullableString, zt_stat: nullableString, zt_stat_days: nullableNumber, zt_stat_boards: nullableNumber,
    },
    required: ['thscode', 'code', 'name', 'market', 'price', 'limit_price', 'change_pct', 'amount', 'float_market_cap', 'total_market_cap', 'turnover_rate_pct', 'first_seal', 'break_times', 'amplitude_pct', 'speed_pct', 'industry', 'zt_stat', 'zt_stat_days', 'zt_stat_boards'],
    additionalProperties: false,
};
const limitDownRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, market: { type: 'string', enum: ['SH', 'SZ', 'BJ'] },
        price: nullableNumber, change_pct: nullableNumber, amount: nullableNumber,
        float_market_cap: nullableNumber, total_market_cap: nullableNumber, pe: nullableNumber, turnover_rate_pct: nullableNumber,
        seal_fund: nullableNumber, last_seal: nullableString, board_amount: nullableNumber,
        limit_down_days: nullableNumber, open_times: nullableNumber, industry: nullableString,
    },
    required: ['thscode', 'code', 'name', 'market', 'price', 'change_pct', 'amount', 'float_market_cap', 'total_market_cap', 'pe', 'turnover_rate_pct', 'seal_fund', 'last_seal', 'board_amount', 'limit_down_days', 'open_times', 'industry'],
    additionalProperties: false,
};
const yesterdayLimitUpRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, market: { type: 'string', enum: ['SH', 'SZ', 'BJ'] },
        price: nullableNumber, limit_price: nullableNumber, change_pct: nullableNumber, amount: nullableNumber,
        float_market_cap: nullableNumber, total_market_cap: nullableNumber, turnover_rate_pct: nullableNumber,
        amplitude_pct: nullableNumber, speed_pct: nullableNumber,
        yesterday_first_seal: nullableString, yesterday_limit_days: nullableNumber, industry: nullableString,
        zt_stat: nullableString, zt_stat_days: nullableNumber, zt_stat_boards: nullableNumber,
    },
    required: ['thscode', 'code', 'name', 'market', 'price', 'limit_price', 'change_pct', 'amount', 'float_market_cap', 'total_market_cap', 'turnover_rate_pct', 'amplitude_pct', 'speed_pct', 'yesterday_first_seal', 'yesterday_limit_days', 'industry', 'zt_stat', 'zt_stat_days', 'zt_stat_boards'],
    additionalProperties: false,
};
const LIMIT_UP_POOL_SPEC = { context: 'limit-up pool', endpoint: 'getTopicZTPool', sort: 'fbt:asc', row: limitUpRow, parse: parseLimitUpRow };
const LIMIT_BREAK_POOL_SPEC = { context: 'limit-break pool', endpoint: 'getTopicZBPool', sort: 'fbt:asc', row: limitBreakRow, parse: parseLimitBreakRow };
const LIMIT_DOWN_POOL_SPEC = { context: 'limit-down pool', endpoint: 'getTopicDTPool', sort: 'fund:asc', row: limitDownRow, parse: parseLimitDownRow };
const YESTERDAY_LIMIT_UP_POOL_SPEC = { context: 'yesterday limit-up pool', endpoint: 'getYesterdayZTPool', sort: 'zs:desc', row: yesterdayLimitUpRow, parse: parseYesterdayLimitUpRow };
/** Market code only documents upstream column m; the market itself comes from the code range (m=0 is SZ and BJ). */
function anomalyIdentity(raw, context) {
    const code = String(raw.c ?? '');
    if (!/^\d{6}$/u.test(code))
        throw sourceError(`Eastmoney ${context} row has an unusable code ${code || '(empty)'}`, 'eastmoney_invalid_response');
    const identity = normalizeEastmoneyAshareIdentity(code);
    const marketCode = poolInteger(raw.m, 'm', context);
    const expectedMarketCode = identity.eastmoney_market === 'SH' ? 1 : 0;
    if (marketCode !== null && marketCode !== expectedMarketCode) {
        throw sourceError(`Eastmoney ${context} row ${code} carries m=${marketCode} but its code range is ${identity.eastmoney_market} (m=0 covers SZ and BJ)`, 'eastmoney_invalid_response');
    }
    return { thscode: identity.thscode, code, market: identity.eastmoney_market, eastmoney_market_code: marketCode };
}
function anomalyName(raw, context, code) {
    const name = textOrNull(raw.n);
    if (name === null || name.trim().length === 0)
        throw sourceError(`Eastmoney ${context} row ${code} has no name`, 'eastmoney_invalid_response');
    return name;
}
function parseAnomalyListRow(raw, context) {
    const identity = anomalyIdentity(raw, context);
    const board = poolInteger(raw.s, 's', context);
    const rule = poolInteger(raw.e, 'e', context);
    // Frontend map: s==6 takes the stricter e*10 tier (4->40 .. 7->70); no s=6 sample observed yet.
    const ruleCode = rule === null ? null : (board === 6 && rule >= 4 && rule <= 7 ? rule * 10 : rule);
    const status = poolInteger(raw.o, 'o', context);
    return {
        ...identity,
        name: anomalyName(raw, context, String(identity.code)),
        board_code: board,
        rule_code: ruleCode,
        rule: ruleCode === null ? null : (ANOMALY_RULES[ruleCode] ?? null),
        change_pct: poolNumber(raw.a, 'a', context),
        change_target_pct: poolNumber(raw.t, 't', context),
        deviation_pct: poolNumber(raw.x, 'x', context),
        window_days: poolInteger(raw.d, 'd', context),
        // o=2 is the upstream IS_HAPPEN "not today" value; anything else counts as today (frontend mapping).
        is_today: status === null ? null : status !== 2,
        status_code: status,
    };
}
function parseAnomalyCountRow(raw, context) {
    const identity = anomalyIdentity(raw, context);
    // Count `t` is an integer anomaly count; list `t` is a float target change. Never share this parser.
    const times = poolInteger(raw.t, 't', context);
    return {
        ...identity,
        name: anomalyName(raw, context, String(identity.code)),
        board_code: poolInteger(raw.s, 's', context),
        price: poolNumber(raw.p, 'p', context),
        change_pct: poolNumber(raw.a, 'a', context),
        anomaly_times: times,
        deviation_pct: poolNumber(raw.x, 'x', context),
        window_days: poolInteger(raw.d, 'd', context),
    };
}
const anomalyListRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, market: { type: 'string', enum: ['SH', 'SZ', 'BJ'] },
        eastmoney_market_code: nullableNumber, board_code: nullableNumber, rule_code: nullableNumber, rule: nullableString,
        change_pct: nullableNumber, change_target_pct: nullableNumber, deviation_pct: nullableNumber, window_days: nullableNumber,
        is_today: { oneOf: [{ type: 'boolean' }, { type: 'null' }] }, status_code: nullableNumber,
    },
    required: ['thscode', 'code', 'name', 'market', 'eastmoney_market_code', 'board_code', 'rule_code', 'rule', 'change_pct', 'change_target_pct', 'deviation_pct', 'window_days', 'is_today', 'status_code'],
    additionalProperties: false,
};
const anomalyCountRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, market: { type: 'string', enum: ['SH', 'SZ', 'BJ'] },
        eastmoney_market_code: nullableNumber, board_code: nullableNumber,
        price: nullableNumber, change_pct: nullableNumber, anomaly_times: nullableNumber,
        deviation_pct: nullableNumber, window_days: nullableNumber,
    },
    required: ['thscode', 'code', 'name', 'market', 'eastmoney_market_code', 'board_code', 'price', 'change_pct', 'anomaly_times', 'deviation_pct', 'window_days'],
    additionalProperties: false,
};
const anomalyEnvelope = (row) => ({
    type: 'object',
    properties: {
        item: { type: 'array', items: row },
        data_date: { type: 'string' },
        requested_date: nullableString,
        requested_date_clamped: { type: 'boolean' },
        available: { type: 'boolean' },
        row_count: { type: 'integer' },
        pagination: {
            type: 'object',
            properties: { page: { type: 'integer' }, size: { type: 'integer' }, pages: { type: 'integer' } },
            required: ['page', 'size', 'pages'],
            additionalProperties: false,
        },
        note: nullableString,
    },
    required: ['item', 'data_date', 'requested_date', 'requested_date_clamped', 'available', 'row_count', 'pagination', 'note'],
    additionalProperties: false,
});
function anomalySortLetter(sortKey) {
    const letters = { times: 't', deviation_pct: 'x', change_pct: 'a', price: 'p', window_days: 'd' };
    return letters[sortKey] ?? sortKey;
}
async function executeAnomaly(kind, params, signal) {
    const context = kind === 'list' ? 'price anomaly list' : 'price anomaly count';
    const url = new URL(`${ANOMALY_BASE_URL}/${kind}`);
    for (const [key, value] of Object.entries(ANOMALY_H5_PARAMS))
        url.searchParams.set(key, value);
    url.searchParams.set('pageSize', String(params.page_size));
    url.searchParams.set('pageNo', String(params.page_no));
    if (params.date !== undefined)
        url.searchParams.set('date', String(params.date).replaceAll('-', ''));
    if (kind === 'count' && params.sort_key !== undefined) {
        url.searchParams.set('sortKey', anomalySortLetter(String(params.sort_key)));
        url.searchParams.set('sortDir', params.sort_dir === undefined ? 'desc' : String(params.sort_dir));
    }
    const payload = await getJson(url.toString(), signal, context);
    if (Number(payload.result) !== 0) {
        throw sourceError(`Eastmoney ${context} rejected the request: result=${String(payload.result)} msg=${JSON.stringify(payload.msg ?? '')}; result!=0 is an upstream rejection (1001=unknow team), never "no anomalies"`, 'eastmoney_upstream_error');
    }
    const dataDate = compactDay(payload.date);
    if (dataDate === null)
        throw sourceError(`Eastmoney ${context} returned no business date (date=${String(payload.date ?? '(missing)')})`, 'eastmoney_invalid_response');
    const rawRows = poolRowArray(payload.data, context);
    const pageCount = poolInteger(payload.count, 'count', context);
    if (pageCount !== null && pageCount !== rawRows.length) {
        throw sourceError(`Eastmoney ${context} reports count=${pageCount} but returned ${rawRows.length} rows (count is this page's row count)`, 'eastmoney_invalid_response');
    }
    const pages = poolInteger(payload.pages, 'pages', context);
    if (pages === null)
        throw sourceError(`Eastmoney ${context} returned no pages value`, 'eastmoney_invalid_response');
    const requestedDate = params.date === undefined ? null : String(params.date);
    let clamped = false;
    if (requestedDate !== null && requestedDate !== dataDate) {
        if (requestedDate > dataDate)
            clamped = true;
        else {
            throw sourceError(`Eastmoney ${context} only serves the latest business day (${dataDate}); requested ${requestedDate} is not available (upstream ignores the date parameter)`, 'eastmoney_no_anomaly_data');
        }
    }
    const item = rawRows.map((raw) => (kind === 'list' ? parseAnomalyListRow(raw, context) : parseAnomalyCountRow(raw, context)));
    const sortKey = params.sort_key === undefined ? undefined : String(params.sort_key);
    if (kind === 'count' && sortKey !== undefined) {
        const field = ANOMALY_SORT_FIELDS[sortKey];
        const direction = params.sort_dir === 'asc' ? 1 : -1;
        item.sort((left, right) => {
            const leftValue = typeof left[field] === 'number' ? left[field] : null;
            const rightValue = typeof right[field] === 'number' ? right[field] : null;
            if (leftValue === null && rightValue === null)
                return 0;
            if (leftValue === null)
                return 1;
            if (rightValue === null)
                return -1;
            return (leftValue - rightValue) * direction;
        });
    }
    const available = item.length > 0;
    const notes = [];
    if (clamped)
        notes.push(`请求日 ${requestedDate} 晚于上游业务日 ${dataDate}：上游忽略 date 并返回最近业务日（实测 2026-11-22 传 20261001/abc/0/20270105 全部返回 20261120 同一批数据），本批行属于 ${dataDate}。`);
    if (!available)
        notes.push(`上游 data=[]（业务日 ${dataDate} 没有${kind === 'list' ? '严重异常波动明细' : '异动聚合记录'}；合法空，不是取数失败）。`);
    if (kind === 'count' && sortKey !== undefined)
        notes.push('排序在本地对本页执行：上游忽略 sortKey/sortDir（实测 5 种组合返回完全相同的顺序），跨页顺序不受控。');
    return {
        data: {
            item,
            data_date: dataDate,
            requested_date: requestedDate,
            requested_date_clamped: clamped,
            available,
            row_count: item.length,
            pagination: { page: Number(params.page_no), size: Number(params.page_size), pages },
            note: notes.length === 0 ? null : notes.join(' '),
        },
        schema: anomalyEnvelope(kind === 'list' ? anomalyListRow : anomalyCountRow),
    };
}
function normalizeAnomalyDatePrefix(params) {
    const page_size = params.page_size === undefined
        ? undefined
        : integer(params.page_size, 'page_size', 1, MAX_PAGE_SIZE);
    const page_no = params.page_no === undefined ? 1 : integer(params.page_no, 'page_no', 1, Number.MAX_SAFE_INTEGER);
    if (params.date !== undefined) {
        const day = date(params.date, 'date');
        if (day > beijingToday())
            throw new Error(`date ${day} is in the future (Beijing today is ${beijingToday()}); this endpoint only serves the latest business day`);
    }
    return { page_size, page_no, ...(params.date === undefined ? {} : { date: String(params.date) }) };
}
function normalizeAnomalyList(params) {
    assertKnown(params, ['page_size', 'page_no', 'date']);
    const normalized = normalizeAnomalyDatePrefix(params);
    if (normalized.page_size === undefined)
        normalized.page_size = ANOMALY_LIST_DEFAULT_SIZE;
    return normalized;
}
function normalizeAnomalyCount(params) {
    assertKnown(params, ['page_size', 'page_no', 'date', 'sort_key', 'sort_dir']);
    const normalized = normalizeAnomalyDatePrefix(params);
    if (normalized.page_size === undefined)
        normalized.page_size = ANOMALY_COUNT_DEFAULT_SIZE;
    if (params.sort_key !== undefined) {
        const sort_key = String(params.sort_key);
        if (!(sort_key in ANOMALY_SORT_FIELDS))
            throw new Error(`sort_key must be one of ${Object.keys(ANOMALY_SORT_FIELDS).join(', ')}`);
        normalized.sort_key = sort_key;
    }
    if (params.sort_dir !== undefined) {
        const sort_dir = String(params.sort_dir);
        if (sort_dir !== 'desc' && sort_dir !== 'asc')
            throw new Error('sort_dir must be desc or asc');
        normalized.sort_dir = sort_dir;
    }
    return normalized;
}
const anomalyListInput = {
    type: 'object',
    properties: {
        page_size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, description: '每页行数，默认 200；上游实测接受 10000，本层封顶 500（单日通常 < 50 行）' },
        page_no: { type: 'integer', minimum: 1, description: '页码，默认 1' },
        date: { type: 'string', description: '期望业务日 YYYY-MM-DD（可选）。上游忽略该参数、只返回最近业务日；早于返回业务日会被响亮拒绝，晚于则用 requested_date_clamped 标出' },
    },
    required: [],
    additionalProperties: false,
};
const anomalyCountInput = {
    type: 'object',
    properties: {
        ...anomalyListInput.properties,
        page_size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, description: '每页行数，默认 50；上游实测接受 10000，本层封顶 500' },
        sort_key: { type: 'string', enum: Object.keys(ANOMALY_SORT_FIELDS), description: '本地排序键，默认不排序（保持上游顺序）；上游忽略该参数' },
        sort_dir: { type: 'string', enum: ['desc', 'asc'], description: '本地排序方向，默认 desc' },
    },
    required: [],
    additionalProperties: false,
};
const hotConceptRow = {
    type: 'object',
    properties: { concept_name: { type: 'string' }, concept_code: { type: 'string' }, hit_count: { type: 'integer' } },
    required: ['concept_name', 'concept_code', 'hit_count'],
    additionalProperties: false,
};
const hotConceptOutput = {
    type: 'object',
    properties: {
        item: { type: 'array', items: hotConceptRow },
        thscode: { type: 'string' }, ticker: { type: 'string' }, market: { type: 'string', enum: ['SH', 'SZ', 'BJ'] },
        src_security_code: { type: 'string' },
        calculated_at: nullableString,
        calculated_at_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        available: { type: 'boolean' },
        note: nullableString,
    },
    required: ['item', 'thscode', 'ticker', 'market', 'src_security_code', 'calculated_at', 'calculated_at_ms', 'available', 'note'],
    additionalProperties: false,
};
function normalizeHotConcepts(params) {
    assertKnown(params, ['ticker']);
    return { ticker: ashareThscode(params.ticker) };
}
async function executeHotConcepts(params, signal) {
    const thscode = String(params.ticker);
    const [ticker, market] = thscode.split('.');
    const srcSecurityCode = `${market}${ticker}`;
    const payload = await postJsonWithThrottle(HOT_CONCEPT_URL, { ...HOT_CONCEPT_BODY, srcSecurityCode }, signal, 'stock hot concepts');
    if (Number(payload.code) !== 0 || Number(payload.status) !== 0) {
        throw sourceError(`Eastmoney stock hot concepts failed for ${srcSecurityCode}: ${String(payload.message ?? 'unknown upstream error')} (code ${String(payload.code ?? 'unknown')})`, 'eastmoney_upstream_error');
    }
    if (!Array.isArray(payload.data))
        throw sourceError('Eastmoney stock hot concepts returned no data array', 'eastmoney_invalid_response');
    const context = 'stock hot concepts';
    const rawRows = poolRowArray(payload.data, context);
    const rows = rawRows.map((raw) => {
        if (String(raw.srcSecurityCode ?? '') !== srcSecurityCode) {
            throw sourceError(`Eastmoney ${context} returned ${String(raw.srcSecurityCode ?? '(missing)')} for requested ${srcSecurityCode}`, 'eastmoney_invalid_response');
        }
        const conceptName = textOrNull(raw.conceptName);
        if (conceptName === null || conceptName.trim().length === 0)
            throw sourceError(`Eastmoney ${context} row has no conceptName`, 'eastmoney_invalid_response');
        const conceptCode = String(raw.conceptId ?? '');
        if (!/^BK\d{4}$/u.test(conceptCode))
            throw sourceError(`Eastmoney ${context} row has an unusable conceptId ${conceptCode || '(empty)'}`, 'eastmoney_invalid_response');
        const hitCount = poolInteger(raw.hitCount, 'hitCount', context);
        if (hitCount === null)
            throw sourceError(`Eastmoney ${context} row has no hitCount`, 'eastmoney_invalid_response');
        return { concept_name: conceptName, concept_code: conceptCode, hit_count: hitCount };
    });
    // Upstream is already ordered by heat; sort locally so the promise "heat desc" does not depend on it.
    rows.sort((left, right) => right.hit_count - left.hit_count);
    const calculatedAt = rows.length === 0 ? null : textOrNull(rawRows[0].calcTime);
    let calculatedAtMs = null;
    if (calculatedAt !== null) {
        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(calculatedAt))
            throw sourceError(`Eastmoney ${context} returned an unparseable calcTime ${calculatedAt}`, 'eastmoney_invalid_response');
        calculatedAtMs = Date.parse(`${calculatedAt.replace(' ', 'T')}+08:00`);
        if (Number.isNaN(calculatedAtMs))
            throw sourceError(`Eastmoney ${context} returned an unparseable calcTime ${calculatedAt}`, 'eastmoney_invalid_response');
    }
    const available = rows.length > 0;
    return {
        data: {
            item: rows,
            thscode,
            ticker,
            market,
            src_security_code: srcSecurityCode,
            calculated_at: calculatedAt,
            calculated_at_ms: calculatedAtMs,
            available,
            note: available ? null : `东财 App 动态热度口径下 ${srcSecurityCode} 当前没有概念命中（上游 data=[]，合法空，不是取数失败；也不代表该股不属于任何板块）。`,
        },
        schema: hotConceptOutput,
    };
}
function validateLimitPoolOutput(data) {
    return isRecord(data)
        && Array.isArray(data.item)
        && data.item.every(isRecord)
        && data.item.length === data.row_count
        && typeof data.trade_date === 'string'
        && (data.server_latest_trade_date === null || typeof data.server_latest_trade_date === 'string')
        && typeof data.requested_date_clamped === 'boolean'
        && typeof data.available === 'boolean'
        && typeof data.upstream_total === 'number';
}
function validateAnomalyOutput(data) {
    return isRecord(data)
        && Array.isArray(data.item)
        && data.item.every(isRecord)
        && data.item.length === data.row_count
        && typeof data.data_date === 'string'
        && typeof data.available === 'boolean'
        && isRecord(data.pagination);
}
function validateHotConceptOutput(data) {
    return isRecord(data)
        && Array.isArray(data.item)
        && data.item.every(isRecord)
        && typeof data.thscode === 'string'
        && typeof data.available === 'boolean';
}
function createEastmoneyLimitPoolSources() {
    return [
        createSource({
            capability: 'eastmoney_limit_up_pool', cacheMaxAgeMs: 300_000, name: 'get_eastmoney_limit_up_pool',
            summary: '东财涨停池（push2ex 口径，含首末封与封板资金）',
            description: '获取东方财富涨停板行情中心的涨停池（push2ex getTopicZTPool，零 key，与 push2 不同主机；实测 2026-11-22 17:2x 北京时间可直连、HTTP 200）。⛔ 与本地 Fuyao/同花顺口径的 `limit_up_pool` 是**两家口径**：家数、连板数、封板时间、封板资金都不可比、不可拼接、不可混算。参数 trade_date（YYYY-MM-DD，北京时间交易日）**必填**：上游省略 date 直接返回 rc=102 + data=null（实测），没有「最新」默认，本层不做日期猜测。实测 2026-11-20（周五）涨停 28 只、2026-11-19 为 23 只；上游只保留**最近约 15 个交易日**（实测 2026-11-02 有数据 tc=125、2026-10-30 起 tc=0），更早日期与非交易日返回 rc=0 + tc=0 + pool=[]（**不是 data=null，也不是取数失败**：输出 available=false + note）；请求日**晚于最近交易日**（含周末、节假日、未来日）会被上游静默夹到最近交易日，本层在参数层拒绝未来日期，今天及更晚的请求用 requested_date_clamped + server_latest_trade_date（上游 qdate）标出真实归属日。一次 pagesize=10000 取满、不翻页；行数必须等于 data.tc，不等即响亮失败；同一代码出现两次、或 m 市场码与代码号段矛盾同样响亮失败（实测 2026-11-19 曾收到过一次混入其他交易日行的缓存脏响应，靠这两条拦住）。字段映射（均字节级实测）：c→code（6 位）、n→name、m 只用于校验（1=沪，0=深市与北交所同码），不输出；市场一律按代码号段用 helper 推导，禁止按 m 猜、p→price（**上游 ×1000 整数，÷1000 得元**，如 27710→27.71）、zdp→change_pct（百分数原值，10.0039701461792 即 +10.00397%）、amount→amount（成交额，元）、ltsz→float_market_cap（流通市值，元）、tshare→total_market_cap（总市值，元；实测 603324 为 4,183,747,797.2）、hs→turnover_rate_pct（百分数原值）、lbc→limit_days（连板数）、fbt→first_seal、lbt→last_seal（**上游是 HHMMSS 整数**，92501→"09:25:01"；与同花顺的 Unix 秒不是一套）、fund→seal_fund（封板资金，元；实测与腾讯买一量×100×涨停价 28/28 一致）、zbc→break_times（炸板次数）、hybk→industry（东财行业名原文，实测存在被截断的短名如「汽车零部」）、zttj{days,ct}→zt_stat（「N天M板」，东财前端 n/m 口径：days=窗口天数、ct=涨停次数；与连板数 limit_days 不等价，实测 002548 lbc=1 而 zttj={6,3}），同时保留 zt_stat_days/zt_stat_boards 原值。不含炸板/跌停/昨日涨停池字段，不要跨池拼行。',
            inputSchema: limitPoolInput, outputSchema: limitPoolEnvelope(limitUpRow), paginated: false, rowShape: { rowKey: 'item' },
            allowed: ['trade_date'], normalize: normalizeLimitPool, execute: (params, signal) => executeLimitPool(LIMIT_UP_POOL_SPEC, params, signal),
            validateOutput: validateLimitPoolOutput,
        }),
        createSource({
            capability: 'eastmoney_limit_break_pool', cacheMaxAgeMs: 300_000, name: 'get_eastmoney_limit_break_pool',
            summary: '东财炸板池（push2ex 口径，含涨停价与振幅）',
            description: '获取东方财富涨停板行情中心的炸板池（push2ex getTopicZBPool，与涨停池同族、只有 endpoint 与 sort 不同，零 key）。⛔ 与本地 Fuyao/同花顺口径的 `limit_break_pool` 是**两家口径**，家数与字段不可混、不可拼接。参数 trade_date 必填（YYYY-MM-DD）；上游省略 date 返回 rc=102/data=null（实测），非交易日与超出约 15 个交易日保留窗口的日期返回 rc=0 + tc=0 + pool=[]（合法空，输出 available=false + note），请求日晚于最近交易日会被静默夹到最近交易日（用 requested_date_clamped + server_latest_trade_date 标出；未来日期在参数层拒绝）。一次 pagesize=10000 取满不翻页，行数必须等于 data.tc，重复代码或 m 与代码号段矛盾即响亮失败。字段（2026-11-20 实测 7 只）：c/n→code/name、m 只用于校验（市场按代码号段），不输出、p→price（×1000 整数÷1000，元）、ztp→limit_price（**涨停价**，同样 ÷1000；实测直真科技 p=32.26/ztp=35.86、涨跌幅 -1.04%，35.86 恰为昨收 32.60×1.1）、zdp→change_pct（百分数原值）、amount→amount（成交额，元）、ltsz→float_market_cap（元）、tshare→total_market_cap（元）、hs→turnover_rate_pct（百分数原值）、fbt→first_seal（HHMMSS 整数，93454→"09:34:54"）、zbc→break_times（炸板次数）、zf→amplitude_pct（振幅百分数原值）、zs→speed_pct（涨速百分数原值；**实测收盘后全为 0**，盘中才有值）、hybk→industry（东财行业名原文）、zttj{days,ct}→zt_stat/zt_stat_days/zt_stat_boards（「N天M板」，炸板池常见 {0,0} → 「0天0板」，表示窗口内没有计入的连续板数，不是缺数）。本池没有 lbt（末封时间）与封板资金，需要请用 `eastmoney_limit_up_pool`。',
            inputSchema: limitPoolInput, outputSchema: limitPoolEnvelope(limitBreakRow), paginated: false, rowShape: { rowKey: 'item' },
            allowed: ['trade_date'], normalize: normalizeLimitPool, execute: (params, signal) => executeLimitPool(LIMIT_BREAK_POOL_SPEC, params, signal),
            validateOutput: validateLimitPoolOutput,
        }),
        createSource({
            capability: 'eastmoney_limit_down_pool', cacheMaxAgeMs: 300_000, name: 'get_eastmoney_limit_down_pool',
            summary: '东财跌停池（push2ex 口径，含封单资金与连续跌停）',
            description: '获取东方财富涨停板行情中心的跌停池（push2ex getTopicDTPool，零 key；与涨停/炸板同族，sort=fund:asc）。⛔ 与本地 Fuyao/同花顺口径的 `limit_down_pool` 是**两家口径**，家数与字段不可混、不可拼接。参数 trade_date 必填（YYYY-MM-DD）；上游省略 date 返回 rc=102/data=null（实测），非交易日与超出约 15 个交易日保留窗口的日期返回 rc=0 + tc=0 + pool=[]（合法空，available=false + note），请求日晚于最近交易日会被静默夹到最近交易日（requested_date_clamped + server_latest_trade_date 标出；未来日期参数层拒绝）。一次 pagesize=10000 取满不翻页，行数必须等于 data.tc，重复代码或 m 与代码号段矛盾即响亮失败。字段（2026-11-20 实测 58 只，逐列在真报文上核对）：c/n→code/name、m 只用于校验（1=沪、0=深市与北交所同码），不输出；市场按代码号段、p→price（×1000 整数÷1000，元）、zdp→change_pct（百分数原值）、amount→amount（成交额，元；实测与换手率×流通市值一致）、ltsz→float_market_cap（流通市值，元）、tshare→total_market_cap（总市值，元）、pe→pe（东财动态市盈率原值，亏损股为负）、hs→turnover_rate_pct（百分数原值）、fund→seal_fund（**封单资金，元**，上游前端 title「当前以跌停价挂的卖单的资金总量」；实测与腾讯卖一量×100×股价 57/58 一致，如 605255 为 15067 手×100×59.80=90,100,660）、lbt→last_seal（末次触及跌停时间，HHMMSS 整数→HH:MM:SS，实测 135838→"13:58:38"）、days→limit_down_days（**连续跌停天数**，实测 603037 于 11-19 为 1、11-20 为 2 连续递增）、oc→open_times（**打开跌停板次数**）、hybk→industry（东财行业名原文）。⛔ fba→board_amount 收录但**口径不可靠**：上游前端 title 写「成交价格为该股票跌停价的所有成交额的总和」，实测 58 行中 12 行大于当日成交额（002535：157,452,224 vs 23,102,652），3 只全天一字跌停（最高=最低）的票也不等于成交额，说明它并非已成交额子集；原值输出、只允许同列相对比较，禁止当成交额用、禁止与 amount 相减。',
            inputSchema: limitPoolInput, outputSchema: limitPoolEnvelope(limitDownRow), paginated: false, rowShape: { rowKey: 'item' },
            allowed: ['trade_date'], normalize: normalizeLimitPool, execute: (params, signal) => executeLimitPool(LIMIT_DOWN_POOL_SPEC, params, signal),
            validateOutput: validateLimitPoolOutput,
        }),
        createSource({
            capability: 'eastmoney_yesterday_limit_up_pool', cacheMaxAgeMs: 300_000, name: 'get_eastmoney_yesterday_limit_up_pool',
            summary: '东财昨日涨停池（昨涨停今表现，含晋级率原料）',
            description: '获取东方财富涨停板行情中心的**昨日涨停池**（push2ex getYesterdayZTPool，sort=zs:desc，零 key）：昨日涨停个股在今日的表现，用于算晋级率/赚钱效应。⛔ 本地此前没有这一池；与 Fuyao `limit_break_pool`/`limit_up_pool` 是两家口径，不可混算。⛔ **上游字段名带 y_ 前缀（yfbt/ylbc），不能与涨停池复用解析**：本能力用独立 parser 与独立行 schema，`yesterday_first_seal`/`yesterday_limit_days` 只来自 yfbt/ylbc，绝不读 fbt/lbt/lbc。参数 trade_date 必填（YYYY-MM-DD）；上游省略 date 返回 rc=102/data=null（实测），非交易日与超出约 15 个交易日保留窗口的日期返回 rc=0 + tc=0 + pool=[]（合法空），请求日晚于最近交易日会被静默夹到最近交易日（requested_date_clamped + server_latest_trade_date 标出；未来日期参数层拒绝）。一次 pagesize=10000 取满不翻页，行数必须等于 data.tc，重复代码或 m 与代码号段矛盾即响亮失败。字段（2026-11-20 实测 23 只）：c/n→code/name、m 只用于校验（市场按代码号段），不输出、p→price（×1000÷1000，今日最新价，元）、ztp→limit_price（**今日涨停价**，÷1000；已涨停者 ztp==p，实测 002579/002771 相等）、zdp→change_pct（**今日涨跌幅**百分数原值，实测 002420 为 -9.81 即今天砸到接近跌停）、amount→amount（元）、ltsz→float_market_cap（元）、tshare→total_market_cap（元）、hs→turnover_rate_pct（百分数原值）、zf→amplitude_pct（振幅百分数原值）、zs→speed_pct（涨速百分数原值，实测收盘后全 0）、yfbt→yesterday_first_seal（**昨日**最后触及涨停时间，HHMMSS 整数→HH:MM:SS，如 131351→"13:13:51"）、ylbc→yesterday_limit_days（**昨日**连板数；实测 000656 的 1119 涨停池 lbc=1 与本池 ylbc=1 对齐）、hybk→industry、zttj→zt_stat（「N天M板」，按截至今日的口径：今日仍涨停者会更新成今日档，如 002771 昨 3 板、今日仍涨停则本池给 4天4板）。本池没有今日首末封时间与封板资金；要今日封板质量请用 `eastmoney_limit_up_pool`。',
            inputSchema: limitPoolInput, outputSchema: limitPoolEnvelope(yesterdayLimitUpRow), paginated: false, rowShape: { rowKey: 'item' },
            allowed: ['trade_date'], normalize: normalizeLimitPool, execute: (params, signal) => executeLimitPool(YESTERDAY_LIMIT_UP_POOL_SPEC, params, signal),
            validateOutput: validateLimitPoolOutput,
        }),
        createSource({
            capability: 'eastmoney_price_anomaly_list', cacheMaxAgeMs: 900_000, name: 'get_eastmoney_price_anomaly_list',
            summary: '东财严重异常波动明细（规则码/累计偏离/统计窗口）',
            description: '获取东方财富「严重异常波动」口径的异动明细（dycalchis price-anomaly/list，交易所监管口径，零 key）。⛔ 必须带固定 H5 参数 team=h5&product=EastMoney&client=WAP&version=9001&name=WAP&user=123——缺 team 时上游回 {"result":1001,"msg":"unknow team"}（实测）；`result != 0` 一律**正向抛错**（eastmoney_upstream_error），绝不当成「今天没异动」静默吞掉。⛔ **date 参数实测被上游完全忽略**：传 2026-11-20、2026-10-01、abc、0、2027-01-05 全部返回同一批 date=20261120 的数据（2026-11-22 北京时间实测）。因此本能力的 date 只是**断言**：等于返回业务日则通过；早于返回业务日 **响亮失败（eastmoney_no_anomaly_data）**，因为上游拿不到历史；晚于返回业务日（今天/周末/节假日）用 requested_date_clamped 标出，未来日期在参数层拒绝。响应 date 是**业务所属日**（YYYYMMDD→YYYY-MM-DD，非交易时段返回上一交易日属正常）。分页：page_size 默认 200、本层上限 500（上游实测接受 10000）；上游 pages 的口径是 floor(total/page_size)+1（实测 list 4 行、size=2 时 pages=3 且第 3 页为空），count=**本页行数**（不是总数），代码按 count==行数 校验。字段映射（2026-11-20 实测 4 行）：c/n→code/name；m→eastmoney_market_code 仅原值（**m=0 同时代表深市与北交所**，市场只能按代码号段 4/8/92→BJ 判，helper 复用）；s→board_code（板块码，实测 1=主板、4=创业板、5=科创板，窗口内无 6/8 样本）；e→rule_code（规则码；⛔ 上游前端映射：s==6 且 e∈{4,5,6,7} 时按 e*10 取更严阈值那档 4→40/5→50/6→60/7→70，本层按该规则换算，但**实测全窗口只有 s∈{4,5}、没有 s=6 样本，该分支未经真报文验证**）；rule→上游 12 条规则中文名（对不上/未知码给 null，不编造；文字亦未逐条真报文核对）；x→deviation_pct（累计偏离值 %，与 count 端点同名列同一口径：603324 4 连板时 x=48.29/d=4）；d→window_days（统计窗口天数）；a→change_pct（当日涨跌幅 %，实测 600530=-10、603324=+10、002148=8.17 与炸板池 zdp 8.172 一致）；t→change_target_pct（⛔ **list 的 t 是浮点「涨跌幅目标值」**，与 count 的整数 t=异动次数**不是一回事**，本层分开解析、测试钉住；其精确口径未独立核验，只做同列比较）；o→status_code + is_today（上游 IS_HAPPEN：=2 记 false、其余 true，按前端映射，未逐值核验）。空 data 是合法空（available=false + note）。本能力与本地 `anomaly_list`/`abnormal_monitor_list` 的「异动原因/监控区间」口径不同，不可拼接。',
            inputSchema: anomalyListInput, outputSchema: anomalyEnvelope(anomalyListRow), paginated: true, rowShape: { rowKey: 'item' },
            allowed: ['page_size', 'page_no', 'date'], normalize: normalizeAnomalyList, execute: (params, signal) => executeAnomaly('list', params, signal),
            validateOutput: validateAnomalyOutput,
        }),
        createSource({
            capability: 'eastmoney_price_anomaly_count', cacheMaxAgeMs: 900_000, name: 'get_eastmoney_price_anomaly_count',
            summary: '东财异动按标的聚合（窗口内异动次数/累计偏离）',
            description: '获取东方财富「严重异常波动」口径的**按标的聚合统计**（dycalchis price-anomaly/count，零 key）。⛔ 必须带固定 H5 参数 team=h5&product=EastMoney&client=WAP&version=9001&name=WAP&user=123（缺 team 回 result=1001 unknow team）；`result != 0` 一律**正向抛错**，不许当「没有异动」。⛔ date 实测被上游忽略（2026-11-22 传 2026-10-01/abc/0/2027-01-05 全部返回 date=20261120 同一批数据）；本能力 date 只是断言：等于返回业务日通过、早于返回业务日响亮失败（历史拿不到）、晚于用 requested_date_clamped 标出，未来日期参数层拒绝。响应 date 是业务所属日，非交易时段返回上一交易日属正常。分页：page_size 默认 50、本层上限 500；上游 pages=floor(total/page_size)+1（实测 11 行、size=2 时 pages=6），count=本页行数（按 count==行数校验）。⛔ **两函数同名字母含义不同**：本端点（count）的 `t` 是**窗口内异动次数（整数）**，list 端点的 `t` 是浮点「涨跌幅目标值」——本能力用独立 parser，t 非整数即响亮失败，绝不跨端点复用解析（测试钉住）。字段映射（2026-11-20 实测 11 行）：c/n→code/name；m→eastmoney_market_code 仅原值（m=0 同时代表深市与北交所，市场按代码号段判）；s→board_code（实测 1=主板，样本无 4/5/6/8）；p→price（最新价，元；实测 603324=27.71、002771=15.82、002148=10.06 与涨停/炸板池价格逐条一致）；a→change_pct（当日涨跌幅 % 原值）；t→anomaly_times（窗口内异动次数，整数）；x→deviation_pct（累计偏离值 %）；d→window_days（统计窗口天数）。sort_key/sort_dir：⛔ 上游**忽略** sortKey/sortDir（实测 sortKey=t/x/a、asc/desc 共 5 种组合返回完全相同的顺序与数据），本层在**本地对本页**排序（sort_key ∈ times/deviation_pct/change_pct/price/window_days，默认不排序、保持上游顺序），跨页顺序不受控，note 会写明。空 data 是合法空（available=false + note）。本能力与本地 `anomaly_list`/`abnormal_monitor_list` 的「异动原因/监控区间」口径不同，不可拼接。',
            inputSchema: anomalyCountInput, outputSchema: anomalyEnvelope(anomalyCountRow), paginated: true, rowShape: { rowKey: 'item' },
            allowed: ['page_size', 'page_no', 'date', 'sort_key', 'sort_dir'], normalize: normalizeAnomalyCount, execute: (params, signal) => executeAnomaly('count', params, signal),
            validateOutput: validateAnomalyOutput,
        }),
        createSource({
            capability: 'eastmoney_stock_hot_concepts', cacheMaxAgeMs: 300_000, name: 'get_eastmoney_stock_hot_concepts',
            summary: '东财个股动态概念命中热度（App 热度口径）',
            description: '获取东方财富 App「个股热门概念命中」：这只票当下被市场归到哪些概念在炒（emappdata getHotStockRankList，POST {"appId":"appId01","globalId":"786e4c21-70dc-435a-93bb-38","srcSecurityCode":"SH600519"}，零 key）。srcSecurityCode 必须是**大写 SH/SZ/BJ 前缀 + 6 位代码**：市场号段复用本文件既有 helper（4/8/92→BJ，6/9→SH，其余→SZ），**不许按首位猜沪深**，北交所 920x 必须走 BJ。返回 conceptName→concept_name、conceptId→concept_code（BK 码，校验 BK+4 位）、hitCount→hit_count（整数），按 hit_count 降序（上游实测即降序，本层再稳定降序）并给 calculated_at/calculated_at_ms（上游 calcTime，实测「2026-11-22 17:00:00」，北京时间口径的 App 热度计算时间）。⛔ **空 data 是合法空**（该票当前没有概念命中），输出 available=false + note，不是取数失败；实测 600519 有 7 条（白酒 BK0896 命中 6176）、000001 有 8 条、688981 有 6 条，而北交所 920575/920924/430047、错误前缀（SZ600519）、未知代码、裸 6 位代码都返回 code=0 的 data=[]——空只说明动态热度口径无命中，**不代表不属于任何概念**。返回行带 srcSecurityCode，必须与请求票一致，不一致即响亮失败；上游 code/status 非 0 抛错（实测空 body 回 code=-1「srcSecurityCode 股票代码不能为空」）。⛔ 这是**东财 App 动态热度口径**，与 `index_membership_by_stock`（同花顺静态板块归属）**不是一回事：不可对比、不可拼接**；hit_count 是热度命中计数，不是涨幅、资金流或板块成员数。',
            inputSchema: {
                type: 'object',
                properties: {
                    ticker: { type: 'string', description: 'A 股代码（600519 或 600519.SH；北交所 920xxx 也可）；内部转成大写 SH/SZ/BJ 前缀的 srcSecurityCode' },
                },
                required: ['ticker'],
                additionalProperties: false,
            },
            outputSchema: hotConceptOutput, paginated: false, rowShape: { rowKey: 'item' },
            allowed: ['ticker'], normalize: normalizeHotConcepts, execute: executeHotConcepts,
            validateOutput: validateHotConceptOutput,
        }),
    ];
}
