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

// 六位代码生成器：上限从 10 抬到 30 之后，`60000${index}` 这种拼法会在 index≥10 时变成七位
// 而被 normalizeThscode 判 invalid_query——那不是被测行为，是夹具的错。
const codeAt = (index) => `60${String(index).padStart(4, '0')}.SH`

test(`清单上限 ${MAX_ITEMS} 条：再加一条返回 list_full，不写库、不静默替换，回包带 limit`, async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await instance.list()
    for (let index = 0; index < MAX_ITEMS - SEED_ITEMS.length; index += 1) {
      const added = await instance.add({ thscode: codeAt(index) })
      assert.equal(added.ok, true, `第 ${SEED_ITEMS.length + index + 1} 条应当能加`)
    }
    assert.equal(fake.records.size, MAX_ITEMS)
    const overflow = await instance.add({ thscode: codeAt(900) })
    assert.equal(overflow.ok, false)
    assert.equal(overflow.code, 'list_full')
    // 「最多 N 条，先删一条再加」那句话的数字必须由服务端给：2.5.2 是服务端常量 + 中文字典
    // 写死"10"各写一遍，抬上限只会改红一边。
    assert.equal(overflow.limit, MAX_ITEMS, 'list_full 回包要带 limit，客户端才有单源可读')
    assert.equal(fake.records.size, MAX_ITEMS, '超限不覆盖已有条目')
  } finally {
    stub.restore()
  }
})

test('⛔ 上限不许被并发添加突破：只差一格时两个 /add 只许成一个', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await instance.list()
    for (let index = 0; index < MAX_ITEMS - SEED_ITEMS.length - 1; index += 1) await instance.add({ thscode: codeAt(index) })
    assert.equal(fake.records.size, MAX_ITEMS - 1, '先填到只差一格')
    const two = await Promise.all([instance.add({ thscode: codeAt(700) }), instance.add({ thscode: codeAt(701) })])
    assert.equal(two.filter((one) => one.ok === true).length, 1, '只差一格就只许进一条')
    assert.equal(two.filter((one) => one.code === 'list_full').length, 1, '另一条如实报 list_full，不是静默丢弃')
    assert.equal(
      fake.records.size,
      MAX_ITEMS,
      `清单被并发写成 ${fake.records.size} 条——上限检查写在最长 15 秒的搜索之前等于没写，必须在锁内复查`,
    )
  } finally {
    stub.restore()
  }
})

test('⛔ 刷新在途时的删除与置顶，不许被写回撤销', async () => {
  // 面板一打开就自动刷新，这扇窗几乎每次都开着；ETF 逐只扇出时最宽。
  // 旧实现拿批次开始时的整表快照做写回基底、整条覆写，于是刷新落地那一刻：刚删的标的被原样
  // 写回来（还重新占掉一格），刚置顶的被旧记录里的空 pinned_at 盖掉、静默掉回原位——两个动作
  // 系统都当场回执了"成功"。
  const stub = stubFuyao()
  const { instance, fake } = service()
  const outer = globalThis.fetch
  let release
  let gateOn = false
  const gate = new Promise((resolve) => { release = resolve })
  globalThis.fetch = async (url, init) => {
    const pending = outer(url, init)
    // 闸门只在 refresh 起来之后落下：setup 的 list/add 自己也走 fetch，全程挂着就是死锁。
    if (gateOn) await gate
    return pending
  }
  try {
    await instance.list()
    assert.equal((await instance.add({ thscode: codeAt(800) })).ok, true)
    gateOn = true

    const running = instance.refresh() // 两组（指数批量 + A 股批量）都卡在 gate 上
    const removed = await instance.remove({ thscode: '000001.SH' })
    const pinned = await instance.pin({ thscode: '399006.SZ' })
    assert.equal(removed.ok, true, '删除当场回执成功')
    assert.equal(pinned.ok, true, '置顶当场回执成功')
    assert.equal(fake.records.has('000001.SH'), false, '中间态：真的删掉了')
    assert.notEqual(fake.records.get('399006.SZ').pinned_at, undefined, '中间态：pinned_at 已落库')

    release()
    const result = await running

    assert.equal(fake.records.has('000001.SH'), false, '刷新写回把刚删的标的复活了（并重新占掉一格）')
    assert.equal(result.items.some((item) => item.thscode === '000001.SH'), false, '回包也不许带它')
    assert.notEqual(
      fake.records.get('399006.SZ').pinned_at,
      undefined,
      '刷新写回用旧快照盖掉了刚写入的 pinned_at，那一行会静默掉回原位',
    )
    assert.equal(result.items[0].thscode, '399006.SZ', '置顶行仍然在第一行')
    assert.ok(result.refreshed_at > 0, '确有报价落地，页脚才报"刷新于此刻"')
  } finally {
    globalThis.fetch = outer
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
    assert.equal(result.error.code, 'rate_limited', '整批失败要能被面板看见（红字跟在「刷新报价」下面）')
    assert.equal(result.failures.length, SEED_ITEMS.length)
    for (const item of result.items) assert.equal(item.quote, null, '失败绝不写成 0 或空对象')
    assert.equal(fake.records.get('000001.SH').quote, null)
  } finally {
    stub.restore()
  }
})

