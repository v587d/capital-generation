import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DataCollectorHub, buildDataKey, normalizeKeyToken } from '../lib/data-collector/hub.js'
import { DatasetStoreError } from '../lib/data-collector/store.js'
import { createFuyaoRestSources } from '../lib/sources/fuyao-rest.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const SESSION = { id: 'session-1', header: { cwd: '/workspace/proj' } }

/** 已注册的 Fuyao capability（Phase 1 四个 + Phase 2 十四个）。 */
const PHASE2_CAPABILITIES = [
  'ticker_list', 'corporate_actions', 'income_statement', 'balance_sheet', 'cash_flow',
  'financial_indicators', 'valuation', 'auction', 'limit_up_pool', 'limit_up_ladder',
  'index_catalog', 'index_constituents', 'index_quote', 'index_history',
]
const PHASE3_CAPABILITIES = [
  'limit_down_pool', 'limit_break_pool', 'skyrocket_list', 'hot_stock_list', 'hot_stock_history',
  'hot_stock_rank_trend', 'anomaly_list', 'anomaly_stock', 'dragon_tiger', 'auction_benchmark',
]
const PHASE3B_CAPABILITIES = [
  'fund_profile', 'fund_quote', 'fund_history', 'fund_nav', 'fund_returns', 'fund_drawdowns',
  'fund_holdings', 'fund_asset_allocation', 'fund_industry_allocation', 'fund_stock_history',
  'fund_holders', 'fund_top_holders', 'fund_manager', 'fund_company',
]
const PHASE3C_CAPABILITIES = [
  'fund_performance_history', 'fund_bond_history', 'fund_stock_report_dates', 'fund_bond_report_dates',
  'fund_manager_experience', 'fund_manager_style', 'fund_manager_performance',
  'fund_income', 'fund_balance', 'fund_financial_indicators',
  'fund_indicator_line', 'fund_indicator_table', 'fund_dividends', 'fund_offerings',
  'fund_quota_list', 'fund_quota_summary', 'fund_diagnostics', 'fund_backtest', 'fund_backtest_indicators',
]
const FUYAO_CAPABILITIES = ['ticker_search', 'quote', 'history', 'trading_calendar', ...PHASE2_CAPABILITIES, ...PHASE3_CAPABILITIES, ...PHASE3B_CAPABILITIES, ...PHASE3C_CAPABILITIES]

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

test('listCapabilities：只暴露 capability/summary/paginated，不含内部字段与 schema', async () => {
  const { hub } = makeHub()
  hub.registerSource({
    schema: {
      capability: 'quote',
      name: 'get_a_share_prices_snapshot',
      source: 'api:fuyao',
      data_key: 'fuyao.api.api.a-share.prices.snapshot',
      source_label: 'fuyao',
      paginated: true,
      summary: '行情快照',
      description: '行情快照的完整说明。',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
    },
    execute: async () => ({ data: {} }),
  })
  const capabilities = hub.listCapabilities()
  assert.equal(capabilities.length, 1)
  assert.deepEqual(Object.keys(capabilities[0]).sort(), ['capability', 'paginated', 'summary'])
  assert.equal(capabilities[0].capability, 'quote')
  assert.equal(capabilities[0].paginated, true)
  assert.equal(capabilities[0].summary, '行情快照')
  assert.deepEqual(hub.capabilityNames(), ['quote'])
})

test('describeCapability：返回单个能力详情，未知名字返回 undefined（由工具层分类）', () => {
  const { hub } = makeHub()
  hub.registerSource({
    schema: {
      capability: 'quote',
      name: 'get_a_share_prices_snapshot',
      source: 'api:fuyao',
      data_key: 'fuyao.api.api.a-share.prices.snapshot',
      source_label: 'fuyao',
      paginated: true,
      summary: '行情快照',
      description: '完整说明',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
    },
    execute: async () => ({ data: {} }),
  })
  const detail = hub.describeCapability('quote')
  assert.ok(detail)
  assert.deepEqual(Object.keys(detail).sort(), ['capability', 'description', 'input_schema', 'output_schema', 'paginated', 'summary'])
  assert.equal(detail.description, '完整说明')
  assert.equal(hub.describeCapability('nope'), undefined)
  const serialized = JSON.stringify(detail)
  for (const forbidden of ['data_key', 'api:fuyao', 'get_a_share_prices_snapshot']) {
    assert.ok(!serialized.includes(forbidden), `详情不应泄露内部字段 ${forbidden}`)
  }
})

