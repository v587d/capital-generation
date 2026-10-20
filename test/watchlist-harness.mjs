/**
 * Shared watchlist fixtures (not a *.test.mjs file, so `node --test` skips it). Fakes must match real
 * shapes: KvTable has no `values()`, `update` throws `missing-key`, writes pass the domain item schema.
 * `stubFuyao` serves both upstreams (Fuyao A-share + Tencent HK/US) and defaults to "healthy route,
 * instrument absent" (`N` sentinel / `v_pv_none_match`); bodies copy measured response shapes.
 */
import { domainSpec } from '../watchlist/index.js'
import { SMARTBOX_ROWS, tencentSnapshotText } from './tencent-fixtures.mjs'

export { SMARTBOX_ROWS, tencentSnapshotText } from './tencent-fixtures.mjs'

export function createFakeDomain() {
  const records = new Map()
  let globalValue = { ...domainSpec.global.initial }
  const itemSchema = domainSpec.tables.items.valueSchema

  const table = {
    get(key) {
      return records.get(key)
    },
    *entries() {
      for (const [key, value] of records) yield [key, value]
    },
    *keys() {
      yield* records.keys()
    },
    get size() {
      return records.size
    },
    async put(key, value) {
      // The real domain validates at the write boundary: bad records must fail loudly here.
      itemSchema.parse(value)
      records.set(key, value)
    },
    async delete(key) {
      return records.delete(key)
    },
    async update(key, fn) {
      if (!records.has(key)) throw new Error('missing-key')
      const next = fn(records.get(key))
      itemSchema.parse(next)
      records.set(key, next)
      return next
    },
  }

  let closed = 0
  const domain = {
    name: domainSpec.name,
    table: () => table,
    global: {
      get: () => globalValue,
      set: async (value) => { globalValue = value },
    },
    close: async () => { closed += 1 },
  }

  return {
    domain,
    table,
    records,
    get closed() { return closed },
    seededAt: () => globalValue.seeded_at,
  }
}

