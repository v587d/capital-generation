/**
 * FTShare（非凸科技 `market.ft.tech/gateway`）REST source —— **资金流 + 行情/日 K 截面 + 快照与日历
 * + 大宗与披露 + 申万行业 + 期货与贵金属**。
 *
 * 为什么接这一族（批次 A–E 逐条真报文实测于 2026-10-15，批次 F 于 2026-10-16）：
 * - 同花顺 `capital-flow/*` 对我们是 `code=2004` 永久关闭，东财 `eastmoney_main_capital_snapshot`
 *   实测**只有查询日一股一行**——个股资金流的历史序列在本仓一直是空的。这一族给到最近约 45 个交易日
 *   （T-45 仍有 5199 行、T-50 起 total=0），主力五档更给到约 187 个交易日。
 * - 板块（行业）资金滚动此前只有 `eastmoney_cashflow_rotation` 一条，上游一抖就没有第二家。
 * - 北交所行情此前是**零**：腾讯那一路在参数层明确拒 BJ，而这一族实测含 349 只北证票。
 * - 期货与贵金属此前在本仓是**整块空白**（`ticker_search` 只允许消歧到期货交易所，没有一条数据端点），
 *   所以批次 F 那十颗不是第二家，而是第一家：合约清单与要素、日/周/月/季 K 线、涨跌停价、每日结算参数、
 *   仓单日报、品种周报、南华商品指数、东财会员持仓排名、贵金属价格。
 * 上游分别是同花顺与同花顺 daec，与现有能力**不是同一条抓取路径**，才够称 plan B。
 *
 * ⛔ 本模块的 description 与注释**只允许写有原始报文可回查的数字**。2026-10-15 曾有一批"实测计数"
 * （行数在 3766/3864/5450/5574 之间跳、`ys` 返回 309 行、业务码 100605、页码回显谎报）事后逐条回查
 * **在任何一次真报文里都不存在**，是我把不同接口的读数串成了因果；据此撤掉的两颗能力已于当晚复验注册回来。
 * 教训写进 `docs/design/ftshare-source-survey.md` §7.5–§7.7：**没打进日志的数字不算实测**。
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
/** 日度资金流族：实测 `page_size=1000` 可用（5214 行分 6 次取完）。 */
const MAX_PAGE_SIZE = 1000;
/**
 * ⛔ 上游有两处把 `page_size` 压在 500：日 K 快照是**响亮拒绝**（实测 501 → HTTP 400
 * `page_size must be between 1 and 500`），主力五档是**静默截断**（实测 1000/2000 都只回 500 行）。
 * 两种都不许本层放宽——静默那一半尤其只能靠参数层先拦住，否则模型以为拿到了整页。
 * 2026-10-16 补：大宗交易（传 1000/2000 回显 500）与龙虎榜明细（同形）也走这一档；
 * 业绩预告 / 快报则是 501 → 响亮 400「page_size 不能超过 500」。**同一档里两种形状都有**。
 */
const MAX_PAGE_SIZE_500 = 500;
/**
 * ⛔ 申万行业日度指标那一处更低：实测 `page_size=1000` 回显 `pageSize=200` 且只回 200 行
 * （201 也一样被截成 200），同样是**静默**截断。
 * 批次 F 复用这一档：南华指数日 K 实测 201 → **响亮** 400「page_size must be between 1 and 200」，
 * 同一条上限两种失败形状都有。
 */
const MAX_PAGE_SIZE_200 = 200;
/** 指数权重那一族：实测 101 → 回显 `page_size=100` 并只回 100 行（**静默**夹断，文档这条难得与实测一致）。 */
const MAX_PAGE_SIZE_100 = 100;
/**
 * ⛔ 期货那一族的 `page_size` 有四种命运，2026-10-16 逐颗真报文打出：
 * 仓单 / 周报 / 结算参数传 5000 → **静默**夹到 4000（回显 `pageSize: 4000`）；
 * 东财持仓传 5000 → **响亮** 400「page_size must be between 1 and 500」；
 * 贵金属传 1001 → 静默夹到 1000；涨跌停价压到 **50**——实测 SHFE 50 可过、60 起整页 400
 * 「missing pre-settlement price」（缺前结算价的是上游自己的某些合约，不是我们的参数）。
 */
const MAX_PAGE_SIZE_4000 = 4000;
const MAX_PAGE_SIZE_50 = 50;
/**
 * 期货合约代码的**多套后缀**（实测 2026-10-16）：清单与基础数据给 `.SHF` / `.CFE` / `.CZC` / `.GFE`，
 * 而涨跌停价与结算参数把同一家写成 `.CFX`（中金所 `IC2610.CFX`）与 `.ZCE`（郑商所 `AP610.ZCE`）——
 * 同一批合约三种拼法；K 线只认 CTP **全称**后缀，短后缀 400 点名「unsupported suffix 'SHF'」。
 * 所以映射表必须建在我们这一侧：模型从任何一颗拿到的代码都要能直接打到 K 线上。
 * ⛔ `.IB`（银行间债券远期，清单里确有 64 只 `ADBC10_2612.IB`）换成长后缀也没有行情端——
 * 实测 `.NIB` → 400，这一族上游不卖银行间行情，所以这里响亮拒绝而不是"试一下"。
 */
const FUTURES_SUFFIX = { SHF: 'SHFE', CFE: 'CFFEX', CFX: 'CFFEX', CZC: 'CZCE', ZCE: 'CZCE', GFE: 'GFEX' };
const FUTURES_LONG_SUFFIX = new Set(['SHFE', 'INE', 'DCE', 'CZCE', 'CFFEX', 'GFEX']);
/** 涨跌停价与结算参数这两颗的 `exchange` 是必填项（实测缺失 400「缺少必填参数：交易所」）。 */
const FUTURES_EXCHANGES = ['SHFE', 'INE', 'CZCE', 'CFFEX', 'DCE', 'GFEX'];
/** 仓单日报只覆盖商品所（实测 INE / DCE / CZCE / SHFE / GFEX 五家都有行，中金所不发仓单）。 */
const WARRANT_EXCHANGES = ['SHFE', 'INE', 'CZCE', 'DCE', 'GFEX'];
/**
 * ⛔ 东财持仓那一族的 `exchange` 与全仓其他地方**不是同一套写法**：实测 `GFEX` / `gfex` 都只回
 * 0 行、不报错，真名是 `gfe`；而且整族大小写敏感（`AG` 0 行、`ag` 有数）。
 * 本层把六家常规写法换成上游那一套小写，模型不需要知道 `gfe` 这个坑。
 */
const EASTMONEY_FUTURES_EXCHANGE = { SHFE: 'shfe', DCE: 'dce', CZCE: 'czce', CFFEX: 'cffex', INE: 'ine', GFEX: 'gfe', GFE: 'gfe' };
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
/**
 * 分页参数。`page` 实测**生效**（2026-10-15 17:05 之后：报价族六页 × 1000 去重恰为 `total_items` 5574，
 * 日 K 第十二页只剩 63 行，日度族 page=1/2/3 的首行分别是 000001 / 000007 / 000010）。
 * 页码与页数一律**按请求自己算**、不读信封里的 `pageNum`/`pages`：实测回显与请求一致（page=1/2/3 逐页对齐），
 * 但那是上游的状态；本层只从信封取 `total`，回显漂了也不会把错的页码写进 Dataset。
 */
function pageParams(params, allowed, maxSize) {
    for (const key of Object.keys(params))
        if (!allowed.includes(key))
            throw new FtshareError('invalid_parameter', `unsupported parameter: ${key}`);
    const page = params.page === undefined ? 1 : Number(params.page);
    const size = params.size === undefined ? Math.min(100, maxSize) : Number(params.size);
    if (!Number.isSafeInteger(page) || page < 1)
        throw new FtshareError('invalid_parameter', 'parameter page must be an integer >= 1');
    if (!Number.isSafeInteger(size) || size < 1 || size > maxSize)
        throw new FtshareError('invalid_parameter', `parameter size must be an integer from 1 to ${maxSize}`);
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
/**
 * 行数组与总数。上游四套信封（实测），只认一套就会把另一套静默读成空集：
 * - 资金流与日 K 族：`data.records` + `pageNum/pageSize/pages/total`
 * - daec 报价族、涨跌停价、股东人数：`data.items` + `total_items/total_pages`（**不回显页码**）
 * - 指数权重：`data.index_weights` + `total/page/page_size`（没有 pages）
 * - 昨收价与可转债 K 线：`data` **直接是数组**，那时分页完全由本层合成
 * ⛔ `data` 还可能是 **`null`**：实测龙虎榜明细在"非交易日 / 未来日期 / 早于窗口"三种情况下都回
 * `{"code":200,"message":"success","data":null}`——那是**合法空结果**而不是坏信封，
 * 读成失败就等于让模型对着一个日历事实反复换参数重试。
 * 只取 `total`（三个名字都要读，实测与逐日全市场计数对得上）；页码不从信封取，见 `pageParams` 的 ⛔。
 */
function readPaged(envelope) {
    const data = envelope.data;
    if (data === null)
        return { rows: [], total: 0 };
    if (Array.isArray(data))
        return { rows: data.filter(isRecord), total: data.length };
    if (!isRecord(data))
        throw new FtshareError('invalid_response', 'FTShare envelope is missing data');
    const raw = Array.isArray(data.records) ? data.records
        : Array.isArray(data.items) ? data.items
            : Array.isArray(data.index_weights) ? data.index_weights
                : null;
    if (raw === null)
        throw new FtshareError('invalid_response', `FTShare envelope has no records/items/index_weights array (data keys: ${Object.keys(data).join(',') || 'none'})`);
    const rows = raw.filter(isRecord);
    return { rows, total: integerOrNull(data.total) ?? integerOrNull(data.total_items) ?? rows.length };
}
/** 分页信封：`page`/`pages` 按请求算，`total` 用上游的。 */
function pagedEnvelope(item, total, page, size) {
    return { item, pagination: { page, size: item.length, pages: Math.max(1, Math.ceil(total / size)), total } };
}
/**
 * 没有分页信封的响应（市场快照 / 一次取满的那几颗）：一行就是全部。
 * ⛔ `total` 允许另给：期货 K 线那种"limit 只回最新若干根、但上游 total 报的是区间内根数"的响应，
 * 把 total 写成 item.length 等于替上游抹掉截断（批次 E 的"截断要看得见"同一条）。
 */
function snapshotEnvelope(item, total = item.length) {
    return { item, pagination: { page: 1, size: item.length, pages: 1, total } };
}
/**
 * 日期区间有没有被应用，只能在返回之后核：昨收价那一族的响应里**没有身份列**（只有 `date` 与数值），
 * 本层能核的最强事实就是"回来的行是否都落在请求的区间内"。实测上游遵守区间（2022-01-01..2026-10-15 回的行
 * 起于 2022-04-19、止于 2026-10-15），所以这一声是**防改版**：区间语义哪天变了，宁可失败也不落一份错日期的盘。
 */
function assertInRange(rows, start, end, pick) {
    if (rows.length === 0)
        return;
    const wrong = rows.find((row) => {
        const { iso } = normalizeDateCell(pick(row));
        return iso !== null && (iso < start || iso > end);
    });
    if (wrong !== undefined) {
        const { iso } = normalizeDateCell(pick(wrong));
        throw new FtshareError('invalid_response', `FTShare returned trade_date ${iso} outside the requested ${start}..${end} window — 上游没有应用日期区间，这一份不是该区间的结果`);
    }
}
/**
 * ⛔ 过滤有没有真的生效，只能在**返回之后**验。实测上游是遵守的（`code=600519` 五个交易日回 5 行、
 * `board_name=银行` 回 1 行），但它的失败形状是静默的：不认识的**写法**不回错、只回 0 行（实测
 * `symbol = "600519.XSHG"` 回 0 行），不认识的**列**才点名拒。所以核身份放在 producer：
 * 过滤语义一旦漂了，拿一句 `invalid_response` 换掉"把全市场样本当成一只票的序列"。
 */
function assertFiltered(rows, filter) {
    if (filter === undefined || rows.length === 0)
        return;
    const wrong = rows.find((row) => String(row[filter.field] ?? '') !== filter.expected);
    if (wrong !== undefined) {
        throw new FtshareError('invalid_response', `FTShare dropped the ${filter.label} filter: got ${filter.field}=${JSON.stringify(String(wrong[filter.field] ?? ''))} instead of ${JSON.stringify(filter.expected)} — 这份返回是整个市场的截断样本，不是该条件下的结果`);
    }
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
/** 不分页的那几颗也要挡陌生键名（`pageParams` 顺手做了这件事，这里给它们同一句话）。 */
function assertKnown(params, allowed) {
    for (const key of Object.keys(params))
        if (!allowed.includes(key))
            throw new FtshareError('invalid_parameter', `unsupported parameter: ${key}`);
}
/** 期货代码形状：`品种[数字]`，可带两到五个字母的交易所后缀。上游对不认识的写法是**静默空**，所以先在参数层核。 */
const FUTURES_CODE_PATTERN = /^[A-Z][A-Z0-9_]*\d{3,4}(?:\.[A-Z]{2,5})?$/;
/**
 * 合约代码归一：转大写、把短后缀换成 K 线要的 CTP 全称后缀。
 * ⛔ 裸码（`A2611`）原样放行——实测上游确实认（219 行日 K），但它**没有交易所身份**，
 * 本层不替它猜（同一串裸码在别家上游可能另有其合约）。
 */
function futuresSymbol(value, name = 'symbol') {
    const raw = typeof value === 'string' || typeof value === 'number' ? String(value).trim().toUpperCase() : '';
    if (!FUTURES_CODE_PATTERN.test(raw))
        throw new FtshareError('invalid_parameter', `parameter ${name} 要的是期货合约代码（如 AG2610.SHF / CU2612.SHFE / A2611），拿到 ${JSON.stringify(String(value ?? ''))}`);
    const [base, suffix] = raw.split('.');
    if (suffix === undefined)
        return base;
    if (suffix === 'IB')
        throw new FtshareError('invalid_parameter', `parameter ${name} ${raw} 是银行间品种：那一族在清单里有行，但本上游没有银行间行情端（实测换成 .NIB 打 K 线 → 400 unsupported suffix 'NIB'）`);
    const long = FUTURES_SUFFIX[suffix] ?? (FUTURES_LONG_SUFFIX.has(suffix) ? suffix : undefined);
    if (long === undefined)
        throw new FtshareError('invalid_parameter', `parameter ${name} ${raw} 的后缀 ${suffix} 认不出：交易所后缀用 SHF/SHFE、CFE/CFX/CFFEX、CZC/ZCE/CZCE、GFE/GFEX、DCE、INE 这几家写法（清单与结算那几颗给的后缀长短不一，本层会换）`);
    return `${base}.${long}`;
}
/** 涨跌停价与结算参数的 `ts_code`：实测短后缀与全称后缀**都能命中**（返回行一律写短后缀），所以只做形状与写法核。 */
function futuresTsCode(value, name = 'ts_code') {
    const raw = typeof value === 'string' || typeof value === 'number' ? String(value).trim().toUpperCase() : '';
    if (!FUTURES_CODE_PATTERN.test(raw) || !raw.includes('.'))
        throw new FtshareError('invalid_parameter', `parameter ${name} 要的是带交易所后缀的期货合约代码（实测 AG2610.SHF 与 AG2610.SHFE 都命中，返回行写的是短后缀），拿到 ${JSON.stringify(String(value ?? ''))}`);
    const suffix = raw.split('.')[1];
    if (FUTURES_SUFFIX[suffix] === undefined && !FUTURES_LONG_SUFFIX.has(suffix))
        throw new FtshareError('invalid_parameter', `parameter ${name} ${raw} 的交易所后缀认不出（SHF/SHFE、CFE/CFX/CFFEX、CZC/ZCE/CZCE、GFE/GFEX、DCE、INE 之一）`);
    return raw;
}
function futuresExchange(value, allowed, name = 'exchange') {
    const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!allowed.includes(raw))
        throw new FtshareError('invalid_parameter', `parameter ${name} must be one of ${allowed.join(' / ')}`);
    return raw;
}
/** 周报的统计周期：上游只认 `YYYYWW`（实测 `2026-10-16` → 400「start_week must use YYYYWW format」）。 */
function weekCode(value, name) {
    const raw = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    if (!/^\d{6}$/.test(raw) || Number(raw.slice(4)) < 1 || Number(raw.slice(4)) > 53)
        throw new FtshareError('invalid_parameter', `parameter ${name} 要的是 YYYYWW 六位周码（如 202639），拿到 ${JSON.stringify(String(value ?? ''))}（实测别的写法上游 400「${name} must use YYYYWW format」）`);
    return raw;
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
const DAILY_FLOW_DESCRIPTION = '按交易日区间获取**同花顺**日度资金流。⛔ 金额与成交额单位是**亿元**，这条不是猜的：同一交易日（2026-10-14）逐票与全市场日 K 截面对上——5214 只**全部匹配**，本能力 `turnover_amount_yi` 合计 14142.07 亿 vs 日 K 面 `turnover_yuan` 合计折算 14142.02 亿（比值 0.999996），单票最大相对偏差 0.487%（两位小数舍入的量级）。`net_amount_yi = inflow_yi − outflow_yi`：实测单日 5214 行里 338 行有偏差、**最大偏差恰为 0.01 亿**，全部来自舍入、不是口径分歧。`change_pct` 与 `turnover_pct` 是**百分数原值**（0.87 表示 0.87%）——⛔ 报价面的 `turnover_ratio` 是**比例值**（0.00499 = 0.499%），两者不是一套口径，禁止混用或互相换算。⛔ `code` 是上游给的**裸 6 位代码且不带市场后缀**，我们不替它猜交易所（`000001` 在指数的语境里另有其票），需要带后缀的身份请用行情类能力或 `ticker_search`。实测单日 **5214 行、不含北交所**（`920992` 返回 0 条，末页仍是 0028xx 深市主板；与日 K 那 5563 行相差的 349 只正是北证），北交所资金流本仓仍无覆盖（北证行情请用 `ftshare_ashare_quote` / `ftshare_daily_kline_snapshot`，那一族含 349 只 BJ）。⛔ `pagination.total` 是**区间内的行数，不是票数**：一个交易日 5214 行，实测三个交易日 15637 行，翻页要取满 `ceil(total ÷ size)` 页。分页实测生效（`page` = 1 / 2 / 3 的首行分别是 000001 / 000007 / 000010），`size` 最大 1000。`code` 与 `board_name` 过滤实测生效（单票五个交易日回 5 行、`board_name=银行` 回 1 行）。⛔ **历史窗口只有最近约 45 个交易日**：按真实交易日二分，T-45 仍有 5199 行、**T-50 起 total=0**；早于窗口的日期是合法空结果、不是取数失败，不要换日期循环重试。';
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
        const { page, size } = pageParams(params, options.allowed, MAX_PAGE_SIZE);
        const start_date = date(params.start_date, 'start_date');
        const end_date = date(params.end_date, 'end_date');
        if (start_date > end_date)
            throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date');
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
            const { rows, total } = readPaged(await options.client.getJson(options.path, search, signal));
            // 带过滤的请求先核身份，再核日期区间（两道都是防改版，见 assertFiltered / assertInRange）。
            assertFiltered(rows, params.code === undefined
                ? (params.board_name === undefined ? undefined : { field: 'board_name', expected: String(params.board_name), label: 'board_name' })
                : { field: 'code', expected: String(params.code), label: 'code' });
            // 第二道：没带过滤时身份核对不会跑，但"整段日期区间被忽略"仍然只能靠返回核。
            assertInRange(rows, String(params.start_date), String(params.end_date), (row) => row.trade_date);
            return { data: pagedEnvelope(rows.map(options.mapRow), total, Number(params.page), Number(params.size)), schema: output(options.row) };
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
/**
 * 报价与快照族（daec）的两条硬约束，都是实测：
 * 1. **筛选表达式不开放给模型**。实测支持的列只有 `symkey / symbol_id / market_id / name` 与价量列，
 *    其余列（`st` / `status` / `listing_date` / `market_cap` / `pe_ttm` / `shares`）会被点名拒
 *    「不支持的过滤器字段：st；支持的…」；身份还有两套写法（`symkey` 带后缀、`symbol_id` 裸 6 位），
 *    写错不报错只回 0 行。本层只用**已验过回 1 行**的 `symbol_id = "<裸 6 位>"`，模型只看 `code` 参数。
 * 2. `board` 是 **URL 路径段**，只允许 `all / xshg / xshe / bjse` 四个常量：实测越界一律 HTTP 400
 *    「unsupported stock board ys; expected xshg/xshe/bjse/all」。任何写法都不把模型给的字符串拼进路径。
 */
const QUOTE_BOARDS = ['all', 'xshg', 'xshe', 'bjse'];
const SNAPSHOT_SCOPES = ['ChinaStock', 'Xshg', 'Xshe', 'Bjse'];
/** 排序白名单：五档打过真报文（17:05 之后逐次一致）；`market_cap` / `pe_ttm` / `shares` 实测被上游拒「unsupported order_by field」。 */
const QUOTE_SORT = { change_ratio: 'change_rate', turnover_yuan: 'turnover', volume_shares: 'volume', close: 'close', prev_close: 'prev_close' };
const quoteRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, ticker: { type: 'string' }, name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        board: { type: 'string' }, status: { type: 'string' }, st: { type: 'boolean' }, listing_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        close: { oneOf: [{ type: 'number' }, { type: 'null' }] }, open: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        high: { oneOf: [{ type: 'number' }, { type: 'null' }] }, low: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        prev_close: { oneOf: [{ type: 'number' }, { type: 'null' }] }, change_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        avg_price: { oneOf: [{ type: 'number' }, { type: 'null' }] }, pe_ttm: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        change_ratio: { oneOf: [{ type: 'number' }, { type: 'null' }] }, change_ratio_day5: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        change_ratio_day10: { oneOf: [{ type: 'number' }, { type: 'null' }] }, change_ratio_day20: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        change_ratio_day60: { oneOf: [{ type: 'number' }, { type: 'null' }] }, change_ratio_day120: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        change_ratio_ytd: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        amplitude_ratio: { oneOf: [{ type: 'number' }, { type: 'null' }] }, turnover_ratio: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        volume_shares: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, turnover_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        shares: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, float_a_shares: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        market_cap_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] }, tradable_a_market_cap_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        bid_ask_ratio_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] }, quote_time_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
function mapQuoteRow(row) {
    const symbol = String(row.symbol ?? '');
    return {
        thscode: symbol, ticker: textOrNull(row.symbol_id) ?? symbol.slice(0, 6), name: textOrNull(row.name),
        board: String(row.board ?? ''), status: String(row.status ?? ''), st: row.st === true, listing_date: textOrNull(row.listing_date),
        close: numberOrNull(row.close), open: numberOrNull(row.open), high: numberOrNull(row.high), low: numberOrNull(row.low),
        prev_close: numberOrNull(row.prev_close), change_yuan: numberOrNull(row.change), avg_price: numberOrNull(row.avg), pe_ttm: numberOrNull(row.pe_ttm),
        change_ratio: numberOrNull(row.change_rate), change_ratio_day5: numberOrNull(row.change_rate_day5), change_ratio_day10: numberOrNull(row.change_rate_day10),
        change_ratio_day20: numberOrNull(row.change_rate_day20), change_ratio_day60: numberOrNull(row.change_rate_day60),
        change_ratio_day120: numberOrNull(row.change_rate_day120), change_ratio_ytd: numberOrNull(row.change_rate_ytd),
        amplitude_ratio: numberOrNull(row.amplitude), turnover_ratio: numberOrNull(row.turnover_rate),
        volume_shares: integerOrNull(row.volume), turnover_yuan: numberOrNull(row.turnover),
        shares: integerOrNull(row.shares), float_a_shares: integerOrNull(row.float_a_shares),
        market_cap_yuan: numberOrNull(row.market_cap), tradable_a_market_cap_yuan: numberOrNull(row.tradable_a_market_cap),
        bid_ask_ratio_raw: numberOrNull(row.bid_ask_ratio), quote_time_ms: integerOrNull(row.ts_millis),
    };
}
function boardOf(value) {
    const board = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!QUOTE_BOARDS.includes(board)) {
        throw new FtshareError('invalid_parameter', `parameter board must be one of ${QUOTE_BOARDS.join(' / ')}`);
    }
    return board;
}
function createQuoteSource(client) {
    const capability = 'ftshare_ashare_quote';
    const allowed = ['board', 'code', 'sort_field', 'sort_order', 'page', 'size'];
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_daec_stocks',
        source: 'http:ftshare.stock_daec_stocks',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        cacheMaxAgeMs: 60_000,
        rowShape: { rowKey: 'item' },
        summary: 'A 股实时行情截面（沪深北全市场，含 ST 与停牌）',
        description: '按板块分页获取 A 股**实时行情 + 基本面**截面（查询时点快照，无历史维度；行情时间看 `quote_time_ms`，采集时间看 Dataset 的 `captured_at`）。覆盖面实测：`all` 5574 只 = `xshg` 2320 + `xshe` 2905 + `bjse` 349（六页取回后按 `symbol` 去重恰为 5574，末页 574 行）；同一时刻 `ftshare_market_breadth` 的九档家数之和也恰是 5574。⛔ **这一族含北交所**（实测 349 只，代码形如 `920000.BJ`，`board=bjse` 单取）——本仓腾讯那一路明确拒 BJ，所以这是北交所报价真正的第二条路。`status` 实测只有 `Normal`(5563) 与 `Suspended`(11) 两值，`st` 是布尔（实测 202 只为 true），停牌票的 `open/high/low` 为 null（**别补 0**）。`thscode` 沿用上游给的短后缀（`600519.SH`），与本仓内部写法逐字相同。⛔ **涨跌幅是比例值不是百分数**：`change_ratio` 0.03 表示 3%（实测排序首行 300111.SZ = 0.20064724919093851，恰是创业板 20% 涨停），`amplitude_ratio` / `turnover_ratio` / 各 `change_ratio_day*` 同理；这与同花顺那族日度资金流的百分数原值（`change_pct` 0.87 = 0.87%）**不是一套口径，禁止混用或互相换算**。上游用**字符串**给出价与额（单位元）与部分列的整数股数（单位股），本层已转成数值。七条派生关系按 200 行真报文核对过（偏差 1e-15 量级，即它们不是独立披露的量）：`avg_price = turnover_yuan ÷ volume_shares`、`change_yuan = close − prev_close`、`change_ratio = change_yuan ÷ prev_close`、`market_cap_yuan = shares × close`、`tradable_a_market_cap_yuan = float_a_shares × close`、`turnover_ratio = volume_shares ÷ float_a_shares`、`amplitude_ratio = (high − low) ÷ prev_close`。⛔ `bid_ask_ratio_raw` 口径**未核验**（实测取值有正有负、含 0，不像比值），只能做同列相对比较，禁止换算成百分数写进结论。`pe_ttm` 实测 200 行里 75 行为 null（亏损股无 PE）。`name` 里有上游原文的全角空格与字母（实测「万  科Ａ」），原文保留。分页实测生效，要全市场就翻满 `ceil(total ÷ size)` 页（`size` ≤ 1000）。`code` 由本层拼成上游的 `symbol_id = "<裸 6 位>"` 精确过滤，实测稳定回 1 行。⛔ 这一族的过滤语法**只对认识的列有效**：不认识的列会**点名拒绝**（实测 `st` 回「不支持的过滤器字段：st；支持的…」，支持的只有 `symkey / symbol_id / market_id / name` 与价量列），而**写法不对的身份条件不报错、只回 0 行**（实测 `symbol = "600519.XSHG"` 回 0 行——`symbol` 要带后缀、`symbol_id` 才是裸码），所以本层只发已验的写法。同样**不支持**按 `board` / `status` / `st` / `market_cap` / `pe_ttm` / `shares` / `listing_date` 筛选，这些只能取回后自己筛；`sort_field` 只放验过的五档（涨跌幅、成交额、量、价、昨收），实测 `market_cap` 被拒「unsupported order_by field market_cap」。本层对带 `code` 的请求逐行核对返回身份——**防改版**：过滤语义哪天变了，宁可报 `invalid_response`，也不交一份「看着像但是一只都不对」的数据。',
        input_schema: {
            type: 'object',
            properties: {
                board: { type: 'string', enum: [...QUOTE_BOARDS], description: '板块路径：all 全市场（默认）/ xshg 上证 / xshe 深证 / bjse 北证' },
                code: { type: 'string', description: '单只精确过滤，6 位代码或带后缀均可（600519 / 600519.SH）' },
                sort_field: { type: 'string', enum: Object.keys(QUOTE_SORT), description: '排序列，默认不排序（上游按代码序返回）' },
                sort_order: { type: 'string', enum: ['asc', 'desc'], description: '排序方向，配合 sort_field 使用，默认 desc' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
            },
            required: [], additionalProperties: false,
        },
        output_schema: output(quoteRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE);
        const normalized = { board: params.board === undefined ? 'all' : boardOf(params.board), page, size };
        if (params.code !== undefined)
            normalized.code = parseSecurityCode(params.code, 'code').digits;
        if (params.sort_field !== undefined) {
            const field = String(params.sort_field);
            if (!Object.keys(QUOTE_SORT).includes(field))
                throw new FtshareError('invalid_parameter', `parameter sort_field must be one of ${Object.keys(QUOTE_SORT).join(' / ')}`);
            const order = params.sort_order === undefined ? 'desc' : String(params.sort_order);
            if (order !== 'asc' && order !== 'desc')
                throw new FtshareError('invalid_parameter', 'parameter sort_order must be asc or desc');
            normalized.order_by = `${QUOTE_SORT[field]} ${order}`;
        }
        else if (params.sort_order !== undefined) {
            throw new FtshareError('invalid_parameter', 'parameter sort_order requires sort_field');
        }
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            // ⛔ filter 串只由本层用校验过的 6 位数字拼出来，绝不把模型给的表达式透传出去。
            const filter = params.code === undefined ? undefined : `symbol_id = "${params.code}"`;
            const search = query({ filter, order_by: params.order_by, page: params.page, page_size: params.size }, ['filter', 'order_by', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson(`/api/v1/market/data/daec/stocks/${params.board}`, search, signal));
            assertFiltered(rows, params.code === undefined ? undefined : { field: 'symbol_id', expected: String(params.code), label: 'code' });
            return { data: pagedEnvelope(rows.map(mapQuoteRow), total, Number(params.page), Number(params.size)), schema: output(quoteRow) };
        },
    };
}
const breadthRow = {
    type: 'object',
    properties: {
        scope: { type: 'string' }, market_status: { type: 'string' },
        volume_shares: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, turnover_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        up_limited: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, up_5pct_to_limited: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        up_1pct_to_5pct: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, up_0pct_to_1pct: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        flat: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, down_0pct_to_1pct: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        down_1pct_to_5pct: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, down_5pct_to_limited: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        down_limited: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    },
    required: ['scope', 'market_status'], additionalProperties: false,
};
/**
 * 全市场快照（`/daec/market/snapshot`）。这一颗自带两道对账，2026-10-15 连打 8 次逐分一致：九档家数之和 =
 * 报价面的标的总数（5574），且三个交易所 scope 在家数、成交额、成交量三种量上都能加出全市场那一档。
 * 取回先核这两道加法——对不上就是上游改版（`turnover` 与家数分属不同列族，谁都可能先漂）。
 */
