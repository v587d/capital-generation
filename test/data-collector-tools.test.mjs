import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerDataCollectorTools } from '../lib/data-collector/tools.js'
import { DataCollectorHub } from '../lib/data-collector/hub.js'

function fakeToolRuntime() {
  const definitions = []
  const registry = []
  return {
    definitions,
    register: (definition) => {
      definitions.push(definition)
      registry.push(definition)
      return () => { const i = registry.indexOf(definition); if (i >= 0) registry.splice(i, 1) }
    },
  }
}

function fakeCtx(toolRuntime) {
  const effects = []
  return {
    get: (name) => (name === 'tools' ? toolRuntime : undefined),
    effect: (fn) => { effects.push(fn); return fn() }, // 真实 Cordis effect 会立即执行同步副作用
  }
}

function source(name, dataKey = `test.${name}`) {
  return { schema: { name, source: 'api:test', data_key: dataKey, input_schema: {} }, execute: async () => ({ data: { ok: 1 } }) }
}

function makeHubAndTools(options = {}) {
  const hub = new DataCollectorHub(options)
  const toolRuntime = fakeToolRuntime()
  const ctx = fakeCtx(toolRuntime)
  registerDataCollectorTools(ctx, hub, options.diagnostics)
  return { hub, toolRuntime, ctx }
}

const exec = (agentId, signal) => ({ agent: agentId ? { id: agentId } : undefined, signal: signal ?? new AbortController().signal })

function runTool(toolRuntime, name, args, execution) {
  const definition = toolRuntime.definitions.find((d) => d.name === name)
  assert.ok(definition, `tool ${name} 已注册`)
  return definition.execute(args, execution)
}

test('工具注册：三个数据工具 + 注入 diagnostics 时的 dc_status', () => {
  const { toolRuntime } = makeHubAndTools()
  assert.deepEqual(toolRuntime.definitions.map((d) => d.name), [
    'request_data', 'get_latest', 'list_schemas',
  ])
  for (const definition of toolRuntime.definitions) {
    assert.equal(typeof definition.description, 'string')
    assert.ok(definition.description.length > 20, `${definition.name} 描述应自述完整`)
    assert.ok(definition.parameters, `${definition.name} 必须有 parameters`)
    assert.ok(definition.output?.schema, `${definition.name} 必须有 output schema`)
  }
  const { toolRuntime: withDiag } = makeHubAndTools({ diagnostics: { probeApiKey: async () => ({ present: false, source: null }), getRegistrationError: () => undefined } })
  assert.ok(withDiag.definitions.some((d) => d.name === 'dc_status'), '注入 diagnostics 时 dc_status 应注册')
})

test('render 回归：渲染的是返回值而非入参（此前 bug 恒为 {}）', () => {
  const { toolRuntime } = makeHubAndTools()
  const definition = toolRuntime.definitions.find((d) => d.name === 'list_schemas')
  const blocks = definition.output.render({ some: 'arg' }, ['get_a_share_prices_snapshot'])
  assert.equal(blocks[0].type, 'text')
  assert.equal(blocks[0].text, JSON.stringify(['get_a_share_prices_snapshot']), '必须渲染 value 而不是 args')
})

test('request_data：阻塞返回 CacheEntry，请求归属恒为调用者，schema 无 request_id/requester_agent_id', async () => {
  const { hub, toolRuntime } = makeHubAndTools()
  hub.registerSource(source('s', 'test.k'))
  const result = await runTool(toolRuntime, 'request_data', { data_key: 'test.k', params: {} }, exec('main-agent'))
  assert.equal(result.data.ok, 1)
  assert.equal(result.from_cache, false)
  assert.equal(result.source, 's')
  // schema 不允许模型传 requester_agent_id/request_id（additionalProperties:false）
  const parameters = toolRuntime.definitions.find((d) => d.name === 'request_data').parameters
  assert.ok(!('requester_agent_id' in parameters.properties), 'request_data 不应接受 requester_agent_id')
  assert.ok(!('request_id' in parameters.properties), 'request_data 不应接受 request_id')
  const output = toolRuntime.definitions.find((d) => d.name === 'request_data').output.schema
  assert.ok(!('request_id' in output.properties), 'request_data 输出不应包含 request_id')
})

test('request_data：缓存命中立即返回 from_cache=true', async () => {
  const { hub, toolRuntime } = makeHubAndTools()
  hub.registerSource(source('s', 'test.k'))
  await runTool(toolRuntime, 'request_data', { data_key: 'test.k', params: {} }, exec('main'))
  const second = await runTool(toolRuntime, 'request_data', { data_key: 'test.k', params: {} }, exec('main'))
  assert.equal(second.from_cache, true)
})

