/**
 * 报价出网的分流、并发收口与"同一份实现"探针。
 *
 * 这个文件里最重要的用例是最后两条：
 *  - **模块同一性**：host 半边必须与插件侧用同一个 `fuyao-core` 实例。真出现第二份，
 *    症状不是报错，而是 `instanceof` 静默失效、错误归类一律退化成 `fuyao_unavailable`
 *    ——正是 AGENTS.md §9.7 那两次事故的同族。
 *  - **credential ref 从卡片读**：主插件按 `capital-config` 的 `fuyaoCredentialRef` 解析 key
 *    （`src/index.ts:397`），host 半边写死 `FUYAO_API_KEY` 的话，用户改过卡片后 Agent 照常
 *    取数、面板永远失败。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_FUYAO_BASE_URL, FuyaoError } from '../lib/sources/fuyao-core.js'
import { MAX_ITEMS, REFRESH_CONCURRENCY, SEED_ITEMS, createWatchlistService, readCredentialRef, refreshBudgetFor, watchlistErrorCode } from '../capital-watchlist/index.js'
import { createFakeDomain, fakeCtx, stubFuyao } from './watchlist-harness.mjs'

const ETF_CODES = ['510300.SH', '159915.SZ', '588000.SH']

async function withList(service, extra = []) {
  await service.list()
  for (const item of extra) await service.add({ thscode: item })
}

test('按 asset_type 分流：A 股一次批量、指数一次批量、ETF 逐只', async () => {
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => 1 })
  try {
    await withList(service, ['300750.SZ', '600519.SH', ...ETF_CODES])
    const result = await service.refresh()
    const snapshotCalls = stub.calls.filter((call) => call.url.includes('/prices/snapshot') || call.url.includes('/fund/market/snapshot'))
    const byPath = (needle) => snapshotCalls.filter((call) => call.url.includes(needle))

    assert.equal(byPath('/api/a-share-index/prices/snapshot').length, 1, '指数一次批量')
    assert.equal(byPath('/api/a-share/prices/snapshot').length, 1, 'A 股一次批量')
    assert.equal(byPath('/api/fund/market/snapshot').length, ETF_CODES.length, 'ETF 上游只接受单只 ⇒ 逐只扇出')
    assert.ok(byPath('/api/fund/market/snapshot').every((call) => !call.url.includes('thscodes=')), '不许把 thscodes 塞给基金端点')
    assert.deepEqual(result.failures, [])
    assert.equal(result.items.find((item) => item.thscode === '510300.SH').quote.price, 4.417)
  } finally {
    stub.restore()
  }
})

test(`扇出的两道界：一次刷新的请求个数不超过清单上限 ${MAX_ITEMS}，同时在途不超过 ${REFRESH_CONCURRENCY}`, async () => {
  // 上限抬到 30 之后，"扇出多少"由两件事界住：请求个数 = 清单条数（上限就是配额上界），
  // 以及在途并发数——后者决定「刷新中…」最坏挂多久，不许无界放出去把同花顺打限流。
  const stub = stubFuyao()
  const outer = globalThis.fetch
  let inFlight = 0
  let peak = 0
  globalThis.fetch = async (url, init) => {
    inFlight += 1
    if (inFlight > peak) peak = inFlight
    try {
      return await outer(url, init)
    } finally {
      inFlight -= 1
    }
  }
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => 1 })
  try {
    await service.list()
    for (const seed of SEED_ITEMS) await service.remove({ thscode: seed.thscode })
    const etfs = Array.from({ length: MAX_ITEMS }, (_, index) => `5${String(10000 + index)}.SH`)
    for (const thscode of etfs) assert.equal((await service.add({ thscode })).ok, true, `${thscode} 应当进得来`)
    stub.calls.length = 0

    const result = await service.refresh()
    const outbound = stub.calls.filter((call) => !call.url.includes('/tickers/search'))
    assert.equal(outbound.length, MAX_ITEMS, `30 只全 ETF 就是 ${MAX_ITEMS} 个单只请求，一个都不能多`)
    assert.equal(peak, REFRESH_CONCURRENCY, `同时在途必须正好是并发上界 ${REFRESH_CONCURRENCY}（时钟冻结，所以这一条是确定性的）`)
    assert.deepEqual(result.failures, [])
    assert.equal(result.items.length, MAX_ITEMS)
  } finally {
    globalThis.fetch = outer
    stub.restore()
  }
})

test('刷新总预算随条数走：10 条仍是 45 秒（与 2.5.2 同档），30 条封顶 90 秒', () => {
  // 抬上限不许把小清单一起拖长：下界保 45 秒，10 条这一档的算式结果与旧常量完全相等。
  assert.equal(refreshBudgetFor(1), 45_000)
  assert.equal(refreshBudgetFor(10), 45_000, '20s + 2.5s×10 = 45s —— 与 2.5.2 的写死值同档')
  assert.equal(refreshBudgetFor(20), 70_000)
  assert.equal(refreshBudgetFor(MAX_ITEMS), 90_000)
  assert.equal(refreshBudgetFor(MAX_ITEMS * 10), 90_000, '上界必须真的存在：预算不许随条数无界放大')
})

test('单只失败只记那一行，其它标的照样拿到新快照', async () => {
  const stub = stubFuyao({
    '/api/fund/market/snapshot': (url) => (url.includes('thscode=159915.SZ') ? { code: 0, data: { timestamp: null, item: [] } } : (url.includes('thscode=588000.SH') ? { code: 0, data: { timestamp: null, item: [{ thscode: '588000.SH', last_price: 'not-a-number' }] } } : FIXTURE_FUND)),
  })
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => 1 })
  try {
    await withList(service, ETF_CODES)
    const result = await service.refresh()
    const codes = result.failures.map((item) => item.code)
    assert.deepEqual(result.failures.map((item) => item.thscode).sort(), ['159915.SZ', '588000.SH'])
    assert.ok(codes.every((code) => code === 'quote_unavailable'))
    assert.equal(result.error, undefined, '单只缺口不许升格成整批失败')
    assert.equal(result.items.find((item) => item.thscode === '510300.SH').quote.price, 4.417)
    assert.equal(result.items.find((item) => item.thscode === '159915.SZ').quote, null, '缺口就明说是缺口')
  } finally {
    stub.restore()
  }
})

test('限流（4001）映射 rate_limited 且不立即重试；已成功的快照保留', async () => {
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => 1 })
  try {
    const first = await service.refresh()
    assert.equal(first.error, undefined)
    assert.equal(first.items[0].quote.price, 3823.62)

    stub.calls.length = 0
    const limited = stubFuyao({ '/api/a-share-index/prices/snapshot': { code: 4001, message: '请求频率超限', data: null } })
    try {
      const second = await service.refresh()
      assert.equal(second.error.code, 'rate_limited')
      assert.equal(limited.calls.length, 1, '一次失败就是失败，不许偷偷重试')
      assert.equal(second.items[0].quote.price, 3823.62, '限流时列表里仍是上一次成功快照')
    } finally {
      limited.restore()
    }
  } finally {
    stub.restore()
  }
})

test('同一时刻只有一个 in-flight：并发 refresh 共用一个闸门', async () => {
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => 1 })
  try {
    const [a, b] = await Promise.all([service.refresh(), service.refresh()])
    assert.equal(stub.calls.length, 1, '开面板与点刷新同时发生也只出网一次')
    assert.equal(a.items.length, b.items.length)
  } finally {
    stub.restore()
  }
})

test('刷完立刻再刷：闸门必须已复位，第二次真的又出网（不是回上一次结果）', async () => {
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => 1 })
  try {
    await service.refresh()
    assert.equal(stub.calls.length, 1)
    await service.refresh()
    assert.equal(stub.calls.length, 2, '串行点击刷新拿到的是新数据；这一条挂了就等于"刷新按钮失灵"')
  } finally {
    stub.restore()
  }
})

test('没配 key：整批 credential_missing，一次请求都不发', async () => {
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => undefined, now: () => 1 })
  try {
    const result = await service.refresh()
    assert.equal(result.error.code, 'credential_missing')
    assert.equal(stub.calls.length, 0)
    for (const item of result.items) assert.equal(item.quote, null)
  } finally {
    stub.restore()
  }
})

test('credential ref 从 capital-config 卡片读，不是硬编码 FUYAO_API_KEY', async () => {
  const card = fakeCtx({ settings: { describe: () => [{ ns: 'capital-config', value: { fuyaoCredentialRef: 'CUSTOM_FUYAO' } }] } })
  assert.equal(readCredentialRef(card), 'CUSTOM_FUYAO')

  const bare = fakeCtx({})
  assert.equal(readCredentialRef(bare), 'FUYAO_API_KEY', '没有卡片/条目的载体回退默认名')
  assert.equal(readCredentialRef(fakeCtx({ settings: { describe: () => [{ ns: 'capital-config', value: {} }] } })), 'FUYAO_API_KEY')

  const seen = []
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({
    openDomain: async () => fake.domain,
    credentialRef: () => readCredentialRef(card),
    resolveApiKey: async (ref) => { seen.push(ref); return 'k' },
    now: () => 1,
  })
  try {
    await service.search('300750')
    assert.deepEqual(seen, ['CUSTOM_FUYAO'], '解析 key 用的引用名必须跟着卡片走')
  } finally {
    stub.restore()
  }
})

test('⚠️ 模块同一性探针：host 半边与插件侧用的是同一个 fuyao-core 实例', async () => {
  // 跨包相对导入（`capital-watchlist/index.js` → `../lib/sources/fuyao-core.js`）在本仓没有先例。
  // 一旦出现第二份实例，`instanceof` 会静默失效、错误归类全部退化成兜底 code：
  // 这条用例就是那个退化的检测器，探针不过就重新设计（设计文档 §3.1 / §3.6 红线 3）。
  const error = new FuyaoError('rate_limited', 'Fuyao HTTP error 429', { status: 429 })
  assert.equal(watchlistErrorCode(error), 'rate_limited', '拿不到 rate_limited 就说明存在第二份 FuyaoError')
  assert.equal(watchlistErrorCode(error, { perItem: true }), 'rate_limited')
  assert.equal(watchlistErrorCode(new FuyaoError('invalid_parameter', 'x'), { perItem: true }), 'quote_unavailable')
  assert.equal(watchlistErrorCode(new FuyaoError('invalid_parameter', 'x')), 'invalid_query')
  assert.equal(watchlistErrorCode(new Error('boom')), 'fuyao_unavailable')
  assert.equal(DEFAULT_FUYAO_BASE_URL, 'https://fuyao.aicubes.cn')
})

test('上游用 null 表示"这个数没有"：绝不写成 0.00，也绝不顶掉上一次成功的快照', async () => {
  // 2026-09-30 review 实测：`Number(null)` 是 **0**，一份 `last_price:null` 的停牌快照被写成
  // "0.00 元 / 涨跌 0%"的新值——failure 里一个字都没有，页脚还报"刷新于此刻"。null 是上游表示
  // 缺口的真实形态（本仓 `fuyao-rest.ts` 的 `matchesField` 就是专门为它放行 null 的）。
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => 1 })
  try {
    const first = await service.refresh()
    assert.equal(first.items[0].quote.price, 3823.62, '正常回包先落一份真快照')

    stub.calls.length = 0
    const halted = stubFuyao({ '/api/a-share-index/prices/snapshot': { code: 0, data: { timestamp: null, item: [
      { thscode: '000001.SH', ticker: '1A0001', last_price: null, price_change_ratio_pct: null, prev_price: 3888.37 },
      { thscode: '399001.SZ', ticker: '399001', last_price: 12858.7532, price_change_ratio_pct: -3.440841, prev_price: 13316.9689 },
      { thscode: '399006.SZ', ticker: '399006', last_price: 3139.8249, price_change_ratio_pct: -4.534055, prev_price: 3288.9476 },
      { thscode: '000300.SH', ticker: '1B0300', last_price: '', price_change_ratio_pct: -2.216195, prev_price: 4439.14 },
    ] } } })
    try {
      const second = await service.refresh()
      assert.deepEqual(second.failures, [
        { thscode: '000001.SH', code: 'quote_unavailable' },
        { thscode: '000300.SH', code: 'quote_unavailable' },
      ], 'null 与空串都是"这一行这次没数"，不是 0')
      assert.equal(second.items.find((item) => item.thscode === '000001.SH').quote.price, 3823.62,
        '⛔ 停牌不许把上一次成功的快照覆盖成 0.00')
      assert.equal(fake.records.get('000001.SH').quote.price, 3823.62, '落盘的那份也还是上一次的数')
      assert.equal(second.items.find((item) => item.thscode === '399001.SZ').quote.price, 12858.7532, '同批有值的照常落地')
      assert.notEqual(second.refreshed_at, null, '别的标的真取到了数，页脚那个时间就是真的')
    } finally {
      halted.restore()
    }
  } finally {
    stub.restore()
  }
})

test('⛔ 最新价有值、涨跌为 null（停牌 / 未开盘）：涨跌如实"没有"，不许补 0.00%', async () => {
  // 上面那条测的是 last_price 为 null（整行没数）；这一条测的是**半张快照**——价有、涨跌没有。
  // 旧写法 `change_pct: pct ?? 0` 在这一半上撒谎：停牌标的画成"+0.00%"（0 在 A 股口径里是
  // 今日平盘这个**真值**），上一次真实的涨跌被这份假快照顶掉，failures 里一个字都没有。
  const stub = stubFuyao({
    '/api/a-share/prices/snapshot': {
      code: 0,
      data: { timestamp: 1790586000000, item: [{ thscode: '300750.SZ', ticker: '300750', last_price: 200.5, price_change_ratio_pct: null, prev_price: 200.5 }] },
    },
  })
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => 1 })
  try {
    await service.list()
    assert.equal((await service.add({ thscode: '300750.SZ' })).ok, true)
    const result = await service.refresh()
    const item = result.items.find((row) => row.thscode === '300750.SZ')
    assert.equal(item.quote.price, 200.5, '最新价有值就照写')
    assert.equal(item.quote.change_pct, null, '"没有涨跌"必须是 null；写成 0 就是告诉用户今天平盘')
    assert.equal(fake.records.get('300750.SZ').quote.change_pct, null, '落盘的也必须是 null，客户端才拿得到真话')
    assert.deepEqual(result.failures, [], '这一行确实有报价，不该记失败')
  } finally {
    stub.restore()
  }
})

test('一次刷新有总预算：被切掉的行记 refresh_timeout，并且一次都不出网', async () => {
  // 预算切在"领下一组之前"：没问到的行**根本没被问过**，所以不能记成 quote_unavailable
  // （那是在说"这只票没价"），也不升格成整批失败（问到的那几行是真的）。
  // 并发之后被切掉的不再是一个尾巴，而是"没轮到号的那些组"，所以断言只看两件事：
  // 出网数不超过并发上界，而被记超时的代码在 calls 里一个都不许出现。
  const TEN = Array.from({ length: 10 }, (_, index) => `5${String(10000 + index)}.SH`)
  let clock = 1_790_586_000_000
  const slowFund = (url) => {
    clock += 20_000 // 每问一只就烧掉 20 秒：45 秒的预算只够第一波
    const thscode = /[?&]thscode=([^&]+)/.exec(String(url))?.[1] ?? TEN[0]
    return { code: 0, data: { timestamp: 1, item: [{ thscode, last_price: 4.417, price_change_ratio_pct: -2.17 }] } }
  }
  const stub = stubFuyao({ '/api/fund/market/snapshot': slowFund })
  const fake = createFakeDomain()
  const service = createWatchlistService({
    openDomain: async () => fake.domain,
    resolveApiKey: async () => 'k',
    now: () => clock,
    refreshBudgetMs: 45_000,
  })
  try {
    await service.list()
    for (const seed of SEED_ITEMS) await service.remove({ thscode: seed.thscode })
    for (const thscode of TEN) await service.add({ thscode })
    stub.calls.length = 0

    const result = await service.refresh()
    const asked = stub.calls.map((call) => /[?&]thscode=([^&]+)/.exec(call.url)?.[1]).filter(Boolean)
    assert.equal(stub.calls.length, REFRESH_CONCURRENCY, `45 秒预算 / 每只 20 秒 ⇒ 只跑第一波（并发上界 ${REFRESH_CONCURRENCY}），超预算的组一次都不许出网`)
    const cut = result.failures.map((item) => item.thscode).sort()
    assert.ok(cut.length > 0, '必须真的切掉几行，否则这条用例什么都没测')
    assert.ok(cut.every((thscode) => !asked.includes(thscode)), '记 refresh_timeout 的行，根本没被问过')
    assert.ok(result.failures.every((item) => item.code === 'refresh_timeout'), '切掉的行如实说是超时，不是"没有报价"')
    assert.equal(result.error, undefined, '预算切的是"还没问的那几行"，不是整批失败')
    assert.equal(result.items.filter((item) => item.quote !== null).length, asked.length, '问到的行照常落地')
  } finally {
    stub.restore()
  }
})

const FIXTURE_FUND = { code: 0, data: { timestamp: 1790586418000, item: [{ thscode: '510300.SH', last_price: 4.417, price_change_ratio_pct: -2.170543 }] } }