function createBreadthSource(client) {
    const capability = 'ftshare_market_breadth';
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_daec_market_snapshot',
        source: 'http:ftshare.stock_market',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: false,
        cacheMaxAgeMs: 60_000,
        rowShape: { rowKey: 'item' },
        summary: '全市场成交额与涨跌分布（九档家数）',
        description: '获取全市场或单个交易所的**查询时点**快照，一行：市场状态、成交量与成交额，外加按涨跌幅分档统计的涨跌家数（实测固定九档：`up_limited` / `up_5pct_to_limited` / `up_1pct_to_5pct` / `up_0pct_to_1pct` / `flat` / `down_0pct_to_1pct` / `down_1pct_to_5pct` / `down_5pct_to_limited` / `down_limited`）。scope 四档：`ChinaStock` 全市场（默认）/ `Xshg` 沪 / `Xshe` 深 / `Bjse` 北。这一条自带**两道可对账的加法**，2026-10-15 实测逐分成立（同一请求连打 8 次全部一致）：① 九档家数之和 = 报价面 `ftshare_ashare_quote` 的标的总数（ChinaStock 5574 = `total_items` 5574）；② 三个交易所相加 = 全市场——家数 2320 + 2905 + 349 = 5574，成交额 774,120,203,047.43 + 855,563,768,593.29 + 12,571,061,567 = 1,642,255,033,207.72 元，成交量 50,978,246,468 + 55,014,763,067 + 674,816,640 = 106,667,826,175 股。⛔ 用这一条算涨跌比、成交额或环比之前**先核这两道加法**：对不上说明上游改版，或者两份数据不是同一时刻取的，不要直接引数字。`scope` 列是**本层写入的请求标签**（上游响应里没有这一列），不是上游披露的市场名。⛔ **上游两个恒零占位列本能力不收录**：`prev_turnover` 实测三个 scope 都返回字符串 "0"（全市场昨日成交额不可能是 0），顶层 `change_rate` 恒为 `0`——那是占位不是数据，收进目录等于替上游说一句它自己没说的话。`market_status` 只实测到 `closed`（北京收盘后），盘中取值未验证，所以本能力**不承诺实时**：它是「此刻这一份快照」，新鲜度看 Dataset 的 `captured_at`。',
        input_schema: {
            type: 'object',
            properties: { scope: { type: 'string', enum: [...SNAPSHOT_SCOPES], description: '市场范围，默认 ChinaStock 全市场' } },
            required: [], additionalProperties: false,
        },
        output_schema: output(breadthRow),
    };
    const normalize = (params) => {
        for (const key of Object.keys(params))
            if (key !== 'scope')
                throw new FtshareError('invalid_parameter', `unsupported parameter: ${key}`);
        if (params.scope === undefined)
            return {};
        const scope = String(params.scope);
        if (!SNAPSHOT_SCOPES.includes(scope))
            throw new FtshareError('invalid_parameter', `parameter scope must be one of ${SNAPSHOT_SCOPES.join(' / ')}`);
        return { scope };
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const envelope = await client.getJson('/api/v1/market/data/daec/market/snapshot', query({ scope: params.scope }, ['scope']), signal);
            const data = isRecord(envelope.data) ? envelope.data : null;
            if (data === null)
                throw new FtshareError('invalid_response', 'FTShare market snapshot returned no data object');
            const distribution = isRecord(data.distribution) ? data.distribution : null;
            if (distribution === null)
                throw new FtshareError('invalid_response', `FTShare market snapshot has no distribution object (data keys: ${Object.keys(data).join(',') || 'none'})`);
            const item = [{
                    scope: String(params.scope ?? 'ChinaStock'), market_status: String(data.status ?? 'unknown'),
                    volume_shares: integerOrNull(data.volume), turnover_yuan: numberOrNull(data.turnover),
                    up_limited: integerOrNull(distribution.up_limited), up_5pct_to_limited: integerOrNull(distribution.up_5pct_to_limited),
                    up_1pct_to_5pct: integerOrNull(distribution.up_1pct_to_5pct), up_0pct_to_1pct: integerOrNull(distribution.up_0pct_to_1pct),
                    flat: integerOrNull(distribution.flat), down_0pct_to_1pct: integerOrNull(distribution.down_0pct_to_1pct),
                    down_1pct_to_5pct: integerOrNull(distribution.down_1pct_to_5pct), down_5pct_to_limited: integerOrNull(distribution.down_5pct_to_limited),
                    down_limited: integerOrNull(distribution.down_limited),
                }];
            return { data: snapshotEnvelope(item), schema: output(breadthRow) };
        },
    };
}
const klineSnapshotRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, ticker: { type: 'string' }, trade_date: { type: 'string' }, trade_date_ms: { type: 'integer' },
        open: { oneOf: [{ type: 'number' }, { type: 'null' }] }, high: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        low: { oneOf: [{ type: 'number' }, { type: 'null' }] }, close: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        volume_shares: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, turnover_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        turnover_ratio: { oneOf: [{ type: 'number' }, { type: 'null' }] }, session_open_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        close_time_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
/**
 * 全市场某交易日日 K 截面（`/stock-candlesticks-daily`）。它与 `ftshare_ashare_quote` 是**两个时刻**：
 * 这一条是"某一天收工后的每只票"，可翻页取完（实测十二页 × 500 = 5563 行，末页只剩 63 行）；
 * 报价那条是"此刻"。两者行数差恰好等于当日停牌家数（实测 5574 − 11 = 5563），
 * 这是本仓少见的能自我对账的地方，写进描述里让模型也拿它当校验点。
 */
function createKlineSnapshotSource(client) {
    const capability = 'ftshare_daily_kline_snapshot';
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_stock_candlesticks_daily',
        source: 'http:ftshare.stock_candlesticks_daily',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '全市场某交易日日 K 截面（含北交所）',
        description: '按**单个交易日**获取全市场普通 A 股的日 K 截面，一行一票。⛔ 必须是**普通股票**：实测不含 ETF、可转债与指数——要指数日线请用 `index_history` / `tencent_kline`，要 ETF 请用 `fund_history`，要可转债历史 K 线请用 `ftshare_convertible_bond_kline`。`trade_date` 必填，格式 YYYY-MM-DD；**非交易日会在参数层响亮失败**（实测上游 400「trade_date 不是交易日」，如 20261011），未来交易日返回 `total=0`（合法空，不是失败）。当日截面**收盘后就能取**：实测 2026-10-15 15:51（北京）打 `trade_date=20261015` 已回 5565 行。历史深度很好（实测 2020-01-06 有 3762 行、2016-06-27 有 2864 行、2015-01-05 有 2589 行），这一条**不受**资金流那族「只留约 45 个交易日」的限制。⛔ **截面不含当日停牌票**：实测 2026-10-14 全市场 5563 行 = 报价面 `ftshare_ashare_quote` 的 5574 减去当日 `status = Suspended` 的 11 只——所以「少了几只」是停牌事实，不要当成丢行。含北交所（这 5563 行里有 `920xxx.BJ`）。列口径：`open/high/low/close` 元（上游用字符串给出，如 "11.5000"，本层转成数值）、`volume_shares` 股、`turnover_yuan` 元（同样是字符串）、`turnover_ratio` 是**比例值不是百分数**（实测 000001.SZ 为 0.004993804240610122，即 0.499%）——⛔ 与同花顺日度资金流那族的 `turnover_pct`（百分数原值）不是一套口径；`close_time_ms` 与 `session_open_ms` 是上游给的时刻轴（实测 = 该交易日北京 15:00 与 09:30），`trade_date` / `trade_date_ms` 是本层按 `ts_millis` 补的日轴（上海时区零点），做时间序列请用后者；本层会核对补出来的日轴与请求的 `trade_date` 是否同一天，不一致报 `invalid_response`（防止拿到别的日期的数据却按请求日期落库）。`thscode` 沿用上游短后缀。分页：`page` 实测生效，`size` 由上游限死 **1～500**（实测 501 → HTTP 400「page_size must be between 1 and 500」），全市场 5563 行需 12 页（实测末页只剩 63 行）。',
        input_schema: {
            type: 'object',
            properties: {
                trade_date: { type: 'string', description: '交易日 YYYY-MM-DD；必须真的是交易日' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE_500 },
            },
            required: ['trade_date'], additionalProperties: false,
        },
        output_schema: output(klineSnapshotRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, ['trade_date', 'page', 'size'], MAX_PAGE_SIZE_500);
        return { trade_date: date(params.trade_date, 'trade_date'), page, size };
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({ trade_date: compactDate(String(params.trade_date)), page: params.page, page_size: params.size }, ['trade_date', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson('/api/v1/market/data/stock-candlesticks-daily', search, signal));
            const item = rows.map((row) => {
                const symbol = String(row.trade_code ?? '');
                const closeMs = numberOrNull(row.ts_millis);
                const iso = closeMs === null ? null : new Date(closeMs + 8 * 3600_000).toISOString().slice(0, 10);
                return {
                    thscode: symbol, ticker: symbol.slice(0, 6),
                    trade_date: iso ?? '', trade_date_ms: iso === null ? null : dateMs(iso),
                    open: numberOrNull(row.open), high: numberOrNull(row.high), low: numberOrNull(row.low), close: numberOrNull(row.close),
                    volume_shares: integerOrNull(row.volume), turnover_yuan: numberOrNull(row.turnover), turnover_ratio: numberOrNull(row.turnover_rate),
                    session_open_ms: numberOrNull(row.ts_millis_open), close_time_ms: closeMs,
                };
            }).filter((row) => row.trade_date_ms !== null);
            // ⛔ 请求的日期与返回的日期必须同一天：这一条没有身份列以外的核对点，日轴对不上就只能失败。
            assertInRange(item, String(params.trade_date), String(params.trade_date), (row) => row.trade_date);
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(klineSnapshotRow) };
        },
    };
}
const prevCloseRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, trade_date: { type: 'string' }, trade_date_ms: { type: 'integer' },
        prev_close: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
function createPrevCloseSource(client) {
    const capability = 'ftshare_prev_close';
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_stock_prev_close',
        source: 'http:ftshare.stock_prev_close',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: false,
        rowShape: { rowKey: 'item' },
        summary: '单只标的逐日昨收价序列（校验复权与涨跌停）',
        description: '按单只标的与日期区间获取**每个交易日的昨收价（前收盘价）**，一行一个交易日。这是校验用的原语：算复权因子、核对涨跌停价、判断某日"昨日收盘到底是多少"都靠它，比从日线序列里自己移一位更不容易错位。`code` 必填（`600519` / `600519.SH` / `SH600519` / `600519.XSHG` 四种写法实测等价，本层统一成 `600519.SH` 发给上游）；实测北交所可用（`920000.BJ` 区间有数）、停牌票也照样给昨收。日期区间 `start_date` / `end_date` 必填，格式 YYYY-MM-DD，本层转成上游的 YYYYMMDD。`prev_close` 单位元，上游用字符串给出、本层转成数值；时间轴用 `trade_date_ms`（上海时区零点）。⛔ **响应里没有身份列**（每行只有 `date` 与 `prev_close`），`thscode` 是本层按请求补写的，所以本能力一次只问一只票。长区间一次取回即可（实测 2024-01-01..2026-10-15 回 672 行、2020 起回 1088 行，都在同一个响应里）。⛔ **历史窗口起点实测在 2022-04**：2016 / 2018 / 2020 / 2021 的整年区间都返回空数组（不是失败、也没有报错），2022 年只有 04-19 起有数——早年请用 `history`（Fuyao 单票日 K，窗口 ≤10 年）或 `tencent_kline`。区间端点落在非交易日时只回该区间内的交易日行；整段回 0 行先看是不是早于窗口，再考虑代码是否根本不在 A 股普通股票范围（ETF / 可转债 / 指数不在本能力覆盖内）。',
        input_schema: {
            type: 'object',
            properties: {
                code: { type: 'string', description: '标的代码，必须带市场后缀（如 600519.SH、920000.BJ）' },
                start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD' },
                end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD' },
            },
            required: ['code', 'start_date', 'end_date'], additionalProperties: false,
        },
        output_schema: output(prevCloseRow),
    };
    const normalize = (params) => {
        for (const key of Object.keys(params))
            if (key !== 'code' && key !== 'start_date' && key !== 'end_date')
                throw new FtshareError('invalid_parameter', `unsupported parameter: ${key}`);
        const start_date = date(params.start_date, 'start_date');
        const end_date = date(params.end_date, 'end_date');
        if (start_date > end_date)
            throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date');
        // 归一后仍叫 `code`（值已是 canonical `600519.SH`）：换个键名会让第二遍 normalize 报 unsupported parameter。
        return { code: parseSecurityCode(params.code, 'code').canonical, start_date, end_date };
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            // 上游要的是 canonical 短后缀身份（`600519.SH`，实测与裸 `600519` 等价），原样发已校验过的值。
            const search = query({ symbol: params.code, since: compactDate(String(params.start_date)), until: compactDate(String(params.end_date)) }, ['symbol', 'since', 'until']);
            const { rows } = readPaged(await client.getJson('/api/v1/market/data/daec/history/prev-closes', search, signal));
            assertInRange(rows, String(params.start_date), String(params.end_date), (row) => row.date);
            const item = rows.map((row) => {
                const { iso, ms } = normalizeDateCell(row.date);
                return { thscode: String(params.code), trade_date: iso ?? '', trade_date_ms: ms, prev_close: numberOrNull(row.prev_close) };
            }).filter((row) => row.trade_date_ms !== null);
            return { data: snapshotEnvelope(item), schema: output(prevCloseRow) };
        },
    };
}
const calendarRow = {
    type: 'object',
    properties: { market: { type: 'string' }, trade_date: { type: 'string' }, trade_date_ms: { type: 'integer' } },
    additionalProperties: false,
};
/**
 * 交易日历第二源（`/time/trading-calendar`）。接它的两条理由都是实测：
 * 1. Fuyao 那条 `trading_calendar` **无参数、只给近一年、只有 A 股**；这一条能按区间取，并且**覆盖港股**
 *    （实测同一区间 cn 与 hk 的日期集合不同）。
 * 2. 巡检不许编日期，而本族其他能力的日期都得是真交易日——本层把上游的 `20261015`（**数字**）
 *    归一成 `2026-10-15`，下游能力与巡检都用这一套写法。
 * ⛔ 返回后必须核日期落不落在区间内：这是这一族唯一可核的事实，上游改版时它比落一份错 Dataset 好。
 */
function createCalendarSource(client) {
    const capability = 'ftshare_trading_calendar';
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_trading_calendar',
        source: 'http:ftshare.trading_calendar',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: false,
        rowShape: { rowKey: 'item' },
        summary: '交易日历（沪北深与港股，按日期区间）',
        description: '按闭区间获取**中国内地（market=cn）或香港（market=hk）**市场的交易日列表，一行一个交易日。这是 Fuyao `trading_calendar` 的第二家：那条无参数、只给近一年且只有 A 股，本条**能按区间取、并且覆盖港股**（实测 2026-10 区间：cn 与 hk 的日期集合确实不同，hk 多出的日子对应内地假期）。上游把日期给成 `20261015` 这种**数字**，本层归一成 `trade_date` = `2026-10-15` 并补 `trade_date_ms`（上海时区零点毫秒；hk 那一路同样按 +08:00 计算，与港股时区一致）。⛔ 区间端点**不是交易日也没关系**：返回的是区间内的交易日子集，两端落在周末或假期是正常用法，不是错误。实测一次调用给 2025-01-01 至 2026-10-15 共 430 个内地交易日；未来区间同样返回（交易所已公布的排期），所以"取到未来的日期"不是 bug。要判断"今天是否交易日"就按当天日期查这一段区间。',
        input_schema: {
            type: 'object',
            properties: {
                market: { type: 'string', enum: ['cn', 'hk'], description: '市场：cn 中国内地（默认）/ hk 香港' },
                start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD' },
                end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD' },
            },
            required: ['start_date', 'end_date'], additionalProperties: false,
        },
        output_schema: output(calendarRow),
    };
    const normalize = (params) => {
        for (const key of Object.keys(params))
            if (key !== 'market' && key !== 'start_date' && key !== 'end_date')
                throw new FtshareError('invalid_parameter', `unsupported parameter: ${key}`);
        const start_date = date(params.start_date, 'start_date');
        const end_date = date(params.end_date, 'end_date');
        if (start_date > end_date)
            throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date');
        const market = params.market === undefined ? 'cn' : String(params.market);
        if (market !== 'cn' && market !== 'hk')
            throw new FtshareError('invalid_parameter', 'parameter market must be cn or hk');
        return { market, start_date, end_date };
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({ market: params.market, start_date: compactDate(String(params.start_date)), end_date: compactDate(String(params.end_date)) }, ['market', 'start_date', 'end_date']);
            const envelope = await client.getJson('/api/v1/market/data/time/trading-calendar', search, signal);
            const data = isRecord(envelope.data) ? envelope.data : null;
            if (data === null || !Array.isArray(data.trade_dates))
                throw new FtshareError('invalid_response', `FTShare trading calendar returned no trade_dates array (data keys: ${data ? Object.keys(data).join(',') : 'none'})`);
            const item = data.trade_dates.map((value) => {
                const { iso, ms } = normalizeDateCell(value);
                return { market: String(params.market), trade_date: iso ?? '', trade_date_ms: ms };
            }).filter((row) => row.trade_date_ms !== null);
            assertInRange(item, String(params.start_date), String(params.end_date), (row) => row.trade_date);
            return { data: snapshotEnvelope(item), schema: output(calendarRow) };
        },
    };
}
/* ── 批次 C：大宗交易、业绩预告 / 快报、申万行业（总览快照 + 日度指标序列）─────────────
 * 这一节每一句"实测"都能在 2026-10-15 落盘的原始报文里逐字回查（本模块头部那条 ⛔ 的规矩）：
 * 报文与统计脚本在 `/tmp/ftshare-evidence/probe-c/`，结论表见 `docs/design/ftshare-source-survey.md` §7.7。
 */
/** 上游实测认的四档报告期；`q4` / `Q4` / `h1` 这类别名**不报错**（见那颗能力的 description），所以参数层只放这四值。 */
const DISCLOSURE_REPORT_TYPES = ['q1', 'q2', 'q3', 'annual'];
const blockTradeRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, ticker: { type: 'string' }, name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date: { type: 'string' }, trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        deal_price_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] }, close_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        volume_shares: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, premium_ratio: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        buyer_name: { oneOf: [{ type: 'string' }, { type: 'null' }] }, seller_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
function mapBlockTradeRow(row) {
    const symbol = String(row.symbol ?? '');
    const { iso, ms } = normalizeDateCell(row.date);
    return {
        thscode: symbol, ticker: symbol.slice(0, 6), name: textOrNull(row.name),
        trade_date: iso ?? '', trade_date_ms: ms,
        deal_price_yuan: numberOrNull(row.price), close_yuan: numberOrNull(row.close),
        volume_shares: integerOrNull(row.volume), premium_ratio: numberOrNull(row.premium_rate),
        buyer_name: textOrNull(row.buyer_name), seller_name: textOrNull(row.seller_name),
    };
}
const forecastRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, ticker: { type: 'string' }, name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        year: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, report_type: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        report_type_cn: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        forecast_subject: { oneOf: [{ type: 'string' }, { type: 'null' }] }, forecast_type: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        forecast_value_min: { oneOf: [{ type: 'number' }, { type: 'null' }] }, forecast_value_max: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        last_year_value: { oneOf: [{ type: 'number' }, { type: 'null' }] }, unit: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        yoy_change_min_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] }, yoy_change_max_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        publish_date: { oneOf: [{ type: 'string' }, { type: 'null' }] }, publish_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
function mapForecastRow(row) {
    const symbol = String(row.stock_code ?? '');
    const { iso, ms } = normalizeDateCell(row.publish_date);
    return {
        thscode: symbol, ticker: symbol.slice(0, 6), name: textOrNull(row.stock_name),
        year: integerOrNull(row.year), report_type: textOrNull(row.report_type), report_type_cn: textOrNull(row.report_type_cn),
        forecast_subject: textOrNull(row.forecast_subject), forecast_type: textOrNull(row.forecast_type),
        forecast_value_min: numberOrNull(row.forecast_value_min), forecast_value_max: numberOrNull(row.forecast_value_max),
        last_year_value: numberOrNull(row.last_year_value), unit: textOrNull(row.unit),
        yoy_change_min_pct: numberOrNull(row.yoy_change_min), yoy_change_max_pct: numberOrNull(row.yoy_change_max),
        publish_date: iso, publish_date_ms: ms,
    };
}
const expressRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' }, ticker: { type: 'string' }, name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        year: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, report_type: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        report_type_cn: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        eps_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        total_revenue_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] }, total_revenue_prev_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        total_revenue_yoy_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        net_profit_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] }, net_profit_prev_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        net_profit_yoy_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        net_assets_per_share_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] }, roe_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        publish_date: { oneOf: [{ type: 'string' }, { type: 'null' }] }, publish_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
function mapExpressRow(row) {
    const symbol = String(row.stock_code ?? '');
    const { iso, ms } = normalizeDateCell(row.publish_date);
    return {
        thscode: symbol, ticker: symbol.slice(0, 6), name: textOrNull(row.stock_name),
        year: integerOrNull(row.year), report_type: textOrNull(row.report_type), report_type_cn: textOrNull(row.report_type_cn),
        eps_yuan: numberOrNull(row.eps),
        total_revenue_yuan: numberOrNull(row.total_revenue), total_revenue_prev_yuan: numberOrNull(row.total_revenue_prev),
        total_revenue_yoy_pct: numberOrNull(row.total_revenue_yoy),
        net_profit_yuan: numberOrNull(row.net_profit), net_profit_prev_yuan: numberOrNull(row.net_profit_prev),
        net_profit_yoy_pct: numberOrNull(row.net_profit_yoy),
        net_assets_per_share_yuan: numberOrNull(row.sh_netassets_ps), roe_pct: numberOrNull(row.roe),
        publish_date: iso, publish_date_ms: ms,
    };
}
/**
 * 业绩预告与业绩快报共用一颗工厂：路径、行形状与正文各给各的，**参数面完全一致**
 * （单票 modeA 不分页 / `year` + `report_type` 翻页，二选一），所以互斥检查、枚举白名单与
 * 防改版核对只写一遍（§9.7 同一族共用一份实现）。
 */
