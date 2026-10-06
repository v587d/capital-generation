import { buildDataKey } from '../data-collector/hub.js';
import { isoDateFromEpoch } from '../data-collector/time-axis.js';
import { getDataTimeContract } from '../time/tools.js';
import { createWindClient, WIND_SERVER_ENDPOINTS } from '../web-retriever/wind-client.js';
/**
 * Wind（万得）MCP 数据源——`docs/design/wind-market-source.md` §6.7 改口后的 P1 三条能力。
 *
 * 只接 fuyao 明确没有的：宏观/行业/汇率 EDB 序列（唯一来源）、按日期区间取的历史 K 线、
 * 每根带成交额/换手/均价的 K 线。与腾讯重叠的港美股快照与日周月线不接，NL 工具一概不接
 * （列名是 question 的函数，`output_schema` 无处锚定，§6.3）。
 *
 * ⛔ 下面每条解析约束都来自真报文（§6.2–§6.6 与 2026-10-06 第二轮），不是从上游文档抄的：
 * 1. 表格工具回 `{columns:[{name}], rows:[[标量]]}`，行**不是对象**，必须按列名转置；
 * 2. `columns[].type` 一律写 `string`，而 K 线/分钟的数值确实是字符串、EDB 的是 number——
 *    类型元数据不可信，数值由本文件解析，解析不了就响亮失败（§9.5）；
 * 3. 时间写法一张表三种：K 线带**该行自己的**交易所偏移，EDB 是 `20260731` 紧凑串。
 *    epoch 逐行按自带偏移换算，整段按 +08:00 处理会把美股错位 12 小时（§6.4）；
 * 4. 行键全部 ASCII snake_case：`updateDate` → `update_date`、`CHANGEHANDRATE` →
 *    `turnover_rate_pct`（§10.6，映射不到的列丢弃而不是透传）。
 */
/**
 * 数据域的上游预算。健康响应实测 0.59–2.3 秒（EDB 取数 590ms、A 股分钟 653ms、日 K 2296ms），
 * 而"该日没有数据"与"上游故障"在线上都表现为**挂到超时**（§6.6；2026-10-06 连昨天还正常的
 * 港股日线也挂了三次）。Hub 的执行超时是 30 秒，而 `callTool` 每次要走 initialize + tools/call
 * 两跳，所以单次取 12 秒：健康请求有 5 倍余量，病态请求在 Hub 给出无信息的
 * `request timed out` 之前先由本文件给出**带原因**的失败。
 */
const WIND_SOURCE_TIMEOUT_MS = 12_000;
/** 只放**每档都打过真报文**的 period（§6.5）；`60 分钟`两次都挂，所以不放。 */
const KLINE_PERIOD_CODES = {
    m1: '1', m5: '3', m15: '5', m30: '6', day: '10', week: '11', month: '12',
};
const KLINE_PERIOD_LIST = Object.keys(KLINE_PERIOD_CODES).join('/');
const MINUTE_PERIODS = new Set(['m1', 'm5', 'm15', 'm30']);
/** 分钟档区间上限：单日约 240 条（§1.3），而本能力不暴露 count，跨日体积没有别的闸门。 */
const MINUTE_MAX_SPAN_DAYS = 10;
const DAILY_MAX_SPAN_DAYS = 3660;
/** 上游 K 线的列名（§6.3：`MATCH` 就是收盘价，Wind 的 K 线没有 CLOSE 列）。 */
const KLINE_TIME = 'TIME';
const KLINE_OPEN = 'OPEN';
const KLINE_MATCH = 'MATCH';
const KLINE_HIGH = 'HIGH';
const KLINE_LOW = 'LOW';
const KLINE_TURNOVER = 'TURNOVER';
const KLINE_VOLUME = 'VOLUME';
const KLINE_RATE = 'CHANGEHANDRATE';
const KLINE_AVG = 'AVPRICE';
/** 缺任何一列就构不成一根 K 线：回别的列形态即"薄表"（§6.6 的不存在代码只回两列）。 */
const KLINE_REQUIRED = [KLINE_TIME, KLINE_OPEN, KLINE_MATCH, KLINE_HIGH, KLINE_LOW];
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function assertKnown(values, allowed) {
    for (const key of Object.keys(values))
        if (!allowed.includes(key))
            throw new Error(`unsupported parameter: ${key}`);
}
function windError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}
function strictDate(value, name) {
    const text = typeof value === 'string' ? value.trim() : '';
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (match === null)
        throw new Error(`parameter ${name} must be YYYY-MM-DD`);
    const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (Number.isNaN(check.getTime()) || check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month || check.getUTCDate() !== parts.day) {
        throw new Error(`parameter ${name} must be a valid YYYY-MM-DD date`);
    }
    return text;
}
function dayDistance(from, to) {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
/** 上游紧凑日期 `20260731` → `2026-07-31`；写不出合法日历日就失败，不放行畸形标签。 */
function compactDate(value, context) {
    if (value === null || value === undefined || value === '')
        return null;
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value).trim());
    if (match === null)
        throw windError(`Wind ${context} has an unparseable date ${JSON.stringify(String(value).slice(0, 40))}`, 'wind_invalid_response');
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    const check = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== date) {
        throw windError(`Wind ${context} has an impossible date ${JSON.stringify(date)}`, 'wind_invalid_response');
    }
    return date;
}
/** EDB 的报告期标签没有时区；按本仓宏观表（东财那九张）同一口径落 Asia/Shanghai 零点。 */
function reportDateMs(date) {
    return Date.parse(`${date}T00:00:00+08:00`);
}
/**
 * 单元格 → 数值。`columns[].type` 一律写 `string`，所以必须自己解析（§6.2）：K 线/分钟全是
 * 字符串（`"1318.00"`），EDB 与快照是真 number，两种都得吃。`INVALID` 是后端的"缺失/不适用"，
 * 一律 null，**不许当 0 参与计算**（§1.4）。认不出的字符串是形状变了，不是缺数——响亮失败。
 */
