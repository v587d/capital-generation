// 10jqka web JSON reached directly with no key: the 100-row hot list (concept / popularity tags
// that the Fuyao resale API omits) and the limit-up detail pool (board type, seal success rate,
// re-seal flag). Both hosts have an anti-crawl history, so non-2xx, non-JSON and non-zero business
// codes raise instead of degrading to an empty Dataset.
import type { DataRequest, DataSource, SchemaDescriptor } from '../data-collector/hub.js'
import { buildDataKey } from '../data-collector/hub.js'
import { getDataTimeContract } from '../time/tools.js'
import { createRequestThrottle } from '../net/throttle.js'

type Params = Record<string, unknown>
type JsonRecord = Record<string, unknown>
type Throttle = <T>(task: () => Promise<T>) => Promise<T>

const HOT_LIST_URL = 'https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock'
const LIMIT_UP_URL = 'https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool'
const USER_AGENT = 'Mozilla/5.0'
const MIN_INTERVAL_MS = 300
// THS-internal field ids, not derivable. Without them the reply drops latest / change_rate and the
// other price columns; writing a different list changes which fields exist.
const LIMIT_UP_FIELDS = '199112,10,9001,330323,330324,330325,9002,330329,133971,133970,1968584,3475914,9003,9004'
// Board whitelist: main boards + GEM + STAR only. No BJ token is accepted upstream, so BSE limit-ups
// are structurally out of reach for this endpoint.
const LIMIT_UP_FILTER = 'HS,GEM2STAR'
const LIMIT_UP_ORDER_FIELD = '330324'
const LIMIT_UP_ORDER_TYPE = '0'
const MAX_PAGE_SIZE = 200
const DEFAULT_PAGE_SIZE = 200
const HOT_TYPES = ['day', 'hour'] as const
// Beijing has no DST: shift the Unix seconds by +08:00 and read the UTC parts.
const BEIJING_OFFSET_SECONDS = 8 * 3600
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const COMPACT_DATE_PATTERN = /^\d{8}$/
const NUMERIC_TEXT_PATTERN = /^\d+(?:\.\d+)?$/
const CLOCK_PATTERN = /^\d{2}:\d{2}:\d{2}$/

// One serial chain per upstream host: the two hosts share the same anti-crawl budget, and stacking
// requests on either one is what gets 10jqka to answer 401.
const hotListThrottle = createRequestThrottle(MIN_INTERVAL_MS)
const limitUpThrottle = createRequestThrottle(MIN_INTERVAL_MS)

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function thsError(message: string, code = 'ths_source_error'): Error {
  const error = new Error(message)
  ;(error as Error & { code?: string }).code = code
  return error
}

function assertKnown(values: Params, allowed: string[]): void {
  for (const key of Object.keys(values)) if (!allowed.includes(key)) throw new Error(`unsupported parameter: ${key}`)
}

function isCalendarDate(text: string): boolean {
  if (!DATE_PATTERN.test(text)) return false
  const parsed = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text
}

function isoDateFromCompact(compact: string): string {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
}

function compactDate(iso: string): string {
  return iso.replaceAll('-', '')
}

/** The model may send YYYY-MM-DD or YYYYMMDD; canonical output is always YYYY-MM-DD (idempotent). */
function tradeDateParam(value: unknown): string {
  if (typeof value !== 'string') throw new Error('parameter date must be a YYYY-MM-DD string')
  const text = value.trim()
  if (COMPACT_DATE_PATTERN.test(text)) {
    const iso = isoDateFromCompact(text)
    if (isCalendarDate(iso)) return iso
  } else if (isCalendarDate(text)) {
    return text
  }
  throw new Error(`parameter date must be a valid YYYY-MM-DD date, got ${JSON.stringify(value)}`)
}

function integerParam(value: unknown, name: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(parsed)) throw new Error(`parameter ${name} must be an integer`)
  return parsed
}

function pageParam(value: unknown): number {
  const page = integerParam(value, 'page')
  if (page < 1) throw new Error('parameter page must be an integer >= 1')
  return page
}

function sizeParam(value: unknown): number {
  const size = integerParam(value, 'size')
  if (size < 1 || size > MAX_PAGE_SIZE) throw new Error(`parameter size must be an integer from 1 to ${MAX_PAGE_SIZE}`)
  return size
}