function createDisclosureSource(options) {
    const allowed = ['code', 'year', 'report_type', 'page', 'size'];
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
        input_schema: {
            type: 'object',
            properties: {
                code: { type: 'string', description: '单票查全部报告期，须带市场后缀（000001.SZ）；与 year/report_type 二选一' },
                year: { type: 'integer', description: '报告期年份（如 2024）；与 report_type 一起给，此时不给 code' },
                report_type: { type: 'string', enum: [...DISCLOSURE_REPORT_TYPES], description: '报告期：q1 一季报 / q2 中报 / q3 三季报 / annual 年报' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE_500 },
            },
            required: [], additionalProperties: false,
        },
        output_schema: output(options.row),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE_500);
        const normalized = { page, size };
        if (params.code !== undefined) {
            if (params.year !== undefined || params.report_type !== undefined) {
                // 上游这时**静默只按单票查**（实测 code + year=2024 + q1 仍回那 16 行），不能让它替调用方做这个选择。
                throw new FtshareError('invalid_parameter', 'parameter code 与 year/report_type 二选一，不能同时给');
            }
            normalized.code = parseSecurityCode(params.code, 'code').canonical;
            return normalized;
        }
        if (params.year === undefined || params.report_type === undefined) {
            throw new FtshareError('invalid_parameter', '不给 code 时必须同时给 year 与 report_type：少一个上游只回 0 行且不报错（实测只给 year=2024 → total_items=0）');
        }
        const year = Number(params.year);
        if (!Number.isSafeInteger(year) || year < 1900 || year > 2100)
            throw new FtshareError('invalid_parameter', `parameter year ${params.year} must be a four-digit year`);
        const reportType = String(params.report_type);
        if (!DISCLOSURE_REPORT_TYPES.includes(reportType)) {
            throw new FtshareError('invalid_parameter', `parameter report_type must be one of ${DISCLOSURE_REPORT_TYPES.join(' / ')}（上游另有静默别名：实测 q4 与 Q4 都按 annual 查、h1 按 q2 查，本层不放行）`);
        }
        normalized.year = year;
        normalized.report_type = reportType;
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            // 上游这一族把单票参数叫 `stock_code`：只在出网那一刻改名，`normalizeParams` 的输出仍用 `code`
            // （§10.7 幂等——第二遍归一化的输入就是第一遍的输出，改名会让它自己报 unsupported parameter）。
            const stockCode = params.code;
            // ⛔ modeA（单票）**上游不翻页**：一次给完全量历史（实测 000001.SZ 16 行、600519 的股东人数 107 行
            // 连 page=2 / page_size=10 都照样给全部），所以这里不把 page 发出去——发了等于对外宣称能翻页，
            // 而 `pages = ceil(total ÷ size)` 会把一份完整历史算成两页，模型翻第二页会拿到重复的一整份。
            const search = query(stockCode !== undefined
                ? { stock_code: stockCode, year: params.year, report_type: params.report_type }
                : { year: params.year, report_type: params.report_type, page: params.page, page_size: params.size }, ['stock_code', 'year', 'report_type', 'page', 'page_size']);
            const { rows, total } = readPaged(await options.client.getJson(options.path, search, signal));
            // 防改版：这一族的过滤失败是静默的（写法不对只回空），所以回来之后逐行核身份。
            // ⛔ 核的是**上游原始列名**（stock_code / year / report_type），映射后的行已经把身份列改名了。
            if (stockCode !== undefined) {
                assertFiltered(rows, { field: 'stock_code', expected: String(stockCode), label: 'code' });
                return { data: snapshotEnvelope(rows.map(options.mapRow)), schema: output(options.row) };
            }
            assertFiltered(rows, { field: 'year', expected: String(params.year), label: 'year' });
            assertFiltered(rows, { field: 'report_type', expected: String(params.report_type), label: 'report_type' });
            const item = rows.map(options.mapRow);
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(options.row) };
        },
    };
}
const swOverviewRow = {
    type: 'object',
    properties: {
        industry_code: { type: 'string' }, industry_name: { type: 'string' }, level: { type: 'integer' },
        parent_industry_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        constituent_count: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        trade_date: { type: 'string' }, trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        pe_lyr: { oneOf: [{ type: 'number' }, { type: 'null' }] }, pe_lyr_percentile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        pe_ttm: { oneOf: [{ type: 'number' }, { type: 'null' }] }, pe_ttm_percentile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        pb: { oneOf: [{ type: 'number' }, { type: 'null' }] }, pb_percentile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        dividend_yield_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] }, dividend_yield_percentile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
function mapSwOverviewRow(row) {
    const { iso, ms } = normalizeDateCell(row.tradeDate);
    return {
        industry_code: String(row.industryCode ?? ''), industry_name: String(row.industryName ?? ''),
        level: integerOrNull(row.level) ?? 0, parent_industry_name: textOrNull(row.parentIndustryName),
        constituent_count: integerOrNull(row.constituentCount), trade_date: iso ?? '', trade_date_ms: ms,
        pe_lyr: numberOrNull(row.lyrPe), pe_lyr_percentile: numberOrNull(row.lyrPePercentile),
        pe_ttm: numberOrNull(row.ttmPe), pe_ttm_percentile: numberOrNull(row.ttmPePercentile),
        pb: numberOrNull(row.pb), pb_percentile: numberOrNull(row.pbPercentile),
        dividend_yield_pct: numberOrNull(row.dvRatio), dividend_yield_percentile: numberOrNull(row.dvRatioPercentile),
    };
}
/** 上游 `amount` 用千元、`total_mv` 用万元（两条独立算式核对，见那颗能力的 description）；本层统一换成**元**再落库。 */
function toYuan(value, factor) {
    const parsed = numberOrNull(value);
    if (parsed === null)
        return null;
    return Math.round(parsed * factor * 100) / 100;
}
const swMetricsRow = {
    type: 'object',
    properties: {
        industry_code: { type: 'string' }, industry_name: { type: 'string' },
        trade_date: { type: 'string' }, trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        pe_lyr: { oneOf: [{ type: 'number' }, { type: 'null' }] }, pe_lyr_quantile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        pe_ttm: { oneOf: [{ type: 'number' }, { type: 'null' }] }, pe_ttm_quantile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        pb: { oneOf: [{ type: 'number' }, { type: 'null' }] }, pb_quantile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        dividend_yield_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] }, dividend_yield_quantile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        dividend_ttm_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] }, dividend_ttm_quantile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        w_pe_lyr: { oneOf: [{ type: 'number' }, { type: 'null' }] }, w_pe_lyr_quantile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        w_pe_ttm: { oneOf: [{ type: 'number' }, { type: 'null' }] }, w_pe_ttm_quantile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        w_pb: { oneOf: [{ type: 'number' }, { type: 'null' }] }, w_pb_quantile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        w_dividend_yield_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] }, w_dividend_ttm_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        turnover_rate_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] }, turnover_float_rate_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        w_turnover_rate_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] }, w_turnover_float_rate_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        turnover_float_rate_quantile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        total_mv_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] }, close_price_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        w_close_price_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        median_pe_lyr: { oneOf: [{ type: 'number' }, { type: 'null' }] }, median_pe_lyr_quantile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        median_pe_ttm: { oneOf: [{ type: 'number' }, { type: 'null' }] }, median_pe_ttm_quantile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        median_pb: { oneOf: [{ type: 'number' }, { type: 'null' }] }, median_pb_quantile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        below_net_asset_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] }, below_net_asset_count: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        constituent_count: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, index_close: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        amount_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        amount_congestion: { oneOf: [{ type: 'number' }, { type: 'null' }] }, amount_congestion_quantile: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
function mapSwMetricsRow(row) {
    const { iso, ms } = normalizeDateCell(row.tradeDate);
    return {
        industry_code: String(row.industryCode ?? ''), industry_name: String(row.industryName ?? ''),
        trade_date: iso ?? '', trade_date_ms: ms,
        pe_lyr: numberOrNull(row.lyrPe), pe_lyr_quantile: numberOrNull(row.lyrPeQuantile),
        pe_ttm: numberOrNull(row.ttmPe), pe_ttm_quantile: numberOrNull(row.ttmPeQuantile),
        pb: numberOrNull(row.pb), pb_quantile: numberOrNull(row.pbQuantile),
        dividend_yield_pct: numberOrNull(row.dvRatio), dividend_yield_quantile: numberOrNull(row.dvRatioQuantile),
        dividend_ttm_pct: numberOrNull(row.dvTtm), dividend_ttm_quantile: numberOrNull(row.dvTtmQuantile),
        w_pe_lyr: numberOrNull(row.addLyrPe), w_pe_lyr_quantile: numberOrNull(row.addLyrPeQuantile),
        w_pe_ttm: numberOrNull(row.addTtmPe), w_pe_ttm_quantile: numberOrNull(row.addTtmPeQuantile),
        w_pb: numberOrNull(row.addPb), w_pb_quantile: numberOrNull(row.addPbQuantile),
        w_dividend_yield_pct: numberOrNull(row.addDvRatio), w_dividend_ttm_pct: numberOrNull(row.addDvTtm),
        turnover_rate_pct: numberOrNull(row.turnoverRate), turnover_float_rate_pct: numberOrNull(row.turnoverRateF),
        w_turnover_rate_pct: numberOrNull(row.addTurnoverRate), w_turnover_float_rate_pct: numberOrNull(row.addTurnoverRateF),
        turnover_float_rate_quantile: numberOrNull(row.turnoverRateFQuantile),
        total_mv_yuan: toYuan(row.totalMv, 1e4), close_price_yuan: numberOrNull(row.closePrice), w_close_price_yuan: numberOrNull(row.addClose),
        median_pe_lyr: numberOrNull(row.middleLyrPe), median_pe_lyr_quantile: numberOrNull(row.middleLyrPeQuantile),
        median_pe_ttm: numberOrNull(row.middleTtmPe), median_pe_ttm_quantile: numberOrNull(row.middleTtmPeQuantile),
        median_pb: numberOrNull(row.middlePb), median_pb_quantile: numberOrNull(row.middlePbQuantile),
        below_net_asset_pct: numberOrNull(row.belowNetAssetPercent), below_net_asset_count: integerOrNull(row.belowNetAssetCount),
        constituent_count: integerOrNull(row.totalCount), index_close: numberOrNull(row.indexClose),
        amount_yuan: toYuan(row.amount, 1e3),
        amount_congestion: numberOrNull(row.amountCongestion), amount_congestion_quantile: numberOrNull(row.amountCongestionQuantile),
    };
}
/** 申万行业代码：实测 `.SI` 后缀**必需**——不带后缀的 `801010` 与不存在的 `999999.SI` 都只回 total=0、不回错。 */
function swIndustryCode(value, name = 'industry_code') {
    const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!/^\d{6}\.SI$/.test(raw)) {
        throw new FtshareError('invalid_parameter', `parameter ${name} must be a 申万 industry code with the .SI suffix (for example 801010.SI)`);
    }
    return raw;
}
function createSwOverviewSource(client) {
    const capability = 'ftshare_sw_industry_overview';
    const allowed = ['date', 'level', 'page', 'size'];
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_sw_industry_overview',
        source: 'http:ftshare.sw_industry_overview',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '申万行业估值快照（全部层级，按交易日）',
        description: '按**单个交易日**获取申万行业（一、二、三级全部层级）的估值快照，一行一个行业。层级数量实测自洽：2026-06-01 全部层级 498 行 = level=1 的 31 + level=2 的 131 + level=3 的 336（2026-10-14 是 497，少的一个是三级里被合并的行业），`level` 传 1/2/3 只取该层（实测 level=1 → total=31）；⛔ 越界的 `level` **不报错只回空**（实测 level=4 → total=0），所以参数层锁成 1/2/3。`date` 必填 YYYY-MM-DD（本层转成上游的 YYYYMMDD；带横杠的写法上游 400 点名拒「date format ... invalid characters」），非交易日与未来日期都是合法空（实测 20261011 周日、20261201 未来 → total=0）。⛔ **窗口只有最近约 94 个交易日**：实测最早有数的是 2026-05-28（2026-05-25 起更早就没有了；2026-01-04 / 2025-01-02 / 2024-01-02 / 2023-01-03 这些真实交易日全部 total=0，交易日历那条能力确认过它们是交易日），从 2026-05-28 数到 2026-10-15 恰是 94 个交易日——无法从一次调用区分"滚动窗口"还是"固定起点"，请把窗口外当合法空结果、不要换日期重试。要更早的行业估值序列请用 `ftshare_sw_industry_metrics`（实测回到 2021-05-31）。当日快照**收盘后当晚就有**（实测 2026-10-15 19:32 打 20261015 已回 497 行）。列口径：五个估值列与它们的历史分位都由上游以字符串给出、本层转数值；⛔ `*_percentile` 是**百分数**（0～100，实测 801010.SI 2026-10-14 = 45.98），而日度指标那条同名口径给的是**比例值**（0.459810），两者差 100 倍、不许跨能力直接比。实测本条的估值列就是日度指标那族的**市值加权口径**（`w_*`）列，同日同列逐列相等：30.38 = w_pe_lyr、32.15 = w_pe_ttm、1.93 = w_pb、2.26 = w_dividend_yield_pct，分位 45.98 = w_pe_lyr_quantile 0.459810 × 100（2026-08-25 的三级行业 850112.SI 同样成立）——所以只要加权口径读本条即可，简单平均与中位数只有日度指标那条给。`parent_industry_name` 仅一级行业为 null（实测 1063 行里 94 行 null）。`constituent_count` 是成份股家数。分页 `page` 实测生效（page=1/3 首行不同），⛔ `size` 的真实上限是 **500 且超限静默按 500**（实测传 1000 → 回显 pageSize=500、497 行一次取完；文档写的 200 不是实际上限），本层锁 1～500。本层逐行核对返回的 `trade_date` 与请求同一天（防改版）。',
        input_schema: {
            type: 'object',
            properties: {
                date: { type: 'string', description: '交易日 YYYY-MM-DD；非交易日返回空（窗口只到最近约 94 个交易日）' },
                level: { type: 'integer', enum: [1, 2, 3], description: '行业层级 1/2/3；省略 = 全部层级（实测 497 行）' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE_500 },
            },
            required: ['date'], additionalProperties: false,
        },
        output_schema: output(swOverviewRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE_500);
        const normalized = { date: date(params.date, 'date'), page, size };
        if (params.level !== undefined) {
            const level = Number(params.level);
            if (level !== 1 && level !== 2 && level !== 3)
                throw new FtshareError('invalid_parameter', 'parameter level must be 1, 2 or 3（越界的 level 上游不报错、只回 0 行）');
            normalized.level = level;
        }
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({ date: compactDate(String(params.date)), level: params.level, page: params.page, page_size: params.size }, ['date', 'level', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson('/api/v1/market/data/sw-industry/overview', search, signal));
            const item = rows.map(mapSwOverviewRow);
            assertInRange(item, String(params.date), String(params.date), (row) => row.trade_date);
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(swOverviewRow) };
        },
    };
}
function createSwMetricsSource(client) {
    const capability = 'ftshare_sw_industry_metrics';
    const allowed = ['industry_code', 'start_date', 'end_date', 'page', 'size'];
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_sw_industry_daily_metrics',
        source: 'http:ftshare.sw_industry_daily_metrics',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '申万单行业日度估值与量价序列（2021-05-31 起）',
        description: '按**单个申万行业代码 + 日期区间**获取该行业的日频指标序列，一行一个交易日，42 列。`industry_code` 必须带 `.SI` 后缀（一 / 二 / 三级实测都可查：801010.SI / 801016.SI / 850112.SI），⛔ 不带后缀（`801010`）与不存在的代码（`999999.SI`）**只回 total=0、不回错**。⛔ **没有 `level` 参数**：上游按代码自动匹配层级（实测省略与传 1 相同），传错层数**静默回 0 行**（实测 level=3 配 801010.SI），本层因此不收它。日期 YYYY-MM-DD（带横杠 400 拒）；`start_date` 晚于 `end_date` 上游静默回空、本层在参数层拒。深度：最早一天实测 **2021-05-31**（区间给 2015-01-01..2020-12-31 → total=0；给 2015-01-01..2026-10-15 → total=1298、首行即 2021-05-31）。`pagination.total` 是区间内的**交易日行数**（实测 2026-08-01..08-31 = 21 行）。⛔ **42 列里有 21 列经常是 null，别当 0**：实测 256 行里 `total_mv_yuan` / `constituent_count` / `close_price_yuan` / `w_close_price_yuan` / `below_net_asset_count` 与各 `*_quantile` 有 106 行 null，`amount_yuan` 有 111 行（多出的 5 行来自三级行业）；`index_close` / `amount_yuan` / `amount_congestion(_quantile)` 在**三级行业恒为 null**（实测 850112.SI 连 2024-01-02 都是）。`amount_yuan` 更自 **2026-08-26** 起整体断供：实测 801010 / 801016 / 801030 / 801710 同一天一起从有值转 null，到 2026-10-14 仍是，而那天 PE/PB/股息率有值。单位：上游 `amount` 是**千元**、`total_mv` 是**万元**（文档没写，本层已换算成元给出），两条独立算式：2026-08-03 三十一个一级行业 amount 合计 1.9975e9，同日全市场日 K 成交额合计 2.0230 万亿元，比值 1012.75（行业覆盖 98.7%）；同行 (amount×1000) ÷ (total_mv×1e4) 折出的换手率在 31 个行业上全落在 0.24%～4.7%，按同为元/同为万元读会差三个数量级。三套估值口径分清：无前缀 = **简单平均**（801010.SI 2026-10-14 pe_lyr 62.79）、`w_*` = **市值加权**（同日 30.38）、`median_*` = **中位数**（43.39），⛔ 不能互相替代，引用时说明是哪一套。`*_quantile` 全是**比例值 0～1**（⛔ 与总览快照的 `*_percentile` 差 100 倍而数值相等：本条 w_pe_lyr_quantile 0.459810 ↔ 总览 pe_lyr_percentile 45.98）；`turnover_*_pct` 与 `below_net_asset_pct` 是百分数原值，且 `below_net_asset_pct = below_net_asset_count ÷ constituent_count × 100`（实测 6 ÷ 102 × 100 = 5.88）。⛔ 换手率是**流通市值**口径，与按总市值折出的不同基（31 个行业比值 0.11～1.22）。分页 `page` 实测生效，`size` 上限 **200 且超限静默截断**（实测 1000 → 回显 pageSize=200），本层锁 1～200。本层逐行核对返回日期落在请求区间内（防改版）。',
        input_schema: {
            type: 'object',
            properties: {
                industry_code: { type: 'string', description: '申万行业代码，必须带 .SI 后缀（一级 801010.SI / 二级 801016.SI / 三级 850112.SI）' },
                start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD（最早有数的交易日是 2021-05-31）' },
                end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE_200 },
            },
            required: ['industry_code', 'start_date', 'end_date'], additionalProperties: false,
        },
        output_schema: output(swMetricsRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE_200);
        const start_date = date(params.start_date, 'start_date');
        const end_date = date(params.end_date, 'end_date');
        if (start_date > end_date)
            throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date（上游对反过来的区间只回 0 行、不报错）');
        return { industry_code: swIndustryCode(params.industry_code), start_date, end_date, page, size };
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({
                industry_code: params.industry_code,
                start_date: compactDate(String(params.start_date)), end_date: compactDate(String(params.end_date)),
                page: params.page, page_size: params.size,
            }, ['industry_code', 'start_date', 'end_date', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson('/api/v1/market/data/sw-industry/daily-metrics', search, signal));
            assertFiltered(rows, { field: 'industryCode', expected: String(params.industry_code), label: 'industry_code' });
            const item = rows.map(mapSwMetricsRow);
            assertInRange(item, String(params.start_date), String(params.end_date), (row) => row.trade_date);
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(swMetricsRow) };
        },
    };
}
function createBlockTradesSource(client) {
    const capability = 'ftshare_block_trades';
    const allowed = ['date', 'page', 'size'];
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_block_trades',
        source: 'http:ftshare.block_trades',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '大宗交易明细（按交易日，一笔一行）',
        description: '按**单个交易日**获取全市场大宗交易明细。⛔ 一行是**一笔成交**而不是"一票一天"：同一只票同日可有多笔（实测 2023-01-03 的 189 行分属 100 只票，最多一只占 22 行；同价同量的相邻两笔只是营业部不同）——按票聚合请先说清数的是笔数还是成交额。`date` 省略 = 取上游**最新有数的一天**，而它落后今天多少取决于入库时刻：实测 2026-10-15 晚 19:32（北京）打 `date=20261015` 是 total=0、不传 date 拿到的 73 行全是 10-14；同一晚 20:03 重打这两个请求，当天已经是 80 行了。⛔ 所以**傍晚拿到当天为空是「还没入库」**，不是取数失败、也不是「今天没有大宗」，不要循环重试。`date` 必须是 YYYY-MM-DD（本层转成上游的 YYYYMMDD）：日历上不存在的一天上游 400 点名拒（实测「date 参数无效：20260231，应为有效的 YYYYMMDD 日期」），非交易日（实测 20261011 周日）只回 total=0 不回错。历史深但**不连续**：实测 2012-01-04 有 14 行、2018-01-02 有 32 行、2020-01-02 有 128 行、2023-01-03 有 189 行、2025-01-02 有 95 行，而 **2016-01-04 整天为 0**（`ftshare_trading_calendar` 确认 20160104 是交易日）——那是上游的缺口，别读成"那天没有大宗交易"。单位与口径：`deal_price_yuan` 与 `close_yuan` 是元（上游以字符串给出，如 "1.37"，本层转数值）、`volume_shares` 是股、⛔ `premium_ratio` 是**比例值不是百分数**，实测口径 (成交价 − 收盘价) ÷ 收盘价（2026-10-13：000656.SZ 成交 1.03 / 收盘 1.13 → 字段 -0.08849558，与算式一致到小数点后 8 位；同日 001300.SZ 溢价 +0.19577579 = 19.58%），要写"折价 8.85%"必须自己 ×100。`buyer_name` / `seller_name` 是营业部原文，「机构专用」是其中一个取值。⛔ **不支持按票过滤**：实测把 `symbol` 当查询参数发出去，上游不报错也不过滤（total 仍是全市场那天的 73 行），单票大宗只能整天取回后自己筛——本层因此不接受 symbol。分页 `page` 实测生效（page=1/2 首行不同）；⛔ `size` 的真实上限是 **500 且超限静默截断**（文档写 200，但实测传 1000 与 2000 都回显 pageSize=500 并一次给完 73 行），本层锁 1～500。本层逐行核对返回日期与请求同一天（防改版）。',
        input_schema: {
            type: 'object',
            properties: {
                date: { type: 'string', description: '交易日 YYYY-MM-DD；省略 = 上游最新可用的一天（实测为上一交易日）' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE_500 },
            },
            required: [], additionalProperties: false,
        },
        output_schema: output(blockTradeRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE_500);
        const normalized = { page, size };
        if (params.date !== undefined)
            normalized.date = date(params.date, 'date');
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({ date: params.date === undefined ? undefined : compactDate(String(params.date)), page: params.page, page_size: params.size }, ['date', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson('/api/v1/market/data/block-trades', search, signal));
            const item = rows.map(mapBlockTradeRow);
            // 省略 date 时"最新的一天"由上游决定，没有可比的对端，只核对请求过的那一类。
            if (params.date !== undefined)
                assertInRange(item, String(params.date), String(params.date), (row) => row.trade_date);
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(blockTradeRow) };
        },
    };
}
const FORECAST_DESCRIPTION = '按报告期获取 A 股**业绩预告**（含北交所与 ST 票），一行是「一只票 × 一个报告期 × 一个预测科目」。两种查法互斥：给 `code`（须带市场后缀，本层转成上游要的 `000001.SZ` 写法）= 单票全部历史报告期且**不分页**（实测 000001.SZ 回 16 行、total=16、pages 恒 1）；给 `year` + `report_type` = 该报告期全市场翻页（实测 2024 annual 3150 行、2023 annual 3333 行、2024 的 q1 229 / q2 1766 / q3 223 行）。⛔ 两组同时给会在参数层被拒——上游这时**静默只按单票查**（实测 code + year=2024 + q1 仍回那 16 行）。`report_type` 只认四值：实测上游另有**不报错的别名**（`q4` 与 `Q4` 都按 annual 查得 3150、`h1` 按 q2 查得 1766），本层把别名挡在门外；真正不认识的写法（`zzz`）上游才 400 点名拒「report_type 无效: zzz, 应为 q1/q2/q3/annual」。⛔ **少给任一个都只回 0 行、不回错**：只给 year（实测 total_items=0）、代码不带后缀（`000001`）、后缀写成聚宽写法（`600519.XSHG`）都是空结果。金额三列（`forecast_value_min` / `forecast_value_max` / `last_year_value`）的单位由同行的 `unit` 说明：实测 2025 annual 全市场逐页取满 3368 行里 `unit` **恒为「元」**；一旦看到别的取值，金额口径要跟着它改。`forecast_value_min == forecast_value_max` 是上游给了点值（多数行如此），不是缺失。⛔ **0 不是「预告为零」**：同一批里有 26 行上下限同为 0，其中 25 行的 yoy 仍非 0（今世缘 2025 营业收入 0/0、yoy 5~12）——那是**缺值编码**，请改看 `yoy_change_*` 与 `last_year_value`；另有 6 行连 `last_year_value` 都是 0。`yoy_change_min_pct` / `max_pct` 是**百分数原值**，实测口径 (预测 − 去年同期) ÷ |去年同期| × 100（平安银行 2015 年报：(20792060000 − 19801960000) ÷ 19801960000 = 5.0000 = 字段 5；上限 15.0000 = 字段 15）。⛔ **0 是「不适用」而不是「同比持平」**：实测 597 行有 190 行 yoy 记 0，这些行的去年同期或预测值至少一方为负（声迅股份 2024 由盈转亏、万林物流 2024 由亏转盈、退市鹏博 2024 减亏都记 0），而预测与去年同期的净利润**都为正**的 28 行 yoy 全部与上面那条算式相符——遇到 0 请自己用 forecast 与 last_year 算。`forecast_subject` 与 `forecast_type` 原样透出、本层不改写：实测 3368 行里科目只有三值（归属于上市公司股东的净利润 3235 / 营业收入 120 / 扣除非经常性损益后的净利润 13）、类型只有五值（预减 1414 / 预增 849 / 略增 585 / 略减 514 / 其他 6）；供应商文档另列了 续亏 / 扭亏 / 续盈 等写法，本层不把任何一组当枚举。modeB 的排序实测是 **`publish_date` 递减**（前 1500 行逐行单调，实测首行发布 2026-04-30、第 1500 行 2026-01-29），所以"最新预告"跨页分散，要按票或按科目取最新一条请自己分组。年份深度：实测 2000 annual 有 93 行、2005 年 603 行、2025 年 3368 行（越近越多）。防改版：带 code 逐行核 `stock_code`，按报告期核 `year` 与 `report_type`；`size` 上限 500（实测 501 → HTTP 400「page_size 不能超过 500」）。';
const EXPRESS_DESCRIPTION = '按报告期获取 A 股**业绩快报**（已披露快报的核心财务指标），一行是「一只票 × 一个报告期」。查法与 `ftshare_performance_forecast` 完全一致（`code` 单票不分页 / `year` + `report_type` 全市场翻页，两组互斥、`report_type` 只认 q1/q2/q3/annual，越界写法参数层拒）。⛔ **快报是稀薄披露**：实测 2024 annual 全市场只有 1192 行（预告同口径 3150 行）、2024 q1 只有 8 行、2005 annual 104 行；什么都不给时上游回 total_items=0 且不报错，取到空是常态而不是失败。同一只票同一报告期可有**多条**更正披露：实测 2024 annual 首页 500 行里 477 个「票×年×期」组合中有 23 个占两行，两行的 `publish_date` 与数值都不同（ST帕瓦 2024：净利 −1,097,147,600 发布于 2025-02-28、−726,501,500 发布于 2025-04-30）。⛔ modeB 的排序实测是 **`publish_date` 递减**（500 行逐行单调），同一票的原披露与更正披露因此相距很远（实测那两条分别落在第 1 行与第 316 行）——要"最新口径"必须按 `publish_date` 分组取最大，**不能按行序或页序猜**。单票 modeA 实测是一期一行（000001.SZ 共 4 条 = 2018 / 2019 / 2021 / 2022 年报各一条）。单位与口径：`eps_yuan`（每股收益）、`net_assets_per_share_yuan`（每股净资产）、`total_revenue_yuan` / `net_profit_yuan` 及各自 `_prev` 上期值都由上游以字符串给出、单位元，本层转数值；`*_yoy_pct` 与 `roe_pct` 是**百分数原值**。⛔ **`net_profit_yoy_pct` 在上期亏损时符号是反的**：实测 2024 / 2023 / 2021 三个年度各取 500 行（共 1500 行）按 (本期 − 上期) ÷ |上期| × 100 逐行核——上期**为正**的 1260 行全部相符（平安银行 2022 年报：(45516000000 − 36336000000) ÷ 36336000000 × 100 = 25.2642 = 字段值），上期**为负**的 240 行**全部与该数符号相反**（ST帕瓦 2024：本期 −726,501,500、上期 −247,643,300 是亏损扩大，算得 −193.3661 而字段是 +193.3661；亚信安全 2024 扭亏，算得 +103.2949 而字段是 −103.2949）。⛔ 所以**别拿这个字段判方向**，要"亏损扩大还是收窄"请自己用本期与上期比。`total_revenue_yoy_pct` 在 499 行（上期均为正）内全部相符，没出现上期为负的样本，规律不外推。`roe_pct` 与同行其它列的算法关系**未核出**（股本要另取 `ftshare_ashare_quote` 的 `shares`，而那是当前股本、不是报告期股本）。⛔ `total_revenue_yoy_pct` 实测出现过 null（46 行里 1 行）——**null 不是 0**，也不是"没增长"。分页 `page` 实测生效，`size` 上限 500（实测 501 → HTTP 400「page_size 不能超过 500」；`page` 或 `size` 给 0 也 400「page/page_size 必须大于 0」，这条比预告那族更响）。防改版：带 code 逐行核 `stock_code`，按报告期核 `year` 与 `report_type`。';
/**
 * 批次 D（2026-10-16 07:36–07:44 北京时间，176 份落盘报文）：涨跌停价、龙虎榜席位、股东人数、
 * 指数成分权重、可转债历史 K 线。五颗都是逐条对照本仓现有能力后挑的**真缺口**，不是"同族再加一颗"：
 * 涨跌停此前只有 `tencent_quote` 的当日口径且明确拒北证；席位此前任何一颗都没有；股东人数只有
 * 东财最新一期截面；成分权重只有名单没有数；转债只有发行条款没有价格序列。
 */
