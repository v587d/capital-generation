/** Official venue HTTP sources: SSE/SZSE ETF shares and CFETS repo fixings. One throttle chain per
 * upstream; row keys are remapped explicitly (§10.6) and 万份 is converted to 份 at this boundary. */
import { buildDataKey } from '../data-collector/hub.js';
import { getDataTimeContract } from '../time/tools.js';
import { createRequestThrottle } from '../net/throttle.js';
const SSE_QUERY_URL = 'https://query.sse.com.cn/commonQuery.do';
const SSE_ETF_SHARES_SQL_ID = 'COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L';
const SZSE_REPORT_URL = 'https://fund.szse.cn/api/report/ShowReport/data';
const CHINAMONEY_CSV_URL = 'https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/currency';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Every upstream here republishes once per trading day, so 1h staleness is below the cadence. */
const DAILY_CACHE_MS = 3_600_000;
// One chain per upstream: the two exchanges and CFETS have independent rate limits, and SZSE needs
// ~39 sequential page fetches per call.
const sseThrottle = createRequestThrottle(300);
const szseThrottle = createRequestThrottle(300);
const chinamoneyThrottle = createRequestThrottle(500);
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function sourceError(message, code = 'official_invalid_response') {
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
function upstreamDate(value, label) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!isCalendarDate(text))
        throw sourceError(`${label} is not a YYYY-MM-DD date: ${JSON.stringify(String(value ?? ''))}`, 'official_invalid_response');
    return text;
}
function textOrNull(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length === 0 ? null : text;
}
function requiredText(value, label) {
    const text = textOrNull(value);
    if (text === null)
        throw sourceError(`${label} is empty`, 'official_invalid_response');
    return text;
}
/**
 * Upstream reports 万份 with at most two decimals; convert through strings because
 * `5518488.77 * 1e4 === 55184887699.99999` in binary floating point.
 */
