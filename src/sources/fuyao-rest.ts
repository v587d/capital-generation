import type { Context } from '@deepseek-ai/cordis'
import type { DataRequest, DataSource, SchemaDescriptor } from '../data-collector/hub.js'
import { buildDataKey } from '../data-collector/hub.js'

const DEFAULT_BASE_URL = 'https://fuyao.aicubes.cn'
type ApiEnvelope = { code?: number; message?: string; request_id?: string; data?: unknown }
type CredentialLike = { resolve(ref: string): Promise<{ value: string } | undefined> }

/** 每次执行时解析 API Key 的注入点：符合 credentials 服务「按次解析、不跨操作缓存」的约定。 */
export type FuyaoApiKeyResolver = () => Promise<string | undefined>

type Params = Record<string, unknown>

/**
 * 参数规范化与校验的契约：
 *
 * - `normalize` 同时完成「未知参数拦截 → 必填检查 → 语义校验 → 规范化」四件事，
 *   并且必须幂等：Hub 会在入队前调用一次（用于 merge key 与 params_digest），
 *   execute 再调用一次（直接调用 source 时也要生效）。
 * - 规范化在 digest 之前发生，保证「语义相同、书写不同」的请求（大小写、空白、
 *   逗号列表中的重复项、可忽略的默认值）命中同一个 Dataset，而不是各写一份。
 * - 所有错误都是本地错误：不发请求、不落盘、不做网络层猜测。
 * - **不注入上游默认值**：省略参数与显式传默认值是两种请求形态，各自的 digest 稳定；
 *   把上游默认值写进本地代码，会让 digest 的含义随上游默认值漂移而悄悄改变。
 */

/** A 股完整代码：六位数字 + 交易所后缀。裸代码会被拒绝（上游禁止自行拼接后缀）。 */
const A_SHARE_CODE = /^\d{6}\.(SH|SZ|BJ)$/
/** 指数代码：交易所指数（`.SH`/`.SZ`）与同花顺指数（`.TI`）。 */
const INDEX_CODE = /^\d{6}\.(SH|SZ|BJ|TI)$/
const EXCHANGES = ['SH', 'SZ', 'BJ']
/**
 * ticker_search 的交易所与资产类型**按官方契约全量放开**（含期货/期权交易所与 futures/options）。
 * 注意这是元数据域：本 preset 主动不接入期货/期权的**数据**端点，但"能否消歧一个代码"与
 * "能否取到它的行情"是两件事——本地收窄枚举只会让上游支持的查询在这里莫名失败。
 */
const SEARCH_EXCHANGES = ['SH', 'SZ', 'BJ', 'SSE', 'SZSE', 'CFFEX', 'SHFE', 'INE', 'DCE', 'CZCE', 'GFEX']
const SEARCH_ASSET_TYPES = ['a-share', 'a-share-index', 'forex', 'fund-otc', 'fund-etf', 'fund-lof', 'fund-reits', 'futures', 'options']
const CATALOG_ASSET_TYPES = ['a-share', 'a-share-index', 'fund-otc', 'fund-etf', 'fund-lof', 'fund-reits', 'forex', 'futures', 'options']
const KLINE_INTERVALS = ['1d']
const ADJUST_MODES = ['none', 'forward', 'backward']
const REPORT_PERIODS = ['annual', 'quarterly']
const AUCTION_STAGES = ['live', 'final']
const SORT_DIRECTIONS = ['asc', 'desc']
const LIMIT_UP_SORT_FIELDS = ['last_price', 'continue_day_cnt', 'seal_money', 'limit_up_time']
const INDEX_TAGS = ['cn_concept', 'region', 'tszs', 'industry']
const RANK_PERIODS = ['day', 'hour']
const ANOMALY_TAGS = ['LIMIT_UP', 'LIMIT_DOWN', 'SHARP_RISE', 'SHARP_FALL', 'RAPID_RALLY', 'RAPID_DECLINE']
const DRAGON_TIGER_BOARDS = ['all', 'org', 'hot_money']
const LIMIT_DOWN_SORT_FIELDS = ['last_limit_time', 'first_limit_time', 'last_price', 'price_change_ratio_pct', 'turnover_ratio_pct']
const LIMIT_BREAK_SORT_FIELDS = ['price_change_ratio_pct', 'open_times', 'last_price', 'turnover_ratio_pct', 'turnover']
/** 个股异动批量查询的原始 token 上限（按文档：去重前校验）。 */
const MAX_ANOMALY_CODES = 50
/** 基金代码：六位数字 + 市场后缀（.OF 场外 / .SH / .SZ）。 */
const FUND_CODE = /^\d{6}\.(OF|SH|SZ)$/
const NAV_RANGES = ['week', 'month', 'tmonth', 'hyear', 'year', 'twoyear', 'tyear', 'fyear']
const NAV_TYPES = ['unit', 'adj', 'unit,adj']
const MERGE_SCOPES = ['all', 'merged', 'separate']
/** 基金场内历史 K 线窗口上限：上游规定最长 5 个自然年（不是 A 股的 10 年）。 */
const MAX_FUND_HISTORY_WINDOW_MS = 1830 * 24 * 60 * 60 * 1000
/** 基金前十大持有人的 limit 上限（实测 0 / 11 / 201 均返回 1003）。 */
const MAX_TOP_HOLDERS_LIMIT = 10
/** 基金经理区间收益的 range 枚举（与 nav 的 8 值枚举不同，只有 5 个）。 */
const MANAGER_RANGES = ['month', 'tmonth', 'year', 'nowyear', 'now']
const OFFERING_SUBSCRIBE = ['active', 'upcoming']

/** 单值参数长度上限；与 queryParams 的硬上限保持一致。 */
const MAX_PARAM_LENGTH = 2048
const MAX_TEXT_LENGTH = 512
/** 批量代码接口的原始 token 上限（按文档：去重前校验）。 */
const MAX_BATCH_CODES = 100
/**
 * 历史 K 线 / 财务时间区间上限：上游规定 end - start 不超过 10 年（超出返回 1003）。
 * 本地用 3660 天（含闰日冗余）保守前置拦截，只挡明显越界，不与上游口径冲突。
 */
const MAX_HISTORY_WINDOW_MS = 3660 * 24 * 60 * 60 * 1000

/** 递归按键排序的规范化 JSON：语义相同、键序不同的 JSON 参数会归一到同一个 digest。 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

/**
 * 需要 URL 编码 JSON 传参的端点（backtest 条件、indicators 选择器、quota 分类）。
 * 校验只做"能解析 + 顶层形状正确 + 长度受限"，不臆造上游的内部字段白名单；
 * 规范化后重新序列化，保证等价 JSON 命中同一 Dataset。
 */
function jsonParam(value: unknown, name: string, kind: 'array' | 'object' | 'object-or-array', maxLength = MAX_PARAM_LENGTH): string {
  const raw = requiredText(value, name, maxLength)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    fail(`parameter ${name} must be a JSON ${kind} string (got unparsable JSON)`)
  }
  const ok = kind === 'array' ? Array.isArray(parsed) : kind === 'object' ? isRecord(parsed) : (Array.isArray(parsed) || isRecord(parsed))
  if (!ok) fail(`parameter ${name} must be a JSON ${kind} string`)
  const encoded = canonicalJson(parsed)
  if (encoded.length > maxLength) fail(`parameter ${name} exceeds maximum length ${maxLength}`)
  return encoded
}

function optionalJsonParam(value: unknown, name: string, kind: 'array' | 'object' | 'object-or-array'): string | undefined {
  if (value === undefined) return undefined
  return jsonParam(value, name, kind)
}

/** 小写枚举的统一规范化：`LIVE` 与 `live` 是同一个请求。 */
const lowerCase = (input: string): string => input.toLowerCase()

function fail(message: string): never {
  throw new Error(message)
}

function paramsObject(value: unknown): Params {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('params must be an object')
  return value as Params
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 未知参数一律拒绝：normalize 会重建参数对象，放行等于静默丢弃模型的拼写错误。 */
function assertKnownParameters(values: Params, allowed: string[]): void {
  for (const name of Object.keys(values)) {
    if (!allowed.includes(name)) fail(`unsupported parameter: ${name}`)
  }
}

function requiredText(value: unknown, name: string, maxLength = MAX_TEXT_LENGTH): string {
  if (value === undefined || value === null || value === '') fail(`missing required parameter: ${name}`)
  return text(value, name, maxLength)
}

function text(value: unknown, name: string, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string') fail(`parameter ${name} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length === 0) fail(`parameter ${name} must not be empty`)
  if (trimmed.length > maxLength) fail(`parameter ${name} exceeds maximum length ${maxLength}`)
  return trimmed
}

function integer(value: unknown, name: string, options: { minimum?: number; maximum?: number } = {}): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(`parameter ${name} must be an integer`)
  if (options.minimum !== undefined && value < options.minimum) fail(`parameter ${name} must be >= ${options.minimum}`)
  if (options.maximum !== undefined && value > options.maximum) fail(`parameter ${name} must be <= ${options.maximum}`)
  return value
}

function requiredInteger(value: unknown, name: string, options: { minimum?: number; maximum?: number } = {}): number {
  if (value === undefined || value === null) fail(`missing required parameter: ${name}`)
  return integer(value, name, options)
}

function numberValue(value: unknown, name: string, options: { minimum?: number } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`parameter ${name} must be a number`)
  if (options.minimum !== undefined && value < options.minimum) fail(`parameter ${name} must be >= ${options.minimum}`)
  return value
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') fail(`parameter ${name} must be a boolean`)
  return value
}

function enumValue(value: unknown, name: string, allowed: string[], normalize: (input: string) => string = (input) => input): string {
  const raw = normalize(text(value, name, 64))
  if (!allowed.includes(raw)) fail(`parameter ${name} has an invalid value: ${raw} (allowed: ${allowed.join(', ')})`)
  return raw
}

function requiredEnum(value: unknown, name: string, allowed: string[], normalize?: (input: string) => string): string {
  if (value === undefined || value === null || value === '') fail(`missing required parameter: ${name}`)
  return enumValue(value, name, allowed, normalize)
}

/** `YYYY-MM-DD` 日期（企业行为事件的 from/to）：格式与日历有效性都校验。 */
function dateString(value: unknown, name: string): string {
  const raw = text(value, name, 32)
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!matched) fail(`parameter ${name} must be a date in YYYY-MM-DD form`)
  const [, year, month, day] = matched
  const monthNumber = Number(month)
  const dayNumber = Number(day)
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
    fail(`parameter ${name} must be a valid calendar date in YYYY-MM-DD form`)
  }
  const parsed = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(raw)) {
    fail(`parameter ${name} must be a valid calendar date in YYYY-MM-DD form`)
  }
  if (Number(year) < 1990) fail(`parameter ${name} is outside the supported date range`)
  return raw
}

/** 财务指标报告期：`yyyy-1`..`yyyy-4`（1 一季报 / 2 中报 / 3 三季报 / 4 年报）。 */
function reportPeriod(value: unknown, name: string): string {
  const raw = text(value, name, 16)
  const matched = /^(\d{4})-([1-4])$/.exec(raw)
  if (!matched) fail(`parameter ${name} must be a report period like 2025-1 (yyyy-1 .. yyyy-4)`)
  if (Number(matched[1]) < 1990) fail(`parameter ${name} is outside the supported period range`)
  return raw
}

/** 规范化单个 A 股代码：trim + 大写 + 后缀校验。 */
function codeToken(value: unknown, name: string): string {
  const raw = text(value, name, 32).toUpperCase()
  if (!A_SHARE_CODE.test(raw)) {
    fail(`parameter ${name} must be a full thscode like 600519.SH; the exchange suffix is required and must not be guessed`)
  }
  return raw
}

/** 规范化单个指数代码（允许同花顺 `.TI`）。 */
function indexCodeToken(value: unknown, name: string): string {
  const raw = text(value, name, 32).toUpperCase()
  if (!INDEX_CODE.test(raw)) {
    fail(`parameter ${name} must be a full index thscode like 000300.SH, 399001.SZ or 886042.TI`)
  }
  return raw
}

/**
 * 规范化逗号分隔代码列表：去空白、去重、保序；空串与非法代码都拒绝。
 * `maximum` 按文档口径在**去重前**校验原始 token 数。
 */
function codeList(value: unknown, name: string, options: { maximum?: number; kind?: 'a-share' | 'index' } = {}): string {
  const raw = requiredText(value, name, MAX_PARAM_LENGTH)
  const tokens = raw.split(',').map((token) => token.trim()).filter((token) => token.length > 0)
  if (tokens.length === 0) fail(`parameter ${name} must contain at least one thscode`)
  if (options.maximum !== undefined && tokens.length > options.maximum) {
    fail(`parameter ${name} accepts at most ${options.maximum} codes per request`)
  }
  const normalizeToken = options.kind === 'index' ? indexCodeToken : codeToken
  const unique: string[] = []
  for (const token of tokens) {
    const normalized = normalizeToken(token, name)
    if (!unique.includes(normalized)) unique.push(normalized)
  }
  return unique.join(',')
}

/** 逗号分隔的枚举列表：小写、去重、保序；任一非法值整体拒绝。 */
function enumList(value: unknown, name: string, allowed: string[]): string {
  const raw = requiredText(value, name, MAX_TEXT_LENGTH)
  const unique: string[] = []
  for (const token of raw.split(',').map((item) => item.trim().toLowerCase()).filter((item) => item.length > 0)) {
    if (!allowed.includes(token)) fail(`parameter ${name} has an invalid value: ${token} (allowed: ${allowed.join(', ')})`)
    if (!unique.includes(token)) unique.push(token)
  }
  if (unique.length === 0) fail(`parameter ${name} must contain at least one value`)
  return unique.join(',')
}

function objectSchema(properties: Record<string, object>, required: string[] = [], description?: string): object {
  return { type: 'object', properties, required, additionalProperties: false, ...(description ? { description } : {}) }
}

function queryParams(params: Params, allowed: string[]): URLSearchParams {
  const search = new URLSearchParams()
  for (const name of allowed) {
    const value = params[name]
    if (value === undefined) continue
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      fail(`parameter ${name} must be a string, a number or a boolean`)
    }
    const encoded = String(value)
    if (encoded.length > MAX_PARAM_LENGTH) fail(`parameter ${name} exceeds maximum length`)
    search.set(name, encoded)
  }
  return search
}

async function callFuyao(baseUrl: string, apiKey: string, path: string, params: URLSearchParams, signal: AbortSignal, outputSchema: object): Promise<{ data: unknown; schema: object }> {
  const query = params.toString()
  const response = await fetch(`${baseUrl}${path}${query ? `?${query}` : ''}`, { headers: { 'X-api-key': apiKey, Accept: 'application/json' }, signal })
  if (!response.ok) throw new Error(`Fuyao HTTP error ${response.status}`)
  const envelope = await response.json() as ApiEnvelope
  // 2004 = 该能力是同花顺 AI 客户端专用，未开放外部接入（实测 capital-flow / high-frequency 均如此）。
  // 这是能力级不可用，不是瞬时故障：错误文案必须让调用方停止重试，否则会白烧配额与回合。
  if (envelope.code === 2004) {
    throw new Error('Fuyao API error 2004: 该数据能力为同花顺 AI 客户端专用，当前未开放外部接入；不要重试，改用其他能力或如实告知用户该能力不可用')
  }
  if (envelope.code !== 0) throw new Error(`Fuyao API error ${envelope.code ?? 'unknown'}: ${envelope.message ?? 'request failed'}${envelope.request_id ? ` (request_id: ${envelope.request_id})` : ''}`)
  return { data: envelope.data ?? null, schema: outputSchema }
}

/**
 * 字段契约（`?` 后缀 = 允许缺失）：
 * - `text` / `number` / `boolean` / `object` 是基础类型；
 * - 显式 `null` 一律放行（上游用 null 表示未披露/无数据，语义与 0 不同）；
 * - `number` 接受有限数值或数值字符串（上游历史上存在 decimal 序列化为字符串的情况）；
 * - 缺失与显式 null 语义不同：带 `?` 的字段允许缺失，不带 `?` 的字段缺失即判契约不符。
 *
 * 严格度口径（Phase 2 起）：
 * - **主标识与结构字段严格**（行的 `thscode` / `date` / 财务期间标识、顶层容器对象）：
 *   这些字段缺失意味着响应结构与契约不符，属于必须拦下的情况。
 * - **数值/附属字段宽容**（带 `?`）：上游指标随发布增减，单个指标缺失不等于结构损坏，
 *   而"整份 Dataset 因一个指标缺失被拒"会直接阻断用户任务。
 */
type FieldSpec =
  | 'text' | 'text?'
  | 'number' | 'number?'
  | 'boolean' | 'boolean?'
  | 'object' | 'object?'
  | 'array' | 'array?'
  | 'json' | 'json?'

type FieldKind = 'text' | 'number' | 'boolean' | 'object' | 'array' | 'json'

