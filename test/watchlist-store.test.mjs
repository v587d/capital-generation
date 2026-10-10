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
import { createFakeDomain, HOLDABLE_ROWS, stubFuyao, withHoldable } from './watchlist-harness.mjs'

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

test('首次打开播种四条指数（三个市场各一），全部是 seed 来源且没有报价', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    const result = await instance.list()
    assert.equal(result.items.length, SEED_ITEMS.length, '种子数量就是 4')
    // 2026-10-07 由用户定为跨三个市场各留一根"今天有没有开盘"的标尺（设计文档 §3.9 第 7 点）：
    // 替换掉深证成指 / 创业板指 / 沪深300，`SEED_ITEMS` 是一整张常量表，删除与新增一次做完。
    assert.deepEqual(result.items.map((item) => item.thscode), ['000001.SH', 'HSI.HK', 'IXIC.US', 'INX.US'])
    for (const item of result.items) {
      assert.equal(item.source, 'seed')
      assert.equal(item.quote, null, '没刷过就是 null，不放 0、不放空对象')
    }
    assert.deepEqual(result.items.map((item) => item.asset_type), ['a-share-index', 'hk-index', 'us-index', 'us-index'])
    assert.deepEqual(result.items.map((item) => item.exchange), ['SH', 'HK', 'US', 'US'], 'exchange 这一格存的是**市场**，不是交易所')
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
    const pinned = await instance.pin({ thscode: 'IXIC.US' })
    assert.equal(removed.ok, true, '删除当场回执成功')
    assert.equal(pinned.ok, true, '置顶当场回执成功')
    assert.equal(fake.records.has('000001.SH'), false, '中间态：真的删掉了')
    assert.notEqual(fake.records.get('IXIC.US').pinned_at, undefined, '中间态：pinned_at 已落库')

    release()
    const result = await running

    assert.equal(fake.records.has('000001.SH'), false, '刷新写回把刚删的标的复活了（并重新占掉一格）')
    assert.equal(result.items.some((item) => item.thscode === '000001.SH'), false, '回包也不许带它')
    assert.notEqual(
      fake.records.get('IXIC.US').pinned_at,
      undefined,
      '刷新写回用旧快照盖掉了刚写入的 pinned_at，那一行会静默掉回原位',
    )
    assert.equal(result.items[0].thscode, 'IXIC.US', '置顶行仍然在第一行')
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
  // 三家全挂（A 股指数被限流 + 港美股两个市场都不回行）：这才是"整块失败"，也才允许 `scope: 'all'`。
  const stub = stubFuyao({ '/api/a-share-index/prices/snapshot': FIXTURE_RATE_LIMITED, 'qt.gtimg.cn': 'v_pv_none_match="1";' })
  const { instance, fake } = service()
  try {
    const result = await instance.refresh()
    assert.equal(result.error.code, 'rate_limited', '整批失败要能被面板看见（红字跟在「刷新报价」下面）')
    assert.equal(result.error.scope, 'all', '⛔ 只有每一组都失败才占用面板居中位')
    assert.deepEqual(result.failures.map((failure) => failure.thscode).sort(), ['000001.SH', 'HSI.HK', 'INX.US', 'IXIC.US'])
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
    assert.equal(first.failures.length, 0, 'fixture 里 A 股、港股指数与美股指数都有值')
    assert.ok(first.refreshed_at > 0, '真的落地了才报本次时刻')
    const before = new Map(first.items.map((item) => [item.thscode, item.quote]))
    assert.ok(before.get('000001.SH'), '第一次刷新确实把快照写进了域')

    // 只有 A 股指数那一路被限流：其余照常更新，那一行保留上一次成功的快照（不是 null、不是 0）。
    swap({ '/api/a-share-index/prices/snapshot': FIXTURE_RATE_LIMITED })
    const second = await instance.refresh()
    assert.equal(second.error.code, 'rate_limited', '批级失败照旧上抛，面板才有红字可画')
    assert.equal(second.error.scope, 'a-share', '⛔ 半边失败不许说成"服务不可用"：港美股这次好好的')
    assert.deepEqual(second.failures.map((failure) => failure.thscode), ['000001.SH'],
      '失败逐条给 code，且只给被限流那一路')
    for (const item of second.items) {
      if (item.thscode === '000001.SH') {
        assert.deepEqual(item.quote, before.get(item.thscode), '⛔ 本次没取到，回包里仍是上一次成功的快照（不是 null、不是 0）')
        assert.equal(fake.records.get(item.thscode).quote.price, before.get(item.thscode).price, '域里也没被覆写')
        continue
      }
      assert.ok(item.quote.captured_at > before.get(item.thscode).captured_at, `${item.thscode} 成功那一路照常写回`)
    }
    assert.ok(second.refreshed_at > 0, 'A 股个股与港美股都落地了 → 批次时刻照报')

    // 三路都不回数据：一行都不许动，且页脚那格不许往前推。
    swap({ '/api/a-share-index/prices/snapshot': FIXTURE_RATE_LIMITED, '/api/a-share/prices/snapshot': FIXTURE_RATE_LIMITED, 'qt.gtimg.cn': 'v_pv_none_match="1";' })
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
    const pinned = await instance.pin({ thscode: 'INX.US' })
    assert.equal(pinned.ok, true)
    assert.deepEqual(pinned.items.map((item) => item.thscode), ['INX.US', '000001.SH', 'HSI.HK', 'IXIC.US'],
      '置顶的那条到第一行，其余保持插入顺序')
    assert.equal(typeof fake.records.get('INX.US').pinned_at, 'number', '顺序是读出来的，写进盘的只有时间戳')
    assert.deepEqual([...fake.records.keys()], ['000001.SH', 'HSI.HK', 'IXIC.US', 'INX.US'],
      '文件里的键序不动（官方后端是 Map，删了重插要把整份 JSON 写 N 遍）')

    const second = await instance.pin({ thscode: 'IXIC.US' })
    assert.deepEqual(second.items.map((item) => item.thscode), ['IXIC.US', 'INX.US', '000001.SH', 'HSI.HK'],
      '后置顶的在前')

    const again = await instance.list()
    assert.deepEqual(again.items.map((item) => item.thscode), ['IXIC.US', 'INX.US', '000001.SH', 'HSI.HK'],
      '重开面板（list）读到的还是置顶顺序')

    const repeated = await instance.pin({ thscode: 'IXIC.US' })
    assert.equal(repeated.items[0].thscode, 'IXIC.US', '重复置顶幂等：位置不变')
    assert.ok(fake.records.get('IXIC.US').pinned_at > second.items[0].pinned_at - 1, '只是把时间戳推新')

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
    await instance.pin({ thscode: 'HSI.HK' })
    const stamp = fake.records.get('HSI.HK').pinned_at
    const refreshed = await instance.refresh()
    assert.equal(refreshed.ok, true)
    assert.equal(fake.records.get('HSI.HK').pinned_at, stamp, '整条写回不许把置顶戳抹掉')
    assert.equal(refreshed.items[0].thscode, 'HSI.HK', '报价刷新之后置顶的那条仍在第一行')
    assert.equal(fake.records.get('HSI.HK').quote.price, 24163.05, '报价照常写回')
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

/**
 * 域 schema 的这一版只**拓宽**（键形状、`asset_type` 七档、`exchange` 四档、报价两格可选），
 * 所以磁盘上已有的 v1 记录逐条仍然通过——不抬 domain `version`、不写迁移（§3.4 / §4.1）。
 * ⛔ 反过来做（收窄或改语义）会让一次读就把整份清单判成 `invalid-record` → `store_unavailable`：
 * 这几条就是那一步的哨兵，改 schema 之前先看它们答什么。
 */
test('五种 canonical 键形状都过 schema，老记录没有的两格照读', () => {
  const valueSchema = domainSpec.tables.items.valueSchema
  const base = { ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', added_at: 1, source: 'user', quote: null }
  for (const thscode of ['300750.SZ', '00700.HK', 'HSI.HK', 'AAPL.OQ', 'BRK.B.N', 'IXIC.US']) {
    assert.equal(valueSchema.safeParse({ ...base, thscode }).success, true, `${thscode} 是合法键`)
  }
  for (const thscode of ['300750', '00700', 'AAPL', '.IXIC', 'abc123.SZ', '600000.BJ', '012414.OF', 'HSI.SZ']) {
    assert.equal(valueSchema.safeParse({ ...base, thscode }).success, false, `${thscode} 不是这版的键`)
  }
  // 2.5.3 的 `pinned_at` 与本版新增的 `currency` / `source_time` 都是**可选**：
  // 写成必填会把用户已有的每一条记录判成坏记录（读一次就整块不可用）。
  const v1 = { thscode: '000001.SH', ticker: '000001', name: '上证指数', exchange: 'SH', asset_type: 'a-share-index', added_at: 1, source: 'seed', quote: { price: 1, change_pct: null, captured_at: 2, source_ts: null } }
  assert.equal(valueSchema.safeParse(v1).success, true, 'v1 老行（没有这三格）必须照读')
  assert.equal(valueSchema.parse({ ...v1, quote: { ...v1.quote, currency: 'HKD', source_time: '2026-10-06 16:00:01' } }).quote.currency, 'HKD')
  assert.equal(valueSchema.safeParse({ ...v1, quote: { ...v1.quote, currency: '' } }).success, false, '币种要么有内容，要么不写这格')
  assert.equal(domainSpec.version, 1, '⛔ 拓宽不等于迁移：domain version 不动、不写 migrate')
})

test('exchange 取最后一个点号之后：`BRK.B.N` 的市场是 US，不是 `B`', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await instance.list()
    const offshore = await instance.add({ thscode: 'BRK.B.N' })
    assert.equal(offshore.ok, true)
    assert.equal(offshore.item.exchange, 'US', '⛔ `split(".")[1]` 在这里会取出 "B"')
    assert.equal(offshore.item.ticker, 'BRK.B', 'ticker 取最后一个点号之前那一段')
    assert.equal(offshore.item.asset_type, 'us-stock')
    assert.equal(fake.records.get('BRK.B.N').name, '伯克希尔b', '名称照上游第 3 段原样收（实测就是小写 b，不修饰）')

    const hkIndex = await instance.add({ thscode: 'HSI.HK' })
    assert.equal(hkIndex.item.asset_type, 'hk-index', '⛔ 字母 + `.HK` 落不进"美股"那一档（判序反向对照）')
    assert.equal(hkIndex.item.exchange, 'HK')
  } finally {
    stub.restore()
  }
})

test('⛔ 三路分派之后，上限这一闸仍然只许进一条：只差一格时港与美各问一次也只成一个', async () => {
  // 上一条测的锁是 A 股那一路；这一条测的是"搜索走 smartbox 的那两路"共用同一把锁——
  // 分派改了出网的去向，不该改读-改-写的互斥。
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await instance.list()
    for (let index = 0; index < MAX_ITEMS - SEED_ITEMS.length - 1; index += 1) await instance.add({ thscode: codeAt(index) })
    assert.equal(fake.records.size, MAX_ITEMS - 1)
    const two = await Promise.all([instance.add({ thscode: '00700.HK' }), instance.add({ thscode: 'AAPL.OQ' })])
    assert.equal(two.filter((one) => one.ok === true).length, 1, '只差一格就只许进一条')
    assert.equal(two.filter((one) => one.code === 'list_full').length, 1)
    assert.equal(fake.records.size, MAX_ITEMS, `清单被并发写成 ${fake.records.size} 条`)
  } finally {
    stub.restore()
  }
})

