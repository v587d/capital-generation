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
    request_id: `req-${Math.random().toString(36).slice(2)}`,
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
  const ids = ['a', 'b', 'c'].map((key) => {
    const req = request({ data_key: `k.${key}`, params: { key } })
    hub.enqueue(req)
    return req.request_id
  })
  await sleep(60)
  assert.equal(maxActive, 1, '同一时刻必须只有一个请求在执行')
  assert.deepEqual(order, ['a', 'b', 'c'])
  for (const id of ids) {
    const status = hub.getStatus(id)
    assert.equal(status.status, 'completed')
  }
})

test('缓存命中：第二次同键请求不调用数据源，from_cache=true 且同步返回', async () => {
  const { hub } = makeHub()
  const source = testSource('get_meta_tickers_search')
  hub.registerSource(source)
  const first = request({ data_key: 'meta.tickers.search.茅台', params: { q: '茅台' } })
  hub.enqueue(first)
  await sleep(10)
  assert.equal(source.calls(), 1)
  const second = request({ data_key: 'meta.tickers.search.茅台', params: { q: '茅台' } })
  const result = hub.enqueue(second)
  assert.equal(result.status, 'enqueued')
  assert.equal(result.position, 0)
  const status = hub.getStatus(second.request_id)
  assert.equal(status.status, 'completed')
  assert.equal(status.result.from_cache, true)
  assert.equal(source.calls(), 1, '缓存命中不得调用数据源')
})

test('同键并发合并：多个相同请求只执行一次，各自拿到 completed', async () => {
  const { hub } = makeHub()
  const source = testSource('merged', 10)
  hub.registerSource(source)
  const ids = [1, 2, 3].map(() => {
    const req = request({ data_key: 'same.key', params: { n: 42 } })
    hub.enqueue(req)
    return req.request_id
  })
  await sleep(40)
  assert.equal(source.calls(), 1, '合并请求只应执行一次')
  for (const id of ids) {
    const status = hub.getStatus(id)
    assert.equal(status.status, 'completed')
    assert.equal(status.result.request_id, id, '每个请求状态里的结果应指向自己的 request_id')
  }
})

test('TTL 过期：getLatest 对过期条目返回 null', async () => {
  let clock = 0
  const { hub } = makeHub({ now: () => clock, ttlFor: () => 100 })
  hub.registerSource(testSource('ttl'))
  hub.enqueue(request({ data_key: 'k.v', requester_agent_id: 'a' }))
  await sleep(5) // 让微任务把缓存写入完成（写入时刻 clock 仍为 0）
  assert.ok(hub.getLatest('k.v'))
  clock = 200
  assert.equal(hub.getLatest('k.v'), null)
})

test('容量淘汰：超过 maxCacheEntries 时读取不到最旧条目', async () => {
  const { hub } = makeHub({ maxCacheEntries: 2 })
  hub.registerSource(testSource('evict'))
  hub.enqueue(request({ data_key: 'k.0' }))
  await sleep(5)
  hub.enqueue(request({ data_key: 'k.1' }))
  await sleep(5)
  hub.enqueue(request({ data_key: 'k.2' }))
  await sleep(20)
  assert.ok(hub.getLatest('k.2'))
  assert.equal(hub.getLatest('k.0'), null, '最旧条目应被淘汰')
})

test('超时：超过 requestTimeoutMs 标记 failed 且错误为 request timed out', async () => {
  const { hub } = makeHub({ requestTimeoutMs: 20 })
  hub.registerSource(testSource('hang', 5000))
  const req = request({ data_key: 'hang.key' })
  hub.enqueue(req)
  await sleep(80)
  const status = hub.getStatus(req.request_id)
  assert.equal(status.status, 'failed')
  assert.equal(status.error, 'request timed out')
})

test('失败：数据源抛错时状态携带明确 error', async () => {
  const { hub } = makeHub()
  hub.registerSource(testSource('bad', 0, 'Fuyao API error 401: unauthorized'))
  const req = request({ data_key: 'bad.key' })
  hub.enqueue(req)
  await sleep(20)
  const status = hub.getStatus(req.request_id)
  assert.equal(status.status, 'failed')
  assert.match(status.error, /Fuyao API error/)
})

test('队列满：超过 maxQueueLength 直接抛错不入队', async () => {
  const { hub } = makeHub({ maxQueueLength: 1 })
  hub.registerSource(testSource('full', 50))
  hub.enqueue(request({ data_key: 'full.1' }))
  assert.throws(() => hub.enqueue(request({ data_key: 'full.2' })), /queue is full/)
  await sleep(80)
})

test('force_refresh：缓存存在时仍强制拉取并覆盖', async () => {
  const { hub } = makeHub()
  const source = testSource('fresh')
  hub.registerSource(source)
  hub.enqueue(request({ data_key: 'fresh.key' }))
  await sleep(20)
  const ref = request({ data_key: 'fresh.key', force_refresh: true })
  hub.enqueue(ref)
  await sleep(20)
  assert.equal(source.calls(), 2)
  const status = hub.getStatus(ref.request_id)
  assert.equal(status.status, 'completed')
  assert.equal(status.result.from_cache, false)
})

