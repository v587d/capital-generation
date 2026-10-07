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
import { fetchSmartbox, sourceError } from '../lib/sources/tencent-public-core.js'
import { MAX_ITEMS, REFRESH_CONCURRENCY, SEED_ITEMS, createWatchlistService, readCredentialRef, refreshBudgetFor, watchlistErrorCode } from '../capital-watchlist/index.js'
import { createFakeDomain, fakeCtx, stubFuyao, tencentSnapshotText } from './watchlist-harness.mjs'

const ETF_CODES = ['510300.SH', '159915.SZ', '588000.SH']
/** 一次刷新的出网按家数分开数：三路扇出之后"总共几次"已经不是判据，"每家各一次"才是。 */
const callsTo = (calls, needle) => calls.filter((call) => call.url.includes(needle))

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
      assert.equal(second.error.scope, 'a-share', '限流的是 A 股那一路，港美股这一路此刻好好的')
      assert.equal(callsTo(limited.calls, 'fuyao.aicubes.cn').length, 1, '一次失败就是失败，不许偷偷重试')
      assert.equal(callsTo(limited.calls, 'qt.gtimg.cn').length, 2, '港、美各一次批量：不许因为另一家挂了就重问一遍')
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
    // 四条种子分布在三个市场 ⇒ 一轮出网是"每家各一次"（A 股指数 / 港指数 / 美指数），
    // 判据是并发不翻倍：第二次 refresh 拿到的是同一批结果，一家都不许多问一次。
    assert.equal(callsTo(stub.calls, 'fuyao.aicubes.cn').length, 1, '开面板与点刷新同时发生也只出网一轮')
    assert.equal(callsTo(stub.calls, 'qt.gtimg.cn').length, 2, '港、美各一次，共用的那个闸门不许变成两次')
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
    assert.equal(callsTo(stub.calls, 'fuyao.aicubes.cn').length, 1)
    await service.refresh()
    assert.equal(callsTo(stub.calls, 'fuyao.aicubes.cn').length, 2, '串行点击刷新拿到的是新数据；这一条挂了就等于"刷新按钮失灵"')
    assert.equal(callsTo(stub.calls, 'qt.gtimg.cn').length, 4, '两路上游都要跟着第二次点击再问一遍')
  } finally {
    stub.restore()
  }
})

test('没配 A 股密钥：那一路 credential_missing 且一笔都不发，港美股照常取数（R12）', async () => {
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => undefined, now: () => 1 })
  try {
    const result = await service.refresh()
    assert.equal(result.error.code, 'credential_missing')
    assert.equal(result.error.scope, 'a-share', '⛔ 密钥的射程只有 A 股那一路，整块面板没说不可用')
    assert.equal(callsTo(stub.calls, 'fuyao.aicubes.cn').length, 0, '没有 key 就不烧请求')
    assert.equal(callsTo(stub.calls, 'qt.gtimg.cn').length, 2, '腾讯这两路本来就不要密钥，不许被连坐')
    assert.equal(result.items.find((item) => item.thscode === '000001.SH').quote, null)
    for (const thscode of ['HSI.HK', 'IXIC.US', 'INX.US']) {
      assert.ok(result.items.find((item) => item.thscode === thscode).quote, `${thscode} 不受密钥缺失影响`)
    }
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
    // 同批再放一只 A 股个股：这一条测的正是"一行没数不拖垮整批"（`matchesField` 放行 null 的同一条理由）。
    assert.equal((await service.add({ thscode: '300750.SZ' })).ok, true)

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
      ], 'null 与空串都是"这一行这次没数"，不是 0')
      assert.equal(second.items.find((item) => item.thscode === '000001.SH').quote.price, 3823.62,
        '⛔ 停牌不许把上一次成功的快照覆盖成 0.00')
      assert.equal(fake.records.get('000001.SH').quote.price, 3823.62, '落盘的那份也还是上一次的数')
      assert.equal(second.items.find((item) => item.thscode === '300750.SZ').quote.price, 291.99, '同批有值的照常落地')
      // 回包里多出来的行（清单里没有的 399001.SZ / 000300.SH）既不能占格子，也不能被当成本次的数：
      // 写回只认清单里问出去的那些键。
      assert.equal(fake.records.get('399001.SZ'), undefined, '⛔ 不许把回包里的陌生行落进清单')
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