const LIMIT_INSTRUMENT_TYPES = ['stock', 'etf', 'cb'];
const limitPriceRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' },
        trade_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        instrument_type: { type: 'string' },
        pre_close_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        up_limit_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        down_limit_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
function mapLimitPriceRow(row) {
    const { iso, ms } = normalizeDateCell(row.trade_date);
    return {
        thscode: String(row.ts_code ?? ''),
        trade_date: iso,
        trade_date_ms: ms,
        instrument_type: String(row.instrument_type ?? ''),
        pre_close_yuan: numberOrNull(row.pre_close),
        up_limit_yuan: numberOrNull(row.up_limit),
        down_limit_yuan: numberOrNull(row.down_limit),
    };
}
const LIMIT_DESCRIPTION = '按交易日获取全市场或单只标的的**涨跌停价与昨收价**，一行是「一只标的 × 一个交易日」。补的两处空白都经过实测：本仓此前只有 `tencent_quote` 的**当日**涨跌停，而它在参数层明确拒北交所；这一条实测 2026-10-15 全市场 7587 行里含 **350 只 `.BJ`**，而且能翻历史（600519.SH 单票 2010-01-04 起有数，2009 全年 total=0）。两种查法：不给 `code` = 按 `date` 取该日全市场并翻页；给 `code`（须带市场后缀，本层归一成 `000001.SZ` 写法）= 单票，配 `date` 取一天、或配 `start_date` + `end_date` 取区间。⛔ 三条上游硬规则在参数层先拦，话术比它的 400 更具体：区间必须配 `code`（实测不带 code 只给区间 → 400「start_date/end_date 需配合 symbol 使用」）、`date` 与区间不可混用（实测 400「trade_date 不能与 start_date/end_date 同时使用」）、区间跨度不超过 3 年（实测 2020..2026 → 400「start_date 与 end_date 间隔不能超过 3 年」）。裸 6 位在上游是**按深市个股解释**的（实测 `000001` → 平安银行一行），本层不接受这种猜测、要求显式后缀；指数后缀会被上游点名拒（实测 `000001.SH` → 400「index has no limit price」）。`instrument_type` ∈ stock / etf / cb，实测过滤生效且**三类相加正好等于全市场**（2026-10-15：5576 + 1696 + 315 = total 7587），越界写法上游 400「instrument_type 仅支持 stock、etf、cb」。⛔ **`up_limit_yuan` / `down_limit_yuan` 不是交易所口径的精确价**：上游以字符串给最多 6 位小数，实测同日有 852/5576 只股票的涨停价带尾巴（000001.SZ 昨收 11.50 × 1.1 = 12.65，字段却是 12.649999），转债 259/315、ETF 1541/1696 更多（它们昨收本来就是 3～4 位）——要判"是否封板"请先按最小价格单位取整再比。幅度实测分桶（同日全市场）：主板 ±10%、创业板与科创板 ±20%、北证 ±30%、转债 ±20%、ETF 多为 ±10%。⛔ 有 3 行的涨停价与跌停价**同时为 null**（920162.BJ / 301569.SZ / 301660.SZ），这三只在 2026-09-01..10-15 区间里**只出现在 10-15 这一天**，形状像上市首日不设限制，但成因未获对方确认——请按"无限制"而不是"数据缺失"读。非交易日与未来日期都只回 total=0、不报错（实测 20261011 周日、20270101）。防改版：带 `code` 逐行核身份，其余逐行核返回日期落在请求区间内。';
/**
 * 每日涨跌停价（`/market/data/stk-limit`）。⛔ 这一颗的**列值不是交易所精确价**：实测 852/5576 只
 * 股票的涨停价是 `x.649999` 这种带尾巴的字符串，本层原样转数值、不做任何取整——取整口径属于分析层。
 */
function createLimitPriceSource(client) {
    const capability = 'ftshare_limit_price';
    const allowed = ['date', 'code', 'start_date', 'end_date', 'instrument_type', 'page', 'size'];
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_stk_limit',
        source: 'http:ftshare.stk_limit',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '每日涨跌停价与昨收（含北证，按日或单票区间）',
        description: LIMIT_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                date: { type: 'string', description: '交易日 YYYY-MM-DD；省略且给了 code = 该票最新一天（实测默认口径是上一交易日）' },
                code: { type: 'string', description: '单只标的，必须带市场后缀（600519.SH / 920000.BJ / 110075.SH）；省略 = 按 date 取全市场' },
                start_date: { type: 'string', description: '单票历史区间起始日 YYYY-MM-DD，必须与 end_date、code 一起给' },
                end_date: { type: 'string', description: '单票历史区间截止日 YYYY-MM-DD（上游限跨度 3 年）' },
                instrument_type: { type: 'string', enum: [...LIMIT_INSTRUMENT_TYPES], description: '标的类型过滤；实测三类相加正好等于全市场' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
            },
            required: [], additionalProperties: false,
        },
        output_schema: output(limitPriceRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE);
        const code = params.code === undefined ? undefined : parseSecurityCode(params.code, 'code').canonical;
        const hasStart = params.start_date !== undefined;
        const hasEnd = params.end_date !== undefined;
        // 实测上游对这三种混用都是**响亮 400**，本层先拦是为了把话说到"该改哪一个参数"这一层。
        if ((hasStart || hasEnd) && code === undefined) {
            throw new FtshareError('invalid_parameter', 'parameters start_date/end_date require code — 上游没有"全市场历史区间"这种查法（实测 400「start_date/end_date 需配合 symbol 使用」）');
        }
        if (hasStart !== hasEnd)
            throw new FtshareError('invalid_parameter', 'parameters start_date and end_date must be provided together（实测上游 400「start_date 与 end_date 需同时提供」）');
        if (params.date !== undefined && hasStart) {
            throw new FtshareError('invalid_parameter', 'parameter date cannot combine with start_date/end_date（实测上游 400「trade_date 不能与 start_date/end_date 同时使用」）');
        }
        const normalized = { page, size };
        if (params.date !== undefined)
            normalized.date = date(params.date, 'date');
        if (code !== undefined)
            normalized.code = code;
        if (hasStart) {
            const start_date = date(params.start_date, 'start_date');
            const end_date = date(params.end_date, 'end_date');
            if (start_date > end_date)
                throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date');
            normalized.start_date = start_date;
            normalized.end_date = end_date;
        }
        if (params.instrument_type !== undefined) {
            const kind = String(params.instrument_type);
            if (!LIMIT_INSTRUMENT_TYPES.includes(kind)) {
                throw new FtshareError('invalid_parameter', `parameter instrument_type must be one of ${LIMIT_INSTRUMENT_TYPES.join(' / ')}`);
            }
            normalized.instrument_type = kind;
        }
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({
                instrument_type: params.instrument_type,
                symbol: params.code,
                trade_date: params.date === undefined ? undefined : compactDate(String(params.date)),
                start_date: params.start_date === undefined ? undefined : compactDate(String(params.start_date)),
                end_date: params.end_date === undefined ? undefined : compactDate(String(params.end_date)),
                page: params.page,
                page_size: params.size,
            }, ['instrument_type', 'symbol', 'trade_date', 'start_date', 'end_date', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson('/api/v1/market/data/stk-limit', search, signal));
            const item = rows.map(mapLimitPriceRow);
            assertFiltered(item, params.code === undefined ? undefined : { field: 'thscode', expected: String(params.code), label: 'code' });
            if (params.date !== undefined)
                assertInRange(item, String(params.date), String(params.date), (row) => row.trade_date);
            else if (params.start_date !== undefined)
                assertInRange(item, String(params.start_date), String(params.end_date), (row) => row.trade_date);
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(limitPriceRow) };
        },
    };
}
const SEAT = {
    type: 'object',
    properties: {
        name: { type: 'string' },
        buy_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        sell_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        net_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
const dragonTigerSeatRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' },
        trade_date: { type: 'string' },
        trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        change_ratio: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        close_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        turnover_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        top_buyers: { type: 'array', items: SEAT },
        top_sellers: { type: 'array', items: SEAT },
    },
    additionalProperties: false,
};
function mapSeats(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter(isRecord).map((seat) => ({
        name: String(seat.name ?? ''),
        buy_yuan: numberOrNull(seat.buy),
        sell_yuan: numberOrNull(seat.sell),
        net_yuan: numberOrNull(seat.net),
    }));
}
function mapDragonTigerSeatRow(row, tradeDate) {
    return {
        thscode: String(row.symbol ?? ''),
        trade_date: tradeDate,
        trade_date_ms: dateMs(tradeDate),
        change_ratio: numberOrNull(row.change_rate),
        close_yuan: numberOrNull(row.close),
        turnover_yuan: numberOrNull(row.turnover),
        top_buyers: mapSeats(row.top_buyers),
        top_sellers: mapSeats(row.top_sellers),
    };
}
const SEATS_DESCRIPTION = '按**单个交易日**获取龙虎榜明细：一行是一只上榜票，带**买入额前五与卖出额前五的营业部席位**。这一层本仓此前没有——`dragon_tiger` 只给到票级榜单、`eastmoney_top_buy_sell_*` 只给汇总，都没有席位名字；⛔ 所以这三条口径不同，不能拿来互相核对条数。`date` 必填（YYYY-MM-DD，本层转成上游的 YYYYMMDD）：上游允许省略（回"最新快照"），但**响应行里没有日期列**，省略时落库的行就没有时间轴，本能力因此要求显式日期、`trade_date` 由本层按请求补写。实测规模很小：2026-10-14 全日 68 行（SH 26 / SZ 37 / **BJ 5**）、2026-10-15 57 行、2023-01-03 44 行，`size` 给到 201 以上就**一页拿全**。⛔ 历史窗口实测起点在 2022 年初：2022-01-04 有 67 行，而 2021-12-31 与更早（2021-01-04 / 2020-01-02 / 2016-01-04 / 2012-01-04）都是 **0 行**，信封长这样 `{"code":200,"message":"success","data":null}`——那是合法空、不是取数失败；是滚动窗口还是固定起点未核出。非交易日与未来日期同样是 `data:null`（实测 20261011、20270101）。单位与口径：⛔ `change_ratio` 是**比例值不是百分数**（实测 002696.SZ 给 0.10045146726862288，与本仓 `ftshare_limit_price` 的昨收算 (9.75 ÷ 8.86 − 1) 差 3.2e-16），与日度资金流那族的 `change_pct` 不是一套、禁止直接比；`close_yuan` / `turnover_yuan` 与席位三列都是**元**（上游字符串，本层转数值）。`net_yuan = buy_yuan − sell_yuan` 实测 2026-10-14 的 68 行 × 10 席 = 680 条**违例 0**；⛔ 但同一天有 1 行的前五买入额合计**大于**当日成交额，所以席位金额与成交额不能互相闭合。`top_buyers` / `top_sellers` 通常各 5 条，上游缺名次时**不补位**（实测 2025-12-31 的 600343.SH 两边都只有 4 条），统计前先判长度。⛔ **更要紧的是：这两组不保证是营业部**。同一天的 600343.SH 那 4 条的 `name` 是**投资者分类**（机构 / 其他自然人 / 中小投资者 / 沪股通），`top_buyers` 与 `top_sellers` 两组内容**完全相同**，其中「机构」的 `buy_yuan` 是 67,487,960,000 而同行 `turnover_yuan` 只有 7,120,896,372.22——那是交易所按分类口径披露的行，**别按"前五营业部"解读，也别拿 buy ÷ turnover 算占比**。席位名是原文，「机构专用」是营业部口径里的一种取值。⛔ **不支持按票过滤**：实测把 `symbol` 发给上游不报错也不过滤（total 仍是全日 68 行），单票请整日取回后在 Dataset 里筛。`size` 的真实上限是 500 且超限**静默夹断**（文档写 200；实测传 1000 → 回显 pageSize=500）。';
/**
 * 龙虎榜前五席位（`/market/data/abnormal-trading-details`）。
 * ⛔ `date` 是必填而不是可选：响应行内**没有日期列**（实测列集合就是 symbol/change_rate/close/turnover/
 * top_buyers/top_sellers），省略日期就等于落一份没有时间轴的 Dataset——这一条是本层加的，不是上游的限制。
 */
function createDragonTigerSeatsSource(client) {
    const capability = 'ftshare_dragon_tiger_seats';
    const allowed = ['date', 'page', 'size'];
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_abnormal_trading_details',
        source: 'http:ftshare.abnormal_trading_details',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '龙虎榜前五买入/卖出席位（按交易日，含北证）',
        description: SEATS_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                date: { type: 'string', description: '交易日 YYYY-MM-DD，必填（响应里没有日期列，本层要它来写时间轴）' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE_500 },
            },
            required: ['date'], additionalProperties: false,
        },
        output_schema: output(dragonTigerSeatRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE_500);
        return { page, size, date: date(params.date, 'date') };
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({ date: compactDate(String(params.date)), page: params.page, page_size: params.size }, ['date', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson('/api/v1/market/data/abnormal-trading-details', search, signal));
            const item = rows.map((row) => mapDragonTigerSeatRow(row, String(params.date)));
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(dragonTigerSeatRow) };
        },
    };
}
const holderNumberRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' },
        stock_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        publish_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        report_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        report_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        holder_num: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        holder_num_change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        per_capita_circ_share: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        per_capita_share_change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        chip_concentration: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        close_price_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        per_capita_hold_amount_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        ten_holder_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        ften_holder_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
function mapHolderNumberRow(row) {
    const { iso, ms } = normalizeDateCell(row.report_date);
    return {
        thscode: String(row.stock_code ?? ''),
        stock_name: textOrNull(row.stock_name),
        publish_date: normalizeDateCell(row.publish_date).iso,
        report_date: iso,
        report_date_ms: ms,
        holder_num: integerOrNull(row.holder_num),
        holder_num_change_pct: numberOrNull(row.holder_num_change_ratio),
        per_capita_circ_share: numberOrNull(row.per_capita_circ_share),
        per_capita_share_change_pct: numberOrNull(row.per_capita_share_change_ratio),
        chip_concentration: numberOrNull(row.chip_concentration),
        close_price_yuan: numberOrNull(row.close_price),
        per_capita_hold_amount_yuan: numberOrNull(row.per_capita_hold_amount),
        ten_holder_pct: numberOrNull(row.ten_holder_ratio),
        ften_holder_pct: numberOrNull(row.ften_holder_ratio),
    };
}
const HOLDER_DESCRIPTION = '两种互斥查法：给 `code`（须带市场后缀）= 该票**全部历史**、一次给完不翻页（实测 000001.SZ 122 期回到 1995-12-31、600519.SH 107 期、920001.BJ 25 期）；给 `is_last=true` = 全市场**各只票自己的最新一期**并翻页（实测 total_items=5926）。补的空白：本仓此前只有 `eastmoney_holder_number_snapshot` 的最新一期截面，**股东人数的历史序列一直是空的**。⛔ `is_last` **不是"同一报告期截面"**：实测同一页里 report_date 就有 2026-06-30 / 2026-09-30 / 2026-10-09 / 2026-03-31 好几种，做横切面统计请按 `report_date` 自己分组。两组参数同时给会被上游**静默只按单票查**（实测 code + is_last=true 仍回那 122 行），本层在参数层拒混用。写法敏感全是静默的：裸 6 位（`000001`）、聚宽后缀（`000001.XSHE`）、**小写后缀**（`600519.sh`）都回 0 行且不报错（实测），本层统一归一成 `600519.SH` 再发。⛔ **没有日期参数**：实测多发一个 `report_date` 上游不报错也不过滤（仍回 122 行），所以按报告期筛请取回全量后在 Dataset 里做，本层不提供也不会替它假装过滤。单位与口径：`holder_num` 是人；⛔ `holder_num_change_pct` 是**百分数原值**，口径 (本期 ÷ 上期 − 1) × 100 —— 实测 600519.SH 自 2002-06-30 起的 15 期逐期核对，与算式差 ≤1e-4；`ten_holder_pct` / `ften_holder_pct` 同为百分数（十大股东 / 十大流通股东持股比例，上游列名里的 `ften` 是它自己的拼写，本层不改名）；`per_capita_circ_share` 是人均流通股（股），`per_capita_hold_amount_yuan` 是人均持股市值（元），`close_price_yuan` 元，`publish_date` / `report_date` 是 YYYY-MM-DD 原文并另有 `report_date_ms` 供时间轴。⛔ **`close_price_yuan` 的 0 不是价格**：实测 is_last 首页 500 行里 2 行为 0（如 603361.SH：股东数 27、报告期 2022-12-31），同行的 `per_capita_hold_amount_yuan` 会跟着是 0。整列为空是常态而不是坏数据：实测 600519.SH 的 107 期里 `per_capita_share_change_pct` 与 `chip_concentration` **107/107 全为 null**，`per_capita_circ_share` 83 期 null、`ten_holder_pct` 30 期 null、`ften_holder_pct` 17 期 null、`holder_num_change_ratio` 首期 1 行 null——⛔ null 不是 0，不要补值。`size` 上限 1000（实测 2000 / 5000 上游照给，但粗页会把一次调用变成几万行，本层不放）。防改版：带 `code` 逐行核 `stock_code` 与请求同一只票。';
/**
 * 股东人数（`/holder/stock-holder-nums`）。⛔ 参数面**刻意没有日期**：实测上游收到多余的 `report_date`
 * 不报错也不过滤，那一句"我按报告期筛过了"是假的——要筛就取回全量在 Dataset 里筛。
 */
function createHolderNumberSource(client) {
    const capability = 'ftshare_holder_number';
    const allowed = ['code', 'is_last', 'page', 'size'];
    const schema = {
        capability,
        name: 'get_stock_holders_number',
        source: 'http:ftshare.stock_holders_number',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '股东人数历史（单票全期）与全市场最新一期',
        description: HOLDER_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                code: { type: 'string', description: '单只标的，必须带市场后缀（600519.SH / 920001.BJ）；给了它 = 该票全部历史' },
                is_last: { type: 'boolean', description: 'true = 全市场每只票各自的最新一期（分页）；与 code 互斥' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
            },
            required: [], additionalProperties: false,
        },
        output_schema: output(holderNumberRow),
    };
    const normalize = (params) => {
        const code = params.code === undefined ? undefined : parseSecurityCode(params.code, 'code').canonical;
        // 实测 code + is_last=true 时上游静默只按单票查（total 仍是那 122 行），等于让模型以为筛过。
        if (code !== undefined && params.is_last === true) {
            throw new FtshareError('invalid_parameter', 'parameters code and is_last are mutually exclusive — 上游这时静默只按单票查（实测 total 仍是单票那 122 行），不会替你按 is_last 取全市场');
        }
        const isLast = params.is_last === undefined ? undefined : booleanParam(params.is_last);
        if (code === undefined && isLast !== true)
            throw new FtshareError('invalid_parameter', 'one of code / is_last is required — 什么都不给时上游回 total_items=0 且不报错（实测），那一份不是数据');
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE);
        const normalized = { page, size };
        if (code !== undefined)
            normalized.code = code;
        if (isLast !== undefined)
            normalized.is_last = isLast;
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            // ⛔ 单票模式上游**不翻页**（实测 page=2 / page_size=10 都照样给全部 107 期），所以不发分页参数，
            // 也不给 `pages = ceil(total ÷ size)`——那会把一份完整历史说成两页，翻页只会拿到重复的一整份。
            const search = params.code === undefined
                ? query({ is_last: 'true', page: params.page, page_size: params.size }, ['is_last', 'page', 'page_size'])
                : query({ stock_code: params.code }, ['stock_code']);
            const { rows, total } = readPaged(await client.getJson('/api/v1/market/data/holder/stock-holder-nums', search, signal));
            const item = rows.map(mapHolderNumberRow);
            assertFiltered(item, params.code === undefined ? undefined : { field: 'thscode', expected: String(params.code), label: 'code' });
            return {
                data: params.code === undefined ? pagedEnvelope(item, total, Number(params.page), Number(params.size)) : snapshotEnvelope(item),
                schema: output(holderNumberRow),
            };
        },
    };
}
/** `is_last` 在上游是字符串 'true'（实测 `false` 回 0 行、`zzz` 才 400）；这里只放行真正的布尔 true。 */
function booleanParam(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'string' && /^(true|false)$/i.test(value))
        return value.toLowerCase() === 'true';
    throw new FtshareError('invalid_parameter', 'parameter is_last must be a boolean (true / false)');
}
const indexWeightRow = {
    type: 'object',
    properties: {
        index_code: { type: 'string' },
        collect_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        collect_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        component_code: { type: 'string' },
        component_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        weight_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
function mapIndexWeightRow(row) {
    const { iso, ms } = normalizeDateCell(row.date);
    return {
        index_code: String(row.index_code ?? ''),
        collect_date: iso,
        collect_date_ms: ms,
        component_code: String(row.component_code ?? ''),
        component_name: textOrNull(row.component_name),
        weight_pct: numberOrNull(row.weight),
    };
}
const INDEX_WEIGHT_DESCRIPTION = '按**中证系列指数**取某一采集期的成份股权重，一行是「一个指数 × 一个采集期 × 一只成分股」。补的是**权重数值**这一维度：`index_constituents` 给的是成分名单、不带权重，也不按采集期。`index_code` 必填，本层接受裸 6 位与 `000300.SH` / `399001.SZ` 这类带后缀写法并**统一成裸 6 位再发**——⛔ 上游对带后缀的写法是**静默回 0 行**、不报错（实测 `000300.SH` 与 `000001.SH` 都回 `index_weights:[]` 且 total=0），空值才是响亮 400「index_code 不能为空」，而不认识的写法（`ZZZZ`）同样只回 0 行。⛔ 后缀与号段矛盾（`000001.SZ`）在参数层拒：折成裸码就是上证综指，等于本层替你把一只深市身份换成另一个指数。⛔ 这里的 `000001` 是**上证综合指数**（实测 total=2230 只成分，首行 600000 浦发银行），不是平安银行——裸 6 位在行情类能力里通常指个股，本能力整个命名空间都是指数。实测条数与指数名正好对得上：000300 → 300 行、000905 → 500 行、932000 → 2000 行；而**申万行业码 `801010` 回 0 行**（行业口径请用 `ftshare_sw_industry_overview` / `ftshare_sw_industry_metrics`）。`date` 可选，是**采集期**且必须精确命中：实测 2026-06-15 与 2026-09-30 各回该期 300 行，而 2026-10-01 / 2026-01-01 这种没有采集的日期 total=0（**不会**回退到"最近一期"），省略时取最新一期（实测 2026-10-16 打 000300 的最新期是 2026-09-30）。⛔ `weight_pct` 是**百分数原值**，文档写的"小数字符串（如 0.0609）、非百分比"与实测不符：000300 最新期 300 行逐行相加 = **100.002**，单只形如 0.453000 就是 0.453%——别再乘 100。`component_code` 是**裸 6 位、不带交易所后缀**，本层不替它猜市场（需要后缀请用行情类能力或 `ticker_search`）。上游每行还有 `url_hash`（该期 xlsx 的下载 hash），本层不透出。`size` 上限 100，实测超限**静默夹断**（传 101 → 回显 page_size=100 并只回 100 行）：宽指数务必按 `ceil(total ÷ size)` 翻页取满，只读第一页会把 2000 只当成 100 只。防改版：逐行核 `index_code` 与请求一致，带 `date` 时再核采集期等于请求。';
/**
 * 中证指数成分权重（`/index/index_weight`）。
 * ⛔ 第四套信封：行数组叫 `data.index_weights`，分页字段是 `total/page/page_size`（**没有 pages**）。
 */
function createIndexWeightSource(client) {
    const capability = 'ftshare_index_weight';
    const allowed = ['index_code', 'date', 'page', 'size'];
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_index_weight_list',
        source: 'http:ftshare.index_weight_list',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '中证系列指数成分权重（按采集期，百分数）',
        description: INDEX_WEIGHT_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                index_code: { type: 'string', description: '指数代码：裸 6 位或带后缀都收（000300 / 000300.SH / 000905 / 932000），本层统一成裸 6 位再发——上游对带后缀写法静默回 0 行' },
                date: { type: 'string', description: '权重采集期 YYYY-MM-DD，必须精确命中某一期；省略 = 最新一期' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE_100 },
            },
            required: ['index_code'], additionalProperties: false,
        },
        output_schema: output(indexWeightRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE_100);
        const indexCode = bareIndexCode(params.index_code);
        const normalized = { index_code: indexCode, page, size };
        if (params.date !== undefined)
            normalized.date = date(params.date, 'date');
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({
                index_code: params.index_code,
                date: params.date === undefined ? undefined : compactDate(String(params.date)),
                page: params.page,
                page_size: params.size,
            }, ['index_code', 'date', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson('/api/v1/market/data/index/index_weight', search, signal));
            const item = rows.map(mapIndexWeightRow);
            assertFiltered(item, { field: 'index_code', expected: String(params.index_code), label: 'index_code' });
            if (params.date !== undefined)
                assertFiltered(item, { field: 'collect_date', expected: String(params.date), label: 'date' });
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(indexWeightRow) };
        },
    };
}
/**
 * ⛔ 与 `parseSecurityCode` 不是一回事：那一颗是给**个股/ETF**消歧的（裸 000xxx 在指数与个股之间
 * 有歧义所以它拒），而这里的整个命名空间就是指数——`000001` 在上游是上证综指（实测 2230 只成分）。
 * 带后缀的写法上游**静默回 0 行**（实测 `000300.SH` 与 `000001.SH` 都是 `index_weights:[]` 且 total=0），
 * 所以本层把合法后缀折成裸码再发；但后缀与号段互相矛盾的写法（`000001.SZ` 折过去会变成上证综指）
 * 一律在参数层拒——宁可不发，也不悄悄把用户写的身份换成另一个指数。
 */
