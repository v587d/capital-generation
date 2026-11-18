/**
 * `/kline` route: the desk's daily pane. Same identity gate as `/trend` (the stored row decides the
 * market), one cached upstream call per symbol, and an explicit empty state for markets the shared
 * K-line core cannot serve (HK/US indices).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRouteHandler, createWatchlistService } from '../watchlist/index.js'
import { createFakeDomain, httpFixture, stubFuyao, withHoldable } from './watchlist-harness.mjs'
import { TENCENT_KLINE_300803 } from './kline-fixtures.mjs'
import { tencentHostDownUntil } from '../lib/sources/tencent-public-core.js'

const KLINE_URL = 'fqkline'

function harness() {
  const fake = createFakeDomain()
  const service = createWatchlistService({
    openDomain: async () => fake.domain,
    resolveApiKey: async () => 'test-key',
    now: () => 1_790_586_000_000,
  })
  return { service, fake, handler: createRouteHandler(service, {}) }
}

/** A row the seed list does not carry; the fixture is a real series for this code. */
async function addRow(fake, thscode = '300803.SZ', assetType = 'a-share') {
  await fake.table.put(thscode, { thscode, ticker: thscode.slice(0, 6), name: '指南针', exchange: thscode.slice(-2), asset_type: assetType, added_at: 1, source: 'user', quote: null })
}

async function call(handler, input) {
  const { req, res } = httpFixture(input)
  await handler(req, res)
  return res
}

test('⛔ /kline 只认清单里的标的：未收录的代码一个上游请求都不发', async () => {
  tencentHostDownUntil.clear()
  const stub = stubFuyao({ [KLINE_URL]: TENCENT_KLINE_300803 })
  const { service, handler } = harness()
  try {
    await service.list()
    const res = await call(handler, { method: 'GET', url: '/capital-watchlist/kline?thscode=600519.SH' })
    assert.equal(res.statusCode, 404)
    assert.equal(res.json().code, 'not_watched')
    assert.equal(stub.calls.filter((entry) => entry.url.includes(KLINE_URL)).length, 0)
  } finally {
    stub.restore()
  }
})

test('/kline：返回日线序列，5 分钟内复用，refresh=1 才重取', async () => {
  tencentHostDownUntil.clear()
  const stub = stubFuyao({ [KLINE_URL]: TENCENT_KLINE_300803 })
  const { service, fake, handler } = harness()
  try {
    await withHoldable(service, fake)
    await addRow(fake)
    const first = await call(handler, { method: 'GET', url: '/capital-watchlist/kline?thscode=300803.SZ' })
    assert.equal(first.statusCode, 200)
    const payload = first.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.thscode, '300803.SZ')
    assert.equal(payload.source, 'tencent')
    assert.equal(payload.adjust, 'qfq')
    assert.equal(payload.volume_unit, 'lot', '主板按手报')
    assert.equal(payload.currency, 'CNY')
    assert.ok(payload.bars.length >= 100, `日线根数 ${payload.bars.length}`)
    const last = payload.bars[payload.bars.length - 1]
    assert.match(last.date, /^\d{4}-\d{2}-\d{2}$/u)
    for (const field of ['open', 'high', 'low', 'close', 'volume']) {
      assert.equal(typeof last[field], 'number', `${field} 必须是数字`)
      assert.ok(Number.isFinite(last[field]))
    }
    assert.ok(last.high >= last.low, '高低价不许颠倒')
    // 升序：图上从左到右就是时间顺序，路由不许把顺序留给客户端猜。
    const dates = payload.bars.map((bar) => bar.date)
    assert.deepEqual(dates, [...dates].sort(), '日期必须升序')

    const upstream = () => stub.calls.filter((entry) => entry.url.includes(KLINE_URL)).length
    assert.equal(upstream(), 1)
    const cached = await call(handler, { method: 'GET', url: '/capital-watchlist/kline?thscode=300803.SZ' })
    assert.equal(cached.statusCode, 200)
    assert.equal(upstream(), 1, '5 分钟内第二次不再打上游')
    const busted = await call(handler, { method: 'GET', url: '/capital-watchlist/kline?thscode=300803.SZ&refresh=1' })
    assert.equal(busted.statusCode, 200)
    assert.equal(upstream(), 2, 'refresh=1 跳过缓存')
  } finally {
    stub.restore()
  }
})

test('⛔ /kline 港美股指数直接给空态理由，不发请求', async () => {
  tencentHostDownUntil.clear()
  const stub = stubFuyao({ [KLINE_URL]: TENCENT_KLINE_300803 })
  const { service, fake, handler } = harness()
  try {
    await withHoldable(service, fake)
    await fake.table.put('IXIC.US', { thscode: 'IXIC.US', ticker: 'IXIC', name: '纳斯达克', exchange: 'US', asset_type: 'us-index', added_at: 1, source: 'user', quote: null })
    const res = await call(handler, { method: 'GET', url: '/capital-watchlist/kline?thscode=IXIC.US' })
    assert.equal(res.statusCode, 502)
    const payload = res.json()
    assert.equal(payload.code, 'kline_unavailable')
    assert.equal(payload.reason, 'market_unsupported')
    assert.equal(stub.calls.filter((entry) => entry.url.includes(KLINE_URL)).length, 0)
  } finally {
    stub.restore()
  }
})

test('/kline：上游给出非日线形状时响亮失败，不画半张图', async () => {
  tencentHostDownUntil.clear()
  const broken = JSON.parse(TENCENT_KLINE_300803)
  broken.data.sz300803.qfqday[0] = ['2026-05-25', '68.138']
  const stub = stubFuyao({ [KLINE_URL]: JSON.stringify(broken) })
  const { service, fake, handler } = harness()
  try {
    await withHoldable(service, fake)
    await addRow(fake)
    const res = await call(handler, { method: 'GET', url: '/capital-watchlist/kline?thscode=300803.SZ' })
    assert.equal(res.statusCode, 502)
    assert.equal(res.json().code, 'kline_parse_failed')
    assert.equal(res.json().message, '上游这次回的报文不完整')
  } finally {
    stub.restore()
  }
})

test('⛔ /kline：上游这次没有日线是可重试的故障，不许冒充"该市场没有日K"', async () => {
  tencentHostDownUntil.clear()
  const stub = stubFuyao({ [KLINE_URL]: '{"code":0,"msg":"","data":{}}' })
  const { service, fake, handler } = harness()
  try {
    await withHoldable(service, fake)
    await addRow(fake)
    const res = await call(handler, { method: 'GET', url: '/capital-watchlist/kline?thscode=300803.SZ' })
    assert.equal(res.statusCode, 502)
    assert.equal(res.json().code, 'kline_upstream_unavailable')
    // 带 reason 就走"该市场暂时没有日K数据"的空态，重试键也就没了。
    assert.equal(res.json().reason, undefined)
  } finally {
    stub.restore()
    tencentHostDownUntil.clear()
  }
})