async function fetchJson(url: string, throttle: Throttle, label: string, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted()
  return throttle(async () => {
    let response: Response
    try {
      response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/plain, */*' }, signal })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw thsError(`${label} request failed: ${error instanceof Error ? error.message : String(error)}`, 'ths_http_error')
    }
    const text = await response.text()
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403 ? ' (10jqka anti-crawl challenge: do not retry in a loop)' : ''
      throw thsError(`${label} returned HTTP ${response.status}${hint}`, response.status === 429 ? 'ths_rate_limit' : 'ths_http_error')
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw thsError(`${label} returned non-JSON: ${JSON.stringify(text.slice(0, 120))}`, 'ths_invalid_response')
    }
  })
}

/**
 * Success is `{status_code:0, status_msg:"success", data}`; parameter errors come back as
 * `{code:-1, msg:"Param Error."}` under HTTP 200. Both shapes must fail loudly.
 */
function assertEnvelope(payload: unknown, label: string): JsonRecord {
  if (!isRecord(payload)) throw thsError(`${label} response is not a JSON object`, 'ths_invalid_response')
  if (payload.status_code !== undefined && Number(payload.status_code) !== 0) {
    throw thsError(`${label} failed: ${String(payload.status_msg ?? payload.status_code)} (status_code ${String(payload.status_code)})`, 'ths_upstream_error')
  }
  if (payload.status_code === undefined && payload.code !== undefined && Number(payload.code) !== 0) {
    throw thsError(`${label} failed: ${String(payload.msg ?? payload.message ?? payload.code)} (code ${String(payload.code)})`, 'ths_upstream_error')
  }
  return payload
}

function requiredText(value: unknown, field: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw thsError(`${label} has an empty ${field}`, 'ths_invalid_response')
  return value.trim()
}

function optionalText(value: unknown, field: string, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw thsError(`${label} has a non-text ${field}: ${JSON.stringify(value)}`, 'ths_invalid_response')
  const text = value.trim()
  return text === '' ? null : text
}

function optionalNumber(value: unknown, field: string, label: string): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw thsError(`${label} has a non-numeric ${field}: ${JSON.stringify(value)}`, 'ths_invalid_response')
  return value
}

function requiredNumber(value: unknown, field: string, label: string): number {
  const parsed = optionalNumber(value, field, label)
  if (parsed === null) throw thsError(`${label} is missing ${field}`, 'ths_invalid_response')
  return parsed
}

function beijingDateTime(epochSeconds: number): { date: string; clock: string } {
  const shifted = new Date((epochSeconds + BEIJING_OFFSET_SECONDS) * 1000).toISOString()
  return { date: shifted.slice(0, 10), clock: shifted.slice(11, 19) }
}

/** Seal times are Unix seconds (strings), not HHMMSS integers; output is Beijing HH:MM:SS. */
function sealClock(value: unknown, upstreamDate: string, field: string, label: string): string | null {
  if (value === null || value === undefined || value === '') return null
  const seconds = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw thsError(`${label} has an unreadable ${field}: ${JSON.stringify(value)}`, 'ths_invalid_response')
  const { date, clock } = beijingDateTime(seconds)
  const expected = isoDateFromCompact(upstreamDate)
  if (date !== expected) throw thsError(`${label} ${field} ${seconds} falls on ${date}, not the trading day ${expected}`, 'ths_invalid_response')
  return clock
}

const HOT_KEYS = ['rank', 'code', 'name', 'rank_change', 'heat', 'change_pct', 'concepts', 'popularity_tag']
const LIMIT_UP_KEYS = [
  'code', 'name', 'price', 'change_pct', 'reason', 'board_type', 'seal_rate', 'break_times',
  'seal_amount', 'seal_volume', 'high_days', 'first_seal', 'last_seal', 'is_again', 'turnover_rate_pct',
]

// Nullable shapes carry a description: hub.ts turns output_schema properties into the catalog
// field dictionary, and an undocumented column reads as "not declared".
function nullableText(description: string): JsonRecord {
  return { oneOf: [{ type: 'string' }, { type: 'null' }], description }
}
function nullableNumber(description: string): JsonRecord {
  return { oneOf: [{ type: 'number' }, { type: 'null' }], description }
}
function nullableInteger(description: string): JsonRecord {
  return { oneOf: [{ type: 'integer' }, { type: 'null' }], description }
}

function rowSchema(properties: JsonRecord, required: string[]): JsonRecord {
  return { type: 'object', properties, required, additionalProperties: false }
}

const hotListOutput = {
  type: 'array',
  items: rowSchema({
    rank: { type: 'integer', minimum: 1, description: '榜内排名（上游 order，实测 1..100 连续）' },
    code: { type: 'string', description: '6 位 A 股代码，不带市场后缀' },
    name: { type: 'string', description: '证券简称' },
    rank_change: nullableInteger('排名变化：正数上升、负数下降、0 不变；上游缺失为 null'),
    heat: { type: 'string', description: '人气值，上游原始字符串（不转数值，"215825.0" 的尾数照抄）' },
    change_pct: nullableNumber('涨跌幅百分数原值：1.9608 = +1.9608%'),
    concepts: { type: 'array', items: { type: 'string' }, description: '概念标签（tag.concept_tag）；无标签为空数组' },
    popularity_tag: nullableText('人气标签（tag.popularity_tag，如 2天1板）；无则 null'),
  }, HOT_KEYS),
}

const limitUpOutput = {
  type: 'array',
  items: rowSchema({
    code: { type: 'string', description: '6 位 A 股代码，不带市场后缀（不含北交所）' },
    name: { type: 'string', description: '证券简称' },
    price: { type: 'number', description: '最新价，元' },
    change_pct: { type: 'number', description: '涨跌幅百分数原值：10.0228 = +10.0228%' },
    reason: nullableText('涨停原因题材（上游 reason_type）；上游缺失为 null'),
    board_type: { type: 'string', description: '板型：换手板 / 一字板 / T字板（实测三值）' },
    seal_rate: nullableNumber('封板成功率，0~1 小数（0.8 = 80%）；null = 上游未给，不是 0'),
    break_times: nullableInteger('开板（炸板）次数；null = 上游未给，不是 0'),
    seal_amount: { type: 'number', description: '封单额，元' },
    seal_volume: nullableInteger('封单量，股；上游缺失为 null'),
    high_days: { type: 'string', description: '几天几板字符串：首板 / 3天2板 / 7天4板；不是连板数' },
    first_seal: nullableText('首次封板时间，北京时间 HH:MM:SS（上游 Unix 秒换算）'),
    last_seal: nullableText('最后封板时间，北京时间 HH:MM:SS（上游 Unix 秒换算）'),
    is_again: { type: 'integer', enum: [0, 1], description: '上游 is_again_limit 原值：1=回封，0=非回封' },
    turnover_rate_pct: { type: 'number', description: '换手率百分数原值：27.7729 = 27.7729%' },
  }, LIMIT_UP_KEYS),
}

const hotListInput = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: [...HOT_TYPES], description: '榜单周期：day 日榜（默认）/ hour 小时榜' },
  },
  required: [],
  additionalProperties: false,
}