function matchesField(value: unknown, spec: FieldSpec): boolean {
  const optional = spec.endsWith('?')
  const base = (optional ? spec.slice(0, -1) : spec) as FieldKind
  if (value === undefined) return optional
  if (value === null) return true
  switch (base) {
    case 'text':
      return typeof value === 'string'
    case 'number':
      if (typeof value === 'number') return Number.isFinite(value)
      return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Number(value))
    case 'boolean':
      return typeof value === 'boolean'
    case 'object':
      return isRecord(value)
    case 'array':
      return Array.isArray(value)
    case 'json':
      // "保留上游结构"的字段：文档可能写 object、实际返回 array 或 null
      // （实测基金诊断的 dimensions/resilience 就是数组）。只拒绝 undefined。
      return true
  }
}

function matchesFields(record: Record<string, unknown>, fields: Record<string, FieldSpec>): boolean {
  return Object.keys(fields).every((name) => matchesField(record[name], fields[name]))
}

/** envelope 元数据：字段可缺席或为 null；出现时必须是可用的整数。 */
function optionalInteger(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'number') return Number.isSafeInteger(value)
  if (typeof value === 'string') return Number.isSafeInteger(Number(value))
  return false
}

/** 输出护栏规格：data 顶层字段 + data.item[] 行契约，或一个自定义校验函数。 */
interface GuardSpec {
  /** data 顶层字段契约（识别/结构字段）。 */
  data?: Record<string, FieldSpec>
  /** 行数组契约；提供时要求该数组存在且每行符合字段契约。 */
  item?: Record<string, FieldSpec>
  /** 行数组的键名，默认 `item`（龙虎榜用 `stock_items`）。 */
  itemKey?: string
  /**
   * `data` **本身**就是数组时的行契约（quota/list、quota/summary、backtest/indicators）。
   * 这类响应没有 `{timestamp, item[]}` 信封，因此不适用 data/item 两级校验。
   */
  dataArray?: Record<string, FieldSpec>
  /**
   * 自定义校验（财务指标的 abilities、quota/list 的三层嵌套、indicators 的序列结构）。
   * 只给 `custom` 而不给 data/item 时，它**完全接管顶层形状判断**——因为这类响应的
   * `data` 本身可能就是数组，不能用 isRecord 前置拦截。
   */
  custom?: (data: unknown) => boolean
}

/** 输出护栏：只拒绝结构不可用的响应，不做业务推断。 */
function buildGuard(spec: GuardSpec): (data: unknown) => boolean {
  return (data: unknown): boolean => {
    if (spec.dataArray) {
      if (!Array.isArray(data)) return false
      return data.every((row) => isRecord(row) && matchesFields(row, spec.dataArray!))
    }
    // custom-only：顶层可能是数组（quota/list、indicators/line、indicators/table），
    // 由校验器自己判断形状，不能在这里先做 isRecord 拦截。
    if (spec.custom && !spec.data && !spec.item) return spec.custom(data)
    if (!isRecord(data)) return false
    if (!optionalInteger(data.timestamp) || !optionalInteger(data.total)) return false
    if (spec.data && !matchesFields(data, spec.data)) return false
    if (spec.custom && !spec.custom(data)) return false
    if (spec.item) {
      const rows = data[spec.itemKey ?? 'item']
      if (!Array.isArray(rows)) return false
      if (!rows.every((row) => isRecord(row) && matchesFields(row, spec.item!))) return false
    }
    return true
  }
}

/** 财务指标：data.abilities[].indicators[]，value 是原始数值字符串或 null（不转 number，保留精度）。 */
function validateAbilities(data: unknown): boolean {
  if (!isRecord(data)) return false
  if (!Array.isArray(data.abilities)) return false
  return data.abilities.every((ability) => {
    if (!isRecord(ability)) return false
    if (typeof ability.ability !== 'string' || !Array.isArray(ability.indicators)) return false
    return ability.indicators.every((indicator) => isRecord(indicator)
      && typeof indicator.index_id === 'string'
      && (indicator.value === null || typeof indicator.value === 'string'))
  })
}

// timestamp 与 total 在无有效数据时可以是 null（文档明确，如基金行情快照）；运行时护栏一直放行 null，
// 模型可见 schema 也必须一致，否则 describe_capability 给出的契约是错的。
const nullableInteger = { oneOf: [{ type: 'integer' }, { type: 'null' }] }
const envelopeData = (item: object): object => ({ type: 'object', properties: { timestamp: nullableInteger, total: nullableInteger, item }, additionalProperties: true })
const searchOutput = envelopeData({ type: 'array', items: { type: 'object', properties: { thscode: { type: 'string' }, ticker: { type: 'string' }, name: { type: 'string' }, exchange: { type: 'string' }, asset_type: { type: 'string' }, currency: { type: 'string' } }, additionalProperties: true } })
const snapshotOutput = envelopeData({ type: 'array', items: { type: 'object', properties: { thscode: { type: 'string' }, ticker: { type: 'string' }, last_price: { type: 'number' }, price_change: { type: 'number' }, price_change_ratio_pct: { type: 'number' }, open_price: { type: 'number' }, high_price: { type: 'number' }, low_price: { type: 'number' }, prev_price: { type: 'number' }, volume: { type: 'number' }, turnover: { type: 'number' } }, additionalProperties: true } })
const klineOutput = envelopeData({ type: 'array', items: { type: 'object', properties: { date_ms: { type: 'integer' }, open_price: { type: 'number' }, high_price: { type: 'number' }, low_price: { type: 'number' }, close_price: { type: 'number' }, volume: { type: 'number' }, turnover: { type: 'number' } }, additionalProperties: true } })
const calendarOutput = envelopeData({ type: 'array', items: { type: 'object', properties: { date_ms: { type: 'integer' }, date: { type: 'string' } }, additionalProperties: true } })

/** 行契约 -> 输出 schema 的字段描述（模型可见，只描述字段名与类型）。 */
function rowSchema(fields: Record<string, FieldSpec>): object {
  const properties: Record<string, object> = {}
  for (const [name, spec] of Object.entries(fields)) {
    const base = spec.endsWith('?') ? spec.slice(0, -1) : spec
    const optional = spec.endsWith('?')
    const jsonType = base === 'number' ? { type: 'number' }
      : base === 'text' ? { type: 'string' }
        : base === 'boolean' ? { type: 'boolean' }
          : base === 'array' ? { type: 'array', items: {} }
            : base === 'json' ? {}
              : { type: 'object', additionalProperties: true }
    properties[name] = optional ? { oneOf: [jsonType, { type: 'null' }] } : jsonType
  }
  return { type: 'object', properties, additionalProperties: true }
}

const tickerFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', name: 'text?', exchange: 'text?', asset_type: 'text?', currency: 'text?', list_date: 'text?', end_date: 'text?', last_trade_date: 'text?', last_delivery_date: 'text?' }
const valuationFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', name: 'text?', pe_ttm: 'number?', pe_mrq: 'number?', pb_mrq: 'number?', ps_ttm: 'number?', pcf_ttm: 'number?' }
const auctionFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', name: 'text?', auction_price: 'number?', auction_pct: 'number?', auction_volume: 'number?', auction_amount: 'number?', auction_unmatched: 'number?', auction_turnover_pct: 'number?', auction_yesterday_ratio_pct: 'number?', auction_volume_ratio: 'number?', pre_close_price: 'number?', open_price: 'number?', last_price: 'number?', float_market_cap: 'number?' }
const limitUpPoolFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', name: 'text?', is_st: 'boolean?', is_new: 'boolean?', last_price: 'number?', price_change_ratio_pct: 'number?', limit_up_time: 'text?', limit_up_reason: 'text?', continue_day_text: 'text?', continue_day_cnt: 'number?', seal_money: 'number?', max_seal_money: 'number?' }
const ladderFields: Record<string, FieldSpec> = { date: 'text', boards: 'object' }
const indexCatalogFields: Record<string, FieldSpec> = { thscode: 'text', name: 'text?' }
const indexConstituentFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', name: 'text?' }
const indexQuoteFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', last_price: 'number?', price_change: 'number?', price_change_ratio_pct: 'number?', open_price: 'number?', high_price: 'number?', low_price: 'number?', prev_price: 'number?', volume: 'number?', turnover: 'number?' }
const indexHistoryFields: Record<string, FieldSpec> = { date_ms: 'number', open_price: 'number?', high_price: 'number?', low_price: 'number?', close_price: 'number?', volume: 'number?', turnover: 'number?' }

/** 财务三表共有的期间标识字段（严格）与币种（宽容）。 */
const limitDownFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', name: 'text?', last_price: 'number?', price_change_ratio_pct: 'number?', first_limit_time: 'text?', last_limit_time: 'text?', turnover_ratio_pct: 'number?' }
const limitBreakFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', name: 'text?', last_price: 'number?', price_change_ratio_pct: 'number?', open_times: 'number?', turnover_ratio_pct: 'number?', turnover: 'number?' }
/** 飙升榜与热股榜共用字段；heat 是上游原始**字符串**（保留精度，不转 number）。 */
const rankListFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', name: 'text?', rank: 'number?', heat: 'text?', rank_change: 'number?', rank_trend: 'text?' }
const hotStockHistoryFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', name: 'text?', rank: 'number?' }
const rankTrendFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', date: 'text', date_ms: 'number?', rank: 'number?' }
const anomalyFields: Record<string, FieldSpec> = { thscode: 'text', stock_name: 'text?', analysis_content: 'text?', keyword_list: 'array?', tag_name: 'text?' }
const dragonTigerStockFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', name: 'text?', concept_list: 'array?', change: 'number?', net_value: 'number?', net_rate: 'number?', hot_rank: 'number?', buy_value: 'number?', sell_value: 'number?', limit_reason: 'text?', range_days: 'number?', org_net_value: 'number?', org_net_rate: 'number?', org_buy_num: 'number?', org_sell_num: 'number?', amount: 'number?', hot_money_net_value: 'number?', hot_money_net_rate: 'number?', hot_money_item_net_value: 'number?', hot_money_item_net_rate: 'number?' }
const auctionBenchmarkFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', name: 'text?', auction_pct: 'number?', tags: 'array?' }

const fundProfileFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', fund_name: 'text?', estab_date: 'number?', company_id: 'text?', mgmt_name: 'text?', manager_name: 'text?', fund_scale: 'number?', unit_nav: 'number?', manager_info: 'array?', trade_rule: 'array?', rate_info: 'array?' }
const fundQuoteFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', last_price: 'number?', open_price: 'number?', high_price: 'number?', low_price: 'number?', prev_price: 'number?', price_change_ratio_pct: 'number?', price_change: 'number?', price_amplitude_ratio_pct: 'number?', volume: 'number?', turnover: 'number?', turnover_ratio_pct: 'number?' }
const fundHistoryFields: Record<string, FieldSpec> = { date_ms: 'number', open_price: 'number?', high_price: 'number?', low_price: 'number?', close_price: 'number?', volume: 'number?', turnover: 'number?' }
const fundNavFields: Record<string, FieldSpec> = { nav_date: 'number', unit_nav: 'number?', adj_nav: 'number?' }
/**
 * 收益率行没有主标识字段，且**任何单个 return_* 都可能缺席**：官方示例就只有 8 个
 * （return_month / tmonth / hyear / year / tyear / fyear / nowyear / now，没有 return_week）。
 * 因此全部字段设为可选，另用 validateFundReturns 要求"至少命中一个收益/排名族字段"，
 * 既不放行垃圾结构，也不会误杀官方合法响应。
 */
const fundReturnsFields: Record<string, FieldSpec> = {
  return_week: 'number?', return_month: 'number?', return_tmonth: 'number?', return_hyear: 'number?',
  return_year: 'number?', return_twoyear: 'number?', return_tyear: 'number?', return_fyear: 'number?',
  return_nowyear: 'number?', return_now: 'number?',
  peer_average_week: 'number?', peer_average_month: 'number?', peer_average_tmonth: 'number?', peer_average_hyear: 'number?',
  peer_average_year: 'number?', peer_average_twoyear: 'number?', peer_average_tyear: 'number?', peer_average_fyear: 'number?',
  rank_week: 'number?', rank_month: 'number?', rank_tmonth: 'number?', rank_hyear: 'number?',
  rank_year: 'number?', rank_twoyear: 'number?', rank_tyear: 'number?', rank_fyear: 'number?',
  rank_total_week: 'number?', rank_total_month: 'number?', rank_total_tmonth: 'number?', rank_total_hyear: 'number?',
  rank_total_year: 'number?', rank_total_twoyear: 'number?', rank_total_tyear: 'number?', rank_total_fyear: 'number?',
}

/** 收益/排名族的字段前缀；一行至少命中一个才算可用，其余情况判契约不符。 */
const FUND_RETURN_PREFIXES = ['return_', 'peer_average_', 'rank_']

function validateFundReturns(data: unknown): boolean {
  if (!isRecord(data) || !Array.isArray(data.item)) return false
  return data.item.every((row) => isRecord(row)
    && Object.keys(row).some((key) => FUND_RETURN_PREFIXES.some((prefix) => key.startsWith(prefix))))
}
const fundDrawdownFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', week: 'number?', month: 'number?', tmonth: 'number?', hyear: 'number?', year: 'number?', twoyear: 'number?', tyear: 'number?', fyear: 'number?', nowyear: 'number?', now: 'number?' }
const fundHoldingFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', stock_name: 'text?', hold_ratio: 'number?', asset_type: 'text?', position_capital: 'number?', position_count: 'number?', security_market_value_rate_pct: 'number?', period_increase_rate_pct: 'number?', investment_rank: 'number?', start_date_ms: 'number?', end_date_ms: 'number?', publish_date_ms: 'number?', modify_time_ms: 'number?' }
const fundAssetAllocationFields: Record<string, FieldSpec> = { report_date_ms: 'number', stock_ratio_pct: 'number?', bond_ratio_pct: 'number?', deposit_ratio_pct: 'number?', other_ratio_pct: 'number?' }
const fundIndustryAllocationFields: Record<string, FieldSpec> = { report_period: 'text', industry_name: 'text?', ratio_pct: 'number?' }
const fundStockHistoryFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', name: 'text?', asset_type: 'text?', hold_ratio: 'number?', market_value: 'number?', period_increase_pct: 'number?', rank: 'number?', report_type: 'text?', end_date_ms: 'number?' }
const fundHolderFields: Record<string, FieldSpec> = { merge_scope: 'text', report_date_ms: 'number', ins_position: 'number?', holder_amount: 'number?', avg_holder_share: 'number?', psnl_rate: 'number?', mgmt_staff_hold_rate: 'number?' }
const fundTopHolderFields: Record<string, FieldSpec> = { holder_id: 'text', holder_code: 'text?', holder_name: 'text?', holder_type: 'text?', rank: 'number?', hold_share: 'number?', hold_rate_pct: 'number?', report_date_ms: 'number?', publish_date_ms: 'number?' }
const fundManagerFields: Record<string, FieldSpec> = { manager_id: 'text', manager_name: 'text?', sex: 'text?', degree: 'text?', company_id: 'text?', company_name: 'text?', resume: 'text?', photo_url: 'text?', annual_return_pct: 'number?', maximum_return_pct: 'number?', radar_comparison: 'array?' }
const fundCompanyFields: Record<string, FieldSpec> = { company_id: 'text', company_name: 'text?', company_type: 'text?', established_date_ms: 'number?', fund_count: 'number?', scale: 'number?' }

const fundPerformanceHistoryFields: Record<string, FieldSpec> = { date_ms: 'number', rsi_pct: 'number?', donchian_channel: 'number?', track_index_pe_ttm_five_year_percentile: 'number?' }
const fundReportDatesFields: Record<string, FieldSpec> = { report_type: 'text', report_type_name: 'text?', start_date_ms: 'number?', end_date_ms: 'number?' }
const fundManagerExperienceFields: Record<string, FieldSpec> = { awards: 'json?', heavy_assets: 'json?', investment_history: 'json?' }
const fundManagerStyleFields: Record<string, FieldSpec> = { representative_fund_thscode: 'text?', representative_fund_ticker: 'text?', representative_fund_name: 'text?', investment_idea: 'text?', total_fund_scale: 'number?', industry_preferences: 'json?' }
const fundManagerPerformanceFields: Record<string, FieldSpec> = { date_ms: 'number', manager_return_pct: 'number?', peer_return_pct: 'number?', benchmark_return_pct: 'number?' }
const fundFinancialDateFields: Record<string, FieldSpec> = { start_date_ms: 'number', end_date_ms: 'number', publish_date_ms: 'number?' }
const fundNumberFields = (names: string[]): Record<string, FieldSpec> =>
  Object.fromEntries(names.map((name) => [name, 'number?' as FieldSpec]))