test('request_data：无调用 Agent 身份时拒绝（官方 exec.agent 注入，不可伪造）', async () => {
  const { toolRuntime } = makeHubAndTools()
  await assert.rejects(
    () => runTool(toolRuntime, 'request_data', { data_key: 'k', params: {} }, exec(undefined)),
    /calling agent/,
  )
})

test('request_data：缺字段时错误明确（工具层校验，不吞成字符串）', async () => {
  const { toolRuntime } = makeHubAndTools()
  await assert.rejects(() => runTool(toolRuntime, 'request_data', { params: {} }, exec('a')), /data_key is required/)
})

test('request_data：执行失败/超时直接抛错（error 文本，供如实回传）', async () => {
  const { hub, toolRuntime } = makeHubAndTools({ requestTimeoutMs: 20 })
  hub.registerSource({
    schema: { name: 'mixed', source: 'api:test', data_key: 'test.mixed', input_schema: {} },
    execute: async (req) => {
      if (req.params.mode === 'fail') throw new Error('boom')
      return new Promise(() => {})
    },
  })
  await assert.rejects(() => runTool(toolRuntime, 'request_data', { data_key: 'test.mixed', params: { mode: 'fail' } }, exec('main')), /boom/)
  await assert.rejects(() => runTool(toolRuntime, 'request_data', { data_key: 'test.mixed', params: { mode: 'hang' } }, exec('main')), /request timed out/)
})

test('get_latest：缓存读取与缺失', async () => {
  const { hub, toolRuntime } = makeHubAndTools()
  hub.registerSource(source('s', 'test.k'))
  await runTool(toolRuntime, 'request_data', { data_key: 'test.k', params: {} }, exec('main'))
  const latest = await runTool(toolRuntime, 'get_latest', { data_key: 'test.k' }, exec('main'))
  assert.ok(latest)
  assert.equal(latest.from_cache, true)
  const missing = await runTool(toolRuntime, 'get_latest', { data_key: 'nope' }, exec('main'))
  assert.equal(missing, null)
})

test('list_schemas：反映当前挂载集合（含规范 data_key 与 ttl_ms）', async () => {
  const { hub, toolRuntime } = makeHubAndTools()
  hub.registerSource({ schema: { name: 'get_a_share_prices_snapshot', source: 'api:fuyao', data_key: 'fuyao.api.api.a-share.prices.snapshot', ttl_ms: 60000, input_schema: { type: 'object' } }, execute: async () => ({ data: {} }) })
  const schemas = await runTool(toolRuntime, 'list_schemas', {}, exec('main'))
  assert.equal(schemas.length, 1)
  assert.equal(schemas[0].name, 'get_a_share_prices_snapshot')
  assert.equal(schemas[0].source, 'api:fuyao')
  assert.equal(schemas[0].data_key, 'fuyao.api.api.a-share.prices.snapshot')
  assert.equal(schemas[0].ttl_ms, 60000)
})

test('tools 缺失：ctx.get(tools) 为空时不注册也不抛', () => {
  const ctx = fakeCtx(undefined)
  registerDataCollectorTools(ctx, new DataCollectorHub())
  assert.equal(ctx.effects, undefined)
})

test('dc_status：注入 diagnostics 时注册且返回凭据/数据源/注册错误', async () => {
  const { hub, toolRuntime } = makeHubAndTools({
    diagnostics: {
      probeApiKey: async () => ({ present: true, source: 'file' }),
      getRegistrationError: () => undefined,
    },
  })
  hub.registerSource({ schema: { name: 'get_meta_tickers_search', source: 'api:fuyao', input_schema: {} }, execute: async () => ({ data: {} }) })
  const status = await runTool(toolRuntime, 'dc_status', {}, exec('main'))
  assert.equal(status.api_key.present, true)
  assert.equal(status.api_key.source, 'file')
  assert.deepEqual(status.registered_sources, ['get_meta_tickers_search'])
  assert.equal(status.registration_error, null)
})

test('dc_status：未配置 key 与注册错误时如实上报（不泄露值）', async () => {
  const { toolRuntime } = makeHubAndTools({
    diagnostics: {
      probeApiKey: async () => ({ present: false, source: null }),
      getRegistrationError: () => 'FUYAO_API_KEY 未配置（DSH credentials 优先，环境变量回退），同花顺数据源未注册',
    },
  })
  const status = await runTool(toolRuntime, 'dc_status', {}, exec('main'))
  assert.equal(status.api_key.present, false)
  assert.equal(status.registered_sources.length, 0)
  assert.match(status.registration_error, /FUYAO_API_KEY 未配置/)
})