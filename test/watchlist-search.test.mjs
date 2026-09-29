/**
 * 搜索与消歧（自选股唯一的上游入口）。
 *
 * 断言的是**出网参数**与**规范化结果**两件事：范围收窄必须发生在入参上
 * （`asset_type` 白名单 + `limit=10`），否则场外基金 / 外汇 / 期货会混进候选，
 * 并把"不支持的标的"和"没有匹配"揉成同一个错——那正是 R4 会失效的地方。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SEARCH_ASSET_TYPES, SEARCH_LIMIT, createWatchlistService, normalizeThscode } from '../capital-watchlist/index.js'
import { createFakeDomain, stubFuyao } from './watchlist-harness.mjs'

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

test('出网参数里必须带 asset_type 白名单与 limit=10（断参数，不只断解析）', async () => {
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
    assert.equal(url.searchParams.get('limit'), String(SEARCH_LIMIT), '候选上限 10，倒逼用户缩小输入')
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

test('多命中回 candidates 并由 UI 选一条；满 10 条报 truncated', async () => {
  const many = {
    code: 0,
    data: {
      timestamp: 1,
      item: Array.from({ length: 10 }, (unused, index) => ({
        thscode: `1593${String(index).padStart(2, '0')}.SZ`,
        ticker: `1593${String(index).padStart(2, '0')}`,
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
    assert.equal(result.items.length, 10)
    assert.equal(result.truncated, true, '撞上限要告诉用户"缩小输入"，而不是让他以为只有这些')
  } finally {
    stub.restore()
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

test('normalizeThscode：trim + 大写；裸码 / 北交所 / 场外都拿不到 thscode', async () => {
  assert.equal(normalizeThscode(' 300750.sz '), '300750.SZ')
  assert.equal(normalizeThscode('600519.SH'), '600519.SH')
  for (const input of ['300750', '920002.BJ', '012414.OF', '', undefined, 42, 'ABCDEF.SH']) {
    assert.equal(normalizeThscode(input), undefined, `${String(input)} 不该被接受`)
  }
})

test('搜索失败与报价失败分开报：这里只可能是"查询失败"', async () => {
  const stub = stubFuyao({ '/api/meta/tickers/search': { status: 503, body: {} } })
  const { service } = run(stub)
  try {
    const result = await service.search('300750')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'fuyao_unavailable')
    assert.notEqual(result.code, 'quote_unavailable', '"查不到"不能写成"这个标的没有报价"')
  } finally {
    stub.restore()
  }
})

test('没配密钥时搜索给 credential_missing，不是含糊的"查询失败"', async () => {
  const stub = stubFuyao()
  const { service } = run(stub, { resolveApiKey: async () => undefined })
  try {
    const result = await service.search('300750')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'credential_missing')
    assert.equal(stub.calls.length, 0, '没有 key 就不该把请求发出去')
  } finally {
    stub.restore()
  }
})