function windNumber(cell, context, field) {
    if (cell === null || cell === undefined)
        return null;
    if (typeof cell === 'number')
        return Number.isFinite(cell) ? cell : null;
    if (typeof cell !== 'string')
        throw windError(`Wind ${context} returned ${typeof cell} for ${field}`, 'wind_invalid_response');
    const text = cell.trim().replace(/,/g, '');
    if (text === '' || /^invalid$/i.test(text) || /^(?:-{1,2}|n\/?a|null|none)$/i.test(text))
        return null;
    const value = Number(text);
    if (!Number.isFinite(value))
        throw windError(`Wind ${context} returned unparseable ${field} ${JSON.stringify(cell)}`, 'wind_invalid_response');
    return value;
}
/** 文本单元格：空串与 INVALID 都是"没有值"；其余保留上游原文（含中文列值）。 */
function windText(cell) {
    if (cell === null || cell === undefined)
        return null;
    const text = String(cell).trim();
    if (text === '' || /^invalid$/i.test(text))
        return null;
    return text;
}
/**
 * `unit` 的键是 `"HIGH 单位："`——**空格 + 全角冒号**（§6.3）。逐列把上游原文摘进行里，
 * 不翻译也不猜币种：同一列在港美股可能是"港元"/"美元"，抄下上游那三个字是唯一不骗人的做法。
 */
function windUnit(unit, column) {
    if (!isRecord(unit))
        return null;
    for (const [key, value] of Object.entries(unit)) {
        if (key.replace(/\s*单位[:：]\s*$/u, '').trim() === column)
            return windText(value);
    }
    return null;
}
/** 上游的业务错误有两种形态：能解析成 JSON 的走 `error` 字段，不能的整段就是文本。 */
function requirePayload(result, context) {
    if (!result.ok) {
        const message = result.error ?? 'unknown Wind error';
        const code = result.code === 'AUTH' ? 'wind_api_key_missing'
            : result.code === 'RATE_LIMIT' ? 'wind_rate_limit'
                : result.code === 'NETWORK' ? 'wind_upstream_timeout'
                    : result.code === 'INVALID' ? 'wind_invalid_response' : 'wind_backend_error';
        const hint = result.code === 'NETWORK'
            ? ' Wind 未在预算内应答；该日缺数与上游故障在线上不可区分，不要盲目重试同一区间——改更早日期或改走日线。'
            : result.code === 'AUTH' || result.code === 'RATE_LIMIT' ? ' 积分计费，不自动重试。' : '';
        throw windError(`Wind ${context} failed (${String(result.code ?? 'ERROR')}): ${message.slice(0, 400)}.${hint}`, code);
    }
    if (isRecord(result.data)) {
        const error = result.data.error;
        if (error !== null && error !== undefined && !(typeof error === 'object' && !Array.isArray(error) && Object.keys(error).length === 0)) {
            throw windError(`Wind ${context} returned a backend error: ${JSON.stringify(error).slice(0, 400)}`, 'wind_backend_error');
        }
        return result.data;
    }
    // 正文不是 JSON 时 wind-client 原样透传 `content`。上游的参数性抱怨（实测
    // "observation或者[beginDate、endDate]必须填一个"）就是这一类文本：必须带着原文失败，
    // 不许退化成 0 行——那是把"你说错了"报成"没有数据"。
    const text = typeof result.content === 'string' ? result.content.trim() : '';
    throw windError(`Wind ${context} returned a non-table response: ${text.slice(0, 400) || '(empty)'}`, 'wind_unexpected_response');
}
/** 表格解包：`{data:{columns,rows,unit}}`（K 线/分钟）与顶层直接是表身的形态都接住。 */
function requireTable(payload, context) {
    const node = isRecord(payload.data) ? payload.data : payload;
    const { columns, rows } = node;
    if (!Array.isArray(columns) || !Array.isArray(rows) || !columns.every((column) => isRecord(column) && typeof column.name === 'string')) {
        throw windError(`Wind ${context} response is not a table (keys: ${Object.keys(node).join(', ') || 'none'})`, 'wind_invalid_response');
    }
    for (const row of rows)
        if (!Array.isArray(row))
            throw windError(`Wind ${context} row is not a scalar array`, 'wind_invalid_response');
    return { columns: columns.map((column) => String(column.name)), rows: rows, unit: node.unit };
}
function columnIndex(table, name, context) {
    const at = table.columns.indexOf(name);
    if (at < 0)
        throw windError(`Wind ${context} table has no ${name} column (columns: ${table.columns.join(', ')})`, 'wind_invalid_response');
    return at;
}
function optionalColumnIndex(table, name) {
    return table.columns.includes(name) ? table.columns.indexOf(name) : -1;
}
/**
 * 指标元信息 → 行键。键集**不固定**：2026-10-06 实测汇率类没有 `unit`/`magnitude`/`currency`，
 * GDP 类三者齐全；缺的键落 null，不猜单位（§10.6 第 2 条的显式映射表就在这五行里）。
 * `series_begin_date`/`series_end_date` 是**该指标序列**的起止，不是本次请求的窗口。
 */
