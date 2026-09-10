import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DataCollectorHub, buildDataKey, normalizeKeyToken } from '../lib/data-collector/hub.js'
import { DatasetStoreError } from '../lib/data-collector/store.js'
import { createFuyaoRestSources } from '../lib/sources/fuyao-rest.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const SESSION = { id: 'session-1', header: { cwd: '/workspace/proj' } }

/** 可统计调用次数的假数据源；delayMs>0 时可挂起/被 abort 唤醒。 */
function testSource(capability, { delayMs = 0, failWith, dataKey = `test.${capability}`, data } = {}) {
  let calls = 0
  return {
    calls: () => calls,
    schema: {
      capability,
      name: `src_${capability}`,
      source: 'api:test',
      data_key: dataKey,
      input_schema: { type: 'object' },
      description: `test capability ${capability}`,
    },
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
      return { data: data ?? { capability, echo: request.params }, schema: { type: 'object' } }
    },
  }
}

function request(overrides = {}) {
  return {
    capability: 'sample',
    params: {},
    session: SESSION,
    ...overrides,
  }
}

/** 计数式假 store：模拟宿主落盘成功并返回自增 dataset_id 的 DatasetRef。 */
function fakeStore({ failWith } = {}) {
  let saves = 0
  const refs = []
  return {
    refs,
    saves: () => saves,
    async save(input) {
      if (failWith) throw failWith
      saves += 1
      const ref = {
        dataset_id: `ds_${saves}`,
        task_id: input.task_id ?? null,
        session_id: input.session.id,
        artifact_ref: `workspace://capital-data/datasets/ds_${saves}`,
        format: input.format,
        capability: input.capability,
        source_label: input.source_label,
        schema: input.schema,
        row_count: input.row_count,
        captured_at: 1_700_000_000_000 + saves,
        retention_until: 1_700_000_000_000 + saves + 604_800_000,
        params_digest: input.params_digest,
      }
      refs.push(ref)
      return ref
    },
    async findLatest(input) {
      return [...refs].reverse().find((ref) => ref.capability === input.capability && ref.params_digest === input.params_digest)
    },
  }
}

function makeHub(options = {}) {
  const store = options.store ?? fakeStore()
  const hub = new DataCollectorHub({ store, ...options })
  return { hub, store }
}

test('buildDataKey：provider.kind.resource，斜杠/冒号规范化为点（文件名安全）', () => {
  assert.equal(buildDataKey('fuyao', 'api', '/api/a-share/prices/snapshot'), 'fuyao.api.api.a-share.prices.snapshot')
  assert.equal(buildDataKey('fuyao', 'api', '/api/meta/tickers/search'), 'fuyao.api.api.meta.tickers.search')
  assert.equal(normalizeKeyToken('/a//b:'), 'a.b')
})

test('注册校验：重复 capability 与重复内部 data_key 均失败', () => {
  const { hub } = makeHub()
  hub.registerSource(testSource('quote', { dataKey: 'dup.key' }))
  assert.throws(() => hub.registerSource(testSource('quote', { dataKey: 'other.key' })), /capability already registered/)
  assert.throws(() => hub.registerSource(testSource('history', { dataKey: 'dup.key' })), /data_key already registered/)
})

test('FIFO 严格串行执行：同一时刻只有一个请求在跑，按入队顺序完成', async () => {
  const { hub } = makeHub()
  let active = 0
  let maxActive = 0
  const order = []
  hub.registerSource({
    schema: { capability: 'seq', name: 's', source: 'api:test', data_key: 'test.s', input_schema: {} },
    execute: async (req) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      order.push(req.params.key)
      await sleep(10)
      active -= 1
      return { data: { item: [] } }
    },
  })
  const results = await Promise.all(['a', 'b', 'c'].map((key) => hub.request(request({ capability: 'seq', params: { key } }))))
  assert.equal(maxActive, 1, '同一时刻必须只有一个请求在执行')
  assert.deepEqual(order, ['a', 'b', 'c'])
  assert.deepEqual(results.map((r) => r.dataset_id), ['ds_1', 'ds_2', 'ds_3'])
})

test('in-flight 合并：相同 capability+params+task 的并发请求只执行一次，共享同一个 DatasetRef', async () => {
  const { hub } = makeHub()
  const source = testSource('merged', { delayMs: 10 })
  hub.registerSource(source)
  const results = await Promise.all([1, 2, 3].map(() => hub.request(request({ capability: 'merged', params: { n: 42 } }))))
  assert.equal(source.calls(), 1, '合并请求只应执行一次')
  assert.equal(new Set(results.map((r) => r.dataset_id)).size, 1, '合并请求共享同一个 Dataset')
})

