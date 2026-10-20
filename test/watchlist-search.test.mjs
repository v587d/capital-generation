/**
 * Search and disambiguation. Assertions cover outbound parameters and normalised results: scope must
 * narrow on the way in (`asset_type` whitelist + per-branch `limit`), otherwise OTC funds, FX and futures
 * leak into candidates and "unsupported" collapses into "no match".
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SEARCH_ASSET_TYPES, SEARCH_BRANCH_LIMITS, createWatchlistService, keyFormOf, normalizeThscode } from '../watchlist/index.js'
import { fetchSmartbox, parseSmartbox } from '../lib/sources/tencent-public-core.js'
import { FIXTURES, SMARTBOX_ROWS, createFakeDomain, stubFuyao } from './watchlist-harness.mjs'

/** Per-provider outbound counts: after three concurrent routes the judge is "which provider, how often", not the total. */
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

test('出网参数里必须带 asset_type 白名单与那一档 limit（断参数，不只断解析）', async () => {
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

test('候选池全量返回（⛔ 不再切 20）；两种"还有更多"各自都要报 truncated', async () => {
  // The A-share branch fills its own limit and hands every row back: no second page upstream, so cutting only hides rows.
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
    assert.equal(result.items.length, SEARCH_BRANCH_LIMITS['a-share'], '⛔ 回多少画多少：50 条一条都不许切')
    assert.equal(result.truncated, true, '回满自己那一档 ⇒ 上游那侧被砍了，要提示"请输入更准确的…"')
  } finally {
    stub.restore()
  }

  // The subtler case: the merged total is far below the pool ceiling, but the HK branch filled its own budget.
  const tenHk = `v_hint="${Array.from({ length: 10 }, (unused, index) => `hk~${String(1000 + index)}~\u6e2f\u80a1${index}~gg${index}~GP`).join('^')}";`
  const narrow = stubFuyao({ 'smartbox.gtimg.cn': (url) => (url.includes('t=hk') ? tenHk : 'v_hint="N";') })
  const second = run(narrow)
  try {
    const result = await second.service.search('测试')
    assert.equal(result.items.length, 10, 'A 股空手 + 港 10 条，全给')
    assert.equal(result.truncated, true, '⛔ 港那一路被上游砍在自己那一档，同样要提示"请输入更准确的…"')
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
  // Upstream answers a name query with `885789.TI` (exchange null), so non SH/SZ suffixes must be filtered here.
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
  // The list accepts five canonical key shapes (design doc §3.4).
  for (const input of ['00700.HK', 'HSI.HK', 'AAPL.OQ', 'BRK.B.N', 'IXIC.US']) {
    assert.equal(normalizeThscode(` ${input.toLowerCase()} `), input, `${input} 是合法键`)
  }
  for (const input of ['300750', '920002.BJ', '012414.OF', '', undefined, 42, 'ABCDEF.SH', 'HSI.SZ', 'AAPL', 'HK00700', '.IXIC']) {
    assert.equal(normalizeThscode(input), undefined, `${String(input)} 不该被接受`)
  }
  // `.SH` / `.SZ` / `.HK` / `.US` are our own market markers: an alphabetic code may not also read as US identity.
  assert.equal(keyFormOf('BRK.B.N').form, 'us-stock')
  assert.equal(keyFormOf('HSI.HK').form, 'hk-index', '⛔ `HSI.HK` 落不进美股分支（判序反向对照）')
  assert.equal(keyFormOf('SSPX.AM').form, 'us-stock', '⛔ `SSPX.AM` 落不进指数分支（P19 那只 ETF）')
})

test('一路失败只降那一路：A 股搜索挂了，候选里仍给港美股，失败进 partial', async () => {
  // R12: `credential_missing` / `fuyao_unavailable` shrink from the whole panel to the A-share route.
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

// Three-route merge: borrows the real `searchCatl` payload for Fuyao, because "what this Tencent instrument is
// called in Fuyao" has no measured receipt and therefore must not become a fixture.
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
    // The HK name query is mostly warrant rows (`QZ`): filtering must leave exactly 3 — 10 is a missed whitelist, 0 rejects `GP` too.
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
  // An unknown `t` answers with the same `N` sentinel, so "no match" vs "bad parameter" is only separable here.
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
  // Both bodies go through the default route: `t=hk&q=HSTECH` returns an index and an ETF, `t=us&q=QQQ` only ETFs.
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
  // Canonical keys sent verbatim return the `N` sentinel, the same body as "no such instrument": `/add` asks with the stem.
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

// Fuyao `q` is case-sensitive substring matching while smartbox is not, so the extra query happens only on the
// A-share route and only when `q` really contains ASCII lowercase.
const envelope = (items) => ({ code: 0, data: { timestamp: 1, item: items } })
const aRow = (code) => ({ thscode: `${code}.SZ`, ticker: code, name: `标的${code}`, exchange: 'SZ', asset_type: 'a-share' })
/** Fuyao fixture branching on `q`: the lowercase arm returns 0 rows like the real upstream, the uppercase arm returns the given rows. */
const fuyaoByCase = (upperRows, lowerRows = []) => ({
  '/api/meta/tickers/search': (url) => {
    const asked = new URL(url).searchParams.get('q')
    return envelope(asked === asked.toUpperCase() ? upperRows : lowerRows)
  },
})

test('⛔ 小写查询要问两笔（原样 + 全大写）：大写那一支把 A 股候选救回来', async () => {
  const rows = [aRow('000100'), aRow('002129'), aRow('002668')]
  const stub = stubFuyao(fuyaoByCase(rows))
  const { service } = run(stub)
  try {
    const result = await service.search('tcl')
    assert.equal(result.ok, true)
    assert.deepEqual(result.items.map((item) => item.thscode), ['000100.SZ', '002129.SZ', '002668.SZ'],
      '原样那一笔 0 条（真上游就是这个行为），候选只能由全大写那一笔带回')
    assert.equal(result.partial, undefined, '原样那笔**正常回了 0 条**不是"哪一路挂了"')

    const asked = callsTo(stub.calls, 'fuyao.aicubes.cn').map((call) => new URL(call.url).searchParams.get('q')).sort()
    assert.deepEqual(asked, ['TCL', 'tcl'], '⛔ 两笔都要出网：只发大写会丢小写专有命中，只发原样等于复现这个 bug')
    for (const call of callsTo(stub.calls, 'fuyao.aicubes.cn')) {
      const url = new URL(call.url)
      assert.equal(url.searchParams.get('asset_type'), SEARCH_ASSET_TYPES, '白名单两笔都得带')
      assert.equal(url.searchParams.get('limit'), String(SEARCH_BRANCH_LIMITS['a-share']), '两笔都是同一档 limit')
    }
    assert.equal(callsTo(stub.calls, 'smartbox.gtimg.cn').length, 2, '港美股那两路照旧各一笔，不跟着多问')
  } finally {
    stub.restore()
  }
})

test('不含 ASCII 小写就不多发：全大写 / 纯数字 / 中文各只问 Fuyao 一笔', async () => {
  const stub = stubFuyao()
  const { service } = run(stub)
  try {
    for (const query of ['ETF', '300750', '宁德时代']) {
      stub.calls.length = 0
      await service.search(query)
      assert.equal(callsTo(stub.calls, 'fuyao.aicubes.cn').length, 1, `${query} 的原样与大写是同一个词，发两笔就是白烧一次配额`)
      assert.equal(callsTo(stub.calls, 'smartbox.gtimg.cn').length, 2, '腾讯那两路不受影响')
    }
  } finally {
    stub.restore()
  }
})

test('两笔按 canonical 键去重，原样那一份排前面（同一只票不许出现两行）', async () => {
  const stub = stubFuyao(fuyaoByCase([aRow('000002'), aRow('000003')], [aRow('000001'), aRow('000002')]))
  const { service } = run(stub)
  try {
    const result = await service.search('abc')
    assert.deepEqual(result.items.map((item) => item.thscode), ['000001.SZ', '000002.SZ', '000003.SZ'],
      '两笔的并集去重；重叠的 000002 由原样那一笔先给出（上游顺序口径不变）')
  } finally {
    stub.restore()
  }
})

test('半边失败：拿到候选就算这一路答上了；一支候选都没拿到才进 partial', async () => {
  // Original-case call 503, uppercase call fine: candidates are still handed out and the route is not also called unavailable.
  const half = stubFuyao({
    '/api/meta/tickers/search': (url) => {
      const asked = new URL(url).searchParams.get('q')
      return asked === asked.toUpperCase() ? envelope([aRow('000100')]) : { status: 503, body: {} }
    },
  })
  const { service } = run(half)
  try {
    const result = await service.search('tcl')
    assert.equal(result.ok, true)
    assert.deepEqual(result.items.map((item) => item.thscode), ['000100.SZ'])
    assert.equal(result.partial, undefined, '⛔ 有候选就别再说这一路"不可用"')
  } finally {
    half.restore()
  }

  // Both calls down: still "the A-share route did not participate", not "this instrument does not exist".
  const down = stubFuyao({ '/api/meta/tickers/search': { status: 503, body: {} } })
  const second = run(down)
  try {
    const result = await second.service.search('tcl')
    assert.equal(result.ok, true, '港美股那两路还活着，整块不算失败')
    assert.deepEqual(result.partial, [{ market: 'a-share', code: 'fuyao_unavailable' }])
    assert.deepEqual(result.items, [])
  } finally {
    down.restore()
  }
})

test('"回满自己那一档"按**笔**算：两笔各 15 条、并起来 20 条不许说还有更多', async () => {
  // Neither call was cut (15 < limit 50); judging on the merged count would invent a "there is more" tip.
  const lower = Array.from({ length: 15 }, (unused, index) => aRow(String(100001 + index)))
  const upper = Array.from({ length: 15 }, (unused, index) => aRow(String(100006 + index)))
  const stub = stubFuyao(fuyaoByCase(upper, lower))
  const { service } = run(stub)
  try {
    const result = await service.search('abc')
    assert.equal(result.items.length, 20, '并集 20 条（15 + 15，重叠 10），一条不切')
    assert.equal(result.truncated, false, '⛔ 没有一笔被上游砍过，就不许说"还有更多"')
  } finally {
    stub.restore()
  }

  // Counter-case: one call really did fill its limit (50), so "there is more" must be said.
  const cut = stubFuyao(fuyaoByCase(Array.from({ length: SEARCH_BRANCH_LIMITS['a-share'] }, (unused, index) => aRow(String(200001 + index)))))
  const second = run(cut)
  try {
    const result = await second.service.search('abc')
    assert.equal(result.truncated, true, '⛔ 另一支空手、这一支回满自己那一档 ⇒ 上游那侧确实被砍了')
  } finally {
    cut.restore()
  }
})

test('⛔ 两笔并起来超过这一档时自己砍的那一刀也算"被砍"：items 正好 50、truncated 为真', async () => {
  // 40 + 40 without overlap: no single call filled, but we keep 50 and hide 30 ourselves — that counts as cut too.
  const lower = Array.from({ length: 40 }, (unused, index) => aRow(String(500001 + index)))
  const upper = Array.from({ length: 40 }, (unused, index) => aRow(String(500041 + index)))
  const stub = stubFuyao(fuyaoByCase(upper, lower))
  const { service } = run(stub)
  try {
    const result = await service.search('abc')
    assert.equal(result.items.length, SEARCH_BRANCH_LIMITS['a-share'], '并集 80 → 只留这一档的 50')
    assert.equal(result.truncated, true, '⛔ 自己砍掉 30 行就必须说还有更多')
  } finally {
    stub.restore()
  }
})

test('⛔ 候选池上界 = 三路上游硬顶之和（50 + 10 + 10 = 70），顺序仍是 A 股 → 港 → 美', async () => {
  // No pagination: the ceiling is the upstream hard caps, and merge order stays A-share → HK → US
  // (filtering lives in the dropdown header, not in the merge order).
  const aRows = Array.from({ length: SEARCH_BRANCH_LIMITS['a-share'] }, (unused, index) => aRow(String(600001 + index)))
  const hkRows = Array.from({ length: SEARCH_BRANCH_LIMITS.hk }, (unused, index) => `hk~${String(10000 + index)}~港股${index}~gg${index}~GP`)
  const usRows = Array.from({ length: SEARCH_BRANCH_LIMITS.us }, (unused, index) => `us~TK${String.fromCharCode(65 + index)}.OQ~美股${index}~usg${index}~GP`)
  const stub = stubFuyao({
    '/api/meta/tickers/search': { code: 0, data: { timestamp: 1, item: aRows } },
    'smartbox.gtimg.cn': (url) => {
      const market = /[?&]t=([^&]+)/.exec(url)[1]
      return `v_hint="${(market === 'hk' ? hkRows : usRows).join('^')}";`
    },
  })
  const { service } = run(stub)
  try {
    const result = await service.search('ETF')
    assert.equal(result.ok, true)
    assert.equal(result.items.length, 70, '⛔ 50 + 10 + 10 = 70，一条不许切（上游没有第二页）')
    assert.deepEqual(
      [result.items[0].exchange, result.items[SEARCH_BRANCH_LIMITS['a-share'] - 1].exchange, result.items[SEARCH_BRANCH_LIMITS['a-share']].exchange, result.items.at(-1).exchange],
      ['SZ', 'SZ', 'HK', 'US'],
      '顺序仍是 A 股 → 港 → 美（筛选交给下拉顶部的筛选头，不改合并顺序）')
    assert.equal(result.truncated, true, '三路各自回满自己那一档 ⇒ 上游那侧都被砍了')
  } finally {
    stub.restore()
  }
})
