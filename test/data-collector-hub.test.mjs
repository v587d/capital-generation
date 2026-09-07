import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DataCollectorHub } from '../lib/data-collector/hub.js'
import { createFuyaoRestSources } from '../lib/sources/fuyao-rest.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 可统计调用次数的假数据源；delayMs>0 时可挂起/被 abort 唤醒。 */
function testSource(name, delayMs = 0, failWith) {
  let calls = 0
  return {
    calls: () => calls,
    schema: { name, source: 'api:test', input_schema: { type: 'object' } },
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
    data_key: 'a-share.prices.snapshot.test',
    params: {},
    requester_agent_id: 'main-agent',
    ...overrides,
  }
}

function makeHub(options = {}) {
  const hub = new DataCollectorHub(options)
  return { hub }
}

test('FIFO 严格串行执行：同一时刻只有一个请求在跑，按入队顺序完成', async () => {
  const { hub } = makeHub()
  let active = 0
  let maxActive = 0
  const order = []
  const source = {
    schema: { name: 's', source: 'api:test', input_schema: {} },
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
  // 并发发出三个不同 key 的请求：全部入队，阻塞式 request() 等各自完成
  const results = await Promise.all(['a', 'b', 'c'].map((key) => hub.request(request({ data_key: `k.${key}`, params: { key } }))))
  assert.equal(maxActive, 1, '同一时刻必须只有一个请求在执行')
  assert.deepEqual(order, ['a', 'b', 'c'])
  assert.deepEqual(results.map((r) => r.data), ['a', 'b', 'c'])
})

test('缓存命中：第二次同键请求不调用数据源，from_cache=true 且立即返回', async () => {
  const { hub } = makeHub()
  const source = testSource('get_meta_tickers_search')
  hub.registerSource(source)
  const first = await hub.request(request({ data_key: 'meta.tickers.search.茅台', params: { q: '茅台' } }))
  assert.equal(source.calls(), 1)
  assert.equal(first.from_cache, false)
  const second = await hub.request(request({ data_key: 'meta.tickers.search.茅台', params: { q: '茅台' } }))
  assert.equal(second.from_cache, true)
  assert.equal(source.calls(), 1, '缓存命中不得调用数据源')
})

test('同键并发合并：多个相同请求只执行一次，各自拿到同一结果', async () => {
  const { hub } = makeHub()
  const source = testSource('merged', 10)
  hub.registerSource(source)
  const results = await Promise.all([1, 2, 3].map(() => hub.request(request({ data_key: 'same.key', params: { n: 42 } }))))
  assert.equal(source.calls(), 1, '合并请求只应执行一次')
  for (const result of results) {
    assert.equal(result.data.name, 'merged')
    assert.equal(result.from_cache, false)
  }
})

test('TTL 过期：getLatest 对过期条目返回 null', async () => {
  let clock = 0
  const { hub } = makeHub({ now: () => clock, ttlFor: () => 100 })
  hub.registerSource(testSource('ttl'))
  await hub.request(request({ data_key: 'k.v', requester_agent_id: 'a' }))
  assert.ok(hub.getLatest('k.v'))
  clock = 200
  assert.equal(hub.getLatest('k.v'), null)
})

test('容量淘汰：超过 maxCacheEntries 时读取不到最旧条目', async () => {
  const { hub } = makeHub({ maxCacheEntries: 2 })
  hub.registerSource(testSource('evict'))
  await hub.request(request({ data_key: 'k.0' }))
  await hub.request(request({ data_key: 'k.1' }))
  await hub.request(request({ data_key: 'k.2' }))
  assert.ok(hub.getLatest('k.2'))
  assert.equal(hub.getLatest('k.0'), null, '最旧条目应被淘汰')
})

test('超时：超过 requestTimeoutMs 抛错 request timed out', async () => {
  const { hub } = makeHub({ requestTimeoutMs: 20 })
  hub.registerSource(testSource('hang', 5000))
  await assert.rejects(() => hub.request(request({ data_key: 'hang.key' })), /request timed out/)
})

test('失败：数据源抛错时错误文本明确', async () => {
  const { hub } = makeHub()
  hub.registerSource(testSource('bad', 0, 'Fuyao API error 401: unauthorized'))
  await assert.rejects(() => hub.request(request({ data_key: 'bad.key' })), /Fuyao API error/)
})

test('队列满：超过 maxQueueLength 直接抛错不入队', async () => {
  const { hub } = makeHub({ maxQueueLength: 1 })
  hub.registerSource(testSource('full', 50))
  const first = hub.request(request({ data_key: 'full.1' }))
  await assert.rejects(() => hub.request(request({ data_key: 'full.2' })), /queue is full/)
  assert.ok(await first, '第一个请求仍正常完成')
})

test('force_refresh：缓存存在时仍强制拉取并覆盖', async () => {
  const { hub } = makeHub()
  const source = testSource('fresh')
  hub.registerSource(source)
  await hub.request(request({ data_key: 'fresh.key' }))
  const refreshed = await hub.request(request({ data_key: 'fresh.key', force_refresh: true }))
  assert.equal(source.calls(), 2)
  assert.equal(refreshed.from_cache, false)
})

test('no data source：无数据源时报错且错误明确', async () => {
  const { hub } = makeHub()
  await assert.rejects(() => hub.request(request({ data_key: 'none.key' })), /no data source/)
})

test('source_preference 不匹配时失败，不静默调用第一个数据源', async () => {
  const { hub } = makeHub()
  let calls = 0
  hub.registerSource({
    schema: { name: 'search', source: 'api:search', input_schema: {} },
    execute: async () => { calls += 1; return { data: { wrong: true } } },
  })
  await assert.rejects(() => hub.request(request({ source_preference: ['api:missing'] })), /no data source/)
  assert.equal(calls, 0)
})

test('同一 provider 下按 data_key 路由到正确 capability，不取第一个注册源', async () => {
  const { hub } = makeHub()
  const calls = []
  hub.registerSource({
    schema: { name: 'get_meta_tickers_search', source: 'api:fuyao', data_key_patterns: ['meta.tickers.search.*'], input_schema: {} },
    execute: async () => { calls.push('search'); return { data: { item: [{ thscode: 'x', name: 'x' }] } } },
  })
  hub.registerSource({
    schema: { name: 'get_a_share_prices_snapshot', source: 'api:fuyao', data_key_patterns: ['a-share.prices.snapshot.*'], input_schema: {} },
    execute: async () => { calls.push('snapshot'); return { data: { item: [{ last_price: 1 }] } } },
  })
  const result = await hub.request(request({ data_key: 'a-share.prices.snapshot.300803.SZ', source_preference: ['api:fuyao', 'any'], params: { thscodes: '300803.SZ' } }))
  assert.deepEqual(calls, ['snapshot'])
  assert.equal(result.source, 'get_a_share_prices_snapshot')
})

test('真实 Fuyao 四源按 data_key 分别路由且使用各自 schema', async () => {
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
    const results = await Promise.all([
      hub.request(request({ data_key: 'meta.tickers.search.指南针', params: { q: '指南针' } })),
      hub.request(request({ data_key: 'a-share.prices.snapshot.300803.SZ', params: { thscodes: '300803.SZ' } })),
      hub.request(request({ data_key: 'a-share.prices.historical.300803.SZ.day', params: { thscode: '300803.SZ', interval: '1d', start: 1, end: 2 } })),
      hub.request(request({ data_key: 'a-share.calendar.trading_days', params: {} })),
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
    schema: { name: 'search', source: 'api:fuyao', data_key_patterns: ['meta.tickers.search.*'], input_schema: {} },
    execute: async () => { calls += 1; return { data: { item: [] } } },
  })
  await assert.rejects(() => hub.request(request({ data_key: 'a-share.unknown.value' })), /no data source/)
  assert.equal(calls, 0)
})

test('source output guard 失败时不写入缓存', async () => {
  const { hub } = makeHub()
  hub.registerSource({
    schema: { name: 'guarded', source: 'api:test', data_key_patterns: ['guarded.*'], input_schema: {} },
    validateOutput: () => false,
    execute: async () => ({ data: { wrong: true } }),
  })
  await assert.rejects(() => hub.request(request({ data_key: 'guarded.value' })), /incompatible with its output contract/)
  assert.equal(hub.getLatest('guarded.value'), null)
})

test('getLatest 传入 params 时只返回精确参数组合', async () => {
  const { hub } = makeHub()
  hub.registerSource(testSource('params'))
  await hub.request(request({ data_key: 'same.key', params: { range: 'old' } }))
  await hub.request(request({ data_key: 'same.key', params: { range: 'new' } }))
  assert.equal(hub.getLatest('same.key', { range: 'old' }).data.echo.range, 'old')
  assert.equal(hub.getLatest('same.key', { range: 'missing' }), null)
})

test('超时会释放 FIFO worker，即使数据源不响应 AbortSignal', async () => {
  const { hub } = makeHub({ requestTimeoutMs: 10 })
  hub.registerSource({
    schema: { name: 'mixed', source: 'api:test', input_schema: {} },
    execute: async (req) => req.data_key === 'hang.forever' ? new Promise(() => {}) : { data: { ok: true } },
  })
  const hanging = hub.request(request({ data_key: 'hang.forever' }))
  const next = hub.request(request({ data_key: 'next.key' }))
  await assert.rejects(() => hanging, /request timed out/)
  assert.equal((await next).data.ok, true)
})

test('调用方 signal 中止：等待者被摘除并报错，共享执行不受影响（缓存照常写入）', async () => {
  const { hub } = makeHub()
  const source = testSource('sig', 30)
  hub.registerSource(source)
  const controller = new AbortController()
  const pending = hub.request(request({ data_key: 'sig.key' }), { signal: controller.signal })
  controller.abort()
  await assert.rejects(() => pending, /aborted/)
  await sleep(50)
  const cached = await hub.request(request({ data_key: 'sig.key' }))
  assert.equal(cached.from_cache, true, '被中止的执行仍应写完缓存')
})

test('已中止的 signal：请求直接报错不入队', async () => {
  const { hub } = makeHub()
  hub.registerSource(testSource('x'))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => hub.request(request({ data_key: 'x.y' }), { signal: controller.signal }), /aborted/)
})

test('缺字段：data_key 或 requester_agent_id 缺失时报错明确', async () => {
  const { hub } = makeHub()
  await assert.rejects(() => hub.request(request({ data_key: '' })), /data_key and requester_agent_id are required/)
  await assert.rejects(() => hub.request(request({ requester_agent_id: '' })), /data_key and requester_agent_id are required/)
})