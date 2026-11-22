import { buildDataKey } from '../data-collector/hub.js';
import { getDataTimeContract } from '../time/tools.js';
import { createRequestThrottle } from '../net/throttle.js';
const HQ_URL = 'https://hq.sinajs.cn/list=';
const STOCK_NAME_URL = 'https://stock.finance.sina.com.cn/futures/api/openapi.php/StockOptionService.getStockName';
const A50_SYMBOL = 'hf_CHA50CFD';
const SINA_REFERER = 'https://stock.finance.sina.com.cn/';
const USER_AGENT = 'Mozilla/5.0';
const MIN_INTERVAL_MS = 300;
const MAX_CODES = 20;
const TQUOTE_MIN_FIELDS = 45;
const GREEKS_MIN_FIELDS = 16;
const A50_MIN_FIELDS = 14;
const PCT_TOLERANCE = 0.1;
// One serial chain per upstream host: the contract list is 1 API call plus one hq call per month,
// and piling those up concurrently gets the IP answered with empty lists.
const hqThrottle = createRequestThrottle(MIN_INTERVAL_MS);
const optionApiThrottle = createRequestThrottle(MIN_INTERVAL_MS);
const OPTION_UNDERLYINGS = { '510050': '50ETF', '510300': '300ETF', '588000': '科创50', '510500': '500ETF' };
const OPTION_SIDES = { call: 'OP_UP_', put: 'OP_DOWN_' };
// Literal order: object keys with numeric-looking names iterate numerically, so Object.keys would
// publish 510050/510300/510500/588000 instead of the documented order.
const UNDERLYING_LIST = ['510050', '510300', '588000', '510500'];
const SIDE_LIST = ['call', 'put'];
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function sinaError(message, code = 'sina_source_error') {
    const error = new Error(message);
    error.code = code;
    return error;
}
async function sinaGetText(url, throttle, encoding, signal) {
    signal.throwIfAborted();
    return throttle(async () => {
        const response = await fetch(url, { headers: { Referer: SINA_REFERER, 'User-Agent': USER_AGENT }, signal });
        if (!response.ok)
            throw sinaError(`Sina HTTP ${response.status} for ${url}`, response.status === 429 ? 'sina_rate_limit' : 'sina_http_error');
        const bytes = await response.arrayBuffer();
        return new TextDecoder(encoding).decode(bytes);
    });
}
const HQ_VARIABLE = /var hq_str_([A-Za-z0-9_.]+)="([^"]*)"/g;
/** hq.sinajs.cn echoes one `var hq_str_<key>="...";` per requested key; unknown keys come back empty. */
async function fetchHqLists(keys, signal) {
    const text = await sinaGetText(`${HQ_URL}${keys.join(',')}`, hqThrottle, 'gbk', signal);
    const variables = new Map();
    for (const match of text.matchAll(HQ_VARIABLE))
        variables.set(match[1], match[2]);
    const missing = keys.filter((key) => !variables.has(key));
    if (missing.length > 0)
        throw sinaError(`Sina hq reply has no variable for ${missing.join(',')}: the endpoint format changed`, 'sina_invalid_response');
    return variables;
}
/** Empty cell is missing (null); 0 is a real quote value and must survive. */
function sinaNumber(raw, field, context) {
    const text = (raw ?? '').trim();
    if (text === '' || text === 'NoData.')
        return null;
    const value = Number(text);
    if (!Number.isFinite(value))
        throw sinaError(`Sina ${context} has a non-numeric ${field} (${JSON.stringify(text)})`, 'sina_invalid_response');
    return value;
}
function round4(value) {
    const rounded = Math.round(value * 10_000) / 10_000;
    return rounded === 0 ? 0 : rounded;
}
/** YYMM months of the listed contracts, deduped and sorted near first. */
async function fetchContractMonths(cate, signal) {
    const url = `${STOCK_NAME_URL}?exchange=null&cate=${encodeURIComponent(cate)}`;
    const text = await sinaGetText(url, optionApiThrottle, 'utf-8', signal);
    let payload;
    try {
        payload = JSON.parse(text);
    }
    catch {
        throw sinaError(`Sina getStockName returned non-JSON for cate ${cate}`, 'sina_invalid_response');
    }
    if (!isRecord(payload) || !isRecord(payload.result))
        throw sinaError(`Sina getStockName has no result object for cate ${cate}`, 'sina_invalid_response');
    const status = payload.result.status;
    if (!isRecord(status) || Number(status.code) !== 0) {
        const detail = isRecord(status) ? String(status.msg ?? status.code ?? 'unknown') : 'missing status';
        throw sinaError(`Sina getStockName failed for cate ${cate}: ${detail}`, 'sina_upstream_error');
    }
    const data = payload.result.data;
    if (!isRecord(data) || !Array.isArray(data.contractMonth))
        throw sinaError(`Sina getStockName has no contractMonth list for cate ${cate}`, 'sina_invalid_response');
    const months = [];
    for (const entry of data.contractMonth) {
        if (typeof entry !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(entry)) {
            throw sinaError(`Sina getStockName returned an unreadable contract month ${JSON.stringify(entry)} for cate ${cate}`, 'sina_invalid_response');
        }
        const month = `${entry.slice(2, 4)}${entry.slice(5, 7)}`;
        if (!months.includes(month))
            months.push(month);
    }
    if (months.length === 0)
        throw sinaError(`Sina getStockName returned no contract month for cate ${cate}`, 'sina_invalid_response');
    months.sort();
    return { months, stockId: typeof data.stockId === 'string' ? data.stockId : '' };
}
function assertKnown(values, allowed) {
    for (const key of Object.keys(values))
        if (!allowed.includes(key))
            throw new Error(`unsupported parameter: ${key}`);
}
function optionCodes(value) {
    if (!Array.isArray(value) || value.length === 0)
        throw new Error('parameter codes must be a non-empty array of option contract codes');
    if (value.length > MAX_CODES)
        throw new Error(`parameter codes accepts at most ${MAX_CODES} contract codes`);
    const codes = [];
    for (const entry of value) {
        if (typeof entry !== 'string')
            throw new Error('parameter codes must contain strings (for example 10012639 or CON_OP_10012639)');
        const digits = entry.trim().replace(/^CON_OP_/iu, '');
        if (!/^\d{8,12}$/.test(digits))
            throw new Error(`parameter codes has an unreadable option contract code ${JSON.stringify(entry)}: pass the digits (10012639) or CON_OP_<digits>; 6-digit ETF codes such as 510050 are not option contracts`);
        if (!codes.includes(digits))
            codes.push(digits);
    }
    return codes;
}
function normalizeCodes(params) {
    if (!isRecord(params))
        throw new Error('params must be an object');
    return { codes: optionCodes(params.codes) };
}
function normalizeContracts(params) {
    if (!isRecord(params))
        throw new Error('params must be an object');
    const underlying = String(params.underlying ?? '').trim();
    const side = String(params.side ?? '').trim().toLowerCase();
    if (!UNDERLYING_LIST.includes(underlying))
        throw new Error(`parameter underlying must be one of ${UNDERLYING_LIST.join(', ')}`);
    if (!SIDE_LIST.includes(side))
        throw new Error(`parameter side must be call or put`);
    return { underlying, side };
}
const TQUOTE_KEYS = ['name', 'bid_vol', 'bid', 'last', 'ask', 'ask_vol', 'open_interest', 'pct', 'strike', 'prev_close', 'open', 'limit_up', 'limit_down', 'prev_settle', 'amplitude', 'high', 'low', 'volume', 'amount'];
const GREEKS_KEYS = ['name', 'volume', 'delta', 'gamma', 'theta', 'vega', 'iv', 'high', 'low', 'trade_code', 'strike', 'last', 'theory'];
const CONTRACT_KEYS = ['underlying', 'side', 'month', 'contract_code', 'contract_symbol'];
const A50_KEYS = ['name', 'datetime', 'last', 'bid', 'ask', 'high', 'low', 'open', 'prev_settle', 'change', 'change_pct'];
const numberOrNullSchema = { oneOf: [{ type: 'number' }, { type: 'null' }] };
function rowSchema(properties, required) {
    return { type: 'object', properties, required, additionalProperties: false };
}
const contractsOutput = {
    type: 'array',
    items: rowSchema({
        underlying: { type: 'string', enum: UNDERLYING_LIST },
        side: { type: 'string', enum: SIDE_LIST },
        month: { type: 'string' },
        contract_code: { type: 'string' },
        contract_symbol: { type: 'string' },
    }, CONTRACT_KEYS),
};
const tquoteOutput = {
    type: 'array',
    items: rowSchema({
        name: { type: 'string' },
        bid_vol: numberOrNullSchema,
        bid: numberOrNullSchema,
        last: numberOrNullSchema,
        ask: numberOrNullSchema,
        ask_vol: numberOrNullSchema,
        open_interest: numberOrNullSchema,
        pct: numberOrNullSchema,
        strike: numberOrNullSchema,
        prev_close: numberOrNullSchema,
        open: numberOrNullSchema,
        limit_up: numberOrNullSchema,
        limit_down: numberOrNullSchema,
        prev_settle: numberOrNullSchema,
        amplitude: numberOrNullSchema,
        high: numberOrNullSchema,
        low: numberOrNullSchema,
        volume: numberOrNullSchema,
        amount: numberOrNullSchema,
    }, TQUOTE_KEYS),
};
const greeksOutput = {
    type: 'array',
    items: rowSchema({
        name: { type: 'string' },
        volume: numberOrNullSchema,
        delta: numberOrNullSchema,
        gamma: numberOrNullSchema,
        theta: numberOrNullSchema,
        vega: numberOrNullSchema,
        iv: numberOrNullSchema,
        high: numberOrNullSchema,
        low: numberOrNullSchema,
        trade_code: { type: 'string' },
        strike: numberOrNullSchema,
        last: numberOrNullSchema,
        theory: numberOrNullSchema,
    }, GREEKS_KEYS),
};
const a50Output = {
    type: 'array',
    items: rowSchema({
        name: { type: 'string' },
        datetime: { type: 'string' },
        last: { type: 'number' },
        bid: numberOrNullSchema,
        ask: numberOrNullSchema,
        high: numberOrNullSchema,
        low: numberOrNullSchema,
        open: numberOrNullSchema,
        prev_settle: numberOrNullSchema,
        change: numberOrNullSchema,
        change_pct: numberOrNullSchema,
    }, A50_KEYS),
};
function parseTquoteRow(code, body) {
    const context = `CON_OP_${code}`;
    if (body.trim() === '')
        throw sinaError(`Sina ${context} quote is empty: unknown or delisted option contract`, 'sina_empty_quote');
    const v = body.split(',');
    if (v.length < TQUOTE_MIN_FIELDS)
        throw sinaError(`Sina ${context} quote has ${v.length} columns, expected at least ${TQUOTE_MIN_FIELDS}`, 'sina_invalid_response');
    const name = (v[37] ?? '').trim();
    if (name === '')
        throw sinaError(`Sina ${context} quote has an empty contract name at column 38`, 'sina_invalid_response');
    const row = {
        name,
        bid_vol: sinaNumber(v[0], 'bid_vol', context),
        bid: sinaNumber(v[1], 'bid', context),
        last: sinaNumber(v[2], 'last', context),
        ask: sinaNumber(v[3], 'ask', context),
        ask_vol: sinaNumber(v[4], 'ask_vol', context),
        open_interest: sinaNumber(v[5], 'open_interest', context),
        pct: sinaNumber(v[6], 'pct', context),
        strike: sinaNumber(v[7], 'strike', context),
        prev_close: sinaNumber(v[8], 'prev_close', context),
        open: sinaNumber(v[9], 'open', context),
        limit_up: sinaNumber(v[10], 'limit_up', context),
        limit_down: sinaNumber(v[11], 'limit_down', context),
        prev_settle: sinaNumber(v[44], 'prev_settle', context),
        amplitude: sinaNumber(v[38], 'amplitude', context),
        high: sinaNumber(v[39], 'high', context),
        low: sinaNumber(v[40], 'low', context),
        volume: sinaNumber(v[41], 'volume', context),
        amount: sinaNumber(v[42], 'amount', context),
    };
    // pct is quoted against the previous settlement (column 45), not prev_close (column 9); amplitude
    // against prev_close. A mismatch here means the columns moved, so the whole batch fails.
    const { pct, last, prev_settle: prevSettle } = row;
    if (typeof pct === 'number' && typeof last === 'number' && typeof prevSettle === 'number' && last > 0 && prevSettle > 0) {
        const expected = ((last - prevSettle) / prevSettle) * 100;
        if (Math.abs(pct - expected) > PCT_TOLERANCE) {
            throw sinaError(`Sina ${context} pct ${pct} contradicts (last - prev_settle) / prev_settle = ${expected.toFixed(2)}%: the column layout changed`, 'sina_invalid_response');
        }
    }
    return row;
}
function parseGreeksRow(code, body) {
    const context = `CON_SO_${code}`;
    if (body.trim() === '')
        throw sinaError(`Sina ${context} quote is empty: unknown or delisted option contract`, 'sina_empty_quote');
    const raw = body.split(',');
    if (raw.length < GREEKS_MIN_FIELDS)
        throw sinaError(`Sina ${context} quote has ${raw.length} columns, expected at least ${GREEKS_MIN_FIELDS}`, 'sina_invalid_response');
    if ((raw[1] ?? '') !== '' || (raw[2] ?? '') !== '' || (raw[3] ?? '') !== '') {
        throw sinaError(`Sina ${context} placeholders raw[1..3] are no longer blank (${JSON.stringify(raw.slice(1, 4))}): the [raw[0]] + raw[4:] shift would misalign delta..iv`, 'sina_invalid_response');
    }
    const v = [raw[0], ...raw.slice(4)];
    const name = (v[0] ?? '').trim();
    if (name === '')
        throw sinaError(`Sina ${context} quote has an empty contract name`, 'sina_invalid_response');
    const tradeCode = (v[9] ?? '').trim();
    if (tradeCode === '')
        throw sinaError(`Sina ${context} quote has an empty trade code at column 10`, 'sina_invalid_response');
    return {
        name,
        volume: sinaNumber(v[1], 'volume', context),
        delta: sinaNumber(v[2], 'delta', context),
        gamma: sinaNumber(v[3], 'gamma', context),
        theta: sinaNumber(v[4], 'theta', context),
        vega: sinaNumber(v[5], 'vega', context),
        iv: sinaNumber(v[6], 'iv', context),
        high: sinaNumber(v[7], 'high', context),
        low: sinaNumber(v[8], 'low', context),
        trade_code: tradeCode,
        strike: sinaNumber(v[10], 'strike', context),
        last: sinaNumber(v[11], 'last', context),
        theory: sinaNumber(v[12], 'theory', context),
    };
}
function primitive(value) {
    return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}