const fundIncomeFields: Record<string, FieldSpec> = { ...fundFinancialDateFields, ...fundNumberFields(['income', 'investment_income', 'stock_investment_income', 'bond_investment_income', 'fund_investment_income', 'dividend_income', 'interest_income', 'fair_value_income', 'exchange_income', 'other_income', 'total_income', 'fee', 'total_fee', 'manager_reward', 'custodian_fee', 'transaction_cost', 'tax_surcharge', 'total_profit', 'net_profit']) }
const fundBalanceFields: Record<string, FieldSpec> = { ...fundFinancialDateFields, ...fundNumberFields(['total_assets', 'bank_deposit', 'fund_investment', 'stock_investment', 'bond_investment', 'transactional_financial_assets', 'other_assets', 'total_liability', 'other_liability', 'owner_total_equity', 'undistributed_profit', 'liability_and_owner_equity']) }
const fundFinancialIndicatorFields: Record<string, FieldSpec> = { ...fundFinancialDateFields, ...fundNumberFields(['distribution_profit', 'current_profit', 'current_income', 'distribution_share_profit', 'average_nav_profit_margin', 'average_share_current_profit', 'share_nav', 'sum_nav_rate', 'asset_nav', 'sum_share_nav', 'nav_rate']) }
const fundDividendFields: Record<string, FieldSpec> = { per_ten_cash_before_tax: 'number?', per_ten_cash_after_tax: 'number?', progress: 'text?', publish_date_ms: 'number?', registration_date_ms: 'number?', ex_dividend_date_ms: 'number?', payment_date_ms: 'number?', reinvestment_date_ms: 'number?', profit_base_date_ms: 'number?', in_dividend_date_ms: 'number?' }
const fundOfferingFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', subscription_start_ms: 'number?', subscription_end_ms: 'number?' }
const fundQuotaSummaryFields: Record<string, FieldSpec> = { name: 'text', unlimited: 'text?', total_limit: 'text?', total: 'text?', buy: 'text?' }
/** 实测：dimensions/peer_dimensions/resilience/peer_resilience 是**数组**、probabilities/ranges 为 null（文档写 object）。 */
const fundDiagnosticsFields: Record<string, FieldSpec> = { thscode: 'text', ticker: 'text?', fund_type: 'text?', peer_code: 'text?', dimensions: 'json?', peer_dimensions: 'json?', probabilities: 'json?', ranges: 'json?', resilience: 'json?', peer_resilience: 'json?' }
const fundBacktestIndicatorFields: Record<string, FieldSpec> = { indicator_code: 'text', indicator_name: 'text?', id: 'number?', type: 'number?', value_kind: 'number?', support_operation: 'text?', unit: 'text?', description: 'text?', state_rules: 'text?', create_time: 'text?', update_time: 'text?' }

/** quota/list 是三层嵌套（data[] → sub_tab[] → fund_list[]），没有 item[] 信封。 */
function validateQuotaList(data: unknown): boolean {
  if (!Array.isArray(data)) return false
  return data.every((category) => {
    if (!isRecord(category)) return false
    if (typeof category.name !== 'string' || !Array.isArray(category.sub_tab)) return false
    return category.sub_tab.every((subTab) => {
      if (!isRecord(subTab)) return false
      if (!Array.isArray(subTab.fund_list)) return false
      return subTab.fund_list.every((fund) => isRecord(fund)
        && typeof fund.thscode === 'string'
        && matchesField(fund.quota, 'text?')
        && matchesField(fund.year, 'text?'))
    })
  })
}

/** indicators/line：time_range 时间轴 + indexes 元信息 + data 序列，三层结构。 */
function validateIndicatorLine(data: unknown): boolean {
  if (!isRecord(data)) return false
  if (!Array.isArray(data.time_range)) return false
  if (!data.time_range.every((point) => point === null || Number.isSafeInteger(point))) return false
  if (!Array.isArray(data.indexes) || !Array.isArray(data.data)) return false
  if (!data.indexes.every((meta) => isRecord(meta) && typeof meta.index_id === 'string')) return false
  return data.data.every((series) => {
    if (!isRecord(series) || typeof series.thscode !== 'string' || !Array.isArray(series.values)) return false
    return series.values.every((value) => isRecord(value) && Number.isSafeInteger(value.idx))
  })
}

/** indicators/table：total + indexes + data[]，值可为 JSON 或 null。 */
function validateIndicatorTable(data: unknown): boolean {
  if (!isRecord(data)) return false
  if (!Number.isSafeInteger(data.total)) return false
  if (!Array.isArray(data.indexes) || !Array.isArray(data.data)) return false
  if (!data.indexes.every((meta) => isRecord(meta) && typeof meta.index_id === 'string')) return false
  return data.data.every((series) => {
    if (!isRecord(series) || typeof series.thscode !== 'string' || !Array.isArray(series.values)) return false
    return series.values.every((value) => isRecord(value) && Number.isSafeInteger(value.idx))
  })
}

const financialCommonFields: Record<string, FieldSpec> = {
  thscode: 'text',
  ticker: 'text?',
  period: 'text',
  fiscal_year: 'number',
  fiscal_period: 'text',
  report_date_ms: 'number',
  period_end_ms: 'number',
  currency: 'text?',
}
const financialNumber = (names: string[]): Record<string, FieldSpec> =>
  Object.fromEntries(names.map((name) => [name, 'number?' as FieldSpec]))

/** 单个端点的完整定义：模型可见 schema、内部路由、参数语义与输出护栏同处一处。 */
interface EndpointDefinition {
  name: string
  capability: string
  /** 一行摘要：进能力目录，选能力够用（~50 字内）。 */
  summary: string
  /** 完整说明：进 describe_capability 详情（单位、null 语义、时间与分页口径）。 */
  description: string
  path: string
  inputSchema: object
  outputSchema: object
  /** 允许出现的参数名（顺序即 query 顺序）。 */
  allowed: string[]
  normalize(params: Params): Params
  guard: GuardSpec
  paginated?: boolean
}

function normalizeQuote(params: Params): Params {
  const normalized: Params = {}
  if (params.thscodes !== undefined) {
    normalized.thscodes = codeList(params.thscodes, 'thscodes')
    // 按文档：传入 thscodes 时上游忽略分页；这里直接丢弃，避免产生语义等价的多个 Dataset。
    return normalized
  }
  if (params.limit !== undefined) normalized.limit = integer(params.limit, 'limit', { minimum: 1 })
  if (params.offset !== undefined) normalized.offset = integer(params.offset, 'offset', { minimum: 0 })
  return normalized
}

/** 时间区间型请求的共用校验：成对出现、end >= start、窗口不超过 10 年。 */
function timeWindow(params: Params, normalized: Params): void {
  const { start, end } = params
  if ((start === undefined) !== (end === undefined)) fail('parameters start and end must be provided together')
  if (start === undefined || end === undefined) return
  const from = integer(start, 'start', { minimum: 0 })
  const to = integer(end, 'end', { minimum: 0 })
  if (to < from) fail('parameter end must be >= start')
  if (to - from > MAX_HISTORY_WINDOW_MS) fail('parameter window (end - start) exceeds the 10 year limit')
  normalized.start = from
  normalized.end = to
}

function normalizeHistory(params: Params): Params {
  const normalized: Params = {
    thscode: codeToken(requiredText(params.thscode, 'thscode', 32), 'thscode'),
    interval: requiredEnum(params.interval, 'interval', KLINE_INTERVALS, lowerCase),
  }
  const start = requiredInteger(params.start, 'start', { minimum: 0 })
  const end = requiredInteger(params.end, 'end', { minimum: 0 })
  if (end < start) fail('parameter end must be >= start')
  if (end - start > MAX_HISTORY_WINDOW_MS) fail('parameter window (end - start) exceeds the 10 year limit')
  normalized.start = start
  normalized.end = end
  if (params.adjust !== undefined) normalized.adjust = enumValue(params.adjust, 'adjust', ADJUST_MODES, lowerCase)
  if (params.offset !== undefined) normalized.offset = integer(params.offset, 'offset', { minimum: 0 })
  return normalized
}

function normalizeTickerSearch(params: Params): Params {
  const normalized: Params = { q: requiredText(params.q, 'q') }
  if (params.exchange !== undefined) normalized.exchange = enumValue(params.exchange, 'exchange', SEARCH_EXCHANGES, (input) => input.toUpperCase())
  if (params.asset_type !== undefined) normalized.asset_type = enumList(params.asset_type, 'asset_type', SEARCH_ASSET_TYPES)
  if (params.limit !== undefined) normalized.limit = integer(params.limit, 'limit', { minimum: 1, maximum: 50 })
  return normalized
}

function normalizeTickerList(params: Params): Params {
  const normalized: Params = {}
  if (params.asset_type !== undefined) normalized.asset_type = enumList(params.asset_type, 'asset_type', CATALOG_ASSET_TYPES)
  if (params.limit !== undefined) normalized.limit = integer(params.limit, 'limit', { minimum: 1, maximum: 10000 })
  if (params.offset !== undefined) normalized.offset = integer(params.offset, 'offset', { minimum: 0 })
  return normalized
}

function normalizeCorporateActions(params: Params): Params {
  const normalized: Params = { thscode: codeToken(requiredText(params.thscode, 'thscode', 32), 'thscode') }
  const from = params.from === undefined ? undefined : dateString(params.from, 'from')
  const to = params.to === undefined ? undefined : dateString(params.to, 'to')
  if (from !== undefined && to !== undefined && to < from) fail('parameter to must be >= from')
  if (from !== undefined) normalized.from = from
  if (to !== undefined) normalized.to = to
  return normalized
}

/** 财务三表共用参数：最近 N 期（limit）与时间区间（start+end）互斥、二选一。 */
function normalizeFinancial(params: Params): Params {
  const normalized: Params = {
    thscode: codeToken(requiredText(params.thscode, 'thscode', 32), 'thscode'),
    period: requiredEnum(params.period, 'period', REPORT_PERIODS, lowerCase),
  }
  const hasWindow = params.start !== undefined || params.end !== undefined
  if (params.limit !== undefined && hasWindow) {
    fail('parameter limit is mutually exclusive with start/end: choose the recent-N-periods mode or the time-range mode')
  }
  if (params.limit !== undefined) normalized.limit = integer(params.limit, 'limit', { minimum: 1, maximum: 20 })
  timeWindow(params, normalized)
  return normalized
}

function normalizeFinancialIndicators(params: Params): Params {
  return {
    thscode: codeToken(requiredText(params.thscode, 'thscode', 32), 'thscode'),
    report: reportPeriod(requiredText(params.report, 'report', 16), 'report'),
  }
}

function normalizeValuation(params: Params): Params {
  return { thscodes: codeList(params.thscodes, 'thscodes', { maximum: MAX_BATCH_CODES }) }
}

function normalizeAuction(params: Params): Params {
  const normalized: Params = { thscodes: codeList(params.thscodes, 'thscodes', { maximum: MAX_BATCH_CODES }) }
  if (params.stage !== undefined) normalized.stage = enumValue(params.stage, 'stage', AUCTION_STAGES, lowerCase)
  return normalized
}

function normalizeLimitUpPool(params: Params): Params {
  const normalized: Params = {}
  if (params.date_ms !== undefined) normalized.date_ms = integer(params.date_ms, 'date_ms', { minimum: 0 })
  if (params.page !== undefined) normalized.page = integer(params.page, 'page', { minimum: 1 })
  if (params.size !== undefined) normalized.size = integer(params.size, 'size', { minimum: 1, maximum: 200 })
  if (params.sort_field !== undefined) normalized.sort_field = enumValue(params.sort_field, 'sort_field', LIMIT_UP_SORT_FIELDS, lowerCase)
  if (params.sort_dir !== undefined) normalized.sort_dir = enumValue(params.sort_dir, 'sort_dir', SORT_DIRECTIONS, lowerCase)
  return normalized
}

function normalizeIndexCatalog(params: Params): Params {
  const normalized: Params = {}
  if (params.tag !== undefined) normalized.tag = enumValue(params.tag, 'tag', INDEX_TAGS, lowerCase)
  return normalized
}

function normalizeIndexConstituents(params: Params): Params {
  return { thscode: indexCodeToken(requiredText(params.thscode, 'thscode', 32), 'thscode') }
}

function normalizeIndexQuote(params: Params): Params {
  return { thscodes: codeList(params.thscodes, 'thscodes', { kind: 'index' }) }
}

/** 基金代码规范化：trim + 大写 + 市场后缀校验（不接受逗号与裸代码）。 */
function fundCodeToken(value: unknown, name: string): string {
  const raw = text(value, name, 32).toUpperCase()
  if (!FUND_CODE.test(raw)) {
    fail(`parameter ${name} must be a full fund thscode like 025480.OF, 510300.SH or 161725.SZ`)
  }
  return raw
}

/** 基金经理 / 基金公司标识：格式上游未公开，只做非空与长度约束。 */
function identifierToken(value: unknown, name: string): string {
  return requiredText(value, name, 64)
}

/** 只带 thscode 的基金端点（基本资料、业绩快照、持仓、持有人等）。 */
function onlyFundCode(params: Params): Params {
  return { thscode: fundCodeToken(requiredText(params.thscode, 'thscode', 32), 'thscode') }
}

function normalizeFundMarketHistory(params: Params): Params {
  const normalized: Params = { thscode: fundCodeToken(requiredText(params.thscode, 'thscode', 32), 'thscode') }
  if (params.interval !== undefined) normalized.interval = enumValue(params.interval, 'interval', KLINE_INTERVALS, lowerCase)
  const start = requiredInteger(params.start, 'start', { minimum: 0 })
  const end = requiredInteger(params.end, 'end', { minimum: 0 })
  if (end < start) fail('parameter end must be >= start')
  if (end - start > MAX_FUND_HISTORY_WINDOW_MS) fail('parameter window (end - start) exceeds the 5 year limit for fund market history')
  normalized.start = start
  normalized.end = end
  return normalized
}

function normalizeFundNav(params: Params): Params {
  const normalized: Params = { thscode: fundCodeToken(requiredText(params.thscode, 'thscode', 32), 'thscode') }
  if (params.range !== undefined) normalized.range = enumValue(params.range, 'range', NAV_RANGES, lowerCase)
  if (params.nav_type !== undefined) normalized.nav_type = enumValue(params.nav_type, 'nav_type', NAV_TYPES, lowerCase)
  return normalized
}

function normalizeFundStockHistory(params: Params): Params {
  return {
    thscode: fundCodeToken(requiredText(params.thscode, 'thscode', 32), 'thscode'),
    // report_type 的枚举上游未公开（实测 quarter 可用；annual/half 返回 5003 即上游无该类型数据，
    // 而不是参数错误），因此本地不做白名单，只拒绝空值与明显非法字符，避免误拒上游新增类型。
    report_type: text(requiredText(params.report_type, 'report_type', 32), 'report_type'),
    end_date: dateString(requiredText(params.end_date, 'end_date', 32), 'end_date'),
  }
}

function normalizeFundHolders(params: Params): Params {
  const normalized: Params = { thscode: fundCodeToken(requiredText(params.thscode, 'thscode', 32), 'thscode') }
  if (params.merge_scope !== undefined) normalized.merge_scope = enumValue(params.merge_scope, 'merge_scope', MERGE_SCOPES, lowerCase)
  return normalized
}

function normalizeFundTopHolders(params: Params): Params {
  const normalized: Params = { thscode: fundCodeToken(requiredText(params.thscode, 'thscode', 32), 'thscode') }
  if (params.limit !== undefined) normalized.limit = integer(params.limit, 'limit', { minimum: 1, maximum: MAX_TOP_HOLDERS_LIMIT })
  return normalized
}

function normalizeFundManager(params: Params): Params {
  return { manager_id: identifierToken(params.manager_id, 'manager_id') }
}

function normalizeFundCompany(params: Params): Params {
  return { company_id: identifierToken(params.company_id, 'company_id') }
}

/** 报告期查询（bond-history 与 stock-history 同构）。 */
function normalizeFundReportType(params: Params): Params {
  const normalized: Params = { thscode: fundCodeToken(requiredText(params.thscode, 'thscode', 32), 'thscode') }
  if (params.report_type !== undefined) normalized.report_type = text(params.report_type, 'report_type', 32)
  return normalized
}

function normalizeFundPerformanceHistory(params: Params): Params {
  const normalized: Params = { thscode: fundCodeToken(requiredText(params.thscode, 'thscode', 32), 'thscode') }
  const start = requiredInteger(params.start, 'start', { minimum: 0 })
  const end = requiredInteger(params.end, 'end', { minimum: 0 })
  if (end < start) fail('parameter end must be >= start')
  normalized.start = start
  normalized.end = end
  return normalized
}

function normalizeManagerRange(params: Params): Params {
  return {
    manager_id: identifierToken(params.manager_id, 'manager_id'),
    range: requiredEnum(params.range, 'range', MANAGER_RANGES, lowerCase),
  }
}

/** 指标画线：indexes 为分组数组，time_range 为时间范围对象（都是 JSON 字符串）。 */
function normalizeFundIndicatorLine(params: Params): Params {
  const indexes = jsonParam(params.indexes, 'indexes', 'array')
  const groups = JSON.parse(indexes) as unknown[]
  if (groups.length === 0) fail('parameter indexes must contain at least one group')
  for (const [position, group] of groups.entries()) {
    if (!isRecord(group)) fail(`parameter indexes group ${position} must be an object`)
    if (!Array.isArray(group.thscodes) || group.thscodes.length === 0) {
      fail(`parameter indexes group ${position} must contain a non-empty thscodes array`)
    }
    if (!Array.isArray(group.index_info) || group.index_info.length === 0) {
      fail(`parameter indexes group ${position} must contain a non-empty index_info array`)
    }
    for (const [index, info] of group.index_info.entries()) {
      if (!isRecord(info) || typeof info.index_id !== 'string' || info.index_id.length === 0) {
        fail(`parameter indexes group ${position} index_info[${index}] must contain a string index_id`)
      }
    }
  }
  const timeRange = jsonParam(params.time_range, 'time_range', 'object')
  const range = JSON.parse(timeRange) as Record<string, unknown>
  if (typeof range.time_type !== 'string' || range.time_type.length === 0) {
    fail('parameter time_range must contain a string time_type')
  }
  for (const field of ['start', 'end', 'offset']) {
    const value = range[field]
    if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value))) {
      fail(`parameter time_range.${field} must be an integer when present`)
    }
  }
  return { indexes, time_range: timeRange }
}

