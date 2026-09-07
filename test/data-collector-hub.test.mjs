import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DataCollectorHub, buildDataKey, normalizeKeyToken } from '../lib/data-collector/hub.js'
import { createFuyaoRestSources } from '../lib/sources/fuyao-rest.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 可统计调用次数的假数据源；delayMs>0 时可挂起/被 abort 唤醒。dataKey 为该源规范身份证。 */
function testSource(name, { delayMs = 0, failWith, dataKey = `test.${name}` } = {}) {
  let calls = 0
  return {
    calls: () => calls,
    schema: { name, source: 'api:test', data_key: dataKey, input_schema: { type: 'object' } },
    execute: async (request, signal) => {
      calls += 1
      if (delayMs > 0) {
        await new Promise((resolve) => {
          const onAbort = () => { clearTimeout(timer); resolve() }
          const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, delayMs)
          signal.addEventListener('abort', onAbort)
        })
      }
      if (failWith) throw new Error(failWith)
      return { data: { name, echo: request.params }, schema: { type: 'object' } }
    },
  }
}

function request(overrides = {}) {
  return {
    data_key: 'test.sample',
    params: {},
    requester_agent_id: 'main-agent',
    ...overrides,
  }
}

function makeHub(options = {}) {
  const hub = new DataCollectorHub(options)
  return { hub }
}

test('buildDataKey：provider.kind.resource，斜杠/冒号规范化为点（文件名安全）', () => {
  assert.equal(buildDataKey('fuyao', 'api', '/api/a-share/prices/snapshot'), 'fuyao.api.api.a-share.prices.snapshot')
  assert.equal(buildDataKey('fuyao', 'api', '/api/meta/tickers/search'), 'fuyao.api.api.meta.tickers.search')
  assert.equal(buildDataKey('fuyao', 'api', '/api/a-share/calendar/trading-days'), 'fuyao.api.api.a-share.calendar.trading-days')
  assert.equal(buildDataKey('alice', 'mcp', 'get_financial_data'), 'alice.mcp.get_financial_data')
  assert.equal(normalizeKeyToken('/a//b:'), 'a.b')
})

test('身份证唯一：重复 data_key 注册即失败（防撞键）', () => {
  const { hub } = makeHub()
  hub.registerSource(testSource('a', { dataKey: 'dup.key' }))
  assert.throws(() => hub.registerSource(testSource('b', { dataKey: 'dup.key' })), /data_key already registered/)
})

test('FIFO 严格串行执行：同一时刻只有一个请求在跑，按入队顺序完成', async () => {
  const { hub } = makeHub()
  let active = 0
  let maxActive = 0
  const order = []
  const source = {
    schema: { name: 's', source: 'api:test', data_key: 'test.s', input_schema: {} },
    execute: async (req) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      order.push(req.params.key)
      await sleep(10)
      active -= 1
      return { data: req.params.key }
    },
  }
  hub.registerSource(source)
  // 并发发出三个同端点不同 params 的请求：全部入队，阻塞式 request() 等各自完成
  const results = await Promise.all(['a', 'b', 'c'].map((key) => hub.request(request({ data_key: 'test.s', params: { key } }))))
  assert.equal(maxActive, 1, '同一时刻必须只有一个请求在执行')
  assert.deepEqual(order, ['a', 'b', 'c'])
  assert.deepEqual(results.map((r) => r.data), ['a', 'b', 'c'])
})

test('缓存命中：第二次同键请求不调用数据源，from_cache=true 且立即返回', async () => {
  const { hub } = makeHub()
  const source = testSource('search', { dataKey: 'fuyao.api.api.meta.tickers.search' })
  hub.registerSource(source)
  const first = await hub.request(request({ data_key: 'fuyao.api.api.meta.tickers.search', params: { q: '茅台' } }))
  assert.equal(source.calls(), 1)
  assert.equal(first.from_cache, false)
  const second = await hub.request(request({ data_key: 'fuyao.api.api.meta.tickers.search', params: { q: '茅台' } }))
  assert.equal(second.from_cache, true)
  assert.equal(source.calls(), 1, '缓存命中不得调用数据源')
})