function bareIndexCode(value, name = 'index_code') {
    const raw = typeof value === 'string' ? value.trim() : '';
    const match = /^(\d{6})(?:\.(SH|SZ|XSHG|XSHE))?$/i.exec(raw);
    if (match === null)
        throw new FtshareError('invalid_parameter', `parameter ${name} must be a six-digit index code, bare or with an exchange (for example 000300, 000905.SH, 399001.SZ, 932000)`);
    const digits = match[1];
    const suffix = (match[2] ?? '').toUpperCase();
    const market = suffix === 'XSHG' ? 'SH' : suffix === 'XSHE' ? 'SZ' : suffix;
    const isShenzhenIndex = digits.startsWith('399');
    if (market !== '' && market !== (isShenzhenIndex ? 'SZ' : 'SH')) {
        throw new FtshareError('invalid_parameter', `parameter ${name} ${JSON.stringify(raw)} conflicts: 399xxx 是深市指数、其余号段（000xxx / 93xxxx / 95xxxx）走沪市与中证口径；本层不替你换成另一个指数`);
    }
    return digits;
}
const cbKlineRow = {
    type: 'object',
    properties: {
        thscode: { type: 'string' },
        trade_date: { type: 'string' },
        trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        ts_millis: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        ts_millis_open: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        open_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        high_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        low_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        close_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        turnover_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        volume_tickets: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
function mapCbKlineRow(row, thscode) {
    const ms = numberOrNull(row.ts_millis);
    return {
        thscode,
        trade_date: ms === null ? '' : shanghaiParts(ms).trade_date,
        trade_date_ms: ms,
        ts_millis: ms,
        ts_millis_open: numberOrNull(row.ts_millis_open),
        open_yuan: numberOrNull(row.open),
        high_yuan: numberOrNull(row.high),
        low_yuan: numberOrNull(row.low),
        close_yuan: numberOrNull(row.close),
        turnover_yuan: numberOrNull(row.turnover),
        volume_tickets: integerOrNull(row.volume),
    };
}
const CB_KLINE_DESCRIPTION = '按**单只可转债**与日期区间取历史 K 线（日 / 周 / 月 / 年），一行一根 K，按时间升序。补的是硬空白：本仓此前只有 `eastmoney_convertible_bond_list` 的**发行条款与要素**，转债的**价格序列此前为零**。`code` 必填（6 位，裸码或带 `.SH` / `.SZ` 都收；实测裸码与带正确后缀**逐字节相同**，113042 = 113042.SH、127045 = 127045.SZ），⛔ 非转债代码与"后缀和代码不配对"都由上游点名拒（实测 600519.SH → 400「symbols [600519.XSHG] are not convertible bonds」；113042.SZ → 400「symbols [113042.XSHE] are not convertible bonds」），所以身份核对是上游做的、本层**不按代码首位猜交易所**（沪市转债是 11xxxx，2007-2009 还有 126 段老沪债，套个股那套自然市场规则会判错）。`start_date` / `end_date` 必填，本层按北京时间 +08:00 转成上游的 `since_ts_millis`（当日 00:00）与 `until_ts_millis`（当日 23:59:59）。⛔ **跨度上限是 12 个自然月，而且边界卡在"整整 12 个月"之外**：实测 2025-10-16..2026-10-15（364 天）正常回 242 行，而 2025-10-15..2026-10-15（365 天）被 400 拒「日 K 及以上周期查询范围不能超过 12 个自然月」——本层**不把它换算成天数闸门**（换算规则没核出，写成常量就是造一个会腐烂的闸门），超限时把上游这句话原样交回。`period` ∈ day / week / month / year（实测上游大小写不敏感，`DAY` 也收）；⛔ `adjust` ∈ none / forward / backward，而这一列上游**大小写敏感**（文档写"大小写不敏感"，实测发 `NONE` 与 `Forward` 都被 400 拒），所以本层统一转小写再发、写法不用操心。⛔ 本层**不宣称 forward / backward 就是前复权 / 后复权**：实测 113042.SH 在 2026-08-01..08-14 三种写法返回逐字节相同（该券该窗口没有复权事件），要原始行情核对请显式给 `none`。时间与单位：`ts_millis` 是这根 K 的**结束**时刻（实测日档落在北京时间 15:00）、`ts_millis_open` 是开始时刻（09:30），`trade_date` / `trade_date_ms` 由本层按 +08:00 从 `ts_millis` 推出；四档价格是元（上游字符串 4 位小数，本层转数值）、`turnover_yuan` 是元；⛔ `volume_tickets` 的单位是**张**（1 张面值 100 元）而不是手：实测同行 `turnover ÷ volume` 落在 [low, high] 区间内（113042.SH 2026-09-01..10-15 的 27 行违例 0，比值 117.824），按"手"乘 1000 会把它推出价格区间三个数量级。实测这 27 行 OHLC 自洽（high ≥ max(open,close) ≥ min(open,close) ≥ low）违例 0，且**八列都没有 null**。`limit` 可选，保留**最新若干根**（实测 limit=3 恰等于不传 limit 那一次的末三行）；⛔ `limit=0` 回 0 行且不报错，本层要求正整数。周 / 月 / 年是**按请求区间内的日 K 聚合**，窗口没盖满一个周期时那根不是完整周期（实测 year 档在 2026-01-01..08-14 只给 1 根）。`interval_value` 实测对日档不改变结果（给 2 仍是每个交易日一根），本层不提供。当日日 K 收盘后即有（实测 2026-10-15 打当天回 1 行）。⛔ 响应 `data` **直接是数组**、没有分页信封，本层合成的 pagination 就是"一次取满"。各券历史起点以其实际上市与上游入库为准，本层未逐券核。';
/**
 * 可转债历史 K 线（`/convertible-bond-candlesticks`）。
 * ⛔ 复权口径只透出不解释：实测 none / forward / backward 在无复权事件的券上逐字节相同，
 * 把它们写成"前复权 / 后复权"就是没有依据的断言（本族批次 B 那一课）。
 */
function createCbKlineSource(client) {
    const capability = 'ftshare_convertible_bond_kline';
    const allowed = ['code', 'period', 'adjust', 'start_date', 'end_date', 'limit'];
    const CB_PERIODS = ['day', 'week', 'month', 'year'];
    const CB_ADJUST = ['none', 'forward', 'backward'];
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_convertible_bond_candlesticks',
        source: 'http:ftshare.convertible_bond_candlesticks',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: false,
        rowShape: { rowKey: 'item' },
        summary: '可转债历史 K 线（日/周/月/年，单只，元）',
        description: CB_KLINE_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                code: { type: 'string', description: '单只可转债，6 位可带 .SH / .SZ（113042.SH / 127045.SZ）' },
                period: { type: 'string', enum: [...CB_PERIODS], description: 'K 线周期；缺省 day' },
                adjust: { type: 'string', enum: [...CB_ADJUST], description: '复权写法（大小写都收，本层转小写发给上游）；不宣称它与前/后复权的对应关系，原始行情核对请用 none' },
                start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD（北京时间）' },
                end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD；与起始相距不超过 12 个自然月' },
                limit: { type: 'integer', minimum: 1, description: '保留最新 N 根；省略 = 窗口内全部' },
            },
            required: ['code', 'start_date', 'end_date'], additionalProperties: false,
        },
        output_schema: output(cbKlineRow),
    };
    const normalize = (params) => {
        for (const key of Object.keys(params))
            if (!allowed.includes(key))
                throw new FtshareError('invalid_parameter', `unsupported parameter: ${key}`);
        const normalized = { code: convertibleBondCode(params.code) };
        if (params.period !== undefined) {
            const period = String(params.period).toLowerCase();
            if (!CB_PERIODS.includes(period))
                throw new FtshareError('invalid_parameter', `parameter period must be one of ${CB_PERIODS.join(' / ')}`);
            normalized.period = period;
        }
        if (params.adjust !== undefined) {
            const adjust = String(params.adjust).toLowerCase();
            if (!CB_ADJUST.includes(adjust))
                throw new FtshareError('invalid_parameter', `parameter adjust must be one of ${CB_ADJUST.join(' / ')}（上游这一列大小写敏感：实测 NONE / Forward 都 400）`);
            normalized.adjust = adjust;
        }
        const start_date = date(params.start_date, 'start_date');
        const end_date = date(params.end_date, 'end_date');
        if (start_date > end_date)
            throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date（实测上游对倒转区间也 400「since_ts_millis 不能晚于 until_ts_millis」）');
        normalized.start_date = start_date;
        normalized.end_date = end_date;
        if (params.limit !== undefined) {
            const limit = Number(params.limit);
            // 实测 limit=0 不报错、只回 0 行；那会被读成"这只券没有行情"。
            if (!Number.isSafeInteger(limit) || limit < 1)
                throw new FtshareError('invalid_parameter', 'parameter limit must be an integer >= 1（实测 0 静默回 0 行、负数被上游 400 拒）');
            normalized.limit = limit;
        }
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({
                symbol: params.code,
                interval_unit: params.period ?? 'day',
                adjust_kind: params.adjust,
                since_ts_millis: Date.parse(`${params.start_date}T00:00:00+08:00`),
                until_ts_millis: Date.parse(`${params.end_date}T23:59:59+08:00`),
                limit: params.limit,
            }, ['symbol', 'interval_unit', 'adjust_kind', 'since_ts_millis', 'until_ts_millis', 'limit']);
            const envelope = await client.getJson('/api/v1/market/data/convertible-bond-candlesticks', search, signal);
            if (!Array.isArray(envelope.data))
                throw new FtshareError('invalid_response', 'FTShare CB kline envelope is not an array — 这一族没有分页信封，读不到数组就无法判断是不是空结果');
            const rows = envelope.data.filter(isRecord);
            // ⛔ 响应行内没有身份列（八列都是行情），所以"上游返回的到底是这只券"无法在返回后核对；
            // 本层能核的最强事实是时间：回来的每根 K 都必须落在请求的区间内。
            assertInRange(rows, String(params.start_date), String(params.end_date), (row) => {
                const ms = numberOrNull(row.ts_millis);
                return ms === null ? null : shanghaiParts(ms).trade_date;
            });
            const item = rows.map((row) => mapCbKlineRow(row, String(params.code)));
            return { data: snapshotEnvelope(item), schema: output(cbKlineRow) };
        },
    };
}
/**
 * 可转债代码。⛔ **不按代码首位猜交易所**（`parseSecurityCode` 那套自然市场规则在这儿是错的：
 * 它会把 11xxxx 判成 SZ，而沪市转债正是 11xxxx，还有 2007-2009 的 126 段老沪债）。
 * 实测上游自己会把写法折成内部 symbol 再判类别：`113042.SZ` 与 `127045.SH` 这种**后缀与代码不配对**
 * 的输入是响亮 400 点名（「symbols [113042.XSHE] are not convertible bonds」），不会静默解析成别的证券；
 * 裸 6 位与带正确后缀的写法实测**逐字节相同**（113042 = 113042.SH、127045 = 127045.SZ）。
 * 所以本层只做写法归一，身份与类别判断交给上游那句 400。
 */
function convertibleBondCode(value, name = 'code') {
    const raw = typeof value === 'string' ? value.trim() : '';
    const match = /^(\d{6})(?:\.(SH|SZ|BJ|XSHG|XSHE))?$/i.exec(raw);
    if (match === null)
        throw new FtshareError('invalid_parameter', `parameter ${name} must be a six-digit convertible bond code, bare or with an exchange (113042.SH / 127045.SZ / 113042)`);
    const digits = match[1];
    const suffix = (match[2] ?? '').toUpperCase();
    const market = suffix === 'XSHG' ? 'SH' : suffix === 'XSHE' ? 'SZ' : suffix;
    return market === '' ? digits : `${digits}.${market}`;
}
/**
 * 批次 E（2026-10-16 08:25–08:29 与 08:44 两轮，109 份落盘报文 + 18 份官方文档页）：LPR、中债收益率曲线、SHIBOR、HIBOR、财经日历。
 * 五颗都是**整块空白**：本仓此前没有任何收益率曲线、没有任何拆借利率、没有 LPR 的免费通道
 * （只有 Wind EDB 那一条按次计费的），也没有发布时刻表一类的日历。
 * ⛔ 同一族里暂缓两颗，理由都写在报文里而不是文档里：`libor_daily` 的行只有
 * `currency` / `tenor` / `rate`、**没有基准名列**，LIBOR 停发之后 USD 隔夜到底是 SOFR 还是别的读不出来；
 * `us_economic` 的读数逐 `type` 单位上游不给、月份又是中文标签，锚不住输出契约。
 * `baidu_financial_calendar` 实测是 A 股事件提醒（股东大会 / 分红 / 停复牌），**不是见闻那棵的第二家**。
 */
const LPR_DESCRIPTION = '一次性返回 **LPR（贷款市场报价利率）全历史**，一行一个日期，⛔ **无参数、无分页**：实测多发 `start_date` / `page` / `page_size` 上游不报错也不过滤（回的仍是同一份 2661 行），要区间请在 Dataset 里按 `trade_date` 筛——本层因此不给这些座位。返回**按日期降序**（实测首行 2026-09-20、末行 2013-10-25）。⛔ **行粒度前后不一致**：2013-10-25..2020-12-20 是**逐自然日填充**（含周末；实测 2016-06 整月每天都是 4.3000），2020-12-21 起只在每月报价日给一行（实测日位集中在 20 / 21 / 22 / 24，自 2020-12-21 含当日起共 70 行）。⛔ 所以**别把行数当报价次数**：全程 2661 行里 `lpr_1y_pct` 只有 **28 个不同取值**、28 次变化；要"报价历史"请按值变化分组或每月取一条。`lpr_5y_pct` 在 2019-08-20 之前**整列为 null**（实测 2125 / 2661 行为 null，首个非空就是 2019-08-20 的 4.8500），⛔ null 不是 0。单位是**百分数原值**（3.0000 读作 3.00%）——依据是上游文档口径与量级，不是本层算出来的；上游以 4 位小数字符串给出，本层转数值。`trade_date_ms` 是北京零点。这一颗是给"贷款利率基准 / 房贷定价"用的免费第二家：此前本仓只能走 Wind EDB（按次计费）。';
const lprRow = {
    type: 'object',
    properties: {
        trade_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        lpr_1y_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        lpr_5y_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
function createLprSource(client) {
    const capability = 'ftshare_lpr';
    const schema = {
        capability,
        name: 'get_lpr_monthly',
        source: 'http:ftshare.lpr_monthly',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: false,
        rowShape: { rowKey: 'item' },
        summary: 'LPR 贷款市场报价利率全历史（百分数，无参数）',
        description: LPR_DESCRIPTION,
        input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
        output_schema: output(lprRow),
    };
    const normalize = (params) => {
        // 实测上游收到任何参数都**静默忽略**，那一句"我按你的区间筛过了"会是假的。
        const keys = Object.keys(params);
        if (keys.length > 0)
            throw new FtshareError('invalid_parameter', `unsupported parameter: ${keys[0]} — 这颗上游收到任何参数都静默忽略（实测多发 start_date / page / page_size 仍回同一份 2661 行），要区间请在 Dataset 里按 trade_date 筛`);
        return {};
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            normalize(request.params);
            const rows = readPaged(await client.getJson('/api/v1/market/data/economic/china-lpr', query({}, []), signal)).rows;
            const item = rows.map((row) => {
                const { iso, ms } = normalizeDateCell(row.date);
                return { trade_date: iso, trade_date_ms: ms, lpr_1y_pct: numberOrNull(row.lpr_1y), lpr_5y_pct: numberOrNull(row.lpr_5y) };
            });
            return { data: snapshotEnvelope(item), schema: output(lprRow) };
        },
    };
}
const CHINABOND_CURVES = ['中债国债收益率曲线', '中债中短期票据收益率曲线(AAA)', '中债商业银行普通债收益率曲线(AAA)'];
const CHINABOND_DESCRIPTION = '按日期区间获取**中债收益率曲线**日度值，一行是「一条曲线 × 一个交易日」。补的是债券定价基准：本仓此前**没有任何收益率曲线**。⛔ 实测只有**三条曲线**（`中债国债收益率曲线` / `中债中短期票据收益率曲线(AAA)` / `中债商业银行普通债收益率曲线(AAA)`，在 2002 起的窗口里逐页取满也只这三条），`curve_name` 是**精确匹配**、认不出的名字只回 0 行不回错（实测 `不存在` 空），所以本层把这三条做成枚举：拼错在参数层就点名拒，而不是让你拿回一份空 Dataset；空白写法上游 400「curve_name must not be blank」。⛔ **各曲线起点不同**（实测同一个 2002-01-01..2010-12-31 窗口内）：国债 2006-03-01、中短期票据 2006-12-25、商业银行普通债 2009-12-24；早于各自起点的日期是合法空、不是失败，也别按"曲线名有缺失"去补。期限列 `y_3m` … `y_30y` 共八档，单位**百分数原值**（实测 2026-10-15 国债 10y = 1.6601、30y = 2.07）；⛔ `y_30y` 对**中短期票据那条曲线整列为 null**（实测 2015-2016 抽 500 行非空 0 / 500，另两条 500 / 500 都有值）——那条曲线本来没有 30 年期限点，不是缺数据。`start_date` / `end_date` 必填（实测缺 `start_date` 400「缺少必填参数：开始日期」、倒转 400「start_date must not be after end_date」，本层也先拦），上游日期要 YYYYMMDD（带横杠 400「start_date must be YYYYMMDD」）。`page_size` 上限实测 **1000**（1001 是**响亮 400**「page_size must be between 1 and 1000」，不是静默截断）。防改版：带 `curve_name` 逐行核曲线名，并逐行核返回日期落在请求区间内。';
const chinabondYieldRow = {
    type: 'object',
    properties: {
        curve_name: { type: 'string' },
        trade_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        y_3m_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        y_6m_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        y_1y_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        y_3y_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        y_5y_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        y_7y_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        y_10y_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        y_30y_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
function createChinabondYieldSource(client) {
    const capability = 'ftshare_chinabond_yield';
    const allowed = ['start_date', 'end_date', 'curve_name', 'page', 'size'];
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_chinabond_yield_daily',
        source: 'http:ftshare.chinabond_yield_daily',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '中债收益率曲线日度（国债/AAA 票据，八档期限）',
        description: CHINABOND_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD' },
                end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD' },
                curve_name: { type: 'string', enum: [...CHINABOND_CURVES], description: '曲线名，精确匹配；实测只有这三条，省略 = 三条一起给' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
            },
            required: ['start_date', 'end_date'], additionalProperties: false,
        },
        output_schema: output(chinabondYieldRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE);
        const start_date = date(params.start_date, 'start_date');
        const end_date = date(params.end_date, 'end_date');
        if (start_date > end_date)
            throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date（实测上游同样 400「start_date must not be after end_date」）');
        const normalized = { start_date, end_date, page, size };
        if (params.curve_name !== undefined) {
            const curve = String(params.curve_name);
            if (!CHINABOND_CURVES.includes(curve)) {
                throw new FtshareError('invalid_parameter', `parameter curve_name must be exactly one of ${CHINABOND_CURVES.join(' / ')} — 上游是精确匹配、认不出的写法只回 0 行不报错（实测）`);
            }
            normalized.curve_name = curve;
        }
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({
                start_date: compactDate(String(params.start_date)), end_date: compactDate(String(params.end_date)),
                curve_name: params.curve_name, page: params.page, page_size: params.size,
            }, ['start_date', 'end_date', 'curve_name', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson('/api/v1/market/data/chinabond-yield-daily', search, signal));
            const item = rows.map((row) => {
                const { iso, ms } = normalizeDateCell(row.trade_date);
                return {
                    curve_name: String(row.curve_name ?? ''), trade_date: iso, trade_date_ms: ms,
                    y_3m_pct: numberOrNull(row.y_3m), y_6m_pct: numberOrNull(row.y_6m), y_1y_pct: numberOrNull(row.y_1y),
                    y_3y_pct: numberOrNull(row.y_3y), y_5y_pct: numberOrNull(row.y_5y), y_7y_pct: numberOrNull(row.y_7y),
                    y_10y_pct: numberOrNull(row.y_10y), y_30y_pct: numberOrNull(row.y_30y),
                };
            });
            assertFiltered(item, params.curve_name === undefined ? undefined : { field: 'curve_name', expected: String(params.curve_name), label: 'curve_name' });
            assertInRange(item, String(params.start_date), String(params.end_date), (row) => row.trade_date);
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(chinabondYieldRow) };
        },
    };
}
/**
 * SHIBOR / HIBOR 同形（`records` 信封 + 一行一个交易日的多期限宽表），共用一颗工厂：
 * ⛔ 两者的期限档**不一样**（SHIBOR 八档含 `y1`、HIBOR 十五档到 `m12`），所以 `tenors` 必须由调用方给、
 * 不能猜——列名与实测报文逐字对齐，多给一档就会把 null 编成"这档存在"。
 */
