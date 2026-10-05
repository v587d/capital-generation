import type { DataRequest, DataSource, SchemaDescriptor } from '../data-collector/hub.js'
import { buildDataKey } from '../data-collector/hub.js'
import { getDataTimeContract } from '../time/tools.js'
import { sharedEastmoneyClient, EastmoneyTransportError } from '../net/eastmoney-client.js'
import { normalizeEastmoneyAshareIdentity, normalizeEastmoneyBoardIdentity, normalizeEastmoneySecurityIdentity, type EastmoneyBoardIdentity } from './security-identity.js'

type Params = Record<string, unknown>
type JsonRecord = Record<string, unknown>

const DATACENTER_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get'
const CLIST_URL = 'https://push2.eastmoney.com/api/qt/clist/get'
const MAX_PAGE_SIZE = 500
const EASTMONEY_UT = 'bd1d9ddb04089700cf9c27f6f7426281'
const BOARD_TYPES = ['industry', 'concept', 'region'] as const
type BoardType = typeof BOARD_TYPES[number]
const BOARD_FS: Record<BoardType, string> = { industry: 'm:90+t:2', concept: 'm:90+t:3', region: 'm:90+t:1' }
const SORT_FIELDS: Record<string, string> = { change_pct: 'f3', main_net_inflow: 'f62', amount: 'f6' }

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
}

const datacenterOutput = (row: object) => ({
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
})

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
}

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
}

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
}

function isRecord(value: unknown): value is JsonRecord { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function assertKnown(params: Params, allowed: string[]): void { for (const key of Object.keys(params)) if (!allowed.includes(key)) throw new Error(`unsupported parameter: ${key}`) }
function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).replaceAll(',', '').trim())
  return Number.isFinite(parsed) ? parsed : null
}
function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`)
  return value
}
function date(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${name} must be a valid YYYY-MM-DD date`)
  return value
}
function dateMs(value: string): number { return Date.parse(`${value}T00:00:00+08:00`) }
function textOrNull(value: unknown): string | null { return value === undefined || value === null || value === '' ? null : String(value) }
function sourceError(message: string, code = 'eastmoney_source_error'): Error { const error = new Error(message); (error as Error & { code?: string }).code = code; return error }

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
async function getJson(url: string, signal: AbortSignal, context: string): Promise<JsonRecord> {
  let payload: unknown
  try {
    payload = await sharedEastmoneyClient().fetchJson(url, { signal })
  } catch (error) {
    // 调用方取消原样抛出；上游 HTTP 错误状态按既有口径归类。
    if (error instanceof Error && error.name === 'AbortError') throw error
    const status = error instanceof EastmoneyTransportError ? error.status : undefined
    throw sourceError(
      status === undefined
        ? `Eastmoney request failed for ${context}: ${error instanceof Error ? error.message : String(error)}`
        : `Eastmoney HTTP ${status} for ${context}`,
      status === 429 ? 'eastmoney_rate_limit' : 'eastmoney_http_error',
    )
  }
  if (!isRecord(payload)) throw sourceError(`Eastmoney ${context} returned a non-object response`, 'eastmoney_invalid_response')
  return payload
}

function requireDatacenterResult(payload: JsonRecord, context: string): JsonRecord {
  // 上游用 code 9201 表示"返回数据为空"（success:false），这是**真实数据缺口**而非上游故障：
  // 节假日、或该窗口确实没有任何记录。归类成 eastmoney_upstream_error 会诱导模型反复重试
  // （§10.4 明令"数据缺口不要重试"），也与单票路径把 9201 判成"无记录"自相矛盾。
  if (payload.success !== true && Number(payload.code) === 9201) return { data: [], pages: 0, count: 0 }
  if (payload.success !== true || Number(payload.code) !== 0 || !isRecord(payload.result)) throw sourceError(`Eastmoney ${context} failed: ${String(payload.message ?? 'unknown upstream error')} (code ${String(payload.code ?? 'unknown')})`, 'eastmoney_upstream_error')
  return payload.result
}
function requireRows(result: JsonRecord, context: string): { rows: JsonRecord[]; pages: number; total: number } {
  if (!Array.isArray(result.data) || typeof result.pages !== 'number' || typeof result.count !== 'number') throw sourceError(`Eastmoney ${context} result shape changed`, 'eastmoney_invalid_response')
  if (!result.data.every(isRecord)) throw sourceError(`Eastmoney ${context} contains a non-object row`, 'eastmoney_invalid_response')
  return { rows: result.data, pages: result.pages, total: result.count }
}
function pagination(page: number, size: number, pages: number, total: number): object { return { page, size, pages, total } }

async function eastmoneyTickerExists(ticker: string, signal: AbortSignal): Promise<boolean> {
  const identity = normalizeEastmoneySecurityIdentity({ secucode: ticker })
  const marketId = identity.eastmoney_market === 'SH' ? '1' : '0'
  const url = new URL('https://push2.eastmoney.com/api/qt/stock/get')
  url.searchParams.set('secid', `${marketId}.${identity.ticker}`)
  url.searchParams.set('fields', 'f57,f58,f107')
  const payload = await getJson(url.toString(), signal, 'ticker metadata')
  return Number(payload.rc) === 0 && isRecord(payload.data)
    && String(payload.data.f57 ?? '') === identity.ticker
    && typeof payload.data.f58 === 'string'
    && String(payload.data.f58).trim().length > 0
}

function normalizeDateRange(params: Params, allowed: string[]): Params {
  assertKnown(params, allowed)
  const start_date = date(params.start_date, 'start_date')
  const end_date = date(params.end_date, 'end_date')
  if (start_date > end_date) throw new Error('start_date must not be later than end_date')
  const page = params.page === undefined ? 1 : integer(params.page, 'page', 1, Number.MAX_SAFE_INTEGER)
  const size = params.size === undefined ? 100 : integer(params.size, 'size', 1, MAX_PAGE_SIZE)
  return { start_date, end_date, page, size }
}
function normalizeTicker(params: Params): Params {
  assertKnown(params, ['start_date', 'end_date', 'ticker', 'page', 'size'])
  const normalized = normalizeDateRange(params, ['start_date', 'end_date', 'page', 'size', 'ticker'])
  const identity = normalizeEastmoneySecurityIdentity({ secucode: params.ticker })
  return { ...normalized, ticker: identity.thscode }
}
function normalizeBoard(params: Params): Params {
  assertKnown(params, ['board_type', 'sort_field', 'page', 'size'])
  const board_type = params.board_type === undefined ? 'industry' : String(params.board_type).toLowerCase()
  if (!BOARD_TYPES.includes(board_type as BoardType)) throw new Error(`board_type must be one of ${BOARD_TYPES.join(', ')}`)
  const sort_field = params.sort_field === undefined ? 'change_pct' : String(params.sort_field).toLowerCase()
  if (!(sort_field in SORT_FIELDS)) throw new Error(`sort_field must be one of ${Object.keys(SORT_FIELDS).join(', ')}`)
  const page = params.page === undefined ? 1 : integer(params.page, 'page', 1, Number.MAX_SAFE_INTEGER)
  const size = params.size === undefined ? 100 : integer(params.size, 'size', 1, MAX_PAGE_SIZE)
  return { board_type, sort_field, page, size }
}

function normalizeCashflowBoard(params: Params): Params {
  assertKnown(params, ['board_type', 'page', 'size'])
  const board_type = params.board_type === undefined ? 'industry' : String(params.board_type).toLowerCase()
  if (!BOARD_TYPES.includes(board_type as BoardType)) throw new Error(`board_type must be one of ${BOARD_TYPES.join(', ')}`)
  const page = params.page === undefined ? 1 : integer(params.page, 'page', 1, Number.MAX_SAFE_INTEGER)
  const size = params.size === undefined ? 100 : integer(params.size, 'size', 1, MAX_PAGE_SIZE)
  return { board_type, page, size }
}