function metricMeta(meta, context) {
    const code = windText(meta.code);
    if (code === null)
        throw windError(`Wind ${context} returned a metric without a code`, 'wind_invalid_response');
    return {
        code,
        name: windText(meta.name),
        unit: windText(meta.unit),
        freq: windText(meta.freq),
        source: windText(meta.source),
        report_date: null,
        report_date_ms: null,
        value: null,
        update_date: compactDate(meta.updateDate, context),
        series_begin_date: compactDate(meta.beginDate, context),
        series_end_date: compactDate(meta.endDate, context),
        magnitude: windText(meta.magnitude),
        currency: windText(meta.currency),
    };
}
function requireMetrics(payload, context) {
    if (Array.isArray(payload.metrics))
        return payload.metrics;
    const nested = isRecord(payload.data) ? payload.data.metrics : undefined;
    if (Array.isArray(nested))
        return nested;
    throw windError(`Wind ${context} returned no metrics list (keys: ${Object.keys(payload).join(', ')})`, 'wind_invalid_response');
}
async function executeEdbSearch(client, params, signal) {
    const payload = requirePayload(await client.callTool('search_economic_indicator', { question: params.question }, signal), 'search_economic_indicator');
    const metrics = requireMetrics(payload, 'search_economic_indicator');
    const rows = metrics.map((item) => {
        if (!isRecord(item))
            throw windError('Wind search_economic_indicator returned a non-object metric', 'wind_invalid_response');
        return metricMeta(item, 'search_economic_indicator');
    });
    return { data: rows, schema: edbSearchOutput };
}
/**
 * EDB 取数：`{metrics:[{meta, date[], value[]}]}` 的**并行数组**转置成一行一期（§3.3）。
 * 日期与数值长度不一致时不猜——多出来的日期没有值、多出来的值没有期间，两种都是把数值挂错
 * 期间，与 §1.4 里"excelTotalCount 不可信"同一族。
 */
async function executeEdbQuery(client, params, signal) {
    const payload = requirePayload(await client.callTool('query_economic_indicator_data', {
        question: params.indicator,
        beginDate: params.start_date,
        endDate: params.end_date,
    }, signal), 'query_economic_indicator_data');
    const rows = [];
    for (const item of requireMetrics(payload, 'query_economic_indicator_data')) {
        if (!isRecord(item))
            throw windError('Wind query_economic_indicator_data returned a non-object metric', 'wind_invalid_response');
        const meta = isRecord(item.meta) ? item.meta : item;
        const context = `query_economic_indicator_data(${windText(meta.code) ?? String(params.indicator)})`;
        const base = metricMeta(meta, context);
        if (item.date === undefined && item.value === undefined)
            continue;
        const { date, value } = item;
        if (!Array.isArray(date) || !Array.isArray(value) || date.length !== value.length) {
            throw windError(`Wind ${context} returned ${Array.isArray(date) ? date.length : 'non-array'} dates beside ${Array.isArray(value) ? value.length : 'non-array'} values`, 'wind_invalid_response');
        }
        for (let index = 0; index < date.length; index += 1) {
            const reportDate = compactDate(date[index], context);
            if (reportDate === null)
                throw windError(`Wind ${context} has a missing period at row ${index}`, 'wind_invalid_response');
            rows.push({ ...base, report_date: reportDate, report_date_ms: reportDateMs(reportDate), value: windNumber(value[index], context, 'value') });
        }
    }
    return { data: rows, schema: edbQueryOutput };
}
/**
 * K 线时间戳**必须自带偏移**（§6.4：A股/港股 +08:00、美股 -04:00，是交易所当地时间）。
 * 没写偏移就没法确定这是哪一刻，`Date.parse` 会按宿主本地时区猜——所以先失败。
 */