/**
 * 港美股那两路的报价闸门（设计文档 §6.1 第二行）。夹具全部是 2026-10-07 实测回包的列位与数值，
 * 名称用 ASCII（GBK 解码由 `tencent-source.test.mjs` 与真机冒烟覆盖）。
 */
test('⛔ 模块同一性探针（腾讯这一家）：面板与插件侧共用同一条节流链', async () => {
  // 这条测的不是"面板能不能取到数"，而是**有没有第二条 120ms 的链**。真出现第二份，
  // 症状不是报错，而是两路各自串行、合起来打上游的速度翻倍（东财那次"两套独立限流等于没限"同族）。
  // 与 `test/tencent-source.test.mjs` 那条"只有一条节流链"是同一判据的两半。
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => 1 })
  const original = globalThis.fetch
  const started = []
  let inFlight = 0
  let maxConcurrent = 0
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('gtimg.cn')) return original(url, init)
    inFlight += 1
    maxConcurrent = Math.max(maxConcurrent, inFlight)
    started.push(Date.now())
    inFlight -= 1
    return original(url, init)
  }
  try {
    await service.list()
    // 面板这一轮要走港指数 + 美指数两笔，同时外面再并发一笔检索：三条都必须排在同一条链上。
    await Promise.all([service.refresh(), fetchSmartbox('腾讯', 'hk', AbortSignal.timeout(5000)), fetchSmartbox('苹果', 'us', AbortSignal.timeout(5000))])
    assert.equal(started.length, 4, '面板两笔 + 检索两笔')
    assert.equal(maxConcurrent, 1, '⛔ 同一时刻只允许一个腾讯请求在飞：拿到 2 就说明存在第二份节流实例')
    for (let index = 1; index < started.length; index += 1) {
      assert.ok(started[index] - started[index - 1] >= 110, `相邻两次之间必须留出最小间隔，实测 ${started[index] - started[index - 1]}ms`)
    }
  } finally {
    globalThis.fetch = original
    stub.restore()
  }
})

test('币种只从回包取：`00700` 是 HKD、`80700` 是 CNY、苹果是 USD、宁德时代是 CNY', async () => {
  // ⛔ P10 的对照组：同一个港股列表里可以同时有 HKD 与 CNY 两行，所以"按市场猜币种"必错，
  // "只在非本币时显示"也读错（相邻两行看起来一个有币种一个没有）。
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => Date.now() })
  try {
    await withList(service, ['00700.HK', '80700.HK', 'AAPL.OQ', '300750.SZ'])
    const result = await service.refresh()
    const quoteOf = (thscode) => result.items.find((item) => item.thscode === thscode).quote
    assert.equal(quoteOf('00700.HK').currency, 'HKD')
    assert.equal(quoteOf('80700.HK').currency, 'CNY', '⛔ 人民币柜台的港股：猜 HKD 的实现在这里必须红')
    assert.equal(quoteOf('AAPL.OQ').currency, 'USD')
    assert.equal(quoteOf('300750.SZ').currency, 'CNY', 'A 股那一档由本文件唯一一处写（Fuyao 回包没有币种列）')
    assert.equal(quoteOf('00700.HK').price, 420.8)
    assert.equal(quoteOf('80700.HK').price, 359.4)
    assert.equal(quoteOf('AAPL.OQ').price, 333.63)
  } finally {
    stub.restore()
  }
})

test('⛔ 指数行一律不带币种：上游在同一列给了 HKD / USD，也不接', async () => {
  // 夹具里 `hkHSI` 第 75 位真是 `HKD`、`usIXIC` 第 35 位真是 `USD`——这一条测的就是"实现不听话时红"。
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => Date.now() })
  try {
    const result = await service.refresh()
    for (const thscode of ['000001.SH', 'HSI.HK', 'IXIC.US', 'INX.US']) {
      const quote = result.items.find((item) => item.thscode === thscode).quote
      assert.ok(quote.price > 0, `${thscode} 有点位`)
      assert.equal(quote.currency, undefined, `${thscode} 是指数：点位无量纲，画币种是替上游说话`)
    }
    assert.equal(result.items.find((item) => item.thscode === 'HSI.HK').quote.price, 24163.05)
    assert.equal(result.items.find((item) => item.thscode === 'INX.US').quote.price, 7818.93, '标普在腾讯的写法是 INX')
  } finally {
    stub.restore()
  }
})