function rowGuard(keys, allowEmpty) {
    return (data) => Array.isArray(data)
        && (allowEmpty || data.length > 0)
        && data.every((row) => isRecord(row) && Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key) && primitive(row[key])));
}
function createSource(options) {
    const schema = {
        capability: options.capability,
        time_contract: getDataTimeContract(options.capability),
        name: options.name,
        source: `http:sina.${options.capability}`,
        data_key: buildDataKey('sina', 'http', options.capability),
        source_label: 'sina',
        paginated: false,
        cacheMaxAgeMs: options.cacheMaxAgeMs,
        rowShape: { rootArray: true },
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
    const guard = rowGuard(options.keys, options.allowedEmpty);
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => guard(data) && (options.singleRow !== true || (Array.isArray(data) && data.length === 1)),
        execute: async (request, signal) => options.execute(normalize(request.params), signal),
    };
}
const codesInput = {
    type: 'object',
    properties: {
        codes: { type: 'array', minItems: 1, maxItems: MAX_CODES, items: { type: 'string', description: '期权合约代码：10012639 或 CON_OP_10012639' } },
    },
    required: ['codes'],
    additionalProperties: false,
};
const contractsInput = {
    type: 'object',
    properties: {
        underlying: { type: 'string', enum: UNDERLYING_LIST, description: '期权标的 ETF 代码' },
        side: { type: 'string', enum: SIDE_LIST, description: 'call 认购 / put 认沽' },
    },
    required: ['underlying', 'side'],
    additionalProperties: false,
};
async function executeContracts(params, signal) {
    const underlying = String(params.underlying);
    const side = String(params.side);
    const cate = OPTION_UNDERLYINGS[underlying];
    const flag = OPTION_SIDES[side];
    const meta = await fetchContractMonths(cate, signal);
    if (meta.stockId !== '' && meta.stockId !== underlying) {
        throw sinaError(`Sina getStockName cate=${cate} resolved to ${meta.stockId}, expected ${underlying}: the cate table changed`, 'sina_invalid_response');
    }
    const rows = [];
    for (const month of meta.months) {
        const listKey = `${flag}${underlying}${month}`;
        const variables = await fetchHqLists([listKey], signal);
        const body = variables.get(listKey) ?? '';
        if (body.trim() === '')
            continue; // a month with no listed contract is a legal empty, not a failure
        for (const token of body.split(',')) {
            const trimmed = token.trim();
            if (trimmed === '')
                continue;
            if (!/^CON_OP_\d+$/.test(trimmed))
                throw sinaError(`Sina ${listKey} returned an unexpected contract token ${JSON.stringify(trimmed)}`, 'sina_invalid_response');
            rows.push({ underlying, side, month, contract_code: trimmed.slice(7), contract_symbol: listKey });
        }
    }
    return { data: rows, schema: contractsOutput };
}
async function executeTquote(params, signal) {
    const codes = params.codes;
    const variables = await fetchHqLists(codes.map((code) => `CON_OP_${code}`), signal);
    return { data: codes.map((code) => parseTquoteRow(code, variables.get(`CON_OP_${code}`) ?? '')), schema: tquoteOutput };
}
async function executeGreeks(params, signal) {
    const codes = params.codes;
    const variables = await fetchHqLists(codes.map((code) => `CON_SO_${code}`), signal);
    return { data: codes.map((code) => parseGreeksRow(code, variables.get(`CON_SO_${code}`) ?? '')), schema: greeksOutput };
}
async function executeA50(_params, signal) {
    const variables = await fetchHqLists([A50_SYMBOL], signal);
    const body = variables.get(A50_SYMBOL) ?? '';
    const context = A50_SYMBOL;
    if (body.trim() === '')
        throw sinaError(`Sina ${context} quote is empty: the A50 CFD symbol probably moved`, 'sina_empty_quote');
    const v = body.split(',');
    if (v.length < A50_MIN_FIELDS)
        throw sinaError(`Sina ${context} quote has ${v.length} columns, expected at least ${A50_MIN_FIELDS}`, 'sina_invalid_response');
    const date = (v[12] ?? '').trim();
    const clock = (v[6] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw sinaError(`Sina ${context} has an unreadable date ${JSON.stringify(date)}`, 'sina_invalid_response');
    if (!/^\d{2}:\d{2}:\d{2}$/.test(clock))
        throw sinaError(`Sina ${context} has an unreadable time ${JSON.stringify(clock)}`, 'sina_invalid_response');
    const name = (v[13] ?? '').trim();
    if (name === '')
        throw sinaError(`Sina ${context} has an empty contract name`, 'sina_invalid_response');
    const last = sinaNumber(v[0], 'last', context);
    if (last === null)
        throw sinaError(`Sina ${context} last price is empty`, 'sina_invalid_response');
    const prevSettle = sinaNumber(v[7], 'prev_settle', context);
    const change = prevSettle === null || prevSettle === 0 ? null : round4(last - prevSettle);
    const changePct = prevSettle === null || prevSettle === 0 ? null : round4(((last - prevSettle) / prevSettle) * 100);
    const row = {
        name,
        datetime: `${date} ${clock}`,
        last,
        bid: sinaNumber(v[2], 'bid', context),
        ask: sinaNumber(v[3], 'ask', context),
        high: sinaNumber(v[4], 'high', context),
        low: sinaNumber(v[5], 'low', context),
        open: sinaNumber(v[8], 'open', context),
        prev_settle: prevSettle,
        change,
        change_pct: changePct,
    };
    return { data: [row], schema: a50Output };
}
export function createSinaSources() {
    return [
        createSource({
            capability: 'sina_etf_option_contracts',
            cacheMaxAgeMs: 300_000,
            name: 'get_sina_etf_option_contracts',
            summary: '新浪 ETF 期权合约清单（标的×月份×认购/认沽）',
            description: '列出上交所四只 ETF（510050 上证50ETF、510300 沪深300ETF、588000 科创50ETF、510500 中证500ETF）当前挂牌的期权合约，按标的 × side（call 认购 / put 认沽）× 月份一行一合约；underlying、side 必填。月份取自新浪 StockOptionService.getStockName 的 contractMonth，转 YYMM（2612 = 2026-12）后按值去重、升序输出，即近月在前：实测 2026-11-22 返回 ["2026-11","2026-11","2026-12","2027-03","2027-06"]，首个 2026-11 是重复项而不是额外的已到期月（去重后为 2611/2612/2703/2706 四个挂牌月），所以本能力按值去重、不照抄上游「丢掉第一个月」的写法；已到期的 2610/2609 不在该列表内（虽仍能用 OP_UP_<code> 取到历史合约）。month 是 YYMM 字符串，与列表名同串。contract_code 是新浪数字合约号（剥掉 CON_OP_ 前缀，如 10012639，可直接喂给 T 型报价 / 希腊字母能力），contract_symbol 是该行来源的 hq 列表名（如 OP_UP_5100502612），供逐行核对。⛔ 本能力不含合约简称与行权价（中证500ETF 等有分红调整合约：简称带 A 后缀、行权价非整数），要用 T 型报价能力取。某个月列表为空是合法空（该月无挂牌合约），整月跳过；列表非空但出现非 CON_OP_<数字> 元素、或 hq 回包缺少该月变量，都按 sina_invalid_response 失败。',
            inputSchema: contractsInput,
            outputSchema: contractsOutput,
            allowed: ['underlying', 'side'],
            normalize: normalizeContracts,
            allowedEmpty: true,
            keys: CONTRACT_KEYS,
            execute: executeContracts,
        }),
        createSource({
            capability: 'sina_etf_option_tquote',
            cacheMaxAgeMs: 30_000,
            name: 'get_sina_etf_option_tquote',
            summary: '新浪 ETF 期权 T 型报价（盘口/持仓/涨跌/振幅）',
            description: '按合约代码批量取新浪 ETF 期权 T 型报价（hq 的 CON_OP_ 行情），一次 1..20 个代码；codes 接受纯数字 10012639 或带前缀 CON_OP_10012639（归一成纯数字并去重；纯数字须为 8~12 位，510050 这类 6 位 ETF 代码不是期权合约，会被参数层拒绝），输出行顺序 = 请求 codes 顺序，用 name（如 50ETF购12月2650）对回合约。单位：bid_vol/ask_vol/open_interest/volume 是张（1 张 = 10000 份 ETF），amount 是元，价格类是每份元；amount / (volume × 10000) 就是成交均价（实测 2026-11-22 的 300ETF购12月3600：2495304 / (702×10000) = 0.3555，落在当日 high 0.3754 / low 0.3388 之间）。pct 与 amplitude 都是百分数（-15.88 表示 -15.88%，不是比例），⛔ 但两者基准不同：pct = (last − prev_settle) / prev_settle × 100，基准是昨结算价（交易所逐日结算，和 prev_close 是两个数；深实值合约的结算价常贴着内在价值，与昨收能差出十几个百分点，所以 pct 大幅为负不代表昨收也跌了）；amplitude = (high − low) / prev_close × 100，基准是 prev_close（昨收）。实测同一行 last 0.3585、prev_close 0.4189、prev_settle 0.4600、pct −22.07、amplitude 8.74：用 prev_close 算涨跌只有 −14.4%，所以不要用 pct 反推 prev_close，也不要拿 prev_close 复核 pct。0 是真实值（无申报/无成交/持仓为 0），空串才返回 null；bid/ask/limit_down 为 0 很常见（无对手价、跌停价为最小变动价位）。⛔ 上游报文 51 列、下标 44 是昨结算价、下标 8 是昨收；列数 < 45、name 为空、或 pct 与 (last−prev_settle)/prev_settle×100 相差超过 0.1 个百分点，一律 sina_invalid_response 响亮失败，不返回空行；请求里的合约不存在（新浪回空内容）报 sina_empty_quote。行内不含行情时间（该列对多数合约是 00:00:00），判断新鲜度用 Dataset 的 captured_at。',
            inputSchema: codesInput,
            outputSchema: tquoteOutput,
            allowed: ['codes'],
            normalize: normalizeCodes,
            allowedEmpty: false,
            keys: TQUOTE_KEYS,
            execute: executeTquote,
        }),
        createSource({
            capability: 'sina_etf_option_greeks',
            cacheMaxAgeMs: 30_000,
            name: 'get_sina_etf_option_greeks',
            summary: '新浪 ETF 期权希腊字母与隐含波动率',
            description: '按合约代码批量取新浪期权扩展行情（hq 的 CON_SO_）：希腊字母 + 隐含波动率 + 理论价值，一次 1..20 个代码，codes 规则与行顺序同 T 型报价。字段：name（合约简称）、volume（成交量，张）、delta/gamma/theta/vega（新浪侧算好的原始值，本层不换算，也不反推）、iv（隐含波动率，小数：0.2244 = 22.44%，不是百分数）、high/low（当日权利金最高/最低，与 T 型报价同值）、trade_code（交易所交易代码如 510050C2612M02650，可对回行情软件）、strike（行权价，元/份标的）、last（最新价，元/份）、theory（新浪理论价值，元/份）。⛔ 上游 CON_SO_ 报文名后紧跟 3 个空串（价值状态/内在价值/时间价值，页面自己算，不下发），必须按 [raw[0]] + raw[4:] 取值；实测 2026-11-22 是 17 列：名、3 空串、volume、delta、gamma、theta、vega、iv、high、low、trade_code、strike、last、theory、市场标识。⛔ 列数 < 16 或 raw[1..3] 不再全为空串，都按 sina_invalid_response 响亮失败——后者说明上游改版，照抄错位映射会把 delta/IV 整列搬错。iv 在权利金低于内在价值时被压到下限（实测 0.0007，不是真实波动率）；深实值认沽 theta 可以为正，不是符号错误。0 是真实值，空串才是 null。基金有分红调整合约（简称带 A、行权价非整数）时行权价按交易所调整后口径，跨合约比较行权价前先看简称。',
            inputSchema: codesInput,
            outputSchema: greeksOutput,
            allowed: ['codes'],
            normalize: normalizeCodes,
            allowedEmpty: false,
            keys: GREEKS_KEYS,
            execute: executeGreeks,
        }),
        createSource({
            capability: 'sina_a50_futures',
            cacheMaxAgeMs: 30_000,
            name: 'get_sina_a50_futures',
            summary: '富时中国 A50 CFD 连续报价（新浪）',
            description: '富时中国 A50 指数期货 CFD 的连续报价（新浪 hf_CHA50CFD，单行），盘前与夜盘看外资对 A 股的风险偏好用；无参数。⛔ 这是 CFD 连续行情，不是某个具体月份的期货合约：不承诺合约月份、交易所结算价、持仓量、成交额；也不含 CME 的 ES/NQ/YM/RTY（那四个不在本能力范围），不要把它说成 CME 期货或国内股指期货。字段：last/open/high/low/bid/ask（指数点），prev_settle（新浪外盘行情页把 hf_ 行第 8 列标成「昨日结算价」，CFD 没有官方结算价，把它当上一交易日参考价即可，本能力不承诺它是结算价），change/change_pct 由本层按 last − prev_settle 现算（change_pct 是百分数：-0.85 表示 -0.85%，四舍五入到 4 位小数；prev_settle 缺失或为 0 时两者为 null）。⛔ 时间轴：datetime 是 hf_ 行的日期 + 时间，北京时间（UTC+8）墙钟，不是交易所当地时间——实测用 hf_GC 交叉验证：报文 2026-11-21 05:59:57 对应 COMEX 黄金 16:59:57 EST 收盘，即北京 05:59；这只品种的交易时钟就是 UTC+8（与北京同步），所以『北京时间 vs 交易所时间』在它身上无法区分；别把这个结论推广到其他 hf_ 品种。夜盘跨零点：该品种夜盘收在次日 05:15 前后（北京），周五夜盘最后一笔就显示成 2026-11-21 05:14:59（周六），所以 datetime 的日期不是交易日，周末/假期抓到的都是上一场收盘快照。⛔ 没有 hq_str 变量、列数 < 14、日期或时间格式变了、last 为空、name 为空，一律 sina_invalid_response / sina_empty_quote 失败，不返回伪造行；原始报文第 15 列（实测 141730）语义无法从新浪公开栏位确认，已丢弃。',
            inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
            outputSchema: a50Output,
            allowed: [],
            normalize: () => ({}),
            allowedEmpty: false,
            singleRow: true,
            keys: A50_KEYS,
            execute: executeA50,
        }),
    ];
}
