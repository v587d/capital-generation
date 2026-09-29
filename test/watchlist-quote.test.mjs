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
import { SEED_ITEMS, createWatchlistService, readCredentialRef, watchlistErrorCode } from '../capital-watchlist/index.js'
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

test('清单上限把扇出规模钉死：10 条上限 ⇒ 最多 10 次 ETF 请求', async () => {
  const stub = stubFuyao()
  const fake = createFakeDomain()
  const service = createWatchlistService({ openDomain: async () => fake.domain, resolveApiKey: async () => 'k', now: () => 1 })
  try {
    await withList(service, ETF_CODES.concat(['300001.SZ', '300002.SZ', '300003.SZ', '300004.SZ', '300005.SZ']))
    assert.equal(fake.records.size, 10)
    await service.refresh()
    const outbound = stub.calls.filter((call) => !call.url.includes('/tickers/search')).length
    assert.ok(outbound <= 10, `一次刷新的出网请求数必须不超过清单上限，实测 ${outbound}`)
  } finally {
    stub.restore()
  }
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

const FIXTURE_FUND = { code: 0, data: { timestamp: 1790586418000, item: [{ thscode: '510300.SH', last_price: 4.417, price_change_ratio_pct: -2.170543 }] } }
