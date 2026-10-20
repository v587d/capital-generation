import type { DataRequest, DataSource, SchemaDescriptor } from '../data-collector/hub.js'
import { buildDataKey } from '../data-collector/hub.js'
import { isoDateFromEpoch } from '../data-collector/time-axis.js'
import { getDataTimeContract } from '../time/tools.js'
import { createWindClient, WIND_SERVER_ENDPOINTS, type WindCallResult, type WindClient, type WindServerType } from '../web-retriever/wind-client.js'

/**
 * Wind MCP: only capabilities Fuyao lacks — EDB macro/industry/FX series, range K-lines with
 * amount/turnover/avg. No NL tools (columns depend on the question; nothing to anchor in schema).
 * Payload quirks: tables are `{columns, rows:[scalars]}`; `columns[].type` is always `string`;
 * timestamps carry each row's exchange offset; unmapped columns are dropped.
 */

/** 12s: healthy calls take 0.6–2.3s; hangs and no-data look identical, so fail before Hub's 30s. */
const WIND_SOURCE_TIMEOUT_MS = 12_000

/** Only periods with verified payloads; 60-minute hangs both times and is excluded. */
const KLINE_PERIOD_CODES: Record<string, string> = {
  m1: '1', m5: '3', m15: '5', m30: '6', day: '10', week: '11', month: '12',
}
const KLINE_PERIOD_LIST = Object.keys(KLINE_PERIOD_CODES).join('/')
const MINUTE_PERIODS = new Set(['m1', 'm5', 'm15', 'm30'])
/** Minute ranges cap at 10 days: ~240 rows/day and no count parameter gates volume. */
const MINUTE_MAX_SPAN_DAYS = 10
const DAILY_MAX_SPAN_DAYS = 3660

/** Upstream K-line columns: MATCH is close (Wind has no CLOSE column). */
const KLINE_TIME = 'TIME'
const KLINE_OPEN = 'OPEN'
const KLINE_MATCH = 'MATCH'
const KLINE_HIGH = 'HIGH'
const KLINE_LOW = 'LOW'
const KLINE_TURNOVER = 'TURNOVER'
const KLINE_VOLUME = 'VOLUME'
const KLINE_RATE = 'CHANGEHANDRATE'
const KLINE_AVG = 'AVPRICE'
const KLINE_REQUIRED = [KLINE_TIME, KLINE_OPEN, KLINE_MATCH, KLINE_HIGH, KLINE_LOW]

type Params = Record<string, unknown>
type JsonRecord = Record<string, unknown>
export type WindApiKeyResolver = () => Promise<string | undefined>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertKnown(values: Params, allowed: string[]): void {
  for (const key of Object.keys(values)) if (!allowed.includes(key)) throw new Error(`unsupported parameter: ${key}`)
}

function windError(message: string, code: string): Error {
  const error = new Error(message)
  ;(error as Error & { code?: string }).code = code
  return error
}

function strictDate(value: unknown, name: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (match === null) throw new Error(`parameter ${name} must be YYYY-MM-DD`)
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  if (Number.isNaN(check.getTime()) || check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month || check.getUTCDate() !== parts.day) {
    throw new Error(`parameter ${name} must be a valid YYYY-MM-DD date`)
  }
  return text
}

function dayDistance(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function compactDate(value: unknown, context: string): string | null {
  if (value === null || value === undefined || value === '') return null
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value).trim())
  if (match === null) throw windError(`Wind ${context} has an unparseable date ${JSON.stringify(String(value).slice(0, 40))}`, 'wind_invalid_response')
  const date = `${match[1]}-${match[2]}-${match[3]}`
  const check = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== date) {
    throw windError(`Wind ${context} has an impossible date ${JSON.stringify(date)}`, 'wind_invalid_response')
  }
  return date
}

/** EDB period labels have no timezone; use Asia/Shanghai midnight like the Eastmoney macro tables. */
function reportDateMs(date: string): number {
  return Date.parse(`${date}T00:00:00+08:00`)
}

/**
 * `columns[].type` is always `string`; parse here. `INVALID` = missing → null, never 0.
 * An unparseable string means the shape changed: fail loudly.
 */
