import { buildDataKey } from '../data-collector/hub.js';
import { getDataTimeContract } from '../time/tools.js';
import { sharedEastmoneyClient, EastmoneyTransportError } from '../net/eastmoney-client.js';
import { normalizeEastmoneyAshareIdentity, normalizeEastmoneyBoardIdentity, normalizeEastmoneySecurityIdentity } from './security-identity.js';
const DATACENTER_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const CLIST_URL = 'https://push2.eastmoney.com/api/qt/clist/get';
const MAX_PAGE_SIZE = 500;
const EASTMONEY_UT = 'bd1d9ddb04089700cf9c27f6f7426281';
const BOARD_TYPES = ['industry', 'concept', 'region'];
const BOARD_FS = { industry: 'm:90+t:2', concept: 'm:90+t:3', region: 'm:90+t:1' };
const SORT_FIELDS = { change_pct: 'f3', main_net_inflow: 'f62', amount: 'f6' };
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
 * 东财请求统一走**进程级共享**的东财客户端（`src/net/eastmoney-client.ts`）。
 *
 * 为什么必须共享：东财按**出口 IP** 风控（社区实测 >5 次/秒、1 分钟 ≥200 次、5 分钟 ≥300 次
 * 即临时封禁），而本仓曾经有**两份互不知情**的东财出口——数据面这里的裸 `fetch`，与
 * web_retriever 具名来源工具自己的一份。两份独立限流等于没有限流。
 * 现在两条数据面共用同一个节流器：数据面按"可复用性"分层（数值/分页走 Hub、流式文本走
 * web_retriever），但**网络面只有一份**。
 *
 * 本函数原有的错误码语义（`eastmoney_rate_limit` / `eastmoney_http_error` /
 * `eastmoney_invalid_response`）刻意保持不变——收敛的是网络面，不是调用方的契约。
 */
