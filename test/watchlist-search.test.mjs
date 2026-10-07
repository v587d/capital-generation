/**
 * 搜索与消歧（自选股唯一的上游入口）。
 *
 * 断言的是**出网参数**与**规范化结果**两件事：范围收窄必须发生在入参上
 * （`asset_type` 白名单 + `limit` 那一档），否则场外基金 / 外汇 / 期货会混进候选，
 * 并把"不支持的标的"和"没有匹配"揉成同一个错——那正是 R4 会失效的地方。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SEARCH_ASSET_TYPES, SEARCH_BRANCH_LIMITS, SEARCH_LIMIT, createWatchlistService, keyFormOf, normalizeThscode } from '../capital-watchlist/index.js'
import { fetchSmartbox, parseSmartbox } from '../lib/sources/tencent-public-core.js'
import { FIXTURES, SMARTBOX_ROWS, createFakeDomain, stubFuyao } from './watchlist-harness.mjs'

/** 出网按家数分开数：三路并发之后"总共几次"不是判据，"哪一家几次"才是。 */
const callsTo = (calls, needle) => calls.filter((call) => call.url.includes(needle))

function run(searchStub, options = {}) {
  const fake = createFakeDomain()
  const service = createWatchlistService({
    openDomain: async () => fake.domain,
    resolveApiKey: async () => 'test-key',
    now: () => 1_790_586_000_000,
    ...options,
  })
  return { service, fake, stub: searchStub }
}

test('出网参数里必须带 asset_type 白名单与 limit=20（断参数，不只断解析）', async () => {
  const stub = stubFuyao()
  const { service } = run(stub)
  try {
    const result = await service.search('300750')
    assert.equal(result.ok, true)
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].thscode, '300750.SZ')
    assert.equal(result.items[0].in_list, false, '还没入库')

    const url = new URL(stub.calls[0].url)
    assert.equal(url.searchParams.get('asset_type'), SEARCH_ASSET_TYPES, '收窄做在入参上')
    assert.equal(url.searchParams.get('limit'), String(SEARCH_BRANCH_LIMITS['a-share']), 'A 股那一路要满一屏的量：官方 limit 取值 1~50，默认才是 10')
    assert.equal(url.pathname, '/api/meta/tickers/search')
  } finally {
    stub.restore()
  }
})

test('三态输入（裸码 / 中文名 / 带后缀）都归一到同一个 thscode', async () => {
  const stub = stubFuyao()
  const { service } = run(stub)
  try {
    const byName = await service.search('宁德时代')
    const byCode = await service.search('300750')
    const byFull = await service.search('300750.SZ')
    for (const result of [byName, byCode, byFull]) {
      assert.equal(result.ok, true)
      assert.equal(result.items[0].thscode, '300750.SZ')
    }
    assert.deepEqual(byFull.items[0], byCode.items[0], '三种写法是同一条候选')
  } finally {
    stub.restore()
  }
})

test('白名单之外的 asset_type 在路由层就被丢掉（场外基金没有实时报价）', async () => {
  const stub = stubFuyao()
  const { service } = run(stub)
  try {
    const result = await service.search('OTC')
    assert.equal(result.ok, true)
    assert.deepEqual(result.items, [], '上游给了 fund-otc，我们也不把它塞进候选')
  } finally {
    stub.restore()
  }
})