function normalizeFundIndicatorTable(params: Params): Params {
  const normalized: Params = {}
  const codeSelectors = optionalJsonParam(params.code_selectors, 'code_selectors', 'object')
  const indexes = optionalJsonParam(params.indexes, 'indexes', 'array')
  const pageInfo = optionalJsonParam(params.page_info, 'page_info', 'object')
  const sort = optionalJsonParam(params.sort, 'sort', 'array')
  if (codeSelectors !== undefined) normalized.code_selectors = codeSelectors
  if (indexes !== undefined) normalized.indexes = indexes
  if (pageInfo !== undefined) normalized.page_info = pageInfo
  if (sort !== undefined) normalized.sort = sort
  if (Object.keys(normalized).length === 0) {
    fail('at least one of code_selectors / indexes / page_info / sort is required (this endpoint has no业务默认值)')
  }
  return normalized
}

function normalizeFundQuotaList(params: Params): Params {
  const normalized: Params = { tab: jsonParam(params.tab, 'tab', 'array') }
  if (params.buy !== undefined) normalized.buy = booleanValue(params.buy, 'buy')
  return normalized
}

function normalizeFundBacktest(params: Params): Params {
  return {
    thscode: fundCodeToken(requiredText(params.thscode, 'thscode', 32), 'thscode'),
    buy_conditions: jsonParam(params.buy_conditions, 'buy_conditions', 'object-or-array'),
    sell_conditions: jsonParam(params.sell_conditions, 'sell_conditions', 'object-or-array'),
    buy_frequency_type: requiredText(params.buy_frequency_type, 'buy_frequency_type', 32),
    max_buy_times: requiredInteger(params.max_buy_times, 'max_buy_times', { minimum: 1 }),
    per_buy_amount: numberValue(params.per_buy_amount, 'per_buy_amount', { minimum: 0 }),
  }
}


function normalizePoolQuery(params: Params, sortFields: string[]): Params {
  const normalized: Params = {}
  if (params.date_ms !== undefined) normalized.date_ms = integer(params.date_ms, 'date_ms', { minimum: 0 })
  if (params.page !== undefined) normalized.page = integer(params.page, 'page', { minimum: 1 })
  if (params.size !== undefined) normalized.size = integer(params.size, 'size', { minimum: 1, maximum: 200 })
  if (params.sort_field !== undefined) normalized.sort_field = enumValue(params.sort_field, 'sort_field', sortFields, lowerCase)
  if (params.sort_dir !== undefined) normalized.sort_dir = enumValue(params.sort_dir, 'sort_dir', SORT_DIRECTIONS, lowerCase)
  return normalized
}

function normalizeLimitDownPool(params: Params): Params {
  return normalizePoolQuery(params, LIMIT_DOWN_SORT_FIELDS)
}

function normalizeLimitBreakPool(params: Params): Params {
  return normalizePoolQuery(params, LIMIT_BREAK_SORT_FIELDS)
}

/** 飙升榜 / 热股榜：period 取 day（日/24 小时级）或 hour（小时级）。 */
function normalizeRankList(params: Params): Params {
  const normalized: Params = {}
  if (params.period !== undefined) normalized.period = enumValue(params.period, 'period', RANK_PERIODS, lowerCase)
  return normalized
}

function normalizeHotStockHistory(params: Params): Params {
  return { date: dateString(requiredText(params.date, 'date', 32), 'date') }
}

function normalizeHotStockRankTrend(params: Params): Params {
  const startDate = dateString(requiredText(params.start_date, 'start_date', 32), 'start_date')
  const endDate = dateString(requiredText(params.end_date, 'end_date', 32), 'end_date')
  if (startDate > endDate) fail('parameter end_date must be >= start_date')
  return {
    thscode: codeToken(requiredText(params.thscode, 'thscode', 32), 'thscode'),
    start_date: startDate,
    end_date: endDate,
  }
}

/** 异动标签：大小写不敏感、去重保序；空 token 与未知标签都拒绝（上游对二者都返回 1002）。 */
function anomalyTagList(value: unknown, name: string): string {
  const raw = requiredText(value, name, MAX_TEXT_LENGTH)
  const tokens = raw.split(',').map((token) => token.trim().toUpperCase())
  if (tokens.some((token) => token.length === 0)) fail(`parameter ${name} must not contain empty tokens`)
  const unique: string[] = []
  for (const token of tokens) {
    if (!ANOMALY_TAGS.includes(token)) fail(`parameter ${name} has an invalid value: ${token} (allowed: ${ANOMALY_TAGS.join(', ')})`)
    if (!unique.includes(token)) unique.push(token)
  }
  return unique.join(',')
}

function normalizeAnomalyList(params: Params): Params {
  const normalized: Params = {}
  if (params.tag_codes !== undefined) normalized.tag_codes = anomalyTagList(params.tag_codes, 'tag_codes')
  return normalized
}

function normalizeAnomalyStock(params: Params): Params {
  return { thscodes: codeList(params.thscodes, 'thscodes', { maximum: MAX_ANOMALY_CODES }) }
}

function normalizeDragonTiger(params: Params): Params {
  const normalized: Params = {}
  if (params.board_type !== undefined) normalized.board_type = enumValue(params.board_type, 'board_type', DRAGON_TIGER_BOARDS, lowerCase)
  if (params.date !== undefined) normalized.date = dateString(params.date, 'date')
  return normalized
}

function normalizeIndexHistory(params: Params): Params {
  const normalized: Params = {
    thscode: indexCodeToken(requiredText(params.thscode, 'thscode', 32), 'thscode'),
    interval: requiredEnum(params.interval, 'interval', KLINE_INTERVALS),
  }
  const start = requiredInteger(params.start, 'start', { minimum: 0 })
  const end = requiredInteger(params.end, 'end', { minimum: 0 })
  if (end < start) fail('parameter end must be >= start')
  if (end - start > MAX_HISTORY_WINDOW_MS) fail('parameter window (end - start) exceeds the 10 year limit')
  normalized.start = start
  normalized.end = end
  return normalized
}