/** Real response samples: search hits, index snapshot, A-share snapshot, single-ETF snapshot. */
export const FIXTURES = {
  searchCatl: {
    code: 0,
    message: 'success',
    request_id: 'req-1',
    data: { timestamp: 1790582420922, item: [{ thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', currency: 'CNY' }] },
  },
  searchMany: {
    code: 0,
    message: 'success',
    request_id: 'req-2',
    data: {
      timestamp: 1790582420904,
      item: [
        { thscode: '159300.SZ', ticker: '159300', name: '沪深300ETF富国', exchange: 'SZ', asset_type: 'fund-etf' },
        { thscode: '159330.SZ', ticker: '159330', name: '沪深300ETF东财', exchange: 'SZ', asset_type: 'fund-etf' },
      ],
    },
  },
  searchOtcFund: {
    code: 0,
    data: { timestamp: 1, item: [{ thscode: '012414.OF', ticker: '012414', name: '某场外基金', exchange: null, asset_type: 'fund-otc' }] },
  },
  indexSnapshot: {
    code: 0,
    data: {
      timestamp: 1790586409000,
      item: [
        { thscode: '000001.SH', ticker: '1A0001', last_price: 3823.62, price_change: -64.75, price_change_ratio_pct: -1.665222, prev_price: 3888.37 },
        { thscode: '399001.SZ', ticker: '399001', last_price: 12858.7532, price_change_ratio_pct: -3.440841, prev_price: 13316.9689 },
        { thscode: '399006.SZ', ticker: '399006', last_price: 3139.8249, price_change_ratio_pct: -4.534055, prev_price: 3288.9476 },
        { thscode: '000300.SH', ticker: '1B0300', last_price: 4340.76, price_change_ratio_pct: -2.216195, prev_price: 4439.14 },
      ],
    },
  },
  stockSnapshot: {
    code: 0,
    data: {
      timestamp: 1790586416000,
      item: [
        { thscode: '300750.SZ', ticker: '300750', last_price: 291.99, price_change_ratio_pct: -0.51448, prev_price: 293.5 },
        { thscode: '600519.SH', ticker: '600519', last_price: 1243.88, price_change_ratio_pct: 0.556184, prev_price: 1237 },
      ],
    },
  },
  fundSnapshot: {
    code: 0,
    data: { timestamp: 1790586418000, item: [{ thscode: '510300.SH', ticker: '510300', last_price: 4.417, price_change_ratio_pct: -2.170543, prev_price: 4.515 }] },
  },
  /** The ETF endpoint rejects comma-separated codes: per-item fan-out is forced, not conservative. */
  fundBatchRejected: { code: 1002, message: 'Invalid parameter format: thscode (only one code per request)', data: null },
  rateLimited: { code: 4001, message: '请求频率超限', data: null },
  noData: { code: 0, data: { timestamp: null, item: [] } },
}

/** One input fans out to three routes: Fuyao plus smartbox `t=hk` and `t=us`. */
export function upstreamCalls(calls, needle) {
  return calls.filter((call) => call.url.includes(needle))
}

/**
 * Routes fixtures by URL and records every outbound call (request-parameter and call-count assertions
 * rely on this log). `overrides` matches a URL substring, values may be `(url) => payload`; Tencent
 * overrides are text bodies, Fuyao ones are JSON envelopes.
 */
export function stubFuyao(overrides = {}) {
  const calls = []
  const previous = globalThis.fetch
  const overrideFor = (url) => {
    for (const [needle, payload] of Object.entries(overrides)) {
      if (url.includes(needle)) return typeof payload === 'function' ? payload(url) : payload
    }
    return undefined
  }
  const routeTencent = (url) => {
    if (url.includes('smartbox.gtimg.cn')) {
      const market = /[?&]t=([^&]+)/.exec(url)?.[1] ?? ''
      const query = decodeURIComponent(/[?&]q=([^&]*)/.exec(url)?.[1] ?? '')
      return SMARTBOX_ROWS[`${market}|${query}`] ?? 'v_hint="N";'
    }
    // The snapshot query string is path-shaped (`QUOTE_URL` carries `q=`), so `[?&]` would find nothing.
    const symbols = (/q=([^&]*)/u.exec(url)?.[1] ?? '').split(',').filter(Boolean)
    return tencentSnapshotText(symbols)
  }
  const route = (url) => {
    if (url.includes('/api/meta/tickers/search')) {
      const requested = /[?&]q=([^&]+)/.exec(url)?.[1] ?? ''
      const decoded = decodeURIComponent(requested)
      // Exact-code lookup (what `add({thscode})` does): echo only codes the upstream really has, or not_found never runs.
      if (/^\d{6}\.(SH|SZ)$/.test(decoded)) {
        // Codes with a real fixture win, so "query with suffix" and "query by name" return the same row.
        if (decoded === '300750.SZ') return FIXTURES.searchCatl
        const known = /^[1569]/.test(decoded) || /^30/.test(decoded)
        if (!known) return FIXTURES.noData
        return { code: 0, data: { timestamp: 1790582420922, item: [{ thscode: decoded, ticker: decoded.slice(0, 6), name: `标的${decoded.slice(0, 6)}`, exchange: decoded.slice(-2), asset_type: /^[15]/.test(decoded) ? 'fund-etf' : 'a-share' }] } }
      }
      if (decoded === '300750' || decoded === '宁德时代') return FIXTURES.searchCatl
      if (decoded === 'ETF') return FIXTURES.searchMany
      if (decoded === 'OTC') return FIXTURES.searchOtcFund
      return FIXTURES.noData
    }
    if (url.includes('/api/a-share-index/prices/snapshot')) return FIXTURES.indexSnapshot
    if (url.includes('/api/a-share/prices/snapshot')) return FIXTURES.stockSnapshot
    if (url.includes('/api/fund/market/snapshot')) {
      if (url.includes('thscodes=')) return FIXTURES.fundBatchRejected
      // Single-code endpoint: echo the requested code back (prices use the measured 510300 values).
      const requested = /[?&]thscode=([^&]+)/.exec(url)?.[1] ?? '510300.SH'
      return { code: 0, data: { timestamp: 1790586418000, item: [{ thscode: requested, ticker: requested.slice(0, 6), last_price: 4.417, price_change: -0.098, price_change_ratio_pct: -2.170543, prev_price: 4.515 }] } }
    }
    return { code: 0, data: { timestamp: null, item: [] } }
  }
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url)
    calls.push({ url: text, headers: init.headers, signal: init.signal })
    const tencent = text.includes('gtimg.cn')
    const payload = overrideFor(text) ?? (tencent ? routeTencent(text) : route(text))
    const status = payload?.status ?? 200
    if (!tencent) {
      if (status !== 200) return { ok: false, status, json: async () => payload.body ?? {} }
      return { ok: true, status, json: async () => payload }
    }
    // Both Tencent routes answer text: the fixture bodies are ASCII, so UTF-8 bytes equal GBK bytes here.
    const bytes = Buffer.from(String(payload), 'utf-8')
    return {
      ok: true,
      status,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => String(payload),
    }
  }
  return {
    calls,
    restore() {
      globalThis.fetch = previous
    },
  }
}

/** Minimal fake cordis context: enough for `readCredentialRef` resolution (no effect factories). */
export function fakeCtx(entries = {}) {
  const services = new Map(Object.entries(entries))
  const ctx = {
    get: (name) => services.get(name),
    inject: (names, callback) => callback(ctx),
    provide: (name, value) => { services.set(name, value) },
    effect: () => undefined,
    logger: { info: () => {}, error: () => {} },
    services,
  }
  return ctx
}

/** Fake req/res for one HTTP round trip. */
export function httpFixture({ method = 'GET', url = '/', body, headers = {} }) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]
  const req = {
    method,
    url,
    headers,
    [Symbol.asyncIterator]: async function* iterate() {
      for (const chunk of chunks) yield chunk
    },
  }
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    end(payload) { this.body = payload ?? '' },
    json() { return JSON.parse(this.body) },
  }
  return { req, res }
}

/** Holdable rows: `markHolding` admits stocks and exchange-traded funds only, not the seeded index rows. */
export const HOLDABLE_ROWS = [
  { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share' },
  { thscode: '600519.SH', ticker: '600519', name: '贵州茅台', exchange: 'SH', asset_type: 'a-share' },
  { thscode: '510300.SH', ticker: '510300', name: '沪深300ETF', exchange: 'SH', asset_type: 'fund-etf' },
  { thscode: '00700.HK', ticker: '00700', name: '腾讯控股', exchange: 'HK', asset_type: 'hk-stock' },
  { thscode: 'AAPL.OQ', ticker: 'AAPL', name: '苹果', exchange: 'US', asset_type: 'us-stock' },
]

// Reads the list once so seeding lands, then inserts the holdable rows through the domain write boundary.
export async function withHoldable(instance, fake, addedAt = 1_790_586_000_000) {
  await instance.list()
  for (const row of HOLDABLE_ROWS) {
    await fake.table.put(row.thscode, { ...row, added_at: addedAt, source: 'user', quote: null })
  }
  return HOLDABLE_ROWS.map((row) => row.thscode)
}