test('一屏给到 20 条；两种"还有更多"都要报 truncated', async () => {
  // 合并后撞显示上限：A 股那一路一次给满 20 条（Fuyao `limit` 官方取值 1~50，这里取到与显示上限齐平）。
  const many = {
    code: 0,
    data: {
      timestamp: 1,
      item: Array.from({ length: SEARCH_BRANCH_LIMITS['a-share'] }, (unused, index) => ({
        thscode: `159${String(index).padStart(3, '0')}.SZ`,
        ticker: `159${String(index).padStart(3, '0')}`,
        name: `ETF ${index}`,
        exchange: 'SZ',
        asset_type: 'fund-etf',
      })),
    },
  }
  const stub = stubFuyao({ '/api/meta/tickers/search': many })
  const { service } = run(stub)
  try {
    const result = await service.search('ETF')
    assert.equal(result.items.length, SEARCH_LIMIT)
    assert.equal(result.truncated, true, '撞上限要告诉用户"缩小输入"，而不是让他以为只有这些')
  } finally {
    stub.restore()
  }

  // 另一种更隐蔽：合并后**不到** 20 条，但港那一路回满了它自己那一档（smartbox 实测硬顶 10 条，
  // 多要也不会多给）。这一路的"还有更多"只看它自己的预算——按 `SEARCH_LIMIT` 判就会静默说"就这些"。
  const tenHk = `v_hint="${Array.from({ length: 10 }, (unused, index) => `hk~${String(1000 + index)}~\u6e2f\u80a1${index}~gg${index}~GP`).join('^')}";`
  const narrow = stubFuyao({ 'smartbox.gtimg.cn': (url) => (url.includes('t=hk') ? tenHk : 'v_hint="N";') })
  const second = run(narrow)
  try {
    const result = await second.service.search('测试')
    assert.equal(result.items.length, 10, '一屏没满')
    assert.equal(result.truncated, true, '⛔ 港那一路被上游砍在自己那一档，同样要告诉用户"缩小输入"')
  } finally {
    narrow.restore()
  }
})

test('空输入与超长输入是本地错误，绝不发一次出网请求', async () => {
  const stub = stubFuyao()
  const { service } = run(stub)
  try {
    for (const query of ['', '   ', 'x'.repeat(65)]) {
      const result = await service.search(query)
      assert.equal(result.ok, false)
      assert.equal(result.code, 'invalid_query')
    }
    assert.equal(stub.calls.length, 0, '校验在出网之前')
  } finally {
    stub.restore()
  }
})

