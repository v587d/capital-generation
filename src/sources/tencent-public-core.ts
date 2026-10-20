/**
 * Tencent public endpoint kernel: leaf (only `net/throttle.js`). Shared by the host-plane watchlist
 * and `tencent-http.ts` for one throttle chain and one HK/US field table. No other dependencies.
 */
import { createRequestThrottle } from '../net/throttle.js'

export const QUOTE_URL = 'https://qt.gtimg.cn/q='
export const SMARTBOX_URL = 'https://smartbox.gtimg.cn/s3/'

export const TENCENT_MIN_INTERVAL_MS = 120
export const tencentThrottle = createRequestThrottle(TENCENT_MIN_INTERVAL_MS)

export type JsonRecord = Record<string, unknown>

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'boolean') throw new Error('source returned boolean where a number was expected')
  const number = typeof value === 'number' ? value : Number(String(value).replaceAll(',', '').trim())
  return Number.isFinite(number) ? number : null
}

export function requiredNumber(value: unknown, field: string): number {
  const number = numberOrNull(value)
  if (number === null) throw new Error(`source returned an invalid ${field}`)
  return number
}

export function sourceError(message: string, code = 'tencent_source_error'): Error {
  const error = new Error(message)
  ;(error as Error & { code?: string }).code = code
  return error
}

async function readResponse(response: Response, encoding: 'utf-8' | 'gbk'): Promise<string> {
  const bytes = await response.arrayBuffer()
  return new TextDecoder(encoding).decode(bytes)
}

/** Cancellation does not queue; see `docs/dev/web-retriever.md` §4.2. */
export async function tencentGetText(
  url: string,
  signal: AbortSignal,
  encoding: 'utf-8' | 'gbk' = 'utf-8',
  init: RequestInit = {},
): Promise<string> {
  signal.throwIfAborted()
  return tencentThrottle(async () => {
    const response = await fetch(url, {
      ...init,
      headers: { 'User-Agent': 'Mozilla/5.0', ...(init.headers ?? {}) },
      signal,
    })
    const text = await readResponse(response, encoding)
    if (!response.ok) throw sourceError(`Tencent HTTP ${response.status} for ${url}`, response.status === 429 ? 'tencent_rate_limit' : 'tencent_http_error')
    return text
  })
}

/** Separate HK/US and A-share field tables: currency 75/35; turnover 59 (total shares) vs 38 (float). */
export const HK_QUOTE_FIELDS = 78
export const US_QUOTE_FIELDS = 73

