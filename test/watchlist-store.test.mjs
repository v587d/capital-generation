/**
 * 自选股 store 层闸门（域 schema / 播种 / 上限 / 报价快照语义）。
 *
 * 这些断言钉的是"实测教训"而不是实现方便：删空后不许重播（否则用户删不掉）、
 * 失败不许写成快照（否则面板显示一个来历不明的 0）、上限必须真的挡住写（否则
 * `single` 布局整写一份 JSON 就是无界放大）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_ITEMS, SEED_ITEMS, createWatchlistService, domainSpec } from '../capital-watchlist/index.js'
import { createFakeDomain, stubFuyao } from './watchlist-harness.mjs'

function service(options = {}) {
  const fake = createFakeDomain()
  let clock = 1_790_586_000_000
  const instance = createWatchlistService({
    openDomain: async () => fake.domain,
    resolveApiKey: async () => 'test-key',
    now: () => { clock += 1000; return clock },
    ...options,
  })
  return { instance, fake, tick: () => clock }
}

test('首次打开播种 4 条主要指数，全部是 seed 来源且没有报价', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    const result = await instance.list()
    assert.equal(result.items.length, SEED_ITEMS.length, '种子数量就是 4')
    assert.deepEqual(result.items.map((item) => item.thscode), ['000001.SH', '399001.SZ', '399006.SZ', '000300.SH'])
    for (const item of result.items) {
      assert.equal(item.source, 'seed')
      assert.equal(item.asset_type, 'a-share-index')
      assert.equal(item.quote, null, '没刷过就是 null，不放 0、不放空对象')
    }
    assert.ok(result.seeded_at > 0)
    assert.equal(fake.seededAt(), result.seeded_at)
  } finally {
    stub.restore()
  }
})

test('播种幂等：反复读清单不会长出第二份种子', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await instance.list()
    await instance.list()
    const third = await instance.list()
    assert.equal(third.items.length, SEED_ITEMS.length)
    assert.equal(new Set(third.items.map((item) => item.thscode)).size, third.items.length, '主键去重靠 thscode')
    assert.equal(fake.records.size, SEED_ITEMS.length)
  } finally {
    stub.restore()
  }
})

test('用户删空后不重建：seeded_at 是"播过一次"的唯一凭据', async () => {
  const stub = stubFuyao()
  const { instance } = service()
  try {
    const seeded = await instance.list()
    for (const item of seeded.items) await instance.remove({ thscode: item.thscode })
    const emptied = await instance.list()
    assert.deepEqual(emptied.items, [], '删完就是空清单，不许偷偷重播')
    const again = await instance.list()
    assert.equal(again.items.length, 0)
  } finally {
    stub.restore()
  }
})

test('add 走代码与走中文名都落到同一条规范化 thscode；重复添加幂等', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await instance.list()
    const byCode = await instance.add({ q: '300750' })
    assert.equal(byCode.ok, true)
    assert.equal(byCode.item.thscode, '300750.SZ')
    assert.equal(byCode.item.name, '宁德时代')
    assert.equal(byCode.item.source, 'user')

    const again = await instance.add({ q: '宁德时代' })
    assert.equal(again.ok, true)
    assert.equal(again.idempotent, true, '已在清单里就不写第二条')
    assert.equal(fake.records.get('300750.SZ').name, '宁德时代')
    assert.equal(fake.records.size, SEED_ITEMS.length + 1)
  } finally {
    stub.restore()
  }
})

test('多命中不写库：返回 ambiguous 与候选，让用户自己选', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await instance.list()
    const result = await instance.add({ q: 'ETF' })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'ambiguous')
    assert.equal(result.candidates.length, 2)
    assert.equal(fake.records.size, SEED_ITEMS.length, '歧义时一条都不写')
  } finally {
    stub.restore()
  }
})

test('裸代码与非支持标的被拒；场外基金即便被搜到也进不了清单', async () => {
  const stub = stubFuyao()
  const { instance } = service()
  try {
    await instance.list()
    const bare = await instance.add({ thscode: '600519' })
    assert.equal(bare.ok, false)
    assert.equal(bare.code, 'invalid_query', '后缀不许由我们猜')

    const otc = await instance.add({ q: 'OTC' })
    assert.equal(otc.ok, false)
    assert.equal(otc.code, 'not_found', '白名单外的 asset_type 不入库')
  } finally {
    stub.restore()
  }
})

test('清单上限 10 条：第 11 条返回 list_full，不写库、不静默替换', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await instance.list()
    for (let index = 0; index < MAX_ITEMS - SEED_ITEMS.length; index += 1) {
      const code = `60000${index}.SH`
      const added = await instance.add({ thscode: code })
      assert.equal(added.ok, true, `第 ${index + 5} 条应当能加`)
    }
    assert.equal(fake.records.size, MAX_ITEMS)
    const overflow = await instance.add({ thscode: '600099.SH' })
    assert.equal(overflow.ok, false)
    assert.equal(overflow.code, 'list_full')
    assert.equal(fake.records.size, MAX_ITEMS, '超限不覆盖已有条目')
  } finally {
    stub.restore()
  }
})

test('刷新把报价整体写回，并带 captured_at 与上游 source_ts', async () => {
  const stub = stubFuyao()
  const { instance } = service()
  try {
    await instance.add({ thscode: '300750.SZ' })
    const result = await instance.refresh()
    assert.equal(result.ok, true)
    assert.deepEqual(result.failures, [], '四条指数 + 一只 A 股都在 fixture 里')
    const index = result.items.find((item) => item.thscode === '000001.SH')
    assert.equal(index.quote.price, 3823.62)
    assert.equal(index.quote.change_pct, -1.665222, '涨跌幅用上游百分数原值，不二次计算')
    assert.equal(index.quote.source_ts, 1790586409000)
    assert.ok(index.quote.captured_at > 0)
    const stock = result.items.find((item) => item.thscode === '300750.SZ')
    assert.equal(stock.quote.price, 291.99)
    assert.equal(stub.calls.filter((call) => call.url.includes('/prices/snapshot')).length, 2, 'A 股与指数各一次批量')
  } finally {
    stub.restore()
  }
})

test('失败不落"错误快照"：报价仍是 null，当次回包里逐条给 code', async () => {
  const stub = stubFuyao({ '/api/a-share-index/prices/snapshot': FIXTURE_RATE_LIMITED })
  const { instance, fake } = service()
  try {
    const result = await instance.refresh()
    assert.equal(result.error.code, 'rate_limited', '整批失败要能被面板居中显示')
    assert.equal(result.failures.length, SEED_ITEMS.length)
    for (const item of result.items) assert.equal(item.quote, null, '失败绝不写成 0 或空对象')
    assert.equal(fake.records.get('000001.SH').quote, null)
  } finally {
    stub.restore()
  }
})

test('写进域里的每条记录都必须过 schema（真域在持久边界逐条校验）', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await instance.refresh()
    for (const [, record] of fake.records.entries()) {
      assert.doesNotThrow(() => domainSpec.tables.items.valueSchema.parse(record), `${record.thscode} 的记录形态不合法`)
    }
    assert.throws(() => domainSpec.tables.items.valueSchema.parse({
      thscode: '300750', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share',
      added_at: 1, source: 'user', quote: null,
    }), '裸代码（无交易所后缀）必须被 schema 拒掉')
  } finally {
    stub.restore()
  }
})

test('域名必须过 storage 的 unit name 规则（连字符会被上游拒成 malformed-medium）', async () => {
  // 实测教训：域叫 `capital-watchlist` 时，真 boot 里所有路由都是
  // `store_unavailable：malformed-medium：invalid unit name 'capital-watchlist'`。
  // `UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/`（@deepseek-ai/dsh-storage），路由名与域名因此不同字。
  assert.match(domainSpec.name, /^[a-z][a-z0-9_]*$/u, '域名只许小写字母、数字与下划线')
  assert.equal(domainSpec.name, 'capital_watchlist')
  for (const table of Object.keys(domainSpec.tables)) {
    assert.match(table, /^[a-z][a-z0-9_]*$/u, `表名 ${table} 不合 unit name 规则`)
  }
  assert.equal(domainSpec.tables.items.valueSchema.safeParse({
    thscode: '000001.SH', ticker: '000001', name: '上证指数', exchange: 'SH', asset_type: 'a-share-index',
    added_at: 1, source: 'seed', quote: null,
  }).success, true, '一条种子记录的形态必须过 valueSchema')
})

const FIXTURE_RATE_LIMITED = { code: 4001, message: '请求频率超限', data: null }
