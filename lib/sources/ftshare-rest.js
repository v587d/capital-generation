/**
 * FTShare（非凸科技 `market.ft.tech/gateway`）REST source —— **资金流族**。
 *
 * 为什么接这一族（实测，2026-10-15）：
 * - 同花顺 `capital-flow/*` 对我们是 `code=2004` 永久关闭，东财 `eastmoney_main_capital_snapshot`
 *   实测**只有查询日一股一行**——个股资金流的历史序列在本仓一直是空的。
 * - 板块（行业）资金滚动此前只有 `eastmoney_cashflow_rotation` 一条，上游一抖就没有第二家。
 * 这两族的上游分别是同花顺与东方财富，与现有能力**不是同一条抓取路径**，才够称 plan B。
 *
 * ⛔ 免费档限流 **10 QPS / burst 20**（官方口径）。`DataCollectorHub` 的 FIFO 只保证同一时刻
 * 一个请求，**不含最小间隔**——串行 ≠ 节流（`src/net/eastmoney-client.ts` 同一条教训）。
 * 本模块用进程级节流链把上限压到 ~8 QPS，留突发余量。
 *
 * ⛔ 凭据一律**调用期解析**，注册只看结构（AGENTS.md §9.7，2026-09-30 桌面端 61 能力静默缺席
 * 那一族事故）。套餐外路由返回 403 `route_not_allowed`，归类成 `plan_closed` 且不重试——
 * 它和 Fuyao 的 `2004` 是同一件事：能力级不可用，重试只白烧回合。
 */
import { buildDataKey } from '../data-collector/hub.js';
import { getDataTimeContract } from '../time/tools.js';
import { createRequestThrottle } from '../net/throttle.js';
import { parseSecurityCode } from './security-code.js';
const FTSHARE_BASE_URL = 'https://market.ft.tech/gateway';
/** 10 QPS 的 80% 上限：120ms 最小间隔 ⇒ 稳态 ~8.3 次/秒，突发也不会越过 20。 */
export const FTSHARE_MIN_INTERVAL_MS = 120;
const MAX_PAGE_SIZE = 1000;
const FLOW_PATHS = {
    stock: '/api/v1/market/data/ths-stock-daily-flow',
    industry: '/api/v1/market/data/ths-industry-daily-flow',
    concept: '/api/v1/market/data/ths-concept-daily-flow',
    mainCapital: '/api/v1/market/data/stock-capital-flows',
};
export class FtshareError extends Error {
    kind;
    status;
    code;
    constructor(kind, message, details = {}) {
        super(message);
        this.name = 'FtshareError';
        this.kind = kind;
        this.status = details.status;
        this.code = details.code;
    }
}
/** 进程级节流链：所有 FTShare 请求共用一份（限流按出口计，两份独立限流等于没有限流）。 */
let sharedThrottle;
function ftshareThrottle(task) {
    sharedThrottle ??= createRequestThrottle(FTSHARE_MIN_INTERVAL_MS);
    return sharedThrottle(task);
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
/**
 * 上游数值多处用**字符串**给（实测五档净流入 `"49285883.19"`、日 K 快照收盘价 `"11.5000"`）。
 * 转成 number 是本层的职责：留在字符串里，data_junior 的 `filters` 数值比较会静默不命中。
 * 空串/null/非数一律 `null`——不补 0（§9.5：空洞不许带出，`null` 与 `0` 语义不同）。
 */
function numberOrNull(value) {
    if (value === undefined || value === null || value === '')
        return null;
    const parsed = typeof value === 'number' ? value : Number(String(value).replaceAll(',', '').trim());
    return Number.isFinite(parsed) ? parsed : null;
}
function integerOrNull(value) {
    const parsed = numberOrNull(value);
    return parsed === null ? null : Math.trunc(parsed);
}
function textOrNull(value) {
    return value === undefined || value === null || value === '' ? null : String(value);
}
function date(value, name) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new FtshareError('invalid_parameter', `parameter ${name} must be YYYY-MM-DD`);
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
        throw new FtshareError('invalid_parameter', `parameter ${name} must be a valid YYYY-MM-DD date`);
    return value;
}
/** 上游日期一律 `YYYYMMDD`（实测传 `2026-10-08` 返回 400 `参数无效：date`）。 */
function compactDate(value) {
    return value.replaceAll('-', '');
}
function dateMs(value) {
    return Date.parse(`${value}T00:00:00+08:00`);
}
/** 上游日期列实测有两种写法：`2026-10-14` 与 `20261014`。归一成 ISO + 毫秒轴。 */
function normalizeDateCell(value) {
    const raw = textOrNull(value);
    if (raw === null)
        return { iso: null, ms: null };
    const compact = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(compact))
        return { iso: raw, ms: null };
    const ms = dateMs(compact);
    return { iso: compact, ms: Number.isNaN(ms) ? null : ms };
}
/**
 * `ts_nanos` 是**纳秒**（实测 `1791963000000000000`）。本仓时间轴口径是毫秒（AGENTS.md §通用约定），
 * 纳秒直接落进 Dataset 会让 data_junior 的区间过滤差六个数量级且不报错。
 */