function klineInstant(value, context) {
    const text = String(value ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
        throw windError(`Wind ${context} has a timestamp without an explicit UTC offset: ${JSON.stringify(text.slice(0, 40))}`, 'wind_invalid_response');
    }
    const epoch = Date.parse(text);
    if (Number.isNaN(epoch))
        throw windError(`Wind ${context} has an unparseable timestamp ${JSON.stringify(text)}`, 'wind_invalid_response');
    return { datetime: text, time_ms: epoch };
}
async function executeKline(client, params, signal) {
    const period = String(params.period);
    const adjust = String(params.adjust);
    const code = String(params.code);
    const args = {
        windcode: code,
        begin_date: params.start_date,
        end_date: params.end_date,
        period: KLINE_PERIOD_CODES[period],
        aftype: adjust === 'qfq' ? '0' : '2',
    };
    // 前复权必须给 afdate，且不得早于区间——两者任一缺失都是挂满 60 秒而不是报错（§6.5）。
    // 锁"当日"而不是暴露成参数：后复权以 afdate 为锚向未来放大，把锚默认成今天会得到
    // 一个逐位等于不复权却叫 hfq 的序列，所以 hfq 根本不放（参数层已拒）。
    if (adjust === 'qfq')
        args.afdate = isoDateFromEpoch(Date.now(), 'Asia/Shanghai');
    const payload = requirePayload(await client.callTool('get_stock_kline', args, signal), 'get_stock_kline');
    const table = requireTable(payload, 'get_stock_kline');
    // 空表是合法成功：非交易日实测快回 rows=[] 且 unit=null（§6.2）——"这一区间没有行情"
    // 与"取不到"是两种结论，前者落 0 行 Dataset，后者由上面的错误分类负责。
    if (table.rows.length === 0)
        return { data: [], schema: klineOutput };
    const at = KLINE_REQUIRED.reduce((acc, name) => ({ ...acc, [name]: columnIndex(table, name, 'get_stock_kline') }), {});
    const turnoverAt = optionalColumnIndex(table, KLINE_TURNOVER);
    const volumeAt = optionalColumnIndex(table, KLINE_VOLUME);
    const rateAt = optionalColumnIndex(table, KLINE_RATE);
    const avgAt = optionalColumnIndex(table, KLINE_AVG);
    const context = `get_stock_kline(${code})`;
    const cell = (row, index) => (index >= 0 && index < row.length ? row[index] : null);
    const rows = table.rows.map((row) => {
        const instant = klineInstant(cell(row, at[KLINE_TIME]), context);
        const open = windNumber(cell(row, at[KLINE_OPEN]), context, KLINE_OPEN);
        const close = windNumber(cell(row, at[KLINE_MATCH]), context, KLINE_MATCH);
        const high = windNumber(cell(row, at[KLINE_HIGH]), context, KLINE_HIGH);
        const low = windNumber(cell(row, at[KLINE_LOW]), context, KLINE_LOW);
        for (const [name, value] of [[KLINE_OPEN, open], [KLINE_MATCH, close], [KLINE_HIGH, high], [KLINE_LOW, low]]) {
            if (value === null)
                throw windError(`Wind ${context} has a missing ${name} inside a non-empty row`, 'wind_invalid_response');
        }
        if (high < low)
            throw windError(`Wind ${context} ${instant.datetime} has high < low`, 'wind_invalid_response');
        return {
            code,
            period,
            adjust,
            datetime: instant.datetime,
            time_ms: instant.time_ms,
            open,
            high,
            low,
            close,
            volume: windNumber(cell(row, volumeAt), context, KLINE_VOLUME),
            turnover: windNumber(cell(row, turnoverAt), context, KLINE_TURNOVER),
            turnover_rate_pct: windNumber(cell(row, rateAt), context, KLINE_RATE),
            avg_price: windNumber(cell(row, avgAt), context, KLINE_AVG),
            price_unit: windUnit(table.unit, KLINE_MATCH),
            amount_unit: windUnit(table.unit, KLINE_TURNOVER),
            volume_unit: windUnit(table.unit, KLINE_VOLUME),
        };
    });
    return { data: rows, schema: klineOutput };
}
const nullableNumber = { oneOf: [{ type: 'number' }, { type: 'null' }] };
const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] };
const metricMetaProperties = {
    code: { type: 'string', description: 'Wind EDB 指标代码（如 M0000612），取数时原样填进 wind_edb_query 的 indicator' },
    name: { ...nullableString, description: '指标全称原文（中文，含口径与期间）' },
    unit: { ...nullableString, description: '上游标的单位原文（亿元 / % …）；该族没有这个键时为 null，不猜单位' },
    freq: { ...nullableString, description: '频率原文（日/周/月/季/半年/年，中文字面量）' },
    source: { ...nullableString, description: '数据来源原文（国家统计局 / 美联储 …）' },
};
const metricSeriesProperties = {
    update_date: { ...nullableString, description: '该指标**最后一次更新日期**（YYYY-MM-DD），不是本 Dataset 的时间序列' },
    series_begin_date: { ...nullableString, description: '该指标序列的最早期间' },
    series_end_date: { ...nullableString, description: '该指标序列的最新期间：要"最新的数"就到这里为止' },
    magnitude: { ...nullableString, description: '量纲原文（亿 / 万 …），单位可能为 % 的指标族不给这一键' },
    currency: { ...nullableString, description: '币种原文（人民币 / 美元 …）' },
};
const edbSearchOutput = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            ...metricMetaProperties,
            report_date: { type: 'null', description: '本能力只找指标不取数，恒为 null' },
            report_date_ms: { type: 'null', description: '恒为 null（同上）' },
            value: { type: 'null', description: '恒为 null：数值请走 wind_edb_query' },
            ...metricSeriesProperties,
        },
        additionalProperties: true,
    },
};
const edbQueryOutput = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            ...metricMetaProperties,
            report_date: { type: 'string', description: '报告期/观测日 YYYY-MM-DD（上游给的是 20260731 紧凑串）；本 Dataset 的时间轴' },
            report_date_ms: { type: 'integer', description: 'report_date 按 Asia/Shanghai 零点的毫秒戳（EDB 的日期本身没有时区）' },
            value: { ...nullableNumber, description: '指标数值，单位见 unit；后端 INVALID 一律 null，不得当 0 参与计算' },
            ...metricSeriesProperties,
        },
        additionalProperties: true,
    },
};
const klineOutput = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            code: { type: 'string', description: '本次请求的代码回显（上游 K 线表里没有代码列，不拿它当上游确认）' },
            period: { type: 'string', description: '本次请求的档：day/week/month/m1/m5/m15/m30' },
            adjust: { type: 'string', description: '复权口径：none 或 qfq（后复权不提供，理由见能力说明）' },
            datetime: { type: 'string', description: '上游原样时间戳，带**该行自己的**交易所偏移（A股/港股 +08:00、美股夏令时 -04:00）' },
            time_ms: { type: 'integer', description: '按该行自带偏移换算的 epoch 毫秒；日线/周/月那根是该期间末的当地 00:00。本 Dataset 的时间轴' },
            open: { type: 'number' },
            high: { type: 'number' },
            low: { type: 'number' },
            close: { type: 'number', description: '来自上游 MATCH 列（Wind 的 K 线没有 CLOSE 列，MATCH 即收盘价）' },
            volume: { ...nullableNumber, description: '成交量，单位见 volume_unit。⚠️ 实测 A 股是**股**，而腾讯 A 股 K 线是**手**——跨源比先换单位' },
            turnover: { ...nullableNumber, description: '成交额，单位见 amount_unit' },
            turnover_rate_pct: { ...nullableNumber, description: '换手率**百分数原值**（0.2892 表示 0.2892%）；上游 unit 表不含这一列，分母口径未逐值核验' },
            avg_price: { ...nullableNumber, description: '均价（上游 AVPRICE）；实测 avg_price × volume = turnover' },
            price_unit: { ...nullableString, description: '上游 unit 表里 OHLC/均价的币种原文（实测 A 股为「元」）' },
            amount_unit: { ...nullableString, description: '成交额单位原文' },
            volume_unit: { ...nullableString, description: '成交量单位原文（实测 A 股为「股」）' },
        },
        additionalProperties: true,
    },
};
function normalizeEdbSearch(params) {
    const question = typeof params.question === 'string' ? params.question.trim().replace(/\s+/g, ' ') : '';
    if (question.length === 0)
        throw new Error('parameter question is required');
    if (question.length > 500)
        throw new Error('parameter question must be at most 500 characters');
    return { question };
}
function normalizeEdbQuery(params) {
    // `observation` 走这道显式拒绝，而不是靠 assertKnown：默默忽略时间参数是最坏的一种失败，
    // 而实测上游对 observation "给 3 只回 2 期"（§6.7），期数不可信。
    if (params.observation !== undefined)
        throw new Error('parameter observation is not supported: 实测该口径给 3 期只回 2 期，期数不可信；请给 start_date 与 end_date');
    const raw = typeof params.indicator === 'string' ? params.indicator.trim() : '';
    if (raw.length === 0)
        throw new Error('parameter indicator is required');
    if (raw.length > 200)
        throw new Error('parameter indicator must be at most 200 characters');
    if (/[,，]/.test(raw))
        throw new Error('parameter indicator accepts exactly one indicator: 2026-10-06 实测逗号分隔的多码挂满 60 秒无应答，要多个指标请分次调用');
    const start_date = strictDate(params.start_date, 'start_date');
    const end_date = strictDate(params.end_date, 'end_date');
    if (start_date > end_date)
        throw new Error('parameter start_date must not be later than end_date');
    return { indicator: raw.replace(/\s+/g, ' '), start_date, end_date };
}
/**
 * 代码照 Wind 的写法收下，**不补也不猜交易所后缀**（§3.3）：实测美股 `AAPL.O` 与 `AAPL.N`
 * 回完全相同的行（后缀不参与解析），所以猜一个后缀不会报错、只会静默认错标的。
 */
