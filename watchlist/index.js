/**
 * Host half of `@v587d/watchlist`. The list is a host-level user asset in the
 * official `storage-domain` domain `capital_watchlist`, reached by the browser
 * half through `/capital-watchlist/*`. Network is user-triggered only (no polling,
 * timers or retries); auth uses `connection.requestRejection`; quote fetching
 * reuses the shared source cores rather than a second parser.
 */
import z from 'zod'
import { DEFAULT_FUYAO_BASE_URL, FuyaoError, fuyaoItems, fuyaoQuery, fuyaoRequest, fuyaoTimestamp } from '../lib/sources/fuyao-core.js'
// Reuse the plugin-side offshore core (same throttle, field table and guards);
// a second parser would repeat the §9.7 incident class.
import {
  fetchOffshoreIndexQuotes,
  fetchOffshoreQuotes,
  fetchSmartbox,
  normalizeHkCode,
} from '../lib/sources/tencent-public-core.js'
import { ASSET_TYPES, isHoldable, weightCeiling, otherHeldWeightPct, MAX_ROW_WEIGHT_PCT, MAX_TOTAL_WEIGHT_PCT } from './holding-rules.js'

export const name = 'capital-watchlist'

export const ROUTE_PATH = '/capital-watchlist'
/** Storage unit names allow only lowercase/underscore, so the hyphen belongs to the route. */
export const DOMAIN_NAME = 'capital_watchlist'
/** List cap = per-refresh request cap; the ETF endpoint takes one code per call. */
export const MAX_ITEMS = 30
export const REFRESH_CONCURRENCY = 4
/** Upstream hard caps per branch: A-share 50, HK 10, US 10; the pool is bounded at 70. */
export const SEARCH_BRANCH_LIMITS = { 'a-share': 50, hk: 10, us: 10 }
/** A-share search whitelist; HK/US branches use their own smartbox type whitelists. */
export const SEARCH_ASSET_TYPES = 'a-share,a-share-index,fund-etf'
// Holdability and weight ceiling live only in `./holding-rules.js`, shared with the browser half.
/** `exchange` stores the market; US venue suffixes stay inside the canonical code. */
const EXCHANGES = ['SH', 'SZ', 'HK', 'US']
const SEARCH_TIMEOUT_MS = 15_000
/** smartbox market segment is single-valued; a list form returns the `N` sentinel. */
const SMARTBOX_MARKETS = ['hk', 'us']
/** smartbox type whitelist: `GP` stock, `GP-FUND` fund/ETF, `ZS` index. */
const SMARTBOX_STOCK_TYPES = ['GP', 'GP-FUND']
const SMARTBOX_INDEX_TYPE = 'ZS'
/** Same shape guards as the core; the US suffix excludes our four market markers. */
const SMARTBOX_INDEX_CODE = /^[A-Z][A-Z0-9.]{1,9}$/u
const SMARTBOX_US_IDENTITY = /^[A-Z][A-Z.]{0,9}\.(?!SH$|SZ$|HK$|US$)[A-Z]{1,3}$/u
/**
 * Refresh budget `20s + 2.5s × items`, 45–90s; checked before claiming each group,
 * so the real bound is budget + one timeout. Cut rows report `refresh_timeout`.
 */
const REFRESH_BUDGET_BASE_MS = 20_000
const REFRESH_BUDGET_PER_ITEM_MS = 2_500
const REFRESH_BUDGET_FLOOR_MS = 45_000
const REFRESH_BUDGET_CEIL_MS = 90_000
export function refreshBudgetFor(count) {
  return Math.min(REFRESH_BUDGET_CEIL_MS, Math.max(REFRESH_BUDGET_FLOOR_MS, REFRESH_BUDGET_BASE_MS + REFRESH_BUDGET_PER_ITEM_MS * count))
}
const MAX_BODY_BYTES = 65_536
const MAX_QUERY_LENGTH = 64
/** Same entry id as the `capital-config` card (settings namespace = entry id). */
const CAPITAL_CONFIG_ENTRY_ID = 'capital-config'
const DEFAULT_CREDENTIAL_REF = 'FUYAO_API_KEY'

const ENDPOINTS = {
  search: '/api/meta/tickers/search',
  stock: '/api/a-share/prices/snapshot',
  index: '/api/a-share-index/prices/snapshot',
  fund: '/api/fund/market/snapshot',
}

/**
 * A-share quote templates: unchanged endpoint shapes and whitelist. `currency`
 * is written only here (`CNY`), never for indices (points are unitless).
 */
const FUYAO_TEMPLATES = [
  ['a-share', { path: ENDPOINTS.stock, allowed: ['thscodes'], batch: true, scope: 'a-share', currency: 'CNY' }],
  ['a-share-index', { path: ENDPOINTS.index, allowed: ['thscodes'], batch: true, scope: 'a-share' }],
  ['fund-etf', { path: ENDPOINTS.fund, allowed: ['thscode'], batch: false, scope: 'a-share', currency: 'CNY' }],
]

/** One market family = one batch; currency only for stocks, never indices. */
const OFFSHORE_SPECS = [
  { assetType: 'hk-stock', market: 'hk', index: false, withCurrency: true, scope: 'hk' },
  { assetType: 'hk-index', market: 'hk', index: true, withCurrency: false, scope: 'hk' },
  { assetType: 'us-stock', market: 'us', index: false, withCurrency: true, scope: 'us' },
  { assetType: 'us-index', market: 'us', index: true, withCurrency: false, scope: 'us' },
]

/**
 * Canonical US keys are echoed identities (`AAPL.OQ`) but snapshots want `AAPL`;
 * here the trailing segment is known to be the venue, so strip it without guessing.
 */
