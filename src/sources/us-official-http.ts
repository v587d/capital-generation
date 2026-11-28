/** US official data sources (Treasury, NY Fed): zero-key public endpoints, one throttle per host,
 * rows are plain arrays (no upstream pagination). SEC (same file family) is added separately. */

import type { DataRequest, DataSource, SchemaDescriptor } from '../data-collector/hub.js'
import { buildDataKey, outputSchemaIssues } from '../data-collector/hub.js'
import { dayDistance, getDataTimeContract } from '../time/tools.js'
import { createRequestThrottle } from '../net/throttle.js'
import { createSecSources } from './sec-http.js'

type Params = Record<string, unknown>
type JsonRecord = Record<string, unknown>
type Throttle = <T>(task: () => Promise<T>) => Promise<T>

const TREASURY_CSV_URL = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv'
const NYFED_RATES_URL = 'https://markets.newyorkfed.org/api/rates'

/** SEC's fair-access policy asks for a declarative UA with contact; env override lets the user supply their own. */
const DEFAULT_USER_AGENT = 'capital-generation (+https://github.com/v587d/capital-generation)'
function userAgent(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  const override = env?.SEC_USER_AGENT?.trim()
  return override !== undefined && override.length > 0 ? override : DEFAULT_USER_AGENT
}

const nyfedThrottle = createRequestThrottle(1000)
/** Treasury year files are serial-slow (~19s TTFB from this egress), so years are fetched with
 * staggered starts instead of a serial throttle; five files finish in ~22s, one file in ~19s. */
const TREASURY_STAGGER_MS = 800
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sourceError(message: string, code = 'us_official_invalid_response'): Error {
  const error = new Error(message)
  ;(error as Error & { code?: string }).code = code
  return error
}

function assertKnown(params: JsonRecord, allowed: string[]): void {
  for (const key of Object.keys(params)) {
    if (!allowed.includes(key)) throw new Error(`unsupported parameter: ${key} (allowed: ${allowed.join(', ')})`)
  }
}

