import { parseSecurityCode } from './security-code.js'

export type EastmoneyMarket = 'SH' | 'SZ' | 'BJ'

export interface EastmoneySecurityIdentity {
  thscode: string
  ticker: string
  eastmoney_code: string
  eastmoney_market: EastmoneyMarket
}

/**
 * secid 市场码（实测于 2026-09-24，`push2.eastmoney.com/api/qt/stock/get`）：
 * `1.` = 沪；`0.` = **深市与北交所共用**（`0.920982`、`0.430047` 返回 rc=0，`2.*` 一律 rc=100）。
 * 因此 `0.` 的 BJ/SZ 由数字前缀区分（4/8/92 为北交所），与 `normalizeEastmoneyAshareIdentity`
 * 共用 `marketFromAshareDigits` 的同一份规则（§9.7：一条知识一个实现）。
 */
const SECID_MARKET_BY_PREFIX: Record<string, 'SH' | 'SZ_OR_BJ'> = { '1': 'SH', '0': 'SZ_OR_BJ' }

function marketFromAshareDigits(digits: string): EastmoneyMarket {
  if (/^(?:4|8|92)/u.test(digits)) return 'BJ'
  if (/^(?:6|9)/u.test(digits)) return 'SH'
  return 'SZ'
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

function market(value: unknown, name = 'market'): EastmoneyMarket {
  const raw = text(value, name).toUpperCase()
  if (raw === 'SH' || raw === 'SSE' || raw === '1') return 'SH'
  if (raw === 'SZ' || raw === 'SZSE' || raw === '0') return 'SZ'
  if (raw === 'BJ' || raw === 'BSE' || raw === '2') return 'BJ'
  throw new Error(`${name} must be SH, SZ, or BJ`)
}

function code(value: unknown, name: string): string {
  const raw = text(value, name).toUpperCase()
  if (/^\d{6}\.(?:SH|SZ|BJ)$/.test(raw)) return raw
  if (/^(?:SH|SZ|BJ)\d{6}$/.test(raw)) return `${raw.slice(2)}.${raw.slice(0, 2)}`
  if (/^\d{6}$/.test(raw)) return raw
  throw new Error(`${name} must be a six-digit code, SECUCODE, or market-prefixed code`)
}

/**
 * Resolve Eastmoney's provider identifiers without guessing a market from digits.
 * `market` is mandatory for a bare SECURITY_CODE; `secid` carries its own market.
 */
export function normalizeEastmoneySecurityIdentity(input: {
  secucode?: unknown
  security_code?: unknown
  market?: unknown
  secid?: unknown
}): EastmoneySecurityIdentity {
  const explicit = input.secucode ?? input.security_code
  if (explicit !== undefined) {
    const normalized = code(explicit, 'security_code')
    const parsed = normalized.includes('.') ? parseSecurityCode(normalized, 'security_code') : undefined
    if (!parsed && input.market === undefined) throw new Error('security_code requires an explicit market')
    const resolvedMarket = parsed?.market ?? market(input.market)
    const digits = parsed?.digits ?? normalized
    if (parsed && input.market !== undefined && resolvedMarket !== market(input.market)) throw new Error('security_code conflicts with market')
    return {
      thscode: `${digits}.${resolvedMarket}`,
      ticker: digits,
      eastmoney_code: digits,
      eastmoney_market: resolvedMarket,
    }
  }

  const rawSecid = text(input.secid, 'secid')
  const match = /^(0|1)\.(\d{6})$/.exec(rawSecid)
  if (!match) throw new Error('secid must have the form 0.000001 or 1.600519 (北交所同为 0.)')
  const digits = match[2]
  const resolvedMarket: EastmoneyMarket = SECID_MARKET_BY_PREFIX[match[1]] === 'SH' ? 'SH' : marketFromAshareDigits(digits)
  return {
    thscode: `${digits}.${resolvedMarket}`,
    ticker: digits,
    eastmoney_code: digits,
    eastmoney_market: resolvedMarket,
  }
}

export function normalizeEastmoneyAshareIdentity(value: unknown): EastmoneySecurityIdentity {
  const raw = text(value, 'security_code').toUpperCase()
  const digits = raw.includes('.') ? raw.slice(0, 6) : raw
  if (!/^\d{6}$/.test(digits)) throw new Error('security_code must be a six-digit A-share code')
  const resolvedMarket = marketFromAshareDigits(digits)
  return { thscode: `${digits}.${resolvedMarket}`, ticker: digits, eastmoney_code: digits, eastmoney_market: resolvedMarket }
}

export interface EastmoneyBoardIdentity {
  board_code: string
  board_name: string
  board_type: 'industry' | 'concept' | 'region'
}

export function normalizeEastmoneyBoardIdentity(codeValue: unknown, nameValue: unknown, boardType: EastmoneyBoardIdentity['board_type']): EastmoneyBoardIdentity {
  const board_code = text(codeValue, 'board_code').toUpperCase()
  if (!/^BK\d{4}$/.test(board_code)) throw new Error(`board_code must be BK followed by four digits (received ${JSON.stringify(board_code)})`)
  return { board_code, board_name: text(nameValue, 'board_name'), board_type: boardType }
}