function offshoreGroup(spec, keys) {
  const codeByKey = new Map()
  const failures = []
  for (const thscode of keys) {
    const stem = stemOf(thscode)
    const code = spec.market === 'us' && !spec.index ? stem.replace(/\.[A-Z]{2,3}$/u, '') : stem
    if (!/^(?:\d{5}|[A-Z][A-Z0-9.]{1,9})$/u.test(code)) {
      // Not requestable: record `quote_unavailable`, never ask with a truncated code.
      failures.push({ thscode, code: 'quote_unavailable' })
      continue
    }
    codeByKey.set(thscode, code)
  }
  if (codeByKey.size === 0) return { group: undefined, failures }
  return { group: { ...spec, kind: 'tencent', keys: [...codeByKey.keys()], codes: [...new Set(codeByKey.values())] }, failures }
}

/** Upstream identity → canonical key; the `.HK` / `.US` markers are ours. */
function offshoreKeyOf(row, group) {
  const code = typeof row.code === 'string' ? row.code.trim().toUpperCase() : ''
  if (code.length === 0) return ''
  if (group.market === 'hk') return `${code}.HK`
  return group.index ? `${code}.US` : code
}

/** Seed one index per market, fresh domains only: existing lists are never migrated. */
export const SEED_ITEMS = [
  { thscode: '000001.SH', ticker: '000001', name: '上证指数', exchange: 'SH', asset_type: 'a-share-index' },
  { thscode: 'HSI.HK', ticker: 'HSI', name: '恒生指数', exchange: 'HK', asset_type: 'hk-index' },
  { thscode: 'IXIC.US', ticker: 'IXIC', name: '纳斯达克', exchange: 'US', asset_type: 'us-index' },
  { thscode: 'INX.US', ticker: 'INX', name: '标普500', exchange: 'US', asset_type: 'us-index' },
]

/**
 * Canonical key shapes. Order is semantics: a `.HK` or `.US` key must not fall
 * into an earlier branch, or it can be added and never quoted. The A-share shape
 * covers several asset types; types come from search.
 */
const KEY_FORMS = [
  { form: 'a-share', regex: /^\d{6}\.(SH|SZ)$/u, assetTypes: ['a-share', 'a-share-index', 'fund-etf'] },
  { form: 'hk-stock', regex: /^\d{5}\.HK$/u, assetTypes: ['hk-stock'] },
  { form: 'hk-index', regex: /^[A-Z][A-Z.]{0,9}\.HK$/u, assetTypes: ['hk-index'] },
  { form: 'us-index', regex: /^[A-Z]{2,8}\.US$/u, assetTypes: ['us-index'] },
  // Exclude our own market markers, or `ABCDEF.SH` could pass as a US identity.
  { form: 'us-stock', regex: /^[A-Z][A-Z.]{0,9}\.(?!SH$|SZ$|HK$|US$)[A-Z]{1,3}$/u, assetTypes: ['us-stock'] },
]
/** Returns the first match, never the closest: unrecognized means unrecognized. */
export function keyFormOf(thscode) {
  if (typeof thscode !== 'string') return null
  return KEY_FORMS.find((entry) => entry.regex.test(thscode)) ?? null
}
const KEY_REGEX = /^(?:\d{6}\.(?:SH|SZ)|\d{5}\.HK|[A-Z][A-Z.]{0,9}\.HK|[A-Z]{2,8}\.US|[A-Z][A-Z.]{0,9}\.(?!SH$|SZ$|HK$|US$)[A-Z]{1,3})$/u
const FORM_SCOPE_TEXT = {
  'a-share': '沪深 A 股 / 指数 / 场内 ETF',
  'hk-stock': '港股现货',
  'hk-index': '港股指数，写法只认搜索回来的那个',
  'us-stock': '美股与在美 ADR',
  'us-index': '美股指数，写法只认搜索回来的那个（标普是 INX、纳斯达克是 IXIC）',
}

const quoteSchema = z.object({
  price: z.number(),
  /** Null means "no number" (halted, not open), while the price still exists; never coerce to 0. */
  change_pct: z.number().nullable(),
  captured_at: z.number().int(),
  source_ts: z.number().int().nullable(),
  /** Currency follows money: stocks/ETFs only; indices are unitless. Upstream owns the value domain. */
  currency: z.string().min(1).max(8).optional(),
  /** Exchange-local wall time, offshore only; never fabricated from `source_ts` (no DST table). */
  source_time: z.string().max(32).nullable().optional(),
})

const itemSchema = z.object({
  thscode: z.string().regex(KEY_REGEX),
  ticker: z.string().min(1),
  name: z.string().min(1),
  exchange: z.enum(EXCHANGES),
  asset_type: z.enum(ASSET_TYPES),
  added_at: z.number().int(),
  source: z.enum(['seed', 'user']),
  quote: quoteSchema.nullable(),
  /** Optional on purpose: v1 records lack it; required would invalidate the whole list. */
  pinned_at: z.number().int().optional(),
  /**
   * User-reported holding: absent = not held, `null` = held without weight, `0` =
   * a real zero. `marked_at` is when the claim was last made, not a start date.
   */
  holding: z.object({
    weight_pct: z.number().min(0).max(100).nullable(),
    marked_at: z.number().int(),
  }).optional(),
})

/** `defineDomain` only validates this spec; keeping imports to zod avoids dsh runtime coupling. */
export const domainSpec = {
  name: DOMAIN_NAME,
  version: 1,
  layout: 'single',
  global: {
    schema: z.object({ seeded_at: z.number().int(), schema: z.literal(1) }),
    // `seeded_at: 0` = never seeded; a non-zero stamp prevents reseeding after deletion.
    initial: { seeded_at: 0, schema: 1 },
  },
  tables: { items: { valueSchema: itemSchema } },
}

