/** 中证指数官网 csindex-home JSON：指数 PE(TTM) 日序列。官网 JSON 没有 PB/静态 PE/股息率，
 * 那些只在 oss-ch 的 {code}indicator.xls 里，本仓无 xls 解析依赖，所以这一能力只承诺 pe_ttm。 */
import { buildDataKey } from '../data-collector/hub.js';
import { getDataTimeContract } from '../time/tools.js';
import { createRequestThrottle } from '../net/throttle.js';
const PE_HISTORY_URL = 'https://www.csindex.com.cn/csindex-home/perf/indexCsiDsPe';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Upstream indexCode is case-sensitive: h30374 answers an empty list while H30374 has rows. */
const INDEX_CODE_PATTERN = /^(?:\d{6}|H\d{5})$/;
/** Daily series: a 1h cache only has to beat the publish cadence. */
const DAILY_CACHE_MS = 3_600_000;
const MAX_COUNT = 10_000;
const REQUEST_INTERVAL_MS = 500;
/** Upstream injects an anchor row at the requested start when it is not a published date; asking a
 * week earlier keeps that row out of our window (any positive lookback works). */
const START_LOOKBACK_DAYS = 7;
const throttle = createRequestThrottle(REQUEST_INTERVAL_MS);
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function sourceError(message, code = 'csindex_invalid_response') {
    const error = new Error(message);
    error.code = code;
    return error;
}
function assertKnown(params, allowed) {
    for (const key of Object.keys(params)) {
        if (!allowed.includes(key))
            throw new Error(`unsupported parameter: ${key} (allowed: ${allowed.join(', ')})`);
    }
}
function isCalendarDate(value) {
    if (!DATE_PATTERN.test(value))
        return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function parameterDate(value, name) {
    if (typeof value !== 'string' || !isCalendarDate(value.trim()))
        throw new Error(`parameter ${name} must be a valid YYYY-MM-DD date`);
    return value.trim();
}
/** Uppercase before the request: lowercase codes are a silent empty list upstream (measured). */
function parameterIndexCode(value) {
    if (typeof value !== 'string')
        throw new Error('parameter index_code must be a string');
    const code = value.trim().toUpperCase();
    if (!INDEX_CODE_PATTERN.test(code))
        throw new Error(`parameter index_code must be a 6-character CSI index code like 000300 or H30374, got ${JSON.stringify(value)}`);
    return code;
}
function normalizePeHistory(params) {
    if (!isRecord(params))
        throw new Error('params must be an object');
    assertKnown(params, ['index_code', 'start_date', 'end_date', 'count']);
    const index_code = parameterIndexCode(params.index_code);
    const start_date = parameterDate(params.start_date, 'start_date');
    const end_date = parameterDate(params.end_date, 'end_date');
    // Upstream answers an empty list for a reversed range; reject it as a parameter error instead.
    if (start_date > end_date)
        throw new Error('parameter start_date must not be later than end_date');
    if (params.count === undefined)
        return { index_code, start_date, end_date };
    if (typeof params.count !== 'number' || !Number.isSafeInteger(params.count) || params.count < 1 || params.count > MAX_COUNT) {
        throw new Error(`parameter count must be an integer from 1 to ${MAX_COUNT}`);
    }
    return { index_code, start_date, end_date, count: params.count };
}
async function getJson(url, signal, label) {
    signal.throwIfAborted();
    return throttle(async () => {
        let response;
        try {
            response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal });
        }
        catch (error) {
            if (error instanceof Error && error.name === 'AbortError')
                throw error;
            throw sourceError(`${label} request failed: ${error instanceof Error ? error.message : String(error)}`, 'csindex_http_error');
        }
        const text = await response.text();
        if (!response.ok)
            throw sourceError(`${label} returned HTTP ${response.status}`, 'csindex_http_error');
        try {
            return JSON.parse(text);
        }
        catch {
            throw sourceError(`${label} returned non-JSON: ${JSON.stringify(text.slice(0, 120))}`, 'csindex_invalid_response');
        }
    });
}
/** Upstream gives calendar dates as YYYYMMDD text in a weekday series (weekends absent). */
function upstreamDate(value, label) {
    if (typeof value !== 'string' || !/^\d{8}$/.test(value))
        throw sourceError(`${label} is not a YYYYMMDD date: ${JSON.stringify(String(value ?? ''))}`);
    const text = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    if (!isCalendarDate(text))
        throw sourceError(`${label} is not a valid date: ${value}`);
    return text;
}
function shiftDays(date, days) {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
const peHistoryRow = {
    type: 'object',
    properties: {
        index_code: { type: 'string', description: '6 位中证指数代码（H 开头的字母代码原样保留，如 H30374）' },
        index_name: { type: 'string', description: '指数中文简称（上游 indexName，如 沪深300）' },
        date: { type: 'string', description: '数据日期 YYYY-MM-DD（北京时间日期；上游按工作日发布，节假日未剔除）' },
        pe_ttm: { type: 'number', description: '滚动市盈率（倍），上游字段 peg；本能力不提供静态 PE / PB / 股息率' },
    },
    required: ['index_code', 'index_name', 'date', 'pe_ttm'],
    additionalProperties: false,
};
const peHistoryOutput = { type: 'array', items: peHistoryRow };
const peHistoryInput = {
    type: 'object',
    properties: {
        index_code: { type: 'string', description: '6 位中证指数代码，如 000300、000905、H30374；小写会自动转大写（上游区分大小写）' },
        start_date: { type: 'string', description: '起始日期 YYYY-MM-DD（闭区间）' },
        end_date: { type: 'string', description: '截止日期 YYYY-MM-DD（闭区间）' },
        count: { type: 'integer', minimum: 1, maximum: MAX_COUNT, description: '只保留区间内最近 N 行（本地截断，默认返回区间全部）' },
    },
    required: ['index_code', 'start_date', 'end_date'],
    additionalProperties: false,
};
function isPeHistoryRow(row) {
    return isRecord(row)
        && typeof row.index_code === 'string' && INDEX_CODE_PATTERN.test(row.index_code)
        && typeof row.index_name === 'string' && row.index_name.length > 0
        && typeof row.date === 'string' && isCalendarDate(row.date)
        && typeof row.pe_ttm === 'number' && Number.isFinite(row.pe_ttm);
}
async function executePeHistory(params, signal) {
    const indexCode = String(params.index_code);
    const startDate = String(params.start_date);
    const endDate = String(params.end_date);
    const url = new URL(PE_HISTORY_URL);
    url.searchParams.set('indexCode', indexCode);
    url.searchParams.set('startDate', shiftDays(startDate, -START_LOOKBACK_DAYS).replaceAll('-', ''));
    url.searchParams.set('endDate', endDate.replaceAll('-', ''));
    const label = `CSIndex index PE ${indexCode}`;
    const payload = await getJson(url.toString(), signal, label);
    if (!isRecord(payload))
        throw sourceError(`${label} response is not an object`);
    // Missing indexCode answers HTTP 200 with code 500 and data null; keep that a failure, not an empty series.
    if (payload.success !== true || String(payload.code ?? '') !== '200') {
        throw sourceError(`${label} failed: ${String(payload.msg ?? 'unknown upstream error')} (code ${String(payload.code ?? 'unknown')})`, 'csindex_upstream_error');
    }
    if (!Array.isArray(payload.data))
        throw sourceError(`${label} response lost the data array`);
    const rows = [];
    const seen = new Map();
    let indexName;
    for (const record of payload.data) {
        if (!isRecord(record))
            throw sourceError(`${label} contains a non-object row`);
        const date = upstreamDate(record.tradeDate, `${label} tradeDate`);
        // The lookback window answers real rows before start_date too; only the requested window is output.
        if (date < startDate)
            continue;
        // A row past end_date means the upstream range filter was dropped; refuse instead of quietly widening.
        if (date > endDate)
            throw sourceError(`${label} returned ${date} outside the requested ${startDate}..${endDate}`);
        const name = typeof record.indexName === 'string' ? record.indexName.trim() : '';
        if (name.length === 0)
            throw sourceError(`${label} ${date} has an empty indexName`);
        if (indexName === undefined)
            indexName = name;
        else if (name !== indexName)
            throw sourceError(`${label} mixed index names ${JSON.stringify(indexName)} and ${JSON.stringify(name)} in one response`);
        const pe = record.peg;
        if (typeof pe !== 'number' || !Number.isFinite(pe))
            throw sourceError(`${label} ${date} has a non-numeric peg: ${JSON.stringify(String(pe ?? ''))}`);
        // Same (date, index_code) twice is deduplicated; a second value for one key is a shape change.
        const key = `${date}|${indexCode}`;
        const previous = seen.get(key);
        if (previous !== undefined) {
            if (previous !== pe)
                throw sourceError(`${label} repeats ${date} with conflicting peg ${previous} vs ${pe}`);
            continue;
        }
        seen.set(key, pe);
        rows.push({ index_code: indexCode, index_name: name, date, pe_ttm: pe });
    }
    rows.sort((left, right) => String(left.date).localeCompare(String(right.date)));
    const limited = typeof params.count === 'number' ? rows.slice(-params.count) : rows;
    return { data: limited, schema: peHistoryOutput };
}
function createSource(options) {
    const schema = {
        capability: options.capability,
        time_contract: getDataTimeContract(options.capability),
        name: options.name,
        source: `http:csindex.${options.capability}`,
        data_key: buildDataKey('csindex', 'http', options.capability),
        source_label: 'csindex',
        paginated: false,
        cacheMaxAgeMs: DAILY_CACHE_MS,
        rowShape: { rootArray: true },
        summary: options.summary,
        description: options.description,
        input_schema: options.inputSchema,
        output_schema: options.outputSchema,
    };
    const normalize = (params) => {
        if (!isRecord(params))
            throw new Error('params must be an object');
        return options.normalize(params);
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: options.validateOutput,
        execute: async (request, signal) => options.execute(normalize(request.params), signal),
    };
}
export function createCsindexSources() {
    return [
        createSource({
            capability: 'csindex_index_valuation',
            name: 'get_csindex_index_valuation',
            summary: '中证指数滚动市盈率 PE(TTM) 日序列（官网 JSON）',
            description: '按指数代码与日期区间获取中证指数官网发布的**指数滚动市盈率（PE TTM）日序列**（csindex-home indexCsiDsPe JSON，零 key）。一行一个 (指数, 日期)，date 升序；响应无分页，单次可一次取满全历史（实测 2011→2026 共 3824 行 / 324 KB，未观察到区间长度上限），只要少量就用 count 或窄区间。实测覆盖中证/上证系列（2026-11-22 复核）：000300 从 2011-06-28 起 3824 行、000905 从 2011-06-28 起 3822 行、H30374 从 2015-05-12 起 3006 行、932000 从 2023-06-13 起、000001 上证指数同源；非中证指数（如创业板指 399006）返回空数组。⛔ **本能力只提供 pe_ttm，不提供 PB、不提供静态市盈率、不提供股息率**：官网 JSON 只有滚动 PE 一列（上游字段名 peg，与官网「指数估值」页 PE(TTM) 同列；实测 2026-11-20 沪深300 = 13.09，与官网数据服务页一致）；静态 PE 与股息率只存在于 oss-ch 的 {code}indicator.xls（P/E1、P/E2、D/P1、D/P2），本仓没有 xls 解析依赖，别把 pe_ttm 当 PB 或股息率用。时间轴：date 是上游按**工作日**发布的日期（实测全序列周末 0 行、节假日不剔除——2026-10-01/02、10-05..07 都有值，2026-01-01/02 也有值），不是交易所交易日历，不要拿它当交易日或用来校准交易日。⛔ 上游**请求起点补行**：startDate 不是发布日时会在该日期补一行（值复制其后第一行，实测 startDate=2026-11-14 周六补出 13.05）；本层把请求起点前移 7 天再按 [start_date, end_date] 闭区间本地裁剪，输出里不会出现补出来的周末/虚构行。新鲜度：实测 2026-11-22（周日）查询主流指数最新到 2026-11-20（周五）；**不同指数更新不同步**——实测 H30374 最新只到 2026-11-19，比 000300 晚一个工作日，跨指数同日比较前先对齐到共同日期；更新发生在收盘后（本轮未在交易日盘中复核具体时刻），盘中不要期待当日数据，按 1 小时缓存。空数组 = 区间内没有数据（未来日期/未覆盖指数/区间无发布行），是合法空结果不是取数失败，不要重试；上游 code 非 200 或 HTTP 非 200 才是失败。参数：index_code 必填（6 位数字或 H+5 位数字；上游 indexCode **区分大小写**，实测小写 h30374 直接回空数组，本层先转大写）；start_date/end_date 必填，闭区间 YYYY-MM-DD，区间写反在参数层拒绝（上游对写反的区间回空数组）；count 可选，只保留区间内最近 N 行（本地截断，不改变服务端请求）。⛔ (date, index_code) 已去重；同一主键出现不同 pe_ttm 判上游结构异常并响亮失败，不静默取一个。pe_ttm 是倍数原值，未四舍五入；Dataset 的 captured_at 才是采集时刻。',
            inputSchema: peHistoryInput,
            outputSchema: peHistoryOutput,
            allowed: ['index_code', 'start_date', 'end_date', 'count'],
            normalize: normalizePeHistory,
            validateOutput: (data) => Array.isArray(data) && data.every(isPeHistoryRow),
            execute: executePeHistory,
        }),
    ];
}