test('能力目录体积预算：必须留在 DSH 剪枝阈值（8192）以内，否则中间能力会被截断', async () => {
  const { hub } = makeHub()
  for (const dataSource of createFuyaoRestSources(async () => 'key')) hub.registerSource(dataSource)
  const directory = JSON.stringify(hub.listCapabilities())
  assert.ok(hub.capabilityNames().length >= 61, '端点数量回归：目录预算断言必须覆盖全部已注册能力')

  // 预算的来源（实测本机 dsh 0.1.5-rc.1，不是拍脑袋的数字）：
  // - 真实上限是 dsh-compaction-tool-result-pruner 的 `thresholdChars`（preset 里配 8192）。
  //   它**不可按 Agent 区分**：全仓只有这一个包持有该配置，且主 Agent 与子 Agent 共用
  //   同一份 standing composition（同一个 pruner 实例），所以"只给 data_collector 提高预算"
  //   在 DSH 里没有配置路径。
  // - 超过 8192 的后果：保留 head 4096 + tail 1024、中间替换为 PRUNE_MARKER，
  //   即目录**中间段的能力会在发现阶段消失**。
  // - 因此这里取 8192 的 75%（6144），留 2048 字符余量：逼近真实上限时先让测试失败，
  //   而不是运行时静默截断。按当前每端点约 79 字符计，可容纳约 78 个能力。
  const DIRECTORY_BUDGET = 6144
  assert.ok(directory.length < DIRECTORY_BUDGET, `能力目录 JSON 已达 ${directory.length} 字符（预算 ${DIRECTORY_BUDGET}，剪枝阈值 8192）：请精简 summary、改紧凑编码，或与用户确认是否上调 preset 的剪枝阈值`)
  assert.ok(directory.length < 8192, '目录绝不允许越过剪枝阈值')

  // 单能力详情不随端点数增长（最大约 2.3KB），用更紧的 4096 做回归护栏。
  const details = hub.capabilityNames().map((capability) => JSON.stringify(hub.describeCapability(capability)))
  const largest = Math.max(...details.map((detail) => detail.length))
  assert.ok(largest < 4096, `最大的能力详情已达 ${largest} 字符：会被剪枝截断，需要精简或拆分`)
})