/** Trim + uppercase; only the five shapes above. Bare codes are rejected: the market is not ours to guess. */
export function normalizeThscode(value) {
  if (typeof value !== 'string') return undefined
  const cleaned = value.trim().toUpperCase()
  return KEY_REGEX.test(cleaned) ? cleaned : undefined
}

/**
 * Text before the last dot; never `split('.')[0]` (`BRK.B.N` is a real identity).
 * smartbox accepts this stem, not the canonical key.
 */
export function stemOf(thscode) {
  const dot = thscode.lastIndexOf('.')
  return dot > 0 ? thscode.slice(0, dot) : thscode
}

/** Market is the suffix only, never a middle dot segment. */
function marketOfKey(thscode) {
  const dot = thscode.lastIndexOf('.')
  return dot > 0 ? thscode.slice(dot + 1) : ''
}

/**
 * Route by key shape, not `asset_type`: the shape gate is the same one used when
 * adding, so a hand-edited type cannot send HK rows to the Fuyao endpoints.
 */
function quoteRoute(item) {
  const entry = keyFormOf(item.thscode)
  if (entry === null) return undefined
  return entry.assetTypes.includes(item.asset_type) ? entry : undefined
}

/**
 * Upstream error → local code. `perItem` separates a missing symbol from an
 * unreachable branch; `source` separates Fuyao (key card) from Tencent (public).
 */
export function watchlistErrorCode(error, { perItem = false, source = 'fuyao' } = {}) {
  if (source === 'tencent') return perItem ? 'quote_unavailable' : (error?.code === 'tencent_rate_limit' ? 'rate_limited' : 'tencent_unavailable')
  if (!(error instanceof FuyaoError)) return perItem ? 'quote_unavailable' : 'fuyao_unavailable'
  switch (error.kind) {
    case 'credential_missing':
      return 'credential_missing'
    case 'rate_limited':
      return 'rate_limited'
    case 'invalid_parameter':
      return perItem ? 'quote_unavailable' : 'invalid_query'
    case 'capability_closed':
    case 'http_error':
    case 'upstream_error':
    default:
      return perItem ? 'quote_unavailable' : 'fuyao_unavailable'
  }
}

/** Pinned rows first (newest pin first), others in insertion order; persistence order untouched. */
function rowsOf(table) {
  return [...table.entries()]
    .map(([, value], index) => ({ value, index }))
    .sort((left, right) => {
      const a = left.value.pinned_at ?? null
      const b = right.value.pinned_at ?? null
      if (a !== null && b !== null && a !== b) return b - a
      if (a !== null && b === null) return -1
      if (a === null && b !== null) return 1
      return left.index - right.index
    })
    .map((entry) => entry.value)
}

/** Upstream candidate row → panel shape. */
function candidateOf(row) {
  const thscode = typeof row.thscode === 'string' ? row.thscode : ''
  return {
    thscode,
    ticker: typeof row.ticker === 'string' && row.ticker.length > 0 ? row.ticker : stemOf(thscode),
    name: typeof row.name === 'string' && row.name.length > 0 ? row.name : thscode,
    // Prefer the upstream market; fall back to the last suffix, never a middle segment.
    exchange: typeof row.exchange === 'string' && row.exchange.length > 0 ? row.exchange.toUpperCase() : marketOfKey(thscode),
    asset_type: typeof row.asset_type === 'string' ? row.asset_type : '',
  }
}

/**
 * smartbox row → candidate, or `undefined`: the type whitelist drops derivatives
 * and the key shape must agree with the type.
 */
function offshoreCandidateOf(row, market) {
  if (typeof row?.code !== 'string' || row.code.length === 0) return undefined
  if (!SMARTBOX_STOCK_TYPES.includes(row.type) && row.type !== SMARTBOX_INDEX_TYPE) return undefined
  const isIndex = row.type === SMARTBOX_INDEX_TYPE
  // Accept both index spellings; normalize to the bare code.
  const code = row.code.trim().toUpperCase().replace(/^\./u, '')
  const stem = isIndex
    ? (SMARTBOX_INDEX_CODE.test(code) ? code : undefined)
    : market === 'hk'
      ? fiveDigitHk(code)
      : (SMARTBOX_US_IDENTITY.test(code) ? code : undefined)
  if (stem === undefined) return undefined
  // US stock keys are the echoed identity; the other forms get our market marker.
  const thscode = market === 'us' && !isIndex ? stem : `${stem}.${market === 'hk' ? 'HK' : 'US'}`
  const assetType = market === 'hk' ? (isIndex ? 'hk-index' : 'hk-stock') : isIndex ? 'us-index' : 'us-stock'
  const entry = keyFormOf(thscode)
  // Shape and type must agree, or the row could be added but never quoted.
  if (entry === null || !entry.assetTypes.includes(assetType)) return undefined
  const name = typeof row.name === 'string' && row.name.length > 0 ? row.name : thscode
  return { thscode, ticker: stemOf(thscode), name, exchange: market === 'hk' ? 'HK' : 'US', asset_type: assetType }
}

function fiveDigitHk(code) {
  try {
    return normalizeHkCode(code, 'smartbox.code')
  } catch {
    return undefined
  }
}

/**
 * Never `Number(null)` (0): halted symbols would be written as a real flat quote.
 * Numeric strings are accepted like `matchesField`.
 */
function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function quoteOf(row, sourceTs, capturedAt, currency) {
  const price = numberValue(row.last_price)
  if (price === undefined) return undefined
  const pct = numberValue(row.price_change_ratio_pct)
  const quote = {
    price,
    // Missing change is missing, never 0: 0 is a real flat day for A-shares.
    change_pct: pct ?? null,
    captured_at: capturedAt,
    source_ts: typeof sourceTs === 'number' ? sourceTs : null,
  }
  // Fuyao snapshots carry no currency column; write `CNY` for stocks/ETFs only.
  if (currency !== undefined) quote.currency = currency
  return quote
}