test('同花顺指数（.TI）这类非沪深后缀不进候选：不挡掉就是"添加"那一下 500', async () => {
  // 实测：`q=宁德时代` 会带回 `885789.TI 宁德时代概念`（exchange 为 null）。
  const stub = stubFuyao({
    '/api/meta/tickers/search': {
      code: 0,
      data: {
        timestamp: 1,
        item: [
          { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share' },
          { thscode: '885789.TI', ticker: '885789', name: '宁德时代概念', exchange: null, asset_type: 'a-share-index' },
        ],
      },
    },
  })
  const { service } = run(stub)
  try {
    const found = await service.search('宁德时代')
    assert.deepEqual(found.items.map((row) => row.thscode), ['300750.SZ'], '.TI 必须被挡在候选之外')
    const added = await service.add({ q: '宁德时代' })
    assert.equal(added.ok, true, '只剩一条合法候选 ⇒ 直接入库，不再报歧义')
  } finally {
    stub.restore()
  }
})

test('normalizeThscode：trim + 大写；五种形状都收，裸码 / 北交所 / 场外都拿不到 thscode', async () => {
  assert.equal(normalizeThscode(' 300750.sz '), '300750.SZ')
  assert.equal(normalizeThscode('600519.SH'), '600519.SH')
  // 2026-10-07 起清单接受五种 canonical 键（设计文档 §3.4）。
  for (const input of ['00700.HK', 'HSI.HK', 'AAPL.OQ', 'BRK.B.N', 'IXIC.US']) {
    assert.equal(normalizeThscode(` ${input.toLowerCase()} `), input, `${input} 是合法键`)
  }
  for (const input of ['300750', '920002.BJ', '012414.OF', '', undefined, 42, 'ABCDEF.SH', 'HSI.SZ', 'AAPL', 'HK00700', '.IXIC']) {
    assert.equal(normalizeThscode(input), undefined, `${String(input)} 不该被接受`)
  }
  // ⛔ `.SH` / `.SZ` / `.HK` / `.US` 这四个尾段是我们自己占的市场标记：字母代码带着它们
  // 不能同时又被当成"美股身份"，否则一个不存在的键能进清单、还能去敲腾讯的门。
  assert.equal(keyFormOf('BRK.B.N').form, 'us-stock')
  assert.equal(keyFormOf('HSI.HK').form, 'hk-index', '⛔ `HSI.HK` 落不进美股分支（判序反向对照）')
  assert.equal(keyFormOf('SSPX.AM').form, 'us-stock', '⛔ `SSPX.AM` 落不进指数分支（P19 那只 ETF）')
})

test('一路失败只降那一路：A 股搜索挂了，候选里仍给港美股，失败进 partial', async () => {
  // R12：`credential_missing` / `fuyao_unavailable` 的射程从"整块面板"缩到"A 股那一路"。
  // 只有三路全挂才许占用居中位（下面那条用例测的就是这一半）。
  const stub = stubFuyao({ '/api/meta/tickers/search': { status: 503, body: {} }, 'smartbox.gtimg.cn': (url) => (url.includes('t=us') ? SMARTBOX_ROWS['us|腾讯'] : 'v_hint="N";') })
  const { service } = run(stub)
  try {
    const result = await service.search('腾讯')
    assert.equal(result.ok, true, '半边失败不是查询失败')
    assert.deepEqual(result.partial, [{ market: 'a-share', code: 'fuyao_unavailable' }])
    assert.notEqual(result.partial[0].code, 'quote_unavailable', '"查不到"不能写成"这个标的没有报价"')
    assert.deepEqual(result.items.map((item) => item.thscode), ['TCEHY.PS', 'TCTZF.PS', 'TME.N', 'NPSNY.PS'], '美股那一路照常给候选')
  } finally {
    stub.restore()
  }
})

test('三路全挂才算整块失败：code 取最能指导动作那一路，scope 是 all', async () => {
  const stub = stubFuyao({ '/api/meta/tickers/search': { status: 503, body: {} }, 'smartbox.gtimg.cn': (url) => { throw new Error('smartbox down') } })
  const { service } = run(stub)
  try {
    const result = await service.search('腾讯')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'fuyao_unavailable')
    assert.equal(result.scope, 'all', '⛔ 只有全部路都失败才允许占用面板居中位')
  } finally {
    stub.restore()
  }
})

test('没配密钥时：A 股那一路点名 credential_missing，港美股那两路照常给（不是含糊的"查询失败"）', async () => {
  const stub = stubFuyao({ 'smartbox.gtimg.cn': (url) => (url.includes('t=hk') ? SMARTBOX_ROWS['hk|00700'] : SMARTBOX_ROWS['us|TCEHY']) })
  const { service } = run(stub, { resolveApiKey: async () => undefined })
  try {
    const result = await service.search('腾讯')
    assert.equal(result.ok, true)
    assert.deepEqual(result.partial, [{ market: 'a-share', code: 'credential_missing' }], '缺密钥要说"缺密钥"，不是"查询失败"')
    assert.deepEqual(result.items.map((item) => item.thscode), ['00700.HK', 'TCEHY.PS'])
    assert.equal(callsTo(stub.calls, 'fuyao.aicubes.cn').length, 0, '没有 key 就不该把 A 股那笔发出去')
    assert.equal(callsTo(stub.calls, 'smartbox.gtimg.cn').length, 2, '腾讯这两路本来就不要密钥')
  } finally {
    stub.restore()
  }
})

/**
 * 三路并发合并（设计文档 §3.2）。Fuyao 那一路这里**借用**真报文 `searchCatl`（`300750.SZ 宁德时代`）：
 * 本用例测的是"三条上游的结果怎么并成一屏"，不是"腾讯这只票在 Fuyao 叫什么"——
 * 后者今天没有实测回执，就不许写成 fixture。
 */