/**
 * ── 持仓标记（2026-10-09 加，主 Agent 经 `get_watchlist` 读的就是这一格）─────────────
 * 这一格是**用户自报**的权重，所以闸门全在"别说谎"上：没填 ≠ 0、取消 ≠ 换位置、
 * 刷新写回 ≠ 撤销用户的标记、指数 ≠ 可持有的标的。每条都配反向对照（把修复撤掉即红）。
 */

test('标记持仓：填比例 / 只标记不填 / 真填 0 是三态；取消标记不许把行甩到清单末尾', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await withHoldable(instance, fake)
    const before = [...fake.records.keys()]

    const marked = await instance.markHolding({ thscode: '300750.SZ', weight_pct: 20 })
    assert.equal(marked.ok, true)
    assert.equal(marked.item.holding.weight_pct, 20)
    assert.ok(Number.isInteger(marked.item.holding.marked_at), '标记时刻是整数 epoch：主 Agent 靠它判断这句话说了多久')

    const blank = await instance.markHolding({ thscode: '600519.SH', weight_pct: '' })
    assert.equal(blank.item.holding.weight_pct, null, '⛔ 留空是"标了持仓、比例没填"，落 null 而不是 0（Number(null) 就是 0）')

    const zero = await instance.markHolding({ thscode: '510300.SH', weight_pct: 0 })
    assert.equal(zero.item.holding.weight_pct, 0, '⛔ 0 是用户真填的数，不许被当成"没填"改写成 null')

    const absent = await instance.markHolding({ thscode: '00700.HK' })
    assert.equal(absent.item.holding.weight_pct, null, '缺字段与空串同一档')

    // 三个市场各标一条：闸门认的是**类型**而不是市场（A 股个股 / 场内 ETF / 港股 / 美股都可持有）。
    assert.equal((await instance.markHolding({ thscode: 'AAPL.OQ', weight_pct: 5 })).ok, true)

    const cleared = await instance.clearHolding({ thscode: '600519.SH' })
    assert.equal(cleared.ok, true)
    assert.equal(cleared.item.holding, undefined, '取消持仓就是没有这一格')
    assert.equal('holding' in fake.records.get('600519.SH'), false, '落盘的记录里不许留一个值为 undefined 的空格')
    assert.deepEqual(
      [...fake.records.keys()],
      before,
      '⛔ 取消标记不许改插入顺序：删键重插会把这一行甩到清单末尾——用户只是取消了一个标记，行却自己跳走了',
    )
  } finally {
    stub.restore()
  }
})