/**
 * 上一条的另一半：**已经有过成功快照**的行遇上取数失败。域里那条记录不该被碰，
 * 面板于是照画上一次的值（用户点名"为什么不是取最近一次刷新的报价值"）。
 * 全批一条都没落地时 `refreshed_at` 回 null——页脚那个时间讲的是"最后一次真取到数"。
 */
test('取数失败保住上一次成功的快照：只覆写成功的那几条，全批没落地时 refreshed_at 为 null', async () => {
  const { instance, fake } = service()
  let stub = stubFuyao()
  const swap = (overrides) => { stub.restore(); stub = stubFuyao(overrides); return stub }
  try {
    await instance.add({ q: '300750' })
    const first = await instance.refresh()
    assert.equal(first.failures.length, 0, 'fixture 里 A 股与指数都有值')
    assert.ok(first.refreshed_at > 0, '真的落地了才报本次时刻')
    const before = new Map(first.items.map((item) => [item.thscode, item.quote]))
    assert.ok(before.get('000001.SH'), '第一次刷新确实把快照写进了域')

    // 只有指数那一路被限流：A 股照常更新，指数那几行保留上一次成功的快照（不是 null、不是 0）。
    swap({ '/api/a-share-index/prices/snapshot': FIXTURE_RATE_LIMITED })
    const second = await instance.refresh()
    assert.equal(second.error.code, 'rate_limited', '整批级失败照旧上抛，面板才有红字可画')
    assert.deepEqual(second.failures.map((failure) => failure.thscode).sort(), ['000001.SH', '000300.SH', '399001.SZ', '399006.SZ'],
      '失败逐条给 code，且只给被限流那一路')
    for (const item of second.items) {
      if (item.thscode === '300750.SZ') {
        assert.notDeepEqual(item.quote, before.get(item.thscode), '成功那一路照常写回')
        continue
      }
      assert.deepEqual(item.quote, before.get(item.thscode), `${item.thscode} 本次没取到，回包里仍是上一次成功的快照`)
      assert.equal(fake.records.get(item.thscode).quote.price, before.get(item.thscode).price, '域里也没被覆写')
    }
    assert.ok(second.refreshed_at > 0, 'A 股那一路落地了 → 批次时刻照报')

    // 两路都被限流：一行都不许动，且页脚那格不许往前推。
    swap({ '/api/a-share-index/prices/snapshot': FIXTURE_RATE_LIMITED, '/api/a-share/prices/snapshot': FIXTURE_RATE_LIMITED })
    const third = await instance.refresh()
    assert.equal(third.refreshed_at, null, '⛔ 一条都没落地就不报"刷新于此刻"')
    const after = new Map(third.items.map((item) => [item.thscode, item.quote]))
    for (const [thscode, quote] of after) assert.deepEqual(quote, second.items.find((item) => item.thscode === thscode).quote, `${thscode} 的快照在全批失败里保持不动`)
    assert.equal(after.get('300750.SZ').price, before.get('300750.SZ').price, '第 2 批写回的值也不被第 3 批抹掉')
  } finally {
    stub.restore()
  }
})
test('置顶：pinned_at 把该条排到最前，后置顶的在前，未置顶的保持插入顺序', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await instance.list()
    const pinned = await instance.pin({ thscode: '000300.SH' })
    assert.equal(pinned.ok, true)
    assert.deepEqual(pinned.items.map((item) => item.thscode), ['000300.SH', '000001.SH', '399001.SZ', '399006.SZ'],
      '置顶的那条到第一行，其余保持插入顺序')
    assert.equal(typeof fake.records.get('000300.SH').pinned_at, 'number', '顺序是读出来的，写进盘的只有时间戳')
    assert.deepEqual([...fake.records.keys()], ['000001.SH', '399001.SZ', '399006.SZ', '000300.SH'],
      '文件里的键序不动（官方后端是 Map，删了重插要把整份 JSON 写 N 遍）')

    const second = await instance.pin({ thscode: '399006.SZ' })
    assert.deepEqual(second.items.map((item) => item.thscode), ['399006.SZ', '000300.SH', '000001.SH', '399001.SZ'],
      '后置顶的在前')

    const again = await instance.list()
    assert.deepEqual(again.items.map((item) => item.thscode), ['399006.SZ', '000300.SH', '000001.SH', '399001.SZ'],
      '重开面板（list）读到的还是置顶顺序')

    const repeated = await instance.pin({ thscode: '399006.SZ' })
    assert.equal(repeated.items[0].thscode, '399006.SZ', '重复置顶幂等：位置不变')
    assert.ok(fake.records.get('399006.SZ').pinned_at > second.items[0].pinned_at - 1, '只是把时间戳推新')

    assert.equal((await instance.pin({ thscode: '300750' })).code, 'invalid_query', '裸代码在本地就被拒')
    assert.equal((await instance.pin({ thscode: '600000.SH' })).code, 'not_found', '不在清单里响亮失败，不写下任何东西')
    assert.equal(fake.records.get('600000.SH'), undefined)
  } finally {
    stub.restore()
  }
})