function calendarDate(value: unknown, name: string): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value.trim())) throw new Error(`parameter ${name} must be a valid YYYY-MM-DD date`)
  const text = value.trim()
  const parsed = new Date(`${text}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new Error(`parameter ${name} must be a valid YYYY-MM-DD date`)
  return text
}

function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).replaceAll(',', '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function textOrNull(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length === 0 ? null : text
}

async function fetchText(url: string, signal: AbortSignal, label: string): Promise<string> {
  signal.throwIfAborted()
  let response: Response
  try {
    response = await fetch(url, { headers: { 'User-Agent': userAgent(), Accept: '*/*', 'Accept-Encoding': 'gzip, deflate' }, signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw sourceError(`${label} request failed: ${error instanceof Error ? error.message : String(error)}`, 'us_official_http_error')
  }
  if (!response.ok) throw sourceError(`${label} returned HTTP ${response.status}`, response.status === 403 ? 'us_official_forbidden' : 'us_official_http_error')
  return response.text()
}

async function requestText(throttle: Throttle, url: string, signal: AbortSignal, label: string): Promise<string> {
  signal.throwIfAborted()
  return throttle(() => fetchText(url, signal, label))
}

function normalizeDateRange(params: Params): Params {
  assertKnown(params, ['start_date', 'end_date'])
  const start_date = calendarDate(params.start_date, 'start_date')
  const end_date = calendarDate(params.end_date, 'end_date')
  if (start_date > end_date) throw new Error('start_date must not be later than end_date')
  return { start_date, end_date }
}

function normalizeTreasury(params: Params): Params {
  const range = normalizeDateRange(params)
  if (dayDistance(String(range.start_date), String(range.end_date)) > TREASURY_MAX_DAYS) {
    throw new Error(`Treasury date range exceeds maximum ${TREASURY_MAX_DAYS} days`)
  }
  return range
}

function createSource(options: {
  capability: string
  name: string
  summary: string
  description: string
  inputSchema: object
  outputSchema: object
  cacheMaxAgeMs: number
  allowed: string[]
  normalize: (params: Params) => Params
  validateOutput: (data: unknown) => boolean
  execute: (params: Params, signal: AbortSignal) => Promise<{ data: unknown; schema: object }>
}): DataSource {
  const schema: SchemaDescriptor = {
    capability: options.capability,
    time_contract: getDataTimeContract(options.capability),
    name: options.name,
    source: `http:us-official.${options.capability}`,
    data_key: buildDataKey('us_official', 'http', options.capability),
    source_label: 'us_official',
    paginated: false,
    cacheMaxAgeMs: options.cacheMaxAgeMs,
    rowShape: { rootArray: true },
    summary: options.summary,
    description: options.description,
    input_schema: options.inputSchema,
    output_schema: options.outputSchema,
  }
  return {
    schema,
    normalizeParams: (params: Record<string, unknown>) => options.normalize(params),
    validateOutput: (data) => options.validateOutput(data) && outputSchemaIssues(options.outputSchema, data).length === 0,
    execute: async (request: DataRequest, signal: AbortSignal) => options.execute(options.normalize(request.params), signal),
  }
}

const dateRangeInput = {
  type: 'object',
  properties: {
    start_date: { type: 'string', description: '起始日 YYYY-MM-DD（含端点）' },
    end_date: { type: 'string', description: '截止日 YYYY-MM-DD（含端点）' },
  },
  required: ['start_date', 'end_date'],
  additionalProperties: false,
}

// ── US Treasury yield curve ──────────────────────────────────────────────────

/** Header names as published; older year files lack `1.5 Month` / `4 Mo`, so missing columns are null. */
const TREASURY_TENORS: Record<string, string> = {
  '1 Mo': 'd1m',
  '1.5 Month': 'd1_5m',
  '2 Mo': 'd2m',
  '3 Mo': 'd3m',
  '4 Mo': 'd4m',
  '6 Mo': 'd6m',
  '1 Yr': 'd1y',
  '2 Yr': 'd2y',
  '3 Yr': 'd3y',
  '5 Yr': 'd5y',
  '7 Yr': 'd7y',
  '10 Yr': 'd10y',
  '20 Yr': 'd20y',
  '30 Yr': 'd30y',
}
const TREASURY_ROW_FIELDS = Object.values(TREASURY_TENORS)
/** 5 year files = 5 requests; a 10-year window would double the serial latency for little gain. */
const TREASURY_MAX_DAYS = 1830

const nullableNumber = { oneOf: [{ type: 'number' }, { type: 'null' }] }
const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] }

const treasuryRow = {
  type: 'object',
  properties: {
    date: { type: 'string' },
    ...Object.fromEntries(TREASURY_ROW_FIELDS.map((field) => [field, nullableNumber])),
  },
  required: ['date'],
  additionalProperties: false,
}

function parseTreasuryCsv(csv: string, label: string): JsonRecord[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) return []
  const header = lines[0].split(',').map((cell) => cell.replace(/^"|"$/g, '').trim())
  if (header[0] !== 'Date') throw sourceError(`${label} header changed: first column is ${JSON.stringify(header[0])}`)
  const columns = header.map((name) => TREASURY_TENORS[name] ?? null)
  if (columns.every((column) => column === null)) throw sourceError(`${label} header has no known tenor column`)
  const rows: JsonRecord[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((cell) => cell.replace(/^"|"$/g, '').trim())
    if (cells.length !== header.length) throw sourceError(`${label} row has ${cells.length} cells for ${header.length} columns`)
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(cells[0])
    if (match === null) throw sourceError(`${label} date is not M/D/YYYY: ${JSON.stringify(cells[0])}`)
    const date = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
    const row: JsonRecord = { date }
    for (const field of TREASURY_ROW_FIELDS) row[field] = null
    columns.forEach((field, index) => {
      if (field !== null) row[field] = numberOrNull(cells[index])
    })
    rows.push(row)
  }
  return rows
}

async function executeTreasury(params: Params, signal: AbortSignal): Promise<{ data: unknown; schema: object }> {
  const startDate = String(params.start_date)
  const endDate = String(params.end_date)
  const startYear = Number(startDate.slice(0, 4))
  const endYear = Number(endDate.slice(0, 4))
  const years: number[] = []
  for (let year = startYear; year <= endYear; year += 1) years.push(year)
  const csvs = await Promise.all(years.map(async (year, index) => {
    if (index > 0) await sleep(index * TREASURY_STAGGER_MS)
    const url = `${TREASURY_CSV_URL}/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`
    return fetchText(url, signal, `Treasury ${year} yield curve`)
  }))
  const rows: JsonRecord[] = []
  csvs.forEach((csv, index) => {
    const year = years[index]
    for (const row of parseTreasuryCsv(csv, `Treasury ${year} yield curve`)) {
      if (String(row.date) < startDate || String(row.date) > endDate) continue
      rows.push(row)
    }
  })
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)))
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1].date === rows[index].date) throw sourceError(`Treasury yield curve returned duplicate date ${String(rows[index].date)}`)
  }
  return { data: rows, schema: treasuryRow }
}

// ── NY Fed reference rates ───────────────────────────────────────────────────

const NYFED_RATE_TYPES: Record<string, 'secured' | 'unsecured'> = {
  sofr: 'secured',
  tgcr: 'secured',
  bgcr: 'secured',
  effr: 'unsecured',
  obfr: 'unsecured',
}
const NYFED_RATES = Object.keys(NYFED_RATE_TYPES)

const nyfedRow = {
  type: 'object',
  properties: {
    effective_date: { type: 'string' },
    rate_type: { type: 'string' },
    percent_rate: nullableNumber,
    percentile_1: nullableNumber,
    percentile_25: nullableNumber,
    percentile_75: nullableNumber,
    percentile_99: nullableNumber,
    target_rate_from: nullableNumber,
    target_rate_to: nullableNumber,
    volume_billions: nullableNumber,
    revision_indicator: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['effective_date', 'rate_type'],
  additionalProperties: false,
}

function normalizeNyfed(params: Params): Params {
  assertKnown(params, ['rate', 'start_date', 'end_date'])
  const rate = String(params.rate ?? '').trim().toLowerCase()
  if (!(rate in NYFED_RATE_TYPES)) throw new Error(`rate must be one of ${NYFED_RATES.join(', ')}`)
  const range = normalizeDateRange({ start_date: params.start_date, end_date: params.end_date })
  return { rate, ...range }
}

function parseNyfedRow(raw: JsonRecord): JsonRecord {
  const date = typeof raw.effectiveDate === 'string' ? raw.effectiveDate.trim() : ''
  if (!DATE_PATTERN.test(date)) throw sourceError(`NY Fed effectiveDate is not YYYY-MM-DD: ${JSON.stringify(String(raw.effectiveDate ?? ''))}`)
  const rateType = textOrNull(raw.type)
  if (rateType === null) throw sourceError('NY Fed row has no type')
  return {
    effective_date: date,
    rate_type: rateType,
    percent_rate: numberOrNull(raw.percentRate),
    percentile_1: numberOrNull(raw.percentPercentile1),
    percentile_25: numberOrNull(raw.percentPercentile25),
    percentile_75: numberOrNull(raw.percentPercentile75),
    percentile_99: numberOrNull(raw.percentPercentile99),
    target_rate_from: numberOrNull(raw.targetRateFrom),
    target_rate_to: numberOrNull(raw.targetRateTo),
    volume_billions: numberOrNull(raw.volumeInBillions),
    revision_indicator: textOrNull(raw.revisionIndicator),
  }
}

async function executeNyfed(params: Params, signal: AbortSignal): Promise<{ data: unknown; schema: object }> {
  const rate = String(params.rate)
  const url = `${NYFED_RATES_URL}/${NYFED_RATE_TYPES[rate]}/${rate}/search.json?startDate=${String(params.start_date)}&endDate=${String(params.end_date)}`
  const text = await requestText(nyfedThrottle, url, signal, `NY Fed ${rate.toUpperCase()}`)
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw sourceError(`NY Fed ${rate.toUpperCase()} returned non-JSON: ${JSON.stringify(text.slice(0, 120))}`)
  }
  if (!isRecord(payload) || !Array.isArray(payload.refRates)) throw sourceError(`NY Fed ${rate.toUpperCase()} response shape changed (refRates missing)`)
  const rows = payload.refRates.map((raw) => {
    if (!isRecord(raw)) throw sourceError(`NY Fed ${rate.toUpperCase()} returned a non-object row`)
    return parseNyfedRow(raw)
  })
  rows.sort((a, b) => String(a.effective_date).localeCompare(String(b.effective_date)))
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1].effective_date === rows[index].effective_date) throw sourceError(`NY Fed ${rate.toUpperCase()} returned duplicate effectiveDate ${String(rows[index].effective_date)}`)
  }
  return { data: rows, schema: nyfedRow }
}


// ── FINRA short volume / short interest ──────────────────────────────────────
// FINRA is a self-regulatory organization, not a government agency: its terms carry a
// non-commercial caveat, so both capabilities are documented as research-grade sources.

const FINRA_SHORT_VOLUME_URL = 'https://cdn.finra.org/equity/regsho/daily/CNMSshvol'
const FINRA_SHORT_INTEREST_URL = 'https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest'
const finraThrottle = createRequestThrottle(500)
const FINRA_SHORT_VOLUME_HEADER = ['Date', 'Symbol', 'ShortVolume', 'ShortExemptVolume', 'TotalVolume', 'Market']

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

function previousWeekday(date: string): string {
  let cursor = date
  for (let index = 0; index < 7; index += 1) {
    cursor = shiftDate(cursor, -1)
    if (!isWeekend(cursor)) return cursor
  }
  return cursor
}

function lastBusinessDayOfMonth(year: number, month: number): string {
  const cursor = new Date(Date.UTC(year, month, 0))
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) cursor.setUTCDate(cursor.getUTCDate() - 1)
  return cursor.toISOString().slice(0, 10)
}

/** Current calendar date in US/Eastern: FINRA files are keyed by the ET business day. */
function etToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

async function finraText(url: string, signal: AbortSignal, label: string, allowMissing: boolean): Promise<string | null> {
  signal.throwIfAborted()
  return finraThrottle(async () => {
    let response: Response
    try {
      response = await fetch(url, { headers: { 'User-Agent': userAgent(), Accept: '*/*' }, signal })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw sourceError(`${label} request failed: ${error instanceof Error ? error.message : String(error)}`, 'finra_http_error')
    }
    if (allowMissing && (response.status === 403 || response.status === 404)) return null
    if (!response.ok) throw sourceError(`${label} returned HTTP ${response.status}`, 'finra_http_error')
    return response.text()
  })
}

async function finraPost(body: JsonRecord, signal: AbortSignal, label: string): Promise<unknown[]> {
  signal.throwIfAborted()
  return finraThrottle(async () => {
    let response: Response
    try {
      response = await fetch(FINRA_SHORT_INTEREST_URL, {
        method: 'POST',
        headers: { 'User-Agent': userAgent(), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw sourceError(`${label} request failed: ${error instanceof Error ? error.message : String(error)}`, 'finra_http_error')
    }
    // 204 = this settlement date has no rows for the filter; a legitimate empty, not a failure.
    if (response.status === 204) return []
    if (!response.ok) throw sourceError(`${label} returned HTTP ${response.status}`, 'finra_http_error')
    const text = await response.text()
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      throw sourceError(`${label} returned non-JSON: ${JSON.stringify(text.slice(0, 120))}`)
    }
    if (!Array.isArray(payload)) throw sourceError(`${label} response is not an array`)
    return payload
  })
}

const finraShortVolumeRow = {
  type: 'object',
  properties: {
    trade_date: { type: 'string' },
    symbol: { type: 'string' },
    short_volume: { type: 'number' },
    short_exempt_volume: { type: 'number' },
    total_volume: { type: 'number' },
    market: { type: 'string' },
  },
  required: ['trade_date', 'symbol', 'short_volume', 'short_exempt_volume', 'total_volume', 'market'],
  additionalProperties: false,
}

function normalizeFinraSymbols(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('symbols must be a non-empty array')
  if (value.length > max) throw new Error(`symbols exceeds maximum ${max}`)
  return [...new Set(value.map((item) => {
    if (typeof item !== 'string') throw new Error('symbols[] must be a string')
    const symbol = item.trim().toUpperCase()
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) throw new Error(`symbols[] must be a US ticker, got ${JSON.stringify(item)}`)
    return symbol
  }))]
}

function normalizeShortVolume(params: Params): Params {
  assertKnown(params, ['trade_date', 'symbols'])
  const trade_date = params.trade_date === undefined ? undefined : calendarDate(params.trade_date, 'trade_date')
  const symbols = params.symbols === undefined ? undefined : normalizeFinraSymbols(params.symbols, 50)
  return { ...(trade_date === undefined ? {} : { trade_date }), ...(symbols === undefined ? {} : { symbols }) }
}

function parseShortVolume(text: string, label: string): JsonRecord[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) return []
  const header = lines[0].split('|').map((cell) => cell.trim())
  if (header.join('|') !== FINRA_SHORT_VOLUME_HEADER.join('|')) throw sourceError(`${label} header changed: ${lines[0]}`)
  // The file ends with a bare row count (measured 2026-11-25: trailer "12376" for 12,376 data rows).
  let body = lines.slice(1)
  let declaredRows: number | null = null
  const trailer = body.at(-1)?.trim()
  if (trailer !== undefined && /^\d+$/.test(trailer)) {
    declaredRows = Number(trailer)
    body = body.slice(0, -1)
  }
  const rows: JsonRecord[] = []
  for (const line of body) {
    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length !== 6) throw sourceError(`${label} row has ${cells.length} cells: ${line.slice(0, 120)}`)
    if (!/^\d{8}$/.test(cells[0])) throw sourceError(`${label} date is not YYYYMMDD: ${JSON.stringify(cells[0])}`)
    const tradeDate = `${cells[0].slice(0, 4)}-${cells[0].slice(4, 6)}-${cells[0].slice(6, 8)}`
    const numbers = cells.slice(2, 5).map((cell) => Number(cell))
    if (numbers.some((value) => !Number.isFinite(value) || value < 0)) throw sourceError(`${label} has a non-numeric volume: ${line.slice(0, 120)}`)
    rows.push({ trade_date: tradeDate, symbol: cells[1], short_volume: numbers[0], short_exempt_volume: numbers[1], total_volume: numbers[2], market: cells[5] })
  }
  if (declaredRows !== null && declaredRows !== rows.length) throw sourceError(`${label} trailer declares ${declaredRows} rows but ${rows.length} parsed`)
  return rows
}

async function executeShortVolume(params: Params, signal: AbortSignal): Promise<{ data: unknown; schema: object }> {
  const explicit = params.trade_date === undefined ? undefined : String(params.trade_date)
  const wanted = params.symbols === undefined ? undefined : new Set(params.symbols as string[])
  let tradeDate = explicit
  let text: string | null = null
  if (tradeDate !== undefined) {
    text = await finraText(`${FINRA_SHORT_VOLUME_URL}${tradeDate.replaceAll('-', '')}.txt`, signal, `FINRA short volume ${tradeDate}`, true)
    if (text === null) throw sourceError(`FINRA short volume has no file for ${tradeDate}: not a business day or not published yet`, 'finra_not_published')
  } else {
    // Walk back from the current ET date; the file appears after the close, so "today" may 403.
    let cursor = etToday()
    for (let index = 0; index < 10 && text === null; index += 1) {
      cursor = shiftDate(cursor, index === 0 ? 0 : -1)
      if (isWeekend(cursor)) continue
      const candidate = await finraText(`${FINRA_SHORT_VOLUME_URL}${cursor.replaceAll('-', '')}.txt`, signal, `FINRA short volume ${cursor}`, true)
      if (candidate !== null) { tradeDate = cursor; text = candidate }
    }
    if (text === null || tradeDate === undefined) throw sourceError('FINRA short volume has no published file in the last 10 calendar days', 'finra_not_published')
  }
  const rows = parseShortVolume(text, `FINRA short volume ${tradeDate}`)
    .filter((row) => wanted === undefined || wanted.has(String(row.symbol)))
  return { data: rows, schema: finraShortVolumeRow }
}

const finraShortInterestRow = {
  type: 'object',
  properties: {
    symbol: { type: 'string' },
    issue_name: nullableString,
    settlement_date: { type: 'string' },
    current_short_position: nullableNumber,
    previous_short_position: nullableNumber,
    change_previous: nullableNumber,
    change_percent: nullableNumber,
    average_daily_volume: nullableNumber,
    days_to_cover: nullableNumber,
    market_class_code: nullableString,
    exchange_code: nullableString,
    stock_split_flag: nullableString,
    revision_flag: nullableString,
    accounting_year_month: nullableNumber,
  },
  required: ['symbol', 'settlement_date'],
  additionalProperties: false,
}

function normalizeShortInterest(params: Params): Params {
  assertKnown(params, ['symbols', 'settlement_date'])
  const symbols = normalizeFinraSymbols(params.symbols, 10)
  const settlement_date = params.settlement_date === undefined ? undefined : calendarDate(params.settlement_date, 'settlement_date')
  return { symbols, ...(settlement_date === undefined ? {} : { settlement_date }) }
}

/** FINRA settles on the 15th and the last business day of each month; probe newest first. */
export function settlementCandidates(today = etToday()): string[] {
  const [year, month] = today.split('-').map(Number)
  const candidates: string[] = []
  for (let back = 0; back < 3; back += 1) {
    const cursor = new Date(Date.UTC(year, month - 1 - back, 1))
    const candidateYear = cursor.getUTCFullYear()
    const candidateMonth = cursor.getUTCMonth() + 1
    const fifteenth = `${candidateYear}-${String(candidateMonth).padStart(2, '0')}-15`
    candidates.push(isWeekend(fifteenth) ? previousWeekday(fifteenth) : fifteenth)
    candidates.push(lastBusinessDayOfMonth(candidateYear, candidateMonth))
  }
  return [...new Set(candidates)].filter((date) => date <= today).sort().reverse()
}

function parseShortInterestRow(raw: JsonRecord, expectedDate: string, label: string): JsonRecord {
  const settlement = textOrNull(raw.settlementDate)
  if (settlement !== expectedDate) throw sourceError(`${label} returned settlementDate ${String(settlement)} for ${expectedDate}`)
  const symbol = textOrNull(raw.symbolCode)
  if (symbol === null) throw sourceError(`${label} row has no symbolCode`)
  return {
    symbol,
    issue_name: textOrNull(raw.issueName),
    settlement_date: settlement,
    current_short_position: numberOrNull(raw.currentShortPositionQuantity),
    previous_short_position: numberOrNull(raw.previousShortPositionQuantity),
    change_previous: numberOrNull(raw.changePreviousNumber),
    change_percent: numberOrNull(raw.changePercent),
    average_daily_volume: numberOrNull(raw.averageDailyVolumeQuantity),
    days_to_cover: numberOrNull(raw.daysToCoverQuantity),
    market_class_code: textOrNull(raw.marketClassCode),
    exchange_code: textOrNull(raw.issuerServicesGroupExchangeCode),
    stock_split_flag: textOrNull(raw.stockSplitFlag),
    revision_flag: textOrNull(raw.revisionFlag),
    accounting_year_month: numberOrNull(raw.accountingYearMonthNumber),
  }
}

async function fetchShortInterest(symbol: string, settlementDate: string, signal: AbortSignal): Promise<JsonRecord[]> {
  const rows = await finraPost({
    limit: 1,
    compareFilters: [
      { compareType: 'EQUAL', fieldName: 'settlementDate', fieldValue: settlementDate },
      { compareType: 'EQUAL', fieldName: 'symbolCode', fieldValue: symbol },
    ],
  }, signal, `FINRA short interest ${symbol} ${settlementDate}`)
  return rows.map((raw) => {
    if (!isRecord(raw)) throw sourceError('FINRA short interest row is not an object')
    return parseShortInterestRow(raw, settlementDate, `FINRA short interest ${symbol}`)
  })
}

async function executeShortInterest(params: Params, signal: AbortSignal): Promise<{ data: unknown; schema: object }> {
  const symbols = params.symbols as string[]
  const settlementDate = params.settlement_date === undefined ? undefined : String(params.settlement_date)
  if (settlementDate === undefined) {
    for (const candidate of settlementCandidates()) {
      const rows: JsonRecord[] = []
      for (const symbol of symbols) rows.push(...await fetchShortInterest(symbol, candidate, signal))
      if (rows.length > 0) return { data: rows, schema: finraShortInterestRow }
    }
    throw sourceError('FINRA short interest has no published settlement date in the last 3 months', 'finra_not_published')
  }
  const rows: JsonRecord[] = []
  for (const symbol of symbols) {
    rows.push(...await fetchShortInterest(symbol, settlementDate, signal))
  }
  return { data: rows, schema: finraShortInterestRow }
}

export function createUsOfficialSources(): DataSource[] {
  return [
    createSource({
      capability: 'us_treasury_yield_curve',
      cacheMaxAgeMs: 3_600_000,
      name: 'get_us_treasury_yield_curve',
      summary: '美债收益率曲线（按年文件拼接，日频）',
      description: '获取美国财政部每日国债收益率曲线（home.treasury.gov daily_treasury_yield_curve，零 key、官方 CSV）。⛔ **按年文件拼接**：URL 的年份段与 `field_tdr_date_value` 都是年份，本层按区间跨年逐文件下载后本地裁剪，不是只取当前年（实测 2019 年文件没有 `1.5 Month` / `4 Mo` 两列，列集随年份变化，缺列的行该字段为 null——⛔ 不要按固定列数解析）。区间上限 1830 天（5 个年文件；本机实测单文件 TTFB 约 19s，所以跨年按 800ms 错开并发拉取，5 个文件约 22s 完成——⛔ 不要改回串行，会撞 30s Hub 超时）。未来年份的文件实测是 HTTP 200 + 空 body（不是 404），该年按空处理。一行一个业务日，`date` 是**美东业务日**（不是北京时间；节假日没有行），收益率单位是**百分数原值**（4.27 读作 4.27%），不是比例。列映射按表头显式转成 ASCII：`1 Mo→d1m`、`1.5 Month→d1_5m`、`2 Mo→d2m`、`3 Mo→d3m`、`4 Mo→d4m`、`6 Mo→d6m`、`1 Yr→d1y`、`2 Yr→d2y`、`3 Yr→d3y`、`5 Yr→d5y`、`7 Yr→d7y`、`10 Yr→d10y`、`20 Yr→d20y`、`30 Yr→d30y`；未在映射表里的表头列**丢弃**，表头首列必须是 Date，行宽与表头不一致、日期不是 M/D/YYYY、同日重复都响亮失败。CSV 实测倒序（新→旧），本层输出按 date 升序。空区间（如只有周末）返回成功空数组，不是失败。更新时点：每个业务日约 15:30 ET 后发布当日曲线（本轮未复测）。',
      inputSchema: dateRangeInput,
      outputSchema: { type: 'array', items: treasuryRow },
      allowed: ['start_date', 'end_date'],
      normalize: normalizeTreasury,
      validateOutput: (data) => Array.isArray(data) && data.every((row) => isRecord(row) && typeof row.date === 'string'),
      execute: executeTreasury,
    }),
    createSource({
      capability: 'nyfed_reference_rates',
      cacheMaxAgeMs: 3_600_000,
      name: 'get_nyfed_reference_rates',
      summary: '纽约联储基准利率（SOFR/EFFR 等，日频）',
      description: '获取纽约联储公布的美元基准利率（markets.newyorkfed.org，零 key、官方 JSON）：`rate` 取 `sofr`/`tgcr`/`bgcr`（secured）或 `effr`/`obfr`（unsecured），走 `search.json?startDate&endDate` 区间查询。一行一个业务日；`effective_date` 是**美东业务日**（周末与假日没有行，空区间返回成功空数组）。⛔ 单位是**百分数原值**（3.94 读作 3.94%），`percent_rate` 与四个分位数字段都是百分数原值，`volume_billions` 单位是**十亿美元**（3158 = 3.158 万亿），不要按美元解读。`target_rate_from`/`target_rate_to` 只有 EFFR 有（目标区间），其余为 null。字段映射：effectiveDate→effective_date、type→rate_type（如 SOFR）、percentRate→percent_rate、percentPercentile1/25/75/99→percentile_1/25/75/99、targetRateFrom/To→target_rate_from/to、volumeInBillions→volume_billions、revisionIndicator→revision_indicator（空串→null）。⛔ 该接口按利率分别返回，不同利率的 `type` 不同；不要用 SOFR 的日期范围去推断 EFFR 是否发布。上游 `refRates` 缺失、行不是对象、effectiveDate 非 YYYY-MM-DD、同日重复都响亮失败；`refRates: []` 是合法空。本层输出按 effective_date 升序（上游实测倒序）。SOFR 自 2018-04-02 起，EFFR/OBFR/BGCR/TGCR 各自起点不同，更早日期为空是数据边界不是故障。对外展示需按纽约联储要求标注来源与取数日期。',
      inputSchema: {
        type: 'object',
        properties: {
          rate: { type: 'string', enum: NYFED_RATES, description: '利率：sofr/tgcr/bgcr/effr/obfr' },
          start_date: { type: 'string', description: '起始日 YYYY-MM-DD（美东业务日，含端点）' },
          end_date: { type: 'string', description: '截止日 YYYY-MM-DD（美东业务日，含端点）' },
        },
        required: ['rate', 'start_date', 'end_date'],
        additionalProperties: false,
      },
      outputSchema: { type: 'array', items: nyfedRow },
      allowed: ['rate', 'start_date', 'end_date'],
      normalize: normalizeNyfed,
      validateOutput: (data) => Array.isArray(data) && data.every((row) => isRecord(row) && typeof row.effective_date === 'string'),
      execute: executeNyfed,
    }),
    createSource({
      capability: 'finra_short_volume',
      cacheMaxAgeMs: 3_600_000,
      name: 'get_finra_short_volume',
      summary: 'FINRA 做空成交量（日频，全市场文件）',
      description: '获取 FINRA 每日做空成交量（Reg SHO 日文件：`cdn.finra.org/equity/regsho/daily/CNMSshvol{YYYYMMDD}.txt`，零 key，Consolidated NMS 口径）。⛔ 上游是**整份全市场文件**（实测 2026-11-25：12,378 行 / 552KB），本层下载后在本地按 `symbols` 过滤，不改变上游事实；不传 `symbols` 就是全市场（行数大，慎用）。⛔ **成交量是小数**：实测 `AAPL` 为 short 9,758,284.19 / total 16,888,251.03，不要当整数股数四舍五入；单位是股。`market` 是交易所集合（实测 `B,Q,N`），不是单一市场。`trade_date` 是**美东业务日**：省略时从美东今天往回找最多 10 个自然日，取第一个已发布文件（收盘后才发布，所以当天常取到前一交易日）；显式传日期但该日没有文件（周末/假日/尚未发布）时上游 403，本层**响亮失败**并说明，不返回空数组。文件表头固定为 `Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market`，**末尾还有一行裸行数**（实测 2026-11-25 是 `12376`），本层把它当校验值：解析出的数据行数必须等于它，否则响亮失败；表头变化、行宽不是 6、日期不是 YYYYMMDD、数值非数字同样响亮失败。⛔ 来源条款含 non-commercial 限制，按研究口径使用，不宣称可商用；展示时标注 FINRA Reg SHO。',
      inputSchema: {
        type: 'object',
        properties: {
          trade_date: { type: 'string', description: '美东业务日 YYYY-MM-DD；省略则自动取最近已发布日' },
          symbols: { type: 'array', items: { type: 'string' }, description: '可选：只保留这些美股代码（1–50 个）' },
        },
        required: [],
        additionalProperties: false,
      },
      outputSchema: { type: 'array', items: finraShortVolumeRow },
      allowed: ['trade_date', 'symbols'],
      normalize: normalizeShortVolume,
      validateOutput: (data) => Array.isArray(data) && data.every((row) => isRecord(row) && typeof row.symbol === 'string' && typeof row.trade_date === 'string'),
      execute: executeShortVolume,
    }),
    createSource({
      capability: 'finra_short_interest',
      cacheMaxAgeMs: 21_600_000,
      name: 'get_finra_short_interest',
      summary: 'FINRA 做空余额（双周，按结算日）',
      description: '获取 FINRA 合并做空余额（consolidatedShortInterest，零 key，POST JSON）。`symbols` 必填 1–10 个；`settlement_date` 可选——**省略时自动发现最近已发布的结算日**（结算日是每月 15 日与月末，遇周末提前到前一个工作日；双周披露、约 8 个工作日滞后，本层从最近 3 个月候选日里由新到旧探测）。⛔ 上游 API **强制按 settlementDate 分区**：不给该日期做 EQUAL 过滤时排序会被拒绝（400），所以本层按「结算日 × 单票」逐次查询，不做全市场扫描。字段：current/previous_short_position（股）、change_previous（股）、change_percent（百分数原值）、average_daily_volume（股/日）、days_to_cover（日）、market_class_code、exchange_code、stock_split_flag、revision_flag、accounting_year_month（如 20261113）。⛔ 204 No Content = 该结算日没有该票记录（合法空），不是失败；某票在该结算日无记录时不返回该行。⛔ 结算日不是自然日期：**不要**用 `resolve_data_time_range` 生成它，省略参数让本能力自动发现。来源条款含 non-commercial 限制。',
      inputSchema: {
        type: 'object',
        properties: {
          symbols: { type: 'array', items: { type: 'string' }, description: '美股代码 1–10 个（如 AAPL）' },
          settlement_date: { type: 'string', description: '结算日 YYYY-MM-DD（可选；省略自动取最近已发布结算日）' },
        },
        required: ['symbols'],
        additionalProperties: false,
      },
      outputSchema: { type: 'array', items: finraShortInterestRow },
      allowed: ['symbols', 'settlement_date'],
      normalize: normalizeShortInterest,
      validateOutput: (data) => Array.isArray(data) && data.every((row) => isRecord(row) && typeof row.symbol === 'string' && typeof row.settlement_date === 'string'),
      execute: executeShortInterest,
    }),
    ...createSecSources(),
  ]
}
