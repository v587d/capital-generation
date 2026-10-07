/**
 * 自选股测试的共用夹具（不是 *.test.mjs，`node --test` 不会把它当用例）。
 *
 * 三件事必须仿真到位，否则断言只会证明"代码和自己造的假件一致"：
 *  1. **KvTable 的真实面**：只有 `get/entries/keys/size/put/delete/update`，**没有 `values()`**；
 *     `update` 对缺失键抛 `missing-key`；写入要过域 schema（真域在持久边界逐条校验）。
 *  2. **Fuyao 的真报文形态**：下面的 fixture 抄自 2026-09-28 实测响应（含 ETF 批量被
 *     `code=1002 (only one code per request)` 拒绝那条），不是按想象造的字段。
 *  3. **腾讯公开端点的真回包形态**（2026-10-07 实测）：smartbox 逐字照抄（含 `N` 哨兵与
 *     `\uXXXX` 转义），快照按实测列位填数（名称用 ASCII——GBK 解码由 `tencent-source.test.mjs`
 *     与真机冒烟覆盖，位序错了这里也一样会红）。
 *
 * `stubFuyao` 现在挡的是**两路上游**（A 股 Fuyao + 港美股腾讯）：自选股一次搜索要打三笔，
 * 只 stub 一家等于让单测碰真网络。默认回"上游正常但这一路没有这个票"（smartbox 的 `N` 哨兵、
 * 快照的 `v_pv_none_match`），要港美股候选或报价的用例自己传 fixture。
 */
import { domainSpec } from '../capital-watchlist/index.js'
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
      // 真域在写入边界校验：坏记录在这里就该响亮失败，而不是静默写进盘。
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

/** 真报文样本（2026-09-28）：搜索命中、指数快照、A 股快照、ETF 单只快照。 */
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
  /** 实测：ETF 端点传逗号多值直接被拒（逐只扇出因此是硬约束，不是保守选择）。 */
  fundBatchRejected: { code: 1002, message: 'Invalid parameter format: thscode (only one code per request)', data: null },
  rateLimited: { code: 4001, message: '请求频率超限', data: null },
  noData: { code: 0, data: { timestamp: null, item: [] } },
}

/** 一次输入三路并发：Fuyao 一笔 + smartbox `t=hk` / `t=us` 各一笔（见 `search` 的注释）。 */
export function upstreamCalls(calls, needle) {
  return calls.filter((call) => call.url.includes(needle))
}

/**
 * 按 URL 分派 fixture，并把每次出网都记下来（断言"参数里必须带白名单与 limit"
 * 与"刷新只发生了一次"都靠这份记录）。
 *
 * @param overrides - `{ 'api/a-share/prices/snapshot': payload | (() => payload) }` 形式的定制；
 *   键撞不中就走默认路由。腾讯那两家的值是**文本**（不是 JSON 信封），函数形态收 `(url) => text`。
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
    // 快照的查询串是 `…/q=hk00700,hkHSI` 这种**路径形态**（`QUOTE_URL` 自己就带着 `q=`），
    // 用 `[?&]` 找它会一条都找不到。
    const symbols = (/q=([^&]*)/u.exec(url)?.[1] ?? '').split(',').filter(Boolean)
    return tencentSnapshotText(symbols)
  }
  const route = (url) => {
    if (url.includes('/api/meta/tickers/search')) {
      const requested = /[?&]q=([^&]+)/.exec(url)?.[1] ?? ''
      const decoded = decodeURIComponent(requested)
      // 按代码精确回查（`add({thscode})` 的实现就是这条路）：只回显"上游真有"的代码，
      // 否则 not_found 分支永远测不到。
      if (/^\d{6}\.(SH|SZ)$/.test(decoded)) {
        // 有真报文的代码优先用真报文（否则"带后缀查"和"按名字查"会拿到两条不同的假数据）
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
      // 单只端点：按请求代码回显同一只（真报文形态，价格用 510300 的实测值）
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
    // 腾讯这两条都是**文本**响应：快照要 GBK 解，smartbox 全 ASCII（名称是 `\uXXXX` 字面转义）。
    // 夹具的正文是 ASCII，UTF-8 字节与 GBK 字节逐位相同，所以这里不必真造一份 GBK 编码。
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

/** 最小 fake cordis 上下文：够 `readCredentialRef` 的解析路径用（不跑 effect 工厂）。 */
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

/** 一次 HTTP 往返的 fake req/res。 */
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