function normalizeWindCode(value) {
    const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!/^[A-Z0-9][A-Z0-9.]*\.[A-Z]{1,3}$/.test(raw) || raw.includes('..')) {
        throw new Error('parameter code must carry a Wind exchange suffix (600519.SH / 00700.HK / AAPL.O); 本能力不猜后缀——实测后缀不参与上游解析');
    }
    return raw;
}
function normalizeKline(params) {
    // `count` 进 allowed 只为了给出**可用**的拒绝理由（默默忽略"我要 N 根"是最坏的一种失败，
    // 同 tencent 港美股那两条对 start/end 的处理）：负值/0 的语义只有上游蓝本的说法、没打过真报文（§6.8 第 2 条）。
    if (params.count !== undefined)
        throw new Error('parameter count is not supported: 本能力按 start_date..end_date 取全区间，count 的正负/零语义（往后 N 条 / 往前 N 条 / 全区间）未实测，不暴露');
    const code = normalizeWindCode(params.code);
    const period = params.period === undefined ? 'day' : String(params.period).trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(KLINE_PERIOD_CODES, period)) {
        throw new Error(`parameter period must be one of ${KLINE_PERIOD_LIST}（每档都有真报文；60 分钟实测两次都挂满超时，不提供）`);
    }
    const adjust = params.adjust === undefined ? (MINUTE_PERIODS.has(period) ? 'none' : 'qfq') : String(params.adjust).trim().toLowerCase();
    if (adjust !== 'none' && adjust !== 'qfq') {
        throw new Error(`parameter adjust must be none or qfq（hfq 不提供：后复权以 afdate 为锚向未来放大，锚点默认成今天会给出一个逐位等于不复权却叫 hfq 的序列）`);
    }
    if (MINUTE_PERIODS.has(period) && adjust !== 'none') {
        throw new Error('parameter adjust must be none for minute periods（分钟档的 qfq/afdate 组合没有打过真报文，不暴露未验证的组合）');
    }
    const start_date = strictDate(params.start_date, 'start_date');
    const end_date = strictDate(params.end_date, 'end_date');
    if (start_date > end_date)
        throw new Error('parameter start_date must not be later than end_date');
    const span = dayDistance(start_date, end_date);
    const maxSpan = MINUTE_PERIODS.has(period) ? MINUTE_MAX_SPAN_DAYS : DAILY_MAX_SPAN_DAYS;
    if (span > maxSpan)
        throw new Error(`parameter start_date..end_date spans ${span} days; ${MINUTE_PERIODS.has(period) ? 'minute periods accept' : 'day/week/month accept'} at most ${maxSpan} days`);
    if (adjust === 'qfq' && end_date > isoDateFromEpoch(Date.now(), 'Asia/Shanghai')) {
        throw new Error('parameter end_date must not be later than today when adjust=qfq（前复权的 afdate 由本能力锁成当日，而实测 afdate 早于区间会挂满超时）');
    }
    return { code, period, adjust, start_date, end_date };
}
/**
 * 单能力的 DataSource：客户端在**定义期**构造是安全的（它不持有 Key——每次 callTool 现解析，
 * 也不持有会话），所以这里没有任何"装配期读到凭据才注册"的门槛（§9.7⑤，桌面端那 61 颗
 * 静默缺席的事故就在这一条上）。
 */