/**
 * Offshore quote: `is_stale` becomes null; currency for stocks/ETFs only;
 * exchange-local time stays a raw string.
 */
function offshoreQuoteOf(row, capturedAt, { withCurrency }) {
  const price = numberValue(row.price)
  if (price === undefined) return undefined
  const stale = row.is_stale === true
  const pct = stale ? undefined : numberValue(row.change_pct)
  const quote = {
    price,
    change_pct: pct ?? null,
    captured_at: capturedAt,
    source_ts: null,
    source_time: typeof row.quote_time === 'string' ? row.quote_time : null,
  }
  const currency = withCurrency && typeof row.currency === 'string' ? row.currency.trim().toUpperCase() : ''
  if (currency.length > 0) quote.currency = currency
  return quote
}

/**
 * Domain, key resolution, base URL and clock are injected, so store / route /
 * network assertions avoid the real filesystem and network.
 */
export function createWatchlistService(options = {}) {
  const {
    openDomain,
    resolveApiKey = async () => undefined,
    credentialRef = () => DEFAULT_CREDENTIAL_REF,
    baseUrl = DEFAULT_FUYAO_BASE_URL,
    now = () => Date.now(),
    timeoutMs = SEARCH_TIMEOUT_MS,
    refreshBudgetMs,
  } = options

  let domainPromise
  /** Single gate for panel open and manual refresh: later callers share the in-flight run. */
  let refreshing = null

  /**
   * Never memoize a failed open: `storageDomain` may not be provided yet during
   * warm-up, and caching the rejection would disable the feature for the process.
   */
  const domain = () => {
    if (domainPromise === undefined) {
      const opening = Promise.resolve().then(() => openDomain())
      domainPromise = opening
      opening.catch(() => {
        if (domainPromise === opening) domainPromise = undefined
      })
    }
    return domainPromise
  }
  const table = async () => (await domain()).table('items')

  /**
   * Read-modify-write queue, in-process only; network stays outside it. Cross-process
   * writes are not locked, but per-key re-read on write-back limits the loss to one row.
   */
  let queue = Promise.resolve()
  function serialize(task) {
    const run = queue.then(task, task)
    // Swallow this link's rejection so one failure cannot block the queue.
    queue = run.then(() => {}, () => {})
    return run
  }

  async function ensureSeeded() {
    const opened = await domain()
    return serialize(async () => {
      const items = opened.table('items')
      if (opened.global.get().seeded_at !== 0 || items.size > 0) return
      const stamp = now()
      for (const seed of SEED_ITEMS) {
        await items.put(seed.thscode, { ...seed, added_at: stamp, source: 'seed', quote: null })
      }
      await opened.global.set({ seeded_at: stamp, schema: 1 })
    })
  }

  async function callFuyao(path, params, allowed) {
    const ref = credentialRef() || DEFAULT_CREDENTIAL_REF
    const apiKey = await resolveApiKey(ref)
    return fuyaoRequest({ baseUrl, apiKey, path, search: fuyaoQuery(params, allowed), signal: AbortSignal.timeout(timeoutMs) })
  }

  /**
   * Three branches in parallel: one Fuyao `ticker_search` plus smartbox `t=hk`
   * and `t=us` (they must not share `t=all`). Each branch fails independently;
   * only all three failing fails the panel, so HK/US work without a Fuyao key.
   */
  async function search(query) {
    const q = typeof query === 'string' ? query.trim() : ''
    if (q.length === 0 || q.length > MAX_QUERY_LENGTH) {
      return { ok: false, code: 'invalid_query', message: '输入为空或过长' }
    }
    // Touch storage before the network so an unavailable domain does not burn quota.
    const items = await table()
    // `t` has one source: an unknown value returns the `N` sentinel, i.e. a silent empty branch.
    const branches = await Promise.all([searchAShare(q), ...SMARTBOX_MARKETS.map((market) => searchOffshore(q, market))])
    const failures = branches.filter((branch) => branch.ok !== true)
    if (failures.length === branches.length) {
      // Only all-branch failure takes center stage; prefer the code the user can act on.
      const worst = worstProblem(failures)
      return { ok: false, code: worst.code, message: messageFor(worst.code, 'all'), scope: 'all' }
    }
    const merged = mergeCandidates(branches.filter((branch) => branch.ok === true).flatMap((branch) => branch.rows), q)
    const result = {
      ok: true,
      // No display slicing: the pool is bounded by upstream caps (50 + 10 + 10).
      items: merged.map((row) => ({ ...row, in_list: items.get(row.thscode) !== undefined })),
      // "More" is truthful only when a branch filled its own cap.
      truncated: branches.some((branch) => branch.ok === true && branch.saturated === true),
    }
    if (failures.length > 0) result.partial = failures.map((failure) => ({ market: failure.market, code: failure.code }))
    return result
  }

  /**
   * A-share branch. Fuyao `q` is case-sensitive, so query raw + uppercase when they
   * differ, raw first; rows count as answered once any candidate is found.
   */
  async function searchAShare(q) {
    const variants = [q, q.toUpperCase()].filter((value, index, all) => all.indexOf(value) === index)
    const limit = SEARCH_BRANCH_LIMITS['a-share']
    const outcomes = await Promise.all(variants.map(async (variant) => {
      try {
        const envelope = await callFuyao(ENDPOINTS.search, { q: variant, asset_type: SEARCH_ASSET_TYPES, limit }, ['q', 'asset_type', 'limit'])
        // Drop out-of-scope suffixes (e.g. `.TI` concept indices): the domain schema rejects them.
        const rows = fuyaoItems(envelope).map(candidateOf).filter((row) => ASSET_TYPES.includes(row.asset_type) && normalizeThscode(row.thscode) !== undefined)
        return { rows, saturated: rows.length >= limit, code: undefined }
      } catch (error) {
        return { rows: [], saturated: false, code: watchlistErrorCode(error) }
      }
    }))
    const union = []
    const seen = new Set()
    for (const outcome of outcomes) {
      for (const row of outcome.rows) {
        if (seen.has(row.thscode)) continue
        seen.add(row.thscode)
        union.push(row)
      }
    }
    const codes = outcomes.filter((outcome) => outcome.code !== undefined).map((outcome) => outcome.code)
    if (union.length === 0 && codes.length > 0) return { ok: false, market: 'a-share', code: worstErrorCode(codes) }
    // Union also caps at this branch's limit; our own slice still counts as saturated.
    const saturated = outcomes.some((outcome) => outcome.saturated) || union.length > limit
    return { ok: true, market: 'a-share', rows: union.slice(0, limit), saturated }
  }

  /** smartbox branch: type whitelist plus key shape; derivatives never reach candidates. */
  async function searchOffshore(q, market) {
    try {
      const found = await fetchSmartbox(q, market, AbortSignal.timeout(timeoutMs))
      const rows = found.map((row) => offshoreCandidateOf(row, market)).filter((row) => row !== undefined)
      return { ok: true, market, rows, saturated: rows.length >= SEARCH_BRANCH_LIMITS[market] }
    } catch (error) {
      return { ok: false, market, code: watchlistErrorCode(error, { source: 'tencent' }) }
    }
  }

  /** Dedupe by key; rows equal to the query (by stem) first, then stable upstream order. */
  function mergeCandidates(rows, q) {
    const seen = new Map()
    for (const row of rows) {
      if (row.thscode.length > 0 && !seen.has(row.thscode)) seen.set(row.thscode, row)
    }
    const needle = q.trim().toUpperCase()
    return [...seen.values()].sort((left, right) => exactness(right, needle) - exactness(left, needle))
  }
  function exactness(row, needle) {
    if (needle.length === 0) return 0
    if (row.thscode === needle) return 2
    return stemOf(row.thscode) === needle ? 1 : 0
  }

  /** Pick the most actionable code when every branch failed. */
  function worstErrorCode(codes) {
    for (const candidate of ['credential_missing', 'rate_limited', 'invalid_query', 'fuyao_unavailable', 'tencent_unavailable']) {
      if (codes.includes(candidate)) return candidate
    }
    return codes[0] ?? 'fuyao_unavailable'
  }

  async function list() {
    await ensureSeeded()
    const opened = await domain()
    // Limit travels in the response so client copy never duplicates the number.
    return { ok: true, items: rowsOf(opened.table('items')), seeded_at: opened.global.get().seeded_at, limit: MAX_ITEMS }
  }

  async function add(input) {
    await ensureSeeded()
    const items = await table()
    const full = () => ({ ok: false, code: 'list_full', limit: MAX_ITEMS, message: `自选股最多 ${MAX_ITEMS} 条，先删一条再加` })

    // Early exit avoids a search, but concurrency means the lock still re-checks.
    if (items.size >= MAX_ITEMS) return full()

    const direct = input?.thscode
    if (direct !== undefined && direct !== null && direct !== '') {
      const thscode = normalizeThscode(direct)
      if (thscode === undefined) {
        return { ok: false, code: 'invalid_query', message: '代码格式不符：要带市场或交易所后缀的完整代码，例如 300750.SZ / 00700.HK / HSI.HK / AAPL.OQ / IXIC.US' }
      }
      const entry = keyFormOf(thscode)
      // Existence check uses the upstream-accepted spelling: full code for A-shares,
      // stem for HK/US (canonical keys return the `N` sentinel).
      const found = await search(entry.form === 'a-share' ? thscode : stemOf(thscode))
      if (!found.ok) return found
      const hit = found.items.find((row) => row.thscode === thscode)
      if (hit === undefined) return { ok: false, code: 'not_found', message: `该标的不在本版支持范围（${FORM_SCOPE_TEXT[entry.form] ?? '可检索的证券代码'}）` }
      return serialize(() => {
        // Up to 15s of network passed: re-check the cap inside the lock.
        if (items.size >= MAX_ITEMS) return full()
        return write(hit, items)
      })
    }

    const found = await search(input?.q)
    if (!found.ok) return found
    if (found.items.length === 0) return { ok: false, code: 'not_found', message: '没有找到该标的' }
    if (found.items.length > 1) return { ok: false, code: 'ambiguous', message: '命中多条，请从候选里选一条', candidates: found.items }
    return serialize(() => {
      if (items.size >= MAX_ITEMS) return full()
      return write(found.items[0], items)
    })
  }

  async function write(candidate, items) {
    const existing = items.get(candidate.thscode)
    if (existing !== undefined) return { ok: true, item: existing, idempotent: true }
    const item = {
      thscode: candidate.thscode,
      ticker: candidate.ticker,
      name: candidate.name,
      exchange: candidate.exchange,
      asset_type: candidate.asset_type,
      added_at: now(),
      source: 'user',
      quote: null,
    }
    await items.put(item.thscode, item)
    return { ok: true, item }
  }

  async function remove(input) {
    await ensureSeeded()
    const items = await table()
    const thscode = normalizeThscode(input?.thscode)
    if (thscode === undefined) return { ok: false, code: 'invalid_query', message: '代码格式不符' }
    return serialize(async () => ({ ok: true, removed: await items.delete(thscode) }))
  }

  /**
   * Pin = timestamp; ordering belongs to `rowsOf` (no key moves, no table rewrite).
   */
  async function pin(input) {
    await ensureSeeded()
    const items = await table()
    const thscode = normalizeThscode(input?.thscode)
    if (thscode === undefined) return { ok: false, code: 'invalid_query', message: '代码格式不符' }
    // Read-modify-write inside the lock, or a concurrent delete gets resurrected.
    return serialize(async () => {
      const existing = items.get(thscode)
      if (existing === undefined) return { ok: false, code: 'not_found', message: '该标的不在自选清单里' }
      await items.put(thscode, { ...existing, pinned_at: now() })
      return { ok: true, items: rowsOf(items) }
    })
  }

  /**
   * Mark holding: empty weight stays `null`, never 0; `clearHolding` removes the
   * field. Gates: 0–100 weight, holdable type, total ceiling (unset weight adds no
   * exposure), all evaluated inside the lock after `not_found`.
   */
  async function markHolding(input) {
    await ensureSeeded()
    const items = await table()
    const thscode = normalizeThscode(input?.thscode)
    if (thscode === undefined) return { ok: false, code: 'invalid_query', message: '代码格式不符：要带市场或交易所后缀的完整代码' }
    const raw = input?.weight_pct
    let weight = null
    if (raw !== undefined && raw !== null && raw !== '') {
      const parsed = numberValue(raw)
      if (parsed === undefined || parsed < 0 || parsed > MAX_ROW_WEIGHT_PCT) {
        return { ok: false, code: 'invalid_query', message: `持仓比例要 0 到 ${MAX_ROW_WEIGHT_PCT} 之间的数字；留空表示只标记持仓、不填比例` }
      }
      weight = parsed
    }
    return serialize(async () => {
      const existing = items.get(thscode)
      if (existing === undefined) return { ok: false, code: 'not_found', message: '该标的不在自选清单里' }
      // Type gate after `not_found`; legacy holdings stay editable so they can be removed.
      if (existing.holding === undefined && !isHoldable(existing)) {
        return { ok: false, code: 'invalid_query', message: '这一条不是一个可以持有并配比率的标的（指数是市场读数，不是券），因此不能标记为持仓' }
      }
      // Ceiling also inside the lock: concurrent writes would otherwise each see room.
      if (weight !== null) {
        const rows = rowsOf(items)
        const ceiling = weightCeiling(rows, thscode)
        if (weight > ceiling) {
          return { ok: false, code: 'invalid_query', message: `其余持仓已合计 ${otherHeldWeightPct(rows, thscode)}%，这一格最多只能填 ${ceiling}%（只做多的组合合计不超过 ${MAX_TOTAL_WEIGHT_PCT}%）` }
        }
      }
      const item = { ...existing, holding: { weight_pct: weight, marked_at: now() } }
      await items.put(thscode, item)
      return { ok: true, item }
    })
  }

  /**
   * Clear by writing the record without `holding`; no delete/reinsert, so order is
   * preserved. Deliberately no type gate: legacy index holdings must be removable.
   */
  async function clearHolding(input) {
    await ensureSeeded()
    const items = await table()
    const thscode = normalizeThscode(input?.thscode)
    if (thscode === undefined) return { ok: false, code: 'invalid_query', message: '代码格式不符：要带市场或交易所后缀的完整代码' }
    return serialize(async () => {
      const existing = items.get(thscode)
      if (existing === undefined) return { ok: false, code: 'not_found', message: '该标的不在自选清单里' }
      const item = { ...existing }
      delete item.holding
      await items.put(thscode, item)
      return { ok: true, item }
    })
  }

  /** One group = one snapshot request (only ETF is per-symbol); group failure stays local. */
  function fetchGroup(group) {
    return group.kind === 'tencent' ? fetchOffshoreGroup(group) : fetchFuyaoGroup(group)
  }

  async function fetchFuyaoGroup(group) {
    const capturedAt = now()
    let envelope
    try {
      envelope = await callFuyao(group.path, group.params, group.allowed)
    } catch (error) {
      const code = watchlistErrorCode(error, { perItem: true })
      const batch = batchLevelCode(error)
      return {
        byCode: new Map(),
        failures: group.keys.map((thscode) => ({ thscode, code })),
        batchError: batch !== undefined ? { code: batch, scope: group.scope } : undefined,
      }
    }
    const sourceTs = fuyaoTimestamp(envelope)
    const byCode = new Map()
    for (const row of fuyaoItems(envelope)) {
      const thscode = typeof row.thscode === 'string' ? row.thscode : ''
      const quote = quoteOf(row, sourceTs, capturedAt, group.currency)
      if (thscode !== '' && quote !== undefined) byCode.set(thscode, quote)
    }
    return {
      byCode,
      failures: group.keys.filter((thscode) => !byCode.has(thscode)).map((thscode) => ({ thscode, code: 'quote_unavailable' })),
      batchError: undefined,
    }
  }

  /**
   * One batch per offshore family. The core supplies quotes and guards; this layer
   * only ensures the returned key is exactly the one requested.
   */
  async function fetchOffshoreGroup(group) {
    const capturedAt = now()
    let rows
    try {
      const signal = AbortSignal.timeout(timeoutMs)
      rows = group.index ? await fetchOffshoreIndexQuotes(group.market, group.codes, signal) : await fetchOffshoreQuotes(group.market, group.codes, signal)
    } catch (error) {
      const batch = batchLevelCode(error, 'tencent')
      return {
        byCode: new Map(),
        failures: group.keys.map((thscode) => ({ thscode, code: watchlistErrorCode(error, { perItem: true, source: 'tencent' }) })),
        batchError: batch !== undefined ? { code: batch, scope: group.scope } : undefined,
      }
    }
    const requested = new Set(group.keys)
    const byCode = new Map()
    for (const row of rows) {
      const thscode = offshoreKeyOf(row, group)
      if (!requested.has(thscode)) continue
      const quote = offshoreQuoteOf(row, capturedAt, { withCurrency: group.withCurrency })
      if (quote !== undefined) byCode.set(thscode, quote)
    }
    return {
      byCode,
      failures: group.keys.filter((thscode) => !byCode.has(thscode)).map((thscode) => ({ thscode, code: 'quote_unavailable' })),
      batchError: undefined,
    }
  }

  /**
   * Single gate for panel open, manual refresh and post-add refresh; reset on the
   * same settle chain, or the next click returns the previous run.
   */
  function refresh() {
    if (refreshing !== null) return refreshing
    const running = doRefresh().finally(() => {
      if (refreshing === running) refreshing = null
    })
    refreshing = running
    return running
  }

  async function doRefresh() {
    await ensureSeeded()
    const opened = await domain()
    const items = opened.table('items')
    // Snapshot only decides which codes to ask for; write-back re-reads per key.
    const batch = rowsOf(items)
    if (batch.length === 0) return { ok: true, items: [], refreshed_at: null, failures: [] }

    // Seven groups dispatch on key shape + asset_type; disagreement stays `quote_unavailable`.
    const groups = []
    const failures = []
    const keysByType = new Map()
    for (const row of batch) {
      if (quoteRoute(row) === undefined) {
        failures.push({ thscode: row.thscode, code: 'quote_unavailable' })
        continue
      }
      const list = keysByType.get(row.asset_type)
      if (list === undefined) keysByType.set(row.asset_type, [row.thscode])
      else list.push(row.thscode)
    }
    for (const [assetType, template] of FUYAO_TEMPLATES) {
      const keys = keysByType.get(assetType) ?? []
      if (keys.length === 0) continue
      if (!template.batch) {
        for (const thscode of keys) groups.push({ kind: 'fuyao', path: template.path, allowed: template.allowed, params: { thscode }, keys: [thscode], scope: template.scope, currency: template.currency })
      } else {
        groups.push({ kind: 'fuyao', path: template.path, allowed: template.allowed, params: { thscodes: keys.join(',') }, keys, scope: template.scope, currency: template.currency })
      }
    }
    for (const spec of OFFSHORE_SPECS) {
      const keys = keysByType.get(spec.assetType) ?? []
      if (keys.length === 0) continue
      const { group, failures: unwritable } = offshoreGroup(spec, keys)
      for (const failure of unwritable) failures.push(failure)
      if (group !== undefined) groups.push(group)
    }

    const budgetMs = refreshBudgetMs ?? refreshBudgetFor(batch.length)
    const startedAt = now()
    const results = new Array(groups.length)
    // `cursor` increments atomically on one thread: each worker gets an exclusive group.
    let cursor = 0
    const worker = async () => {
      for (;;) {
        const index = cursor
        cursor += 1
        if (index >= groups.length) return
        // Group 0 always runs; later groups check the budget before being asked.
        if (index > 0 && now() - startedAt >= budgetMs) return
        results[index] = await fetchGroup(groups[index])
      }
    }
    await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, groups.length) }, () => worker()))

    // Merge by group order, not completion order: failures order is part of the contract.
    const quotes = new Map()
    const problems = []
    let failedGroups = 0
    for (let index = 0; index < groups.length; index += 1) {
      const result = results[index]
      if (result === undefined) {
        for (const thscode of groups[index].keys) failures.push({ thscode, code: 'refresh_timeout' })
        continue
      }
      for (const [thscode, quote] of result.byCode) quotes.set(thscode, quote)
      for (const failure of result.failures) failures.push(failure)
      if (result.batchError !== undefined) {
        failedGroups += 1
        problems.push(result.batchError)
      }
    }

    // Write-back re-reads each key; a batch overwrite would undo in-flight deletes and pins.
    const written = await serialize(async () => {
      let count = 0
      for (const [thscode, quote] of quotes) {
        const fresh = items.get(thscode)
        if (fresh === undefined) continue // Deleted in flight: do not resurrect or take a slot.
        await items.put(thscode, { ...fresh, quote })
        count += 1
      }
      return { count, items: rowsOf(items) }
    })
    // Nothing landed = no "refreshed at" timestamp: the footer tracks the last real success.
    const result = { ok: true, items: written.items, refreshed_at: written.count > 0 ? now() : null, failures }
    // `scope: 'all'` only when every group failed; half-failure must not claim "service down".
    if (problems.length > 0) {
      const worst = worstProblem(problems)
      const scope = failedGroups === groups.length && groups.length > 0 ? 'all' : worst.scope
      result.error = { code: worst.code, message: messageFor(worst.code, scope), scope }
    }
    return result
  }

  return {
    list,
    search,
    add,
    remove,
    pin,
    markHolding,
    clearHolding,
    refresh,
    async close() {
      const opened = await domainPromise
      domainPromise = undefined
      if (opened?.close !== undefined) await opened.close()
    },
  }
}