function topFilter(params: Params, ticker?: string): string {
  const base = `(TRADE_DATE<='${params.end_date}')(TRADE_DATE>='${params.start_date}')`
  const code = ticker?.replace(/\.(SH|SZ|BJ)$/i, '')
  return code ? `${base}(SECURITY_CODE="${code}")` : base
}
function parseTopRow(raw: JsonRecord): JsonRecord {
  // ⚠️ 上游 `MARKET` 是自由文本（实测存在 `SZ` 之外的写法），而 SECUCODE 自带市场后缀时
  // 它是冗余信息：只有 SECUCODE 不带市场时才拿它做必填校验，否则原文喂进硬白名单会把
  // 整页龙虎榜判成错误（护栏误杀真实数据，§10.2）。行里的 `market` 字段仍原样保留。
  const secucode = typeof raw.SECUCODE === 'string' ? raw.SECUCODE : ''
  const identity = secucode.includes('.')
    ? normalizeEastmoneySecurityIdentity({ secucode })
    : normalizeEastmoneySecurityIdentity({ secucode: raw.SECUCODE, security_code: raw.SECURITY_CODE, market: raw.MARKET })
  const tradeDate = String(raw.TRADE_DATE ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw sourceError('Eastmoney billboard row has invalid TRADE_DATE', 'eastmoney_invalid_response')
  return {
    ...identity,
    name: String(raw.SECURITY_NAME_ABBR ?? ''), market: String(raw.MARKET ?? identity.eastmoney_market), trade_date: tradeDate, trade_date_ms: dateMs(tradeDate),
    close_price: numberOrNull(raw.CLOSE_PRICE), change_pct: numberOrNull(raw.CHANGE_RATE), turnover_rate_pct: numberOrNull(raw.TURNOVERRATE),
    billboard_buy_amt: numberOrNull(raw.BILLBOARD_BUY_AMT), billboard_sell_amt: numberOrNull(raw.BILLBOARD_SELL_AMT), billboard_net_amt: numberOrNull(raw.BILLBOARD_NET_AMT), billboard_deal_amt: numberOrNull(raw.BILLBOARD_DEAL_AMT),
    deal_amount_ratio_pct: numberOrNull(raw.DEAL_AMOUNT_RATIO), deal_net_ratio_pct: numberOrNull(raw.DEAL_NET_RATIO), market_deal_amt: numberOrNull(raw.ACCUM_AMOUNT), free_market_cap: numberOrNull(raw.FREE_MARKET_CAP),
    explanation: textOrNull(raw.EXPLANATION), explain: textOrNull(raw.EXPLAIN), trade_market: textOrNull(raw.TRADE_MARKET), trade_id: numberOrNull(raw.TRADE_ID),
  }
}
async function executeBillboard(params: Params, signal: AbortSignal, ticker?: string): Promise<{ data: unknown; schema: object }> {
  const url = new URL(DATACENTER_URL)
  url.searchParams.set('reportName', 'RPT_DAILYBILLBOARD_DETAILS'); url.searchParams.set('columns', 'ALL'); url.searchParams.set('source', 'WEB'); url.searchParams.set('client', 'WEB')
  url.searchParams.set('sortColumns', 'TRADE_DATE,SECURITY_CODE'); url.searchParams.set('sortTypes', '-1,1'); url.searchParams.set('pageNumber', String(params.page)); url.searchParams.set('pageSize', String(params.size)); url.searchParams.set('filter', topFilter(params, ticker))
  const payload = await getJson(url.toString(), signal, 'daily billboard')
  if (ticker && payload.success !== true && Number(payload.code) === 9201) {
    const exists = await eastmoneyTickerExists(ticker, signal)
    if (!exists) throw sourceError(`Eastmoney ticker ${ticker} is not a recognized security`, 'eastmoney_invalid_ticker')
    throw sourceError(`Eastmoney ticker ${ticker} has no billboard records from ${params.start_date} to ${params.end_date}`, 'eastmoney_no_billboard_data')
  }
  const result = requireDatacenterResult(payload, 'daily billboard')
  const parsed = requireRows(result, 'daily billboard')
  const item = parsed.rows.map(parseTopRow)
  return { data: { item, pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(topBuySellRow) }
}

function parseLockupRow(raw: JsonRecord): JsonRecord {
  const identity = normalizeEastmoneyAshareIdentity(raw.SECURITY_CODE)
  const freeDate = String(raw.FREE_DATE ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(freeDate)) throw sourceError('Eastmoney lockup row has invalid FREE_DATE', 'eastmoney_invalid_response')
  return {
    ...identity, name: String(raw.SECURITY_NAME_ABBR ?? ''), free_date: freeDate, free_date_ms: dateMs(freeDate), free_shares_type: textOrNull(raw.FREE_SHARES_TYPE),
    free_shares_raw: numberOrNull(raw.FREE_SHARES), total_ratio: numberOrNull(raw.TOTAL_RATIO), non_free_shares_raw: numberOrNull(raw.NON_FREE_SHARES), able_free_shares_raw: numberOrNull(raw.ABLE_FREE_SHARES),
  }
}
async function executeLockup(params: Params, signal: AbortSignal): Promise<{ data: unknown; schema: object }> {
  const url = new URL(DATACENTER_URL)
  url.searchParams.set('reportName', 'RPT_LIFT_STAGE'); url.searchParams.set('columns', 'SECURITY_CODE,SECURITY_NAME_ABBR,FREE_DATE,FREE_SHARES_TYPE,FREE_SHARES,TOTAL_RATIO,NON_FREE_SHARES,ABLE_FREE_SHARES'); url.searchParams.set('source', 'WEB'); url.searchParams.set('client', 'WEB')
  url.searchParams.set('sortColumns', 'FREE_DATE'); url.searchParams.set('sortTypes', '1'); url.searchParams.set('pageNumber', String(params.page)); url.searchParams.set('pageSize', String(params.size)); url.searchParams.set('filter', `(FREE_DATE>='${params.start_date}')(FREE_DATE<='${params.end_date}')`)
  const result = requireDatacenterResult(await getJson(url.toString(), signal, 'lockup calendar'), 'lockup calendar')
  const parsed = requireRows(result, 'lockup calendar')
  return { data: { item: parsed.rows.map(parseLockupRow), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(lockupRow) }
}

function boardParams(params: Params, cashflow: boolean): URL {
  const url = new URL(CLIST_URL)
  url.searchParams.set('pn', String(params.page)); url.searchParams.set('pz', String(params.size)); url.searchParams.set('po', '1'); url.searchParams.set('np', '1'); url.searchParams.set('ut', EASTMONEY_UT); url.searchParams.set('fltt', '2'); url.searchParams.set('invt', '2');
  url.searchParams.set('fid', cashflow ? 'f62' : SORT_FIELDS[String(params.sort_field)])
  url.searchParams.set('fs', BOARD_FS[String(params.board_type) as BoardType])
  url.searchParams.set('fields', cashflow ? 'f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f124' : 'f12,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f124')
  return url
}
function requireCList(payload: JsonRecord, context: string): JsonRecord {
  if (Number(payload.rc) !== 0 || !isRecord(payload.data)) throw sourceError(`Eastmoney ${context} failed: ${String(payload.msg ?? 'unknown upstream error')}`, 'eastmoney_upstream_error')
  return payload.data
}
function parseBoardRow(raw: JsonRecord, boardType: BoardType, cashflow: boolean): JsonRecord {
  const identity: EastmoneyBoardIdentity = normalizeEastmoneyBoardIdentity(raw.f12, raw.f14, boardType)
  const row: JsonRecord = {
    ...identity, last_price: numberOrNull(raw.f2), change_pct: numberOrNull(raw.f3), change_amount: numberOrNull(raw.f4), volume: numberOrNull(raw.f5), amount: numberOrNull(raw.f6), amplitude_pct: numberOrNull(raw.f7), turnover_pct: numberOrNull(raw.f8), pe: numberOrNull(raw.f9), pb: numberOrNull(raw.f10), eastmoney_server_time: numberOrNull(raw.f124),
  }
  if (cashflow) Object.assign(row, {
    main_net_inflow: numberOrNull(raw.f62), main_net_inflow_pct: numberOrNull(raw.f184), super_large_net_inflow: numberOrNull(raw.f66), super_large_net_inflow_pct: numberOrNull(raw.f69), large_net_inflow: numberOrNull(raw.f72), large_net_inflow_pct: numberOrNull(raw.f75), medium_net_inflow: numberOrNull(raw.f78), medium_net_inflow_pct: numberOrNull(raw.f81), small_net_inflow: numberOrNull(raw.f84), small_net_inflow_pct: numberOrNull(raw.f87),
  })
  return row
}
async function executeBoard(params: Params, signal: AbortSignal, cashflow: boolean): Promise<{ data: unknown; schema: object }> {
  const boardType = String(params.board_type) as BoardType
  const payload = await getJson(boardParams(params, cashflow).toString(), signal, cashflow ? 'sector cashflow' : 'sector rotation')
  const data = requireCList(payload, cashflow ? 'sector cashflow' : 'sector rotation')
  if (!Array.isArray(data.diff) || typeof data.total !== 'number' || !data.diff.every(isRecord)) throw sourceError('Eastmoney board result shape changed', 'eastmoney_invalid_response')
  const row = cashflow ? cashflowRow : sectorRow
  return { data: { item: data.diff.map((raw) => parseBoardRow(raw, boardType, cashflow)), pagination: pagination(Number(params.page), Number(params.size), Math.ceil(data.total / Number(params.size)), data.total) }, schema: { type: 'object', properties: { item: { type: 'array', items: row }, pagination: { type: 'object', additionalProperties: true } }, required: ['item', 'pagination'], additionalProperties: true } }
}

/**
 * 宏观指标表：一行 = 一个报告期。`MacroTable` 里的 `numbers` / `texts` / `dates` 就是
 * **显式键名映射表**（上游大写缩写 → 行键 snake_case，`docs/dev/tool-schema.md` §10.6）：没列出来的上游键
 * 一律丢弃。透传 `EXIT_BASE` 这类缩写还能读，透传中文名或全半角混排的键名就会让
 * `query_dataset` 的字符串列名匹配到零行——那是静默空结果，不是错误。
 *
 * 字段口径来自 2026-10-05 的真报文核验（每表 200 行：无缺键；社零有 15/200 行
 * `RETAIL_TOTAL` 为 null、存准率 30/58 行 `REMARK` 为 null），所以**数值与文本一律按可空声明**，
 * null 原样保留、不补 0。
 */
interface MacroTable {
  capability: string
  name: string
  context: string
  reportName: string
  summary: string
  description: string
  /** 报告期键 → 行键；`datetime` 是 `2026-08-01 00:00:00`，`chinese` 是 `2025年05月07日`。 */
  dates: Array<{ from: string; to: string; format: 'datetime' | 'chinese' }>
  /** 东财原文期间标签（`2026年08月份`），原样存成 `period_label` 供回传引用。 */
  labelFrom?: string
  numbers: Array<{ from: string; to: string }>
  texts?: Array<{ from: string; to: string }>
}

function macroDate(value: unknown, format: 'datetime' | 'chinese', context: string): string {
  if (format === 'chinese') {
    const match = String(value ?? '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
    if (!match) throw sourceError(`Eastmoney ${context} row has an unparseable Chinese date`, 'eastmoney_invalid_response')
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  }
  const text = String(value ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw sourceError(`Eastmoney ${context} row has invalid ${context} date`, 'eastmoney_invalid_response')
  return text
}

const macroRow = (table: MacroTable) => {
  const properties: Record<string, object> = {}
  const nullableNumber = { oneOf: [{ type: 'number' }, { type: 'null' }] }
  for (const date of table.dates) {
    properties[date.to] = { type: 'string' }
    properties[`${date.to}_ms`] = { type: 'integer' }
  }
  if (table.labelFrom) properties.period_label = { oneOf: [{ type: 'string' }, { type: 'null' }] }
  for (const column of table.numbers) properties[column.to] = nullableNumber
  for (const column of table.texts ?? []) properties[column.to] = { oneOf: [{ type: 'string' }, { type: 'null' }] }
  return { type: 'object', properties, additionalProperties: true }
}

function parseMacroRow(table: MacroTable, raw: JsonRecord): JsonRecord {
  const row: JsonRecord = {}
  for (const date of table.dates) {
    const text = macroDate(raw[date.from], date.format, table.context)
    row[date.to] = text
    row[`${date.to}_ms`] = dateMs(text)
  }
  if (table.labelFrom) row.period_label = textOrNull(raw[table.labelFrom])
  for (const column of table.numbers) row[column.to] = numberOrNull(raw[column.from])
  for (const column of table.texts ?? []) row[column.to] = textOrNull(raw[column.from])
  return row
}

async function executeMacro(table: MacroTable, params: Params, signal: AbortSignal): Promise<{ data: unknown; schema: object }> {
  const url = new URL(DATACENTER_URL)
  url.searchParams.set('reportName', table.reportName)
  url.searchParams.set('columns', 'ALL')
  url.searchParams.set('source', 'WEB')
  url.searchParams.set('client', 'WEB')
  url.searchParams.set('sortColumns', 'REPORT_DATE')
  url.searchParams.set('sortTypes', '-1')
  url.searchParams.set('pageNumber', String(params.page))
  url.searchParams.set('pageSize', String(params.size))
  url.searchParams.set('filter', `(REPORT_DATE>='${params.start_date}')(REPORT_DATE<='${params.end_date}')`)
  const result = requireDatacenterResult(await getJson(url.toString(), signal, table.context), table.context)
  const parsed = requireRows(result, table.context)
  return { data: { item: parsed.rows.map((raw) => parseMacroRow(table, raw)), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(macroRow(table)) }
}

function createMacroSource(table: MacroTable): DataSource {
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
  })
}

const MACRO_PERCENT_NOTE = '`_yoy_pct` 是同比、`_mom_pct` 是环比，都是百分数原值（0.8 表示 +0.8%，不是 0.8%×100 的小数形式）；`_ms` 后缀是按 Asia/Shanghai 零点换算的毫秒时间戳。'

const MACRO_TABLES: MacroTable[] = [
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
]

/**
 * 沪深港通六个渠道（`docs/dev/tool-schema.md` §10.6：上游给的是 `001`…`006` 这种数字码，
 * 模型侧只认语义名）。渠道身份由上游自己标注的 `MUTUAL_TYPE_NAME` 核对，并用同日的
 * `DEAL_AMT` 加法复核过：`001+003=005`（北向合计）、`002+004=006`（南向合计），实测 2026-09-30
 * 两条等式都精确成立。
 */
const MUTUAL_CHANNELS: Record<string, string> = {
  sh_stock_connect: '001',
  hk_connect_sh: '002',
  sz_stock_connect: '003',
  hk_connect_sz: '004',
  north_total: '005',
  south_total: '006',
}
const MUTUAL_CHANNEL_NAMES = Object.keys(MUTUAL_CHANNELS)

const mutualFlowRow = {
  type: 'object',
  properties: {
    trade_date: { type: 'string' }, trade_date_ms: { type: 'integer' },
    channel: { enum: MUTUAL_CHANNEL_NAMES }, channel_code: { type: 'string' },
    deal_amt_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    buy_amt_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    sell_amt_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    net_deal_amt_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    accum_deal_amt_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    deal_num: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    hold_market_cap_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    quota_balance_text: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    index_close_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    index_change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    lead_thscode: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    lead_stock_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
  additionalProperties: true,
}

function normalizeMutualFlow(params: Params): Params {
  const normalized = normalizeDateRange(params, ['start_date', 'end_date', 'channel', 'page', 'size'])
  const channel = params.channel === undefined ? 'north_total' : String(params.channel)
  if (!(channel in MUTUAL_CHANNELS)) throw new Error(`channel must be one of ${MUTUAL_CHANNEL_NAMES.join(', ')}`)
  return { ...normalized, channel }
}

function parseMutualFlowRow(raw: JsonRecord, channel: string): JsonRecord {
  const tradeDate = String(raw.TRADE_DATE ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw sourceError('Eastmoney mutual flow row has invalid TRADE_DATE', 'eastmoney_invalid_response')
  return {
    trade_date: tradeDate,
    trade_date_ms: dateMs(tradeDate),
    channel,
    channel_code: String(raw.MUTUAL_TYPE ?? MUTUAL_CHANNELS[channel]),
    deal_amt_raw: numberOrNull(raw.DEAL_AMT),
    buy_amt_raw: numberOrNull(raw.BUY_AMT),
    sell_amt_raw: numberOrNull(raw.SELL_AMT),
    net_deal_amt_raw: numberOrNull(raw.NET_DEAL_AMT),
    accum_deal_amt_raw: numberOrNull(raw.ACCUM_DEAL_AMT),
    deal_num: numberOrNull(raw.DEAL_NUM),
    hold_market_cap_raw: numberOrNull(raw.HOLD_MARKET_CAP),
    quota_balance_text: textOrNull(raw.QUOTA_BALANCE_TEXT),
    index_close_price: numberOrNull(raw.INDEX_CLOSE_PRICE),
    index_change_pct: numberOrNull(raw.INDEX_CHANGE_RATE),
    lead_thscode: textOrNull(raw.LEAD_STOCKS_CODE),
    lead_stock_name: textOrNull(raw.LEAD_STOCKS_NAME),
  }
}

async function executeMutualFlow(params: Params, signal: AbortSignal): Promise<{ data: unknown; schema: object }> {
  const url = new URL(DATACENTER_URL)
  url.searchParams.set('reportName', 'RPT_MUTUAL_DEAL_HISTORY')
  url.searchParams.set('columns', 'ALL')
  url.searchParams.set('source', 'WEB')
  url.searchParams.set('client', 'WEB')
  url.searchParams.set('sortColumns', 'TRADE_DATE')
  url.searchParams.set('sortTypes', '-1')
  url.searchParams.set('pageNumber', String(params.page))
  url.searchParams.set('pageSize', String(params.size))
  url.searchParams.set('filter', `(TRADE_DATE>='${params.start_date}')(TRADE_DATE<='${params.end_date}')(MUTUAL_TYPE="${MUTUAL_CHANNELS[String(params.channel)]}")`)
  const result = requireDatacenterResult(await getJson(url.toString(), signal, 'mutual flow'), 'mutual flow')
  const parsed = requireRows(result, 'mutual flow')
  const channel = String(params.channel)
  return { data: { item: parsed.rows.map((raw) => parseMutualFlowRow(raw, channel)), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(mutualFlowRow) }
}

const mutualQuotaRow = {
  type: 'object',
  properties: {
    trade_date: { type: 'string' }, trade_date_ms: { type: 'integer' },
    channel: { enum: MUTUAL_CHANNEL_NAMES }, channel_code: { type: 'string' },
    channel_label: { type: 'string' }, board: { type: 'string' }, direction: { type: 'string' },
    trade_quota_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    closed_reason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    index_code: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    index_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    board_code: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
  additionalProperties: true,
}
/** 上游 `MUTUAL_TYPE_NAME` → 我们的渠道名（额度表只给单渠道，没有合计档）。 */
const MUTUAL_QUOTA_CHANNELS: Record<string, string> = { 沪股通: 'sh_stock_connect', 深股通: 'sz_stock_connect', '港股通(沪)': 'hk_connect_sh', '港股通(深)': 'hk_connect_sz' }
const MUTUAL_QUOTA_CODE_CHANNELS: Record<string, string> = { '001': 'sh_stock_connect', '002': 'hk_connect_sh', '003': 'sz_stock_connect', '004': 'hk_connect_sz' }

function parseMutualQuotaRow(raw: JsonRecord): JsonRecord {
  const tradeDate = String(raw.TRADE_DATE ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw sourceError('Eastmoney mutual quota row has invalid TRADE_DATE', 'eastmoney_invalid_response')
  const code = String(raw.MUTUAL_TYPE ?? '')
  const channel = MUTUAL_QUOTA_CODE_CHANNELS[code] ?? MUTUAL_QUOTA_CHANNELS[String(raw.MUTUAL_TYPE_NAME ?? '')]
  if (!channel) throw sourceError(`Eastmoney mutual quota row has unknown MUTUAL_TYPE ${code || '(blank)'}`, 'eastmoney_invalid_response')
  return {
    trade_date: tradeDate,
    trade_date_ms: dateMs(tradeDate),
    channel,
    channel_code: code,
    channel_label: String(raw.MUTUAL_TYPE_NAME ?? ''),
    board: String(raw.BOARD_TYPE ?? ''),
    direction: raw.FUNDS_DIRECTION === '南向' ? 'south' : raw.FUNDS_DIRECTION === '北向' ? 'north' : String(raw.FUNDS_DIRECTION ?? ''),
    trade_quota_raw: numberOrNull(raw.TRADE_QUOTA),
    closed_reason: textOrNull(raw.CLOSED_REASON),
    index_code: textOrNull(raw.INDEX_CODE),
    index_name: textOrNull(raw.INDEX_NAME),
    board_code: textOrNull(raw.BOARD_CODE),
  }
}

async function executeMutualQuota(params: Params, signal: AbortSignal): Promise<{ data: unknown; schema: object }> {
  const url = new URL(DATACENTER_URL)
  url.searchParams.set('reportName', 'RPT_MUTUAL_QUOTA')
  url.searchParams.set('columns', 'ALL')
  url.searchParams.set('source', 'WEB')
  url.searchParams.set('client', 'WEB')
  url.searchParams.set('sortColumns', 'MUTUAL_TYPE')
  url.searchParams.set('sortTypes', '1')
  url.searchParams.set('pageNumber', '1')
  url.searchParams.set('pageSize', '10')
  const result = requireDatacenterResult(await getJson(url.toString(), signal, 'mutual quota'), 'mutual quota')
  const parsed = requireRows(result, 'mutual quota')
  return { data: { item: parsed.rows.map(parseMutualQuotaRow), pagination: pagination(1, 10, parsed.pages, parsed.total) }, schema: datacenterOutput(mutualQuotaRow) }
}

/**
 * 个股主力资金快照。上游 `RPT_DMSK_TS_STOCKNEW` 实测**只保留最近一个交易日**的全市场一行一股
 * （count=5199、TRADE_DATE 单一；带旧日期过滤器返回 9201 空），所以这不是时序能力：
 * 契约里必须写死"按日期循环取不到历史"，否则模型会拿它当序列反复请求。
 */
const MAIN_CAPITAL_SORTS: Record<string, string> = {
  main_net_inflow: 'PRIME_INFLOW',
  change_pct: 'CHANGE_RATE',
  turnover_rate_pct: 'TURNOVERRATE',
  total_score: 'TOTALSCORE',
}

const mainCapitalRow = {
  type: 'object',
  properties: {
    thscode: { type: 'string' }, ticker: { type: 'string' }, name: { type: 'string' },
    trade_date: { type: 'string' }, trade_date_ms: { type: 'integer' },
    close_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    turnover_rate_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    pe_dynamic: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    main_net_inflow: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    super_large_inflow: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    super_large_outflow: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    large_inflow: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    large_outflow: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    main_cost: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    main_cost_20d: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    main_cost_60d: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    super_large_buy_ratio_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    large_buy_ratio_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    prime_ratio_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    prime_ratio_3d_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    prime_ratio_50d_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    org_participate_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    total_score: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    rank: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    rank_up: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    focus: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    participate_type: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
  additionalProperties: true,
}

function normalizeMainCapital(params: Params): Params {
  assertKnown(params, ['ticker', 'sort_field', 'sort_order', 'page', 'size'])
  const sort_field = params.sort_field === undefined ? 'main_net_inflow' : String(params.sort_field)
  if (!(sort_field in MAIN_CAPITAL_SORTS)) throw new Error(`sort_field must be one of ${Object.keys(MAIN_CAPITAL_SORTS).join(', ')}`)
  const sort_order = params.sort_order === undefined ? 'desc' : String(params.sort_order)
  if (sort_order !== 'desc' && sort_order !== 'asc') throw new Error('sort_order must be desc or asc')
  const page = params.page === undefined ? 1 : integer(params.page, 'page', 1, Number.MAX_SAFE_INTEGER)
  const size = params.size === undefined ? 100 : integer(params.size, 'size', 1, MAX_PAGE_SIZE)
  if (params.ticker === undefined) return { sort_field, sort_order, page, size }
  return { sort_field, sort_order, page, size, thscode: normalizeEastmoneySecurityIdentity({ secucode: params.ticker }).thscode }
}

function parseMainCapitalRow(raw: JsonRecord): JsonRecord {
  const tradeDate = String(raw.TRADE_DATE ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw sourceError('Eastmoney main capital row has invalid TRADE_DATE', 'eastmoney_invalid_response')
  // SECUCODE 自带市场后缀（实测 200/200 行都有），不做"按代码首位猜市场"的兜底：猜错就是把一只
  // 股票的数据挂到另一只上。缺了就说明上游形状变了，响亮失败。
  if (typeof raw.SECUCODE !== 'string' || !raw.SECUCODE.includes('.')) {
    throw sourceError('Eastmoney main capital row lost its market suffix in SECUCODE', 'eastmoney_invalid_response')
  }
  const identity = normalizeEastmoneySecurityIdentity({ secucode: raw.SECUCODE })
  return {
    ...identity,
    name: String(raw.SECURITY_NAME_ABBR ?? ''),
    trade_date: tradeDate,
    trade_date_ms: dateMs(tradeDate),
    close_price: numberOrNull(raw.CLOSE_PRICE),
    change_pct: numberOrNull(raw.CHANGE_RATE),
    turnover_rate_pct: numberOrNull(raw.TURNOVERRATE),
    pe_dynamic: numberOrNull(raw.PE_DYNAMIC),
    main_net_inflow: numberOrNull(raw.PRIME_INFLOW),
    super_large_inflow: numberOrNull(raw.SUPERDEAL_INFLOW),
    super_large_outflow: numberOrNull(raw.SUPERDEAL_OUTFLOW),
    large_inflow: numberOrNull(raw.BIGDEAL_INFLOW),
    large_outflow: numberOrNull(raw.BIGDEAL_OUTFLOW),
    main_cost: numberOrNull(raw.PRIME_COST),
    main_cost_20d: numberOrNull(raw.PRIME_COST_20DAYS),
    main_cost_60d: numberOrNull(raw.PRIME_COST_60DAYS),
    super_large_buy_ratio_raw: numberOrNull(raw.BUY_SUPERDEAL_RATIO),
    large_buy_ratio_raw: numberOrNull(raw.BUY_BIGDEAL_RATIO),
    prime_ratio_raw: numberOrNull(raw.RATIO),
    prime_ratio_3d_raw: numberOrNull(raw.RATIO_3DAYS),
    prime_ratio_50d_raw: numberOrNull(raw.RATIO_50DAYS),
    org_participate_raw: numberOrNull(raw.ORG_PARTICIPATE),
    total_score: numberOrNull(raw.TOTALSCORE),
    rank: numberOrNull(raw.RANK),
    rank_up: numberOrNull(raw.RANK_UP),
    focus: numberOrNull(raw.FOCUS),
    participate_type: textOrNull(raw.PARTICIPATE_TYPE),
  }
}

async function executeMainCapital(params: Params, signal: AbortSignal): Promise<{ data: unknown; schema: object }> {
  const url = new URL(DATACENTER_URL)
  url.searchParams.set('reportName', 'RPT_DMSK_TS_STOCKNEW')
  url.searchParams.set('columns', 'ALL')
  url.searchParams.set('source', 'WEB')
  url.searchParams.set('client', 'WEB')
  url.searchParams.set('sortColumns', MAIN_CAPITAL_SORTS[String(params.sort_field)])
  url.searchParams.set('sortTypes', params.sort_order === 'asc' ? '1' : '-1')
  url.searchParams.set('pageNumber', String(params.page))
  url.searchParams.set('pageSize', String(params.size))
  if (params.thscode) url.searchParams.set('filter', `(SECUCODE="${params.thscode}")`)
  const result = requireDatacenterResult(await getJson(url.toString(), signal, 'main capital snapshot'), 'main capital snapshot')
  const parsed = requireRows(result, 'main capital snapshot')
  return { data: { item: parsed.rows.map(parseMainCapitalRow), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(mainCapitalRow) }
}

/**
 * 分红送配方案：一行一个方案，按除权除息日过滤。`PRETAX_BONUS_RMB` / `BONUS_RATIO` / `IT_RATIO`
 * 的"每 10 股"标度由上游自己写在 `IMPL_PLAN_PROFILE` 原文里（实测 `10派280.2423元(含税)` 配
 * `PRETAX_BONUS_RMB=280.2423`、`10送4.00派3.00元` 配 `BONUS_RATIO=4`），所以照原值给出并保留原文。
 * `IS_KCB` 与 `PUBLISH_DATE` 实测 200/200 全为 null，不收录（描述里点名，免得当成取数失败）。
 */
const dividendRow = {
  type: 'object',
  properties: {
    thscode: { type: 'string' }, ticker: { type: 'string' }, name: { type: 'string' },
    report_date: { type: 'string' }, plan_notice_date: { type: 'string' }, notice_date: { type: 'string' },
    equity_record_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    ex_dividend_date: { type: 'string' }, ex_dividend_date_ms: { type: 'integer' },
    ex_dividend_days: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    assign_progress: { type: 'string' }, plan_profile: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    pretax_cash_per_10: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    bonus_shares_per_10: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    converted_shares_per_10: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    bonus_and_converted_per_10: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    total_shares: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    basic_eps: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    book_value_per_share: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    capital_reserve_per_share: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    undistributed_profit_per_share: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    net_profit_yoy_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    dividend_yield_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    post_10d_change_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    pre_10d_change_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    post_30d_change_raw: { oneOf: [{ type: 'number' }, { type: 'null' }] },
  },
  additionalProperties: true,
}

/** 日期键归一：`2026-06-26 00:00:00` → `2026-06-26`；空值保留 null（12/200 行没有股权登记日）。 */
function dayValue(value: unknown): string | null {
  const text = String(value ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function parseDividendRow(raw: JsonRecord): JsonRecord {
  if (typeof raw.SECUCODE !== 'string' || !raw.SECUCODE.includes('.')) {
    throw sourceError('Eastmoney dividend row lost its market suffix in SECUCODE', 'eastmoney_invalid_response')
  }
  const exDate = dayValue(raw.EX_DIVIDEND_DATE)
  if (exDate === null) throw sourceError('Eastmoney dividend row has invalid EX_DIVIDEND_DATE', 'eastmoney_invalid_response')
  // 这三列实测 200/200 行都有值（缺了就是上游形状变了），所以按必填处理、缺一就响亮失败；
  // equity_record_date 实测 12/200 为 null（方案还没定登记日），那一列才允许 null。
  const requiredDates = (['REPORT_DATE', 'PLAN_NOTICE_DATE', 'NOTICE_DATE'] as const).map((key) => {
    const day = dayValue(raw[key])
    if (day === null) throw sourceError(`Eastmoney dividend row is missing ${key}`, 'eastmoney_invalid_response')
    return day
  })
  const [reportDay, planNoticeDay, noticeDay] = requiredDates
  return {
    ...normalizeEastmoneySecurityIdentity({ secucode: raw.SECUCODE }),
    name: String(raw.SECURITY_NAME_ABBR ?? ''),
    report_date: reportDay,
    plan_notice_date: planNoticeDay,
    notice_date: noticeDay,
    equity_record_date: dayValue(raw.EQUITY_RECORD_DATE),
    ex_dividend_date: exDate,
    ex_dividend_date_ms: dateMs(exDate),
    ex_dividend_days: numberOrNull(raw.EX_DIVIDEND_DAYS),
    assign_progress: String(raw.ASSIGN_PROGRESS ?? ''),
    plan_profile: textOrNull(raw.IMPL_PLAN_PROFILE),
    pretax_cash_per_10: numberOrNull(raw.PRETAX_BONUS_RMB),
    bonus_shares_per_10: numberOrNull(raw.BONUS_RATIO),
    converted_shares_per_10: numberOrNull(raw.IT_RATIO),
    bonus_and_converted_per_10: numberOrNull(raw.BONUS_IT_RATIO),
    total_shares: numberOrNull(raw.TOTAL_SHARES),
    basic_eps: numberOrNull(raw.BASIC_EPS),
    book_value_per_share: numberOrNull(raw.BVPS),
    capital_reserve_per_share: numberOrNull(raw.PER_CAPITAL_RESERVE),
    undistributed_profit_per_share: numberOrNull(raw.PER_UNASSIGN_PROFIT),
    net_profit_yoy_pct: numberOrNull(raw.PNP_YOY_RATIO),
    dividend_yield_raw: numberOrNull(raw.DIVIDENT_RATIO),
    post_10d_change_raw: numberOrNull(raw.D10_CLOSE_ADJCHRATE),
    pre_10d_change_raw: numberOrNull(raw.BD10_CLOSE_ADJCHRATE),
    post_30d_change_raw: numberOrNull(raw.D30_CLOSE_ADJCHRATE),
  } as JsonRecord
}

function normalizeDividend(params: Params): Params {
  const normalized = normalizeDateRange(params, ['start_date', 'end_date', 'ticker', 'page', 'size'])
  const identity = normalizeEastmoneySecurityIdentity({ secucode: params.ticker })
  return { ...normalized, thscode: identity.thscode }
}

async function executeDividend(params: Params, signal: AbortSignal): Promise<{ data: unknown; schema: object }> {
  const url = new URL(DATACENTER_URL)
  url.searchParams.set('reportName', 'RPT_SHAREBONUS_DET')
  url.searchParams.set('columns', 'ALL')
  url.searchParams.set('source', 'WEB')
  url.searchParams.set('client', 'WEB')
  url.searchParams.set('sortColumns', 'EX_DIVIDEND_DATE')
  url.searchParams.set('sortTypes', '-1')
  url.searchParams.set('pageNumber', String(params.page))
  url.searchParams.set('pageSize', String(params.size))
  url.searchParams.set('filter', `(SECUCODE="${params.thscode}")(EX_DIVIDEND_DATE>='${params.start_date}')(EX_DIVIDEND_DATE<='${params.end_date}')`)
  const result = requireDatacenterResult(await getJson(url.toString(), signal, 'dividend plans'), 'dividend plans')
  const parsed = requireRows(result, 'dividend plans')
  return { data: { item: parsed.rows.map(parseDividendRow), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(dividendRow) }
}

/**
 * 股东户数**最新一期截面**（`RPT_HOLDERNUMLATEST`）：一股一行，`END_DATE` 是**报告期**、
 * `HOLD_NOTICE_DATE` 才是披露日（实测茅台 END_DATE=2026-06-30 / 披露 2026-08-15），两者必须分开。
 * 新上市标的 `PRE_HOLDER_NUM=0` 且 `HOLDER_NUM_RATIO=null`（无上期可比），不是数据错误。
 */
const holderRow = {
  type: 'object',
  properties: {
    thscode: { type: 'string' }, ticker: { type: 'string' }, name: { type: 'string' },
    end_date: { type: 'string' }, end_date_ms: { type: 'integer' },
    hold_notice_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    pre_end_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    holder_num: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    pre_holder_num: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    holder_num_change: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    holder_num_ratio_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    avg_market_cap: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    avg_hold_shares: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    total_market_cap: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    total_a_shares: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    close_price: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    interval_change_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    change_shares: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    change_reason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
  additionalProperties: true,
}

function parseHolderRow(raw: JsonRecord): JsonRecord {
  if (typeof raw.SECUCODE !== 'string' || !raw.SECUCODE.includes('.')) {
    throw sourceError('Eastmoney holder-count row lost its market suffix in SECUCODE', 'eastmoney_invalid_response')
  }
  const endDay = dayValue(raw.END_DATE)
  if (endDay === null) throw sourceError('Eastmoney holder-count row has invalid END_DATE', 'eastmoney_invalid_response')
  return {
    ...normalizeEastmoneySecurityIdentity({ secucode: raw.SECUCODE }),
    name: String(raw.SECURITY_NAME_ABBR ?? ''),
    end_date: endDay,
    end_date_ms: dateMs(endDay),
    hold_notice_date: dayValue(raw.HOLD_NOTICE_DATE),
    pre_end_date: dayValue(raw.PRE_END_DATE),
    holder_num: numberOrNull(raw.HOLDER_NUM),
    pre_holder_num: numberOrNull(raw.PRE_HOLDER_NUM),
    holder_num_change: numberOrNull(raw.HOLDER_NUM_CHANGE),
    holder_num_ratio_pct: numberOrNull(raw.HOLDER_NUM_RATIO),
    avg_market_cap: numberOrNull(raw.AVG_MARKET_CAP),
    avg_hold_shares: numberOrNull(raw.AVG_HOLD_NUM),
    total_market_cap: numberOrNull(raw.TOTAL_MARKET_CAP),
    total_a_shares: numberOrNull(raw.TOTAL_A_SHARES),
    close_price: numberOrNull(raw.CLOSE_PRICE),
    interval_change_pct: numberOrNull(raw.INTERVAL_CHRATE),
    change_shares: numberOrNull(raw.CHANGE_SHARES),
    change_reason: textOrNull(raw.CHANGE_REASON),
  } as JsonRecord
}

const HOLDER_SORTS: Record<string, string> = { holder_num: 'HOLDER_NUM', holder_num_ratio_pct: 'HOLDER_NUM_RATIO', total_market_cap: 'TOTAL_MARKET_CAP', end_date: 'END_DATE' }

function normalizeHolder(params: Params): Params {
  assertKnown(params, ['ticker', 'sort_field', 'sort_order', 'page', 'size'])
  const sort_field = params.sort_field === undefined ? 'holder_num' : String(params.sort_field)
  if (!(sort_field in HOLDER_SORTS)) throw new Error(`sort_field must be one of ${Object.keys(HOLDER_SORTS).join(', ')}`)
  const sort_order = params.sort_order === undefined ? 'desc' : String(params.sort_order)
  if (sort_order !== 'desc' && sort_order !== 'asc') throw new Error('sort_order must be desc or asc')
  const page = params.page === undefined ? 1 : integer(params.page, 'page', 1, Number.MAX_SAFE_INTEGER)
  const size = params.size === undefined ? 100 : integer(params.size, 'size', 1, MAX_PAGE_SIZE)
  if (params.ticker === undefined) return { sort_field, sort_order, page, size }
  return { sort_field, sort_order, page, size, thscode: normalizeEastmoneySecurityIdentity({ secucode: params.ticker }).thscode }
}

async function executeHolder(params: Params, signal: AbortSignal): Promise<{ data: unknown; schema: object }> {
  const url = new URL(DATACENTER_URL)
  url.searchParams.set('reportName', 'RPT_HOLDERNUMLATEST')
  url.searchParams.set('columns', 'ALL')
  url.searchParams.set('source', 'WEB')
  url.searchParams.set('client', 'WEB')
  url.searchParams.set('sortColumns', HOLDER_SORTS[String(params.sort_field)])
  url.searchParams.set('sortTypes', params.sort_order === 'asc' ? '1' : '-1')
  url.searchParams.set('pageNumber', String(params.page))
  url.searchParams.set('pageSize', String(params.size))
  if (params.thscode) url.searchParams.set('filter', `(SECUCODE="${params.thscode}")`)
  const result = requireDatacenterResult(await getJson(url.toString(), signal, 'holder count snapshot'), 'holder count snapshot')
  const parsed = requireRows(result, 'holder count snapshot')
  return { data: { item: parsed.rows.map(parseHolderRow), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(holderRow) }
}

/**
 * 两融个股明细（`RPTA_WEB_RZRQ_GGMX`）。45 列里绝大多数是同一族的"余额 / 买入 / 偿还 / 净买入 ×
 * 当日 / 3 / 5 / 10 日"，所以按映射表成对声明，不逐列写 JSON Schema。
 *
 * 口径靠算术核对，不靠记忆（实测 600519，2026-09-30）：`RZRQYE = RZYE + RQYE`、
 * `RZRQYECZ = RZYE - RQYE`、`RZJME = RZMRE - RZCHE`、`RQJMG = RQMCL - RQCHL` 四式精确成立，
 * `RZYEZB = RZYE / SZ`（0.8617% 对得上），所以这几列的含义可以写进契约。
 * 披露新鲜度**跨市场不一致**：实测沪市已到 2026-09-30，深市（000001）最新只有 2026-09-29。
 */
const MARGIN_COLUMNS: Array<[string, string]> = [
  ['RZYE', 'margin_balance'], ['RQYE', 'short_balance'], ['RZRQYE', 'total_balance'], ['RZRQYECZ', 'balance_gap'],
  ['RZMRE', 'margin_buy'], ['RZCHE', 'margin_repay'], ['RZJME', 'margin_net_buy'],
  ['RQMCL', 'short_sell_volume'], ['RQCHL', 'short_repay_volume'], ['RQJMG', 'short_net_buy_volume'],
  ['RZMRE3D', 'margin_buy_3d'], ['RZMRE5D', 'margin_buy_5d'], ['RZMRE10D', 'margin_buy_10d'],
  ['RZCHE3D', 'margin_repay_3d'], ['RZCHE5D', 'margin_repay_5d'], ['RZCHE10D', 'margin_repay_10d'],
  ['RZJME3D', 'margin_net_buy_3d'], ['RZJME5D', 'margin_net_buy_5d'], ['RZJME10D', 'margin_net_buy_10d'],
  ['RQMCL3D', 'short_sell_volume_3d'], ['RQMCL5D', 'short_sell_volume_5d'], ['RQMCL10D', 'short_sell_volume_10d'],
  ['RQCHL3D', 'short_repay_volume_3d'], ['RQCHL5D', 'short_repay_volume_5d'], ['RQCHL10D', 'short_repay_volume_10d'],
  ['RQJMG3D', 'short_net_buy_volume_3d'], ['RQJMG5D', 'short_net_buy_volume_5d'], ['RQJMG10D', 'short_net_buy_volume_10d'],
  ['SZ', 'total_market_cap'], ['SPJ', 'close_price'], ['ZDF', 'change_pct'],
  ['RCHANGE3DCP', 'change_3d_pct'], ['RCHANGE5DCP', 'change_5d_pct'], ['RCHANGE10DCP', 'change_10d_pct'],
  ['RZYEZB', 'margin_balance_pct'], ['FIN_BALANCE_GR', 'margin_balance_growth_raw'],
]

const marginRow: object = {
  type: 'object',
  properties: {
    thscode: { type: 'string' }, ticker: { type: 'string' }, name: { type: 'string' },
    trade_date: { type: 'string' }, trade_date_ms: { type: 'integer' },
    market_segment: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    ...Object.fromEntries(MARGIN_COLUMNS.map(([, to]) => [to, { oneOf: [{ type: 'number' }, { type: 'null' }] }])),
  },
  additionalProperties: true,
}

function parseMarginRow(raw: JsonRecord, requestedThscode: string): JsonRecord {
  const day = dayValue(raw.DATE)
  if (day === null) throw sourceError('Eastmoney margin row has invalid DATE', 'eastmoney_invalid_response')
  // SCODE 不带市场后缀，市场由请求的 ticker 决定：行身份取调用方传入的 canonical 代码，
  // 再与上游 SECUCODE 对照，对不上就是上游把明细串行了。
  const secucode = typeof raw.SECUCODE === 'string' ? raw.SECUCODE : ''
  if (secucode && secucode !== requestedThscode) {
    throw sourceError(`Eastmoney margin row SECUCODE ${secucode} does not match requested ${requestedThscode}`, 'eastmoney_invalid_response')
  }
  const row: JsonRecord = {
    thscode: requestedThscode,
    ticker: requestedThscode.replace(/\.(SH|SZ|BJ)$/i, ''),
    name: String(raw.SECNAME ?? ''),
    trade_date: day,
    trade_date_ms: dateMs(day),
    market_segment: textOrNull(raw.MARKET),
  }
  for (const [from, to] of MARGIN_COLUMNS) row[to] = numberOrNull(raw[from])
  return row
}

function normalizeMargin(params: Params): Params {
  const normalized = normalizeDateRange(params, ['start_date', 'end_date', 'ticker', 'page', 'size'])
  const identity = normalizeEastmoneySecurityIdentity({ secucode: params.ticker })
  return { ...normalized, thscode: identity.thscode }
}

async function executeMargin(params: Params, signal: AbortSignal): Promise<{ data: unknown; schema: object }> {
  const url = new URL(DATACENTER_URL)
  url.searchParams.set('reportName', 'RPTA_WEB_RZRQ_GGMX')
  url.searchParams.set('columns', 'ALL')
  url.searchParams.set('source', 'WEB')
  url.searchParams.set('client', 'WEB')
  url.searchParams.set('sortColumns', 'DATE')
  url.searchParams.set('sortTypes', '-1')
  url.searchParams.set('pageNumber', String(params.page))
  url.searchParams.set('pageSize', String(params.size))
  url.searchParams.set('filter', `(SCODE="${String(params.thscode).replace(/\.(SH|SZ|BJ)$/i, '')}")(DATE>='${params.start_date}')(DATE<='${params.end_date}')`)
  const result = requireDatacenterResult(await getJson(url.toString(), signal, 'margin detail'), 'margin detail')
  const parsed = requireRows(result, 'margin detail')
  const thscode = String(params.thscode)
  return { data: { item: parsed.rows.map((raw) => parseMarginRow(raw, thscode)), pagination: pagination(Number(params.page), Number(params.size), parsed.pages, parsed.total) }, schema: datacenterOutput(marginRow) }
}

function createSource(options: { capability: string; name: string; summary: string; description: string; inputSchema: object; outputSchema: object; paginated?: boolean; cacheMaxAgeMs?: number; rowShape: SchemaDescriptor['rowShape']; allowed: string[]; normalize: (params: Params) => Params; execute: (params: Params, signal: AbortSignal) => Promise<{ data: unknown; schema: object }> }): DataSource {
  const schema: SchemaDescriptor = { capability: options.capability, time_contract: getDataTimeContract(options.capability), name: options.name, source: `http:eastmoney.${options.capability}`, data_key: buildDataKey('eastmoney', 'http', options.capability), source_label: 'eastmoney', paginated: options.paginated === true, cacheMaxAgeMs: options.cacheMaxAgeMs, rowShape: options.rowShape, summary: options.summary, description: options.description, input_schema: options.inputSchema, output_schema: options.outputSchema }
  const normalize = (params: Record<string, unknown>): Params => options.normalize(params)
  return { schema, normalizeParams: normalize, validateOutput: (data) => isRecord(data) && Array.isArray(data.item) && isRecord(data.pagination), execute: async (request: DataRequest, signal: AbortSignal) => options.execute(normalize(request.params), signal) }
}

const dateRangeInput = {
  type: 'object', properties: { start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD' }, end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD' }, page: { type: 'integer', minimum: 1 }, size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE } }, required: ['start_date', 'end_date'], additionalProperties: false,
}
const boardInput = {
  type: 'object', properties: { board_type: { type: 'string', enum: [...BOARD_TYPES] }, sort_field: { type: 'string', enum: Object.keys(SORT_FIELDS) }, page: { type: 'integer', minimum: 1 }, size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE } }, required: [], additionalProperties: false,
}
const cashflowInput = {
  type: 'object', properties: { board_type: { type: 'string', enum: [...BOARD_TYPES] }, page: { type: 'integer', minimum: 1 }, size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE } }, required: [], additionalProperties: false,
}
const mutualFlowInput = {
  type: 'object',
  properties: {
    start_date: { type: 'string', description: '起始自然日 YYYY-MM-DD' },
    end_date: { type: 'string', description: '截止自然日 YYYY-MM-DD' },
    channel: { type: 'string', enum: MUTUAL_CHANNEL_NAMES, description: '渠道，默认 north_total（北向合计）' },
    page: { type: 'integer', minimum: 1 },
    size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
  },
  required: ['start_date', 'end_date'],
  additionalProperties: false,
}
const snapshotInput = { type: 'object', properties: {}, required: [], additionalProperties: false }
const mainCapitalInput = {
  type: 'object',
  properties: {
    ticker: { type: 'string', description: '完整证券代码（带市场后缀，如 600519.SH）；省略则取全市场排名' },
    sort_field: { type: 'string', enum: Object.keys(MAIN_CAPITAL_SORTS), description: '排序列，默认 main_net_inflow' },
    sort_order: { type: 'string', enum: ['desc', 'asc'] },
    page: { type: 'integer', minimum: 1 },
    size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
  },
  required: [],
  additionalProperties: false,
}

const holderInput = {
  type: 'object',
  properties: {
    ticker: { type: 'string', description: '完整证券代码（带市场后缀，如 600519.SH）；省略则取全市场截面' },
    sort_field: { type: 'string', enum: Object.keys(HOLDER_SORTS), description: '排序列，默认 holder_num' },
    sort_order: { type: 'string', enum: ['desc', 'asc'] },
    page: { type: 'integer', minimum: 1 },
    size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
  },
  required: [],
  additionalProperties: false,
}
const tickerRangeInput = {
  type: 'object',
  properties: {
    ticker: { type: 'string', description: '完整证券代码（带市场后缀，如 600519.SH）' },
    start_date: { type: 'string', description: '除权除息日区间起点 YYYY-MM-DD' },
    end_date: { type: 'string', description: '除权除息日区间终点 YYYY-MM-DD' },
    page: { type: 'integer', minimum: 1 },
    size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
  },
  required: ['ticker', 'start_date', 'end_date'],
  additionalProperties: false,
}

export function createEastmoneySources(): DataSource[] {
  return [
    createSource({ capability: 'eastmoney_top_buy_sell_market', name: 'get_eastmoney_top_buy_sell_market', summary: '东财全市场龙虎榜汇总', description: '按交易日区间分页获取东方财富龙虎榜上榜股票汇总。金额字段单位为元，CHANGE_RATE/TURNOVERRATE/DEAL_*_RATIO 为东财百分数原值；同一股票同日可能因多个上榜原因返回多行，不去重。上游 HTTP 200 但 success=false、code 非 0 或 result 缺失均视为失败，不转换为空数组。', inputSchema: dateRangeInput, outputSchema: datacenterOutput(topBuySellRow), paginated: true, rowShape: { rowKey: 'item' }, allowed: ['start_date', 'end_date', 'page', 'size'], normalize: (params) => normalizeDateRange(params, ['start_date', 'end_date', 'page', 'size']), execute: (params, signal) => executeBillboard(params, signal) }),
    createSource({ capability: 'eastmoney_top_buy_sell_ticker', name: 'get_eastmoney_top_buy_sell_ticker', summary: '东财单票龙虎榜汇总', description: '按单只 A 股和交易日区间获取东方财富龙虎榜汇总。ticker 必须带 SH/SZ/BJ 市场后缀；请求内部转换为 SECURITY_CODE，单票过滤器要求日期使用单引号、代码使用双引号。返回保留同日多条上榜原因；金额单位为元，百分比为东财原值。该能力是上榜股票汇总，不是营业部席位明细。', inputSchema: { type: 'object', properties: { ticker: { type: 'string', description: '完整证券代码，如 600519.SH' }, start_date: { type: 'string' }, end_date: { type: 'string' }, page: { type: 'integer', minimum: 1 }, size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE } }, required: ['ticker', 'start_date', 'end_date'], additionalProperties: false }, outputSchema: datacenterOutput(topBuySellRow), paginated: true, rowShape: { rowKey: 'item' }, allowed: ['ticker', 'start_date', 'end_date', 'page', 'size'], normalize: normalizeTicker, execute: (params, signal) => executeBillboard(params, signal, String(params.ticker)) }),
    createSource({ capability: 'eastmoney_lockup_expiry', name: 'get_eastmoney_lockup_expiry', summary: '东财限售解禁日历', description: '按自然日期区间分页获取东方财富限售解禁日历。已验证字段包括解禁日期、解禁股份类型、FREE_SHARES、TOTAL_RATIO、NON_FREE_SHARES、ABLE_FREE_SHARES；TOTAL_RATIO 是小数比例，股份数量字段以 free_shares_raw 等原始数值保存，单位以东财页面口径为准，未擅自标成股。', inputSchema: dateRangeInput, outputSchema: datacenterOutput(lockupRow), paginated: true, rowShape: { rowKey: 'item' }, allowed: ['start_date', 'end_date', 'page', 'size'], normalize: (params) => normalizeDateRange(params, ['start_date', 'end_date', 'page', 'size']), execute: executeLockup }),
    createSource({ capability: 'eastmoney_sector_rotation', cacheMaxAgeMs: 60_000, name: 'get_eastmoney_sector_rotation', summary: '东财板块行情排名快照', description: '获取东方财富行业、概念或地域板块的查询时点排名快照。默认行业、按涨跌幅排序；board_type 映射为东财 m:90+t:2/3/1。不是历史轮动序列，Dataset 的 captured_at 才是采集时间；板块代码使用 board_code，不归一为证券 ticker。', inputSchema: boardInput, outputSchema: { type: 'object', properties: { item: { type: 'array', items: sectorRow }, pagination: { type: 'object', additionalProperties: true } }, required: ['item', 'pagination'], additionalProperties: true }, paginated: true, rowShape: { rowKey: 'item' }, allowed: ['board_type', 'sort_field', 'page', 'size'], normalize: normalizeBoard, execute: (params, signal) => executeBoard(params, signal, false) }),
    createSource({ capability: 'eastmoney_cashflow_rotation', cacheMaxAgeMs: 60_000, name: 'get_eastmoney_cashflow_rotation', summary: '东财板块资金流快照', description: '获取东方财富行业、概念或地域板块当前资金流快照，默认按主力净流入排序。f62/f66/f72/f78/f84 为金额原值（元），f184/f69/f75/f81/f87 为东财原始占比；当前只承诺查询时点快照，不把未确认的 5 日/10 日字段映射为历史序列。', inputSchema: cashflowInput, outputSchema: { type: 'object', properties: { item: { type: 'array', items: cashflowRow }, pagination: { type: 'object', additionalProperties: true } }, required: ['item', 'pagination'], additionalProperties: true }, paginated: true, rowShape: { rowKey: 'item' }, allowed: ['board_type', 'page', 'size'], normalize: normalizeCashflowBoard, execute: (params, signal) => executeBoard(params, signal, true) }),
    ...MACRO_TABLES.map(createMacroSource),
    createSource({
      capability: 'eastmoney_mutual_flow', name: 'get_eastmoney_mutual_flow',
      summary: '沪深港通成交额与额度状态（按渠道日频）',
      description: '按交易日区间与渠道获取沪深港通成交数据（RPT_MUTUAL_DEAL_HISTORY，实测单渠道日频、可翻到多年前）。channel 六档：北向 sh_stock_connect（沪股通）/ sz_stock_connect（深股通）/ north_total（北向合计，默认），南向 hk_connect_sh / hk_connect_sz / south_total；渠道身份由上游 MUTUAL_TYPE_NAME 自标，实测同一交易日 001+003=005、002+004=006 的成交额加法精确成立。⛔ **北向三档的 buy_amt_raw / sell_amt_raw / net_deal_amt_raw / accum_deal_amt_raw 上游一律为 null**（交易所自 2024-08 起停止披露北向每日买卖明细，实测 2026-09 仍为 null），本能力**不提供"北向净买入"**，谁问就只能给成交额；成交额 deal_amt_raw、成交笔数 deal_num、额度状态 quota_balance_text 与当日领涨股仍披露，南向四档金额字段都有值。金额一律是东财原值（`_raw` 后缀）且**跨渠道计量口径不一致**（配套的额度表里北向 52000 对应官方 520 亿元、南向 42000000000 对应 420 亿元，即同一列两种单位），所以只能在同一渠道内做趋势与相对比较，禁止跨渠道相加、禁止换算成亿元或元写进结论。hold_market_cap_raw 在北向单渠道为 null、北向合计为 0（上游占位，不是"市值为零"）。index_change_pct 是东财附带的相关指数涨跌幅（百分数原值），lead_thscode 带市场后缀。',
      inputSchema: mutualFlowInput, outputSchema: datacenterOutput(mutualFlowRow), paginated: true, rowShape: { rowKey: 'item' },
      allowed: ['start_date', 'end_date', 'channel', 'page', 'size'], normalize: normalizeMutualFlow, execute: executeMutualFlow,
    }),
    createSource({
      capability: 'eastmoney_main_capital_snapshot', cacheMaxAgeMs: 60_000, name: 'get_eastmoney_main_capital_snapshot',
      summary: '东财个股主力资金快照（仅最近交易日）',
      description: '获取东方财富个股主力资金**查询时点快照**（RPT_DMSK_TS_STOCKNEW）。⛔ 上游只保留**最近一个交易日**的全市场一行一股（实测 5199 只、TRADE_DATE 只有当天，带旧日期的过滤器返回 9201 空），本能力**没有历史序列**：不要按日期循环请求，需要历史就改走行情类能力或如实告知用户取不到。默认按主力净流入降序分页；ticker 必须带市场后缀（如 600519.SH），省略则取全市场排名。main_net_inflow 与各档 *_inflow / *_outflow 是东财原值（实测 000501 主力净流入 -3822595，量级对应元）；main_cost / main_cost_20d / main_cost_60d 是主力成本价（元/股，用来判断现价高于还是低于主力成本）；change_pct 与 turnover_rate_pct 是东财百分数原值（0.6011 表示 0.6011%），与本仓其他东财能力同口径。带 `_raw` 后缀的比例列（*_ratio_raw、org_participate_raw）**口径未经核验**：0.1198 既可能读作 0.12% 也可能读作 11.98%，只能做同列相对比较，禁止换算成百分数写进结论。rank / rank_up / total_score / focus 是东财自有的主力资金排名与关注度打分，口径归东财、跨日不可比；participate_type 是上游的参与类型码，原文保留未做翻译。实测 200 行里 CHANGE_RATE 与 TURNOVERRATE 各有 2 行为 null（停牌或当日无成交），null 原样保留不补 0。Dataset 的 captured_at 才是采集时间。',
      inputSchema: mainCapitalInput, outputSchema: datacenterOutput(mainCapitalRow), paginated: true, rowShape: { rowKey: 'item' },
      allowed: ['ticker', 'sort_field', 'sort_order', 'page', 'size'], normalize: normalizeMainCapital, execute: executeMainCapital,
    }),
    createSource({
      capability: 'eastmoney_dividend_plan', name: 'get_eastmoney_dividend_plan',
      summary: '东财分红送配方案明细（按个股与除权日）',
      description: '按单只 A 股与除权除息日区间获取东方财富分红送配方案（RPT_SHAREBONUS_DET，实测全库 56976 条、可翻回 1991 年）。一行一个方案；同一报告期可能同时有年度与中期两条方案，用 report_date 加 ex_dividend_date 区分。四个日期口径不同：report_date 是**报告期**（如 2025-12-31），plan_notice_date 是预案公告日，notice_date 是实施公告日，equity_record_date 是股权登记日（实测 12/200 行为 null——方案尚未定登记日，属正常），ex_dividend_date 是除权除息日；只有 ex_dividend_date_ms 提供毫秒时间轴。送转与派息一律是**每 10 股**口径（上游原文 plan_profile 就写成「10派280.2423元(含税)」，照抄即可核对）：pretax_cash_per_10 为每 10 股税前派息（元），bonus_shares_per_10 为每 10 股送股，converted_shares_per_10 为每 10 股转增，bonus_and_converted_per_10 为送转合计；纯派息方案的三个送转列同时为 null，不是缺数。assign_progress 是方案进度（实测「实施分配」/「董事会决议通过」）；ex_dividend_days 是距除权日天数，**未来为负**（实测 -17）。basic_eps / book_value_per_share / capital_reserve_per_share / undistributed_profit_per_share / net_profit_yoy_pct 是东财随附的每股与利润表指标。带 `_raw` 的三列除权前后涨跌幅与 dividend_yield_raw 的复权与比例口径**未经核验**，只做同列相对比较，禁止换算成百分数写进结论。上游的 IS_KCB 与 PUBLISH_DATE 实测全为 null，本能力不收录，不要当成取数失败；SECURITY_INNER_CODE / ORG_CODE / MARKET_TYPE 等内部编码同样不进取。',
      inputSchema: tickerRangeInput, outputSchema: datacenterOutput(dividendRow), paginated: true, rowShape: { rowKey: 'item' },
      allowed: ['ticker', 'start_date', 'end_date', 'page', 'size'], normalize: normalizeDividend, execute: executeDividend,
    }),
    createSource({
      capability: 'eastmoney_holder_number_snapshot', cacheMaxAgeMs: 60_000, name: 'get_eastmoney_holder_number_snapshot',
      summary: '东财股东户数最新一期截面',
      description: '获取东方财富股东户数的**最新一期截面**（RPT_HOLDERNUMLATEST，实测 5568 只、一股一行）。这是截面不是序列：上游只给每股当前最新一期，取不到历史区间，需要历史就如实告知用户现有能力覆盖不了。end_date 是**报告期**（如 2026-06-30），hold_notice_date 才是**披露日**（实测茅台报告期 2026-06-30、披露 2026-08-15），pre_end_date 是上一期报告期（新股为 null）；时间轴用 end_date_ms，不要把披露日当报告期用。holder_num 是股东户数，pre_holder_num 上期户数，holder_num_change 变动户数，holder_num_ratio_pct 变动比例（百分数原值，21.89 表示 +21.89%）——新股实测 pre_holder_num=0 且 holder_num_ratio_pct=null，这是"无上期可比"，不是取数失败。avg_market_cap 户均市值、avg_hold_shares 户均持股数、total_market_cap 总市值、total_a_shares A 股总股本、close_price 收盘价均为东财原值（市值与价格为元级量纲，未逐值核对）；interval_change_pct 是东财给出的区间涨跌幅（百分数原值）；change_shares 与 change_reason 是股本变动数与**中文原因原文**（实测「发行融资」/「资产重组」），原文照存不改写。默认按股东户数降序，可按 holder_num_ratio_pct / total_market_cap / end_date 换排序；ticker 带市场后缀时只返回该只一行。',
      inputSchema: holderInput, outputSchema: datacenterOutput(holderRow), paginated: true, rowShape: { rowKey: 'item' },
      allowed: ['ticker', 'sort_field', 'sort_order', 'page', 'size'], normalize: normalizeHolder, execute: executeHolder,
    }),
    createSource({
      capability: 'eastmoney_mutual_quota', cacheMaxAgeMs: 60_000, name: 'get_eastmoney_mutual_quota',
      summary: '北上南下当日额度与休市状态快照',
      description: '获取四个互连渠道（沪股通 / 深股通 / 港股通(沪) / 港股通(深)）在查询时点当日的额度与开关状态（RPT_MUTUAL_QUOTA，实测全表只有当日四条、没有历史序列）。无参数；Dataset 的 captured_at 才是采集时间，trade_date 是上游给出的日历日。closed_reason 非空表示当日休市（实测 2026-10-05 为「国庆节」）；上游的交易时段字段 start_time / end_time 在实测全部为 null，本能力不收录，不要当成缺口。⛔ trade_quota_raw 的计量口径**跨方向不一致**：北向 52000 对应官方每日额度 520 亿元、南向 42000000000 对应 420 亿元（同一列两种单位），因此两个方向的原值不可直接比较，也不要换算后写进结论；要绝对额度请以交易所官方披露为准。channel 是语义名、channel_label 是上游原文，board 为沪港通/深港通、direction 为 north/south。',
      inputSchema: snapshotInput, outputSchema: datacenterOutput(mutualQuotaRow), paginated: false, rowShape: { rowKey: 'item' },
      allowed: [], normalize: (params) => { assertKnown(params, []); return {} }, execute: executeMutualQuota,
    }),
    createSource({
      capability: 'eastmoney_margin_trading', name: 'get_eastmoney_margin_trading',
      summary: '个股融资融券明细（按票与交易日）',
      description: '按单只 A 股与交易日区间获取融资融券明细（RPTA_WEB_RZRQ_GGMX，实测 600519 共 3992 个交易日、可翻回约 2010 年）。⛔ **披露新鲜度跨市场不一致**：实测同一天查询沪市（600519）最新到 2026-09-30、深市（000001）最新只有 2026-09-29，深市滞后一个交易日；把两市当天放一起比会得出错误结论，需要同日对齐就自己截到共同日期并写明。金额列单位是元（实测 RZYE=22131853460 即 221 亿元）。余额族：margin_balance 融资余额、short_balance 融券余额、total_balance 两融合计、balance_gap 融资减融券——后两列已用真报文做加减法核对（total=marg…+short、gap=融资-融券，精确成立）。流量族：margin_buy 融资买入额、margin_repay 融资偿还额、margin_net_buy 融资净买入（=买入减偿还，实测精确成立），带 _3d / _5d / _10d 后缀的是**滚动累计而不是日均**，别除以天数。融券流量（short_sell_volume / short_repay_volume / short_net_buy_volume 及其累计）量纲是**股数**，与金额族不可相加。参考列：total_market_cap 总市值（元）、close_price 收盘价（元）、change_pct 当日涨跌幅、change_3d_pct / change_5d_pct / change_10d_pct 区间涨跌幅，均为东财百分数原值；margin_balance_pct 是融资余额占总市值的百分数原值（实测 0.8617 与 RZYE/SZ 一致）。margin_balance_growth_raw 的增长口径未核验，只做同列相对比较。market_segment 是上游市场原文（融资融券_沪证 / 融资融券_深证）。上游的 KCB 标志、TRADE_MARKET(_CODE) 内部编码与不带后缀的 SCODE 不进取；行身份采用请求传入的带市场后缀代码，与上游 SECUCODE 对不上即判 eastmoney_invalid_response。',
      inputSchema: tickerRangeInput, outputSchema: datacenterOutput(marginRow), paginated: true, rowShape: { rowKey: 'item' },
      allowed: ['ticker', 'start_date', 'end_date', 'page', 'size'], normalize: normalizeMargin, execute: executeMargin,
    }),
  ]
}