function createWindSource(options) {
    const schema = {
        capability: options.capability,
        time_contract: getDataTimeContract(options.capability),
        name: options.tool,
        source: `mcp:wind.${options.server}.${options.tool}`,
        data_key: buildDataKey('wind', 'mcp', `${options.server}.${options.capability.replace(/^wind_/, '')}`),
        source_label: 'wind',
        paginated: false,
        cacheMaxAgeMs: options.cacheMaxAgeMs,
        rowShape: { rootArray: true },
        summary: options.summary,
        description: options.description,
        input_schema: options.inputSchema,
        output_schema: options.outputSchema,
    };
    const client = createWindClient({
        endpoint: WIND_SERVER_ENDPOINTS[options.server],
        timeoutMs: WIND_SOURCE_TIMEOUT_MS,
        resolveApiKey: options.resolveApiKey,
    });
    // 归一化会被跑两遍（Hub 入队前一次、execute 一次，§10.7），所以只换值不改键名、且必须幂等。
    const normalize = (params) => {
        if (!isRecord(params))
            throw new Error('params must be an object');
        assertKnown(params, options.allowed);
        return options.normalize(params);
    };
    return {
        schema,
        normalizeParams: normalize,
        // 空结果是合法成功（非交易日分钟线实测快回 rows=[]），所以这道护栏只认形状、不认条数（§3.3）。
        validateOutput: (data) => Array.isArray(data),
        execute: (request, signal) => options.execute(client, normalize(request.params), signal),
    };
}
const EDB_SEARCH_DESCRIPTION = 'Wind EDB（经济数据库）指标**检索**：只找指标不取数，一行一个候选指标（code/name/unit/freq/source + 该序列的起止与更新日期）。这是 fuyao 与东财都没有的面：宏观、行业、汇率、全球序列。⛔ question 走后端 NER，字面请求不等于字面结果——实测「人民币兑美元汇率 指标」回的是**美元兑人民币**（source 为 美联储 / 台湾统计局），先核对 name 与 source 再取数。键集随指标族变化：实测汇率类没有 unit/magnitude/currency 三个键，缺的一律 null，不猜单位。取数走 wind_edb_query：确定性靠"先 search 拿 code、再按 code 取数"这两步拿到，不是靠 NL 稳定。没有匹配时返回 0 行，是合法空结果不是失败。';
const EDB_QUERY_DESCRIPTION = 'Wind EDB 时间序列**取数**：上游回 {meta, date[], value[]} 并行数组，本能力转置成**一行一个观测期**（meta 逐行拼接，多指标可分次取后按 code 拼对比）。⛔ indicator 一次只填**一个**指标代码或一条中文问句：2026-10-06 实测逗号分隔的多码挂满 60 秒无应答，上游"多个代码用英文逗号分隔"的说法不成立，要多个就分次调用。start_date/end_date 必填——上游在日期区间与 observation 之间二选一，而 observation 实测"给 3 期只回 2 期"、期数不可信，本能力直接拒绝它。report_date 由上游紧凑串 20260731 归一而来，report_date_ms 按 Asia/Shanghai 零点（EDB 的日期本身没有时区）。unit 是上游单位原文；后端 INVALID 一律 null，**不得当 0 参与计算**。已实测指标代码直接当 indicator 与同义中文问句回同一份序列（M0000612 = 中国 CPI 当月同比）：先 wind_edb_search 拿码再回来，确定性就在这两步。';
const KLINE_DESCRIPTION = 'Wind K 线：单只标的按**日期区间**取 日/周/月 与 1/5/15/30 分钟。相对腾讯的增量（§6.6.1）：按日期区间取 640 根之前的历史、每根带成交额/成交量/换手/均价的美股 K 线、以及分钟档；⚠️ **分钟档只有 A 股取到过行**，港股与美股的分钟到 2026-10-06 为止四次全挂、仍未证实，要港美股分时先小范围试一次。港美股日线与快照请走 tencent_*。⛔ code 必须自带交易所后缀（600519.SH / 00700.HK / AAPL.O），本能力不猜后缀——实测 AAPL.O 与 AAPL.N 回完全相同的行（后缀不参与解析），所以 BRK.B 一类双市场代码有认错标的的风险；每行的 code 只是请求写法回显，上游 K 线表里没有代码列。⛔ period 只放逐档打过真报文的七档，60 分钟实测两次都挂满超时、不提供。adjust 只有 none 与 qfq：后复权以 afdate 为锚向未来放大，锚默认成今天会得到一个逐位等于不复权却叫 hfq 的序列，所以宁可不给；qfq 的 afdate 由本能力锁成当日，因此 end_date 不得晚于当日；分钟档只允许 none。close 来自上游 MATCH 列（Wind 没有 CLOSE 列）；上游多给的列不收录，行里以 output_fields 为准。数值列上游全是字符串（columns[].type 却一律写 string），解析不了即失败。time_ms 按**该行自带偏移**换算（A股/港股 +08:00、美股 -04:00 是交易所当地时间），整段按北京时间处理会让美股错位 12 小时。⚠️ volume 实测 A 股是**股**（腾讯 A 股 K 线是手，跨源先换）；turnover_rate_pct 是百分数原值（0.2892 = 0.2892%），上游不给它的单位与分母口径。非交易日快回 0 行、是合法成功（实测 A 股国庆休市日 653ms 回空表）；而"该日该市场分钟尚未落地"与上游故障都表现为挂到 12 秒超时（wind_upstream_timeout）——不要盲目重试同一区间，改更早日期或改走日线。积分计费：AUTH/RATE_LIMIT/后端错误一律不自动重试。';
/**
 * §6.7 改口后的 P1 三条。`wind_edb_*` 是 P0（EDB 是唯一来源），`wind_stock_kline` 是 P1。
 * 不接的一概有理由：price_indicators 与全部 NL 工具（中文键 / 列名是 question 的函数）、
 * bond 与 fund/index（重叠或未测）、analytics_data（实测连 initialize 都挂）。
 */