function windNumber(cell: unknown, context: string, field: string): number | null {
  if (cell === null || cell === undefined) return null
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null
  if (typeof cell !== 'string') throw windError(`Wind ${context} returned ${typeof cell} for ${field}`, 'wind_invalid_response')
  const text = cell.trim().replace(/,/g, '')
  if (text === '' || /^invalid$/i.test(text) || /^(?:-{1,2}|n\/?a|null|none)$/i.test(text)) return null
  const value = Number(text)
  if (!Number.isFinite(value)) throw windError(`Wind ${context} returned unparseable ${field} ${JSON.stringify(cell)}`, 'wind_invalid_response')
  return value
}

function windText(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null
  const text = String(cell).trim()
  if (text === '' || /^invalid$/i.test(text)) return null
  return text
}

/** `unit` keys look like `"HIGH 单位："` (space + fullwidth colon); copy the upstream unit text, never translate. */
function windUnit(unit: unknown, column: string): string | null {
  if (!isRecord(unit)) return null
  for (const [key, value] of Object.entries(unit)) {
    if (key.replace(/\s*单位[:：]\s*$/u, '').trim() === column) return windText(value)
  }
  return null
}

/** Business errors come as JSON (`error` field) or plain text; text must fail with the original text, not become 0 rows. */
function requirePayload(result: WindCallResult, context: string): JsonRecord {
  if (!result.ok) {
    const message = result.error ?? 'unknown Wind error'
    const code = result.code === 'AUTH' ? 'wind_api_key_missing'
      : result.code === 'RATE_LIMIT' ? 'wind_rate_limit'
        : result.code === 'NETWORK' ? 'wind_upstream_timeout'
          : result.code === 'INVALID' ? 'wind_invalid_response' : 'wind_backend_error'
    const hint = result.code === 'NETWORK'
      ? ' Wind 未在预算内应答；该日缺数与上游故障在线上不可区分，不要盲目重试同一区间——改更早日期或改走日线。'
      : result.code === 'AUTH' || result.code === 'RATE_LIMIT' ? ' 积分计费，不自动重试。' : ''
    throw windError(`Wind ${context} failed (${String(result.code ?? 'ERROR')}): ${message.slice(0, 400)}.${hint}`, code)
  }
  if (isRecord(result.data)) {
    const error = result.data.error
    if (error !== null && error !== undefined && !(typeof error === 'object' && !Array.isArray(error) && Object.keys(error).length === 0)) {
      throw windError(`Wind ${context} returned a backend error: ${JSON.stringify(error).slice(0, 400)}`, 'wind_backend_error')
    }
    return result.data
  }
  const text = typeof result.content === 'string' ? result.content.trim() : ''
  throw windError(`Wind ${context} returned a non-table response: ${text.slice(0, 400) || '(empty)'}`, 'wind_unexpected_response')
}

interface WindTable {
  columns: string[]
  rows: unknown[][]
  unit: unknown
}

function requireTable(payload: JsonRecord, context: string): WindTable {
  const node = isRecord(payload.data) ? payload.data : payload
  const { columns, rows } = node
  if (!Array.isArray(columns) || !Array.isArray(rows) || !columns.every((column) => isRecord(column) && typeof column.name === 'string')) {
    throw windError(`Wind ${context} response is not a table (keys: ${Object.keys(node).join(', ') || 'none'})`, 'wind_invalid_response')
  }
  for (const row of rows) if (!Array.isArray(row)) throw windError(`Wind ${context} row is not a scalar array`, 'wind_invalid_response')
  return { columns: columns.map((column) => String(column.name)), rows: rows as unknown[][], unit: node.unit }
}

function columnIndex(table: WindTable, name: string, context: string): number {
  const at = table.columns.indexOf(name)
  if (at < 0) throw windError(`Wind ${context} table has no ${name} column (columns: ${table.columns.join(', ')})`, 'wind_invalid_response')
  return at
}

function optionalColumnIndex(table: WindTable, name: string): number {
  return table.columns.includes(name) ? table.columns.indexOf(name) : -1
}

/**
 * Metric metadata → row keys. Key sets vary (FX lacks unit/magnitude/currency); missing keys become
 * null, never guessed. `series_*` bound the series, not the request window.
 */
function metricMeta(meta: JsonRecord, context: string): JsonRecord {
  const code = windText(meta.code)
  if (code === null) throw windError(`Wind ${context} returned a metric without a code`, 'wind_invalid_response')
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
  }
}

