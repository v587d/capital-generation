import { parseSecurityCode } from './security-code.js'

export type EastmoneyMarket = 'SH' | 'SZ' | 'BJ'

export interface EastmoneySecurityIdentity {
  thscode: string
  ticker: string
  eastmoney_code: string
  eastmoney_market: EastmoneyMarket
}

const MARKET_BY_PREFIX: Record<string, EastmoneyMarket> = { '0': 'SZ', '1': 'SH', '2': 'BJ' }

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
  const match = /^(0|1|2)\.(\d{6})$/.exec(rawSecid)
  if (!match) throw new Error('secid must have the form 0.000001, 1.600519, or 2.920982')
  const resolvedMarket = MARKET_BY_PREFIX[match[1]]
  const digits = match[2]
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
  const resolvedMarket: EastmoneyMarket = /^(?:4|8|92)/.test(digits)
    ? 'BJ'
    : /^(?:6|9)/.test(digits)
      ? 'SH'
      : 'SZ'
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