function sharesFromWan(value, label) {
    const raw = String(value ?? '').trim().replaceAll(',', '');
    const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(raw);
    if (match === null)
        throw sourceError(`${label} is not a non-negative 万份 value: ${JSON.stringify(String(value ?? ''))}`, 'official_invalid_response');
    const shares = Number(match[1] + (match[2] ?? '').padEnd(4, '0'));
    if (!Number.isSafeInteger(shares))
        throw sourceError(`${label} ${raw} 万份 exceeds the exact integer range`, 'official_invalid_response');
    return shares;
}
/** Blank cells are never a fixing result (measured 748/748 FR and 249/249 FDR are non-empty). */
function percentFromCsv(value, label) {
    const raw = String(value ?? '').trim();
    const parsed = /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isFinite(parsed))
        throw sourceError(`${label} is not a numeric percent value: ${JSON.stringify(raw)}`, 'official_invalid_response');
    return parsed;
}
function parseJson(text, label) {
    try {
        return JSON.parse(text);
    }
    catch {
        throw sourceError(`${label} returned non-JSON: ${JSON.stringify(text.slice(0, 120))}`, 'official_invalid_response');
    }
}
async function requestText(throttle, url, signal, referer, label) {
    signal.throwIfAborted();
    return throttle(async () => {
        let response;
        try {
            response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: referer }, signal });
        }
        catch (error) {
            if (error instanceof Error && error.name === 'AbortError')
                throw error;
            throw sourceError(`${label} request failed: ${error instanceof Error ? error.message : String(error)}`, 'official_http_error');
        }
        const text = await response.text();
        if (!response.ok)
            throw sourceError(`${label} returned HTTP ${response.status}`, 'official_http_error');
        return text;
    });
}
const tradeDateInput = (description) => ({
    type: 'object',
    properties: { trade_date: { type: 'string', description } },
    required: [],
    additionalProperties: false,
});
const nullableNumber = (description) => ({ oneOf: [{ type: 'number' }, { type: 'null' }], ...(description === undefined ? {} : { description }) });
const nullableString = (description) => ({ oneOf: [{ type: 'string' }, { type: 'null' }], ...(description === undefined ? {} : { description }) });
const sseEtfSharesOutput = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            trade_date: { type: 'string', description: '上交所披露的交易日（北京时间日期），不是抓取时刻' },
            fund_code: { type: 'string', description: '6 位基金代码' },
            fund_name: { type: 'string', description: '基金简称（上游原文）' },
            shares: { type: 'number', description: '份额（份）= 上游 TOT_VOL（万份）× 10000' },
            etf_type: nullableString('上交所分类：单市/跨市/跨境/其他；⛔ 与深交所 fund_category 口径不同，不要并成一列'),
        },
        required: ['trade_date', 'fund_code', 'fund_name', 'shares', 'etf_type'],
        additionalProperties: true,
    },
};
const szseEtfSharesOutput = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            trade_date: { type: 'string', description: '快照数据日期（北京时间日期），即响应 metadata.subname；深市只有最新一天' },
            fund_code: { type: 'string', description: '6 位基金代码' },
            fund_name: { type: 'string', description: '基金简称（从内嵌 HTML 的 <u>…</u> 提取）' },
            shares: { type: 'number', description: '份额（份）= 上游 dqgm（万份，带千分位逗号）× 10000' },
            fund_category: nullableString('深交所投资类别：股票基金/债券基金/货币市场基金/其它基金；⛔ 与上交所 etf_type 口径不同'),
            manager: nullableString('基金管理人全称'),
            listing_date: nullableString('上市日期 YYYY-MM-DD'),
        },
        required: ['trade_date', 'fund_code', 'fund_name', 'shares', 'fund_category', 'manager', 'listing_date'],
        additionalProperties: true,
    },
};
const repoFixingOutput = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            date: { type: 'string', description: '定盘日 YYYY-MM-DD（北京时间日期）' },
            fr001: nullableNumber('FR001 隔夜，百分数原值（1.37 表示 1.37%）'),
            fr007: nullableNumber('FR007 7 天，百分数原值'),
            fr014: nullableNumber('FR014 14 天，百分数原值'),
            fdr001: nullableNumber('FDR001 隔夜，百分数原值；2025-11-20 之前为 null（不是 0）'),
            fdr007: nullableNumber('FDR007 7 天，百分数原值；2025-11-20 之前为 null（不是 0）'),
            fdr014: nullableNumber('FDR014 14 天，百分数原值；2025-11-20 之前为 null（不是 0）'),
        },
        required: ['date', 'fr001', 'fr007', 'fr014', 'fdr001', 'fdr007', 'fdr014'],
        additionalProperties: true,
    },
};
const isSseEtfSharesRow = (row) => isRecord(row)
    && typeof row.trade_date === 'string' && isCalendarDate(row.trade_date)
    && typeof row.fund_code === 'string' && /^\d{6}$/.test(row.fund_code)
    && typeof row.fund_name === 'string' && row.fund_name.length > 0
    && Number.isSafeInteger(row.shares) && Number(row.shares) >= 0;
const isSzseEtfSharesRow = (row) => isSseEtfSharesRow(row)
    && row.fund_category !== undefined
    && row.manager !== undefined
    && row.listing_date !== undefined;
const isFixingValue = (value) => value === null || (typeof value === 'number' && Number.isFinite(value));
const isRepoFixingRow = (row) => isRecord(row)
    && typeof row.date === 'string' && isCalendarDate(row.date)
    && ['fr001', 'fr007', 'fr014', 'fdr001', 'fdr007', 'fdr014'].every((key) => isFixingValue(row[key]));