test('持仓比例的取值闸门：越界与非数一律 invalid_query，数字字符串照收', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await withHoldable(instance, fake)
    await instance.markHolding({ thscode: '300750.SZ', weight_pct: 20 })
    for (const bad of [-0.5, 100.5, 1000, 'abc', '  ', true, {}, [], Number.NaN]) {
      const result = await instance.markHolding({ thscode: '300750.SZ', weight_pct: bad })
      assert.equal(result.ok, false, `${JSON.stringify(bad)} 不该被接成持仓比例`)
      assert.equal(result.code, 'invalid_query')
    }
    assert.equal(fake.records.get('300750.SZ').holding.weight_pct, 20, '非法入参不许动已经落库的那一格')

    for (const good of [0, 100, '20', ' 20 ', 20]) {
      const result = await instance.markHolding({ thscode: '300750.SZ', weight_pct: good })
      assert.equal(result.ok, true, `${JSON.stringify(good)} 应当被接受（0–100 闭区间，数字字符串与 numberValue 同口径）`)
    }
    assert.equal(fake.records.get('300750.SZ').holding.weight_pct, 20, '" 20 " 归一成 20，不留字符串')
  } finally {
    stub.restore()
  }
})

test('标记持仓的标的边界：不在清单里 not_found、裸代码 invalid_query，都不许凭空造出一格', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await withHoldable(instance, fake)
    const missing = await instance.markHolding({ thscode: '000004.SZ', weight_pct: 10 })
    assert.equal(missing.ok, false)
    assert.equal(missing.code, 'not_found', '标记持仓不是添加自选：清单外的一只票不该被这一格凭空建出来')

    const bare = await instance.markHolding({ thscode: '300750', weight_pct: 10 })
    assert.equal(bare.code, 'invalid_query', '裸代码一律拒绝（`300750` 是哪一档由上游裁决，不由这里猜）')

    const clearMissing = await instance.clearHolding({ thscode: 'AMZN.OQ' })
    assert.equal(clearMissing.code, 'not_found')
    assert.equal(fake.records.size, SEED_ITEMS.length + HOLDABLE_ROWS.length, '三次失败一次都没写进域')
  } finally {
    stub.restore()
  }
})