function nanosToMillis(value) {
    const parsed = numberOrNull(value);
    if (parsed === null)
        return null;
    const ms = Math.round(parsed / 1e6);
    return Number.isSafeInteger(ms) ? ms : null;
}
/** 毫秒 → 上海时区的自然日与切片时刻（A 股无夏令时，固定 +08:00 足够）。 */
function shanghaiParts(ms) {
    const shifted = new Date(ms + 8 * 3600_000);
    const iso = shifted.toISOString();
    return { trade_date: iso.slice(0, 10), slice_time: iso.slice(11, 16) };
}
const SLICE_MINUTES = new Set([0, 15, 30, 45]);
/** 盘中切片时刻：上游只认 15 分钟栅格（实测 `0935` → 400，`0930/0945/…/1530` → 200）。 */
function sliceTime(value) {
    const raw = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    const match = /^(\d{2}):?(\d{2})$/.exec(raw);
    if (!match)
        throw new FtshareError('invalid_parameter', 'parameter time must be HHMM or HH:MM on a 15-minute grid (for example 1000, 1015, 1530)');
    const [, hours, minutes] = match;
    const hour = Number(hours);
    const minute = Number(minutes);
    if (hour > 23 || minute > 59)
        throw new FtshareError('invalid_parameter', `parameter time ${raw} is not a clock time`);
    if (!SLICE_MINUTES.has(minute))
        throw new FtshareError('invalid_parameter', `parameter time ${raw} is off the 15-minute grid; use 0930/0945/1000/…`);
    return `${hours}${minutes}`;
}
function pageParams(params, allowed) {
    for (const key of Object.keys(params))
        if (!allowed.includes(key))
            throw new FtshareError('invalid_parameter', `unsupported parameter: ${key}`);
    const page = params.page === undefined ? 1 : Number(params.page);
    const size = params.size === undefined ? 100 : Number(params.size);
    if (!Number.isSafeInteger(page) || page < 1)
        throw new FtshareError('invalid_parameter', 'parameter page must be an integer >= 1');
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PAGE_SIZE)
        throw new FtshareError('invalid_parameter', `parameter size must be an integer from 1 to ${MAX_PAGE_SIZE}`);
    return { page, size };
}
/**
 * 信封有两套（实测）：正常与 4xx 是 `{code,message,data}`，套餐外 403 是 `{code,data,msg}`。
 * 只读 `message` 会把"你无权访问"报成"上游错误：undefined"，白丢一句最该给用户看的话。
 */