const RATE_TENOR_ROW = (tenors) => ({
    type: 'object',
    properties: {
        trade_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        ...Object.fromEntries(tenors.map((tenor) => [`${tenor}_pct`, { oneOf: [{ type: 'number' }, { type: 'null' }] }])),
    },
    additionalProperties: false,
});
function createRateSeriesSource(options) {
    const row = RATE_TENOR_ROW(options.tenors);
    const allowed = ['start_date', 'end_date', 'page', 'size'];
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
        input_schema: {
            type: 'object',
            properties: {
                start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD' },
                end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
            },
            required: ['start_date', 'end_date'], additionalProperties: false,
        },
        output_schema: output(row),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE);
        const start_date = date(params.start_date, 'start_date');
        const end_date = date(params.end_date, 'end_date');
        if (start_date > end_date)
            throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date');
        return { start_date, end_date, page, size };
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({
                start_date: compactDate(String(params.start_date)), end_date: compactDate(String(params.end_date)),
                page: params.page, page_size: params.size,
            }, ['start_date', 'end_date', 'page', 'page_size']);
            const { rows, total } = readPaged(await options.client.getJson(options.path, search, signal));
            const item = rows.map((entry) => {
                const { iso, ms } = normalizeDateCell(entry.trade_date);
                const row2 = { trade_date: iso, trade_date_ms: ms };
                for (const tenor of options.tenors)
                    row2[`${tenor}_pct`] = numberOrNull(entry[tenor]);
                return row2;
            });
            assertInRange(item, String(params.start_date), String(params.end_date), (entry) => entry.trade_date);
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(row) };
        },
    };
}
const SHIBOR_DESCRIPTION = '按日期区间获取 **SHIBOR（上海银行间同业拆放利率）** 日度值，一行一个交易日、八个期限一次给全（`on_rate_pct` 隔夜，`w1` / `w2` 一至两周，`m1` / `m3` / `m6` / `m9` 一至九个月，`y1_pct` 一年）。补的是货币市场基准：此前本仓没有任何拆借利率，要利率只能走 Wind EDB（按次计费）。⛔ 单位是**百分数原值**（实测 2026-10-15 隔夜 1.266 读作 1.266%）——依据只有量级（隔夜拆借不会是 1.266 个基点、也不会是 126.6%），**上游文档没有写这一列的单位**。历史起点实测在 **2006-10-08**（2006 全年给 63 行、首行就是它；2006-01-01..06-30 与 07-01..09-30、1999 / 2004 全年都是 0 行），早于起点是合法空，不要换年份重试。⛔ **周末、节假日与未发布日没有行**，上游也不插值、不补算、不前值填充——序列天然不连续，做时序前先声明对齐规则。列按可空声明：上游文档说某期限可能"源数据未发布"，而实测 2020-01-02 起 1000 行里一个 null 都没有；⛔ 真要出现缺失，本层也**不补 0**。`start_date` / `end_date` 必填（实测缺参数 400、倒转 400、带横杠 400），`page_size` 上限 1000（1001 是响亮 400）。防改版：逐行核返回日期落在请求区间内。';
const HIBOR_DESCRIPTION = '按日期区间获取 **HIBOR（香港银行间同业拆放利率）** 日度值，一行一个交易日，十五个期限档（隔夜、一至两周、一至十二个月）。补的是港币资金面：此前本仓没有任何港币利率。⛔ 单位是**百分数原值**（实测 2026-10-08 隔夜 2.16821 读作 2.16821%）。⛔ **十五档里有七档实测整列为 null**：`m4` / `m5` / `m7` / `m8` / `m9` / `m10` / `m11` 在 2026-10-01..15 的 6 行里 6 / 6 全为 null，只有隔夜、一至两周、一至三月、六月、十二月有值——那是 HIBOR 实际公布的档位就这些，⛔ 不是缺数据，别补值也别把 null 读成 0。历史深度实测至少到 2010 年（2010 全年 249 行、首行 2010-01-04；2000-01-01..2001-12-31 两年 0 行），起点是滚动还是固定未核出。香港假日与未发布日没有行（上游声明不插值、不补算、不前值填充）。`start_date` / `end_date` 必填，`page_size` 上限 1000（实测 1001 → 响亮 400）。防改版：逐行核返回日期落在请求区间内。';
const FINANCIAL_CALENDAR_DESCRIPTION = '按**最多 3 天的窗口**获取全球财经日历（华尔街见闻口径），一行一个事件。这块本仓**整块零覆盖**：此前既没有宏观数据发布时刻表，也没有"今天几点出 CPI"。⛔ **窗口上限是硬约束**：实测 `end_date` 比 `start_date` **晚四天及以上**才 400「时间范围不能超过3天」（2026-10-15..10-19 与 ..10-20 被拒，..10-18 那四天含首尾正常回 114 行），本层在参数层先拦；要更长区间请分段请求，本层**不替你循环取**——那会把一次取数变成 N 次出网却假装是一份 Dataset。⛔ **覆盖是滚动窗口**：实测 2026-08-03 / 09-01 / 09-15 / 10-05 / 10-12 / 10-19 / 10-26 各日都有事件（40 / 59 / 45 / 37 / 21 / 25 / 10 行），而 **2026-11-02 / 11-16 / 12-01 与 2026-01-05 都是 `records` 空数组 + `total=0`**，2020 / 2023 / 2024 / 2025 里的整天更是直接回 `data:null`——大约"过去 2.5 个月到未来 2 周"，边界随日期前移；两种空都是合法空、不是失败，不要换日期重试。列口径：`event_time_ms` 与 `event_time_beijing` 是同一时刻的两种写法（上游 `event_time` 是**秒级** Unix **字符串**，实测 1791993600 → 北京 2026-10-15 00:00；⛔ 直接当毫秒会差三个数量级），`tab_type` 实测只有 `general` 与 `earnings` 两值，`region` 是中文地区名（实测单次 113 行里 14 个：中国 / 美国 / 欧元区 / 日本 / 香港 …；跨多次请求累计见过 28 个），`importance` 上游给**字符串数字** "1".."4"，另有空字符串（实测 113 行里 2 行）——本层把空归一成 null，⛔ 不是 0。⛔ `actual_value` / `forecast_value` / `previous_value` **保持文本原样**：这些读数的单位随事件本身而变（指数、百分比、套…上游不给列级单位），本层不转数值、也不换算；缺失只有一种写法——**空字符串**（实测 19 份成功响应、1517 行里这三列加 `link` / `importance` 的空值全是 `""`，`null` 型字段 0 个），本层把它归一成 null。⛔ 财报类事件常给 `actual_value = "0"` 与 `forecast_value = "0"` 的占位（实测首行 赣锋锂业 earnings），那个 0 **不是"实际值为零"**。`link` 是原文链接（实测 113 行里 39 行为空）。`page_size` 真实上限实测 **500**（文档写 200；传 1000 → 回显 pageSize=500），实测最密的三天窗（2026-09-28..09-30）132 个事件、一页就给完；⛔ `page_size=0` 静默只回 1 行（实测），本层要求 ≥1。防改版：逐行核 `stat_date` 落在请求窗口内。';
const financialCalendarRow = {
    type: 'object',
    properties: {
        stat_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        stat_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        event_time_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        event_time_beijing: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        tab_type: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        region: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        event: { type: 'string' },
        importance: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        actual_value: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        forecast_value: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        previous_value: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        link: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
function createFinancialCalendarSource(client) {
    const capability = 'ftshare_financial_calendar';
    const allowed = ['start_date', 'end_date', 'page', 'size'];
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_wallstreetcn_financial_calendar',
        source: 'http:ftshare.wallstreetcn_financial_calendar',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '全球财经日历（≤3 天窗口，含发布时刻与前值）',
        description: FINANCIAL_CALENDAR_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD' },
                end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD；与起始相差不超过 3 天（上游硬约束）' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE_500 },
            },
            required: ['start_date', 'end_date'], additionalProperties: false,
        },
        output_schema: output(financialCalendarRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE_500);
        const start_date = date(params.start_date, 'start_date');
        const end_date = date(params.end_date, 'end_date');
        if (start_date > end_date)
            throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date（实测上游同样 400「结束时间不能早于开始时间」）');
        const spanDays = Math.round((Date.parse(`${end_date}T00:00:00Z`) - Date.parse(`${start_date}T00:00:00Z`)) / 86400_000);
        // ⛔ 这是**固定的上游契约**（不是会往前滚的观测窗口），所以写在参数层不会腐烂：
        // 实测 3 天差通过、4 天差 400「时间范围不能超过3天」。
        if (spanDays > 3)
            throw new FtshareError('invalid_parameter', `parameter start_date..end_date spans ${spanDays} days — 上游单次窗上限是 3 天差（实测 400「时间范围不能超过3天」），请分段请求`);
        return { start_date, end_date, page, size };
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({
                start_date: compactDate(String(params.start_date)), end_date: compactDate(String(params.end_date)),
                page: params.page, page_size: params.size,
            }, ['start_date', 'end_date', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson('/api/v1/market/data/finance/financial-calendar/wallstreetcn', search, signal));
            const item = rows.map((row) => {
                const { iso, ms } = normalizeDateCell(row.stat_date);
                // 上游 event_time 是**秒**级字符串：÷ 不换算就落进时间轴会差三个数量级（本族 ts_nanos 那一课）。
                const seconds = numberOrNull(row.event_time);
                const millis = seconds === null ? null : Math.round(seconds * 1000);
                const parts = millis === null ? null : shanghaiParts(millis);
                return {
                    stat_date: iso, stat_date_ms: ms,
                    event_time_ms: millis,
                    event_time_beijing: parts === null ? null : `${parts.trade_date} ${parts.slice_time}`,
                    tab_type: textOrNull(row.tab_type),
                    region: textOrNull(row.region),
                    event: String(row.event ?? ''),
                    importance: integerOrNull(row.importance),
                    actual_value: textOrNull(row.actual_value),
                    forecast_value: textOrNull(row.forecast_value),
                    previous_value: textOrNull(row.previous_value),
                    link: textOrNull(row.link),
                };
            });
            assertInRange(item, String(params.start_date), String(params.end_date), (row) => row.stat_date);
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(financialCalendarRow) };
        },
    };
}
// ── 批次 F：期货与贵金属（2026-10-16 逐条真报文，免费档 11 颗里选 10 颗）───────────────
// ⛔ 这一批全部按"先档结构、再打报文、最后落字"的顺序做，证据在 /tmp/ftshare-evidence/probe-f/
// （raw* / summary* / stats10 / crosscheck10）与 docs/design/ftshare-source-survey.md §7.11。
// 暂缓的那颗是 eastmoney_futures_strange（龙虎榜）：它一次回 12 个指标、三种载荷形状，
// 落成行集需要"一行变多行"的展平，而 hub 的 mapRow 一行只出一行——为它先改 hub 不属于这一批。
const futuresContractRow = {
    type: 'object',
    properties: {
        symbol: { type: 'string' },
        exchange: { type: 'string' },
        product: { type: 'string' },
        contract_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        future_type: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        trade_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
const FUTURES_CONTRACTS_DESCRIPTION = '按交易日获取**全部在册期货合约清单**（六家商品与金融期货交易所 + 银行间），一行一只合约。不传 `trade_date` = 上游按 CST 取前一交易日。⛔ **行数不是合约数**：实测 2026-10-15 回 1812 行，里面只有 **906 个不同 `symbol`**——每只合约出现两份，两份**除 `future_type` 外逐列相同**（906 只逐个键比过），一份写 `2`、一份写 `null`。要一份干净清单请按 `symbol` 去重；按行计数会把合约数翻倍。`future_type` 在这份快照里实测只出现 `2` 与 `null`（各 906 行），文档口径的 1 主力 / 3 连续**一个都没有** ⇒ 不许把 `null` 读成"主力"。交易所分布实测（同一交易日）：CFFEX 56 / CZCE 486 / DCE 500 / GFEX 96 / INE 134 / NIB 64 / SHFE 476。⛔ `NIB` 是银行间债券远期（`ADBC10_2612.IB` 一类），**清单里有它、行情端没有它**：实测换成 `.NIB` 打 K 线 → 400「unsupported suffix \'NIB\'」，那 64 只在别处取不到数，不是本仓漏接。`symbol` 用的是**短后缀**（`.SHF` / `.CFE` / `.CZC` / `.GFE`），K 线那颗要全称后缀，本层按交易所映射，不用你手工换。⛔ 采集时点：实测 2026-10-16 上午打 `trade_date=20261016` → **400「当日期货数据将在上海时间 20:20 后开放查询」**，那是合法的入库时刻、不是取数故障，不要重试（同一族里另有两颗打当天是 200 + total=0，见 `ftshare_futures_limit_price`）。**这一颗没有分页**：实测多发 `page_size=10` 仍回全量 1812 行，分页座位是假的，本层在参数层拒。1812 行一次给完必然超一次工具返回预算（实测原始报文 177,957 字节），会回 `too_large` + `profile_ref`——那是快照的正常用法，请转 `query_dataset` 用 `filters`（`exchange` / `product`）与 `columns_of_interest` 收窄。';
/** 中国期货列表（`futures-lists`）：按交易日的合约清单快照，⛔ 无分页。 */
function createFuturesContractsSource(client) {
    const capability = 'ftshare_futures_contracts';
    const allowed = ['trade_date'];
    const path = '/api/v1/market/data/futures/futures-lists';
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_china_futures_lists',
        source: 'http:ftshare.futures_lists',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: false,
        cacheMaxAgeMs: 60_000,
        rowShape: { rowKey: 'item' },
        summary: '期货合约清单（按交易日快照，含银行间）',
        description: FUTURES_CONTRACTS_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: { trade_date: { type: 'string', description: '交易日 YYYY-MM-DD；省略 = 上游按 CST 的前一交易日' } },
            required: [], additionalProperties: false,
        },
        output_schema: output(futuresContractRow),
    };
    const normalize = (params) => {
        assertKnown(params, allowed);
        const normalized = {};
        if (params.trade_date !== undefined)
            normalized.trade_date = date(params.trade_date, 'trade_date');
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const envelope = await client.getJson(path, query({ trade_date: params.trade_date === undefined ? undefined : compactDate(String(params.trade_date)) }, ['trade_date']), signal);
            const { rows } = readPaged(envelope);
            // 响应行内没有日期列，交易日只在 `data.trade_date` 回显一次：时间轴只能由本层补写。
            const { iso, ms } = normalizeDateCell(isRecord(envelope.data) ? envelope.data.trade_date : undefined);
            const item = rows.filter((row) => row.symbol !== undefined && row.symbol !== null).map((row) => ({
                symbol: String(row.symbol), exchange: textOrNull(row.exchange), product: textOrNull(row.product),
                contract_name: textOrNull(row.symbol_cn_name), future_type: integerOrNull(row.future_type),
                trade_date: iso ?? (params.trade_date === undefined ? null : String(params.trade_date)),
                trade_date_ms: ms ?? (params.trade_date === undefined ? null : dateMs(String(params.trade_date))),
            }));
            return { data: snapshotEnvelope(item), schema: output(futuresContractRow) };
        },
    };
}
const futuresDetailRow = {
    type: 'object',
    properties: {
        symbol: { type: 'string' },
        exchange: { type: 'string' },
        product: { type: 'string' },
        contract_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        future_type: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        trade_unit: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        quote_unit: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        multiplier: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        min_tick_info: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        margin_rule: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        price_fluctuation_rule: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_months_rule: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_hours_rule: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        delivery_method: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        delivery_site: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        last_trade_date_rule: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        delivery_date_rule: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        spot_symbol: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        list_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        list_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        delist_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        delist_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        trade_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
const FUTURES_DETAIL_DESCRIPTION = '按交易日获取**期货合约要素**（交易单位、合约乘数、最小变动价位、保证金、上市与摘牌日、交割方式），可按单只合约筛。与 `ftshare_futures_contracts` 同一套快照口径：⛔ 实测同一交易日 1812 行、只有 906 只合约，每只两份、两份除 `future_type` 外逐列相同。`symbol` 传标准合约全码（实测 `AG2610.SHF` 回 2 行、**大小写不敏感**：`ag2610.shf` 同样命中；⛔ 认不出的代码不回错、只回空 `items`，实测 `ZZZZ9999.SHF` → 200 + 0 行）。不带 `symbol` 时一次给全量要素，实测原始报文 **1,364,023 字节**，必然超一次工具返回预算并回 `too_large`——请带 `symbol`，或用 `query_dataset` 的 `filters` / `columns_of_interest` 收窄。⛔ 上游 28 列里本层只透出 24 列，**丢弃的列与理由**（按实测 1812 行的空值统计）：`price_unit`（取值 1~1000、口径未披露）、`mean_cal_value`（只有 1 与 2）、`type_code` / `sub_type_code`（703xxx 内部码）、`value_info`（1756/1812 为空串）、`position_limit_info`（1806/1812 为空串）、`last_trade_date_hour`（1660/1812 为空串）。⛔ **两列装的是规则文字不是日期**：`delivery_date` 实测写「合约到期月份的第三个周五,遇法定节假日顺延(非完整周)」、`last_trade_date` 实测写「合约月份的15日(遇国家法定节假日顺延…)」，本层改名成 `delivery_date_rule` / `last_trade_date_rule`，让它们不会被当成日期列（§1.3：日期串落到数值时间列必须响亮失败，那前提是它得是个日期）。真日期是 `list_date`（实测 20231201~20261015）与 `de_list_tdate`（实测 20261015~20290831），都归一成 ISO + 毫秒轴；⛔ `de_list_tdate` 的最小值就是本次快照那天，说明这张表**带着当天摘牌的合约**，别拿它筛"在册"。单位：`trade_unit` 实测七种（张 / 吨 / 立方米 / 克 / 桶 / 手 / 千克），`quote_unit` 是报价单位文字（实测「人民币元/吨」「人民币元/千克」「指数点」），`multiplier` 是每手对应的交易单位数（实测 1~20000，72/1812 为 null）——⛔ 它与 `ftshare_futures_kline` 的 `vwap_per_lot_yuan`（每手成交额）是同一条算式的两侧：每手成交额 ≈ 价格 × multiplier。`spot_symbol` 只有 32/1812 行有值（股指期货那几只给现货指数代码，实测 IC → `000905.SH`）。';
/** 中国期货基础数据（`futures-base-data`）：合约要素快照，可按单只筛。⛔ 只取口径可承诺的列（§7.11）。 */
function createFuturesContractDetailSource(client) {
    const capability = 'ftshare_futures_contract_detail';
    const allowed = ['trade_date', 'symbol'];
    const path = '/api/v1/market/data/futures/futures-base-data';
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_china_futures_base_data',
        source: 'http:ftshare.futures_base_data',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: false,
        cacheMaxAgeMs: 60_000,
        rowShape: { rowKey: 'item' },
        summary: '期货合约要素（乘数/单位/交割/上市摘牌日）',
        description: FUTURES_DETAIL_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                trade_date: { type: 'string', description: '交易日 YYYY-MM-DD；省略 = 上游按 CST 的前一交易日' },
                symbol: { type: 'string', description: '标准合约全码（短后缀，如 AG2610.SHF），大小写都收；不传 = 该日全部' },
            },
            required: [], additionalProperties: false,
        },
        output_schema: output(futuresDetailRow),
    };
    const normalize = (params) => {
        assertKnown(params, allowed);
        const normalized = {};
        if (params.trade_date !== undefined)
            normalized.trade_date = date(params.trade_date, 'trade_date');
        if (params.symbol !== undefined)
            normalized.symbol = futuresTsCode(params.symbol, 'symbol');
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const envelope = await client.getJson(path, query({
                trade_date: params.trade_date === undefined ? undefined : compactDate(String(params.trade_date)),
                symbol: params.symbol,
            }, ['trade_date', 'symbol']), signal);
            const { rows } = readPaged(envelope);
            const { iso, ms } = normalizeDateCell(isRecord(envelope.data) ? envelope.data.trade_date : undefined);
            const snapshotDate = iso ?? (params.trade_date === undefined ? null : String(params.trade_date));
            const snapshotMs = ms ?? (params.trade_date === undefined ? null : dateMs(String(params.trade_date)));
            // 上游的 symbol 过滤大小写不敏感（实测两种写法都命中），所以核身份要比**大写后的**行值：
            // 否则用户写小写、行里是大写，会把一份正确返回判成"过滤没生效"。
            if (params.symbol !== undefined) {
                assertFiltered(rows.map((row) => ({ ...row, symbol: String(row.symbol ?? '').toUpperCase() })), {
                    field: 'symbol', expected: String(params.symbol), label: 'symbol',
                });
            }
            const item = rows.filter((row) => row.symbol !== undefined && row.symbol !== null).map((row) => {
                const listed = normalizeDateCell(row.list_date);
                const delisted = normalizeDateCell(row.de_list_tdate);
                return {
                    symbol: String(row.symbol), exchange: textOrNull(row.exchange), product: textOrNull(row.product),
                    contract_name: textOrNull(row.symbol_cn_name), future_type: integerOrNull(row.future_type),
                    trade_unit: textOrNull(row.trade_unit), quote_unit: textOrNull(row.put_price),
                    multiplier: numberOrNull(row.multiplier),
                    min_tick_info: textOrNull(row.min_put_price_info), margin_rule: textOrNull(row.margin_info),
                    price_fluctuation_rule: textOrNull(row.price_fluctuation_info),
                    trade_months_rule: textOrNull(row.trade_months_info), trade_hours_rule: textOrNull(row.trade_hours_info),
                    delivery_method: textOrNull(row.delivery_mean), delivery_site: textOrNull(row.delivery_site),
                    last_trade_date_rule: textOrNull(row.last_trade_date), delivery_date_rule: textOrNull(row.delivery_date),
                    spot_symbol: textOrNull(row.spot_symbol),
                    list_date: listed.iso, list_date_ms: listed.ms, delist_date: delisted.iso, delist_date_ms: delisted.ms,
                    trade_date: snapshotDate, trade_date_ms: snapshotMs,
                };
            });
            return { data: snapshotEnvelope(item), schema: output(futuresDetailRow) };
        },
    };
}
const futuresKlineRow = {
    type: 'object',
    properties: {
        contract: { type: 'string' },
        symbol: { type: 'string' },
        trade_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        bar_time_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        open_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        high_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        low_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        close_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        volume_lots: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        turnover_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        vwap_per_lot_yuan: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        open_interest_lots: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
const FUTURES_INTERVALS = ['daily', 'weekly', 'monthly', 'quarterly'];
const FUTURES_KLINE_DESCRIPTION = '按**单个合约**与日期区间取历史 K 线（日 / 周 / 月 / 季），一行一根 K、按时间**升序**。⛔ 交易所后缀这一课：清单 / 要素 / 结算 / 涨跌停四颗给的都是短后缀（`AG2610.SHF`），而这一颗只认 CTP **全称**后缀，实测短后缀 400 点名「unsupported suffix \'SHF\', only CTP suffixes (.SHFE, .INE, .DCE, .CZCE, .CFFEX, .GFEX) are supported」——本层按 `.SHF→.SHFE`、`.CFE→.CFFEX`、`.CZC→.CZCE`、`.GFE→.GFEX` 自动换（DCE / INE 原样），六家各拿真实合约核过、每家回 20 行；大小写实测不敏感（`cu2612.SHFE` 与 `CU2612.SHFE` 返回同一份 198 行），本层统一转大写。裸码（实测 `A2611` 回 219 行）也收，但它**没有交易所身份**、本层不替它猜。⛔ `interval` 只有这四档，其余一律在参数层拒——上游这一族是**静默**的：实测 `1d` / `1w` / `week` 回 **200 + 0 行**，只有 `day` / `1M` / `1Q` / `60m` / `1h` / 空串才 400「unsupported futures period interval」；供应商文档写的"兼容 1d / 1w / 1mo / 1q"与实测相反，放行 `1d` 等于把"写法不认"伪装成"这段时间没行情"。⛔ 日期只收 `YYYY-MM-DD`：上游要的是**毫秒**时间戳，实测传 `20260906` 这种 YYYYMMDD 整数 → 200 + 0 行 + total=0，所以本层按北京时间 +08:00 换成当日零点与 23:59:59，不给裸整数留座位。⛔ 跨度上限是 12 个自然月，本层**不换算成天数闸门**（换算规则没核出）：实测 300 天的窗正常（194 根）、365 天与 399 天都被 400「日 K 及以上周期查询范围不能超过 12 个自然月」拒——更长序列请分段取。⛔ 周 / 月 / 季是**由区间内日 K 现聚合**的，窗口没盖满一个周期时那一根不是完整周期——这条核到过逐列等式：末根周 K（trade_date 20261015）的 `volume` 与 `amount` **正好等于**窗口内 10-12/13/14/15 那四天的和（180,070 手 / 98,888,888,750 元，一分不差），`open` = 四天里第一天的开盘、`close` = 最后一天的收盘、`open_interest` = 最后一天的持仓。`start_date` 单独给可以（实测 198 根），`end_date` 单独给上游 400（原话「end cannot be provided without start」），都不给 = 最新 `limit` 根（实测 limit=20 回末 20 根，而 `pagination.total` 仍是区间内根数 198）。`limit` 的默认值文档写 500（本层没核省略时到底给几根），实测传 5000 照给、区间内 198 根全给不截断；⛔ `limit=0` 回 **1 行**且 total 仍报 198（不报错），负数 400「请求参数格式错误：limit: invalid digit found in string」，所以本层要求正整数。单位与口径：`bar_time_ms` 是这根 K 的**结束**时刻（实测日档落在北京时间 15:00），`trade_date` / `trade_date_ms` 用上游那一列（YYYYMMDD 整数）归一而来；四档价格是合约报价单位（元/吨、元/千克、指数点，见 `ftshare_futures_contract_detail` 的 `quote_unit`）；`volume_lots` 与 `open_interest_lots` 是**手**；`turnover_yuan` 是元；⛔ `vwap_per_lot_yuan` **不是价格**，是每手成交额：实测 194 行**全部**满足 `vwap ≡ amount ÷ volume`，与铜的合约乘数交叉核对——末行 545,566 元/手 ÷ 5 吨/手 = 109,113 元/吨，同日收盘 108,290 元/吨（差 0.76%，是加权均价与收盘价的差）。上游另有 `dominant_contract` / `forward_factor` / `backward_factor` 三列，实测那 194 行**全为 null**（文档也明写当前接口返回 null），本层不收录，因此**这颗不提供前复权 / 后复权**，跨合约拼接请自己按 `ftshare_futures_contracts` 的口径决定。当日行情：实测 2026-10-16 上午打当天区间 → 200 + 0 行（不是清单那颗那句 400），未来区间同样空——两种都是合法空。信封是 `data.items` + `data.total`、**没有分页**（`limit` 是唯一的取满手段），`pagination.total` 用上游那个数，这样 `limit` 截断看得见。';
const FUTURES_KLINE_PATH = '/api/v1/market/data/futures/kline';
/**
 * 期货合约历史 K 线（`futures/kline`）。
 * ⛔ 除区间外还核一次身份：响应行里的 `symbol` 是**去后缀转小写**的写法（实测请求 `CU2612.SHFE`
 * 回行 `cu2612`），所以比的是剥掉交易所后缀再转小写的那一半，不是整串相等。
 */
function createFuturesKlineSource(client) {
    const capability = 'ftshare_futures_kline';
    const allowed = ['symbol', 'interval', 'start_date', 'end_date', 'limit'];
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_futures_kline',
        source: 'http:ftshare.futures_kline',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: false,
        rowShape: { rowKey: 'item' },
        summary: '期货合约历史 K 线（日/周/月/季，单合约）',
        description: FUTURES_KLINE_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                symbol: { type: 'string', description: '单只合约，短后缀或全称后缀都收（AG2610.SHF / CU2612.SHFE），本层换成 K 线要的全称后缀' },
                interval: { type: 'string', enum: [...FUTURES_INTERVALS], description: 'K 线周期；缺省 daily。⛔ 1d / 1w / week 一类写法上游静默回空，本层直接拒' },
                start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD（北京时间）' },
                end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD；与起始相距不超过 12 个自然月' },
                limit: { type: 'integer', minimum: 1, description: '保留最新 N 根（实测 5000 照给、0 只回 1 行）；省略 = 用上游默认（文档写 500，本层未核）' },
            },
            required: ['symbol'], additionalProperties: false,
        },
        output_schema: output(futuresKlineRow),
    };
    const normalize = (params) => {
        assertKnown(params, allowed);
        const normalized = { symbol: futuresSymbol(params.symbol) };
        if (params.interval !== undefined) {
            const interval = String(params.interval).toLowerCase();
            if (!FUTURES_INTERVALS.includes(interval))
                throw new FtshareError('invalid_parameter', `parameter interval must be one of ${FUTURES_INTERVALS.join(' / ')}（实测 1d / 1w / week 上游静默回 0 行，只有 day / 1M / 1Q / 60m 这类才 400）`);
            normalized.interval = interval;
        }
        if (params.end_date !== undefined && params.start_date === undefined)
            throw new FtshareError('invalid_parameter', 'parameter end_date 不能单独给（实测上游 400「end cannot be provided without start: please provide both start and end, or omit both」）');
        if (params.start_date !== undefined)
            normalized.start_date = date(params.start_date, 'start_date');
        if (params.end_date !== undefined)
            normalized.end_date = date(params.end_date, 'end_date');
        if (normalized.start_date !== undefined && normalized.end_date !== undefined && String(normalized.start_date) > String(normalized.end_date))
            throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date');
        if (params.limit !== undefined) {
            const limit = Number(params.limit);
            // 实测 limit=0 不报错、只回 1 行，而 total 仍报区间内的根数——那会被读成"这根合约只走过一天"。
            if (!Number.isSafeInteger(limit) || limit < 1)
                throw new FtshareError('invalid_parameter', 'parameter limit must be an integer >= 1（实测 0 静默回 1 行、负数被上游 400 拒）');
            normalized.limit = limit;
        }
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({
                symbol: params.symbol,
                interval: params.interval,
                start: params.start_date === undefined ? undefined : Date.parse(`${params.start_date}T00:00:00+08:00`),
                end: params.end_date === undefined ? undefined : Date.parse(`${params.end_date}T23:59:59+08:00`),
                limit: params.limit,
            }, ['symbol', 'interval', 'start', 'end', 'limit']);
            const { rows, total } = readPaged(await client.getJson(FUTURES_KLINE_PATH, search, signal));
            if (params.start_date !== undefined && params.end_date !== undefined)
                assertInRange(rows, String(params.start_date), String(params.end_date), (row) => row.trade_date);
            assertFiltered(rows, { field: 'symbol', expected: String(params.symbol).split('.')[0].toLowerCase(), label: 'symbol' });
            const item = rows.map((row) => {
                const day = normalizeDateCell(row.trade_date);
                return {
                    contract: String(params.symbol), symbol: String(row.symbol ?? ''),
                    trade_date: day.iso, trade_date_ms: day.ms, bar_time_ms: numberOrNull(row.datetime),
                    open_price: numberOrNull(row.open), high_price: numberOrNull(row.high),
                    low_price: numberOrNull(row.low), close_price: numberOrNull(row.close),
                    volume_lots: integerOrNull(row.volume), turnover_yuan: numberOrNull(row.amount),
                    vwap_per_lot_yuan: numberOrNull(row.vwap), open_interest_lots: numberOrNull(row.open_interest),
                };
            });
            // ⛔ total 用上游那个（区间内的根数），不是 item.length：limit 截断必须看得见。
            return { data: snapshotEnvelope(item, total), schema: output(futuresKlineRow) };
        },
    };
}
const futuresLimitRow = {
    type: 'object',
    properties: {
        ts_code: { type: 'string' },
        exchange: { type: 'string' },
        product: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        contract_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        up_limit_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        down_limit_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        m_ratio_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
const FUTURES_LIMIT_DESCRIPTION = '按**一家交易所**获取期货合约的每日涨停价与跌停价（`exchange` 实测必填：不给就 400「缺少必填参数：交易所」；六家写法大小写不敏感，实测 `shfe` 与 `SHFE` 都回同一个 total=301）。日期两模式二选一：`trade_date` 单日，或 `start_date` + `end_date` 区间（实测区间有效：AG2610 在 2026-10-06..10-15 回 6 个交易日）。⛔ 行内 `ts_code` 的后缀拼法**随交易所而不随合约**：SHFE / DCE / GFEX / INE 分别是 `AG2610.SHF` / `A2611.DCE` / `LC2610.GFE` / `BC2610.INE`，而中金所写 `.CFX`（`IC2610.CFX`）、郑商所写 `.ZCE`（`AP610.ZCE`）——与清单那两颗（`.CFE` / `.CZC`）又不是一套；发给本层时长短拼法都能命中（实测 `AG2610.SHFE` 也命中，返回行仍写短后缀），要打到 K 线请用 `ftshare_futures_kline`，两种拼法本层都认。⛔ **分页上限压在 50，比文档写的 200 低得多**：实测 SHFE 2026-10-15 全天 301 行，`page_size` 20 与 50 可过，**60 起整页 400「missing pre-settlement price」**（100 / 500 / 1000 / 1500 / 2000 全是这一句），而 CZCE 传 51、100 都正常（total=243）、DCE 传 50 正常（total=232）——失败的不是页宽，是上游 SHFE 数据里某些合约**缺前结算价**；恢复手段是把页压回 50 以内逐页取（本层默认就锁在 50，模型不必自己试），不要换日期重试。`up_limit_price` / `down_limit_price` 是**价格**（合约报价单位，与 `ftshare_futures_settle` 同量纲）：实测按 `ts_code` 与结算参数对上号之后，`up_limit ÷ settle` 在 248 行样本里落在 **1.0388~1.2706**（SHFE 1.056~1.271、DCE 1.048~1.114、CZCE 1.039~1.140、GFEX 1.080~1.214、INE 1.070~1.239）、`down_limit ÷ settle` 在 SHFE 那 50 行是 **0.8395~0.9750**——同量纲，所以这两个数可以直接与结算价对照着读。`m_ratio_pct` 是**百分数原值**（12 = 12%）：文档写"最低交易保证金率，单位 %"，实测它是 `ftshare_futures_settle` 里**套保两档的较低值 × 100**——五所合计 248 行**逐行完全吻合**（AD2612：投机 0.10、套保 0.09、m_ratio 9），而它**不等于投机档**（GFEX 48 行里只有 26 行等于多头投机、INE 50 行里只有 10 行）。⛔ 但 `m_ratio_pct` **不能用来复原涨跌停价**：`settle × (1 + m_ratio ÷ 100)` 与 `up_limit` 实测 248 行里只有 11 行吻合（SHFE 与 INE 各 0 行），因为涨跌停用的是**前结算价**与交易所当天的比例，不是这一档保证金率——不要拿它推算涨跌幅度。中金所那 28 行没法做这套交叉核对：实测 `ftshare_futures_settle` 对 CFFEX **回 0 行**（见那颗）。当日：实测 2026-10-16 打 `trade_date=20261016` → **200 + total=0**（与 `ftshare_futures_contracts` 那句 400 不同），收盘前拿到空页是合法的。行按 `trade_date` **降序**给（实测区间模式首行 20261015、第五行 20261009），"最近一天"在第一页。品种过滤 `cont` 实测生效（AG → total=12）。';
/** 期货合约涨跌停价（`futures/ft-limit`）：`exchange` 必填 + 单日或区间二选一。 */
function createFuturesLimitPriceSource(client) {
    const capability = 'ftshare_futures_limit_price';
    const allowed = ['exchange', 'trade_date', 'start_date', 'end_date', 'ts_code', 'cont', 'page', 'size'];
    const path = '/api/v1/market/data/futures/ft-limit';
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_futures_ft_limit',
        source: 'http:ftshare.futures_ft_limit',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '期货合约每日涨跌停价（按交易所，含最低保证金原值）',
        description: FUTURES_LIMIT_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                exchange: { type: 'string', enum: [...FUTURES_EXCHANGES], description: '交易所（必填，大小写都收）' },
                trade_date: { type: 'string', description: '单日交易日 YYYY-MM-DD；与区间二选一' },
                start_date: { type: 'string', description: '区间起始 YYYY-MM-DD，必须与 end_date 同时给' },
                end_date: { type: 'string', description: '区间截止 YYYY-MM-DD' },
                ts_code: { type: 'string', description: '单只合约过滤（短后缀或全称后缀都实测命中）' },
                cont: { type: 'string', description: '品种代码过滤（如 AG），实测生效' },
                page: { type: 'integer', minimum: 1 },
                // ⛔ 50 是实测上限（SHFE 60 起整页失败），文档写的 200 不可信，见 description。
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE_50 },
            },
            required: ['exchange'], additionalProperties: false,
        },
        output_schema: output(futuresLimitRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE_50);
        const normalized = { exchange: futuresExchange(params.exchange, FUTURES_EXCHANGES), page, size };
        const hasRange = params.start_date !== undefined || params.end_date !== undefined;
        if (params.trade_date !== undefined && hasRange)
            throw new FtshareError('invalid_parameter', 'parameter trade_date 与 start_date / end_date 二选一，不许混给（实测上游对缺一边的组合直接 400）');
        if (params.trade_date === undefined && !hasRange)
            throw new FtshareError('invalid_parameter', 'parameter trade_date 或 start_date + end_date 至少要给一组');
        if (params.trade_date !== undefined)
            normalized.trade_date = date(params.trade_date, 'trade_date');
        if (hasRange) {
            if (params.start_date === undefined || params.end_date === undefined)
                throw new FtshareError('invalid_parameter', 'parameter start_date 与 end_date 必须同时给');
            normalized.start_date = date(params.start_date, 'start_date');
            normalized.end_date = date(params.end_date, 'end_date');
            if (String(normalized.start_date) > String(normalized.end_date))
                throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date');
        }
        if (params.ts_code !== undefined)
            normalized.ts_code = futuresTsCode(params.ts_code);
        if (params.cont !== undefined)
            normalized.cont = String(params.cont).trim().toUpperCase();
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({
                exchange: params.exchange,
                ts_code: params.ts_code,
                cont: params.cont,
                trade_date: params.trade_date === undefined ? undefined : compactDate(String(params.trade_date)),
                start_date: params.start_date === undefined ? undefined : compactDate(String(params.start_date)),
                end_date: params.end_date === undefined ? undefined : compactDate(String(params.end_date)),
                page: params.page,
                page_size: params.size,
            }, ['exchange', 'ts_code', 'cont', 'trade_date', 'start_date', 'end_date', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson(path, search, signal));
            if (params.trade_date !== undefined) {
                assertFiltered(rows, { field: 'trade_date', expected: compactDate(String(params.trade_date)), label: 'trade_date' });
            }
            else {
                assertInRange(rows, String(params.start_date), String(params.end_date), (row) => row.trade_date);
            }
            assertFiltered(rows, { field: 'exchange', expected: String(params.exchange), label: 'exchange' });
            if (params.ts_code !== undefined) {
                // 上游收下长后缀、返回行写短后缀：核身份只能比**剥掉交易所后缀**的那一半。
                const bare = String(params.ts_code).split('.')[0];
                assertFiltered(rows.map((row) => ({ ...row, ts_code: String(row.ts_code ?? '').split('.')[0] })), { field: 'ts_code', expected: bare, label: 'ts_code' });
            }
            if (params.cont !== undefined)
                assertFiltered(rows, { field: 'cont', expected: String(params.cont), label: 'cont' });
            const item = rows.map((row) => {
                const day = normalizeDateCell(row.trade_date);
                return {
                    ts_code: String(row.ts_code ?? ''), exchange: textOrNull(row.exchange), product: textOrNull(row.cont),
                    contract_name: textOrNull(row.name), trade_date: day.iso, trade_date_ms: day.ms,
                    up_limit_price: numberOrNull(row.up_limit), down_limit_price: numberOrNull(row.down_limit),
                    m_ratio_pct: numberOrNull(row.m_ratio),
                };
            });
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(futuresLimitRow) };
        },
    };
}
const futuresSettleRow = {
    type: 'object',
    properties: {
        ts_code: { type: 'string' },
        exchange: { type: 'string' },
        trade_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        settle_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        long_margin_rate: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        short_margin_rate: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        b_hedging_margin_rate: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        s_hedging_margin_rate: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        trading_fee_rate: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        trading_fee: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        delivery_fee: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        offset_today_fee: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
const FUTURES_SETTLE_DESCRIPTION = '按**一家交易所**获取期货合约的每日结算参数（结算价、四档保证金率、手续费）。`exchange` 必填（实测缺失 400「缺少必填参数：交易所」）。⛔ **中金所这一颗没有数据**：实测 2026-10-15 与 10-08..10-14 区间、`CFFEX` 与 `CFX` 两种写法都回 **200 + total=0**——中金所的保证金与手续费本层取不到，那不是参数错、重试也没用（中金所的涨跌停请用 `ftshare_futures_limit_price`，实测 28 行有数）。日期同样二选一：`trade_date` 单日或 `start_date` + `end_date` 区间，⛔ **区间跨度上限 31 天**（实测 2026-09-10..10-15 → 400「start_date and end_date must be at most 31 days apart」；这一条文档与实测一致，本层在参数层拦下，把上游原话带进错误信息）。`size` 上限 **4000**（实测传 5000 静默夹到 4000、回显 `pageSize: 4000`，超限不报错，所以只能在参数层拦）。`ts_code` 实测短后缀与全称后缀都能命中（`AG2610.SHF` 与 `AG2610.SHFE` 同样 total=6），返回行写的是各所自己的拼法（SHFE `.SHF`、DCE `.DCE`、GFEX `.GFE`、INE `.INE`、郑商所 `.ZCE`）。单位与口径：`settle_price` 是结算价（合约报价单位——实测 2026-10-15 SHFE 那 301 行 min 521.3 / max 377140，量纲随合约本身），它是与 `ftshare_futures_limit_price` 交叉核对的那一侧（实测同一天按 `ts_code` 对上 248 行、`up_limit ÷ settle` 全部落在 1.04~1.27）。四档保证金率（`long_margin_rate` / `short_margin_rate` / `b_hedging_margin_rate` / `s_hedging_margin_rate`）实测落在 **0.06~0.22**，按**小数比例**读（0.22 = 22%）；⛔ 投机两档与套保两档**是两回事**（实测 AD2612 投机 0.10、套保 0.09），涨跌停那颗的 `m_ratio_pct` 实测等于**套保两档的较低值 × 100**（五所 248 行逐行吻合），别拿它当投机保证金。⛔ `trading_fee_rate` / `trading_fee` / `delivery_fee` / `offset_today_fee` 这四列**单位上游没披露、本层也没核出来**（实测同一交易所里 trading_fee_rate 取 0~0.6、offset_today_fee 取 0.005~10、trading_fee 取 0~20、delivery_fee 取 0~2）：是百分数还是千分数无法判定，所以**原样透出、不加单位后缀、不参与换算**——要算交易成本请用别的能力核过之后再写结论。数值列在上游全是**字符串**，本层转成数值、空值转 null 不补 0。当日：实测 2026-10-16 打 `trade_date=20261016` → **200 + total=0**（不是清单那颗那句 400），20:20 之前拿到空页是合法的。';
/** 期货每日结算参数（`futures/fut-settle`）：区间跨度实测 31 天上限。 */
function createFuturesSettleSource(client) {
    const capability = 'ftshare_futures_settle';
    const allowed = ['exchange', 'trade_date', 'start_date', 'end_date', 'ts_code', 'page', 'size'];
    const path = '/api/v1/market/data/futures/fut-settle';
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_futures_settle',
        source: 'http:ftshare.fut_settle',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '期货每日结算参数（结算价/保证金率/手续费）',
        description: FUTURES_SETTLE_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                exchange: { type: 'string', enum: [...FUTURES_EXCHANGES], description: '交易所（必填）' },
                trade_date: { type: 'string', description: '单日交易日 YYYY-MM-DD；与区间二选一' },
                start_date: { type: 'string', description: '区间起始 YYYY-MM-DD，与 end_date 同时给，跨度不超过 31 天' },
                end_date: { type: 'string', description: '区间截止 YYYY-MM-DD' },
                ts_code: { type: 'string', description: '单只合约过滤（短后缀或全称后缀都实测命中）' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE_4000 },
            },
            required: ['exchange'], additionalProperties: false,
        },
        output_schema: output(futuresSettleRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE_4000);
        const normalized = { exchange: futuresExchange(params.exchange, FUTURES_EXCHANGES), page, size };
        const hasRange = params.start_date !== undefined || params.end_date !== undefined;
        if (params.trade_date !== undefined && hasRange)
            throw new FtshareError('invalid_parameter', 'parameter trade_date 与 start_date / end_date 二选一，不许混给');
        if (params.trade_date === undefined && !hasRange)
            throw new FtshareError('invalid_parameter', 'parameter trade_date 或 start_date + end_date 至少要给一组');
        if (params.trade_date !== undefined)
            normalized.trade_date = date(params.trade_date, 'trade_date');
        if (hasRange) {
            if (params.start_date === undefined || params.end_date === undefined)
                throw new FtshareError('invalid_parameter', 'parameter start_date 与 end_date 必须同时给');
            normalized.start_date = date(params.start_date, 'start_date');
            normalized.end_date = date(params.end_date, 'end_date');
            const spanDays = (Date.parse(`${normalized.end_date}T00:00:00Z`) - Date.parse(`${normalized.start_date}T00:00:00Z`)) / 86_400_000;
            if (spanDays < 0)
                throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date');
            if (spanDays > 31)
                throw new FtshareError('invalid_parameter', 'parameter start_date / end_date 跨度不能超过 31 天（实测上游 400「start_date and end_date must be at most 31 days apart」）——要更长区间请按月分段取');
        }
        if (params.ts_code !== undefined)
            normalized.ts_code = futuresTsCode(params.ts_code);
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({
                exchange: params.exchange,
                ts_code: params.ts_code,
                trade_date: params.trade_date === undefined ? undefined : compactDate(String(params.trade_date)),
                start_date: params.start_date === undefined ? undefined : compactDate(String(params.start_date)),
                end_date: params.end_date === undefined ? undefined : compactDate(String(params.end_date)),
                page: params.page,
                page_size: params.size,
            }, ['exchange', 'ts_code', 'trade_date', 'start_date', 'end_date', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson(path, search, signal));
            if (params.trade_date !== undefined)
                assertFiltered(rows, { field: 'trade_date', expected: compactDate(String(params.trade_date)), label: 'trade_date' });
            else
                assertInRange(rows, String(params.start_date), String(params.end_date), (row) => row.trade_date);
            assertFiltered(rows, { field: 'exchange', expected: String(params.exchange), label: 'exchange' });
            if (params.ts_code !== undefined) {
                const bare = String(params.ts_code).split('.')[0];
                assertFiltered(rows.map((row) => ({ ...row, ts_code: String(row.ts_code ?? '').split('.')[0] })), { field: 'ts_code', expected: bare, label: 'ts_code' });
            }
            const item = rows.map((row) => {
                const day = normalizeDateCell(row.trade_date);
                return {
                    ts_code: String(row.ts_code ?? ''), exchange: textOrNull(row.exchange), trade_date: day.iso, trade_date_ms: day.ms,
                    settle_price: numberOrNull(row.settle),
                    long_margin_rate: numberOrNull(row.long_margin_rate), short_margin_rate: numberOrNull(row.short_margin_rate),
                    b_hedging_margin_rate: numberOrNull(row.b_hedging_margin_rate), s_hedging_margin_rate: numberOrNull(row.s_hedging_margin_rate),
                    trading_fee_rate: numberOrNull(row.trading_fee_rate), trading_fee: numberOrNull(row.trading_fee),
                    delivery_fee: numberOrNull(row.delivery_fee), offset_today_fee: numberOrNull(row.offset_today_fee),
                };
            });
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(futuresSettleRow) };
        },
    };
}
const warrantRow = {
    type: 'object',
    properties: {
        product: { type: 'string' },
        futures_name: { type: 'string' },
        exchange: { type: 'string' },
        warehouse: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        warehouse_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        area: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        place: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        year_label: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        grade: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        brand: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        unit: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        prev_warrant_volume: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        warrant_volume: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        warrant_change: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
const WARRANT_DESCRIPTION = '按交易日获取**商品交易所仓单日报**明细，一行是「一个品种 × 一家仓库」。日期三选一即可：`trade_date` 或 `start_date` + `end_date`（实测空参 400「证券代码、交易日期、开始日期或结束日期至少需要提供一个」——本层同样要求至少给一个条件，否则一次要拉全市场几年的行）。`exchange` 只五家（SHFE / INE / CZCE / DCE / GFEX，实测中金所不发仓单），`symbol` 是品种代码（实测 CU 配 SHFE 回 32 行、过滤生效）。`size` 上限 **4000**（实测 5000 静默夹到 4000 并回显；一天全市场实测 1469 行，一页就能取完）。⛔ **`unit` 随行而变，这是这张表最容易读错的一列**：实测 2026-10-15 一天里 CZCE 那 105 行是「张」、SHFE 那 32 行（铜）是「吨」、DCE 全部 193 行是「手」、GFEX 86 行是「手」，而 **INE 那 47 行同时有「吨」29 行与「桶」18 行**——同一家交易所内部就有两种单位。任何"仓单总量"都必须先按 `unit` 分组成员再相加；跨品种、跨所直接相加得到的是一个没有人认领的数。⛔ **DCE 有「小计」行的坑**：实测那 193 行里 49 行的 `futures_name` 带「小计」后缀（`豆一小计` 与 `豆一` 在同一品种 `A` 下并存），而两组的**仓库集合互不重叠**（实测 A / LH / V 三组重叠 0 家仓库：豆一 12 家 vs 豆一小计 9 家），所以「小计」不是把明细再加一遍、而是另一批仓库的名字；但按 `symbol` 分组求和会把这两种视图混在一起——要"某品种仓单"请**按 `futures_name` 分组**并看清它带不带「小计」。`warrant_change = warrant_volume − prev_warrant_volume` 实测 100 行**0 违例**，变动列可信。⛔ 列位随交易所而不随数据缺口：实测 DCE 193 行的 `warehouse_id` / `area` / `place` / `year_label` / `grade` / `brand` **整列为 null**；CZCE 那 105 行反过来只有 `area` 与 `brand` 全 null；SHFE 32 行只有 `area` 有值（实测「上海」）；GFEX 86 行只有 `brand` 有 28 行——null 是"这一所不披露这一列"。上游另有 `pd` 与 `is_ct` 两列，实测五所合计 **463 行全为 null**、含义无法核出，本层不收录。当日：实测 2026-10-16 打 `trade_date=20261016` → 200 + total=0（合法的空，20:20 之前本就还没有当日仓单）。';
/** 期货仓单日报（`fut_wsr`）：⛔ 数量列必须先按 `unit` 分组，见 description。 */
function createWarrantSource(client) {
    const capability = 'ftshare_futures_warrant';
    const allowed = ['trade_date', 'start_date', 'end_date', 'symbol', 'exchange', 'page', 'size'];
    const path = '/api/v1/market/data/futures/fut-wsr';
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_futures_warrant_daily',
        source: 'http:ftshare.fut_wsr',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '期货仓单日报（分交易所，数量单位随行而变）',
        description: WARRANT_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                trade_date: { type: 'string', description: '单日交易日 YYYY-MM-DD；与区间二选一' },
                start_date: { type: 'string', description: '区间起始 YYYY-MM-DD，与 end_date 同时给' },
                end_date: { type: 'string', description: '区间截止 YYYY-MM-DD' },
                symbol: { type: 'string', description: '品种代码过滤（如 CU / A / SR），大小写都收' },
                exchange: { type: 'string', enum: [...WARRANT_EXCHANGES], description: '交易所（五家；中金所不发仓单）' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE_4000 },
            },
            required: [], additionalProperties: false,
        },
        output_schema: output(warrantRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE_4000);
        const normalized = { page, size };
        const hasRange = params.start_date !== undefined || params.end_date !== undefined;
        if (params.trade_date !== undefined && hasRange)
            throw new FtshareError('invalid_parameter', 'parameter trade_date 与 start_date / end_date 二选一，不许混给');
        if (params.trade_date === undefined && !hasRange)
            throw new FtshareError('invalid_parameter', 'parameter trade_date 或 start_date + end_date 至少要给一组（实测空参上游 400「证券代码、交易日期、开始日期或结束日期至少需要提供一个」）');
        if (params.trade_date !== undefined)
            normalized.trade_date = date(params.trade_date, 'trade_date');
        if (hasRange) {
            if (params.start_date === undefined || params.end_date === undefined)
                throw new FtshareError('invalid_parameter', 'parameter start_date 与 end_date 必须同时给');
            normalized.start_date = date(params.start_date, 'start_date');
            normalized.end_date = date(params.end_date, 'end_date');
            if (String(normalized.start_date) > String(normalized.end_date))
                throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date');
        }
        if (params.symbol !== undefined)
            normalized.symbol = String(params.symbol).trim().toUpperCase();
        if (params.exchange !== undefined)
            normalized.exchange = futuresExchange(params.exchange, WARRANT_EXCHANGES);
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({
                trade_date: params.trade_date === undefined ? undefined : compactDate(String(params.trade_date)),
                start_date: params.start_date === undefined ? undefined : compactDate(String(params.start_date)),
                end_date: params.end_date === undefined ? undefined : compactDate(String(params.end_date)),
                symbol: params.symbol,
                exchange: params.exchange,
                page: params.page,
                page_size: params.size,
            }, ['trade_date', 'start_date', 'end_date', 'symbol', 'exchange', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson(path, search, signal));
            if (params.trade_date !== undefined)
                assertFiltered(rows, { field: 'trade_date', expected: compactDate(String(params.trade_date)), label: 'trade_date' });
            else
                assertInRange(rows, String(params.start_date), String(params.end_date), (row) => row.trade_date);
            if (params.symbol !== undefined)
                assertFiltered(rows, { field: 'symbol', expected: String(params.symbol), label: 'symbol' });
            if (params.exchange !== undefined)
                assertFiltered(rows, { field: 'exchange', expected: String(params.exchange), label: 'exchange' });
            const item = rows.map((row) => {
                const day = normalizeDateCell(row.trade_date);
                return {
                    product: String(row.symbol ?? ''), futures_name: textOrNull(row.fut_name), exchange: textOrNull(row.exchange),
                    warehouse: textOrNull(row.warehouse), warehouse_id: textOrNull(row.wh_id),
                    area: textOrNull(row.area), place: textOrNull(row.place),
                    year_label: textOrNull(row.year), grade: textOrNull(row.grade), brand: textOrNull(row.brand),
                    unit: textOrNull(row.unit),
                    trade_date: day.iso, trade_date_ms: day.ms,
                    prev_warrant_volume: numberOrNull(row.pre_vol), warrant_volume: numberOrNull(row.vol), warrant_change: numberOrNull(row.vol_chg),
                };
            });
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(warrantRow) };
        },
    };
}
const futuresWeeklyRow = {
    type: 'object',
    properties: {
        exchange: { type: 'string' },
        product: { type: 'string' },
        product_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        week: { type: 'string' },
        week_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        week_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        volume_lots: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        volume_yoy_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        amount_yi: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        amount_yoy_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        cum_volume_lots: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        cum_volume_yoy_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        cum_amount_yi: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        cum_amount_yoy_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        open_interest_lots: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        open_interest_wow_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        week_close_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        close_wow_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
const FUTURES_WEEKLY_DESCRIPTION = '按统计周期获取**期货主要品种交易周报**，一行是「一周 × 一个品种」（实测一周整表 90 行、六家交易所都在）。条件至少给一个：`week` 单周、`prd` 品种（支持逗号分隔，实测 `CU,AL` 命中两个品种）、或 `start_week` + `end_week` 区间（实测空参 400「周、品种代码、开始周或结束周至少需要提供一个」；实测 `prd=CU` 单独给可用，一个品种 total=92 周、`page` 生效）。⛔ 周码一律 `YYYYWW`：实测 `2026-10-16` 这种写法 400「start_week must use YYYYWW format」，本层在参数层按同一个形状拦。`size` 上限 **4000**（实测 5000 静默夹到 4000）。⛔ **这张表有发布滞后，别按"本周"打**：实测 2026-10-16 打 202636..202642 只回 4 周 360 行（202636 / 202637 / 202638 / 202639），单独打 `week=202641` → **200 + total=0**；最新一期实测是两周前那一周。拿到空周先按"还没发布"理解，不是取数失败。⛔ `week_date` 是该周期的**截止交易日**，不是自然周边界：实测 202636→20260918（周五）、202637→20260924（周四）、202638→20260930（周三）、202639→20261009（周五，跨国庆），所以**不许按自然周对齐去补洞、也不许拿周码反推日期**，日期只认 `week_date` 这一列。单位：`volume_lots` / `cum_volume_lots` / `open_interest_lots` 是**手**；`amount_yi` / `cum_amount_yi` 是**亿元**——这条不是文档给的（文档只写"成交额"），是把 202639 那 90 行逐行拿 `amount × 1e8 ÷ vol` 与「`ftshare_futures_contract_detail` 里同品种的众数合约乘数 × `week_close_price`」相对照算出来的：82 行可比（另外 8 行要么当周无成交、要么 `prd` 是 `L-F` 这种清单里没有的写法），比值全部落在 **0.969~1.085**、中位 **0.999**（差额是周内加权均价与周末收盘价的差）。`*_yoy` / `open_interest_wow_pct` / `close_wow_pct` 是**百分数原值**（6.64 = 6.64%），不是比例值。⛔ 同比列的上游键名拼错：报文里写作 **`amout_yoy`**（少一个 n），而同一行的 `amount` 拼写正常，所以那是键名笔误不是另一种口径——本层改名成 `amount_yoy_pct` 透出（与东财 `SECUCODE → thscode` 同一做法）。无成交的那一行**不是 0 而是空洞**：实测 202639 里 JR / PM / RI / WH / ZC 五行 `volume_lots=0`、`cum_volume_lots=0`、`open_interest_lots=0`，而 `volume_yoy_pct` / `amount_yoy_pct` / `week_close_price` / `close_wow_pct` 全为 null（实测 90 行里 10 行 `volume_yoy_pct` 为 null、5 行 `week_close_price` 为 null）——null 保持 null，不补 0 也不沿用上期。';
/** 期货主要品种交易周报（`fut-weekly-detail`）：⛔ 上游把同比列键名写成 `amout_yoy`，本层改名透出。 */
function createFuturesWeeklySource(client) {
    const capability = 'ftshare_futures_weekly';
    const allowed = ['week', 'start_week', 'end_week', 'prd', 'exchange', 'page', 'size'];
    const path = '/api/v1/market/data/futures/fut-weekly-detail';
    const schema = {
        capability,
        // ⛔ 这一颗刻意不挂时间契约：参数面没有任何日期列（只有周码），行内日期是 `week_date`。
        name: 'get_futures_weekly_detail',
        source: 'http:ftshare.fut_weekly_detail',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '期货主要品种交易周报（周码 YYYYWW，成交额亿元）',
        description: FUTURES_WEEKLY_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                week: { type: 'string', description: '单个统计周期 YYYYWW（如 202639）；与区间二选一' },
                start_week: { type: 'string', description: '起始周期 YYYYWW，与 end_week 同时给' },
                end_week: { type: 'string', description: '截止周期 YYYYWW' },
                prd: { type: 'string', description: '品种代码，支持逗号分隔（CU 或 CU,AL）；实测单独给它就够' },
                exchange: { type: 'string', enum: [...FUTURES_EXCHANGES], description: '交易所（可选）' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE_4000 },
            },
            required: [], additionalProperties: false,
        },
        output_schema: output(futuresWeeklyRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE_4000);
        const normalized = { page, size };
        const hasRange = params.start_week !== undefined || params.end_week !== undefined;
        if (params.week !== undefined && hasRange)
            throw new FtshareError('invalid_parameter', 'parameter week 与 start_week / end_week 二选一，不许混给');
        if (params.week === undefined && !hasRange && params.prd === undefined)
            throw new FtshareError('invalid_parameter', 'parameter week / prd / start_week + end_week 至少要给一个（实测空参上游 400「周、品种代码、开始周或结束周至少需要提供一个」）');
        if (params.week !== undefined)
            normalized.week = weekCode(params.week, 'week');
        if (hasRange) {
            if (params.start_week === undefined || params.end_week === undefined)
                throw new FtshareError('invalid_parameter', 'parameter start_week 与 end_week 必须同时给');
            normalized.start_week = weekCode(params.start_week, 'start_week');
            normalized.end_week = weekCode(params.end_week, 'end_week');
            if (String(normalized.start_week) > String(normalized.end_week))
                throw new FtshareError('invalid_parameter', 'parameter start_week must not be later than end_week');
        }
        if (params.prd !== undefined)
            normalized.prd = String(params.prd).trim().toUpperCase();
        if (params.exchange !== undefined)
            normalized.exchange = futuresExchange(params.exchange, FUTURES_EXCHANGES);
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({
                week: params.week, start_week: params.start_week, end_week: params.end_week,
                prd: params.prd, exchange: params.exchange, page: params.page, page_size: params.size,
            }, ['week', 'start_week', 'end_week', 'prd', 'exchange', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson(path, search, signal));
            if (params.week !== undefined)
                assertFiltered(rows, { field: 'week', expected: String(params.week), label: 'week' });
            else if (params.start_week !== undefined && params.end_week !== undefined) {
                // 周码是 `YYYYWW` 定宽串，字典序就是时间序；拿它跟区间比才是真的核，
                // 换成"那一年的 1/1..12/31"这种宽框等于不核。
                const wrong = rows.find((row) => String(row.week ?? '') < String(params.start_week) || String(row.week ?? '') > String(params.end_week));
                if (wrong !== undefined)
                    throw new FtshareError('invalid_response', `FTShare returned week ${JSON.stringify(String(wrong.week ?? ''))} outside the requested ${params.start_week}..${params.end_week} range — 上游没有应用周区间，这一份不是该区间的结果`);
            }
            if (params.exchange !== undefined)
                assertFiltered(rows, { field: 'exchange', expected: String(params.exchange), label: 'exchange' });
            if (params.prd !== undefined) {
                // 逗号分隔的多值过滤要整串比：拿 `{prd}` 单值比会把 `CU,AL` 那一次正确返回判成"过滤没生效"。
                const wanted = String(params.prd).split(',').map((item) => item.trim()).filter((item) => item !== '');
                const wrong = rows.find((row) => !wanted.includes(String(row.prd ?? '').toUpperCase()));
                if (wrong !== undefined)
                    throw new FtshareError('invalid_response', `FTShare dropped the prd filter: got prd=${JSON.stringify(String(wrong.prd ?? ''))} instead of one of ${wanted.join(' / ')} — 这份返回不是该品种集合的结果`);
            }
            const item = rows.map((row) => {
                const end = normalizeDateCell(row.week_date);
                return {
                    exchange: String(row.exchange ?? ''), product: String(row.prd ?? ''), product_name: textOrNull(row.name),
                    week: String(row.week ?? ''), week_date: end.iso, week_date_ms: end.ms,
                    volume_lots: integerOrNull(row.vol), volume_yoy_pct: numberOrNull(row.vol_yoy),
                    amount_yi: numberOrNull(row.amount), amount_yoy_pct: numberOrNull(row.amout_yoy),
                    cum_volume_lots: integerOrNull(row.cumvol), cum_volume_yoy_pct: numberOrNull(row.cumvol_yoy),
                    cum_amount_yi: numberOrNull(row.cumamt), cum_amount_yoy_pct: numberOrNull(row.cumamt_yoy),
                    open_interest_lots: integerOrNull(row.open_interest), open_interest_wow_pct: numberOrNull(row.interest_wow),
                    week_close_price: numberOrNull(row.mc_close), close_wow_pct: numberOrNull(row.close_wow),
                };
            });
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(futuresWeeklyRow) };
        },
    };
}
const nanhuaIndexRow = {
    type: 'object',
    properties: {
        code: { type: 'string' },
        trade_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        open: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        high: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        low: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        close: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        pre_close: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        change_value: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        volume_lots: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        amount_yi: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
const NANHUA_DESCRIPTION = '按指数代码获取**南华期货指数日 K 线**（商品指数序列，代码形如 `AG_NH` / `CU_NH`）。两种查法：`trade_date` = 单日截面（实测 AG_NH + 20261015 回 1 行；⛔ 传了 `trade_date` 时区间参数被忽略，这是文档写的、实测单日只回 1 行与之相符），或 `start_date` + `end_date` = 区间序列（实测 AG_NH 20260817..20261015 回 total=38、按 `trade_date` **升序**）。`code` 与 `trade_date` 至少给一个（实测两者都缺 → 400「code and trade_date cannot both be empty」）。`size` 上限 **200**（实测 201 → **响亮** 400「page_size must be between 1 and 200」，这一颗与静默夹断那几颗不同）；`page` 实测生效（page=2 / size=10 首行 20260831，与第一页零重叠）。⛔ **OHLC 不保证自洽**：指数是聚合出来的，实测 30 行里就有 **1 行 `high < open`**（AG_NH 20260928：open 1758.78 / high 1724.75 / low 1649.31 / close 1650.30）——不要拿单根 K 的高低自洽性判这份数据"坏了"，更不要因此重试。可信的是涨跌那一组：实测 `change ≡ close − pre_close` 与 `pct_chg ≡ change ÷ pre_close × 100` 在 30 行里 **0 违例**。`change_pct` 是百分数原值（-4.3166 = 跌 4.32%）。⛔ `amount_yi` 的单位是**本层核出来的，文档那条是错的**：文档写「成交额(千元)」，而按千元读 CU_NH 20260930 那一行（`amount=802.72` / `vol=146,524` 手）得到每手只有 5.48 元、除以铜的 5 吨/手是 **1.1 元/吨**——比同日 `ftshare_futures_kline` 的 CU2612 收盘 108,290 元/吨低五个数量级；按**亿元**读才是每手 547,842 元、折合 **109,568 元/吨**，与 108,290 同量级（差 1.2%，指数覆盖多只合约）。所以这一列按亿元命名，但⛔ 它仍是**推断出的量级**：只做同 `code` 内的时序与相对比较，不要拿它和股票或单个合约的成交额对账。`volume_lots` 是手。认不出的代码不回错、只回空分页（实测 `ZZZZ_NH` → 200 + total=0）。文档口径覆盖自 20211115 起，本层未逐品种核起点。行内 `trade_date` 上游是**字符串** `YYYYMMDD`，本层归一成 ISO + 毫秒轴。';
/** 南华期货指数日 K 线（`nanhua-index-kline`）：⛔ 聚合指数不保证 high ≥ open，见 description。 */
function createNanhuaIndexKlineSource(client) {
    const capability = 'ftshare_futures_index_kline';
    const allowed = ['code', 'trade_date', 'start_date', 'end_date', 'page', 'size'];
    const path = '/api/v1/market/data/futures/nanhua-index-kline';
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_nanhua_index_daily_kline',
        source: 'http:ftshare.futures_nanhua_index_kline',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '南华期货商品指数日 K 线（按指数代码）',
        description: NANHUA_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                code: { type: 'string', description: '指数代码，形如 AG_NH / CU_NH；与 trade_date 至少给一个' },
                trade_date: { type: 'string', description: '单日截面 YYYY-MM-DD（给了它就忽略区间）' },
                start_date: { type: 'string', description: '区间起始 YYYY-MM-DD，与 end_date 同时给' },
                end_date: { type: 'string', description: '区间截止 YYYY-MM-DD' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE_200 },
            },
            required: [], additionalProperties: false,
        },
        output_schema: output(nanhuaIndexRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE_200);
        const normalized = { page, size };
        if (params.code === undefined && params.trade_date === undefined)
            throw new FtshareError('invalid_parameter', 'parameter code 与 trade_date 至少给一个（实测两者都缺上游 400「code and trade_date cannot both be empty」）');
        if (params.code !== undefined)
            normalized.code = String(params.code).trim().toUpperCase();
        if (params.trade_date !== undefined)
            normalized.trade_date = date(params.trade_date, 'trade_date');
        const hasRange = params.start_date !== undefined || params.end_date !== undefined;
        if (hasRange) {
            if (params.start_date === undefined || params.end_date === undefined)
                throw new FtshareError('invalid_parameter', 'parameter start_date 与 end_date 必须同时给');
            normalized.start_date = date(params.start_date, 'start_date');
            normalized.end_date = date(params.end_date, 'end_date');
            if (String(normalized.start_date) > String(normalized.end_date))
                throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date');
        }
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const compact = (value) => value === undefined ? undefined : compactDate(String(value));
            const search = query({
                code: params.code, trade_date: compact(params.trade_date),
                start_date: compact(params.start_date), end_date: compact(params.end_date),
                page: params.page, page_size: params.size,
            }, ['code', 'trade_date', 'start_date', 'end_date', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson(path, search, signal));
            if (params.code !== undefined)
                assertFiltered(rows, { field: 'code', expected: String(params.code), label: 'code' });
            if (params.trade_date !== undefined)
                assertFiltered(rows, { field: 'trade_date', expected: compact(params.trade_date), label: 'trade_date' });
            else if (params.start_date !== undefined && params.end_date !== undefined)
                assertInRange(rows, String(params.start_date), String(params.end_date), (row) => row.trade_date);
            const item = rows.map((row) => {
                const day = normalizeDateCell(row.trade_date);
                return {
                    code: String(row.code ?? ''), trade_date: day.iso, trade_date_ms: day.ms,
                    open: numberOrNull(row.open), high: numberOrNull(row.high), low: numberOrNull(row.low), close: numberOrNull(row.close),
                    pre_close: numberOrNull(row.pre_close), change_value: numberOrNull(row.change), change_pct: numberOrNull(row.pct_chg),
                    volume_lots: integerOrNull(row.vol), amount_yi: numberOrNull(row.amount),
                };
            });
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(nanhuaIndexRow) };
        },
    };
}
const memberRankRow = {
    type: 'object',
    properties: {
        exchange: { type: 'string' },
        variety_code: { type: 'string' },
        contract_code: { type: 'string' },
        trade_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        trade_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        org_code: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        member_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        volume_rank: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        volume_lots: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        volume_change: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        long_rank: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        long_position: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        long_change: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        short_rank: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        short_position: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        short_change: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        net_long_rank: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        net_long_position: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        net_long_change: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        net_short_rank: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        net_short_position: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        net_short_change: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        long_increase_rank: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        long_decrease_rank: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        short_increase_rank: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        short_decrease_rank: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        settle_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        long_avg_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        short_avg_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
const MEMBER_RANK_DESCRIPTION = '按合约与会员维度获取**东方财富期货每日成交持仓排名**，一行是「一只合约 × 一家会员」。⛔ 这一族的写法坑本层已经替模型填平：实测上游 `exchange` **只认小写**、且广期所的真名是 `gfe`——`GFEX` 与 `gfex` 都回 **200 + 0 行、不报错**（实测同一个交易日 `gfe` 回 total=196、`gfex` 回 0），`variety_code` 同样大小写敏感（`AG` → 0 行、`ag` → total=100）。本层把六家常规写法换成上游那一套小写（GFEX → `gfe`）、品种转小写，`contract_code` 保持原样大写发（实测 `AG2610` 命中 20 行）。`trade_date` / `start_date` / `end_date` 都收（实测 `2026-10-15` 与 `20261015` 两种写法都回同一个 total=6911），行里的日期上游写作带横杠的 `2026-10-15`。⛔ **一定要带到合约级别的过滤**：实测不给任何日期 = 全表 1,435,879 行，给一个交易日 = 6,911 行，再加 `contract_code` = 20 行——只给日期的那次一次返回必然超闸（回 `too_large` + `profile_ref`，请转 `query_dataset` 收窄），什么都不给的那次翻页要两千多页。`size` 上限 **500**（实测 5000 → **响亮** 400「page_size must be between 1 and 500」）。⛔ **空串是这张表的常态而不是脏数据**：实测一个交易日 100 行里 `long_rank` / `long_position` 各 21 行为空串、空头那一组 25 行、净多与净空那一组 59~64 行；而且**排名列与它的数值列同时为空**（实测五对里 mismatch 0 对）——那读作"这一行没有这个口径"，不是"排名第 0"，本层一律转成 null、不补 0。身份：`org_code` 才是会员的稳定身份（实测广期所与中金所的中信期货同为 `10058975`），`member_name` 带后缀且不统一（中金所那行是「中信期货(代客)」、广期所那行是「中信期货」）⇒ 按名字跨所聚合会把同一家拆成两半。行里 `exchange` 与 `variety_code` 是**小写**，`contract_code` 的大小写随交易所（实测 cffex 给 `IC2610`、gfe 给 `lc2611`）⇒ ⛔ 别拿它直接 join `ftshare_futures_contracts`（那边是 `IC2610.CFE` 带后缀）。单位：`volume_lots` 是手（文档明写"成交量（手）"），持仓与变动那些列上游只对 volume 一列声明过单位，本层按同族惯例读作手但**不承诺换算**；`settle_price` / `long_avg_price` / `short_avg_price` 是合约报价单位。';
/** 东方财富期货持仓排名（`eastmoney-futures-position`）：⛔ 上游 exchange 只认小写且广期所写作 `gfe`。 */
function createFuturesMemberRankSource(client) {
    const capability = 'ftshare_futures_member_rank';
    const allowed = ['exchange', 'variety_code', 'contract_code', 'member_name_abbr', 'trade_date', 'start_date', 'end_date', 'page', 'size'];
    const path = '/api/v1/market/data/eastmoney-futures-position';
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_eastmoney_futures_position',
        source: 'http:ftshare.eastmoney_futures_position',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '东财期货会员成交持仓排名（按合约×会员）',
        description: MEMBER_RANK_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                exchange: { type: 'string', enum: [...FUTURES_EXCHANGES], description: '交易所（本层换成上游的小写写法，广期所 → gfe）' },
                variety_code: { type: 'string', description: '品种代码（大小写都收，本层转小写：实测大写会静默空）' },
                contract_code: { type: 'string', description: '合约代码（如 AG2610，不带交易所后缀），实测大写命中' },
                member_name_abbr: { type: 'string', description: '会员简称精确匹配（如 中信期货），实测生效' },
                trade_date: { type: 'string', description: '单日交易日 YYYY-MM-DD' },
                start_date: { type: 'string', description: '区间起始 YYYY-MM-DD' },
                end_date: { type: 'string', description: '区间截止 YYYY-MM-DD' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE_500 },
            },
            required: [], additionalProperties: false,
        },
        output_schema: output(memberRankRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE_500);
        const normalized = { page, size };
        if (params.exchange !== undefined) {
            const exchange = futuresExchange(params.exchange, FUTURES_EXCHANGES);
            normalized.exchange = EASTMONEY_FUTURES_EXCHANGE[exchange];
        }
        if (params.variety_code !== undefined)
            normalized.variety_code = String(params.variety_code).trim().toLowerCase();
        if (params.contract_code !== undefined)
            normalized.contract_code = String(params.contract_code).trim().toUpperCase();
        if (params.member_name_abbr !== undefined)
            normalized.member_name_abbr = String(params.member_name_abbr).trim();
        if (params.trade_date !== undefined)
            normalized.trade_date = date(params.trade_date, 'trade_date');
        if (params.start_date !== undefined)
            normalized.start_date = date(params.start_date, 'start_date');
        if (params.end_date !== undefined)
            normalized.end_date = date(params.end_date, 'end_date');
        if (normalized.start_date !== undefined && normalized.end_date !== undefined && String(normalized.start_date) > String(normalized.end_date))
            throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date');
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({
                exchange: params.exchange, variety_code: params.variety_code, contract_code: params.contract_code,
                member_name_abbr: params.member_name_abbr, trade_date: params.trade_date, start_date: params.start_date, end_date: params.end_date,
                page: params.page, page_size: params.size,
            }, ['exchange', 'variety_code', 'contract_code', 'member_name_abbr', 'trade_date', 'start_date', 'end_date', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson(path, search, signal));
            if (params.trade_date !== undefined)
                assertFiltered(rows, { field: 'trade_date', expected: String(params.trade_date), label: 'trade_date' });
            if (params.start_date !== undefined && params.end_date !== undefined)
                assertInRange(rows, String(params.start_date), String(params.end_date), (row) => row.trade_date);
            // 行里的小写列要跟**发出去的那个小写值**比；拿用户的写法比会把正确返回判成过滤没生效。
            if (params.exchange !== undefined)
                assertFiltered(rows, { field: 'exchange', expected: String(params.exchange), label: 'exchange' });
            if (params.variety_code !== undefined)
                assertFiltered(rows, { field: 'variety_code', expected: String(params.variety_code), label: 'variety_code' });
            if (params.contract_code !== undefined)
                assertFiltered(rows, { field: 'contract_code', expected: String(params.contract_code), label: 'contract_code' });
            if (params.member_name_abbr !== undefined)
                assertFiltered(rows, { field: 'member_name_abbr', expected: String(params.member_name_abbr), label: 'member_name_abbr' });
            const item = rows.map((row) => {
                const day = normalizeDateCell(row.trade_date);
                return {
                    exchange: String(row.exchange ?? ''), variety_code: String(row.variety_code ?? ''), contract_code: String(row.contract_code ?? ''),
                    trade_date: day.iso, trade_date_ms: day.ms,
                    org_code: textOrNull(row.org_code), member_name: textOrNull(row.member_name_abbr),
                    volume_rank: integerOrNull(row.volume_rank), volume_lots: integerOrNull(row.volume), volume_change: integerOrNull(row.volume_change),
                    long_rank: integerOrNull(row.lp_rank), long_position: integerOrNull(row.long_position), long_change: integerOrNull(row.lp_change),
                    short_rank: integerOrNull(row.sp_rank), short_position: integerOrNull(row.short_position), short_change: integerOrNull(row.sp_change),
                    net_long_rank: integerOrNull(row.nlp_rank), net_long_position: integerOrNull(row.net_long_position), net_long_change: integerOrNull(row.nlp_change),
                    net_short_rank: integerOrNull(row.nsp_rank), net_short_position: integerOrNull(row.net_short_position), net_short_change: integerOrNull(row.nsp_change),
                    long_increase_rank: integerOrNull(row.lp_up_rank), long_decrease_rank: integerOrNull(row.lp_down_rank),
                    short_increase_rank: integerOrNull(row.sp_up_rank), short_decrease_rank: integerOrNull(row.sp_down_rank),
                    settle_price: numberOrNull(row.settle_price), long_avg_price: numberOrNull(row.lp_avg_price), short_avg_price: numberOrNull(row.sp_avg_price),
                };
            });
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(memberRankRow) };
        },
    };
}
const bullionRow = {
    type: 'object',
    properties: {
        quote_date: { type: 'string' },
        quote_date_ms: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        price_value: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    },
    additionalProperties: false,
};
const BULLION_DESCRIPTION = '按日期区间获取**贵金属行情**（一行一个「日期 + 读数」）。`symbol` / `start_date` / `end_date` / `page` / `page_size` 五样都必须给（实测少 `page` → 400「缺少必填参数：page」，这一条文档与实测一致）。`size` 上限 **1000**（实测 1001 → **静默**夹到 1000 并回显 `pageSize: 1000`，超限不报错，所以只能在参数层拦）。⛔ **只有两个代码实测有数**：`AU9999` total=635、`XAUUSD` total=676（窗口 2024-01-01..2026-10-15）；`AG9999` / `XAGUSD` / `XAU` 都是 **200 + total=0、不报错**（文档自己也写"不支持的 symbol 不报错"）——拿到空分页是合法的"这一族没有这个标的"，不要换写法重试。⛔ **序列停在 2026 年 8 月中旬**：实测 AU9999 大窗首行（= 窗内最新一天）是 **2026-08-14**、XAUUSD 是 2026-08-12，而 2026-10-06..10-15 那一窗 total=0——按"最近一周"打永远是空，请从有数的区间取。返回按日期**降序**（实测第一页首行 2026-08-14、末行 2026-08-03），与 K 线那一族相反。⛔ **单位上游不披露，本层不承诺**：AU9999 末行读数 940.72、XAUUSD 末行 4408.32，两者差一个数量级（一个是国内金、一个是国际金价，量纲显然不同），所以只做**同 `symbol` 内**的时序与相对比较，禁止跨 symbol 比价、禁止换算成元/克或美元/盎司。`price_value` 上游以字符串给高精度数（本层转数值，空值转 null）；`quote_date` 上游已是 `YYYY-MM-DD`，本层补一条毫秒轴。';
/** 贵金属价格（`bullion/price`）：⛔ 单位未披露 + 序列停在 2026-08，两条都写进 description。 */
function createBullionPriceSource(client) {
    const capability = 'ftshare_bullion_price';
    const allowed = ['symbol', 'start_date', 'end_date', 'page', 'size'];
    const path = '/api/v1/market/data/bullion/price';
    const schema = {
        capability,
        time_contract: getDataTimeContract(capability),
        name: 'get_bullion_price',
        source: 'http:ftshare.bullion_price',
        data_key: buildDataKey('ftshare', 'http', capability),
        source_label: 'ftshare',
        paginated: true,
        rowShape: { rowKey: 'item' },
        summary: '贵金属价格（AU9999 / XAUUSD，单位未披露）',
        description: BULLION_DESCRIPTION,
        input_schema: {
            type: 'object',
            properties: {
                symbol: { type: 'string', description: '标的代码：实测只有 AU9999 与 XAUUSD 有数，其余静默空分页' },
                start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD（必填）' },
                end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD（必填）' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
            },
            required: ['symbol', 'start_date', 'end_date'], additionalProperties: false,
        },
        output_schema: output(bullionRow),
    };
    const normalize = (params) => {
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE);
        const normalized = { symbol: String(params.symbol ?? '').trim().toUpperCase(), start_date: date(params.start_date, 'start_date'), end_date: date(params.end_date, 'end_date'), page, size };
        if (normalized.symbol === '')
            throw new FtshareError('invalid_parameter', 'parameter symbol 不能为空（实测空值上游 400「缺少必填参数：证券代码」）');
        if (String(normalized.start_date) > String(normalized.end_date))
            throw new FtshareError('invalid_parameter', 'parameter start_date must not be later than end_date');
        return normalized;
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination),
        execute: async (request, signal) => {
            const params = normalize(request.params);
            const search = query({
                symbol: params.symbol,
                start_date: compactDate(String(params.start_date)), end_date: compactDate(String(params.end_date)),
                page: params.page, page_size: params.size,
            }, ['symbol', 'start_date', 'end_date', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson(path, search, signal));
            assertInRange(rows, String(params.start_date), String(params.end_date), (row) => row.date);
            const item = rows.map((row) => {
                const day = normalizeDateCell(row.date);
                return { quote_date: day.iso ?? String(row.date ?? ''), quote_date_ms: day.ms, price_value: numberOrNull(row.value) };
            });
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(bullionRow) };
        },
    };
}
export function createFtshareSources(resolveApiKey) {
    const client = createFtshareClient(resolveApiKey);
    return [
        createFlowSource({
            capability: 'ftshare_stock_daily_flow', name: 'get_ths_stock_daily_flow', upstreamApi: 'ths_stock_daily_flow',
            path: FLOW_PATHS.stock, row: dailyFlowRow, client,
            summary: '同花顺个股日度资金流（近 45 交易日，亿元）',
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
            summary: '同花顺行业板块日度资金流（近 45 交易日，亿元）',
            description: DAILY_FLOW_DESCRIPTION + INDUSTRY_FLOW_TAIL,
            allowed: ['start_date', 'end_date', 'board_name', 'page', 'size'],
            inputSchema: boardFlowInputSchema,
            mapRow: mapBoardFlowRow,
        }),
        createFlowSource({
            capability: 'ftshare_concept_daily_flow', name: 'get_ths_concept_daily_flow', upstreamApi: 'ths_concept_daily_flow',
            path: FLOW_PATHS.concept, row: boardFlowRow, client,
            summary: '同花顺概念板块日度资金流（近 45 交易日，亿元）',
            description: DAILY_FLOW_DESCRIPTION + CONCEPT_FLOW_TAIL,
            allowed: ['start_date', 'end_date', 'board_name', 'page', 'size'],
            inputSchema: boardFlowInputSchema,
            mapRow: mapBoardFlowRow,
        }),
        createMainCapitalSource(client),
        createQuoteSource(client),
        createBreadthSource(client),
        createKlineSnapshotSource(client),
        createPrevCloseSource(client),
        createCalendarSource(client),
        createBlockTradesSource(client),
        createDisclosureSource({
            capability: 'ftshare_performance_forecast', name: 'get_performance_forecasts_paginated', upstreamApi: 'performance_forecasts_paginated',
            path: '/api/v1/market/data/finance/stock-performance-forecast', row: forecastRow, mapRow: mapForecastRow, client,
            summary: 'A 股业绩预告（按报告期或单票，含北证）',
            description: FORECAST_DESCRIPTION,
        }),
        createDisclosureSource({
            capability: 'ftshare_performance_express', name: 'get_earnings_reports_paginated', upstreamApi: 'earnings_reports_paginated',
            path: '/api/v1/market/data/finance/stock-performance-express', row: expressRow, mapRow: mapExpressRow, client,
            summary: 'A 股业绩快报（按报告期或单票，含更正）',
            description: EXPRESS_DESCRIPTION,
        }),
        createSwOverviewSource(client),
        createSwMetricsSource(client),
        createLimitPriceSource(client),
        createDragonTigerSeatsSource(client),
        createHolderNumberSource(client),
        createIndexWeightSource(client),
        createCbKlineSource(client),
        createLprSource(client),
        createChinabondYieldSource(client),
        createRateSeriesSource({
            capability: 'ftshare_shibor', name: 'get_shibor_daily', upstreamApi: 'shibor_daily',
            path: '/api/v1/market/data/shibor-daily', client,
            summary: 'SHIBOR 日度八档（2006-10 起，百分数）',
            description: SHIBOR_DESCRIPTION,
            tenors: ['on_rate', 'w1', 'w2', 'm1', 'm3', 'm6', 'm9', 'y1'],
        }),
        createRateSeriesSource({
            capability: 'ftshare_hibor', name: 'get_hibor_daily', upstreamApi: 'hibor_daily',
            path: '/api/v1/market/data/hibor-daily', client,
            summary: 'HIBOR 日度十五档（七档实测整列 null）',
            description: HIBOR_DESCRIPTION,
            tenors: ['on_rate', 'w1', 'w2', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'],
        }),
        createFinancialCalendarSource(client),
        // 批次 F 的十颗（期货与贵金属）。`eastmoney_futures_strange`（龙虎榜）刻意不在这里：
        // 它一次回 12 个指标、三种载荷形状，落成行集需要 hub 支持"一行变多行"，不属于这一批。
        createFuturesContractsSource(client),
        createFuturesContractDetailSource(client),
        createFuturesKlineSource(client),
        createFuturesLimitPriceSource(client),
        createFuturesSettleSource(client),
        createWarrantSource(client),
        createFuturesWeeklySource(client),
        createNanhuaIndexKlineSource(client),
        createFuturesMemberRankSource(client),
        createBullionPriceSource(client),
    ];
}
/**
 * 盘中主力资金五档（同花顺口径）。这一条与日度那族**不是一回事**，不要合并成一颗能力：
 * 它的行是「某只票 × 某个 15 分钟切片」，单位是**元**、数值上游用字符串给，
 * 而且实测能翻到约 187 个交易日（日度那族只有 45 天）。⛔ `page_size` 的真实上限是 **500**：
 * 实测传 1000/2000 都只回 500 行且不报错（`pageSize` 回显 500），所以参数层直接拒超限。
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
        description: '按交易日与 15 分钟切片获取 A 股个股主力资金净额五档（超大单 / 大单 / 主力 / 中单 / 小单）。这是**盘中分时**口径，与那三条日度资金流不是同一件事：本能力一行是「一只票 × 一个切片」，日度那族一行是「一只票 × 一个交易日」。⛔ **单位是元**，两条加减法都用真报文核对过（实测同一行：超大单 153016124.85 + 大单 201583302.13 = 主力 354599426.98）：`net_inflow_main_yuan = 超大单 + 大单`，以及 `主力 + 中单 + 小单 = 0`——后者成立是因为净额本身带符号，所以**五档相加恒等于 0，不要把它当成「全市场净流入」**。上游把这些数值以**字符串**给出，本层转成 number，空值转 null 不补 0。日期：`date` 省略时取最新可用切片（实测 = 当日 15:30 那一次）；`date` 必须是交易日。时刻：`time` 只认 15 分钟栅格——实测非栅格的 `0935` 被上游 400 拒（「time minute must be 00, 15, 30, or 45」），非 HHMM 形状的（如 `100000`）拒「time format must be HHMM」；**午间 `time=1200` 返回 total=0 是休市、不是取数失败**（实测 `0930` 与 `1530` 都是 5214 行）。历史：实测可翻到约 187 个交易日（按真实交易日：T-185 = 2026-01-06 仍有 5178 行、**T-190 = 2025-12-26 起 total=0**）。⛔ 同样**不含北交所**（实测把单日 5214 行逐页取完，BJ 尾码 0 个）。ts_millis / trade_date / slice_time 由上游的**纳秒**戳换算为毫秒与上海时区历，纳秒原值不透出。排序不可参数化：实测上游默认按主力净额**从高到低**给出（首页 551,269,541.5 > 381,321,844.18 > 354,599,426.98 > …），所以「前 N 名」只能在**同一 `date` + `time`** 内读。⛔ 分页 `page` 实测生效（逐页首行不同、零重复），但 **`page_size` 的真实上限是 500 而且超限不报错**：实测 1000 与 2000 都只回 500 行（`pageSize` 回显 500、`pages` 回显 11）——本层因此把 `size` 锁在 1～500，全市场 5214 行需 11 页；`total` 与日度那族一样是**行数**口径。',
        input_schema: {
            type: 'object',
            properties: {
                date: { type: 'string', description: '交易日 YYYY-MM-DD；省略 = 最新可用切片' },
                time: { type: 'string', description: '15 分钟切片时刻，HHMM 或 HH:MM（如 1000、10:15、1530）' },
                page: { type: 'integer', minimum: 1 },
                size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE_500 },
            },
            required: [], additionalProperties: false,
        },
        output_schema: output(mainCapitalRow),
    };
    const normalize = (params) => {
        // ⛔ 上限押 500（不是那三族的 1000）：实测这一条对 page_size=1000 静默截成 500 行，超限不报错。
        const { page, size } = pageParams(params, allowed, MAX_PAGE_SIZE_500);
        const normalized = { page, size };
        if (params.date !== undefined)
            normalized.date = date(params.date, 'date');
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
            const search = query({ date: params.date === undefined ? undefined : compactDate(String(params.date)), time: params.time, page: params.page, page_size: params.size }, ['date', 'time', 'page', 'page_size']);
            const { rows, total } = readPaged(await client.getJson(FLOW_PATHS.mainCapital, search, signal));
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
            return { data: pagedEnvelope(item, total, Number(params.page), Number(params.size)), schema: output(mainCapitalRow) };
        },
    };
}