const limitUpInput = {
  type: 'object',
  properties: {
    date: { type: 'string', description: '交易日 YYYY-MM-DD（也收 YYYYMMDD，归一成 YYYY-MM-DD）；省略 = 上游最近交易日' },
    page: { type: 'integer', minimum: 1, description: '页码，从 1 开始，默认 1' },
    size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, description: `单页条数 1~${MAX_PAGE_SIZE}，默认 ${DEFAULT_PAGE_SIZE}` },
  },
  required: [],
  additionalProperties: false,
}

function normalizeHotList(params: Params): Params {
  const type = params.type === undefined ? 'day' : String(params.type).trim().toLowerCase()
  if (!HOT_TYPES.includes(type as (typeof HOT_TYPES)[number])) throw new Error(`parameter type must be one of ${HOT_TYPES.join(', ')}`)
  return { type }
}

function normalizeLimitUp(params: Params): Params {
  // Defaults are materialized so `{}` and `{page:1,size:200}` share one Dataset.
  const normalized: Params = { page: params.page === undefined ? 1 : pageParam(params.page), size: params.size === undefined ? DEFAULT_PAGE_SIZE : sizeParam(params.size) }
  if (params.date !== undefined) normalized.date = tradeDateParam(params.date)
  return normalized
}

function mapHotRow(item: unknown, index: number, label: string): JsonRecord {
  const rowLabel = `${label} row ${index + 1}`
  if (!isRecord(item)) throw thsError(`${rowLabel} is not an object`, 'ths_invalid_response')
  const rank = item.order
  if (typeof rank !== 'number' || !Number.isSafeInteger(rank) || rank < 1) throw thsError(`${rowLabel} has an unreadable order: ${JSON.stringify(item.order)}`, 'ths_invalid_response')
  const code = typeof item.code === 'string' ? item.code.trim() : ''
  if (!/^\d{6}$/.test(code)) throw thsError(`${rowLabel} has an unreadable code: ${JSON.stringify(item.code)}`, 'ths_invalid_response')
  const name = requiredText(item.name, 'name', rowLabel)
  // Keep the upstream string (no numeric conversion): "215825.0" and "5007268" are both spellings
  // of the same field, and Number() would drop the trailing ".0".
  const heat = item.rate
  if (typeof heat !== 'string' || !NUMERIC_TEXT_PATTERN.test(heat.trim())) throw thsError(`${rowLabel} has an unreadable rate: ${JSON.stringify(item.rate)}`, 'ths_invalid_response')
  const rankChange = optionalNumber(item.hot_rank_chg, 'hot_rank_chg', rowLabel)
  if (rankChange !== null && !Number.isSafeInteger(rankChange)) throw thsError(`${rowLabel} has a non-integer hot_rank_chg: ${JSON.stringify(item.hot_rank_chg)}`, 'ths_invalid_response')
  const changePct = optionalNumber(item.rise_and_fall, 'rise_and_fall', rowLabel)
  const tag = item.tag
  const concepts: string[] = []
  let popularityTag: string | null = null
  if (tag !== null && tag !== undefined) {
    if (!isRecord(tag)) throw thsError(`${rowLabel} tag is not an object`, 'ths_invalid_response')
    const conceptTag = tag.concept_tag
    if (conceptTag !== null && conceptTag !== undefined) {
      if (!Array.isArray(conceptTag)) throw thsError(`${rowLabel} tag.concept_tag is not an array`, 'ths_invalid_response')
      for (const entry of conceptTag) {
        if (typeof entry !== 'string') throw thsError(`${rowLabel} tag.concept_tag has a non-text entry: ${JSON.stringify(entry)}`, 'ths_invalid_response')
        const text = entry.trim()
        if (text !== '') concepts.push(text)
      }
    }
    popularityTag = optionalText(tag.popularity_tag, 'tag.popularity_tag', rowLabel)
  }
  return { rank, code, name, rank_change: rankChange, heat: heat.trim(), change_pct: changePct, concepts, popularity_tag: popularityTag }
}