test('同键并发合并：多个相同请求只执行一次，各自拿到同一结果', async () => {
  const { hub } = makeHub()
  const source = testSource('merged', { delayMs: 10, dataKey: 'test.merged' })
  hub.registerSource(source)
  const results = await Promise.all([1, 2, 3].map(() => hub.request(request({ data_key: 'test.merged', params: { n: 42 } }))))
  assert.equal(source.calls(), 1, '合并请求只应执行一次')
  for (const result of results) {
    assert.equal(result.data.name, 'merged')
    assert.equal(result.from_cache, false)
  }
})

test('TTL 声明：数据源 ttl_ms 决定过期，getLatest 对过期条目返回 null', async () => {
  let clock = 0
  const { hub } = makeHub({ now: () => clock })
  const source = testSource('ttl', { dataKey: 'test.ttl' })
  source.schema.ttl_ms = 100
  hub.registerSource(source)
  await hub.request(request({ data_key: 'test.ttl', requester_agent_id: 'a' }))
  assert.ok(hub.getLatest('test.ttl'))
  clock = 200
  assert.equal(hub.getLatest('test.ttl'), null)
})

test('TTL 兜底：未声明 ttl_ms 时用 defaultTtlMs', async () => {
  let clock = 0
  const { hub } = makeHub({ now: () => clock, defaultTtlMs: 100 })
  hub.registerSource(testSource('plain', { dataKey: 'test.plain' }))
  await hub.request(request({ data_key: 'test.plain' }))
  assert.ok(hub.getLatest('test.plain'))
  clock = 200
  assert.equal(hub.getLatest('test.plain'), null)
})

test('容量淘汰：超过 maxCacheEntries 时读取不到最旧条目', async () => {
  const { hub } = makeHub({ maxCacheEntries: 2 })
  hub.registerSource(testSource('evict', { dataKey: 'test.evict' }))
  await hub.request(request({ data_key: 'test.evict', params: { i: 0 } }))
  await hub.request(request({ data_key: 'test.evict', params: { i: 1 } }))
  await hub.request(request({ data_key: 'test.evict', params: { i: 2 } }))
  assert.ok(hub.getLatest('test.evict', { i: 2 }))
  assert.equal(hub.getLatest('test.evict', { i: 0 }), null, '最旧条目应被淘汰')
})

test('超时：超过 requestTimeoutMs 抛错 request timed out', async () => {
  const { hub } = makeHub({ requestTimeoutMs: 20 })
  hub.registerSource(testSource('hang', { delayMs: 5000, dataKey: 'test.hang' }))
  await assert.rejects(() => hub.request(request({ data_key: 'test.hang' })), /request timed out/)
})

test('失败：数据源抛错时错误文本明确', async () => {
  const { hub } = makeHub()
  hub.registerSource(testSource('bad', { failWith: 'Fuyao API error 401: unauthorized', dataKey: 'test.bad' }))
  await assert.rejects(() => hub.request(request({ data_key: 'test.bad' })), /Fuyao API error/)
})

test('队列满：超过 maxQueueLength 直接抛错不入队', async () => {
  const { hub } = makeHub({ maxQueueLength: 1 })
  hub.registerSource(testSource('full', { delayMs: 50, dataKey: 'test.full' }))
  const first = hub.request(request({ data_key: 'test.full', params: { i: 1 } }))
  await assert.rejects(() => hub.request(request({ data_key: 'test.full', params: { i: 2 } })), /queue is full/)
  assert.ok(await first, '第一个请求仍正常完成')
})