test('刷新写回不许抹掉刚标的持仓', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await withHoldable(instance, fake)
    await instance.markHolding({ thscode: '300750.SZ', weight_pct: 35 })
    const stamp = fake.records.get('300750.SZ').holding.marked_at
    const refreshed = await instance.refresh()
    assert.equal(refreshed.ok, true)
    assert.equal(fake.records.get('300750.SZ').holding.weight_pct, 35, '写回只该换 quote 那一格')
    assert.equal(fake.records.get('300750.SZ').holding.marked_at, stamp, '标记时刻不许跟着一次刷新往前走')
    const row = refreshed.items.find((item) => item.thscode === '300750.SZ')
    assert.equal(row.holding.weight_pct, 35, '回包也要带着持仓，面板不必再读一次 /list')
  } finally {
    stub.restore()
  }
})

test('⛔ 刷新在途时标记与移除持仓，不许被写回撤销；在途被删的行不许带着持仓复活', async () => {
  // 与"刷新在途时的删除与置顶"同一扇窗、同一个形状，只是这一格原先不存在：
  // 面板一打开就自动刷新，而用户就在刷新那几秒里点「标记持仓」。
  const stub = stubFuyao()
  const { instance, fake } = service()
  const outer = globalThis.fetch
  let release
  let gateOn = false
  const gate = new Promise((resolve) => { release = resolve })
  globalThis.fetch = async (url, init) => {
    const pending = outer(url, init)
    if (gateOn) await gate
    return pending
  }
  try {
    await withHoldable(instance, fake)
    await instance.markHolding({ thscode: '300750.SZ', weight_pct: 12 })
    gateOn = true

    const running = instance.refresh()
    const marked = await instance.markHolding({ thscode: '600519.SH', weight_pct: 50 })
    const removed = await instance.remove({ thscode: '300750.SZ' })
    assert.equal(marked.ok, true, '标记当场回执成功')
    assert.equal(removed.ok, true, '删除当场回执成功')
    assert.equal(fake.records.has('300750.SZ'), false, '中间态：带着持仓的那条真的删掉了')

    release()
    const result = await running
    assert.equal(fake.records.get('600519.SH').holding.weight_pct, 50, '刷新写回用旧快照盖掉了刚标的持仓')
    assert.equal(fake.records.has('300750.SZ'), false, '刷新写回把刚删的标的连同它的持仓一起复活了')
    assert.equal(result.items.some((item) => item.thscode === '300750.SZ'), false, '回包也不许带它')
  } finally {
    globalThis.fetch = outer
    stub.restore()
  }
})