test('maxRequestRecords：completed 记录超限时淘汰最旧', async () => {
  const { hub } = makeHub({ maxRequestRecords: 3 })
  hub.registerSource(testSource('records'))
  const ids = []
  for (let i = 0; i < 5; i += 1) {
    const req = request({ data_key: `records.${i}`, params: {} })
    hub.enqueue(req)
    ids.push(req.request_id)
    await sleep(5)
  }
  await sleep(20)
  assert.equal(hub.getStatus(ids[0]), null, '最旧记录被淘汰')
  assert.ok(hub.getStatus(ids[4]))
})

test('no data source：无数据源时 failed 且错误明确', async () => {
  const { hub } = makeHub()
  const req = request({ data_key: 'none.key' })
  hub.enqueue(req)
  await sleep(20)
  const status = hub.getStatus(req.request_id)
  assert.equal(status.status, 'failed')
  assert.match(status.error, /no data source/)
})

test('source_preference 不匹配时失败，不静默调用第一个数据源', async () => {
  const { hub } = makeHub()
  let calls = 0
  hub.registerSource({
    schema: { name: 'search', source: 'api:search', input_schema: {} },
    execute: async () => { calls += 1; return { data: { wrong: true } } },
  })
  const req = request({ source_preference: ['api:missing'] })
  hub.enqueue(req)
  await sleep(20)
  assert.equal(calls, 0)
  assert.equal(hub.getStatus(req.request_id).status, 'failed')
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
  const req = request({ data_key: 'a-share.prices.snapshot.300803.SZ', source_preference: ['api:fuyao', 'any'], params: { thscodes: '300803.SZ' } })
  hub.enqueue(req)
  await sleep(20)
  assert.deepEqual(calls, ['snapshot'])
  assert.equal(hub.getStatus(req.request_id).status, 'completed')
  assert.equal(hub.getStatus(req.request_id).result.source, 'get_a_share_prices_snapshot')
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
    const requests = [
      request({ request_id: 'route-search', data_key: 'meta.tickers.search.指南针', params: { q: '指南针' } }),
      request({ request_id: 'route-snapshot', data_key: 'a-share.prices.snapshot.300803.SZ', params: { thscodes: '300803.SZ' } }),
      request({ request_id: 'route-history', data_key: 'a-share.prices.historical.300803.SZ.day', params: { thscode: '300803.SZ', interval: '1d', start: 1, end: 2 } }),
      request({ request_id: 'route-calendar', data_key: 'a-share.calendar.trading_days', params: {} }),
    ]
    for (const req of requests) hub.enqueue(req)
    await sleep(80)
    assert.equal(hub.getStatus('route-search').status, 'completed')
    assert.equal(hub.getStatus('route-snapshot').status, 'completed')
    assert.equal(hub.getStatus('route-history').status, 'completed')
    assert.equal(hub.getStatus('route-calendar').status, 'completed')
    assert.equal(hub.getStatus('route-snapshot').result.source, 'get_a_share_prices_snapshot')
    assert.equal(hub.getStatus('route-history').result.source, 'get_a_share_prices_historical')
    assert.equal(hub.getStatus('route-calendar').result.source, 'get_a_share_calendar_trading_days')
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
  const req = request({ data_key: 'a-share.unknown.value' })
  hub.enqueue(req)
  await sleep(20)
  assert.equal(calls, 0)
  assert.equal(hub.getStatus(req.request_id).status, 'failed')
  assert.match(hub.getStatus(req.request_id).error, /no data source/)
})

test('source output guard 失败时不写入缓存', async () => {
  const { hub } = makeHub()
  hub.registerSource({
    schema: { name: 'guarded', source: 'api:test', data_key_patterns: ['guarded.*'], input_schema: {} },
    validateOutput: () => false,
    execute: async () => ({ data: { wrong: true } }),
  })
  const req = request({ data_key: 'guarded.value' })
  hub.enqueue(req)
  await sleep(20)
  assert.equal(hub.getStatus(req.request_id).status, 'failed')
  assert.equal(hub.getLatest(req.data_key), null)
})

test('getLatest 传入 params 时只返回精确参数组合', async () => {
  const { hub } = makeHub()
  hub.registerSource(testSource('params'))
  const first = request({ data_key: 'same.key', params: { range: 'old' } })
  const second = request({ data_key: 'same.key', params: { range: 'new' } })
  hub.enqueue(first)
  await sleep(10)
  hub.enqueue(second)
  await sleep(10)
  assert.equal(hub.getLatest('same.key', { range: 'old' }).data.echo.range, 'old')
  assert.equal(hub.getLatest('same.key', { range: 'missing' }), null)
})

test('超时会释放 FIFO worker，即使数据源不响应 AbortSignal', async () => {
  const { hub } = makeHub({ requestTimeoutMs: 10 })
  hub.registerSource({
    schema: { name: 'mixed', source: 'api:test', input_schema: {} },
    execute: async (req) => req.data_key === 'hang.forever' ? new Promise(() => {}) : { data: { ok: true } },
  })
  const hanging = request({ data_key: 'hang.forever' })
  const next = request({ data_key: 'next.key' })
  hub.enqueue(hanging)
  hub.enqueue(next)
  await sleep(35)
  assert.equal(hub.getStatus(hanging.request_id).status, 'failed')
  assert.equal(hub.getStatus(next.request_id).status, 'completed')
})