test('一次输入三路并发：A 股 + 港 + 美并成一屏，窝轮被白名单挡在门外', async () => {
  const stub = stubFuyao({
    '/api/meta/tickers/search': FIXTURES.searchCatl,
    'smartbox.gtimg.cn': (url) => (url.includes('t=hk') ? SMARTBOX_ROWS['hk|腾讯'] : url.includes('t=us') ? SMARTBOX_ROWS['us|腾讯'] : 'v_hint="N";'),
  })
  const { service } = run(stub)
  try {
    const result = await service.search('腾讯')
    assert.equal(result.ok, true)
    assert.deepEqual(result.items.map((item) => item.thscode), ['300750.SZ', '00700.HK', '80700.HK', '01698.HK', 'TCEHY.PS', 'TCTZF.PS', 'TME.N', 'NPSNY.PS'])
    // ⛔ P17 的那一条：`t=hk&q=腾讯` 十条里七条是窝轮 `QZ`，过滤后必须**只剩 3 条**——
    // 剩 10 条是白名单没生效，剩 0 条是把 `QZ` 与 `GP` 一起拒了（两种都是真的取数事故）。
    assert.equal(result.items.filter((item) => item.exchange === 'HK').length, 3)
    assert.deepEqual(result.items.filter((item) => item.exchange === 'US').map((item) => item.asset_type), ['us-stock', 'us-stock', 'us-stock', 'us-stock'])
    assert.equal(result.truncated, false, '合并后 8 条 < 10，不算截断')
    assert.equal(callsTo(stub.calls, 'smartbox.gtimg.cn').length, 2, '港、美各一笔：共用一次 t=all 会让美股常年假空')
    assert.deepEqual(callsTo(stub.calls, 'smartbox.gtimg.cn').map((call) => /[?&]t=([^&]+)/.exec(call.url)[1]).sort(), ['hk', 'us'])
  } finally {
    stub.restore()
  }
})

test('精确代码优先：输入就是那只票的代码时它排第一（跨三路都算）', async () => {
  const stub = stubFuyao({ 'smartbox.gtimg.cn': (url) => (url.includes('t=hk') ? SMARTBOX_ROWS['hk|腾讯'] : SMARTBOX_ROWS['us|腾讯']) })
  const { service } = run(stub)
  try {
    const byCode = await service.search('tcehy')
    assert.equal(byCode.items[0].thscode, 'TCEHY.PS', '大小写与"缺市场后缀"都要认（stem 比对）')
    const fullKey = await service.search('00700.HK')
    assert.equal(fullKey.items[0].thscode, '00700.HK', 'canonical 键原样也要能命中自己（面板回填与去重靠这一条）')
  } finally {
    stub.restore()
  }
})

test('⛔ smartbox 的 `N` 哨兵与非法 `t`：都解析成"零条"，但 `t` 只许是那两个常量', async () => {
  // 实测 P16：`t=hk,us` / `t=hf` 这类上游不认的值回的是**同一个** `N`。所以上游那一侧无法区分
  // "没有这个票"与"参数写错了"——区分只能做在我们这一侧：`t` 取自常量表，且内核直接拒掉别的值。
  assert.deepEqual(parseSmartbox('v_hint="N";'), [], '无命中不是畸形回包，不许烧一次红字给用户')
  assert.deepEqual(parseSmartbox('v_hint="";'), [], '空正文同样是零条')
  await assert.rejects(() => fetchSmartbox('腾讯', 'hk,us', AbortSignal.timeout(1000)), /smartbox market must be one of/u,
    '列表形态在参数层就响亮失败，不许走到"回 N 所以当没有这票"')
  const stub = stubFuyao()
  const { service } = run(stub)
  try {
    const result = await service.search('zzzzqqqq')
    assert.equal(result.ok, true, '查无此票不是错误')
    assert.deepEqual(result.items, [])
    assert.equal(result.partial, undefined, '三路都正常回了 N，不是哪一路挂了')
    assert.equal(callsTo(stub.calls, 'smartbox.gtimg.cn').length, 2)
  } finally {
    stub.restore()
  }
})