async function getJson(url, signal, context) {
    let payload;
    try {
        payload = await sharedEastmoneyClient().fetchJson(url, { signal });
    }
    catch (error) {
        // 调用方取消原样抛出；上游 HTTP 错误状态按既有口径归类。
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
    // 上游用 code 9201 表示"返回数据为空"（success:false），这是**真实数据缺口**而非上游故障：
    // 节假日、或该窗口确实没有任何记录。归类成 eastmoney_upstream_error 会诱导模型反复重试
    // （§10.4 明令"数据缺口不要重试"），也与单票路径把 9201 判成"无记录"自相矛盾。
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
function parseTopRow(raw) {
    // ⚠️ 上游 `MARKET` 是自由文本（实测存在 `SZ` 之外的写法），而 SECUCODE 自带市场后缀时
    // 它是冗余信息：只有 SECUCODE 不带市场时才拿它做必填校验，否则原文喂进硬白名单会把
    // 整页龙虎榜判成错误（护栏误杀真实数据，§10.2）。行里的 `market` 字段仍原样保留。
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
function createSource(options) {
    const schema = { capability: options.capability, time_contract: getDataTimeContract(options.capability), name: options.name, source: `http:eastmoney.${options.capability}`, data_key: buildDataKey('eastmoney', 'http', options.capability), source_label: 'eastmoney', paginated: options.paginated === true, cacheMaxAgeMs: options.cacheMaxAgeMs, rowShape: options.rowShape, summary: options.summary, description: options.description, input_schema: options.inputSchema, output_schema: options.outputSchema };
    const normalize = (params) => options.normalize(params);
    return { schema, normalizeParams: normalize, validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination), execute: async (request, signal) => options.execute(normalize(request.params), signal) };
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
export function createEastmoneySources() {
    return [
        createSource({ capability: 'eastmoney_top_buy_sell_market', name: 'get_eastmoney_top_buy_sell_market', summary: '东财全市场龙虎榜汇总', description: '按交易日区间分页获取东方财富龙虎榜上榜股票汇总。金额字段单位为元，CHANGE_RATE/TURNOVERRATE/DEAL_*_RATIO 为东财百分数原值；同一股票同日可能因多个上榜原因返回多行，不去重。上游 HTTP 200 但 success=false、code 非 0 或 result 缺失均视为失败，不转换为空数组。', inputSchema: dateRangeInput, outputSchema: datacenterOutput(topBuySellRow), paginated: true, rowShape: { rowKey: 'item' }, allowed: ['start_date', 'end_date', 'page', 'size'], normalize: (params) => normalizeDateRange(params, ['start_date', 'end_date', 'page', 'size']), execute: (params, signal) => executeBillboard(params, signal) }),
        createSource({ capability: 'eastmoney_top_buy_sell_ticker', name: 'get_eastmoney_top_buy_sell_ticker', summary: '东财单票龙虎榜汇总', description: '按单只 A 股和交易日区间获取东方财富龙虎榜汇总。ticker 必须带 SH/SZ/BJ 市场后缀；请求内部转换为 SECURITY_CODE，单票过滤器要求日期使用单引号、代码使用双引号。返回保留同日多条上榜原因；金额单位为元，百分比为东财原值。该能力是上榜股票汇总，不是营业部席位明细。', inputSchema: { type: 'object', properties: { ticker: { type: 'string', description: '完整证券代码，如 600519.SH' }, start_date: { type: 'string' }, end_date: { type: 'string' }, page: { type: 'integer', minimum: 1 }, size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE } }, required: ['ticker', 'start_date', 'end_date'], additionalProperties: false }, outputSchema: datacenterOutput(topBuySellRow), paginated: true, rowShape: { rowKey: 'item' }, allowed: ['ticker', 'start_date', 'end_date', 'page', 'size'], normalize: normalizeTicker, execute: (params, signal) => executeBillboard(params, signal, String(params.ticker)) }),
        createSource({ capability: 'eastmoney_lockup_expiry', name: 'get_eastmoney_lockup_expiry', summary: '东财限售解禁日历', description: '按自然日期区间分页获取东方财富限售解禁日历。已验证字段包括解禁日期、解禁股份类型、FREE_SHARES、TOTAL_RATIO、NON_FREE_SHARES、ABLE_FREE_SHARES；TOTAL_RATIO 是小数比例，股份数量字段以 free_shares_raw 等原始数值保存，单位以东财页面口径为准，未擅自标成股。', inputSchema: dateRangeInput, outputSchema: datacenterOutput(lockupRow), paginated: true, rowShape: { rowKey: 'item' }, allowed: ['start_date', 'end_date', 'page', 'size'], normalize: (params) => normalizeDateRange(params, ['start_date', 'end_date', 'page', 'size']), execute: executeLockup }),
        createSource({ capability: 'eastmoney_sector_rotation', cacheMaxAgeMs: 60_000, name: 'get_eastmoney_sector_rotation', summary: '东财板块行情排名快照', description: '获取东方财富行业、概念或地域板块的查询时点排名快照。默认行业、按涨跌幅排序；board_type 映射为东财 m:90+t:2/3/1。不是历史轮动序列，Dataset 的 captured_at 才是采集时间；板块代码使用 board_code，不归一为证券 ticker。', inputSchema: boardInput, outputSchema: { type: 'object', properties: { item: { type: 'array', items: sectorRow }, pagination: { type: 'object', additionalProperties: true } }, required: ['item', 'pagination'], additionalProperties: true }, paginated: true, rowShape: { rowKey: 'item' }, allowed: ['board_type', 'sort_field', 'page', 'size'], normalize: normalizeBoard, execute: (params, signal) => executeBoard(params, signal, false) }),
        createSource({ capability: 'eastmoney_cashflow_rotation', cacheMaxAgeMs: 60_000, name: 'get_eastmoney_cashflow_rotation', summary: '东财板块资金流快照', description: '获取东方财富行业、概念或地域板块当前资金流快照，默认按主力净流入排序。f62/f66/f72/f78/f84 为金额原值（元），f184/f69/f75/f81/f87 为东财原始占比；当前只承诺查询时点快照，不把未确认的 5 日/10 日字段映射为历史序列。', inputSchema: cashflowInput, outputSchema: { type: 'object', properties: { item: { type: 'array', items: cashflowRow }, pagination: { type: 'object', additionalProperties: true } }, required: ['item', 'pagination'], additionalProperties: true }, paginated: true, rowShape: { rowKey: 'item' }, allowed: ['board_type', 'page', 'size'], normalize: normalizeCashflowBoard, execute: (params, signal) => executeBoard(params, signal, true) }),
        ...MACRO_TABLES.map(createMacroSource),
    ];
}