test('停牌 / 零成交那行：涨跌落 null，绝不写 0.00%（R10）', async () => {
  // 实测 `hk00465`：价 3.200、开 0、量 0、额 0、涨跌 `0.00`。上游用 0.00 说"没有"，
  // 判据只用内核算好的 `is_stale`（成交额 0 且现价等于昨收），不自建"接近 0 就当没有"的猜测。
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => Date.now() })
  try {
    await withList(service, ['00465.HK', '00700.HK'])
    const result = await service.refresh()
    const halted = result.items.find((item) => item.thscode === '00465.HK').quote
    assert.equal(halted.price, 3.2, '最新价仍然有值')
    assert.equal(halted.change_pct, null, '⛔ 涨跌是"没有"，写成 0 就是告诉用户今天平盘')
    assert.equal(fake.records.get('00465.HK').quote.change_pct, null, '落盘的也是 null')
    assert.equal(result.items.find((item) => item.thscode === '00700.HK').quote.change_pct, -1.73, '同批有涨跌的照常写')
    assert.deepEqual(result.failures, [], '这一行确实有报价，不该记失败')
  } finally {
    stub.restore()
  }
})

test('交易所当地时间原样进 `source_time`，`source_ts` 留 null：两路不互相伪造、不换算', async () => {
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => Date.now() })
  try {
    await withList(service, ['00700.HK', 'AAPL.OQ'])
    const result = await service.refresh()
    const hk = result.items.find((item) => item.thscode === '00700.HK').quote
    const us = result.items.find((item) => item.thscode === 'AAPL.OQ').quote
    assert.equal(hk.source_time, '2026-10-07 14:06:13', '实测上游这一行给的是 `/` 分隔，内核把两种都归一成 `-`')
    assert.equal(us.source_time, '2026-10-06 16:00:01')
    assert.equal(hk.source_ts, null, '⛔ 不许拿交易所当地串反推 epoch（我们没有偏移表与夏令时口径）')
    assert.equal(us.source_ts, null)
    const aShare = result.items.find((item) => item.thscode === '000001.SH').quote
    assert.equal(aShare.source_ts, 1790586409000, 'Fuyao 那一路仍是信封时刻')
    assert.equal(aShare.source_time, undefined, 'A 股这一路没有原串，不编一个')
  } finally {
    stub.restore()
  }
})

test('一个市场一次批量：混市场清单既不拆成逐只，也不并进同一笔请求', async () => {
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => Date.now() })
  try {
    await withList(service, ['00700.HK', '80700.HK', '00465.HK', 'AAPL.OQ', 'BRK.B.N', 'TCEHY.PS'])
    const result = await service.refresh()
    // 四条种子（A 股指数 + 港指数 + 两条美指数）也在这份清单里 ⇒ 一共六笔：A 股指数一次、
    // 四个"市场 × 行类"各一次。判据是**每个 (市场, 行类) 只一笔**，不是总数最小。
    const offshore = callsTo(stub.calls, 'qt.gtimg.cn')
    assert.equal(offshore.length, 4, '港个股 / 港指数 / 美个股 / 美指数各一笔：比 A 股 ETF 逐只扇出便宜，也不许跨市场合表')
    const symbolsOf = (call) => /q=([^&]*)/.exec(call.url)[1].split(',')
    assert.deepEqual(symbolsOf(offshore.find((call) => call.url.includes('hk00700'))), ['hk00700', 'hk80700', 'hk00465'])
    assert.deepEqual(symbolsOf(offshore.find((call) => call.url.includes('usAAPL'))), ['usAAPL', 'usBRK.B', 'usTCEHY'])
    assert.deepEqual(symbolsOf(offshore.find((call) => call.url.includes('hkHSI'))), ['hkHSI'])
    assert.deepEqual(symbolsOf(offshore.find((call) => call.url.includes('usIXIC'))), ['usIXIC', 'usINX'])
    assert.deepEqual(result.failures, [])
    // 美个股问出去的是剥掉交易所后缀的写法，回来的身份仍是带后缀那一只 ⇒ 一轮就问完。
    assert.equal(result.items.find((item) => item.thscode === 'BRK.B.N').quote.price, 505.54)
    assert.equal(result.items.find((item) => item.thscode === 'TCEHY.PS').quote.price, 54.5)
    assert.equal(offshore.length, 4, '⛔ 一轮问完：不许像参数层那样先猜带后缀的写法再重问一遍（第五笔就是它）')
  } finally {
    stub.restore()
  }
})