function requireMetrics(payload: JsonRecord, context: string): unknown[] {
  if (Array.isArray(payload.metrics)) return payload.metrics
  const nested = isRecord(payload.data) ? payload.data.metrics : undefined
  if (Array.isArray(nested)) return nested
  throw windError(`Wind ${context} returned no metrics list (keys: ${Object.keys(payload).join(', ')})`, 'wind_invalid_response')
}

async function executeEdbSearch(client: WindClient, params: Params, signal: AbortSignal): Promise<{ data: JsonRecord[]; schema: object }> {
  const payload = requirePayload(await client.callTool('search_economic_indicator', { question: params.question }, signal), 'search_economic_indicator')
  const metrics = requireMetrics(payload, 'search_economic_indicator')
  const rows = metrics.map((item) => {
    if (!isRecord(item)) throw windError('Wind search_economic_indicator returned a non-object metric', 'wind_invalid_response')
    return metricMeta(item, 'search_economic_indicator')
  })
  return { data: rows, schema: edbSearchOutput }
}

/** Transpose `{metrics:[{meta, date[], value[]}]}` parallel arrays into one row per period; length mismatch fails. */
async function executeEdbQuery(client: WindClient, params: Params, signal: AbortSignal): Promise<{ data: JsonRecord[]; schema: object }> {
  const payload = requirePayload(await client.callTool('query_economic_indicator_data', {
    question: params.indicator,
    beginDate: params.start_date,
    endDate: params.end_date,
  }, signal), 'query_economic_indicator_data')
  const rows: JsonRecord[] = []
  for (const item of requireMetrics(payload, 'query_economic_indicator_data')) {
    if (!isRecord(item)) throw windError('Wind query_economic_indicator_data returned a non-object metric', 'wind_invalid_response')
    const meta = isRecord(item.meta) ? item.meta : item
    const context = `query_economic_indicator_data(${windText(meta.code) ?? String(params.indicator)})`
    const base = metricMeta(meta, context)
    if (item.date === undefined && item.value === undefined) continue
    const { date, value } = item
    if (!Array.isArray(date) || !Array.isArray(value) || date.length !== value.length) {
      throw windError(`Wind ${context} returned ${Array.isArray(date) ? date.length : 'non-array'} dates beside ${Array.isArray(value) ? value.length : 'non-array'} values`, 'wind_invalid_response')
    }
    for (let index = 0; index < date.length; index += 1) {
      const reportDate = compactDate(date[index], context)
      if (reportDate === null) throw windError(`Wind ${context} has a missing period at row ${index}`, 'wind_invalid_response')
      rows.push({ ...base, report_date: reportDate, report_date_ms: reportDateMs(reportDate), value: windNumber(value[index], context, 'value') })
    }
  }
  return { data: rows, schema: edbQueryOutput }
}

/** K-line timestamps must carry an explicit offset (exchange local time); `Date.parse` would guess host TZ. */
function klineInstant(value: unknown, context: string): { datetime: string; time_ms: number } {
  const text = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    throw windError(`Wind ${context} has a timestamp without an explicit UTC offset: ${JSON.stringify(text.slice(0, 40))}`, 'wind_invalid_response')
  }
  const epoch = Date.parse(text)
  if (Number.isNaN(epoch)) throw windError(`Wind ${context} has an unparseable timestamp ${JSON.stringify(text)}`, 'wind_invalid_response')
  return { datetime: text, time_ms: epoch }
}