test('manifest 复用：相同 capability+params 的顺序请求复用已有 Dataset，不重复取数', async () => {
  const { hub } = makeHub()
  const source = testSource('reuse')
  hub.registerSource(source)
  const first = await hub.request(request({ capability: 'reuse', params: { n: 1 } }))
  const second = await hub.request(request({ capability: 'reuse', params: { n: 1 } }))
  assert.equal(source.calls(), 1, 'manifest 命中后不得再次访问数据源')
  assert.equal(first.dataset_id, second.dataset_id, '普通请求应返回已有 DatasetRef')
})

test('params_digest：DatasetRef 只携带不可逆摘要，不暴露原始请求参数', async () => {
  const { hub, store } = makeHub()
  hub.registerSource(testSource('digest'))
  const ref = await hub.request(request({ capability: 'digest', params: { thscode: '600519.SH', secret: 'should-not-appear' } }))
  assert.match(ref.params_digest, /^[a-f0-9]{64}$/)
  assert.doesNotMatch(ref.params_digest, /600519|secret|should-not-appear/)
  assert.match(store.refs[0].params_digest, /^[a-f0-9]{64}$/)
})

test('force_refresh：绕过 manifest 复用并生成新 Dataset，旧结果不被覆盖', async () => {
  const { hub, store } = makeHub()
  hub.registerSource(testSource('fresh'))
  await hub.request(request({ capability: 'fresh' }))
  const refreshed = await hub.request(request({ capability: 'fresh', force_refresh: true }))
  assert.equal(store.refs.length, 2)
  assert.equal(refreshed.dataset_id, 'ds_2')
})

test('capability 路由：请求 A 绝不会执行 source B；未知 capability 报错', async () => {
  const { hub } = makeHub()
  const calls = []
  hub.registerSource({
    schema: { capability: 'search', name: 's', source: 'api:test', data_key: 'k1', input_schema: {} },
    execute: async () => { calls.push('search'); return { data: { item: [] } } },
  })
  hub.registerSource({
    schema: { capability: 'history', name: 'h', source: 'api:test', data_key: 'k2', input_schema: {} },
    execute: async () => { calls.push('history'); return { data: { item: [] } } },
  })
  const ref = await hub.request(request({ capability: 'history', params: {} }))
  assert.equal(ref.capability, 'history')
  assert.deepEqual(calls, ['history'], '只能执行请求的 capability')
  await assert.rejects(() => hub.request(request({ capability: 'nope' })), /no data source is registered for capability nope/)
  assert.deepEqual(calls, ['history'], '未知 capability 不得 fallback 到其他 source')
})

test('超时：超过 requestTimeoutMs 抛错 request timed out（传输超时，非数据生命周期）', async () => {
  const { hub } = makeHub({ requestTimeoutMs: 20 })
  hub.registerSource(testSource('hang', { delayMs: 5000 }))
  await assert.rejects(() => hub.request(request({ capability: 'hang' })), /request timed out/)
})

test('失败：数据源抛错时错误文本明确，store 不被调用', async () => {
  const { hub, store } = makeHub()
  hub.registerSource(testSource('bad', { failWith: 'Fuyao API error 401: unauthorized' }))
  await assert.rejects(() => hub.request(request({ capability: 'bad' })), /Fuyao API error/)
  assert.equal(store.saves(), 0)
})

test('落盘失败：store 拒绝时请求失败并如实传播（workspace_not_writable 不吞掉）', async () => {
  const { hub } = makeHub({ store: fakeStore({ failWith: new DatasetStoreError('workspace_not_writable', 'read-only workspace') }) })
  hub.registerSource(testSource('writable'))
  await assert.rejects(() => hub.request(request({ capability: 'writable' })), /workspace_not_writable: read-only workspace/)
})

test('队列满：超过 maxQueueLength 直接抛错不入队', async () => {
  const { hub } = makeHub({ maxQueueLength: 1 })
  hub.registerSource(testSource('full', { delayMs: 50 }))
  const first = hub.request(request({ capability: 'full', params: { i: 1 } }))
  await assert.rejects(() => hub.request(request({ capability: 'full', params: { i: 2 } })), /queue is full/)
  assert.ok(await first, '第一个请求仍正常完成')
})

