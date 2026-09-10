import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFuyaoRestSources, resolveFuyaoApiKey } from '../lib/sources/fuyao-rest.js'

function fakeCtx(credentials) {
  return { get: (name) => (name === 'credentials' ? credentials : undefined) }
}

function request(params, overrides = {}) {
  return {
    capability: 'quote',
    params: params ?? {},
    session: { id: 'session-1', header: { cwd: '/workspace/proj' } },
    ...overrides,
  }
}

test('createFuyaoRestSources：Phase 1 四个数据源映射短 capability，各带独立完整 schema', () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('unexpected fetch') }
  try {
    const sources = createFuyaoRestSources(async () => 'key-1')
    assert.deepEqual(sources.map((s) => s.schema.capability), [
      'ticker_search',
      'quote',
      'history',
      'trading_calendar',
    ])
    assert.deepEqual(sources.map((s) => s.schema.name), [
      'get_meta_tickers_search',
      'get_a_share_prices_snapshot',
      'get_a_share_prices_historical',
      'get_a_share_calendar_trading_days',
    ])
    assert.deepEqual(sources.map((s) => s.schema.paginated), [false, true, true, false], 'quote/history 支持分页')
    for (const source of sources) {
      assert.ok(source.schema.input_schema, '每个数据源必须有 input_schema')
      assert.ok(source.schema.output_schema, '每个数据源必须有 output_schema')
      assert.equal(source.schema.source, 'api:fuyao')
      assert.equal(source.schema.source_label, 'fuyao')
      assert.equal(typeof source.schema.data_key, 'string', '内部 data_key 仅宿主保留')
      assert.ok(!('ttl_ms' in source.schema), '旧 TTL 缓存语义已删除')
    }
    assert.equal(sources[0].schema.data_key, 'fuyao.api.api.meta.tickers.search')
    assert.equal(sources[1].schema.input_schema.required.length, 0, '快照按代码查询才需 thscodes，未强制 required')
    assert.deepEqual(sources[2].schema.input_schema.required, ['thscode', 'interval', 'start', 'end'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('input_schema 契约：interval/adjust 枚举与参数说明按 ths_api.md 校准', () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('unexpected fetch') }
  try {
    const sources = createFuyaoRestSources(async () => 'key-1')
    const byName = Object.fromEntries(sources.map((s) => [s.schema.name, s.schema.input_schema]))
    // historical：interval 固定 1d；adjust 三取值；start/end 毫秒说明
    const historical = byName['get_a_share_prices_historical']
    assert.deepEqual(historical.properties.interval.enum, ['1d'], 'interval 当前固定支持 1d')
    assert.match(historical.properties.start.description, /毫秒/, 'start 需注明毫秒时间戳')
    assert.match(historical.properties.end.description, /毫秒/, 'end 需注明毫秒时间戳')
    assert.deepEqual(historical.properties.adjust.enum, ['none', 'forward', 'backward'])
    assert.match(historical.properties.adjust.description, /前复权/)
    // search：limit 默认值说明；asset_type 枚举说明
    const search = byName['get_meta_tickers_search']
    assert.match(search.properties.limit.description, /最大 50/)
    assert.match(search.properties.asset_type.description, /a-share|fund-etf/)
    // snapshot：thscodes 逗号分隔说明
    const snapshot = byName['get_a_share_prices_snapshot']
    assert.match(snapshot.properties.thscodes.description, /逗号分隔/)
    // calendar：无参
    assert.deepEqual(byName['get_a_share_calendar_trading_days'].properties, {})
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('execute：构造 X-api-key 头与 query，解析 envelope 数据', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, signal: init.signal })
    return {
      ok: true,
      json: async () => ({ code: 0, request_id: 'fuyao-1', data: { timestamp: 1, total: 1, item: [{ thscode: '600519.SH' }] } }),
    }
  }
  try {
    const sources = createFuyaoRestSources(async () => 'secret-key')
    const result = await sources[1].execute(request({ thscodes: '600519.SH' }), new AbortController().signal)
    assert.deepEqual(result.data.item, [{ thscode: '600519.SH' }])
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /\/api\/a-share\/prices\/snapshot\?thscodes=600519\.SH$/)
    assert.equal(calls[0].headers['X-api-key'], 'secret-key')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('execute：每次调用都重新解析 API Key（按次解析不缓存）', async () => {
  const originalFetch = globalThis.fetch
  let resolves = 0
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ code: 0, data: {} }) })
  try {
    const sources = createFuyaoRestSources(async () => { resolves += 1; return `key-${resolves}` })
    await sources[0].execute(request({ q: '茅台' }), new AbortController().signal)
    assert.equal(resolves, 1)
    await sources[0].execute(request({ q: '茅台' }), new AbortController().signal)
    assert.equal(resolves, 2, '每次 execute 必须重新解析')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('execute：缺 API Key 时明确报错，不静默、不编造', async () => {
  const sources = createFuyaoRestSources(async () => undefined)
  await assert.rejects(
    () => sources[0].execute(request({ q: '茅台' }), new AbortController().signal),
    /FUYAO_API_KEY is not configured/,
  )
})

test('execute：envelope code != 0 时抛带 request_id 的明确错误', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ code: 40001, message: 'bad auth', request_id: 'fuyao-x' }) })
  try {
    const sources = createFuyaoRestSources(async () => 'key')
    await assert.rejects(
      () => sources[1].execute(request({ thscodes: 'x' }), new AbortController().signal),
      /Fuyao API error 40001: bad auth \(request_id: fuyao-x\)/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('execute：HTTP 错误明确报出状态码', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 502 })
  try {
    const sources = createFuyaoRestSources(async () => 'key')
    await assert.rejects(() => sources[1].execute(request({}), new AbortController().signal), /Fuyao HTTP error 502/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('resolveFuyaoApiKey：不使用未命名的通用 API_KEY', async () => {
  const processLike = globalThis.process
  const savedFuyao = processLike.env.FUYAO_API_KEY
  const savedGeneric = processLike.env.API_KEY
  try {
    delete processLike.env.FUYAO_API_KEY
    processLike.env.API_KEY = 'unrelated-key'
    assert.equal(await resolveFuyaoApiKey(fakeCtx(undefined)), undefined)
  } finally {
    if (savedFuyao === undefined) delete processLike.env.FUYAO_API_KEY
    else processLike.env.FUYAO_API_KEY = savedFuyao
    if (savedGeneric === undefined) delete processLike.env.API_KEY
    else processLike.env.API_KEY = savedGeneric
  }
})

test('resolveFuyaoApiKey：优先 credentials，再回退环境变量', async () => {
  const processLike = globalThis.process
  const saved = processLike.env.FUYAO_API_KEY
  try {
    processLike.env.FUYAO_API_KEY = 'env-key'
    const ctxWithCredentials = fakeCtx({ resolve: async (ref) => (ref === 'FUYAO_API_KEY' ? { value: 'cred-key' } : undefined) })
    assert.equal(await resolveFuyaoApiKey(ctxWithCredentials), 'cred-key')
    assert.equal(await resolveFuyaoApiKey(fakeCtx(undefined)), 'env-key')
    delete processLike.env.FUYAO_API_KEY
    assert.equal(await resolveFuyaoApiKey(fakeCtx(undefined)), undefined)
  } finally {
    if (saved === undefined) delete processLike.env.FUYAO_API_KEY
    else processLike.env.FUYAO_API_KEY = saved
  }
})