function envelopeFailure(envelope, status) {
    const code = numberOrNull(envelope.code);
    const message = textOrNull(envelope.message) ?? textOrNull(envelope.msg) ?? 'request failed';
    const reason = textOrNull(isRecord(envelope.data) ? envelope.data.reason : undefined);
    const details = status === undefined ? {} : { status };
    if (code === null) {
        // 信封里没有业务码（例如 429 只回一个空 JSON 体）：这时**只有 HTTP 状态还能说话**，
        // 把它退化成 upstream_error 等于让限流看起来像"上游坏了"，Agent 会去改参数而不是退避。
        if (status === 429)
            return new FtshareError('rate_limited', 'FTShare HTTP error 429', details);
        if (status === 403)
            return new FtshareError('plan_closed', `FTShare HTTP error 403: ${reason ?? message}（当前套餐不含该路由，不要重试）`, details);
        if (status === 400)
            return new FtshareError('invalid_parameter', `FTShare HTTP error 400: ${message}`, details);
        if (status !== undefined && (status < 200 || status >= 300))
            return new FtshareError('http_error', `FTShare HTTP error ${status}`, details);
        return new FtshareError('invalid_response', 'FTShare envelope carries no code — cannot tell success from failure');
    }
    if (code === 200)
        return null;
    if (code === 403)
        return new FtshareError('plan_closed', `FTShare API error 403: ${reason ?? message}（当前套餐不含该路由，不要重试）`, { ...details, code: 403 });
    if (code === 400)
        return new FtshareError('invalid_parameter', `FTShare API error 400: ${message}`, { ...details, code: 400 });
    if (code === 429)
        return new FtshareError('rate_limited', `FTShare API error 429: ${message}`, { ...details, code: 429 });
    return new FtshareError('upstream_error', `FTShare API error ${code}: ${message}`, { ...details, code });
}
/** key 每次调用现取（`resolveApiKey` 由装配层注入），构造客户端不依赖 key。 */
export function createFtshareClient(resolveApiKey, baseUrl = FTSHARE_BASE_URL) {
    return {
        async getJson(path, search, signal) {
            const apiKey = await resolveApiKey();
            if (!apiKey)
                throw new FtshareError('credential_missing', 'FTSHARE_API_KEY is not configured');
            const query = search.toString();
            const url = `${baseUrl.replace(/\/$/, '')}${path}${query ? `?${query}` : ''}`;
            let response;
            try {
                response = await ftshareThrottle(async () => await fetch(url, { headers: { FTSHARE_API_KEY: apiKey, Accept: 'application/json' }, signal }));
            }
            catch (error) {
                if (error instanceof Error && error.name === 'AbortError')
                    throw error;
                if (error instanceof FtshareError)
                    throw error;
                throw new FtshareError('http_error', `FTShare request failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            // ⛔ 先读信封、再看状态：套餐外的 403 与参数错的 400 都**带 JSON 体**，体里那句
            // `data.reason`（"当前套餐无权访问该接口…"）是给用户看的唯一人话；按状态先抛就等于把它丢了，
            // 而 4xx 的 `response.json()` 在 fetch 里完全合法。
            const parsed = await response.json().catch(() => null);
            if (isRecord(parsed)) {
                const failure = envelopeFailure(parsed, response.status);
                if (failure)
                    throw failure;
                if (response.status < 200 || response.status >= 300)
                    throw new FtshareError('http_error', `FTShare HTTP error ${response.status}`, { status: response.status });
                return parsed;
            }
            // 没有可解析的信封：只能按 HTTP 状态归类（429/403/400 的语义与上面保持一致）。
            if (response.status === 429)
                throw new FtshareError('rate_limited', 'FTShare HTTP error 429', { status: 429 });
            if (response.status === 403)
                throw new FtshareError('plan_closed', 'FTShare HTTP error 403: 当前套餐不含该路由，不要重试', { status: 403 });
            if (response.status === 400)
                throw new FtshareError('invalid_parameter', 'FTShare HTTP error 400', { status: 400 });
            if (response.status < 200 || response.status >= 300)
                throw new FtshareError('http_error', `FTShare HTTP error ${response.status}`, { status: response.status });
            throw new FtshareError('invalid_response', 'FTShare returned a non-object envelope');
        },
    };
}
/** 分页信封两种：`records` + `pageNum/pageSize/pages/total`；本批四条都用这一种。 */
function readPaged(envelope) {
    const data = envelope.data;
    if (!isRecord(data))
        throw new FtshareError('invalid_response', 'FTShare envelope is missing data');
    const rows = Array.isArray(data.records) ? data.records.filter(isRecord) : [];
    return {
        rows,
        pagination: {
            page: integerOrNull(data.pageNum) ?? 1,
            size: integerOrNull(data.pageSize) ?? rows.length,
            pages: integerOrNull(data.pages) ?? 0,
            total: integerOrNull(data.total) ?? rows.length,
        },
    };
}
function query(params, allowed) {
    const search = new URLSearchParams();
    for (const name of allowed) {
        const value = params[name];
        if (value === undefined)
            continue;
        if (typeof value !== 'string' && typeof value !== 'number')
            throw new FtshareError('invalid_parameter', `parameter ${name} must be a string or a number`);
        search.set(name, String(value));
    }
    return search;
}
const dailyFlowRow = {
    type: 'object',
    properties: {
        code: { type: 'string' }, name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date: { oneOf: [{ type: 'string' }, { type: 'null' }] }, trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        close_price: { oneOf: [{ type: 'number' }, { type: 'null' }] }, change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        turnover_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        inflow_yi: { oneOf: [{ type: 'number' }, { type: 'null' }] }, outflow_yi: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        net_amount_yi: { oneOf: [{ type: 'number' }, { type: 'null' }] }, turnover_amount_yi: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
const boardFlowRow = {
    type: 'object',
    properties: {
        board_name: { type: 'string' },
        trade_date: { oneOf: [{ type: 'string' }, { type: 'null' }] }, trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        board_index: { oneOf: [{ type: 'number' }, { type: 'null' }] }, change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        company_count: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        inflow_yi: { oneOf: [{ type: 'number' }, { type: 'null' }] }, outflow_yi: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        net_amount_yi: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        leader_name: { oneOf: [{ type: 'string' }, { type: 'null' }] }, leader_change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        leader_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
const mainCapitalRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date: { oneOf: [{ type: 'string' }, { type: 'null' }] }, slice_time: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        ts_millis: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        net_inflow_super_large_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        net_inflow_large_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        net_inflow_main_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        net_inflow_medium_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        net_inflow_small_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
const output = (row) => ({
    type: 'object',
    properties: {
        item: { type: 'array', items: row },
        pagination: {
            type: 'object',
            properties: { page: { type: 'integer' }, size: { type: 'integer' }, pages: { type: 'integer' }, total: { type: 'integer' } },
            required: ['page', 'size', 'pages', 'total'], additionalProperties: false,
        },
    },
    required: ['item', 'pagination'], additionalProperties: false,
});
const DAILY_FLOW_DESCRIPTION = '按交易日区间获取**同花顺**日度资金流（实测窗口只保留最近约 40 个交易日：T-40 仍有数、T-50 起 total=0，早于窗口的日期是合法空结果、不是取数失败，不要循环重试）。⛔ 金额与成交额单位是**亿元**，这条不是猜的：同一交易日同一标的 `turnover_amount_yi × 1e8` 与本仓全市场快照的成交额逐行对上（实测 1500 行，最大相对误差 0.48%，来自上游按两位小数舍入）。`net_amount_yi = inflow_yi − outflow_yi`，实测 1500 行里 419 行有偏差且**最大偏差恰为 0.01 亿**，即全部来自舍入，不是口径分歧。`change_pct` 与 `turnover_pct` 是**百分数原值**（0.87 表示 0.87%）——注意本仓另一条快照类能力的换手率是小数形式，两者不可混用。⛔ `code` 是上游给的**裸 6 位代码且不带市场后缀**，我们不替它猜交易所（`000001` 在指数的语境里另有其票），需要带后缀的身份请用行情类能力或 `ticker_search`。实测 total 5214 只、**不含北交所**（`920992` 返回 0 条，末页仍是 0028xx 深市主板），北交所资金流本仓仍无覆盖。分页口径：`size` 实测最大可用 1000，`pagination.total` 是上游结果集行数。';
function createFlowSource(options) {
    const schema = {
        capability: options.capability,
        time_contract: getDataTimeContract(options.capability),
        name: options.name,
        source: `http:ftshare.${options.upstreamApi}`,
        data_key: buildDataKey('ftshare', 'http', options.capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: options.summary,
        description: options.description,
        input_schema: options.inputSchema,
        output_schema: output(options.row),
    };
    const normalize = (params) => {
        for (const key of Object.keys(params))
            if (!options.allowed.includes(key))
                throw new FtshareError('invalid_parameter', `unsupported parameter: ${key}`);
        const start_date = date(params.start_date, 'start_date');
        const end_date = date(params.end_date, 'end_date');
        if (start_date > end_date)
            throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date');
        const { page, size } = pageParams(params, options.allowed);
        const normalized = { start_date, end_date, page, size };
        if (typeof params.code === 'string' || typeof params.code === 'number') {
            // 参数层要求带后缀的完整代码（本仓通则），发给上游时按上游口径退回裸码。
            normalized.code = parseSecurityCode(params.code, 'code').digits;
        }
        if (typeof params.board_name === 'string' && params.board_name.trim())
            normalized.board_name = params.board_name.trim();
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({
                start_date: compactDate(String(params.start_date)),
                end_date: compactDate(String(params.end_date)),
                code: params.code,
                board_name: params.board_name,
                page: params.page,
                page_size: params.size,
            }, ['start_date', 'end_date', 'code', 'board_name', 'page', 'page_size']);
            const { rows, pagination } = readPaged(await options.client.getJson(options.path, search, signal));
            return { data: { item: rows.map(options.mapRow), pagination }, schema: output(options.row) };
        },
    };
}
const dailyFlowInputSchema = {
    type: 'object',
    properties: {
        start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD' },
        end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD' },
        page: { type: 'integer', minimum: 1 },
        size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
    },
    required: ['start_date', 'end_date'],
    additionalProperties: false,
};
const boardFlowInputSchema = {
    type: 'object',
    properties: { ...dailyFlowInputSchema.properties, board_name: { type: 'string', description: '板块名精确匹配（如 银行 / IT服务）；实测可用，不做模糊匹配' } },
    required: ['start_date', 'end_date'],
    additionalProperties: false,
};
function mapStockFlowRow(row) {
    const { iso: trade_date, ms } = normalizeDateCell(row.trade_date);
    return {
        code: String(row.code ?? ''), name: textOrNull(row.name),
        trade_date, trade_date_ms: ms,
        close_price: numberOrNull(row.close_price), change_pct: numberOrNull(row.change_pct), turnover_pct: numberOrNull(row.turnover_pct),
        inflow_yi: numberOrNull(row.inflow), outflow_yi: numberOrNull(row.outflow),
        net_amount_yi: numberOrNull(row.net_amount), turnover_amount_yi: numberOrNull(row.turnover_amount),
    };
}
function mapBoardFlowRow(row) {
    const { iso: trade_date, ms } = normalizeDateCell(row.trade_date);
    return {
        board_name: String(row.board_name ?? ''), trade_date, trade_date_ms: ms,
        board_index: numberOrNull(row.board_index), change_pct: numberOrNull(row.change_pct), company_count: integerOrNull(row.company_count),
        inflow_yi: numberOrNull(row.inflow), outflow_yi: numberOrNull(row.outflow), net_amount_yi: numberOrNull(row.net_amount),
        leader_name: textOrNull(row.leader_name), leader_change_pct: numberOrNull(row.leader_change_pct), leader_price: numberOrNull(row.leader_price),
    };
}
/** 追加在同一份日度说明后面的板块口径段（各自独立，避免复制整篇正文）。 */
const INDUSTRY_FLOW_TAIL = ' 本能力是**行业板块**粒度：实测单日 90 个板块（同花顺一级行业口径），company_count 是该板块公司家数，leader_name / leader_change_pct / leader_price 是上游给的领涨股三列（涨跌幅同为百分数原值）。⛔ 板块的 inflow_yi / outflow_yi **不能跨板块相加**去凑"全市场"：实测 90 行 inflow 合计 4088.1 亿，与个股口径不可比，相加只会得出没有人认领的数。';
const CONCEPT_FLOW_TAIL = ' 本能力是**概念板块**粒度：实测单日 387 个概念。⛔ 概念**天然重叠**（实测「2026三季报预增」43 家与「2026中报预增」514 家含同一批票），所以概念之间、概念与行业之间的 inflow_yi / outflow_yi 禁止相加或做占比；"某板块净买入多少"只能在**同一板块内**读。';
/**
 * key 每次调用现取（与 `resolveFuyaoApiKey` 同一口径）：credentials 优先、环境变量兜底。
 * ⛔ 注册面**不得**以"装配期读到 key"为条件（AGENTS.md §9.7），也不要把这里的 rejection 缓存住——
 * 一次装配期抢跑会把这个能力钉到进程结束。
 */
export async function resolveFtshareApiKey(ctx, credentialRef = 'FTSHARE_API_KEY') {
    const credentials = ctx.get('credentials');
    if (credentials?.resolve) {
        const resolved = await credentials.resolve(credentialRef);
        if (resolved?.value)
            return resolved.value;
    }
    const processLike = globalThis.process;
    return processLike?.env?.[credentialRef];
}
export function createFtshareSources(resolveApiKey) {
    const client = createFtshareClient(resolveApiKey);
    return [
        createFlowSource({
            capability: 'ftshare_stock_daily_flow', name: 'get_ths_stock_daily_flow', upstreamApi: 'ths_stock_daily_flow',
            path: FLOW_PATHS.stock, row: dailyFlowRow, client,
            summary: '同花顺个股日度资金流（近 40 交易日，亿元）',
            description: DAILY_FLOW_DESCRIPTION,
            allowed: ['start_date', 'end_date', 'code', 'page', 'size'],
            inputSchema: {
                type: 'object',
                properties: {
                    ...dailyFlowInputSchema.properties,
                    code: { type: 'string', description: '单只过滤，必须带市场后缀（如 600519.SH）；上游只认裸 6 位，本能力在请求边界转换' },
                },
                required: ['start_date', 'end_date'], additionalProperties: false,
            },
            mapRow: mapStockFlowRow,
        }),
        createFlowSource({
            capability: 'ftshare_industry_daily_flow', name: 'get_ths_industry_daily_flow', upstreamApi: 'ths_industry_daily_flow',
            path: FLOW_PATHS.industry, row: boardFlowRow, client,
            summary: '同花顺行业板块日度资金流（近 40 交易日，亿元）',
            description: DAILY_FLOW_DESCRIPTION + INDUSTRY_FLOW_TAIL,
            allowed: ['start_date', 'end_date', 'board_name', 'page', 'size'],
            inputSchema: boardFlowInputSchema,
            mapRow: mapBoardFlowRow,
        }),
        createFlowSource({
            capability: 'ftshare_concept_daily_flow', name: 'get_ths_concept_daily_flow', upstreamApi: 'ths_concept_daily_flow',
            path: FLOW_PATHS.concept, row: boardFlowRow, client,
            summary: '同花顺概念板块日度资金流（近 40 交易日，亿元）',
            description: DAILY_FLOW_DESCRIPTION + CONCEPT_FLOW_TAIL,
            allowed: ['start_date', 'end_date', 'board_name', 'page', 'size'],
            inputSchema: boardFlowInputSchema,
            mapRow: mapBoardFlowRow,
        }),
        createMainCapitalSource(client),
    ];
}
/**
 * 盘中主力资金五档（同花顺口径）。这一条与日度那族**不是一回事**，不要合并成一颗能力：
 * 它的行是「某只票 × 某个 15 分钟切片」，单位是**元**、数值上游用字符串给，
 * 而且实测能翻到约 180 个交易日（日度那族只有 40 天）。
 */
function createMainCapitalSource(client) {
    const capability = 'ftshare_main_capital_flow';
    const allowed = ['date', 'time', 'page', 'size'];
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_stock_capital_flows',
        source: 'http:ftshare.stock_capital_flows',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        cacheMaxAgeMs: 60_000,
        rowShape: { rowKey: 'item' },
        summary: '个股主力资金五档（15 分钟切片，元）',
        description: '按交易日与 15 分钟切片获取 A 股个股主力资金净额五档（超大单 / 大单 / 主力 / 中单 / 小单）。这是**盘中分时**口径，与那三条日度资金流不是同一件事：本能力一行是「一只票 × 一个切片」，日度那族一行是「一只票 × 一个交易日」。⛔ **单位是元**，且两条加减法都用真报文核对过（实测单日 5214 行、违例 0 行、最大偏差 0）：net_inflow_main_yuan = 超大单 + 大单，以及 主力 + 中单 + 小单 = 0——后者成立是因为净额本身带符号，所以**五档相加恒等于 0，不要把它当成"全市场净流入"**。上游把这些数值以**字符串**给出（如 "49285883.19"），本层转成 number，空值转 null 不补 0。日期：date 省略时取最新可用切片；实测不带 time 拿到的是当日**最后一次**切片（2026-10-14 为 15:30）。时刻：time 只认 15 分钟栅格（实测 0930/0945/…/1130、1300/…/1500、1530 有数，0935 被 400 拒），**午间 1145–1215 返回 total=0 是休市、不是取数失败**。历史：实测可翻到约 180 个交易日（T-180 仍有 5172 只、T-240 已空）。⛔ 同样**不含北交所**（实测单日 5214 只、BJ 尾码 0 行）。ts_millis / trade_date / slice_time 由上游的**纳秒**戳换算为毫秒与上海时区历，纳秒原值不透出。默认按主力净流入降序（上游行为），排序不可参数化。',
        input_schema: {
            type: 'object',
            properties: {
                date: { type: 'string', description: '交易日 YYYY-MM-DD；省略 = 最新可用切片' },
                time: { type: 'string', description: '15 分钟切片时刻，HHMM 或 HH:MM（如 1000、10:15、1530）' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
            },
            required: [], additionalProperties: false,
        },
        output_schema: output(mainCapitalRow),
    };
    const normalize = (params) => {
        for (const key of Object.keys(params))
            if (!allowed.includes(key))
                throw new FtshareError('invalid_parameter', `unsupported parameter: ${key}`);
        const { page, size } = pageParams(params, allowed);
        const normalized = { page, size };
        if (params.date !== undefined)
            normalized.date = compactDate(date(params.date, 'date'));
        if (params.time !== undefined)
            normalized.time = sliceTime(params.time);
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({ date: params.date, time: params.time, page: params.page, page_size: params.size }, ['date', 'time', 'page', 'page_size']);
            const { rows, pagination } = readPaged(await client.getJson(FLOW_PATHS.mainCapital, search, signal));
            const item = rows.filter((row) => row.symbol !== undefined && row.symbol !== null).map((row) => {
                const ms = nanosToMillis(row.ts_nanos);
                const parts = ms === null ? { trade_date: null, slice_time: null } : shanghaiParts(ms);
                return {
                    thscode: String(row.symbol), name: textOrNull(row.symbol_name),
                    trade_date: parts.trade_date, slice_time: parts.slice_time, ts_millis: ms,
                    net_inflow_super_large_yuan: numberOrNull(row.net_inflow_extra_large),
                    net_inflow_large_yuan: numberOrNull(row.net_inflow_large),
                    net_inflow_main_yuan: numberOrNull(row.net_inflow_main),
                    net_inflow_medium_yuan: numberOrNull(row.net_inflow_medium),
                    net_inflow_small_yuan: numberOrNull(row.net_inflow_small),
                };
            });
            return { data: { item, pagination }, schema: output(mainCapitalRow) };
        },
    };
}