/** Only whole-batch failures become batch errors (rate limit, missing key, service down). */
function batchLevelCode(error, source = 'fuyao') {
  const code = watchlistErrorCode(error, { source })
  return ['credential_missing', 'rate_limited', 'fuyao_unavailable', 'tencent_unavailable'].includes(code) ? code : undefined
}

/** Most actionable problem wins: missing key, then rate limit, then service down. */
const ERROR_CODE_PRIORITY = ['credential_missing', 'rate_limited', 'invalid_query', 'fuyao_unavailable', 'tencent_unavailable']
function worstProblem(problems) {
  for (const code of ERROR_CODE_PRIORITY) {
    const found = problems.find((problem) => problem.code === code)
    if (found !== undefined) return found
  }
  return problems[0]
}

/** Error code → user copy; `scope` only decides whether to name the failing branch. */
function messageFor(code, scope) {
  if (code === 'credential_missing') return '未配置 Fuyao 密钥：在「插件」页的 自动模式卡片里填 API Key（只影响 A 股那一路，港美股照常用）'
  if (code === 'rate_limited') return '行情服务限流，请稍后再试'
  if (code === 'invalid_query') return '输入不被接受'
  if (code === 'tencent_unavailable') return scope === 'a-share' ? '行情服务暂时不可用，请稍后再试' : '港美股行情暂时取不到，请稍后再试'
  return '行情服务暂时不可用，请稍后再试'
}