test('真实 Fuyao 源：capability 短名映射正确，data_key 仅内部保留', async () => {
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
    assert.deepEqual(hub.listCapabilities().map((c) => c.capability), FUYAO_CAPABILITIES)
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

test('真实 Fuyao 源：Phase 2 首批 14 个端点全部注册且可路由', async () => {
  const { hub } = makeHub()
  const capabilities = createFuyaoRestSources(async () => 'key').map((source) => source.schema.capability)
  for (const source of createFuyaoRestSources(async () => 'key')) hub.registerSource(source)
  assert.deepEqual(capabilities, FUYAO_CAPABILITIES)
  assert.equal(hub.listCapabilities().length, FUYAO_CAPABILITIES.length)
  const registered = hub.listCapabilities().map((entry) => entry.capability)
  for (const capability of [...PHASE2_CAPABILITIES, ...PHASE3_CAPABILITIES, ...PHASE3B_CAPABILITIES, ...PHASE3C_CAPABILITIES]) {
    assert.ok(registered.includes(capability), `${capability} 必须已注册`)
  }
})

test('能力目录：每个端点都必须有非空 summary（目录只靠它选能力）', () => {
  const { hub } = makeHub()
  for (const dataSource of createFuyaoRestSources(async () => 'key')) hub.registerSource(dataSource)
  for (const entry of hub.listCapabilities()) {
    assert.ok(typeof entry.summary === 'string' && entry.summary.length > 0, `${entry.capability} 缺 summary`)
    assert.ok(entry.summary.length <= 60, `${entry.capability} 的 summary 过长（${entry.summary.length}）：目录是发现入口，要短`)
  }
})

test('Phase 2 端到端：涨停池落成 json_rows，嵌套财务指标落成 json', async () => {
  const { hub } = makeHub()
  for (const source of createFuyaoRestSources(async () => 'key')) hub.registerSource(source)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname
    if (path.endsWith('limit-up-pool')) {
      return { ok: true, json: async () => ({ code: 0, data: { timestamp: 1, pagination: { total: 2, pages: 1, size: 50, page: 1 }, item: [{ thscode: '603986.SH' }, { thscode: '000001.SZ' }] } }) }
    }
    return { ok: true, json: async () => ({ code: 0, data: { thscode: '300033.SZ', report: '2025-1', abilities: [{ ability: 'growth', indicators: [{ index_id: 'total_assets_growth_ratio', value: '-16.0031' }] }] } }) }
  }
  try {
    const pool = await hub.request(request({ capability: 'limit_up_pool', params: { page: 1, size: 50 } }))
    assert.equal(pool.format, 'json_rows')
    assert.equal(pool.row_count, 2, 'Dataset 行数只反映本页，不冒充上游 pagination.total')
    const indicators = await hub.request(request({ capability: 'financial_indicators', params: { thscode: '300033.SZ', report: '2025-1' } }))
    assert.equal(indicators.format, 'json', '嵌套响应没有 item[]，按通用 JSON 落盘')
    assert.equal(indicators.row_count, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('normalizeParams：Hub 在 digest 与执行前规范化参数，语义相同的请求复用同一 Dataset', async () => {
  const { hub, store } = makeHub()
  const seen = []
  hub.registerSource({
    schema: { capability: 'norm', name: 'n', source: 'api:test', data_key: 'test.norm', input_schema: {} },
    normalizeParams: (params) => ({ key: String(params.key ?? '').trim().toLowerCase() }),
    execute: async (req) => { seen.push(req.params); return { data: { item: [] } } },
  })
  const first = await hub.request(request({ capability: 'norm', params: { key: ' ABC ' } }))
  const second = await hub.request(request({ capability: 'norm', params: { key: 'abc' } }))
  assert.equal(first.dataset_id, second.dataset_id, '书写不同、语义相同必须命中同一 Dataset')
  assert.deepEqual(seen, [{ key: 'abc' }], '数据源必须收到规范化后的参数')
  assert.equal(store.saves(), 1)
})

test('normalizeParams：抛错时请求在入队前失败，数据源与 store 都不被触碰', async () => {
  const { hub, store } = makeHub()
  let executed = 0
  hub.registerSource({
    schema: { capability: 'reject', name: 'r', source: 'api:test', data_key: 'test.reject', input_schema: {} },
    normalizeParams: () => { throw new Error('bad params') },
    execute: async () => { executed += 1; return { data: { item: [] } } },
  })
  await assert.rejects(() => hub.request(request({ capability: 'reject' })), /bad params/)
  assert.equal(executed, 0)
  assert.equal(store.saves(), 0)
})

test('Fuyao 参数规范化端到端：大小写/空白/重复代码差异只取数一次并复用同一 Dataset', async () => {
  const originalFetch = globalThis.fetch
  let fetches = 0
  globalThis.fetch = async () => {
    fetches += 1
    return { ok: true, json: async () => ({ code: 0, data: { item: [{ thscode: '600519.SH', last_price: 1 }] } }) }
  }
  try {
    const { hub, store } = makeHub()
    for (const source of createFuyaoRestSources(async () => 'key')) hub.registerSource(source)
    const first = await hub.request(request({ capability: 'quote', params: { thscodes: '600519.sh' } }))
    const second = await hub.request(request({ capability: 'quote', params: { thscodes: ' 600519.SH , 600519.SH' } }))
    assert.equal(first.dataset_id, second.dataset_id)
    assert.equal(fetches, 1, '规范化后只应访问上游一次')
    assert.equal(store.saves(), 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Fuyao 参数校验端到端：Hub 在入队前拒绝裸代码，store 不被调用', async () => {
  const { hub, store } = makeHub()
  for (const source of createFuyaoRestSources(async () => 'key')) hub.registerSource(source)
  await assert.rejects(
    () => hub.request(request({ capability: 'history', params: { thscode: '600519', interval: '1d', start: 1, end: 2 } })),
    /full thscode/,
  )
  assert.equal(store.saves(), 0)
})

// ── 复核修正（2026-09 独立测试报告）──────────────────────────────────────────

test('修正②：共享的 manifest lookup 不绑定首个调用者的取消信号', async () => {
  // 这个 store 的 findLatest 遵守 AbortSignal —— 正是问题场景
  let saves = 0
  const store = {
    async save(input) {
      saves += 1
      return {
        dataset_id: `ds_${saves}`, task_id: null, session_id: input.session.id,
        artifact_ref: `workspace://capital-data/datasets/ds_${saves}`, format: input.format,
        capability: input.capability, source_label: input.source_label, schema: input.schema,
        row_count: input.row_count, captured_at: 1, retention_until: 2, params_digest: input.params_digest,
      }
    },
    async findLatest({ signal }) {
      await sleep(20)
      if (signal?.aborted) throw new Error('lookup aborted')
      return undefined
    },
  }
  const hub = new DataCollectorHub({ store })
  hub.registerSource(testSource('shared'))

  const first = new AbortController()
  const cancelled = hub.request(request({ capability: 'shared', params: { n: 1 } }), { signal: first.signal })
  first.abort()
  const survivor = hub.request(request({ capability: 'shared', params: { n: 1 } }))

  await assert.rejects(() => cancelled, /aborted/)
  const ref = await survivor
  assert.equal(ref.capability, 'shared', '首调用者取消后，其余调用者必须仍能独立完成')
  assert.equal(saves, 1)
})

test('修正③：数据集错误码穿过 Hub 后仍是结构化 error.code', async () => {
  const { hub } = makeHub({ store: fakeStore({ failWith: new DatasetStoreError('workspace_not_writable', 'read-only workspace') }) })
  hub.registerSource(testSource('coded'))
  await assert.rejects(
    () => hub.request(request({ capability: 'coded' })),
    (error) => {
      assert.equal(error.code, 'workspace_not_writable', '错误码必须保留，而不是只剩消息前缀')
      assert.match(error.message, /workspace_not_writable/)
      return true
    },
  )
})

test('修正③：无 code 的普通错误不应被伪造出 code', async () => {
  const { hub } = makeHub()
  hub.registerSource(testSource('plain', { failWith: 'Fuyao API error 4001: rate limited' }))
  await assert.rejects(
    () => hub.request(request({ capability: 'plain' })),
    (error) => {
      assert.equal(error.code, undefined)
      assert.match(error.message, /Fuyao API error 4001/)
      return true
    },
  )
})