function normalizeSseEtfShares(params) {
    if (!isRecord(params))
        throw new Error('params must be an object');
    assertKnown(params, ['trade_date']);
    // Omitted trade_date means "the latest published day": measured 2026-11-22 (Sun) -> 2026-11-20.
    return params.trade_date === undefined ? {} : { trade_date: parameterDate(params.trade_date, 'trade_date') };
}
function normalizeSzseEtfShares(params) {
    if (!isRecord(params))
        throw new Error('params must be an object');
    assertKnown(params, ['trade_date']);
    return params.trade_date === undefined ? {} : { trade_date: parameterDate(params.trade_date, 'trade_date') };
}
function normalizeRepoFixing(params) {
    if (!isRecord(params))
        throw new Error('params must be an object');
    assertKnown(params, ['start_date', 'end_date']);
    const start = params.start_date === undefined ? undefined : parameterDate(params.start_date, 'start_date');
    const end = params.end_date === undefined ? undefined : parameterDate(params.end_date, 'end_date');
    if (start !== undefined && end !== undefined && start > end)
        throw new Error('parameter start_date must not be later than end_date');
    return { ...(start === undefined ? {} : { start_date: start }), ...(end === undefined ? {} : { end_date: end }) };
}
async function executeSseEtfShares(params, signal) {
    const requested = typeof params.trade_date === 'string' ? params.trade_date : undefined;
    const query = new URLSearchParams({
        sqlId: SSE_ETF_SHARES_SQL_ID,
        // Not optional: without isPagination=true the endpoint answers total=0 and no rows (measured).
        isPagination: 'true',
        'pageHelp.pageSize': '10000',
        'pageHelp.pageNo': '1',
        'pageHelp.beginPage': '1',
        'pageHelp.cacheSize': '1',
        'pageHelp.endPage': '1',
    });
    if (requested !== undefined)
        query.set('STAT_DATE', requested);
    const payload = parseJson(await requestText(sseThrottle, `${SSE_QUERY_URL}?${query.toString()}`, signal, 'https://www.sse.com.cn/', 'SSE ETF shares'), 'SSE ETF shares');
    if (!isRecord(payload) || !isRecord(payload.pageHelp))
        throw sourceError('SSE ETF shares response lost pageHelp', 'official_invalid_response');
    const pageHelp = payload.pageHelp;
    const total = pageHelp.total;
    if (!Number.isSafeInteger(total) || Number(total) < 0)
        throw sourceError(`SSE ETF shares pageHelp.total is not a count: ${JSON.stringify(total)}`, 'official_invalid_response');
    const listed = Array.isArray(pageHelp.data) ? pageHelp.data : Array.isArray(payload.result) ? payload.result : [];
    // pageSize is capped at 2000 and pageHelp.pageNo is ignored (measured: pageNo=2 re-serves page 1),
    // so a day larger than one page cannot be paged — refuse the partial snapshot instead of shrinking it.
    if (listed.length !== total)
        throw sourceError(`SSE ETF shares returned ${listed.length} rows but pageHelp.total=${String(total)}; one page is not the whole snapshot`, 'official_incomplete');
    if (listed.length === 0) {
        // A non-trading day / future date / unpublished day is a real answer only when it was asked for.
        if (requested === undefined)
            throw sourceError('SSE ETF shares latest-snapshot query returned 0 rows; the no-date form always resolves to a published day', 'official_empty_response');
        return { data: [], schema: sseEtfSharesOutput };
    }
    const rows = [];
    const seen = new Set();
    let snapshotDate;
    for (const record of listed) {
        if (!isRecord(record))
            throw sourceError('SSE ETF shares row is not an object', 'official_invalid_response');
        const tradeDate = upstreamDate(record.STAT_DATE, 'SSE STAT_DATE');
        snapshotDate ??= tradeDate;
        if (tradeDate !== snapshotDate)
            throw sourceError(`SSE ETF shares mixed ${snapshotDate} and ${tradeDate} in one snapshot`, 'official_invalid_response');
        if (requested !== undefined && tradeDate !== requested)
            throw sourceError(`SSE returned ${tradeDate} for requested ${requested}`, 'official_invalid_response');
        const fundCode = requiredText(record.SEC_CODE, 'SSE SEC_CODE');
        if (!/^\d{6}$/.test(fundCode))
            throw sourceError(`SSE SEC_CODE is not a six-digit fund code: ${JSON.stringify(fundCode)}`, 'official_invalid_response');
        if (seen.has(fundCode))
            throw sourceError(`SSE ETF shares repeats ${fundCode}; a duplicated code is not a complete snapshot`, 'official_invalid_response');
        seen.add(fundCode);
        rows.push({
            trade_date: tradeDate,
            fund_code: fundCode,
            fund_name: requiredText(record.SEC_NAME, `SSE SEC_NAME ${fundCode}`),
            shares: sharesFromWan(record.TOT_VOL, `SSE TOT_VOL ${fundCode}`),
            etf_type: textOrNull(record.ETF_TYPE),
        });
    }
    return { data: rows, schema: sseEtfSharesOutput };
}
async function szsePage(pageNo, signal) {
    const query = new URLSearchParams({ SHOWTYPE: 'JSON', CATALOGID: '1000_lf', TABKEY: 'tab1', selectJjlb: 'ETF', PAGENO: String(pageNo) });
    const label = `SZSE fund list page ${pageNo}`;
    const payload = parseJson(await requestText(szseThrottle, `${SZSE_REPORT_URL}?${query.toString()}`, signal, 'https://fund.szse.cn/', label), label);
    if (!Array.isArray(payload))
        throw sourceError(`${label} is not an array of tables`, 'official_invalid_response');
    // The report error sits on the table, not in metadata: an unknown CATALOGID answers one table with
    // metadata.tabkey=null and error="noalert@显示报表数据失败" (measured).
    const tables = payload.filter((entry) => isRecord(entry));
    for (const entry of tables) {
        const message = textOrNull(entry.error);
        if (message !== null)
            throw sourceError(`${label} reported ${JSON.stringify(message)}`, 'official_invalid_response');
    }
    const table = tables.find((entry) => isRecord(entry.metadata) && entry.metadata.tabkey === 'tab1');
    if (table === undefined || !isRecord(table.metadata) || !Array.isArray(table.data))
        throw sourceError(`${label} lost its tab1 metadata/data`, 'official_invalid_response');
    return { metadata: table.metadata, rows: table.data };
}
function szseCount(value, label) {
    if (!Number.isSafeInteger(value) || Number(value) < 0)
        throw sourceError(`SZSE metadata.${label} is not a count: ${JSON.stringify(value)}`, 'official_invalid_response');
    return Number(value);
}
function embeddedTagText(value, label, pattern) {
    const match = pattern.exec(String(value ?? ''));
    if (match === null)
        throw sourceError(`SZSE fund list ${label} HTML shape changed: ${JSON.stringify(String(value ?? '').slice(0, 80))}`, 'official_invalid_response');
    return match[1].trim();
}
async function executeSzseEtfShares(params, signal) {
    const requested = typeof params.trade_date === 'string' ? params.trade_date : undefined;
    const first = await szsePage(1, signal);
    const snapshotDate = upstreamDate(first.metadata.subname, 'SZSE metadata.subname');
    if (requested !== undefined && requested !== snapshotDate) {
        throw sourceError(`SZSE publishes only the latest snapshot (${snapshotDate}), not ${requested}; Shenzhen ETF shares have no history, omit trade_date to take the current snapshot`, 'official_snapshot_mismatch');
    }
    const pageCount = szseCount(first.metadata.pagecount, 'pagecount');
    const recordCount = szseCount(first.metadata.recordcount, 'recordcount');
    if (pageCount < 1 || recordCount < 1)
        throw sourceError(`SZSE fund list reports pagecount=${pageCount} recordcount=${recordCount}`, 'official_invalid_response');
    if (first.rows.length === 0)
        throw sourceError('SZSE fund list page 1 is empty while recordcount>0', 'official_incomplete');
    const listed = [...first.rows];
    for (let pageNo = 2; pageNo <= pageCount; pageNo += 1) {
        const page = await szsePage(pageNo, signal);
        // The report is re-rendered live; a mid-run date or count change means two snapshots were stitched.
        if (page.metadata.subname !== first.metadata.subname || szseCount(page.metadata.pagecount, 'pagecount') !== pageCount || szseCount(page.metadata.recordcount, 'recordcount') !== recordCount) {
            throw sourceError(`SZSE fund list snapshot changed while paging (${String(first.metadata.subname)} -> ${String(page.metadata.subname)}); retry the request`, 'official_incomplete');
        }
        if (page.rows.length === 0)
            throw sourceError(`SZSE fund list page ${pageNo}/${pageCount} is empty`, 'official_incomplete');
        listed.push(...page.rows);
    }
    if (listed.length !== recordCount)
        throw sourceError(`SZSE fund list returned ${listed.length} rows but recordcount=${recordCount}`, 'official_incomplete');
    const rows = [];
    const seen = new Set();
    for (const record of listed) {
        if (!isRecord(record))
            throw sourceError('SZSE fund list row is not an object', 'official_invalid_response');
        // selectJjlb=ETF is ours; if it stops filtering, this table silently becomes every fund (measured 1088 rows).
        if (record.jjlb !== 'ETF')
            throw sourceError(`SZSE fund list returned jjlb=${JSON.stringify(record.jjlb)}; the ETF filter is no longer applied`, 'official_invalid_response');
        const fundCode = embeddedTagText(record.sys_key, 'sys_key', /<u>(\d{6})<\/u>/);
        if (seen.has(fundCode))
            throw sourceError(`SZSE fund list repeats ${fundCode}; a duplicated code is not a complete snapshot`, 'official_invalid_response');
        seen.add(fundCode);
        const listingDate = textOrNull(record.ssrq);
        rows.push({
            trade_date: snapshotDate,
            fund_code: fundCode,
            fund_name: embeddedTagText(record.jjjcurl, 'jjjcurl', /<u>([^<]*)<\/u>/),
            shares: sharesFromWan(embeddedTagText(record.dqgm, 'dqgm', /<a[^>]*>([^<]*)<\/a>/), `SZSE dqgm ${fundCode}`),
            fund_category: textOrNull(record.tzlb),
            manager: textOrNull(record.glrmc),
            listing_date: listingDate === null ? null : upstreamDate(listingDate, `SZSE listing date ${fundCode}`),
        });
    }
    return { data: rows, schema: szseEtfSharesOutput };
}
function parseFixingCsv(text, kind) {
    const byDate = new Map();
    for (const line of text.split(/\r?\n/)) {
        if (line.trim().length === 0)
            continue;
        const cells = line.split(',');
        // Fixed layout `date,,,,,,001,007,014`. The five middle cells are always empty upstream; any
        // other shape means the column order moved and these positions would mislabel the tenors.
        if (cells.length !== 9 || cells.slice(1, 6).some((cell) => cell.trim().length !== 0)) {
            throw sourceError(`CFETS ${kind} CSV layout changed: ${JSON.stringify(line.slice(0, 60))}`, 'official_invalid_response');
        }
        const date = upstreamDate(cells[0], `CFETS ${kind} CSV date`);
        if (byDate.has(date))
            throw sourceError(`CFETS ${kind} CSV repeats ${date}`, 'official_invalid_response');
        byDate.set(date, [
            percentFromCsv(cells[6], `CFETS ${kind}001 ${date}`),
            percentFromCsv(cells[7], `CFETS ${kind}007 ${date}`),
            percentFromCsv(cells[8], `CFETS ${kind}014 ${date}`),
        ]);
    }
    if (byDate.size === 0)
        throw sourceError(`CFETS ${kind} CSV returned no rows`, 'official_empty_response');
    return byDate;
}
async function fetchFixingCsv(file, kind, signal) {
    // Encoding is UTF-8 (pure ASCII in practice, CRLF, no BOM); GBK would be a wrong guess, so only a
    // defensive BOM strip is applied.
    const text = await requestText(chinamoneyThrottle, `${CHINAMONEY_CSV_URL}/${file}-chrt.csv`, signal, 'https://www.chinamoney.com.cn/chinese/bkfrr/', `CFETS ${kind} CSV`);
    return parseFixingCsv(text.replace(/^\uFEFF/, ''), kind);
}
async function executeRepoFixing(params, signal) {
    const start = typeof params.start_date === 'string' ? params.start_date : undefined;
    const end = typeof params.end_date === 'string' ? params.end_date : undefined;
    const fr = await fetchFixingCsv('frr', 'FR', signal);
    const fdr = await fetchFixingCsv('fdr', 'FDR', signal);
    const dates = [...new Set([...fr.keys(), ...fdr.keys()])].sort();
    const rows = [];
    for (const date of dates) {
        // Local crop: the endpoint ignores startDate/endDate (measured) and only ever serves the full file.
        if (start !== undefined && date < start)
            continue;
        if (end !== undefined && date > end)
            continue;
        const a = fr.get(date);
        const b = fdr.get(date);
        rows.push({
            date,
            fr001: a?.[0] ?? null,
            fr007: a?.[1] ?? null,
            fr014: a?.[2] ?? null,
            // FDR starts 2025-11-20; older days have no FDR fixing at all, which is null, never 0.
            fdr001: b?.[0] ?? null,
            fdr007: b?.[1] ?? null,
            fdr014: b?.[2] ?? null,
        });
    }
    return { data: rows, schema: repoFixingOutput };
}
function createSource(options) {
    const schema = {
        capability: options.capability,
        time_contract: getDataTimeContract(options.capability),
        name: options.name,
        source: `http:official.${options.capability}`,
        data_key: buildDataKey('official', 'http', options.capability),
        source_label: 'official',
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
        return options.normalize(params);
    };
    return {
        schema,
        normalizeParams: normalize,
        validateOutput: options.validateOutput,
        execute: async (request, signal) => options.execute(normalize(request.params), signal),
    };
}
export function createOfficialSources() {
    return [
        createSource({
            capability: 'sse_etf_shares',
            cacheMaxAgeMs: DAILY_CACHE_MS,
            name: 'get_sse_etf_shares',
            summary: '上交所 ETF 份额（按日归档，可查历史）',
            description: '获取上交所 ETF 份额（官方「ETF 规模信息披露」按日归档，query.sse.com.cn/commonQuery.do）。一行一只 ETF。`trade_date` 可选：**省略时返回最近已发布的交易日快照**（实测 2026-11-22 周日取到 2026-11-20 周五 927 行）——默认不是「今天」，回答「今天」要用行内的 trade_date 核对；传 YYYY-MM-DD 取该日（实测 2023-01-03 有 446 行、2012-01-04 有 23 行；2011-12-01 及更早为 0 行，归档起点在 2012 年初）。⛔ `shares` 单位是**份**：上游 TOT_VOL 是**万份**，本层用字符串换算 ×10000 换成份（浮点乘法会出错：5518488.77×1e4 在 float64 里是 55184887699.99999）。单位对账实测（2026-11-20 收盘）：510300 上游 5518488.77 万份 → 55,184,887,700 份，× 收盘价 4.018 = 2217.4 亿元，与腾讯同日总市值 2217.33 亿元比值 0.999999；510500（0.999999）、513100（0.999994）、510050、588000 同样逐票对上——⛔ 别再把这列当份的原始值乘净值、也别当亿份。⛔ **非交易日 / 未来日期 / 尚未发布返回成功空数组**（实测 2026-11-21 周六、2026-12-01、2011-12-01 都是 HTTP 200 + total=0 + 空 data），空不是失败、不要重试；但**省略 trade_date（latest 模式）回 0 行按上游异常响亮失败**（无日期查询总能解析到一个已发布日）。`etf_type` 是上交所自己的分类（实测单市/跨市/跨境/其他）；⛔ 深交所的 fund_category 是另一套口径，不要并成一列。时区：trade_date 是上海交易所交易日（北京时间日期），不是抓取时刻。分页：本层内部一次取满——上游 pageSize 硬上限 2000 且 pageHelp.pageNo 被忽略（实测 pageSize=100 仍回 500 行、pageNo=2 仍回第一页），所以按 pageHelp.total 核对行数，行数 < total 即快照被截断并响亮失败，绝不返回不完整快照；同日代码重复同样失败。未收录：上游 NUM（当日序号，无分析价值）、净值与规模列（上游不提供，别用别的来源冒充）、份额变化列（要变化请取两个交易日自行相减，本能力支持历史日期）。',
            inputSchema: tradeDateInput('交易日 YYYY-MM-DD（北京时间）；省略则取最近已发布交易日'),
            outputSchema: sseEtfSharesOutput,
            allowed: ['trade_date'],
            normalize: normalizeSseEtfShares,
            validateOutput: (data) => Array.isArray(data) && data.every(isSseEtfSharesRow),
            execute: executeSseEtfShares,
        }),
        createSource({
            capability: 'szse_etf_shares',
            cacheMaxAgeMs: DAILY_CACHE_MS,
            name: 'get_szse_etf_shares',
            summary: '深交所 ETF 份额（仅最新一天快照）',
            description: '获取深交所 ETF 份额（官方「基金列表」，fund.szse.cn ShowReport，CATALOGID=1000_lf / TABKEY=tab1 / selectJjlb=ETF）。⛔ **只有最新一天，没有历史**：端点不接受任何日期参数（实测 tradeDate/date 被忽略），快照日期由响应 metadata.subname 给出（实测 2026-11-22 周日快照 = 2026-11-20，772 只）。`trade_date` 可选：省略 = 取当前快照并用行内 trade_date 标明是哪天；**给出时必须等于快照日期**，否则响亮失败（不拿最新快照冒充历史；深市要历史只能自己按日留存）。⛔ `shares` 单位是**份**：上游 dqgm 是**万份**且带千分位逗号（如 2,156,781.66），本层去逗号后用字符串 ×10000。单位对账实测：159919 的 2026-11-20 份额 21,567,816,600 份 × 收盘价 4.191 = 903.9 亿元，而腾讯同日总市值 678.39 亿 ÷ 4.191 = 161.87 亿份 = **前一交易日（11-19）的 1,618,671.66 万份**——腾讯总市值列用的是滞后一天的份额（该 ETF 当日有大额申购，份额 161.87 亿 → 215.68 亿），⛔ 不要反过来判定本表错。解析：sys_key / jjjcurl / dqgm 三列是**内嵌 HTML 片段**，本层从 `<u>…</u>` 取代码与简称、从 `<a>…</a>` 取规模（实测 772/772 行三处都能取到、代码唯一、无 HTML 实体）；结构不符即响亮失败，不静默丢行。`fund_category` 是深交所投资类别（实测股票基金 702 / 其它基金 48 / 债券基金 19 / 货币市场基金 3），`manager` 管理人全称，`listing_date` 上市日期。分页：上游每页固定 20 条（PAGESIZE/pageSize 实测无效），772 只需 39 页，本层翻满并核对行数 = metadata.recordcount；翻页途中快照日期或总数变化、某页为空、行数不符、`jjlb` 不再是 ETF（过滤失效会混进 LOF/封闭式，实测不过滤是 1088 行）一律响亮失败——绝不返回混合或不完整快照。上游不提供净值与份额变化列。更新时点：上游注明 T 日晚为预估值、T+1 早为确认值（本轮未复测）。时区：trade_date 为北京时间日期。',
            inputSchema: tradeDateInput('快照数据日期 YYYY-MM-DD（北京时间）；省略取当前快照，给出时必须与快照日期一致'),
            outputSchema: szseEtfSharesOutput,
            allowed: ['trade_date'],
            normalize: normalizeSzseEtfShares,
            validateOutput: (data) => Array.isArray(data) && data.length > 0 && data.every(isSzseEtfSharesRow),
            execute: executeSzseEtfShares,
        }),
        createSource({
            capability: 'chinamoney_repo_fixing',
            cacheMaxAgeMs: DAILY_CACHE_MS,
            name: 'get_chinamoney_repo_fixing',
            summary: '银行间回购定盘利率 FR/FDR 全历史',
            description: '获取银行间回购定盘利率 FR / FDR（中国货币网 = 外汇交易中心官方 CSV，一次取两个文件：frr-chrt.csv 与 fdr-chrt.csv），一行一个自然日，宽表 6 个期限列：`fr001`/`fr007`/`fr014`（全市场回购定盘利率，实测 748 行、最早 2023-11-20）与 `fdr001`/`fdr007`/`fdr014`（银银间，实测 249 行、最早 2025-11-20）。⛔ 单位是 **%** 且为**百分数原值**（1.37 读作 1.37%）：实测全样本区间 FR001 1.22~2.69、FR007 1.33~4.35、FR014 1.35~4.10（FDR 四列 1.22~2.00），最新 2026-11-20 为 1.37/1.40/1.42——与 7 天逆回购政策利率 1.40% 同一量级；若按比例读会是 0.0137 这种量级、差 100 倍，⛔ 不要和 turnover_pct 那类比例值混用。⛔ **上游不支持日期区间**：URL 上加 startDate/endDate 实测被忽略、照样回整份 CSV；本能力的 `start_date`/`end_date` 是**本地裁剪**（含两端），省略即全量。⛔ CSV **没有表头**，列序固定为「日期 + 5 个空列 + 001/007/014」；列数不为 9 或中间 5 列非空即响亮失败（别猜别的列序）。编码实测 **UTF-8（纯 ASCII，无 BOM，CRLF）**——不是 GBK；本层按 UTF-8 解码并防御性剥 BOM。⛔ 空值语义：上游两个文件实测各利率列零空串、零 0；**FDR 只有 2025-11-20 之后**，更早日期的 fdr* 为 **null（不是 0）**——实测 FDR 日期集合是 FR 的子集，且 FR 在 ≥2025-11-20 恰好 249 行 = FDR 行数。利率出现空串或非数字时响亮失败，⛔ 绝不把「−」/空当 0。更新时点：实测该文件 Last-Modified = 2026-11-20 11:32:07 北京时间（周五），周末不追加（2026-11-21/22 无行），故按 1 小时缓存。输出的行按 date **升序**（上游 CSV 是降序），利率原值照抄、不四舍五入。`start_date`/`end_date` 落在周末或无数据日的区间返回**成功空数组**（合法空，不是失败，不要换日期重试）；整份 CSV 解析出 0 行才是失败。',
            inputSchema: {
                type: 'object',
                properties: {
                    start_date: { type: 'string', description: '区间起点 YYYY-MM-DD（含端点，本地裁剪；上游只给整份 CSV）' },
                    end_date: { type: 'string', description: '区间终点 YYYY-MM-DD（含端点，本地裁剪；上游只给整份 CSV）' },
                },
                required: [],
                additionalProperties: false,
            },
            outputSchema: repoFixingOutput,
            allowed: ['start_date', 'end_date'],
            normalize: normalizeRepoFixing,
            validateOutput: (data) => Array.isArray(data) && data.every(isRepoFixingRow),
            execute: executeRepoFixing,
        }),
    ];
}