test('⛔ 回包身份不是问出去的那只：整行不落价（P19 的 `SSPX` 对照）', async () => {
  // 实测猜写法拿标普会拿到 `SSPX.AM`——Janus Henderson 一只真 ETF，且不报错。
  // 形状判据在内核（读不懂这一份回包就一行都不写），身份判据在面板（不是问出去的那只就丢弃）。
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => Date.now() })
  try {
    await service.list()
    const first = await service.refresh()
    const before = first.items.find((item) => item.thscode === 'INX.US').quote.price
    assert.equal(before, 7818.93)

    stub.calls.length = 0
    // 只把"美指数那一笔"换成猜错的回包（`usINX` 问到的是 `SSPX.AM` 那只 ETF），其余照默认路由走：
    // 港那一路这次是好的，`scope` 才必须是 `us`。
    const trap = stubFuyao({
      'qt.gtimg.cn': (url) => (url.includes('usINX')
        ? tencentSnapshotText(['usSSPX'])
        : tencentSnapshotText((/q=([^&]*)/.exec(url)?.[1] ?? '').split(',').filter(Boolean))),
    })
    try {
      const second = await service.refresh()
      assert.equal(trap.calls.filter((call) => call.url.includes('qt.gtimg.cn')).length, 2, '港、美各一笔，失败不许重问')
      const usFailures = second.failures.filter((failure) => failure.thscode.endsWith('.US'))
      assert.deepEqual(usFailures.map((failure) => failure.thscode), ['IXIC.US', 'INX.US'])
      assert.equal(second.error.code, 'tencent_unavailable', '读不懂的报文说"这一路不通"，不是说"这两只没价"')
      assert.equal(second.error.scope, 'us', '⛔ 港那一路这次是好的')
      assert.equal(fake.records.get('INX.US').quote.price, before, '⛔ 绝不能把 ETF 的 31.47 写成标普500 的点位')
      assert.equal(fake.records.get('IXIC.US').quote.price, 27599.89, '同一批里被连累的行保持上一次成功的快照，不写 0')
      assert.equal(fake.records.get('HSI.HK').quote.price, 24163.05, '另一市场照常落地')
    } finally {
      trap.restore()
    }
  } finally {
    stub.restore()
  }
})

test('腾讯侧错误归类：畸形报文只逐条记缺口，传输层失败才升格 `tencent_unavailable`', async () => {
  const shaped = sourceError('Tencent HK quote is not a five-digit stock code', 'tencent_invalid_response')
  assert.equal(watchlistErrorCode(shaped, { perItem: true, source: 'tencent' }), 'quote_unavailable')
  assert.equal(watchlistErrorCode(shaped, { source: 'tencent' }), 'tencent_unavailable', '批级才换家名：两路上游的处置动作不同')
  assert.equal(watchlistErrorCode(new Error('boom'), { source: 'tencent' }), 'tencent_unavailable')
  assert.equal(watchlistErrorCode(sourceError('rate limited', 'tencent_rate_limit'), { source: 'tencent' }), 'rate_limited', '429 仍是限流，不换家名')
  assert.equal(watchlistErrorCode(new Error('boom')), 'fuyao_unavailable', '不传 source 时默认 Fuyao（老调用点零改动）')
})

test('清单里出现形状与 `asset_type` 不认账的行：不进任何一组，照实记缺口', async () => {
  // 磁盘上那一格是可以被人改的（`storage-domain` 的文件就在用户机器上）。分派只看键的形状，
  // 所以"一条写着 `hk-stock` 的沪深代码"既不会去敲腾讯的门、也不会被当成 A 股静默处理。
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => Date.now() })
  try {
    await service.list()
    await fake.table.put('300750.SZ', { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'us-stock', added_at: 1, source: 'user', quote: null })
    const result = await service.refresh()
    assert.deepEqual(result.failures, [{ thscode: '300750.SZ', code: 'quote_unavailable' }])
    assert.equal(callsTo(stub.calls, 'us300750').length, 0, '⛔ 不认账的行一个端点都不许问')
    assert.equal(callsTo(stub.calls, 'thscodes=300750').length, 0, '也不许塞进 A 股那一批')
  } finally {
    stub.restore()
  }
})