async function executeKline(client: WindClient, params: Params, signal: AbortSignal): Promise<{ data: JsonRecord[]; schema: object }> {
  const period = String(params.period)
  const adjust = String(params.adjust)
  const code = String(params.code)
  const args: Record<string, unknown> = {
    windcode: code,
    begin_date: params.start_date,
    end_date: params.end_date,
    period: KLINE_PERIOD_CODES[period],
    aftype: adjust === 'qfq' ? '0' : '2',
  }
  // qfq needs afdate within the range or it hangs 60s. Lock to today; hfq is not exposed.
  if (adjust === 'qfq') args.afdate = isoDateFromEpoch(Date.now(), 'Asia/Shanghai')
  const payload = requirePayload(await client.callTool('get_stock_kline', args, signal), 'get_stock_kline')
  const table = requireTable(payload, 'get_stock_kline')
  if (table.rows.length === 0) return { data: [], schema: klineOutput }
  const at = KLINE_REQUIRED.reduce<Record<string, number>>((acc, name) => ({ ...acc, [name]: columnIndex(table, name, 'get_stock_kline') }), {})
  const turnoverAt = optionalColumnIndex(table, KLINE_TURNOVER)
  const volumeAt = optionalColumnIndex(table, KLINE_VOLUME)
  const rateAt = optionalColumnIndex(table, KLINE_RATE)
  const avgAt = optionalColumnIndex(table, KLINE_AVG)
  const context = `get_stock_kline(${code})`
  const cell = (row: unknown[], index: number): unknown => (index >= 0 && index < row.length ? row[index] : null)
  const rows: JsonRecord[] = table.rows.map((row) => {
    const instant = klineInstant(cell(row, at[KLINE_TIME]), context)
    const open = windNumber(cell(row, at[KLINE_OPEN]), context, KLINE_OPEN)
    const close = windNumber(cell(row, at[KLINE_MATCH]), context, KLINE_MATCH)
    const high = windNumber(cell(row, at[KLINE_HIGH]), context, KLINE_HIGH)
    const low = windNumber(cell(row, at[KLINE_LOW]), context, KLINE_LOW)
    for (const [name, value] of [[KLINE_OPEN, open], [KLINE_MATCH, close], [KLINE_HIGH, high], [KLINE_LOW, low]] as const) {
      if (value === null) throw windError(`Wind ${context} has a missing ${name} inside a non-empty row`, 'wind_invalid_response')
    }
    if ((high as number) < (low as number)) throw windError(`Wind ${context} ${instant.datetime} has high < low`, 'wind_invalid_response')
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
    }
  })
  return { data: rows, schema: klineOutput }
}

const nullableNumber = { oneOf: [{ type: 'number' }, { type: 'null' }] }
const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] }

const metricMetaProperties = {
  code: { type: 'string', description: 'Wind EDB 指标代码（如 M0000612），取数时原样填进 wind_edb_query 的 indicator' },
  name: { ...nullableString, description: '指标全称原文（中文，含口径与期间）' },
  unit: { ...nullableString, description: '上游标的单位原文（亿元 / % …）；该族没有这个键时为 null，不猜单位' },
  freq: { ...nullableString, description: '频率原文（日/周/月/季/半年/年，中文字面量）' },
  source: { ...nullableString, description: '数据来源原文（国家统计局 / 美联储 …）' },
}

const metricSeriesProperties = {
  update_date: { ...nullableString, description: '该指标**最后一次更新日期**（YYYY-MM-DD），不是本 Dataset 的时间序列' },
  series_begin_date: { ...nullableString, description: '该指标序列的最早期间' },
  series_end_date: { ...nullableString, description: '该指标序列的最新期间：要"最新的数"就到这里为止' },
  magnitude: { ...nullableString, description: '量纲原文（亿 / 万 …），单位可能为 % 的指标族不给这一键' },
  currency: { ...nullableString, description: '币种原文（人民币 / 美元 …）' },
}

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
}

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
}

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
}

function normalizeEdbSearch(params: Params): Params {
  const question = typeof params.question === 'string' ? params.question.trim().replace(/\s+/g, ' ') : ''
  if (question.length === 0) throw new Error('parameter question is required')
  if (question.length > 500) throw new Error('parameter question must be at most 500 characters')
  return { question }
}

function normalizeEdbQuery(params: Params): Params {
  // observation is rejected explicitly: it returns 2 periods for 3 requested, so counts are untrustworthy.
  if (params.observation !== undefined) throw new Error('parameter observation is not supported: 实测该口径给 3 期只回 2 期，期数不可信；请给 start_date 与 end_date')
  const raw = typeof params.indicator === 'string' ? params.indicator.trim() : ''
  if (raw.length === 0) throw new Error('parameter indicator is required')
  if (raw.length > 200) throw new Error('parameter indicator must be at most 200 characters')
  if (/[,，]/.test(raw)) throw new Error('parameter indicator accepts exactly one indicator: 2026-10-06 实测逗号分隔的多码挂满 60 秒无应答，要多个指标请分次调用')
  const start_date = strictDate(params.start_date, 'start_date')
  const end_date = strictDate(params.end_date, 'end_date')
  if (start_date > end_date) throw new Error('parameter start_date must not be later than end_date')
  return { indicator: raw.replace(/\s+/g, ' '), start_date, end_date }
}