test('刷新写回报价不动置顶：pinned_at 随整条记录 spread 保住，顺序也保住', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await instance.pin({ thscode: '399001.SZ' })
    const stamp = fake.records.get('399001.SZ').pinned_at
    const refreshed = await instance.refresh()
    assert.equal(refreshed.ok, true)
    assert.equal(fake.records.get('399001.SZ').pinned_at, stamp, '整条写回不许把置顶戳抹掉')
    assert.equal(refreshed.items[0].thscode, '399001.SZ', '报价刷新之后置顶的那条仍在第一行')
    assert.equal(fake.records.get('399001.SZ').quote.price, 12858.7532, '报价照常写回')
  } finally {
    stub.restore()
  }
})

test('pinned_at 是可选字段：磁盘上已有的 v1 记录（没有这一格）必须照样过 schema', () => {
  // 域在加载边界逐条校验，写成必填会让老清单直接 invalid-record（整条路由变 store_unavailable）。
  const legacy = {
    thscode: '000001.SH', ticker: '000001', name: '上证指数', exchange: 'SH', asset_type: 'a-share-index',
    added_at: 1, source: 'seed', quote: null,
  }
  const parsed = domainSpec.tables.items.valueSchema.parse(legacy)
  assert.equal(parsed.pinned_at, undefined, '没有这一格的记录读出来就是"未置顶"')
  assert.equal(domainSpec.tables.items.valueSchema.parse({ ...legacy, pinned_at: 5 }).pinned_at, 5)
  assert.equal(domainSpec.tables.items.valueSchema.safeParse({ ...legacy, pinned_at: 'now' }).success, false,
    '时间戳只接受整数')
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

test('存储装配期抢跑不许锁死功能：第一次打不开、后来能开就必须读得到清单', async () => {
  // 2026-09-30 review 实测的闩锁：`domainPromise` 连 rejection 一起 memoize，于是"一次装配期
  // 抢跑"就永久 503——`openDomain` 只被调过一次，之后每一次动作都复用那份失败的 promise。
  // 这不是假想：`storageDomain` 是 dsh-storage-domain 在自己 `inject(backendServices,…)` 的回调里
  // 才 provide 的，host 平面的预热完全可能跑在它前面（AGENTS.md §9.7 ⑤ 的同族形状）。
  const stub = stubFuyao()
  const fake = createFakeDomain()
  let attempts = 0
  const instance = createWatchlistService({
    openDomain: () => {
      attempts += 1
      if (attempts === 1) return Promise.reject(new Error('storageDomain facility is not mounted'))
      return Promise.resolve(fake.domain)
    },
    resolveApiKey: async () => 'test-key',
    now: () => 1_790_586_000_000,
  })
  try {
    await assert.rejects(instance.list(), /not mounted/)
    const second = await instance.list()
    assert.equal(attempts, 2, '下一次动作必须重新尝试开域，而不是复用那份失败的 promise')
    assert.equal(second.items.length, SEED_ITEMS.length, '恢复之后照常播种、照常读清单')
    assert.equal(fake.records.size, SEED_ITEMS.length)
    const refreshed = await instance.refresh()
    assert.equal(refreshed.items.every((item) => item.quote !== null), true, '刷新这条路也走得通')
  } finally {
    stub.restore()
  }
})