test('⛔ 类型闸门：指数不是一个可持有的标的，标不上、也不许留在域里', async () => {
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await withHoldable(instance, fake)
    for (const code of ['000001.SH', 'HSI.HK', 'IXIC.US', 'INX.US']) {
      const result = await instance.markHolding({ thscode: code, weight_pct: 20 })
      assert.equal(result.ok, false, `${code} 是指数，不该被接成仓位`)
      assert.equal(result.code, 'invalid_query', '不新增错误码：这一档就是"这个入参不成立"')
      assert.equal(fake.records.get(code).holding, undefined, '⛔ 被拒的请求连那一格都不许写进去（写了模型就真会读到一句用户没说过的话）')
    }
    // 未知类型同样不可标（闸门是白名单而不是"排除 *-index"）：这条靠上面四条已经证明，
    // 这里钉的是**同一份判定**认个股与场内基金——两个方向都要有证据，反选写法会静默放行未来新增的档。
    for (const code of ['300750.SZ', '510300.SH', '00700.HK', 'AAPL.OQ']) {
      assert.equal((await instance.markHolding({ thscode: code, weight_pct: 10 })).ok, true, `${code} 该能标`)
    }
  } finally {
    stub.restore()
  }
})

test('⛔ 闸门只拦"标"、不拦"取消"：一条遗留的指数持仓必须退得掉', async () => {
  // 类型改判之前（2026-10-09 早先那一版）指数是能标的，磁盘上可能就有这样的记录；手改 JSON 也造得出。
  // 若两边都拦：面板按类型不画取消出口、宿主又拒绝写 → 那一格被锁死在域里，而 get_watchlist 会一直
  // 把一句用户早已不认的话当他的仓位读。
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await instance.list()
    await fake.table.put('HSI.HK', { ...fake.records.get('HSI.HK'), holding: { weight_pct: 40, marked_at: 1_790_586_000_000 } })

    const remark = await instance.markHolding({ thscode: 'HSI.HK', weight_pct: 55 })
    assert.equal(remark.ok, true, '已经标过的行改比例仍走得通（拒它等于把用户锁在改不掉的错话上）')
    assert.equal(remark.item.holding.weight_pct, 55)

    const cleared = await instance.clearHolding({ thscode: 'HSI.HK' })
    assert.equal(cleared.ok, true, '取消持仓不声明任何领域事实，不需要类型闸门')
    assert.equal(cleared.item.holding, undefined)
    assert.equal(fake.records.get('HSI.HK').holding, undefined, '落盘也真的没了')
  } finally {
    stub.restore()
  }
})