function mapLimitUpRow(item: unknown, upstreamDate: string, label: string): JsonRecord {
  if (!isRecord(item)) throw thsError(`${label} is not an object`, 'ths_invalid_response')
  const code = typeof item.code === 'string' ? item.code.trim() : ''
  if (!/^\d{6}$/.test(code)) throw thsError(`${label} has an unreadable code: ${JSON.stringify(item.code)}`, 'ths_invalid_response')
  const name = requiredText(item.name, 'name', label)
  const price = requiredNumber(item.latest, 'latest', label)
  if (price <= 0) throw thsError(`${label} has a non-positive latest price: ${price}`, 'ths_invalid_response')
  const changePct = requiredNumber(item.change_rate, 'change_rate', label)
  const reason = optionalText(item.reason_type, 'reason_type', label)
  const boardType = requiredText(item.limit_up_type, 'limit_up_type', label)
  // Seal success rate is a 0..1 ratio; null means "upstream has no value" and must not become 0.
  const sealRate = optionalNumber(item.limit_up_suc_rate, 'limit_up_suc_rate', label)
  if (sealRate !== null && (sealRate < 0 || sealRate > 1)) throw thsError(`${label} has limit_up_suc_rate ${sealRate} outside 0..1`, 'ths_invalid_response')
  const breakTimes = optionalNumber(item.open_num, 'open_num', label)
  if (breakTimes !== null && (!Number.isSafeInteger(breakTimes) || breakTimes < 0)) throw thsError(`${label} has an unreadable open_num: ${JSON.stringify(item.open_num)}`, 'ths_invalid_response')
  const sealAmount = requiredNumber(item.order_amount, 'order_amount', label)
  if (sealAmount < 0) throw thsError(`${label} has a negative order_amount: ${sealAmount}`, 'ths_invalid_response')
  const sealVolume = optionalNumber(item.order_volume, 'order_volume', label)
  if (sealVolume !== null && (!Number.isSafeInteger(sealVolume) || sealVolume < 0)) throw thsError(`${label} has an unreadable order_volume: ${JSON.stringify(item.order_volume)}`, 'ths_invalid_response')
  const highDays = requiredText(item.high_days, 'high_days', label)
  const firstSeal = sealClock(item.first_limit_up_time, upstreamDate, 'first_limit_up_time', label)
  const lastSeal = sealClock(item.last_limit_up_time, upstreamDate, 'last_limit_up_time', label)
  const isAgain = item.is_again_limit
  if (isAgain !== 0 && isAgain !== 1) throw thsError(`${label} has an unreadable is_again_limit: ${JSON.stringify(item.is_again_limit)}`, 'ths_invalid_response')
  const turnoverPct = requiredNumber(item.turnover_rate, 'turnover_rate', label)
  return {
    code,
    name,
    price,
    change_pct: changePct,
    reason,
    board_type: boardType,
    seal_rate: sealRate,
    break_times: breakTimes,
    seal_amount: sealAmount,
    seal_volume: sealVolume,
    high_days: highDays,
    first_seal: firstSeal,
    last_seal: lastSeal,
    is_again: isAgain,
    turnover_rate_pct: turnoverPct,
  }
}