/** Read the configured Fuyao ref from `capital-config`; falls back to the default name. */
export function readCredentialRef(ctx) {
  try {
    const settings = ctx.get('settings')
    const value = settings?.describe?.().find((entry) => entry.ns === CAPITAL_CONFIG_ENTRY_ID)?.value
    const ref = value?.fuyaoCredentialRef
    return typeof ref === 'string' && ref.trim().length > 0 ? ref.trim() : DEFAULT_CREDENTIAL_REF
  } catch {
    return DEFAULT_CREDENTIAL_REF
  }
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

const FAILURE_STATUS = {
  invalid_query: 400,
  not_found: 404,
  ambiguous: 409,
  list_full: 409,
  credential_missing: 503,
  rate_limited: 429,
  fuyao_unavailable: 502,
  tencent_unavailable: 502,
  store_unavailable: 503,
}

/**
 * GET uses query params, POST a JSON body. `authorize` is
 * `connection.requestRejection` and runs before any service call.
 */
export function createRouteHandler(service, options = {}) {
  const { authorize } = options

  return async function handler(req, res) {
    if (typeof authorize === 'function') {
      let rejection
      try {
        rejection = authorize(req)
      } catch {
        rejection = 401
      }
      if (rejection !== undefined && rejection !== null) {
        res.statusCode = rejection
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
    }

    const method = req?.method ?? 'GET'
    if (method !== 'GET' && method !== 'POST') {
      send(res, 405, { ok: false, code: 'method_not_allowed', message: '只支持 GET / POST' })
      return
    }

    let pathname
    let searchParams
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      pathname = url.pathname.slice(ROUTE_PATH.length)
      searchParams = url.searchParams
    } catch {
      send(res, 400, { ok: false, code: 'invalid_query', message: 'bad request' })
      return
    }

    let input = {}
    if (method === 'POST') {
      try {
        input = await readBody(req)
      } catch {
        send(res, 400, { ok: false, code: 'invalid_query', message: '请求体不是合法 JSON' })
        return
      }
    }

    try {
      if (method === 'POST' && pathname === '/add') return sendBusiness(res, await service.add(input))
      if (method === 'POST' && pathname === '/remove') return sendBusiness(res, await service.remove(input))
      if (method === 'POST' && pathname === '/pin') return sendBusiness(res, await service.pin(input))
      if (method === 'POST' && pathname === '/holding') {
        // One route for mark and clear: the panel has one concept, split only by `clear`.
        const next = input?.clear === true ? service.clearHolding(input) : service.markHolding(input)
        return sendBusiness(res, await next)
      }
      if (method === 'POST' && pathname === '/refresh') {
        // Refresh is "partial success + per-row failures": always 200 with items and error.
        return send(res, 200, await service.refresh())
      }
      if (method === 'GET' && pathname === '/list') return send(res, 200, await service.list())
      if (method === 'GET' && pathname === '/search') return sendBusiness(res, await service.search(searchParams.get('q') ?? ''))
      send(res, 404, { ok: false, code: 'not_found', message: 'unknown watchlist route' })
    } catch (error) {
      send(res, 503, { ok: false, code: 'store_unavailable', message: '自选股存储不可用', cause: storeCause(error) })
    }
  }
}

/** Storage failure copy keeps both code (locatable) and message (human-readable). */
function storeCause(error) {
  return [error?.code, error?.message ?? error].filter(Boolean).join('：') || 'unknown'
}

function sendBusiness(res, result) {
  if (result.ok === true) return send(res, 200, result)
  return send(res, FAILURE_STATUS[result.code] ?? 400, result)
}

export function apply(ctx) {
  const service = createWatchlistService({
    openDomain: () => {
      let storage
      try {
        storage = ctx.get('storageDomain')
      } catch {
        storage = undefined
      }
      if (storage?.open === undefined) throw new Error('storageDomain facility is not mounted')
      return storage.open(domainSpec)
    },
    credentialRef: () => readCredentialRef(ctx),
    resolveApiKey: async (ref) => {
      const credentials = ctx.get('credentials')
      if (credentials?.resolve !== undefined) {
        const resolved = await credentials.resolve(ref)
        if (resolved?.value) return resolved.value
      }
      return globalThis.process?.env?.[ref]
    },
  })

  ctx.provide('capitalWatchlist', service)

  // Warm-up logs domain failures only; no latch — each route retries and reports loudly.
  service.list().catch((error) => {
    ctx.logger?.error?.(`capital-watchlist: 域预热失败，下一次动作会重试（${storeCause(error)}）`)
  })

  /**
   * Resolve `connection` lazily; absent = no auth plane, throwing = fail closed 401.
   */
  const authorize = (req) => {
    let connection
    try {
      connection = ctx.get('connection')
    } catch {
      return 401
    }
    if (connection === undefined || connection === null) return undefined
    if (typeof connection.requestRejection !== 'function') return undefined
    return connection.requestRejection(req)
  }

  const registerRoute = (webCtx) => {
    webCtx.effect(
      () => {
        const dispose = webCtx.webServer.register({
          kind: 'prefix',
          path: ROUTE_PATH,
          handler: createRouteHandler(service, { authorize }),
        })
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      },
      'capital-watchlist: route',
    )
  }
  // Only via inject: a resolved `ctx.get('webServer')` does not make `ctx.webServer` legal.
  ctx.inject(['webServer'], registerRoute)

  // The domain is ours to close; a duplicate open of the same name reports already-open.
  ctx.effect(() => () => {
    service.close().catch(() => {})
  }, 'capital-watchlist: domain')

  ctx.logger?.info?.('capital-watchlist: 自选股服务与 /capital-watchlist 路由已挂载')
}