export function createWindSources(resolveApiKey) {
    return [
        createWindSource({
            capability: 'wind_edb_search',
            tool: 'search_economic_indicator',
            server: 'economic_data',
            // 指标目录与序列发布都是日/季粒度；缓存拉长是为了少烧积分，而不是省 RTT。
            cacheMaxAgeMs: 6 * 3_600_000,
            summary: 'Wind EDB 宏观/行业/汇率指标检索（只找码不取数）',
            description: EDB_SEARCH_DESCRIPTION,
            inputSchema: {
                type: 'object',
                properties: { question: { type: 'string', maxLength: 500, description: '中文自然语言问句，只描述要找的指标（实体 + 指标），不要写时间范围与换算' } },
                required: ['question'],
                additionalProperties: false,
            },
            outputSchema: edbSearchOutput,
            allowed: ['question'],
            normalize: normalizeEdbSearch,
            execute: executeEdbSearch,
            resolveApiKey,
        }),
        createWindSource({
            capability: 'wind_edb_query',
            tool: 'query_economic_indicator_data',
            server: 'economic_data',
            cacheMaxAgeMs: 6 * 3_600_000,
            summary: 'Wind EDB 指标时间序列（宏观/行业/汇率，按日期区间）',
            description: EDB_QUERY_DESCRIPTION,
            inputSchema: {
                type: 'object',
                properties: {
                    indicator: { type: 'string', maxLength: 200, description: '一个 EDB 指标代码（如 M0000612，先走 wind_edb_search 拿码）或一条中文指标问句；不接受逗号分隔的多个' },
                    start_date: { type: 'string', description: '起始日期 YYYY-MM-DD（含）' },
                    end_date: { type: 'string', description: '结束日期 YYYY-MM-DD（含）' },
                },
                required: ['indicator', 'start_date', 'end_date'],
                additionalProperties: false,
            },
            outputSchema: edbQueryOutput,
            allowed: ['indicator', 'start_date', 'end_date', 'observation'],
            normalize: normalizeEdbQuery,
            execute: executeEdbQuery,
            resolveApiKey,
        }),
        createWindSource({
            capability: 'wind_stock_kline',
            tool: 'get_stock_kline',
            server: 'stock_data',
            cacheMaxAgeMs: 60_000,
            summary: 'Wind 日周月与 1–30 分钟 K 线（按日期区间，A股+港股+美股）',
            description: KLINE_DESCRIPTION,
            inputSchema: {
                type: 'object',
                properties: {
                    code: { type: 'string', description: 'Wind 代码，必须自带交易所后缀：600519.SH、00700.HK、AAPL.O' },
                    start_date: { type: 'string', description: '起始日期 YYYY-MM-DD（含）' },
                    end_date: { type: 'string', description: '结束日期 YYYY-MM-DD（含）；adjust=qfq 时不得晚于当日' },
                    period: { type: 'string', enum: ['day', 'week', 'month', 'm1', 'm5', 'm15', 'm30'], description: '缺省 day；只有逐档打过真报文的这七档（60 分钟不提供）' },
                    adjust: { type: 'string', enum: ['none', 'qfq'], description: '缺省：日/周/月为 qfq，分钟档为 none（分钟档只接受 none）' },
                },
                required: ['code', 'start_date', 'end_date'],
                additionalProperties: false,
            },
            outputSchema: klineOutput,
            allowed: ['code', 'start_date', 'end_date', 'period', 'adjust', 'count'],
            normalize: normalizeKline,
            execute: executeKline,
            resolveApiKey,
        }),
    ];
}