test('source output guard 失败时不落盘', async () => {
  const { hub, store } = makeHub()
  hub.registerSource({
    schema: { capability: 'guarded', name: 'g', source: 'api:test', data_key: 'test.guarded', input_schema: {} },
    validateOutput: () => false,
    execute: async () => ({ data: { wrong: true } }),
  })
  await assert.rejects(() => hub.request(request({ capability: 'guarded' })), /incompatible with its output contract/)
  assert.equal(store.saves(), 0)
})

test('超时会释放 FIFO worker，即使数据源不响应 AbortSignal', async () => {
  const { hub } = makeHub({ requestTimeoutMs: 10 })
  hub.registerSource({
    schema: { capability: 'mixed', name: 'm', source: 'api:test', data_key: 'test.mixed', input_schema: {} },
    execute: async (req) => req.params.mode === 'hang' ? new Promise(() => {}) : { data: { item: [] } },
  })
  const hanging = hub.request(request({ capability: 'mixed', params: { mode: 'hang' } }))
  const next = hub.request(request({ capability: 'mixed', params: { mode: 'ok' } }))
  await assert.rejects(() => hanging, /request timed out/)
  assert.equal((await next).dataset_id, 'ds_1')
})

test('调用方 signal 中止：等待者被摘除并报错，共享执行照常落盘', async () => {
  const { hub, store } = makeHub()
  hub.registerSource(testSource('sig', { delayMs: 30 }))
  const controller = new AbortController()
  const pending = hub.request(request({ capability: 'sig' }), { signal: controller.signal })
  controller.abort()
  await assert.rejects(() => pending, /aborted/)
  await sleep(60)
  assert.equal(store.saves(), 1, '被中止的执行仍应完成落盘')
})

test('已中止的 signal：请求直接报错不入队', async () => {
  const { hub } = makeHub()
  hub.registerSource(testSource('x'))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => hub.request(request({ capability: 'x' }), { signal: controller.signal }), /aborted/)
})

test('缺字段：capability 或 session 缺失时报错明确', async () => {
  const { hub } = makeHub()
  await assert.rejects(() => hub.request(request({ capability: '' })), /capability is required/)
  await assert.rejects(() => hub.request(request({ session: undefined })), /calling agent session is required/)
})

test('listCapabilities：只暴露模型可见字段，不含内部 name/source/data_key/source_label', async () => {
  const { hub } = makeHub()
  hub.registerSource({
    schema: {
      capability: 'quote',
      name: 'get_a_share_prices_snapshot',
      source: 'api:fuyao',
      data_key: 'fuyao.api.api.a-share.prices.snapshot',
      source_label: 'fuyao',
      paginated: true,
      description: '行情快照',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
    },
    execute: async () => ({ data: {} }),
  })
  const capabilities = hub.listCapabilities()
  assert.equal(capabilities.length, 1)
  assert.deepEqual(Object.keys(capabilities[0]).sort(), ['capability', 'description', 'input_schema', 'output_schema', 'paginated'])
  assert.equal(capabilities[0].capability, 'quote')
  assert.equal(capabilities[0].paginated, true)
})

test('真实 Fuyao 四源：capability 短名映射正确，data_key 仅内部保留', async () => {
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
    const { hub, store } = makeHub()
    for (const source of createFuyaoRestSources(async () => 'key')) hub.registerSource(source)
    assert.deepEqual(hub.listCapabilities().map((c) => c.capability), [
      'ticker_search', 'quote', 'history', 'trading_calendar',
    ])
    const results = await Promise.all([
      hub.request(request({ capability: 'ticker_search', params: { q: '指南针' } })),
      hub.request(request({ capability: 'quote', params: { thscodes: '300803.SZ' } })),
      hub.request(request({ capability: 'history', params: { thscode: '300803.SZ', interval: '1d', start: 1, end: 2 } })),
      hub.request(request({ capability: 'trading_calendar', params: {} })),
    ])
    assert.deepEqual(results.map((r) => [r.capability, r.source_label, r.format, r.row_count]), [
      ['ticker_search', 'fuyao', 'json_rows', 1],
      ['quote', 'fuyao', 'json_rows', 1],
      ['history', 'fuyao', 'json_rows', 1],
      ['trading_calendar', 'fuyao', 'json_rows', 1],
    ])
    assert.equal(store.saves(), 4)
  } finally {
    globalThis.fetch = originalFetch
  }
})