test('⛔ 合计闸门：只做多的组合，占比加起来不许超过 120%', async () => {
  // 用户点名"我居然可以针对多只标的都填超过 50%"。单只 0–100 已经管住了，管不住的是**加起来**；
  // 额度按"其余持仓"算，所以这一格自己改小永远走得通（见下面第二条）。
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await withHoldable(instance, fake)
    assert.equal((await instance.markHolding({ thscode: '300750.SZ', weight_pct: 100 })).ok, true, '第一只吃满 100 是合法的')

    const tooMuch = await instance.markHolding({ thscode: '600519.SH', weight_pct: 30 })
    assert.equal(tooMuch.ok, false, '其余已占 100，这一格只剩 20')
    assert.equal(tooMuch.code, 'invalid_query', '不新增错误码：这一档同样是"这个入参不成立"')
    assert.match(tooMuch.message, /100/, '拒绝的理由要说得出剩余额度，光回 invalid_query 用户只看到按不动')
    assert.equal(fake.records.get('600519.SH').holding, undefined, '⛔ 被拒的写入连那一格都不许落盘')

    assert.equal((await instance.markHolding({ thscode: '600519.SH', weight_pct: 20 })).ok, true, '正好 120 —— 到线不越线')
    const noRoom = await instance.markHolding({ thscode: '510300.SH', weight_pct: 1 })
    assert.equal(noRoom.ok, false, '额度用完了，再加一格都不行')
    assert.equal(noRoom.code, 'invalid_query')
  } finally {
    stub.restore()
  }
})

test('⛔ 合计闸门只拦"变大"：已超额的数据必须还能改小、勾上没填永远放行', async () => {
  // 手改 JSON 或旧版本都能造出"每一只都不越单只上限、加起来却 200%"的一份域（正是用户点名的形态）。
  // 若闸门连"改小"与"先勾上"一起拦，用户就再也出不去了——与类型闸门不拦 clearHolding 同一族理由。
  const stub = stubFuyao()
  const { instance, fake } = service()
  try {
    await withHoldable(instance, fake)
    const stamp = async (code, weight) => fake.table.put(code, { ...fake.records.get(code), holding: { weight_pct: weight, marked_at: 1 } })
    await stamp('300750.SZ', 100)
    await stamp('600519.SH', 100)

    assert.equal((await instance.markHolding({ thscode: '600519.SH', weight_pct: 10 })).ok, true, '其余 100、这一格从 100 改到 10：改小必须通')
    assert.equal((await instance.markHolding({ thscode: '300750.SZ', weight_pct: 0 })).ok, true, '0 是一个真数（这一只出清了），也是一次改小')

    await stamp('510300.SH', 100)
    await stamp('00700.HK', 100) // 此刻 0 + 10 + 100 + 100 = 210%，额度对 AAPL 已经是 0
    const markedEmpty = await instance.markHolding({ thscode: 'AAPL.OQ', weight_pct: null })
    assert.equal(markedEmpty.ok, true, '勾上、比例留空：不加重，闸门不参与（否则超额旧数据会堵死"先勾上再慢慢填"）')
    assert.equal(markedEmpty.item.holding.weight_pct, null)
    assert.equal((await instance.markHolding({ thscode: 'AAPL.OQ', weight_pct: 1 })).ok, false, '但只要真要填一个数，超额的那 210 就算在其余持仓里')
    assert.equal((await instance.clearHolding({ thscode: '510300.SH' })).ok, true, '退一格同样永远放行')
  } finally {
    stub.restore()
  }
})

test('holding 是可选字段：没有这一格的 v1 老记录照样过 schema，非法形态在持久边界就被拒', () => {
  // 与 pinned_at 同一条理由：域在加载边界逐条校验，写成必填（或 nullable + 默认值）会让
  // 现有清单一次读就 invalid-record → 整条路由 store_unavailable。
  const legacy = {
    thscode: '000001.SH', ticker: '000001', name: '上证指数', exchange: 'SH', asset_type: 'a-share-index',
    added_at: 1, source: 'seed', quote: null,
  }
  const schema = domainSpec.tables.items.valueSchema
  assert.equal(schema.parse(legacy).holding, undefined, '没有这一格 = 未持仓，不需要迁移、不抬 domain version')
  assert.equal(schema.parse({ ...legacy, holding: { weight_pct: null, marked_at: 5 } }).holding.weight_pct, null)
  assert.equal(schema.safeParse({ ...legacy, holding: { weight_pct: 120, marked_at: 5 } }).success, false, '越界比例进不了域')
  assert.equal(schema.safeParse({ ...legacy, holding: { weight_pct: 10, marked_at: 'now' } }).success, false, '标记时刻只接受整数')
  assert.equal(schema.safeParse({ ...legacy, holding: { weight_pct: 10 } }).success, false, '标了持仓就必须留下标记时刻')
  assert.equal(schema.safeParse({ ...legacy, holding: null }).success, false,
    '⛔ 外部不写 nullable：「没有这一格」与「这一格是 null」是两句话，一种意思只留一种写法')
})