function endpointDefinitions(): EndpointDefinition[] {
  return [
    {
      name: 'get_meta_tickers_search',
      capability: 'ticker_search',
      summary: '名称或代码检索消歧为完整 thscode',
      description: '按名称、代码或简称检索并消歧为完整 thscode（禁止自行拼接交易所后缀，先消歧再请求业务数据）。q 必填（去空白后 1~512 字符）；exchange 支持证券交易所（SH/SZ/BJ/SSE/SZSE）与期货交易所（CFFEX/SHFE/INE/DCE/CZCE/GFEX）；asset_type 逗号分隔，取值 a-share、a-share-index、forex、fund-otc、fund-etf、fund-lof、fund-reits、futures、options（**期货/期权仅可消歧，本 preset 不提供其数据端点**）；limit 取值 1~50，默认 10。',
      path: '/api/meta/tickers/search',
      inputSchema: objectSchema({
        q: { type: 'string', description: '检索关键字：中文名、纯 ticker 或完整 thscode（如 贵州茅台 / 600519 / 600519.SH）' },
        exchange: { type: 'string', enum: SEARCH_EXCHANGES, description: '交易所过滤（大小写不敏感）：SH / SZ / BJ / SSE / SZSE 与期货交易所 CFFEX / SHFE / INE / DCE / CZCE / GFEX' },
        asset_type: { type: 'string', description: '资产类型过滤（逗号分隔，去重保序）：a-share、a-share-index、forex、fund-otc、fund-etf、fund-lof、fund-reits、futures、options；本 preset 只对股票/指数/基金提供数据端点，futures/options 仅可用于消歧' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '返回条数上限，默认 10，最大 50' },
      }, ['q']),
      outputSchema: searchOutput,
      allowed: ['q', 'exchange', 'asset_type', 'limit'],
      normalize: normalizeTickerSearch,
      guard: { item: { thscode: 'text', name: 'text' } },
    },
    {
      name: 'get_a_share_prices_snapshot',
      capability: 'quote',
      summary: 'A 股行情快照（指定标的或全市场分页）',
      description: '获取 A 股行情快照。两种模式：①指定标的：thscodes 传逗号分隔的完整代码（如 600519.SH,000001.SZ；自动 trim/大写/去重，裸代码被拒），此模式下 limit/offset 按上游语义忽略；②全市场遍历：省略 thscodes，用 limit/offset（limit >= 1、offset >= 0）逐页取数。快照不含股票名称。',
      path: '/api/a-share/prices/snapshot',
      inputSchema: objectSchema({
        thscodes: { type: 'string', description: '逗号分隔的完整交易所代码（如 600519.SH,000001.SZ），需先经 ticker_search 消歧' },
        limit: { type: 'integer', minimum: 1, description: '全市场模式分页大小，默认 100' },
        offset: { type: 'integer', minimum: 0, description: '全市场模式分页游标，默认 0' },
      }),
      outputSchema: snapshotOutput,
      allowed: ['thscodes', 'limit', 'offset'],
      normalize: normalizeQuote,
      guard: { item: { last_price: 'number' } },
      paginated: true,
    },
    {
      name: 'get_a_share_prices_historical',
      capability: 'history',
      summary: '单只标的日 K 线（可复权，窗口 ≤10 年）',
      description: '获取单只标的历史日 K 线。thscode 必须是单只完整代码（不可逗号，自动大写）；interval 当前固定支持 1d（日线）；start/end 为毫秒级 Unix 时间戳（Asia/Shanghai），要求 end >= start 且单次跨度不超过 10 年；adjust 默认 forward（前复权）；offset >= 0。',
      path: '/api/a-share/prices/historical',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '单只标的完整代码（如 600519.SH），不可多只/逗号' },
        interval: { type: 'string', enum: KLINE_INTERVALS, description: 'K 线周期，当前固定支持 1d（日线）' },
        start: { type: 'integer', minimum: 0, description: '起始毫秒级 Unix 时间戳（Asia/Shanghai，例如 2026-08-31 00:00:00 为 1788134400000 量级）' },
        end: { type: 'integer', minimum: 0, description: '截止毫秒级 Unix 时间戳；end >= start；单次跨度不超过 10 年' },
        adjust: { type: 'string', enum: ADJUST_MODES, description: '复权模式：none 不复权 / forward 前复权（默认）/ backward 后复权' },
        offset: { type: 'integer', minimum: 0, description: '分页偏移，默认 0' },
      }, ['thscode', 'interval', 'start', 'end']),
      outputSchema: klineOutput,
      allowed: ['thscode', 'interval', 'start', 'end', 'adjust', 'offset'],
      normalize: normalizeHistory,
      guard: { item: { date_ms: 'number', close_price: 'number' } },
      paginated: true,
    },
    {
      name: 'get_a_share_calendar_trading_days',
      capability: 'trading_calendar',
      summary: '近一年 A 股交易日历',
      description: '获取近一年（365 天）A 股交易日历；无需任何参数，传参会被拒绝。返回 item[]：date_ms 为交易日零点毫秒戳，date 为 YYYYMMDD 字符串。',
      path: '/api/a-share/calendar/trading-days',
      inputSchema: objectSchema({}),
      outputSchema: calendarOutput,
      allowed: [],
      normalize: () => ({}),
      guard: { item: { date_ms: 'number', date: 'text' } },
    },

    // ── Phase 2：代码表与除复权事件 ──────────────────────────────────────────
    {
      name: 'get_meta_tickers_list',
      capability: 'ticker_list',
      summary: '按资产类型分页拉取标的代码表',
      description: '按资产类型分页批量获取标的代码表（含上市/到期/最后交易日等日期字段）。asset_type 逗号分隔，取值 a-share、a-share-index、fund-otc、fund-etf、fund-lof、fund-reits、forex、futures、options，省略返回全部类型；limit 取值 1~10000（默认 1000），offset >= 0。调用方自行递增 offset 取尽（item.length < limit 即到末页）。场外基金的 exchange 为 null。',
      path: '/api/meta/tickers/list',
      inputSchema: objectSchema({
        asset_type: { type: 'string', description: '资产类型（逗号分隔，去重保序）：a-share、a-share-index、fund-otc、fund-etf、fund-lof、fund-reits、forex、futures、options；省略返回全部' },
        limit: { type: 'integer', minimum: 1, maximum: 10000, description: '单页条数，默认 1000，最大 10000' },
        offset: { type: 'integer', minimum: 0, description: '分页偏移，默认 0' },
      }),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(tickerFields) }),
      allowed: ['asset_type', 'limit', 'offset'],
      normalize: normalizeTickerList,
      guard: { item: tickerFields },
      paginated: true,
    },
    {
      name: 'get_a_share_corporate_actions_adjustment_factors',
      capability: 'corporate_actions',
      summary: '单只标的除复权事件流（分红/送转）',
      description: '获取单只标的的除复权事件流（现金分红/送转股/配股原始事件，按 ex_date_ms 降序）。thscode 必须是单只完整代码（不可逗号）；from/to 为 YYYY-MM-DD，可单边省略，to >= from。响应不返回 event_type 与复权因子：事件类型由 dividend_per_share 与 per_share_bonus 隐式区分，复权因子需调用方自行推导；若只要复权后价格，请用 history 并传 adjust。',
      path: '/api/a-share/corporate-actions/adjustment-factors',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '单只标的完整代码（如 600519.SH），不接受逗号' },
        from: { type: 'string', description: '事件起始日，格式 YYYY-MM-DD（可省略）' },
        to: { type: 'string', description: '事件截止日，格式 YYYY-MM-DD（可省略）；to >= from' },
      }, ['thscode']),
      outputSchema: {
        type: 'object',
        properties: {
          thscode: { type: 'string' },
          ticker: { type: 'string' },
          item: { type: 'array', items: rowSchema({ ticker: 'text?', ex_date_ms: 'number', dividend_per_share: 'number?', per_share_bonus: 'number?' }) },
        },
        additionalProperties: true,
      },
      allowed: ['thscode', 'from', 'to'],
      normalize: normalizeCorporateActions,
      guard: {
        data: { thscode: 'text', ticker: 'text?' },
        item: { ticker: 'text?', ex_date_ms: 'number', dividend_per_share: 'number?', per_share_bonus: 'number?' },
      },
    },

    // ── Phase 2：财务三表与财务指标 ──────────────────────────────────────────
    {
      name: 'get_a_share_financials_income_statements',
      capability: 'income_statement',
      summary: '合并利润表多期序列',
      description: 'A 股合并利润表多期序列（按报告期降序）。单只标的：thscode 不接受逗号；period 取 annual（仅年报）或 quarterly（各季度末）；两种取数模式互斥——「最近 N 期」传 limit（1~20，默认 4），「时间区间」传 start+end（毫秒戳，成对出现，跨度不超过 10 年）。金额单位为原币元，basic_eps 为元/股；report_date_ms 是披露日、period_end_ms 是报告期末，做归因/回测须用披露日防前瞻偏差；未披露字段为 null，不补零。',
      path: '/api/a-share/financials/income-statements',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '单只标的完整代码（如 600519.SH），不接受逗号' },
        period: { type: 'string', enum: REPORT_PERIODS, description: '报告期类型：annual（仅 Q4）/ quarterly（每个季度末）' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: '最近 N 期模式，默认 4；与 start/end 互斥' },
        start: { type: 'integer', minimum: 0, description: '时间区间模式起始毫秒戳，需与 end 同传；跨度不超过 10 年' },
        end: { type: 'integer', minimum: 0, description: '时间区间模式结束毫秒戳，需满足 end >= start' },
      }, ['thscode', 'period']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema({ ...financialCommonFields, ...financialNumber(['operating_income', 'operating_costs', 'operating_expenses', 'sales_fee', 'manage_fee', 'research_and_development_expenses', 'operating_profit', 'interest_expenses', 'profit_total', 'income_tax_expense', 'net_profit', 'parent_holder_net_profit', 'basic_eps']) }) }),
      allowed: ['thscode', 'period', 'limit', 'start', 'end'],
      normalize: normalizeFinancial,
      guard: { item: { ...financialCommonFields, ...financialNumber(['operating_income', 'operating_costs', 'operating_expenses', 'sales_fee', 'manage_fee', 'research_and_development_expenses', 'operating_profit', 'interest_expenses', 'profit_total', 'income_tax_expense', 'net_profit', 'parent_holder_net_profit', 'basic_eps']) } },
    },
    {
      name: 'get_a_share_financials_balance_sheets',
      capability: 'balance_sheet',
      summary: '合并资产负债表多期序列',
      description: 'A 股合并资产负债表多期序列（按报告期降序）。参数与利润表完全一致（period + limit 或 start+end，互斥）。金额单位为原币元；未披露字段为 null，不补零。字段名以接口契约为准：assets_total 为资产总计、total_debt 为负债合计、holder_equity_total 为所有者权益合计。',
      path: '/api/a-share/financials/balance-sheets',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '单只标的完整代码（如 000858.SZ），不接受逗号' },
        period: { type: 'string', enum: REPORT_PERIODS, description: '报告期类型：annual（仅 Q4）/ quarterly（每个季度末）' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: '最近 N 期模式，默认 4；与 start/end 互斥' },
        start: { type: 'integer', minimum: 0, description: '时间区间模式起始毫秒戳，需与 end 同传；跨度不超过 10 年' },
        end: { type: 'integer', minimum: 0, description: '时间区间模式结束毫秒戳，需满足 end >= start' },
      }, ['thscode', 'period']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema({ ...financialCommonFields, ...financialNumber(['assets_total', 'total_current_assets', 'non_current_nets_total', 'cash', 'accounts_receivable', 'total_debt', 'holder_equity_total']) }) }),
      allowed: ['thscode', 'period', 'limit', 'start', 'end'],
      normalize: normalizeFinancial,
      guard: { item: { ...financialCommonFields, ...financialNumber(['assets_total', 'total_current_assets', 'non_current_nets_total', 'cash', 'accounts_receivable', 'total_debt', 'holder_equity_total']) } },
    },
    {
      name: 'get_a_share_financials_cash_flow_statements',
      capability: 'cash_flow',
      summary: '合并现金流量表多期序列',
      description: 'A 股合并现金流量表多期序列（按报告期降序）。参数与利润表完全一致（period + limit 或 start+end，互斥）。金额单位为原币元；未披露字段为 null，不补零。pay_fixed_assets_etc_cash 为资本开支口径、pay_dividends_profits_interest_cash 为分配股利/利润/偿付利息口径。',
      path: '/api/a-share/financials/cash-flow-statements',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '单只标的完整代码（如 600519.SH），不接受逗号' },
        period: { type: 'string', enum: REPORT_PERIODS, description: '报告期类型：annual（仅 Q4）/ quarterly（每个季度末）' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: '最近 N 期模式，默认 4；与 start/end 互斥' },
        start: { type: 'integer', minimum: 0, description: '时间区间模式起始毫秒戳，需与 end 同传；跨度不超过 10 年' },
        end: { type: 'integer', minimum: 0, description: '时间区间模式结束毫秒戳，需满足 end >= start' },
      }, ['thscode', 'period']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema({ ...financialCommonFields, ...financialNumber(['act_cash_flow_net', 'invest_cash_flow_net', 'financing_cash_flow_net', 'pay_fixed_assets_etc_cash', 'pay_dividends_profits_interest_cash', 'cash_equivalents_net_addition']) }) }),
      allowed: ['thscode', 'period', 'limit', 'start', 'end'],
      normalize: normalizeFinancial,
      guard: { item: { ...financialCommonFields, ...financialNumber(['act_cash_flow_net', 'invest_cash_flow_net', 'financing_cash_flow_net', 'pay_fixed_assets_etc_cash', 'pay_dividends_profits_interest_cash', 'cash_equivalents_net_addition']) } },
    },
    {
      name: 'get_a_share_financials_indicators',
      capability: 'financial_indicators',
      summary: '单期五类财务指标（成长/盈利/偿债/营运/现金流）',
      description: '获取单只标的指定报告期的五类财务指标（growth/profitability/solvency/operation/cash-flow）。thscode 不接受逗号；report 格式 yyyy-1..yyyy-4（1 一季报/2 中报/3 三季报/4 年报）。返回 data.abilities[].indicators[]，每项含 index_id 与 value：value 是数据源原始数值**字符串**（保留精度与尾随小数位，不转 number），缺失为 null；百分比类指标按百分数原值表达（如 89.12000000 表示 89.12%），周转率按次、已获利息倍数按倍，展示时按 index_id 识别单位。',
      path: '/api/a-share/financials/indicators',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '单只标的完整代码（如 300033.SZ），不接受逗号' },
        report: { type: 'string', description: '报告期，格式 yyyy-1..yyyy-4（1 一季报、2 中报、3 三季报、4 年报），如 2025-1' },
      }, ['thscode', 'report']),
      outputSchema: {
        type: 'object',
        properties: {
          thscode: { type: 'string' },
          report: { type: 'string' },
          abilities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                ability: { type: 'string' },
                indicators: {
                  type: 'array',
                  items: { type: 'object', properties: { index_id: { type: 'string' }, value: { oneOf: [{ type: 'string' }, { type: 'null' }] } }, additionalProperties: true },
                },
              },
              additionalProperties: true,
            },
          },
        },
        additionalProperties: true,
      },
      allowed: ['thscode', 'report'],
      normalize: normalizeFinancialIndicators,
      guard: { data: { thscode: 'text', report: 'text' }, custom: validateAbilities },
    },

    // ── Phase 2：估值与集合竞价 ─────────────────────────────────────────────
    {
      name: 'get_a_share_valuations_snapshot',
      capability: 'valuation',
      summary: '批量估值快照（PE/PB/PS/PCF）',
      description: '批量获取 A 股最新估值快照（固定 5 个指标：市盈率 TTM/MRQ、市净率 MRQ、市销率 TTM、市现率 TTM）。thscodes 必填，逗号分隔的完整代码（6 位数字 + .SH/.SZ/.BJ），单次最多 100 个原始 token（去重前校验，服务端按请求顺序去重返回）。不提供历史估值、分页或指标选择；上游缺失的指标为 null，不补零；未返回的股票不会生成占位项（无匹配时 item 为空数组）。',
      path: '/api/a-share/valuations/snapshot',
      inputSchema: objectSchema({
        thscodes: { type: 'string', description: '逗号分隔的完整代码，如 600519.SH,000001.SZ；单次最多 100 个' },
      }, ['thscodes']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(valuationFields) }),
      allowed: ['thscodes'],
      normalize: normalizeValuation,
      guard: { item: valuationFields },
    },
    {
      name: 'get_a_share_auction_snapshot',
      capability: 'auction',
      summary: '集合竞价快照（实时盘口或终态）',
      description: '获取 A 股集合竞价快照。thscodes 必填，逗号分隔的完整代码，单次最多 100 个原始 token；stage 取 live（实时盘口）或 final（9:25 最终撮合形态，默认 final）。返回 data.auction_phase / data.data_status 与竞价明细：auction_pct 为涨跌幅百分数原值，auction_volume/auction_unmatched 单位为股，auction_amount 单位为元，auction_turnover_pct 为竞价换手率百分数原值，auction_volume_ratio 为竞价量比。',
      path: '/api/a-share/auction/snapshot',
      inputSchema: objectSchema({
        thscodes: { type: 'string', description: '逗号分隔的完整代码，如 600519.SH,000001.SZ；单次最多 100 个' },
        stage: { type: 'string', enum: AUCTION_STAGES, description: '竞价阶段：live 实时盘口 / final 终态（默认 final）' },
      }, ['thscodes']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(auctionFields) }),
      allowed: ['thscodes', 'stage'],
      normalize: normalizeAuction,
      guard: { data: { auction_phase: 'text?', data_status: 'text?' }, item: auctionFields },
    },

    // ── Phase 2：盘面特色数据 ───────────────────────────────────────────────
    {
      name: 'get_a_share_special_data_limit_up_pool',
      capability: 'limit_up_pool',
      summary: '按交易日分页的涨停/连板股票池',
      description: '按交易日获取 A 股涨停/连板股票池（后端固定取全部连板与 main/chinext/ssestar/north 四类板块）。date_ms 为交易日上海时区零点毫秒戳（省略回退服务端当日）；page >= 1；size 取值 1~200（默认 50）；sort_field 取 last_price / continue_day_cnt / seal_money / limit_up_time，sort_dir 取 asc / desc。响应的 data.pagination 给出上游 total/pages/size/page——它描述上游结果集，不等于本 Dataset 的行数；单次请求只取一页，不做自动翻页。limit_up_reason 上游空串会标准化为 null；seal_money/max_seal_money 单位为元。',
      path: '/api/a-share/special-data/limit-up-pool',
      inputSchema: objectSchema({
        date_ms: { type: 'integer', minimum: 0, description: '交易日上海时区零点毫秒戳；省略回退服务端当前自然日' },
        page: { type: 'integer', minimum: 1, description: '页码，从 1 开始，默认 1' },
        size: { type: 'integer', minimum: 1, maximum: 200, description: '单页条数，取值 1~200，默认 50' },
        sort_field: { type: 'string', enum: LIMIT_UP_SORT_FIELDS, description: '排序字段，默认 last_price' },
        sort_dir: { type: 'string', enum: SORT_DIRECTIONS, description: '排序方向，默认 desc' },
      }),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(limitUpPoolFields) }),
      allowed: ['date_ms', 'page', 'size', 'sort_field', 'sort_dir'],
      normalize: normalizeLimitUpPool,
      guard: { data: { pagination: 'object' }, item: limitUpPoolFields },
      paginated: true,
    },
    {
      name: 'get_a_share_special_data_limit_up_ladder',
      capability: 'limit_up_ladder',
      summary: '近 30 日连板天梯矩阵',
      description: '获取 A 股近 30 个交易日的连板天梯矩阵（无入参，上游固定 30 日、每个板位最多 4 只）。data.window 给出窗口长度、交易日列表与各板位容量；data.item[] 按交易日组织，每项含 date 与 boards：two_board、three_board、four_board、five_board、six_board、seven_over 六个数组（上游缺失的板位补 []），元素含 thscode/ticker/name/board_num/seal_nextday/sign_level，其中 seal_nextday 表示次一交易日是否继续封板（最近交易日无次日参考，固定为 null）。',
      path: '/api/a-share/special-data/limit-up-ladder',
      inputSchema: objectSchema({}),
      outputSchema: {
        type: 'object',
        properties: {
          timestamp: { type: 'integer' },
          window: { type: 'object', additionalProperties: true },
          item: {
            type: 'array',
            items: {
              type: 'object',
              properties: { date: { type: 'string' }, boards: { type: 'object', additionalProperties: true } },
              additionalProperties: true,
            },
          },
        },
        additionalProperties: true,
      },
      allowed: [],
      normalize: () => ({}),
      guard: { data: { window: 'object' }, item: ladderFields },
    },

    // ── Phase 2：指数 ───────────────────────────────────────────────────────
    {
      name: 'get_a_share_index_catalog_ths_index_list',
      capability: 'index_catalog',
      summary: '同花顺指数目录（概念/区域/特色/行业）',
      description: '按 tag 列出同花顺指数（概念/区域/特色/行业）清单，单 tag 一次性全量返回、无分页。tag 取 cn_concept（A 股概念，默认）/ region（区域）/ tszs（特色）/ industry（行业），大小写不敏感。返回 item[]：thscode 与 name；指数维度不返回纯代码 ticker。',
      path: '/api/a-share-index/catalog/ths-index-list',
      inputSchema: objectSchema({
        tag: { type: 'string', enum: INDEX_TAGS, description: '标签白名单：cn_concept / region / tszs / industry，默认 cn_concept' },
      }),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(indexCatalogFields) }),
      allowed: ['tag'],
      normalize: normalizeIndexCatalog,
      guard: { item: indexCatalogFields },
    },
    {
      name: 'get_a_share_index_constituents_ths_stock_list',
      capability: 'index_constituents',
      summary: '单个指数的成分股清单',
      description: '按单个指数代码获取当前成分股清单。thscode 为指数代码（交易所指数如 000300.SH / 399300.SZ，或同花顺板块如 886042.TI），不接受逗号，入参会 trim 并转大写。返回 item[]：成分股 thscode/ticker/name。',
      path: '/api/a-share-index/constituents/ths-stock-list',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '指数完整代码，如 000300.SH、399300.SZ 或 886042.TI；不接受逗号' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(indexConstituentFields) }),
      allowed: ['thscode'],
      normalize: normalizeIndexConstituents,
      guard: { item: indexConstituentFields },
    },
    {
      name: 'get_a_share_index_prices_snapshot',
      capability: 'index_quote',
      summary: '指数行情快照（批量）',
      description: '按 thscodes 批量获取指数最新行情快照（覆盖交易所指数与同花顺板块/行业指数）。thscodes 必填，逗号分隔，不接受空入参枚举全指数；limit/offset 对本接口无效，故不暴露。返回 item[] 字段结构与 A 股行情快照一致（last_price/涨跌/开高低/前收/成交量额），不含指数名称。',
      path: '/api/a-share-index/prices/snapshot',
      inputSchema: objectSchema({
        thscodes: { type: 'string', description: '逗号分隔的指数代码，如 000001.SH,399001.SZ,886042.TI' },
      }, ['thscodes']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(indexQuoteFields) }),
      allowed: ['thscodes'],
      normalize: normalizeIndexQuote,
      guard: { item: indexQuoteFields },
    },
    {
      name: 'get_a_share_index_prices_historical',
      capability: 'index_history',
      summary: '单只指数日 K 线（窗口 ≤10 年）',
      description: '获取单只指数的历史 K 线序列，只支持时间区间模式。thscode 为单只指数代码（如 000001.SH / 886042.TI），不接受逗号；interval 当前仅支持 1d；start/end 为毫秒级 Unix 时间戳，end >= start 且跨度不超过 10 年。指数无复权语义：本接口没有 adjust，也没有 offset；响应中的 data.adjust 固定为 null。',
      path: '/api/a-share-index/prices/historical',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '单只指数完整代码（如 000001.SH、886042.TI），不接受逗号' },
        interval: { type: 'string', enum: KLINE_INTERVALS, description: 'K 线周期，当前仅支持 1d' },
        start: { type: 'integer', minimum: 0, description: '起始毫秒级 Unix 时间戳' },
        end: { type: 'integer', minimum: 0, description: '结束毫秒级 Unix 时间戳；end >= start；跨度不超过 10 年' },
      }, ['thscode', 'interval', 'start', 'end']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(indexHistoryFields) }),
      allowed: ['thscode', 'interval', 'start', 'end'],
      normalize: normalizeIndexHistory,
      guard: { item: indexHistoryFields },
    },

    // ── Phase 3：盘面特色数据（doc 详情段 + 真实探针确认可用）────────────────
    {
      name: 'get_a_share_special_data_limit_down_pool',
      capability: 'limit_down_pool',
      summary: '按交易日分页的跌停股票池',
      description: '按交易日获取 A 股跌停股票池（首次/最后跌停时间为上海时区 HH:mm）。date_ms 为交易日上海时区零点毫秒戳（省略回退服务端当日）；page >= 1；size 取值 1~200（默认 50）；sort_field 取 last_limit_time / first_limit_time / last_price / price_change_ratio_pct / turnover_ratio_pct，sort_dir 取 asc / desc。data.pagination 描述上游结果集，不等于本 Dataset 行数；单次只取一页，不自动翻页。turnover_ratio_pct 为换手率百分数原值。',
      path: '/api/a-share/special-data/limit-down-pool',
      inputSchema: objectSchema({
        date_ms: { type: 'integer', minimum: 0, description: '交易日上海时区零点毫秒戳；省略回退服务端当前自然日' },
        page: { type: 'integer', minimum: 1, description: '页码，从 1 开始，默认 1' },
        size: { type: 'integer', minimum: 1, maximum: 200, description: '单页条数，取值 1~200，默认 50' },
        sort_field: { type: 'string', enum: LIMIT_DOWN_SORT_FIELDS, description: '排序字段，默认 last_limit_time' },
        sort_dir: { type: 'string', enum: SORT_DIRECTIONS, description: '排序方向，默认 desc' },
      }),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(limitDownFields) }),
      allowed: ['date_ms', 'page', 'size', 'sort_field', 'sort_dir'],
      normalize: normalizeLimitDownPool,
      guard: { data: { pagination: 'object' }, item: limitDownFields },
      paginated: true,
    },
    {
      name: 'get_a_share_special_data_limit_break_pool',
      capability: 'limit_break_pool',
      summary: '按交易日分页的炸板（涨停破板）股票池',
      description: '按交易日获取 A 股涨停炸板股票池（接口直接消费炸板集合，不做服务端归因）。date_ms 为交易日上海时区零点毫秒戳（省略回退服务端当日）；page >= 1；size 取值 1~200（默认 50）；sort_field 取 price_change_ratio_pct / open_times / last_price / turnover_ratio_pct / turnover，sort_dir 取 asc / desc。open_times 为盘中开板次数；turnover 为成交额（元）；data.pagination 描述上游结果集，不等于本 Dataset 行数。',
      path: '/api/a-share/special-data/limit-break-pool',
      inputSchema: objectSchema({
        date_ms: { type: 'integer', minimum: 0, description: '交易日上海时区零点毫秒戳；省略回退服务端当前自然日' },
        page: { type: 'integer', minimum: 1, description: '页码，从 1 开始，默认 1' },
        size: { type: 'integer', minimum: 1, maximum: 200, description: '单页条数，取值 1~200，默认 50' },
        sort_field: { type: 'string', enum: LIMIT_BREAK_SORT_FIELDS, description: '排序字段，默认 price_change_ratio_pct' },
        sort_dir: { type: 'string', enum: SORT_DIRECTIONS, description: '排序方向，默认 desc' },
      }),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(limitBreakFields) }),
      allowed: ['date_ms', 'page', 'size', 'sort_field', 'sort_dir'],
      normalize: normalizeLimitBreakPool,
      guard: { data: { pagination: 'object' }, item: limitBreakFields },
      paginated: true,
    },
    {
      name: 'get_a_share_special_data_skyrocket_list',
      capability: 'skyrocket_list',
      summary: 'A 股热度飙升榜 Top30（日榜/小时榜）',
      description: '查询 A 股热度排名飙升榜 Top30。period 取 day（日榜）或 hour（小时榜），省略默认 day。返回 item[] 最多 30 条：rank 为当前排名，heat 是上游原始**字符串**热度值（保留精度，不转数字），rank_change 为排名变化（正数上升、负数下降，上游缺失为 null），rank_trend 取 up / down / flat / unknown。',
      path: '/api/a-share/special-data/skyrocket-list',
      inputSchema: objectSchema({
        period: { type: 'string', enum: RANK_PERIODS, description: '榜单周期：day 日榜（默认）/ hour 小时榜' },
      }),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(rankListFields) }),
      allowed: ['period'],
      normalize: normalizeRankList,
      guard: { item: rankListFields },
    },
    {
      name: 'get_a_share_special_data_hot_stock_list',
      capability: 'hot_stock_list',
      summary: 'A 股热股榜 Top30（24 小时/小时级）',
      description: '查询 A 股热股榜单 Top30。period 取 day（24 小时级别，默认）或 hour（小时级别）。响应结构与飙升榜一致：rank 排名、heat 上游原始字符串热度值、rank_change 排名变化（可为 null）、rank_trend 取 up / down / flat / unknown。',
      path: '/api/a-share/special-data/hot-stock-list',
      inputSchema: objectSchema({
        period: { type: 'string', enum: RANK_PERIODS, description: '榜单周期：day 24 小时级别（默认）/ hour 小时级别' },
      }),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(rankListFields) }),
      allowed: ['period'],
      normalize: normalizeRankList,
      guard: { item: rankListFields },
    },
    {
      name: 'get_a_share_special_data_hot_stock_list_history',
      capability: 'hot_stock_history',
      summary: '按自然日的历史热股榜排行（最多 30 条）',
      description: '按自然日返回历史热股榜排行，最多 30 条。date 必填，格式 yyyy-MM-dd，只支持一年内数据（上游对外只接受日期字符串，避免调用方传时间戳导致未对齐自然日）。data 含 date（查询自然日）与 date_ms（该日上海时区零点毫秒戳）；item[] 只有 thscode / ticker / name / rank。',
      path: '/api/a-share/special-data/hot-stock-list-history',
      inputSchema: objectSchema({
        date: { type: 'string', description: '目标自然日，格式 yyyy-MM-dd，只支持一年内数据' },
      }, ['date']),
      outputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          date_ms: { type: 'integer' },
          item: { type: 'array', items: rowSchema(hotStockHistoryFields) },
        },
        additionalProperties: true,
      },
      allowed: ['date'],
      normalize: normalizeHotStockHistory,
      guard: { data: { date: 'text', date_ms: 'number' }, item: hotStockHistoryFields },
    },
    {
      name: 'get_a_share_special_data_hot_stock_rank_trend',
      capability: 'hot_stock_rank_trend',
      summary: '单只 A 股的热榜排名走势（日线点位）',
      description: '查询单只 A 股在自然日窗口内的热榜排名走势，返回与上游日线对齐的点位、不做 Top30 截断。thscode 为单只完整代码；start_date / end_date 必填，格式 yyyy-MM-dd，要求 end_date >= start_date；日期与窗口都限制在一年内。item[] 含 date（自然日）、date_ms 与当日 rank。',
      path: '/api/a-share/special-data/hot-stock-rank-trend',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '单只 A 股完整代码（如 300034.SZ），不接受逗号' },
        start_date: { type: 'string', description: '起始自然日，格式 yyyy-MM-dd' },
        end_date: { type: 'string', description: '结束自然日，格式 yyyy-MM-dd；需 >= start_date；窗口不超过一年' },
      }, ['thscode', 'start_date', 'end_date']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(rankTrendFields) }),
      allowed: ['thscode', 'start_date', 'end_date'],
      normalize: normalizeHotStockRankTrend,
      guard: { item: rankTrendFields },
    },
    {
      name: 'get_a_share_special_data_anomaly_analysis_list',
      capability: 'anomaly_list',
      summary: '当日个股异动原因列表（可按标签过滤）',
      description: '查询当日个股异动原因，可选按异动标签过滤；不传 tag_codes 时返回全部当日记录。tag_codes 逗号分隔、多个值为 OR、大小写不敏感、重复值去重，合法值：LIMIT_UP 涨停 / LIMIT_DOWN 跌停 / SHARP_RISE 大涨 / SHARP_FALL 大跌 / RAPID_RALLY 快速拉升 / RAPID_DECLINE 快速下挫。item[] 含 stock_name、analysis_content、keyword_list（关键词数组，可为空数组）、thscode、tag_name。当日快照未就绪返回 3002；有快照但无匹配时 item 为空数组。（该接口上游只提供 REST，不同步为 MCP 工具。）',
      path: '/api/a-share/special-data/anomaly-analysis-list',
      inputSchema: objectSchema({
        tag_codes: { type: 'string', description: '异动标签，**可传逗号分隔的多个值（OR 关系）**，大小写不敏感、重复去重。合法值：LIMIT_UP / LIMIT_DOWN / SHARP_RISE / SHARP_FALL / RAPID_RALLY / RAPID_DECLINE；不传表示全部当日记录。注意本参数不是单值枚举，可组合如 LIMIT_UP,SHARP_FALL' },
      }),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(anomalyFields) }),
      allowed: ['tag_codes'],
      normalize: normalizeAnomalyList,
      guard: { item: anomalyFields },
    },
    {
      name: 'get_a_share_special_data_anomaly_analysis_stock',
      capability: 'anomaly_stock',
      summary: '按股票批量查询当日异动原因',
      description: '按同花顺代码批量查询当日个股异动原因，按请求代码首次出现顺序返回匹配记录；格式合法但当日无异动的代码会被忽略。thscodes 必填，逗号分隔的完整代码（SH/SZ/BJ），去重前最多 50 个 token。字段与异动原因列表一致（stock_name / analysis_content / keyword_list / thscode / tag_name）；当日快照未就绪返回 3002。',
      path: '/api/a-share/special-data/anomaly-analysis-stock',
      inputSchema: objectSchema({
        thscodes: { type: 'string', description: '逗号分隔的完整代码（如 600519.SH,000001.SZ），去重前最多 50 个' },
      }, ['thscodes']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(anomalyFields) }),
      allowed: ['thscodes'],
      normalize: normalizeAnomalyStock,
      guard: { item: anomalyFields },
    },
    {
      name: 'get_a_share_special_data_dragon_tiger_list',
      capability: 'dragon_tiger',
      summary: 'A 股龙虎榜（全部/机构榜/游资榜，不分页）',
      description: '按交易日返回 A 股龙虎榜整体榜单，一个接口覆盖全部 / 机构榜 / 游资榜，固定全量返回、不分页。board_type 取 all / org / hot_money（默认 all）；date 格式 yyyy-MM-dd，只支持一年内且必须是交易日（显式传非交易日返回 1002，不自动回退），省略时取最近可用交易日。data 含 board_type、trade_date、count（上游记录数，同一股票可能同时上当日榜与 3 日榜）、stock_count（去重数量）、stock_items[]（board_type=all/org 时填充）与 hot_money_items[]（board_type=hot_money 时填充）；两者互斥为空数组。注意 change 与 net_rate 是**小数形式**（0.09994 表示 9.994%），与行情接口的百分数原值口径不同；概念、机构与游资净买入字段见 output_schema。',
      path: '/api/a-share/special-data/dragon-tiger-list',
      inputSchema: objectSchema({
        board_type: { type: 'string', enum: DRAGON_TIGER_BOARDS, description: '榜单类型：all 全部（默认）/ org 机构榜 / hot_money 游资榜' },
        date: { type: 'string', description: '目标交易日，格式 yyyy-MM-dd，只支持一年内；必须是交易日' },
      }),
      outputSchema: {
        type: 'object',
        properties: {
          timestamp: { type: 'integer' },
          board_type: { type: 'string' },
          trade_date: { type: 'string' },
          count: { type: 'integer' },
          stock_count: { type: 'integer' },
          stock_items: { type: 'array', items: rowSchema(dragonTigerStockFields) },
          hot_money_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                buying: { type: 'number' },
                rows: { type: 'array', items: rowSchema(dragonTigerStockFields) },
              },
              additionalProperties: true,
            },
          },
        },
        additionalProperties: true,
      },
      allowed: ['board_type', 'date'],
      normalize: normalizeDragonTiger,
      guard: {
        data: { board_type: 'text?', trade_date: 'text', stock_items: 'array', hot_money_items: 'array' },
        itemKey: 'stock_items',
        item: dragonTigerStockFields,
      },
    },

    // ── Phase 3：短线风向标竞价基准 ─────────────────────────────────────────
    {
      name: 'get_a_share_auction_short_term_benchmark',
      capability: 'auction_benchmark',
      summary: '短线风向标竞价基准（带标签的精选池）',
      description: '获取追踪集合竞价异动的短线风向标精选池。date 可选，格式 yyyy-MM-dd；省略时用上海时区当日，显式指定非交易日不自动回退。data 含 date（最终查询日期）与 date_ms（该日零点毫秒戳）；item[] 含 thscode / ticker / name / auction_pct（竞价涨跌幅百分数原值）与 tags（标签数组，如 高开、放量）。',
      path: '/api/a-share/auction/short-term-benchmark',
      inputSchema: objectSchema({
        date: { type: 'string', description: '查询日期，格式 yyyy-MM-dd；省略用上海时区当日' },
      }),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(auctionBenchmarkFields) }),
      allowed: ['date'],
      normalize: (params: Params): Params => {
        const normalized: Params = {}
        if (params.date !== undefined) normalized.date = dateString(params.date, 'date')
        return normalized
      },
      guard: { data: { date: 'text', date_ms: 'number' }, item: auctionBenchmarkFields },
    },

    // ── Phase 3B：公募基金（14 个核心端点；契约 = 文档详情段 + 真实探针）────────
    // 定位规则：这些端点全部只吃**单数 thscode**（基金代码带 .OF/.SH/.SZ 后缀），
    // 经理与公司分别用 manager_id / company_id；ths_api.md 里的 fund_type(otc/exchange/reits)
    // 实测并不存在（上游会忽略未知参数，我们不忽略）。金额/份额单位多处文档未给出，
    // 一律按原值转述、不擅自换算。
    {
      name: 'get_fund_profile_detail',
      capability: 'fund_profile',
      summary: '基金基本资料（规模/净值/经理/费率）',
      description: '获取单只基金的基本资料。thscode 为完整基金代码（025480.OF / 510300.SH / 161725.SZ），不接受逗号。item[] 含 fund_name、estab_date（成立日期，毫秒时间戳）、company_id（可用于 fund_company）、mgmt_name、manager_name、fund_scale、unit_nav，以及三个嵌套数组：manager_info（实测元素含 manager_id / manager_name / tenure_return_pct / tenure_days / start_date_ms）、trade_rule（交易规则）、rate_info（费率，实测元素含 rate_type / charge_mode / standard_rate）。fund_name / estab_date / company_id / mgmt_name / manager_name / fund_scale / unit_nav 均可为 null；fund_scale 与 unit_nav 的单位文档未给出，按原值转述。',
      path: '/api/fund/profile/detail',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码，必须保留市场后缀，如 025480.OF / 510300.SH / 161725.SZ' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundProfileFields) }),
      allowed: ['thscode'],
      normalize: onlyFundCode,
      guard: { item: fundProfileFields },
    },
    {
      name: 'get_fund_market_snapshot',
      capability: 'fund_quote',
      summary: '场内基金（ETF）行情快照',
      description: '获取单只**场内 ETF** 的最新行情快照。thscode 必填、单只、带后缀，不接受逗号多值。**当前仅支持 ETF：LOF、场外基金、REITs 或尚未开放的基金叶子类型返回 code=3004。** item[] 含 last_price / open_price / high_price / low_price / prev_price / price_change / price_change_ratio_pct（百分数原值）/ price_amplitude_ratio_pct（振幅，百分数原值）/ volume / turnover / turnover_ratio_pct（换手率，百分数原值）；价格按原始货币计价。data.timestamp 在无有效数据时为 null。',
      path: '/api/fund/market/snapshot',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '单只场内 ETF 的完整代码（如 510300.SH），不接受逗号多值' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundQuoteFields) }),
      allowed: ['thscode'],
      normalize: onlyFundCode,
      guard: { item: fundQuoteFields },
    },
    {
      name: 'get_fund_market_historical',
      capability: 'fund_history',
      summary: '场内基金（ETF）历史日 K 线',
      description: '获取单只**场内 ETF** 的历史日 K 线。thscode 必填、单只、带后缀、不接受逗号；interval 当前仅支持 1d；start / end 为毫秒级 Unix 时间戳，要求 end >= start 且**窗口最长 5 个自然年**（注意：比 A 股 history 的 10 年更短）。LOF、场外基金与 REITs 返回 code=3004。item[] 含 date_ms / 开高低收 / volume / turnover；价格为前复权口径，响应中的 data.adjust 固定为 null（该字段不是请求参数）。volume / turnover 单位文档未给出。',
      path: '/api/fund/market/historical',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '单只场内 ETF 的完整代码（如 510300.SH），不接受逗号多值' },
        interval: { type: 'string', enum: KLINE_INTERVALS, description: 'K 线周期，当前仅支持 1d' },
        start: { type: 'integer', minimum: 0, description: '起始毫秒级 Unix 时间戳' },
        end: { type: 'integer', minimum: 0, description: '结束毫秒级 Unix 时间戳；end >= start；单次窗口不超过 5 个自然年' },
      }, ['thscode', 'start', 'end']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundHistoryFields) }),
      allowed: ['thscode', 'interval', 'start', 'end'],
      normalize: normalizeFundMarketHistory,
      guard: { item: fundHistoryFields },
    },
    {
      name: 'get_fund_performance_nav',
      capability: 'fund_nav',
      summary: '基金历史净值（单位/复权，按区间）',
      description: '获取单只基金的历史净值序列。thscode 必填带后缀；range 可选，取 week / month / tmonth / hyear / year / twoyear / tyear / fyear，省略时最多返回最新一个净值日期（给了 range 则按 nav_date 升序返回区间序列）；nav_type 可选，取 unit（单位净值）/ adj（复权净值）/ unit,adj（默认，同时返回）。item[] 含 nav_date（净值日期，**毫秒时间戳**）与 unit_nav / adj_nav：**未通过 nav_type 请求的字段不会输出**，因此按需取字段。复权净值不等同于累计净值。',
      path: '/api/fund/performance/nav',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 510300.SH）' },
        range: { type: 'string', enum: NAV_RANGES, description: '区间：week/month/tmonth/hyear/year/twoyear/tyear/fyear；省略只返回最新一个净值日期' },
        nav_type: { type: 'string', enum: NAV_TYPES, description: '净值类型：unit 单位净值 / adj 复权净值 / unit,adj 同时返回（默认）' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundNavFields) }),
      allowed: ['thscode', 'range', 'nav_type'],
      normalize: normalizeFundNav,
      guard: { item: fundNavFields },
    },
    {
      name: 'get_fund_performance_returns',
      capability: 'fund_returns',
      summary: '基金阶段收益与同类排名',
      description: '获取单只基金的阶段收益率、同类平均与排名。thscode 必填带后缀。item[] 为一行多列：return_* 覆盖 week / month / tmonth / hyear / year / twoyear / tyear / fyear / nowyear / now（近一周到成立以来），同类平均为 peer_average_*，排名与参与总数为 rank_* / rank_total_*。**收益率一律为百分数原值**（8.88 表示 8.88%）。该行没有代码类主标识字段，结构与字段集合以上游返回为准。',
      path: '/api/fund/performance/returns',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 510300.SH）' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundReturnsFields) }),
      allowed: ['thscode'],
      normalize: onlyFundCode,
      guard: { custom: validateFundReturns },
    },
    {
      name: 'get_fund_performance_drawdowns',
      capability: 'fund_drawdowns',
      summary: '基金各区间最大回撤',
      description: '获取单只基金各区间最大回撤。thscode 必填带后缀。item[] 含 thscode / ticker 与十个区间字段：week / month / tmonth / hyear / year / twoyear / tyear / fyear / nowyear / now（近一周到成立以来）。**回撤为百分数原值且通常为负数**（例如 -12.5 表示回撤 12.5%），不是小数形式。',
      path: '/api/fund/performance/drawdowns',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 510300.SH）' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundDrawdownFields) }),
      allowed: ['thscode'],
      normalize: onlyFundCode,
      guard: { item: fundDrawdownFields },
    },
    {
      name: 'get_fund_portfolio_holdings',
      capability: 'fund_holdings',
      summary: '基金重仓持仓（定期披露，非实时）',
      description: '获取单只基金定期披露的持仓明细（**来自定期报告、不是实时持仓**）。thscode 必填带后缀。item[] 含持仓标的 thscode / ticker / stock_name（资产名称，字段名为兼容旧契约保留）/ hold_ratio（占基金净值比例，百分数原值）/ asset_type（stock / bond / fund）/ position_capital（持仓市值）/ position_count（持仓数量）/ security_market_value_rate_pct / period_increase_rate_pct / investment_rank / start_date_ms / end_date_ms / publish_date_ms / modify_time_ms。data 顶层**还可能包含**汇总标量 total_stock_ratio_pct、total_bond_ratio_pct、total_fund_ratio_pct、turnover_rate_pct、stock_ratio_pct、main_industry、concentration_ratio——它们条件出现，不要假定一定存在。市值/数量单位文档未给出。',
      path: '/api/fund/portfolio/holdings',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 025480.OF 或 510300.SH）' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundHoldingFields) }),
      allowed: ['thscode'],
      normalize: onlyFundCode,
      guard: {
        data: {
          total_stock_ratio_pct: 'number?', total_bond_ratio_pct: 'number?', total_fund_ratio_pct: 'number?',
          turnover_rate_pct: 'number?', stock_ratio_pct: 'number?', main_industry: 'text?', concentration_ratio: 'number?',
        },
        item: fundHoldingFields,
      },
    },
    {
      name: 'get_fund_portfolio_asset_allocation',
      capability: 'fund_asset_allocation',
      summary: '基金资产配置比例（按报告期）',
      description: '获取单只基金按报告期的资产配置比例。thscode 必填带后缀。item[] 含 report_date_ms（报告期，毫秒时间戳）与 stock_ratio_pct / bond_ratio_pct / deposit_ratio_pct / other_ratio_pct（股票/债券/存款/其他占比，**均为百分数原值**）。data.timestamp 为接口响应时间戳。',
      path: '/api/fund/portfolio/asset-allocation',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 510300.SH）' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundAssetAllocationFields) }),
      allowed: ['thscode'],
      normalize: onlyFundCode,
      guard: { item: fundAssetAllocationFields },
    },
    {
      name: 'get_fund_portfolio_industry_allocation',
      capability: 'fund_industry_allocation',
      summary: '基金行业配置比例（按报告期）',
      description: '获取单只基金按报告期的行业配置比例。thscode 必填带后缀。item[] 含 report_period（字符串报告期，形如 2026Q2）、industry_name（行业名称）与 ratio_pct（行业配置比例，百分数原值）。注意该数据并非所有基金都有：实测部分 ETF 返回 code=5003（上游数据源无该基金行业配置），这属于上游数据缺失而非参数错误，不要重试到超时。',
      path: '/api/fund/portfolio/industry-allocation',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 025480.OF）' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundIndustryAllocationFields) }),
      allowed: ['thscode'],
      normalize: onlyFundCode,
      guard: { item: fundIndustryAllocationFields },
    },
    {
      name: 'get_fund_portfolio_stock_history',
      capability: 'fund_stock_history',
      summary: '基金历史股票持仓（按报告期与截止日）',
      description: '获取单只基金指定报告期的历史股票持仓。三个参数都必填：thscode（带后缀）、report_type（报告类型，**上游枚举未公开**，实测 quarter 有数据；annual/half 返回 5003 表示上游无该类型数据而非参数错误，因此不要据此判断参数对错）、end_date（报告截止日，格式 yyyy-MM-dd）。item[] 含持仓 thscode / ticker / name / asset_type（股票为 stock）/ hold_ratio（持仓占比，百分数原值）/ market_value（持仓市值，单位文档未给出）/ period_increase_pct（报告期增减比例，百分数原值）/ rank（**仅前十大返回 1~10，其余为 null**）/ report_type / end_date_ms。',
      path: '/api/fund/portfolio/stock-history',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 510300.SH）' },
        report_type: { type: 'string', description: '报告类型；上游未公开枚举，实测 quarter 可用' },
        end_date: { type: 'string', description: '报告截止日期，格式 yyyy-MM-dd' },
      }, ['thscode', 'report_type', 'end_date']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundStockHistoryFields) }),
      allowed: ['thscode', 'report_type', 'end_date'],
      normalize: normalizeFundStockHistory,
      guard: { item: fundStockHistoryFields },
    },
    {
      name: 'get_fund_holders_detail',
      capability: 'fund_holders',
      summary: '基金持有人结构（机构/个人/员工占比）',
      description: '获取单只基金的持有人结构。thscode 必填带后缀；merge_scope 可选，取 all（默认，分别返回合并/独立份额的最新记录）/ merged（A/C 等份额合并披露）/ separate（当前份额独立披露）。item[] 含 merge_scope（实际口径，取值 merged 或 separate）、report_date_ms、ins_position（机构占比，百分数原值）、holder_amount（持有人户数）、avg_holder_share（平均每户持有份额，单位文档未给出）、psnl_rate（个人占比，百分数原值）、mgmt_staff_hold_rate（管理人员工持有比例，百分数原值）。merge_scope=all 时最多 2 条，单一口径最多 1 条；所选口径暂无数据返回 code=3002。data.timestamp 取返回记录中最新的报告日。',
      path: '/api/fund/holders/detail',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 161725.SZ）' },
        merge_scope: { type: 'string', enum: MERGE_SCOPES, description: '披露口径：all 合并+独立（默认）/ merged 合并 / separate 独立' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundHolderFields) }),
      allowed: ['thscode', 'merge_scope'],
      normalize: normalizeFundHolders,
      guard: { item: fundHolderFields },
    },
    {
      name: 'get_fund_holders_top',
      capability: 'fund_top_holders',
      summary: '基金前十大持有人（含多报告期）',
      description: '获取基金前十大持有人名单。thscode 必填带后缀；limit 可选、取值 1~10（实测 0 / 11 / 201 均返回 1003）。**实测 limit 限定的是报告期数而不是返回行数**：limit=10 时返回 10 个报告期、共 99 行，因此引用条数时必须用 item 的实际长度，不要把 limit 当作行数；data.limit 是服务端实际采用的上限。item[] 含 holder_id / holder_code / holder_name / holder_type / rank / hold_share（持有份额，单位文档未给出）/ hold_rate_pct（持有比例，百分数原值）/ report_date_ms / publish_date_ms。',
      path: '/api/fund/holders/top',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 510300.SH）' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_TOP_HOLDERS_LIMIT, description: '报告期数上限，取值 1~10；实测它限定报告期数而非返回行数' },
      }, ['thscode']),
      outputSchema: {
        type: 'object',
        properties: {
          timestamp: { type: 'integer' },
          limit: { type: 'integer' },
          item: { type: 'array', items: rowSchema(fundTopHolderFields) },
        },
        additionalProperties: true,
      },
      allowed: ['thscode', 'limit'],
      normalize: normalizeFundTopHolders,
      guard: { data: { limit: 'number?' }, item: fundTopHolderFields },
    },
    {
      name: 'get_fund_managers_detail',
      capability: 'fund_manager',
      summary: '基金经理详情（履历/年化/雷达对比）',
      description: '按经理 ID 获取基金经理详情。manager_id 必填，可从 fund_profile 的 manager_info[].manager_id 取得。item[] 含 manager_id / manager_name / sex / degree / company_id / company_name / resume（履历）/ photo_url / annual_return_pct / maximum_return_pct / radar_comparison（数组）；除前两项外均可为 null。**口径警告**：文档对收益率单位自相矛盾（分组说明称百分数原值，官方响应示例却是小数形式 0.05096597），引用这两个字段时必须按原值转述并注明口径未确认，不要自行换算成百分比。',
      path: '/api/fund/managers/detail',
      inputSchema: objectSchema({
        manager_id: { type: 'string', description: '基金经理 ID，可从 fund_profile 的 manager_info[].manager_id 取得' },
      }, ['manager_id']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundManagerFields) }),
      allowed: ['manager_id'],
      normalize: normalizeFundManager,
      guard: { item: fundManagerFields },
    },
    {
      name: 'get_fund_companies_detail',
      capability: 'fund_company',
      summary: '基金公司详情（规模/基金只数）',
      description: '按公司 ID 获取基金公司详情。company_id 必填，可从 fund_profile 的 company_id 取得。item[] 含 company_id / company_name / company_type / established_date_ms（成立日期，毫秒时间戳）/ fund_count（旗下基金数量）/ scale（管理规模）。**scale 的金额单位文档未给出**，按原值转述，不要擅自标成亿元。',
      path: '/api/fund/companies/detail',
      inputSchema: objectSchema({
        company_id: { type: 'string', description: '基金公司 ID，可从 fund_profile 的 company_id 取得' },
      }, ['company_id']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundCompanyFields) }),
      allowed: ['company_id'],
      normalize: normalizeFundCompany,
      guard: { item: fundCompanyFields },
    },

    // ── Phase 3C：基金进阶子模块（19 个端点；已确证全部开放、非 AI 客户端专用）──
    // 口径提醒：基金各页**金额币种单位文档未给出**（对比 A 股财务页明写"原币元"），
    // 一律按原值转述；多处百分比为"百分数原值"，但回测 metrics 口径文档自相矛盾。
    {
      name: 'get_fund_performance_indicators_historical',
      capability: 'fund_performance_history',
      summary: '基金净值指标历史（RSI/唐奇安/估值分位）',
      description: '获取基金按日的历史指标序列。thscode、start、end 三者都必填，start/end 为**毫秒级 Unix 时间戳**且 end >= start。item[] 含 date_ms 与三个指标：rsi_pct（净值波动 RSI）、donchian_channel（趋势强弱/唐奇安通道）、track_index_pe_ttm_five_year_percentile（跟踪指数 PE TTM 五年分位）。data.timestamp 保留明确的上游数据时间，不要当作响应时刻。',
      path: '/api/fund/performance/indicators-historical',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 510300.SH）' },
        start: { type: 'integer', minimum: 0, description: '起始毫秒级 Unix 时间戳（必填）' },
        end: { type: 'integer', minimum: 0, description: '结束毫秒级 Unix 时间戳（必填）；end >= start' },
      }, ['thscode', 'start', 'end']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundPerformanceHistoryFields) }),
      allowed: ['thscode', 'start', 'end'],
      normalize: normalizeFundPerformanceHistory,
      guard: { item: fundPerformanceHistoryFields },
    },
    {
      name: 'get_fund_portfolio_bond_history',
      capability: 'fund_bond_history',
      summary: '基金历史债券持仓（按报告期）',
      description: '获取单只基金指定报告期的历史债券持仓，字段结构与历史股票持仓一致：thscode / ticker / name / asset_type（债券为 bond）/ hold_ratio（百分数原值）/ market_value / period_increase_pct（百分数原值）/ report_type / end_date_ms；rank 仅前十大返回 1~10、其余为 null。三个参数都必填：thscode（带后缀）、report_type（上游枚举未公开，实测 quarter 可用）、end_date（格式 yyyy-MM-dd）。',
      path: '/api/fund/portfolio/bond-history',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 510300.SH）' },
        report_type: { type: 'string', description: '报告类型；上游未公开枚举，实测 quarter 可用' },
        end_date: { type: 'string', description: '报告截止日期，格式 yyyy-MM-dd' },
      }, ['thscode', 'report_type', 'end_date']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundStockHistoryFields) }),
      allowed: ['thscode', 'report_type', 'end_date'],
      normalize: normalizeFundStockHistory,
      guard: { item: fundStockHistoryFields },
    },
    {
      name: 'get_fund_portfolio_stock_report_dates',
      capability: 'fund_stock_report_dates',
      summary: '基金股票持仓的可用报告期清单',
      description: '获取该基金股票持仓可用的报告期清单，用于在调用历史持仓前确定合法的 report_type 与 end_date 组合。thscode 必填；report_type **可选**（省略返回全部类型）。item[] 含 report_type、report_type_name（中文名，如"季度"）与 start_date_ms / end_date_ms（该报告期的起止毫秒戳）。',
      path: '/api/fund/portfolio/stock-report-dates',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 510300.SH）' },
        report_type: { type: 'string', description: '报告类型，可选；省略返回全部类型' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundReportDatesFields) }),
      allowed: ['thscode', 'report_type'],
      normalize: normalizeFundReportType,
      guard: { item: fundReportDatesFields },
    },
    {
      name: 'get_fund_portfolio_bond_report_dates',
      capability: 'fund_bond_report_dates',
      summary: '基金债券持仓的可用报告期清单',
      description: '获取该基金债券持仓可用的报告期清单，字段结构与股票版一致（report_type / report_type_name / start_date_ms / end_date_ms）。thscode 必填；report_type 可选，省略返回全部类型。',
      path: '/api/fund/portfolio/bond-report-dates',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 510300.SH）' },
        report_type: { type: 'string', description: '报告类型，可选；省略返回全部类型' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundReportDatesFields) }),
      allowed: ['thscode', 'report_type'],
      normalize: normalizeFundReportType,
      guard: { item: fundReportDatesFields },
    },
    {
      name: 'get_fund_managers_experience',
      capability: 'fund_manager_experience',
      summary: '基金经理获奖、重仓与从业经历',
      description: '获取基金经理的获奖经历、代表性重仓与从业经历。manager_id 必填（可从 fund_profile 的 manager_info[].manager_id 取得）。item[] 含三个**保留上游结构**的字段：awards（可为数组、对象或 null）、heavy_assets（示例形如 {stock:[{trade_name, trade_code, market_value, scale}]}）、investment_history（示例为以纯代码为键的 map，其 end 可以是"至今"这类字符串）。因此这些字段按原样转述，不要假设固定内部键名。',
      path: '/api/fund/managers/experience',
      inputSchema: objectSchema({
        manager_id: { type: 'string', description: '基金经理 ID，可从 fund_profile 的 manager_info[].manager_id 取得' },
      }, ['manager_id']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundManagerExperienceFields) }),
      allowed: ['manager_id'],
      normalize: normalizeFundManager,
      guard: { item: fundManagerExperienceFields },
    },
    {
      name: 'get_fund_managers_investment_style',
      capability: 'fund_manager_style',
      summary: '基金经理投资风格（理念/行业偏好）',
      description: '获取基金经理的投资风格画像。manager_id 必填。item[] 含 representative_fund_thscode / representative_fund_ticker / representative_fund_name、investment_idea（投资理念）、total_fund_scale（管理基金总规模）、industry_preferences（行业偏好，**保留上游结构**，实测为年度记录数组，元素含 report_tag / percent[] / total_fund_scale）。除 industry_preferences 外所有字段都可为 null；关联基金解析失败时对应字段为空但不影响主能力。',
      path: '/api/fund/managers/investment-style',
      inputSchema: objectSchema({
        manager_id: { type: 'string', description: '基金经理 ID，可从 fund_profile 的 manager_info[].manager_id 取得' },
      }, ['manager_id']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundManagerStyleFields) }),
      allowed: ['manager_id'],
      normalize: normalizeFundManager,
      guard: { item: fundManagerStyleFields },
    },
    {
      name: 'get_fund_managers_performance',
      capability: 'fund_manager_performance',
      summary: '基金经理区间收益与同类/基准对比',
      description: '获取基金经理在指定区间的收益表现。manager_id 与 range 都必填；**range 枚举只有 5 个值**：month / tmonth / year / nowyear / now（比 fund_nav 的 8 值枚举少）。item[] 含 date_ms 与 manager_return_pct（经理收益率）/ peer_return_pct（同类收益率）/ benchmark_return_pct（基准收益率），三者均为**百分数原值**。注意：若该经理缺少上游画像数据，接口会返回 code=5003 而非参数错误。',
      path: '/api/fund/managers/performance',
      inputSchema: objectSchema({
        manager_id: { type: 'string', description: '基金经理 ID' },
        range: { type: 'string', enum: MANAGER_RANGES, description: '区间：month / tmonth / year / nowyear / now' },
      }, ['manager_id', 'range']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundManagerPerformanceFields) }),
      allowed: ['manager_id', 'range'],
      normalize: normalizeManagerRange,
      guard: { item: fundManagerPerformanceFields },
    },
    {
      name: 'get_fund_financials_income_statements',
      capability: 'fund_income',
      summary: '基金利润表（按报告期）',
      description: '获取基金定期报告的利润表序列。thscode 必填带后缀。item[] 含起止与披露日期（start_date_ms / end_date_ms / publish_date_ms）以及收入与费用类金额字段：investment_income、stock/bond/fund_investment_income、dividend_income、interest_income、fair_value_income、exchange_income、other_income、total_income、fee、total_fee、manager_reward、custodian_fee、transaction_cost、tax_surcharge、total_profit、net_profit 等。**未披露字段保持 null，不补零**；金额的币种单位文档未给出（对比 A 股财务页明写"原币元"），按原值转述。',
      path: '/api/fund/financials/income-statements',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 510300.SH）' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundIncomeFields) }),
      allowed: ['thscode'],
      normalize: onlyFundCode,
      guard: { item: fundIncomeFields },
    },
    {
      name: 'get_fund_financials_balance_sheets',
      capability: 'fund_balance',
      summary: '基金资产负债表（按报告期）',
      description: '获取基金定期报告的资产负债表序列。thscode 必填带后缀。item[] 含三个日期字段与资产/负债/权益类字段：total_assets、bank_deposit、fund_investment、stock_investment、bond_investment、transactional_financial_assets、other_assets、total_liability、other_liability、owner_total_equity、undistributed_profit、liability_and_owner_equity。未披露字段为 null；金额单位文档未给出，按原值转述。',
      path: '/api/fund/financials/balance-sheets',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 510300.SH）' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundBalanceFields) }),
      allowed: ['thscode'],
      normalize: onlyFundCode,
      guard: { item: fundBalanceFields },
    },
    {
      name: 'get_fund_financials_indicators',
      capability: 'fund_financial_indicators',
      summary: '基金财务指标（净值/利润/增长率）',
      description: '获取基金定期报告的财务指标序列。thscode 必填带后缀。item[] 含三个日期字段与指标：distribution_profit（本期已实现收益）、current_profit（本期利润）、current_income、distribution_share_profit（每份可分配利润）、average_nav_profit_margin（平均净值利润率）、average_share_current_profit（平均每份本期利润）、share_nav（单位净值）、sum_share_nav（累计单位净值）、asset_nav（基金资产净值）、sum_nav_rate / nav_rate（累计/净值增长率）。这些字段**文档未标注是百分数还是小数形式**（只有基金级总则），引用增长率与净值时按原值转述并注明口径。',
      path: '/api/fund/financials/indicators',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 510300.SH）' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundFinancialIndicatorFields) }),
      allowed: ['thscode'],
      normalize: onlyFundCode,
      guard: { item: fundFinancialIndicatorFields },
    },
    {
      name: 'get_fund_indicators_line',
      capability: 'fund_indicator_line',
      summary: '基金指标画线序列（多指标多标的）',
      description: '按指标分组批量取画线序列。两个参数都是 **JSON 字符串**且都必填：indexes 为**数组**，每组必须含完整代码数组 thscodes 与指标数组 index_info（每项必含字符串 index_id，可选 attribute）；time_range 为**对象**，必含字符串 time_type，可选 start / end（Unix 毫秒整数）与 offset（整数周期偏移）。响应是三层的：time_range 为毫秒时间轴数组（元素可为 null、与每组 values 按位置对应）、indexes 为指标元信息（index_id / value_type / timestamp / time_type / attribute，其中 timestamp 为正数时是毫秒戳、0 与负数是位置选择）、data[] 为按代码组织的序列（thscode + values[]，每项含 idx 指向 indexes 下标与 values 数组）。',
      path: '/api/fund/indicators/line',
      inputSchema: objectSchema({
        indexes: { type: 'string', description: 'JSON 数组字符串：[{thscodes:[完整代码], index_info:[{index_id, attribute?}]}]' },
        time_range: { type: 'string', description: 'JSON 对象字符串：{time_type, start?, end?, offset?}（start/end 为 Unix 毫秒整数）' },
      }, ['indexes', 'time_range']),
      outputSchema: {
        type: 'object',
        properties: {
          time_range: { type: 'array', items: { oneOf: [{ type: 'integer' }, { type: 'null' }] } },
          indexes: { type: 'array', items: { type: 'object', additionalProperties: true } },
          data: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
        additionalProperties: true,
      },
      allowed: ['indexes', 'time_range'],
      normalize: normalizeFundIndicatorLine,
      guard: { custom: validateIndicatorLine },
    },
    {
      name: 'get_fund_indicators_table',
      capability: 'fund_indicator_table',
      summary: '基金指标表格查询（分页/排序）',
      description: '按选择器查询指标表格。四个参数都是 **JSON 字符串且全部可选**：code_selectors（对象；stock_code / fund_code 类型用 thscodes 数组，其它实体类型用 values）、indexes（数组，每项必含 index_id，可选 timestamp：正数=Unix 毫秒、0=最新位置、负数=位置偏移）、page_info（对象，page_begin / page_size / code_begin / code_page_size 均可选整数，**起点为 0**）、sort（数组，每项含整数 idx 指标下标与字符串 type 排序方向）。**该端点没有业务默认值，四个参数至少要给一个**。⚠️ 实测（2026-09）本端点对多只基金均返回 code=5003 数据源不可用（参数本身被接受、不是参数错误），属上游数据源缺口；接入时按 5003 如实回传，不要反复重试。响应含 total（上游结果总数）、indexes（与画线接口语义一致）、data[]（thscode + values[]，每项含 idx 与 value——value 可为 null，数值字符串保持原样如 "3.127400"）与可空的 part_order_thscodes。',
      path: '/api/fund/indicators/table',
      inputSchema: objectSchema({
        code_selectors: { type: 'string', description: 'JSON 对象字符串：选择器（如 {fund_code:{thscodes:[...]}}）' },
        indexes: { type: 'string', description: 'JSON 数组字符串：[{index_id, timestamp?}]' },
        page_info: { type: 'string', description: 'JSON 对象字符串：{page_begin?, page_size?, code_begin?, code_page_size?}（起点 0）' },
        sort: { type: 'string', description: 'JSON 数组字符串：[{idx, type}]' },
      }),
      outputSchema: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          indexes: { type: 'array', items: { type: 'object', additionalProperties: true } },
          data: { type: 'array', items: { type: 'object', additionalProperties: true } },
          part_order_thscodes: { oneOf: [{ type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'null' }] } }, { type: 'null' }] },
        },
        additionalProperties: true,
      },
      allowed: ['code_selectors', 'indexes', 'page_info', 'sort'],
      normalize: normalizeFundIndicatorTable,
      guard: { custom: validateIndicatorTable },
      paginated: true,
    },
    {
      name: 'get_fund_corporate_actions_dividends',
      capability: 'fund_dividends',
      summary: '基金分红记录（每 10 份口径）',
      description: '获取基金的历史分红记录。thscode 必填带后缀。data 顶层除 item 外还有两个元数据字段：dividend_count（分红记录总数）与 dividend_total（服务端返回的**累计分红汇总值，不要与每 10 份现金分红混用**）。item[] 含 per_ten_cash_before_tax / per_ten_cash_after_tax（**每 10 份**税前/税后现金分红）、progress（进度）、以及六个日期毫秒戳：publish_date_ms、registration_date_ms、ex_dividend_date_ms、payment_date_ms、reinvestment_date_ms、profit_base_date_ms、in_dividend_date_ms。',
      path: '/api/fund/corporate-actions/dividends',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 510300.SH）' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundDividendFields) }),
      allowed: ['thscode'],
      normalize: onlyFundCode,
      guard: { data: { dividend_count: 'number?', dividend_total: 'number?' }, item: fundDividendFields },
    },
    {
      name: 'get_fund_offerings_list',
      capability: 'fund_offerings',
      summary: '基金募集列表（当前/即将募集）',
      description: '获取正在或即将募集的基金列表。subscribe 必填，只接受 active（当前募集）或 upcoming（即将募集）。item[] 含 thscode、ticker 与 subscription_start_ms / subscription_end_ms（募集起止毫秒时间戳）。',
      path: '/api/fund/offerings/list',
      inputSchema: objectSchema({
        subscribe: { type: 'string', enum: OFFERING_SUBSCRIBE, description: 'active 当前募集 / upcoming 即将募集' },
      }, ['subscribe']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundOfferingFields) }),
      allowed: ['subscribe'],
      normalize: (params: Params): Params => ({ subscribe: requiredEnum(params.subscribe, 'subscribe', OFFERING_SUBSCRIBE, lowerCase) }),
      guard: { item: fundOfferingFields },
    },
    {
      name: 'get_fund_quota_list',
      capability: 'fund_quota_list',
      summary: 'QDII 额度分类与基金明细（三层嵌套）',
      description: '获取 QDII 额度分类下的基金明细。tab 必填，是 **URL 编码的 JSON 数组字符串**（分类值由上游判定，未知分类按正常空结果返回）；buy 可选布尔（可购状态过滤，省略时不向上游注入默认值）。响应是**三层嵌套且没有 item 信封**：data[] 为分类（name + sub_tab[]），sub_tab[] 为子分类（name + fund_list[]），fund_list[] 为基金（thscode、fund_name、quota、year）。quota 为 null 表示**无限额**；year 是上游提供的近一年收益率**字符串，不作单位换算**；分类/子分类/基金列表中的合法 null 占位保持原义。',
      path: '/api/fund/quota/list',
      inputSchema: objectSchema({
        tab: { type: 'string', description: 'JSON 数组字符串，例如 ["remen"]；分类值由上游判定' },
        buy: { type: 'boolean', description: '可购状态过滤，可选；省略不注入默认值' },
      }, ['tab']),
      outputSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            sub_tab: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  fund_list: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: { thscode: { type: 'string' }, fund_name: { type: 'string' }, quota: { oneOf: [{ type: 'string' }, { type: 'null' }] }, year: { oneOf: [{ type: 'string' }, { type: 'null' }] } },
                      additionalProperties: true,
                    },
                  },
                },
                additionalProperties: true,
              },
            },
          },
          additionalProperties: true,
        },
      },
      allowed: ['tab', 'buy'],
      normalize: normalizeFundQuotaList,
      guard: { custom: validateQuotaList },
    },
    {
      name: 'get_fund_quota_summary',
      capability: 'fund_quota_summary',
      summary: 'QDII 额度分类汇总',
      description: '获取 QDII 额度按分类的汇总。tab 必填，是 **URL 编码的 JSON 数组字符串**（示例 ["nazhi100"]）。响应是**扁平数组 data[]**（没有 item 信封）：每项含 name（分类名称）、unlimited（无额度限制的基金数）、total_limit（限额合计）、total（基金总数）、buy（可购基金数）——**这五个字段全部以字符串原样返回，不做单位转换**。',
      path: '/api/fund/quota/summary',
      inputSchema: objectSchema({
        tab: { type: 'string', description: 'JSON 数组字符串，例如 ["nazhi100"]' },
      }, ['tab']),
      outputSchema: { type: 'array', items: rowSchema(fundQuotaSummaryFields) },
      allowed: ['tab'],
      normalize: (params: Params): Params => ({ tab: jsonParam(params.tab, 'tab', 'array') }),
      guard: { dataArray: fundQuotaSummaryFields },
    },
    {
      name: 'get_fund_diagnostics_detail',
      capability: 'fund_diagnostics',
      summary: '基金诊断（多维画像与同类对比）',
      description: '获取单只基金的诊断画像。thscode 必填带后缀。item[] 含 thscode / ticker / fund_type / peer_code（同类比较分组代码，如 ETF-INDEX）与六个**保留上游结构**的对象字段：dimensions、peer_dimensions、probabilities、ranges、resilience、peer_resilience（官方示例中均为空对象，内部键名文档未给出）。因此这些对象按原样转述，不要假设固定内部键名。',
      path: '/api/fund/diagnostics/detail',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 510300.SH）' },
      }, ['thscode']),
      outputSchema: envelopeData({ type: 'array', items: rowSchema(fundDiagnosticsFields) }),
      allowed: ['thscode'],
      normalize: onlyFundCode,
      guard: { item: fundDiagnosticsFields },
    },
    {
      name: 'get_fund_backtest_result',
      capability: 'fund_backtest',
      summary: '基金在线回测（策略/基准/曲线）',
      description: '对单只基金执行在线回测。六个参数全部必填：thscode（带后缀）；buy_conditions 与 sell_conditions 为 **JSON 字符串且必须是对象或数组**；buy_frequency_type 为买入频率（**具体取值由上游判定，无公开枚举**，示例 WEEKLY）；max_buy_times 为最大买入次数（整数 >= 1）；per_buy_amount 为每次买入金额。响应含 start_date / end_date（**yyyy-MM-dd 字符串，不是毫秒**）、metrics（strategy_return / fund_return / excess_return / win_rate / max_drawdown）、trade_count、trades[]（trade_date、type、price、amount、shares、profit——profit 可为 null）与 curve_points（**兼容数组或对象结构**）。**口径警告**：回测 metrics 的单位文档自相矛盾（总览称百分数原值，回测页称"不进行单位换算"，示例值形如小数 0.4224），引用时必须按原值转述并注明口径未确认，不要自行 ×100。',
      path: '/api/fund/backtest/result',
      inputSchema: objectSchema({
        thscode: { type: 'string', description: '完整基金代码（如 000001.OF）' },
        buy_conditions: { type: 'string', description: 'JSON 字符串（对象或数组），如 {"indicator_code":"rsi_pct","operator":">","value":0.5}' },
        sell_conditions: { type: 'string', description: 'JSON 字符串（对象或数组）' },
        buy_frequency_type: { type: 'string', description: '买入频率，取值由上游判定（示例 WEEKLY）' },
        max_buy_times: { type: 'integer', minimum: 1, description: '最大买入次数' },
        per_buy_amount: { type: 'number', minimum: 0, description: '每次买入金额' },
      }, ['thscode', 'buy_conditions', 'sell_conditions', 'buy_frequency_type', 'max_buy_times', 'per_buy_amount']),
      outputSchema: {
        type: 'object',
        properties: {
          start_date: { type: 'string' },
          end_date: { type: 'string' },
          metrics: { type: 'object', additionalProperties: true },
          trade_count: { type: 'number' },
          trades: { type: 'array', items: { type: 'object', additionalProperties: true } },
          curve_points: {},
        },
        additionalProperties: true,
      },
      allowed: ['thscode', 'buy_conditions', 'sell_conditions', 'buy_frequency_type', 'max_buy_times', 'per_buy_amount'],
      normalize: normalizeFundBacktest,
      guard: { data: { start_date: 'text', end_date: 'text', metrics: 'object', trade_count: 'number?', trades: 'array' } },
    },
    {
      name: 'get_fund_backtest_indicators',
      capability: 'fund_backtest_indicators',
      summary: '回测可用指标清单（无参数）',
      description: '获取回测支持的指标清单，无业务参数（仅凭据）。响应是**扁平数组 data[]**（没有 item 信封）：每项含 id、indicator_name、indicator_code（如 rsi_pct）、type 与 value_kind（上游定义）、support_operation（支持的运算符，如 ">,<"）、unit / description / state_rules（均可为 null）与 create_time / update_time（**ISO 本地日期时间字符串**，如 2026-05-27T16:57:32，不是毫秒时间戳）。用 buy_conditions 前应先查这里的 indicator_code 与 support_operation。',
      path: '/api/fund/backtest/indicators',
      inputSchema: objectSchema({}),
      outputSchema: { type: 'array', items: rowSchema(fundBacktestIndicatorFields) },
      allowed: [],
      normalize: () => ({}),
      guard: { dataArray: fundBacktestIndicatorFields },
    },
  ]
}