test('force_refresh：缓存存在时仍强制拉取并覆盖', async () => {
  const { hub } = makeHub()
  const source = testSource('fresh', { dataKey: 'test.fresh' })
  hub.registerSource(source)
  await hub.request(request({ data_key: 'test.fresh' }))
  const refreshed = await hub.request(request({ data_key: 'test.fresh', force_refresh: true }))
  assert.equal(source.calls(), 2)
  assert.equal(refreshed.from_cache, false)
})

test('伪造 data_key：与任何注册身份证不匹配时报错（不静默不命中）', async () => {
  const { hub } = makeHub()
  hub.registerSource(testSource('search', { dataKey: 'fuyao.api.api.meta.tickers.search' }))
  await assert.rejects(
    () => hub.request(request({ data_key: 'guide_needle_realtime_20260907' })),
    /no data source/,
    '编造键必须报错而不是静默',
  )
})

test('source_preference provider 不匹配时失败，不静默调用注册源', async () => {
  const { hub } = makeHub()
  let calls = 0
  hub.registerSource({
    schema: { name: 'other_search', source: 'api:other', data_key: 'other.api.meta.tickers.search', input_schema: {} },
    execute: async () => { calls += 1; return { data: { wrong: true } } },
  })
  await assert.rejects(
    () => hub.request(request({ data_key: 'other.api.meta.tickers.search', source_preference: ['fuyao.api'] })),
    /no data source/,
  )
  assert.equal(calls, 0)
})

test('同一 provider 下按 data_key 路由到正确 capability，不取第一个注册源', async () => {
  const { hub } = makeHub()
  const calls = []
  hub.registerSource({
    schema: { name: 'get_meta_tickers_search', source: 'api:fuyao', data_key: 'fuyao.api.api.meta.tickers.search', input_schema: {} },
    execute: async () => { calls.push('search'); return { data: { item: [{ thscode: 'x', name: 'x' }] } } },
  })
  hub.registerSource({
    schema: { name: 'get_a_share_prices_snapshot', source: 'api:fuyao', data_key: 'fuyao.api.api.a-share.prices.snapshot', input_schema: {} },
    execute: async () => { calls.push('snapshot'); return { data: { item: [{ last_price: 1 }] } } },
  })
  const result = await hub.request(request({ data_key: 'fuyao.api.api.a-share.prices.snapshot', source_preference: ['fuyao.api', 'any'], params: { thscodes: '600519.SH' } }))
  assert.deepEqual(calls, ['snapshot'])
  assert.equal(result.source, 'get_a_share_prices_snapshot')
})