test('`00700` 同时命中港与 A 两只票：键不撞、两条都在（P5 的那一条）', async () => {
  const stub = stubFuyao({
    '/api/meta/tickers/search': { code: 0, data: { timestamp: 1, item: [{ thscode: '000700.SZ', ticker: '000700', name: '模塑科技', exchange: 'SZ', asset_type: 'a-share' }] } },
    'smartbox.gtimg.cn': (url) => (url.includes('t=hk') ? SMARTBOX_ROWS['hk|00700'] : 'v_hint="N";'),
  })
  const { service } = run(stub)
  try {
    const result = await service.search('00700')
    assert.deepEqual(result.items.map((item) => [item.thscode, item.name]), [['00700.HK', '腾讯控股'], ['000700.SZ', '模塑科技']],
      '⛔ 5 位港码与 6 位 A 码形状可分但同屏并列：候选必须带完整 canonical 代码，裸码并列就是点错加错票')
    const added = await service.add({ thscode: '00700.HK' })
    assert.equal(added.item.asset_type, 'hk-stock')
    assert.equal(added.item.exchange, 'HK', 'exchange 这一格存的是市场')
    assert.equal((await service.search('00700')).items.find((item) => item.thscode === '00700.HK').in_list, true, '已添加要跨三路认得')
  } finally {
    stub.restore()
  }
})

test('类型段决定行类，不由代码段猜：ZS 进指数、GP 进个股（含 ETF）', async () => {
  // 两条真回包都进了默认路由：`t=hk&q=HSTECH` 同时回指数与一只 ETF，`t=us&q=QQQ` 回的全是 ETF。
  const stub = stubFuyao()
  const { service } = run(stub)
  try {
    const indexes = await service.search('HSTECH')
    assert.deepEqual(indexes.items.map((item) => [item.thscode, item.asset_type]), [['HSTECH.HK', 'hk-index'], ['03032.HK', 'hk-stock']],
      '同一个写法既回指数也回 ETF：两档由类型段分开')
    const etfs = await service.search('QQQ')
    assert.deepEqual(etfs.items.map((item) => item.asset_type), ['us-stock', 'us-stock'],
      '美股 ETF 归 `us-stock`（P6：搜索阶段分不出 ETF 与个股，徽标那一层如实缺失）')
    assert.deepEqual(etfs.items.map((item) => item.ticker), ['QQQ', 'QQQA'], 'ticker 取最后一个点号之前那一段')
  } finally {
    stub.restore()
  }
})

test('⛔ 直加 canonical 键必须先剥成 stem：smartbox 认不下 `00700.HK` / `TCEHY.PS` 这种写法', async () => {
  // 实测（2026-10-07）：把这四种键原样丢给检索，回的全是 `N` 哨兵——和"查无此票"同一个回文。
  // 拿它当"没有这只票"就是把一只真票判成不存在，所以 `/add` 用 stem 去问、再按键比回来。
  const stub = stubFuyao()
  const { service } = run(stub)
  try {
    for (const [key, hit] of [['00700.HK', '00700.HK'], ['HSI.HK', 'HSI.HK'], ['TCEHY.PS', 'TCEHY.PS'], ['IXIC.US', 'IXIC.US'], ['BRK.B.N', 'BRK.B.N']]) {
      const added = await service.add({ thscode: key })
      assert.equal(added.ok, true, `${key} 该加得进去`)
      assert.equal(added.item.thscode, hit)
    }
    const asked = callsTo(stub.calls, 'smartbox.gtimg.cn').map((call) => decodeURIComponent(/q=([^&]*)/.exec(call.url)[1]))
    assert.deepEqual(asked.slice(0, 10), ['00700', '00700', 'HSI', 'HSI', 'TCEHY', 'TCEHY', 'IXIC', 'IXIC', 'BRK.B', 'BRK.B'],
      '问出去的是 stem；每只两次是"搜索 + 入库前核对"各一次，不是重试')
  } finally {
    stub.restore()
  }
})