/** Codes are taken as Wind spells them, never with a guessed exchange suffix: AAPL.O and AAPL.N return identical rows. */
function normalizeWindCode(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!/^[A-Z0-9][A-Z0-9.]*\.[A-Z]{1,3}$/.test(raw) || raw.includes('..')) {
    throw new Error('parameter code must carry a Wind exchange suffix (600519.SH / 00700.HK / AAPL.O); 本能力不猜后缀——实测后缀不参与上游解析')
  }
  return raw
}

function normalizeKline(params: Params): Params {
  // count is in `allowed` only to reject it with a reason: its negative/zero semantics are untested.
  if (params.count !== undefined) throw new Error('parameter count is not supported: 本能力按 start_date..end_date 取全区间，count 的正负/零语义（往后 N 条 / 往前 N 条 / 全区间）未实测，不暴露')
  const code = normalizeWindCode(params.code)
  const period = params.period === undefined ? 'day' : String(params.period).trim().toLowerCase()
  if (!Object.prototype.hasOwnProperty.call(KLINE_PERIOD_CODES, period)) {
    throw new Error(`parameter period must be one of ${KLINE_PERIOD_LIST}（每档都有真报文；60 分钟实测两次都挂满超时，不提供）`)
  }
  const adjust = params.adjust === undefined ? (MINUTE_PERIODS.has(period) ? 'none' : 'qfq') : String(params.adjust).trim().toLowerCase()
  if (adjust !== 'none' && adjust !== 'qfq') {
    throw new Error(`parameter adjust must be none or qfq（hfq 不提供：后复权以 afdate 为锚向未来放大，锚点默认成今天会给出一个逐位等于不复权却叫 hfq 的序列）`)
  }
  if (MINUTE_PERIODS.has(period) && adjust !== 'none') {
    throw new Error('parameter adjust must be none for minute periods（分钟档的 qfq/afdate 组合没有打过真报文，不暴露未验证的组合）')
  }
  const start_date = strictDate(params.start_date, 'start_date')
  const end_date = strictDate(params.end_date, 'end_date')
  if (start_date > end_date) throw new Error('parameter start_date must not be later than end_date')
  const span = dayDistance(start_date, end_date)
  const maxSpan = MINUTE_PERIODS.has(period) ? MINUTE_MAX_SPAN_DAYS : DAILY_MAX_SPAN_DAYS
  if (span > maxSpan) throw new Error(`parameter start_date..end_date spans ${span} days; ${MINUTE_PERIODS.has(period) ? 'minute periods accept' : 'day/week/month accept'} at most ${maxSpan} days`)
  if (adjust === 'qfq' && end_date > isoDateFromEpoch(Date.now(), 'Asia/Shanghai')) {
    throw new Error('parameter end_date must not be later than today when adjust=qfq（前复权的 afdate 由本能力锁成当日，而实测 afdate 早于区间会挂满超时）')
  }
  return { code, period, adjust, start_date, end_date }
}


/** Build at definition time is safe: no key (resolved per call), no session; registration is not gated on credentials. */
function createWindSource(options: {
  capability: string
  tool: string
  server: WindServerType
  summary: string
  description: string
  inputSchema: object
  outputSchema: object
  cacheMaxAgeMs: number
  allowed: string[]
  normalize: (params: Params) => Params
  execute: (client: WindClient, params: Params, signal: AbortSignal) => Promise<{ data: unknown; schema: object }>
  resolveApiKey: WindApiKeyResolver
}): DataSource {
  const schema: SchemaDescriptor = {
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
  }
  const client = createWindClient({
    endpoint: WIND_SERVER_ENDPOINTS[options.server],
    timeoutMs: WIND_SOURCE_TIMEOUT_MS,
    resolveApiKey: options.resolveApiKey,
  })
  // normalize runs twice (Hub enqueue and execute), so keep key names and make it idempotent.
  const normalize = (params: unknown): Params => {
    if (!isRecord(params)) throw new Error('params must be an object')
    assertKnown(params, options.allowed)
    return options.normalize(params)
  }
  return {
    schema,
    normalizeParams: normalize,
    validateOutput: (data) => Array.isArray(data),
    execute: (request: DataRequest, signal: AbortSignal) => options.execute(client, normalize(request.params), signal),
  }
}

