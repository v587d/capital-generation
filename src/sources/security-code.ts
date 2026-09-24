export type SecurityMarket = 'SH' | 'SZ' | 'BJ'

export interface SecurityCode {
  digits: string
  market: SecurityMarket
  canonical: string
  tencentSymbol: string
  isIndex: boolean
}

const CODE_PATTERN = /^(?:(sh|sz|bj)(\d{6})|(\d{6})(?:\.(sh|sz|bj|xshg|xshe))?)$/i
const JOINQUANT_MARKETS: Record<string, SecurityMarket> = { xshg: 'SH', xshe: 'SZ' }
const SH_INDEX_CODES = new Set(['000001', '000010', '000016', '000300', '000688', '000852', '000905'])

function naturalMarket(digits: string): SecurityMarket {
  if (digits.startsWith('92') || digits.startsWith('4') || digits.startsWith('8')) return 'BJ'
  if (digits[0] === '5' || digits[0] === '6' || digits[0] === '9') return 'SH'
  return 'SZ'
}

function explicitMarket(prefix?: string, suffix?: string): SecurityMarket | undefined {
  const raw = (prefix ?? suffix ?? '').toLowerCase()
  if (!raw) return undefined
  return (JOINQUANT_MARKETS[raw] ?? raw.toUpperCase()) as SecurityMarket
}

function isMarket(value: string): value is SecurityMarket {
  return value === 'SH' || value === 'SZ' || value === 'BJ'
}

/**
 * Parse an A-share/ETF/index code without dropping exchange information.
 * Bare 000xxx codes are rejected because they are ambiguous (e.g. 000001).
 */
export function parseSecurityCode(value: unknown, name = 'code'): SecurityCode {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`parameter ${name} must be a security code`)
  const raw = value.trim()
  const match = CODE_PATTERN.exec(raw)
  if (!match) {
    throw new Error(`parameter ${name} must be a six-digit code with an exchange (for example 600519.SH, SH600519, or 600519.XSHG)`)
  }
  const digits = match[2] ?? match[3]
  const market = explicitMarket(match[1], match[4])
  if (market !== undefined && !isMarket(market)) throw new Error(`parameter ${name} has an unsupported exchange in ${JSON.stringify(raw)}`)
  if (market === undefined && digits.startsWith('000')) {
    throw new Error(`parameter ${name} requires an explicit exchange for ambiguous 000xxx code ${digits} (use ${digits}.SH for an index or ${digits}.SZ for a stock)`)
  }
  const resolved = market ?? naturalMarket(digits)
  if (digits.startsWith('000')) {
    if (resolved === 'BJ') throw new Error(`parameter ${name} has an invalid BJ exchange for 000xxx code ${digits}`)
  } else if (resolved !== naturalMarket(digits)) {
    throw new Error(`parameter ${name} exchange conflicts with code ${digits}: expected ${naturalMarket(digits)}`)
  }
  const isIndex = (resolved === 'SH' && SH_INDEX_CODES.has(digits)) || (resolved === 'SZ' && digits.startsWith('399'))
  return {
    digits,
    market: resolved,
    canonical: `${digits}.${resolved}`,
    tencentSymbol: `${resolved.toLowerCase()}${digits}`,
    isIndex,
  }
}

/** Normalize a list while preserving first-seen order and rejecting duplicates after normalization. */
export function normalizeSecurityCodes(value: unknown, name = 'codes', maximum = 50): SecurityCode[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',').map((item) => item.trim()).filter(Boolean)
      : undefined
  if (!rawValues || rawValues.length === 0) throw new Error(`parameter ${name} must contain at least one security code`)
  if (rawValues.length > maximum) throw new Error(`parameter ${name} accepts at most ${maximum} codes`)
  const seen = new Set<string>()
  const result: SecurityCode[] = []
  for (const item of rawValues) {
    const code = parseSecurityCode(item, name)
    if (!seen.has(code.canonical)) {
      seen.add(code.canonical)
      result.push(code)
    }
  }
  return result
}

export function requireTencentSecurity(code: SecurityCode, name = 'code'): SecurityCode {
  if (code.market === 'BJ') throw new Error(`parameter ${name} is a BJ code; Tencent public market endpoints currently support SH/SZ only`)
  return code
}

export function isLikelyIndex(code: SecurityCode): boolean {
  return code.isIndex
}