function createSource(definition: EndpointDefinition, baseUrl: string, resolveApiKey: FuyaoApiKeyResolver): DataSource {
  const { name, capability, summary, description, path, inputSchema, outputSchema, allowed } = definition
  const schema: SchemaDescriptor = {
    capability,
    name,
    source: 'api:fuyao',
    // 内部数据源身份证（provider.kind.resource）：宿主路由/审计用，不进入模型协议。
    data_key: buildDataKey('fuyao', 'api', path),
    source_label: 'fuyao',
    paginated: definition.paginated === true,
    summary,
    description,
    input_schema: inputSchema,
    output_schema: outputSchema,
  }
  /** 幂等：Hub 入队前调用一次（digest 口径），execute 再调用一次（直连调用也要生效）。 */
  const normalize = (params: unknown): Params => {
    const values = paramsObject(params)
    assertKnownParameters(values, allowed)
    return definition.normalize(values)
  }
  return {
    schema,
    normalizeParams: normalize,
    validateOutput: buildGuard(definition.guard),
    execute: async (request: DataRequest, signal: AbortSignal) => {
      const params = normalize(request.params)
      const apiKey = await resolveApiKey()
      if (!apiKey) throw new Error(`FUYAO_API_KEY is not configured; data source ${name} is unavailable`)
      return callFuyao(baseUrl, apiKey, path, queryParams(params, allowed), signal, outputSchema)
    },
  }
}

export function createFuyaoRestSources(resolveApiKey: FuyaoApiKeyResolver, baseUrl = DEFAULT_BASE_URL): DataSource[] {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '')
  return endpointDefinitions().map((definition) => createSource(definition, cleanBaseUrl, resolveApiKey))
}

export async function resolveFuyaoApiKey(ctx: Context): Promise<string | undefined> {
  const credentials = ctx.get('credentials') as CredentialLike | undefined
  if (credentials) {
    for (const ref of ['FUYAO_API_KEY']) {
      const resolved = await credentials.resolve(ref)
      if (resolved?.value) return resolved.value
    }
  }
  const processLike = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return processLike?.env?.FUYAO_API_KEY
}

export { MAX_HISTORY_WINDOW_MS, MAX_BATCH_CODES }