test('真实 Fuyao 四源按规范 data_key 路由，且各带声明 TTL', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname
    const item = path.includes('tickers/search')
      ? { thscode: '300803.SZ', name: '指南针' }
      : path.includes('prices/snapshot')
        ? { thscode: '300803.SZ', last_price: 100 }
        : path.includes('prices/historical')
          ? { date_ms: 1, close_price: 100 }
          : { date_ms: 1, date: '19700101' }
    return { ok: true, json: async () => ({ code: 0, data: { item: [item] } }) }
  }
  try {
    const hub = new DataCollectorHub()
    for (const source of createFuyaoRestSources(async () => 'key')) hub.registerSource(source)
    assert.deepEqual(hub.listSchemas().map((s) => s.data_key), [
      'fuyao.api.api.meta.tickers.search',
      'fuyao.api.api.a-share.prices.snapshot',
      'fuyao.api.api.a-share.prices.historical',
      'fuyao.api.api.a-share.calendar.trading-days',
    ])
    assert.equal(hub.listSchemas().find((s) => s.name === 'get_a_share_prices_snapshot').ttl_ms, 60_000)
    const results = await Promise.all([
      hub.request(request({ data_key: 'fuyao.api.api.meta.tickers.search', params: { q: '指南针' } })),
      hub.request(request({ data_key: 'fuyao.api.api.a-share.prices.snapshot', params: { thscodes: '300803.SZ' } })),
      hub.request(request({ data_key: 'fuyao.api.api.a-share.prices.historical', params: { thscode: '300803.SZ', interval: '1d', start: 1, end: 2 } })),
      hub.request(request({ data_key: 'fuyao.api.api.a-share.calendar.trading-days', params: {} })),
    ])
    assert.deepEqual(results.map((r) => r.source), [
      'get_meta_tickers_search',
      'get_a_share_prices_snapshot',
      'get_a_share_prices_historical',
      'get_a_share_calendar_trading_days',
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('未知 data_key 不会在 any 下静默使用第一个 source', async () => {
  const { hub } = makeHub()
  let calls = 0
  hub.registerSource({
    schema: { name: 'search', source: 'api:fuyao', data_key: 'fuyao.api.api.meta.tickers.search', input_schema: {} },
    execute: async () => { calls += 1; return { data: { item: [] } } },
  })
  await assert.rejects(() => hub.request(request({ data_key: 'fuyao.api.api.a-share.unknown' })), /no data source/)
  assert.equal(calls, 0)
})

test('source output guard 失败时不写入缓存', async () => {
  const { hub } = makeHub()
  hub.registerSource({
    schema: { name: 'guarded', source: 'api:test', data_key: 'test.guarded', input_schema: {} },
    validateOutput: () => false,
    execute: async () => ({ data: { wrong: true } }),
  })
  await assert.rejects(() => hub.request(request({ data_key: 'test.guarded' })), /incompatible with its output contract/)
  assert.equal(hub.getLatest('test.guarded'), null)
})

test('getLatest 传入 params 时只返回精确参数组合', async () => {
  const { hub } = makeHub()
  hub.registerSource(testSource('params', { dataKey: 'test.params' }))
  await hub.request(request({ data_key: 'test.params', params: { range: 'old' } }))
  await hub.request(request({ data_key: 'test.params', params: { range: 'new' } }))
  assert.equal(hub.getLatest('test.params', { range: 'old' }).data.echo.range, 'old')
  assert.equal(hub.getLatest('test.params', { range: 'missing' }), null)
})

test('超时会释放 FIFO worker，即使数据源不响应 AbortSignal', async () => {
  const { hub } = makeHub({ requestTimeoutMs: 10 })
  hub.registerSource({
    schema: { name: 'mixed', source: 'api:test', data_key: 'test.mixed', input_schema: {} },
    execute: async (req) => req.params.mode === 'hang' ? new Promise(() => {}) : { data: { ok: true } },
  })
  const hanging = hub.request(request({ data_key: 'test.mixed', params: { mode: 'hang' } }))
  const next = hub.request(request({ data_key: 'test.mixed', params: { mode: 'ok' } }))
  await assert.rejects(() => hanging, /request timed out/)
  assert.equal((await next).data.ok, true)
})

test('调用方 signal 中止：等待者被摘除并报错，共享执行不受影响（缓存照常写入）', async () => {
  const { hub } = makeHub()
  const source = testSource('sig', { delayMs: 30, dataKey: 'test.sig' })
  hub.registerSource(source)
  const controller = new AbortController()
  const pending = hub.request(request({ data_key: 'test.sig' }), { signal: controller.signal })
  controller.abort()
  await assert.rejects(() => pending, /aborted/)
  await sleep(50)
  const cached = await hub.request(request({ data_key: 'test.sig' }))
  assert.equal(cached.from_cache, true, '被中止的执行仍应写完缓存')
})

test('已中止的 signal：请求直接报错不入队', async () => {
  const { hub } = makeHub()
  hub.registerSource(testSource('x', { dataKey: 'test.x' }))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => hub.request(request({ data_key: 'test.x' }), { signal: controller.signal }), /aborted/)
})

test('缺字段：data_key 或 requester_agent_id 缺失时报错明确', async () => {
  const { hub } = makeHub()
  await assert.rejects(() => hub.request(request({ data_key: '' })), /data_key and requester_agent_id are required/)
  await assert.rejects(() => hub.request(request({ requester_agent_id: '' })), /data_key and requester_agent_id are required/)
})