/** Exchange-local time; separator drifts per row (`/` vs `-`), normalize to hyphen. */
export function offshoreQuoteTime(value: unknown): string | null {
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(String(value ?? '').trim())
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}` : null
}

export function snapshotRows(text: string, requested: Set<string>): Array<{ symbol: string; fields: string[] }> {
  const rows: Array<{ symbol: string; fields: string[] }> = []
  for (const line of text.split(';')) {
    const match = /^v_([\w.]+)="([^"]*)"/.exec(line.trim())
    if (!match) continue
    if (!requested.has(match[1].toLowerCase())) continue
    rows.push({ symbol: match[1], fields: match[2].split('~') })
  }
  return rows
}

/** HK codes are 5 digits; `hk700`/`hk0700` are silently dropped upstream, so left-pad. */
export function normalizeHkCode(value: unknown, name: string): string {
  const raw = String(value ?? '').trim().toUpperCase()
  const digits = /^(?:HK)?(\d{1,5})(?:\.HK)?$/.exec(raw)?.[1]
  if (!digits) throw new Error(`parameter ${name} must be a five-digit Hong Kong stock code (for example 00700, hk00700 or 700); HK index codes such as HSI/HSTECH are not supported here`)
  return digits.padStart(5, '0')
}

/** Snapshot matches only bare US tickers (`usBABA.N` → no row); K-line needs the suffix (`usAAPL` → stale 2011 data). */
export function normalizeUsCode(value: unknown, name: string): string {
  const raw = String(value ?? '').trim().toUpperCase()
  const match = /^(?:US)?([A-Z]{1,6}(?:\.[A-Z]{1,3}){0,2})$/.exec(raw)
  if (!match) throw new Error(`parameter ${name} must be a US equity ticker such as AAPL, BRK.B or BABA.N (a Tencent exchange suffix like .OQ is accepted and re-resolved from the snapshot)`)
  return match[1].replace(/\.[A-Z]{2,3}$/u, '')
}

export function usSymbolVariants(ticker: string): string[] {
  const variants = [`us${ticker}`]
  let current = ticker
  for (let depth = 0; depth < 2; depth += 1) {
    const dot = current.lastIndexOf('.')
    if (dot <= 0) break
    current = current.slice(0, dot)
    variants.push(`us${current}`)
  }
  return variants
}

export function parseHkQuoteRows(text: string, requested: Set<string>): JsonRecord[] {
  const rows: JsonRecord[] = []
  for (const { symbol, fields } of snapshotRows(text, requested)) {
    if (fields.length < HK_QUOTE_FIELDS) throw sourceError(`Tencent HK quote ${symbol} returned ${fields.length} fields, expected at least ${HK_QUOTE_FIELDS}`, 'tencent_invalid_response')
    if (!/^\d{5}$/.test(fields[2] ?? '')) throw sourceError(`Tencent HK quote ${symbol} is not a five-digit stock code (got ${JSON.stringify(fields[2] ?? '')})`, 'tencent_invalid_response')
    const quoteTime = offshoreQuoteTime(fields[30])
    if (quoteTime === null) throw sourceError(`Tencent HK quote ${symbol} has an unreadable timestamp ${JSON.stringify(fields[30] ?? '')}`, 'tencent_invalid_response')
    const value = (index: number): number | null => numberOrNull(fields[index])
    const row: JsonRecord = {
      code: fields[2],
      tencent_symbol: `hk${fields[2]}`,
      name: fields[1] ?? '',
      english_name: fields[46] ?? '',
      currency: fields[75] ?? '',
      price: value(3),
      last_close: value(4),
      open: value(5),
      high: value(33),
      low: value(34),
      change_amt: value(31),
      change_pct: value(32),
      amplitude_pct: value(43),
      volume_shares: value(6),
      amount_hkd: value(37),
      avg_price: value(73),
      turnover_pct: value(59),
      total_shares: value(69),
      market_cap_yi_hkd: value(45),
      board_lot_shares: value(60),
      quote_time: quoteTime,
    }
    const stale = row.amount_hkd === 0 && row.price !== null && row.price === row.last_close
    row.is_stale = stale
    row.stale_reason = stale ? 'zero turnover and price equals previous close' : null
    rows.push(row)
  }
  return rows
}

export function parseUsQuoteRows(text: string, requested: Set<string>): Array<{ symbol: string; row: JsonRecord }> {
  const rows: Array<{ symbol: string; row: JsonRecord }> = []
  for (const { symbol, fields } of snapshotRows(text, requested)) {
    if (fields.length < US_QUOTE_FIELDS) throw sourceError(`Tencent US quote ${symbol} returned ${fields.length} fields, expected at least ${US_QUOTE_FIELDS}`, 'tencent_invalid_response')
    if (!/^[A-Z][A-Z.]{0,9}\.[A-Z]{1,3}$/.test(fields[2] ?? '')) throw sourceError(`Tencent US quote ${symbol} has an unexpected code ${JSON.stringify(fields[2] ?? '')}`, 'tencent_invalid_response')
    const quoteTime = offshoreQuoteTime(fields[30])
    if (quoteTime === null) throw sourceError(`Tencent US quote ${symbol} has an unreadable timestamp ${JSON.stringify(fields[30] ?? '')}`, 'tencent_invalid_response')
    const value = (index: number): number | null => numberOrNull(fields[index])
    const row: JsonRecord = {
      code: fields[2],
      tencent_symbol: `us${fields[2]}`,
      exchange_code: fields[2].slice(fields[2].lastIndexOf('.') + 1),
      name: fields[1] ?? '',
      english_name: fields[46] ?? '',
      currency: fields[35] ?? '',
      price: value(3),
      last_close: value(4),
      open: value(5),
      high: value(33),
      low: value(34),
      change_amt: value(31),
      change_pct: value(32),
      amplitude_pct: value(43),
      volume_shares: value(6),
      amount_usd: value(37),
      avg_price: value(67),
      turnover_pct: value(38),
      total_shares: value(62),
      float_shares: value(63),
      float_market_cap_yi_usd: value(44),
      market_cap_yi_usd: value(45),
      quote_time: quoteTime,
    }
    const stale = row.amount_usd === 0 && row.price !== null && row.price === row.last_close
    row.is_stale = stale
    row.stale_reason = stale ? 'zero turnover and price equals previous close' : null
    rows.push({ symbol, row })
  }
  return rows
}

/** Indices: points only; magnitude columns unreadable. No currency. US code has a leading dot, HK is letters. */
export function parseOffshoreIndexRows(text: string, requested: Set<string>, market: 'hk' | 'us'): JsonRecord[] {
  const fieldFloor = market === 'hk' ? HK_QUOTE_FIELDS : US_QUOTE_FIELDS
  const codeOf = (code: string): string => (market === 'hk' ? code : code.replace(/^./u, ''))
  const rows: JsonRecord[] = []
  for (const { symbol, fields } of snapshotRows(text, requested)) {
    if (fields.length < fieldFloor) throw sourceError(`Tencent ${market} index quote ${symbol} returned ${fields.length} fields, expected at least ${fieldFloor}`, 'tencent_invalid_response')
    const raw = String(fields[2] ?? '')
    const shapeOk = market === 'hk' ? /^[A-Z][A-Z0-9.]{1,9}$/u.test(raw) : /^\.[A-Z][A-Z0-9.]{1,9}$/u.test(raw)
    if (!shapeOk) throw sourceError(`Tencent ${market} index quote ${symbol} is not an index code (got ${JSON.stringify(raw)})`, 'tencent_invalid_response')
    const quoteTime = offshoreQuoteTime(fields[30])
    if (quoteTime === null) throw sourceError(`Tencent ${market} index quote ${symbol} has an unreadable timestamp ${JSON.stringify(fields[30] ?? '')}`, 'tencent_invalid_response')
    const value = (index: number): number | null => numberOrNull(fields[index])
    rows.push({
      code: codeOf(raw),
      tencent_symbol: symbol,
      name: fields[1] ?? '',
      english_name: fields[46] ?? '',
      price: value(3),
      last_close: value(4),
      open: value(5),
      high: value(33),
      low: value(34),
      change_amt: value(31),
      change_pct: value(32),
      amplitude_pct: value(43),
      quote_time: quoteTime,
    })
  }
  return rows
}

export function normalizeOffshoreIndexCode(value: unknown, name: string, market: 'hk' | 'us'): string {
  const raw = String(value ?? '').trim().toUpperCase().replace(/^(?:HK|US)/u, '')
  const stem = raw.replace(/^\./u, '').replace(/\.(?:HK|US)$/u, '')
  if (market === 'hk' && /^(?:\d{1,5}|hk\d{1,5})$/u.test(raw)) {
    throw new Error(`parameter ${name} must be a Hong Kong index code such as HSI or HSTECH (five-digit codes belong to tencent_hk_quote: 实测指数行与个股行的量纲列不同)`)
  }
  if (!/^[A-Z][A-Z0-9.]{1,9}$/u.test(stem)) {
    throw new Error(`parameter ${name} must be an index code letters only (for example HSI, HSTECH for HK or IXIC, DJI, INX for US) — 实测腾讯不认 usSPX / usNDQ / usSOX / usRUT，写法只认检索回来的那个`)
  }
  return stem
}

/** HK one batch; US retries only no-row tickers with stripped suffixes. */
export async function fetchOffshoreQuotes(market: 'hk' | 'us', codes: string[], signal: AbortSignal): Promise<JsonRecord[]> {
  if (market === 'hk') {
    const symbols = codes.map((code) => `hk${code}`)
    const text = await tencentGetText(`${QUOTE_URL}${symbols.join(',')}`, signal, 'gbk')
    const rows = parseHkQuoteRows(text, new Set(symbols.map((symbol) => symbol.toLowerCase())))
    if (rows.length === 0) throw sourceError(`Tencent returned no HK quote rows for ${symbols.join(',')}`, 'tencent_empty_response')
    return rows
  }
  const pending = codes.map((ticker) => usSymbolVariants(ticker))
  const rows: JsonRecord[] = []
  const tried = new Set<string>()
  for (let round = 0; round < 3 && pending.some((list) => list.length > 0); round += 1) {
    const symbols = pending.map((list) => list.shift()).filter((symbol): symbol is string => Boolean(symbol))
    for (const symbol of symbols) tried.add(symbol.toLowerCase())
    const text = await tencentGetText(`${QUOTE_URL}${symbols.join(',')}`, signal, 'gbk')
    const found = parseUsQuoteRows(text, new Set(symbols.map((symbol) => symbol.toLowerCase())))
    // Match case-insensitively; a miss would requery an already-resolved ticker.
    const hit = new Set(found.map((item) => item.symbol.toLowerCase()))
    rows.push(...found.map((item) => item.row))
    for (let index = 0; index < symbols.length; index += 1) {
      if (hit.has(symbols[index].toLowerCase())) { pending[index] = []; continue }
      // Strip one dot-segment and retry; when nothing is left, upstream does not know the ticker.
      const next = pending[index].find((variant) => !tried.has(variant.toLowerCase()))
      if (next !== undefined) pending[index] = [next, ...pending[index].filter((variant) => variant !== next)]
    }
  }
  if (rows.length === 0) throw sourceError(`Tencent returned no US quote rows for ${codes.join(',')}`, 'tencent_empty_response')
  return rows
}

export async function fetchOffshoreIndexQuotes(market: 'hk' | 'us', codes: string[], signal: AbortSignal): Promise<JsonRecord[]> {
  const symbols = codes.map((code) => `${market}${code}`)
  const text = await tencentGetText(`${QUOTE_URL}${symbols.join(',')}`, signal, 'gbk')
  const rows = parseOffshoreIndexRows(text, new Set(symbols.map((symbol) => symbol.toLowerCase())), market)
  if (rows.length === 0) throw sourceError(`Tencent returned no ${market} index quote rows for ${symbols.join(',')}`, 'tencent_empty_response')
  return rows
}

export async function resolveUsKlineSymbol(ticker: string, signal: AbortSignal): Promise<string> {
  for (const symbol of usSymbolVariants(ticker)) {
    const text = await tencentGetText(`${QUOTE_URL}${symbol}`, signal, 'gbk')
    const [row] = snapshotRows(text, new Set([symbol.toLowerCase()]))
    if (!row || row.fields.length < US_QUOTE_FIELDS) continue
    const code = row.fields[2]
    if (!/^[A-Z][A-Z.]{0,9}\.[A-Z]{1,3}$/.test(code)) throw sourceError(`Tencent returned an unreadable US code ${JSON.stringify(code)}`, 'tencent_invalid_response')
    return `us${code}`
  }
  throw new Error(`Tencent does not recognize US ticker ${ticker}; no spelling of it returned a snapshot to resolve an exchange`)
}

/** smartbox `v_hint="market~code~name~pinyin~type^…"` (~10); no hit or invalid `t` both return `N`. */
export interface SmartboxCandidate {
  market: string
  code: string
  name: string
  pinyin: string
  type: string
}

export function parseSmartbox(text: string): SmartboxCandidate[] {
  const match = /v_hint="([\s\S]*)"/.exec(text)
  const body = match?.[1] ?? ''
  if (body === 'N' || body.length === 0) return []
  const candidates: SmartboxCandidate[] = []
  for (const entry of body.split('^')) {
    const parts = unescapeHint(entry).split('~')
    if (parts.length < 5) continue
    const [market, code, name, pinyin, type] = parts
    if (!market || !code) continue
    candidates.push({ market: market.toLowerCase(), code: code.toUpperCase(), name, pinyin, type })
  }
  return candidates
}

function unescapeHint(value: string): string {
  if (!value.includes('\\u')) return value
  try {
    return value.replace(/\\u([\da-f]{4})/giu, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
  } catch {
    return value
  }
}

export const SMARTBOX_MARKETS = ['all', 'hk', 'us']

export async function fetchSmartbox(query: string, market: string, signal: AbortSignal): Promise<SmartboxCandidate[]> {
  if (!SMARTBOX_MARKETS.includes(market)) throw new Error(`smartbox market must be one of ${SMARTBOX_MARKETS.join('/')}; got ${JSON.stringify(market)}（列表形态实测回 N 哨兵，等于查无此票）`)
  const url = `${SMARTBOX_URL}?v=2&t=${encodeURIComponent(market)}&q=${encodeURIComponent(query)}`
  // ASCII `\uXXXX` body: use utf-8; the 'ascii' label maps to windows-1252.
  const text = await tencentGetText(url, signal)
  return parseSmartbox(text)
}