async function executeHotList(params: Params, signal: AbortSignal): Promise<{ data: JsonRecord[]; schema: object }> {
  const type = String(params.type)
  const label = `THS hot list (${type})`
  const search = new URLSearchParams({ stock_type: 'a', type, list_type: 'normal' })
  const payload = await fetchJson(`${HOT_LIST_URL}?${search.toString()}`, hotListThrottle, label, signal)
  const envelope = assertEnvelope(payload, label)
  const data = envelope.data
  if (!isRecord(data) || !Array.isArray(data.stock_list)) throw thsError(`${label} response has no data.stock_list array`, 'ths_invalid_response')
  return { data: data.stock_list.map((item, index) => mapHotRow(item, index, label)), schema: hotListOutput }
}

async function executeLimitUp(params: Params, signal: AbortSignal): Promise<{ data: JsonRecord[]; schema: object }> {
  const date = typeof params.date === 'string' ? params.date : undefined
  const page = Number(params.page)
  const size = Number(params.size)
  const label = `THS limit-up pool (${date ?? 'latest'})`
  const search = new URLSearchParams({
    page: String(page),
    limit: String(size),
    field: LIMIT_UP_FIELDS,
    filter: LIMIT_UP_FILTER,
    order_field: LIMIT_UP_ORDER_FIELD,
    order_type: LIMIT_UP_ORDER_TYPE,
  })
  if (date !== undefined) search.set('date', compactDate(date))
  const payload = await fetchJson(`${LIMIT_UP_URL}?${search.toString()}`, limitUpThrottle, label, signal)
  const envelope = assertEnvelope(payload, label)
  const data = envelope.data
  if (!isRecord(data)) throw thsError(`${label} response has no data object`, 'ths_invalid_response')
  const upstreamDate = typeof data.date === 'string' ? data.date : ''
  if (!COMPACT_DATE_PATTERN.test(upstreamDate) || !isCalendarDate(isoDateFromCompact(upstreamDate))) {
    throw thsError(`${label} has an unreadable data.date: ${JSON.stringify(data.date)}`, 'ths_invalid_response')
  }
  if (date !== undefined && compactDate(date) !== upstreamDate) throw thsError(`${label} ignored date ${date}: upstream returned ${upstreamDate}`, 'ths_invalid_response')
  const pageMeta = data.page
  if (!isRecord(pageMeta)) throw thsError(`${label} response has no data.page object`, 'ths_invalid_response')
  const total = pageMeta.total
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) throw thsError(`${label} has an unreadable data.page.total: ${JSON.stringify(pageMeta.total)}`, 'ths_invalid_response')
  const info = data.info
  if (!Array.isArray(info)) throw thsError(`${label} response has no data.info array`, 'ths_invalid_response')
  // Non-trading day / future date / no limit-ups: HTTP 200 + status_code 0 + info [] is a legal empty.
  // On that path upstream echoes page 0, so the page guard below only applies to non-empty results.
  if (total === 0) {
    if (info.length !== 0) throw thsError(`${label} says total=0 but returned ${info.length} rows`, 'ths_invalid_response')
    return { data: [], schema: limitUpOutput }
  }
  if (pageMeta.page !== page) throw thsError(`${label} asked for page ${page} but upstream served page ${JSON.stringify(pageMeta.page)}: out-of-range pages fall back to the last page (with 0 rows), keep page <= ceil(total/size)`, 'ths_page_out_of_range')
  if (pageMeta.limit !== size) throw thsError(`${label} asked for size ${size} but upstream served ${JSON.stringify(pageMeta.limit)} rows per page`, 'ths_invalid_response')
  if (info.length === 0) throw thsError(`${label} says total=${total} but returned 0 rows`, 'ths_invalid_response')
  if (info.length > size) throw thsError(`${label} returned ${info.length} rows for size ${size}`, 'ths_invalid_response')
  return { data: info.map((item, index) => mapLimitUpRow(item, upstreamDate, `${label} row ${index + 1}`)), schema: limitUpOutput }
}

function isFiniteNumberOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isIntegerInRangeOrNull(value: unknown, minimum: number): boolean {
  return value === null || (Number.isSafeInteger(value) && Number(value) >= minimum)
}

/** HH:MM:SS with real hour/minute/second ranges; shape alone would accept 24:00:00. */
function isClockText(value: unknown): boolean {
  if (typeof value !== 'string' || !CLOCK_PATTERN.test(value)) return false
  const [hour, minute, second] = value.split(':').map(Number)
  return hour <= 23 && minute <= 59 && second <= 59
}

function isHotRow(row: unknown): boolean {
  return isRecord(row)
    && Object.keys(row).length === HOT_KEYS.length
    && Number.isSafeInteger(row.rank) && Number(row.rank) >= 1
    && typeof row.code === 'string' && /^\d{6}$/.test(row.code)
    && typeof row.name === 'string' && row.name.length > 0
    && (row.rank_change === null || Number.isSafeInteger(row.rank_change))
    && typeof row.heat === 'string' && NUMERIC_TEXT_PATTERN.test(row.heat)
    && isFiniteNumberOrNull(row.change_pct)
    && Array.isArray(row.concepts) && row.concepts.every((entry) => typeof entry === 'string')
    && (row.popularity_tag === null || (typeof row.popularity_tag === 'string' && row.popularity_tag.length > 0))
}

function isLimitUpRow(row: unknown): boolean {
  return isRecord(row)
    && Object.keys(row).length === LIMIT_UP_KEYS.length
    && typeof row.code === 'string' && /^\d{6}$/.test(row.code)
    && typeof row.name === 'string' && row.name.length > 0
    && typeof row.price === 'number' && Number.isFinite(row.price) && row.price > 0
    && typeof row.change_pct === 'number' && Number.isFinite(row.change_pct)
    && (row.reason === null || (typeof row.reason === 'string' && row.reason.length > 0))
    && typeof row.board_type === 'string' && row.board_type.length > 0
    && isFiniteNumberOrNull(row.seal_rate) && (row.seal_rate === null || (Number(row.seal_rate) >= 0 && Number(row.seal_rate) <= 1))
    && isIntegerInRangeOrNull(row.break_times, 0)
    && typeof row.seal_amount === 'number' && Number.isFinite(row.seal_amount) && row.seal_amount >= 0
    && isIntegerInRangeOrNull(row.seal_volume, 0)
    && typeof row.high_days === 'string' && row.high_days.length > 0
    && (row.first_seal === null || isClockText(row.first_seal))
    && (row.last_seal === null || isClockText(row.last_seal))
    && (row.is_again === 0 || row.is_again === 1)
    && typeof row.turnover_rate_pct === 'number' && Number.isFinite(row.turnover_rate_pct)
}

function createSource(options: {
  capability: string
  name: string
  summary: string
  description: string
  inputSchema: object
  outputSchema: object
  paginated: boolean
  cacheMaxAgeMs: number
  allowed: string[]
  normalize: (params: Params) => Params
  isRow: (row: unknown) => boolean
  execute: (params: Params, signal: AbortSignal) => Promise<{ data: unknown; schema: object }>
}): DataSource {
  const schema: SchemaDescriptor = {
    capability: options.capability,
    time_contract: getDataTimeContract(options.capability),
    name: options.name,
    source: `http:ths.${options.capability}`,
    data_key: buildDataKey('ths', 'http', options.capability),
    source_label: 'ths',
    paginated: options.paginated,
    cacheMaxAgeMs: options.cacheMaxAgeMs,
    rowShape: { rootArray: true },
    summary: options.summary,
    description: options.description,
    input_schema: options.inputSchema,
    output_schema: options.outputSchema,
  }
  const normalize = (params: unknown): Params => {
    if (!isRecord(params)) throw new Error('params must be an object')
    assertKnown(params, options.allowed)
    return options.normalize(params)
  }
  return {
    schema,
    normalizeParams: normalize,
    // Empty arrays are legal for both capabilities (non-trading day); row shape is still enforced.
    validateOutput: (data) => Array.isArray(data) && data.every(options.isRow),
    execute: async (request: DataRequest, signal: AbortSignal) => options.execute(normalize(request.params), signal),
  }
}