const EDB_SEARCH_DESCRIPTION = 'Wind EDB（经济数据库）指标**检索**：只找指标不取数，一行一个候选指标（code/name/unit/freq/source + 该序列的起止与更新日期）。这是 fuyao 与东财都没有的面：宏观、行业、汇率、全球序列。⛔ question 走后端 NER，字面请求不等于字面结果——实测「人民币兑美元汇率 指标」回的是**美元兑人民币**（source 为 美联储 / 台湾统计局），先核对 name 与 source 再取数。键集随指标族变化：实测汇率类没有 unit/magnitude/currency 三个键，缺的一律 null，不猜单位。取数走 wind_edb_query：确定性靠"先 search 拿 code、再按 code 取数"这两步拿到，不是靠 NL 稳定。没有匹配时返回 0 行，是合法空结果不是失败。'

const EDB_QUERY_DESCRIPTION = 'Wind EDB 时间序列**取数**：上游回 {meta, date[], value[]} 并行数组，本能力转置成**一行一个观测期**（meta 逐行拼接，多指标可分次取后按 code 拼对比）。⛔ indicator 一次只填**一个**指标代码或一条中文问句：2026-10-06 实测逗号分隔的多码挂满 60 秒无应答，上游"多个代码用英文逗号分隔"的说法不成立，要多个就分次调用。start_date/end_date 必填——上游在日期区间与 observation 之间二选一，而 observation 实测"给 3 期只回 2 期"、期数不可信，本能力直接拒绝它。report_date 由上游紧凑串 20260731 归一而来，report_date_ms 按 Asia/Shanghai 零点（EDB 的日期本身没有时区）。unit 是上游单位原文；后端 INVALID 一律 null，**不得当 0 参与计算**。已实测指标代码直接当 indicator 与同义中文问句回同一份序列（M0000612 = 中国 CPI 当月同比）：先 wind_edb_search 拿码再回来，确定性就在这两步。'

const KLINE_DESCRIPTION = 'Wind K 线：单只标的按**日期区间**取 日/周/月 与 1/5/15/30 分钟。相对腾讯的增量（§6.6.1）：按日期区间取 640 根之前的历史、每根带成交额/成交量/换手/均价的美股 K 线、以及分钟档；⚠️ **分钟档只有 A 股取到过行**，港股与美股的分钟到 2026-10-06 为止四次全挂、仍未证实，要港美股分时先小范围试一次。港美股日线与快照请走 tencent_*。⛔ code 必须自带交易所后缀（600519.SH / 00700.HK / AAPL.O），本能力不猜后缀——实测 AAPL.O 与 AAPL.N 回完全相同的行（后缀不参与解析），所以 BRK.B 一类双市场代码有认错标的的风险；每行的 code 只是请求写法回显，上游 K 线表里没有代码列。⛔ period 只放逐档打过真报文的七档，60 分钟实测两次都挂满超时、不提供。adjust 只有 none 与 qfq：后复权以 afdate 为锚向未来放大，锚默认成今天会得到一个逐位等于不复权却叫 hfq 的序列，所以宁可不给；qfq 的 afdate 由本能力锁成当日，因此 end_date 不得晚于当日；分钟档只允许 none。close 来自上游 MATCH 列（Wind 没有 CLOSE 列）；上游多给的列不收录，行里以 output_fields 为准。数值列上游全是字符串（columns[].type 却一律写 string），解析不了即失败。time_ms 按**该行自带偏移**换算（A股/港股 +08:00、美股 -04:00 是交易所当地时间），整段按北京时间处理会让美股错位 12 小时。⚠️ volume 实测 A 股是**股**（腾讯 A 股 K 线是手，跨源先换）；turnover_rate_pct 是百分数原值（0.2892 = 0.2892%），上游不给它的单位与分母口径。非交易日快回 0 行、是合法成功（实测 A 股国庆休市日 653ms 回空表）；而"该日该市场分钟尚未落地"与上游故障都表现为挂到 12 秒超时（wind_upstream_timeout）——不要盲目重试同一区间，改更早日期或改走日线。积分计费：AUTH/RATE_LIMIT/后端错误一律不自动重试。'


export function createWindSources(resolveApiKey: WindApiKeyResolver): DataSource[] {
  return [
    createWindSource({
      capability: 'wind_edb_search',
      tool: 'search_economic_indicator',
      server: 'economic_data',
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
  ]
}