export function createThsSources(): DataSource[] {
  return [
    createSource({
      capability: 'ths_hot_list',
      name: 'get_ths_hot_list',
      summary: '同花顺热榜 100 行（含概念/人气标签，网页直连）',
      description: '同花顺网页直连热榜（dq.10jqka.com.cn，零 key；实测 2026-11-22 17:15 的 day / hour 两榜各 100 行）。一行一只票，按 rank 升序（= 上游 order，实测 1..100 连续无重复）。⛔ 与 Fuyao `hot_stock_list` 同为同花顺热榜但来源不同：Fuyao 是转售 API（只有 thscode/ticker/name/rank/heat/rank_change/rank_trend，**没有概念标签 / 人气标签**），本能力是网页直连（concepts 来自 tag.concept_tag、popularity_tag 来自 tag.popularity_tag）；实测 2026-11-22 17:15 同一时刻 day / hour 两榜前 30 名的 name / rank / heat / rank_change 与 Fuyao **逐行一致（30/30，heat 原串也一致，如 day 榜 "5007268"、hour 榜 "215825.0"）**，但 Fuyao 只截 Top30、本能力 100 行；⛔ 热榜是实时快照，两次请求之间数值会变（实测 hour 榜金科股份 rate 17:15 为 215825.0、17:19 为 212497.0），跨来源 / 跨时刻对账必须先确认是同一份快照，不一致时禁止混用。rank_change 与 Fuyao rank_change 同字段同值（实测 30/30），语义沿用：正数=排名上升、负数=下降、0=不变。单位与口径：heat 是上游**字符串**人气值，原串保留、不转数字（day 榜 "5007268"、hour 榜 "215825.0"，转数值会丢尾零 / 改写精度）；change_pct 是**百分数原值**（实测 rise_and_fall 1.9608 = +1.9608%；同日用 tencent_quote 对 000656 得 pct 1.96、用 ftshare_ashare_quote 得 change_rate 0.0196078431372549（比例）×100 = 1.9607843%，三方一致）；0 是真实值（平盘），不是缺失。concepts 来自 tag.concept_tag（text[]，无标签时为空数组 []）；popularity_tag 来自 tag.popularity_tag（如「2天1板」「持续上榜」，实测 100 行里 62~66 行没有该字段 → null，不是空串）。⛔ type 只有 day / hour 两档（省略默认 day；其它值上游回 {code:-1,msg:"Param Error."} 且本层在参数层先拒）；**榜单是快照：无分页（实测 page=2 仍回同一份 100 行）、无历史**——历史排行用 Fuyao `hot_stock_history`、单票排名走势用 Fuyao `hot_stock_rank_trend`。失败语义：HTTP 非 2xx / 非 JSON / 上游 code 或 status_code 非 0 一律响亮失败（同花顺有反爬史，401/403 不要循环重试）；stock_list 为空按合法空返回、不伪造行（实测恒 100 行，回 0 行应视为上游异常）。行内不含榜单时间，新鲜度看 Dataset 的 captured_at。未收录上游字段：market / topic / analyse / analyse_title。',
      inputSchema: hotListInput,
      outputSchema: hotListOutput,
      paginated: false,
      cacheMaxAgeMs: 30_000,
      allowed: ['type'],
      normalize: normalizeHotList,
      isRow: isHotRow,
      execute: executeHotList,
    }),
    createSource({
      capability: 'ths_limit_up_detail',
      name: 'get_ths_limit_up_detail',
      summary: '同花顺涨停揭秘（板型/封板成功率/是否回封）',
      description: '同花顺涨停揭秘（data.10jqka.com.cn 网页 JSON，零 key）：按交易日取涨停个股，补上 Fuyao `limit_up_pool` 没有的三列——**board_type（板型：实测 换手板 / 一字板 / T字板）、seal_rate（封板成功率 0~1 小数）、is_again（是否回封 0/1）**；另有 reason（涨停原因题材）/ price / change_pct / turnover_rate_pct / seal_amount / seal_volume / break_times / high_days / first_seal / last_seal。⛔ 与 Fuyao `limit_up_pool` 是两家口径、必须并存：Fuyao 有连板数（continue_day_cnt）/ 封板资金（seal_money）/ 涨停原因，但**没有板型 / 封板成功率 / 是否回封**；本能力**不含北交所**（上游 filter=HS,GEM2STAR 只覆盖沪深主板 + 创业板 + 科创板；实测 2026-11-20 的 28 行 market_type 只有 HS/GEM、无 8/4/92 开头代码，2026-01-05 的 107 行出现 HS/GEM/STAR），也**不含 ST 涨停**（实测与 Fuyao 三个交易日对账：2026-11-20 28 vs 30 差 2 行、2025-11-20 41 vs 49 差 8 行、2026-01-05 107 vs 126 差 19 行，差额**全部**是 ST 股）——北交所与 ST 涨停请用 Fuyao `limit_up_pool`。⛔ 单位 / 口径（全部实测）：price 是最新价（元）；change_pct 是**百分数原值**（10.0228 = +10.0228%，与 Fuyao price_change_ratio_pct、tencent_quote pct、ftshare_ashare_quote change_rate×100 三方一致）；turnover_rate_pct 是**百分数原值**（27.7729 = 27.7729%，同 tencent_quote turnover 27.77）；seal_rate 是**0~1 小数比例**（0.8 = 80%，1 = 100%；**null = 上游未给**（实测 2026-01-05 的 107 行里 14 行 null），不是 0；2026-11-20 国光股份 0 是真实值）；seal_amount 单位**元**（实测 2026-11-20 全 28 行 = seal_volume × price，偏差 ≤5 元为上游取整、最大实测 4.25 元）；seal_volume 单位**股**；break_times 是开板（炸板）次数，**null 不是 0**（实测连 LIMIT_BACK 的行也有 null，不能用它反推开板次数）；high_days 是**字符串**（首板 / 3天2板 / 7天4板 / 15天13板），⛔ **不是连板数**（实测 2026-11-20 好当家 THS「7天4板」而 Fuyao continue_day_cnt=1「首板」）；is_again 是上游 is_again_limit 的 0/1 原值；first_seal / last_seal 由上游 **Unix 秒**（字符串，如 "1795144339"）转北京时间 HH:MM:SS（1795144339 → 11:12:19；实测与 Fuyao limit_up_time 的 HH:MM 逐行一致：2026-11-20 28/28、2026-01-05 107/107），⛔ **不是东财四池的 HHMMSS 整数**；时间戳换算出的北京日期必须等于响应 data.date，否则按结构异常失败。参数：date 省略 = 上游最近交易日（实测 2026-11-22 周日省略 → data.date=20261120；行内不带日期列，要确定业务日期请显式传），YYYY-MM-DD（也收 YYYYMMDD，归一成 YYYY-MM-DD）；实测支持窗口起点 2025-11-07（2025-11-06 及更早回 status_code=-1「date参数不合法」，是**响亮失败不是空**；起点是固定日还是滚动窗未核出）；非交易日 / 未来日期回 status_code=0 + info=[]（合法空）。page / size：page 从 1 开始、size 1~200（实测 size=201 → status_code=-1「limitmust be less than or equal to 200」，上游原文如此），默认 1 / 200，单次只取一页（上游 page 元数据 {limit,total,count=总页数,page}；输出只有本页行，行数 = size 时可能还有下一页）；⛔ 超界 page 上游**回落到最后一页且该页返回 0 行**（实测 page=99&size=10 → 回显 page 3、info=[]；size=200 时只有 1 页 → 回显 page 1），本层核对回显 page，不一致即失败，不静默把别的页当请求页返回。合法空 vs 失败：status_code=0 且 info=[] 才是合法空（非交易日 / 未来日期 / 当日无涨停）；status_code 或 HTTP 非 0、非 JSON、data 结构不对一律响亮失败（同花顺有反爬史，401/403 不要循环重试）。⛔ 响应里的 trade_status 是**查询时刻**的会话状态、不是请求日期的状态（实测周日查 2026-11-20 时 trade_status=non_trading_day 却有 28 行），不要用它判空或判失败。未收录上游字段：market_type / market_id / currency_value（流通市值）/ is_new / change_tag / high_days_value / time_preview，以及 data.limit_up_count / limit_down_count / trade_status。',
      inputSchema: limitUpInput,
      outputSchema: limitUpOutput,
      paginated: true,
      cacheMaxAgeMs: 60_000,
      allowed: ['date', 'page', 'size'],
      normalize: normalizeLimitUp,
      isRow: isLimitUpRow,
      execute: executeLimitUp,
    }),
  ]
}
