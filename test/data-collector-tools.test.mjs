import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerDataCollectorTools, DATASET_REF_FIELDS } from '../lib/data-collector/tools.js'
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

function source(capability) {
  return {
    schema: {
      capability,
      name: `src_${capability}`,
      source: 'api:test',
      data_key: `test.${capability}`,
      input_schema: { type: 'object' },
    },
    execute: async () => ({ data: { ok: 1 } }),
  }
}

function fakeStore() {
  const saves = []
  return {
    saves,
    async save(input) {
      const ref = {
        dataset_id: `ds_${saves.length + 1}`,
        task_id: input.task_id ?? null,
        session_id: input.session.id,
        artifact_ref: `workspace://capital-data/datasets/ds_${saves.length + 1}`,
        format: input.format,
        capability: input.capability,
        source_label: input.source_label,
        schema: input.schema,
        row_count: input.row_count,
        captured_at: 1_700_000_000_000,
        retention_until: 1_700_604_800_000,
        params_digest: input.params_digest,
      }
      saves.push(input)
      return ref
    },
  }
}

function makeHubAndTools(options = {}) {
  const store = options.store ?? fakeStore()
  const hub = new DataCollectorHub({ store, ...options })
  const toolRuntime = fakeToolRuntime()
  const ctx = fakeCtx(toolRuntime)
  registerDataCollectorTools(ctx, hub, options.diagnostics)
  return { hub, store, toolRuntime, ctx }
}

const exec = (currentSession) => ({ agent: currentSession ? { id: currentSession.id, session: currentSession } : undefined, signal: new AbortController().signal })
const session = (overrides = {}) => ({ id: 'sess-1', header: { cwd: '/workspace/proj' }, ...overrides })
const delegatedSession = () => session({ header: { cwd: '/workspace/proj', parentSession: 'main-1' } })

function runTool(toolRuntime, name, args, execution) {
  const definition = toolRuntime.definitions.find((d) => d.name === name)
  assert.ok(definition, `tool ${name} 已注册`)
  return definition.execute(args, execution)
}

test('工具注册：request_data + list_capabilities；get_latest/list_schemas 已删除', () => {
  const { toolRuntime } = makeHubAndTools()
  assert.deepEqual(toolRuntime.definitions.map((d) => d.name), ['request_data', 'list_capabilities'])
  assert.ok(!toolRuntime.definitions.some((d) => d.name === 'get_latest'), 'get_latest 不应注册')
  assert.ok(!toolRuntime.definitions.some((d) => d.name === 'list_schemas'), 'list_schemas 不应注册')
  for (const definition of toolRuntime.definitions) {
    assert.equal(typeof definition.description, 'string')
    assert.ok(definition.description.length > 20, `${definition.name} 描述应自述完整`)
    assert.ok(definition.parameters, `${definition.name} 必须有 parameters`)
    assert.ok(definition.output?.schema, `${definition.name} 必须有 output schema`)
  }
  const { toolRuntime: withDiag } = makeHubAndTools({ diagnostics: { probeApiKey: async () => ({ present: false, source: null }), getRegistrationError: () => undefined } })
  assert.ok(withDiag.definitions.some((d) => d.name === 'dc_status'), '注入 diagnostics 时 dc_status 应注册')
})

test('request_data schema：只接受 capability/params/force_refresh/task_id，无任何内部字段', () => {
  const { toolRuntime } = makeHubAndTools()
  const parameters = toolRuntime.definitions.find((d) => d.name === 'request_data').parameters
  assert.deepEqual(Object.keys(parameters.properties).sort(), ['capability', 'force_refresh', 'params', 'task_id'])
  assert.deepEqual(parameters.required, ['capability', 'params'])
  assert.equal(parameters.additionalProperties, false)
  for (const forbidden of ['data_key', 'source_preference', 'schema_hint', 'requester_agent_id', 'request_id']) {
    assert.ok(!(forbidden in parameters.properties), `request_data 不应接受 ${forbidden}`)
  }
})

test('request_data 输出 schema：严格 DatasetRef 白名单，无 data/raw/内部键/绝对路径', () => {
  const { toolRuntime } = makeHubAndTools()
  const output = toolRuntime.definitions.find((d) => d.name === 'request_data').output.schema
  assert.deepEqual(Object.keys(output.properties).sort(), [...DATASET_REF_FIELDS].sort())
  assert.equal(output.additionalProperties, false)
  for (const forbidden of ['data', 'rows', 'data_key', 'source', 'from_cache', 'updated_at', 'expires_at', 'path']) {
    assert.ok(!(forbidden in output.properties), `request_data 输出不应包含 ${forbidden}`)
  }
})

test('request_data：返回 DatasetRef，宿主 store 收到 capability/params/task/session，raw 不出现在结果里', async () => {
  const { hub, store, toolRuntime } = makeHubAndTools()
  hub.registerSource(source('quote'))
  const result = await runTool(toolRuntime, 'request_data', { capability: 'quote', params: { thscodes: '600519.SH' }, task_id: 'task-1' }, exec(delegatedSession()))
  assert.equal(result.dataset_id, 'ds_1')
  assert.equal(result.capability, 'quote')
  assert.equal(result.artifact_ref, 'workspace://capital-data/datasets/ds_1')
  assert.ok(!('data' in result), '返回结果中不得出现 raw data')
  const saved = store.saves[0]
  assert.equal(saved.capability, 'quote')
  assert.equal(saved.task_id, 'task-1')
  assert.equal(saved.session.id, 'sess-1')
  assert.deepEqual(saved.data, { ok: 1 }, 'raw data 只进入 store，不进入返回值')
})

test('request_data：无调用 Agent session 时拒绝（官方 exec.agent 注入，不可伪造）', async () => {
  const { hub, toolRuntime } = makeHubAndTools()
  hub.registerSource(source('k'))
  await assert.rejects(
    () => runTool(toolRuntime, 'request_data', { capability: 'k', params: {} }, exec(undefined)),
    /calling agent session/,
  )
})

test('request_data：顶层 main session 直接调用被工具层拒绝', async () => {
  const { hub, toolRuntime } = makeHubAndTools()
  hub.registerSource(source('k'))
  await assert.rejects(
    () => runTool(toolRuntime, 'request_data', { capability: 'k', params: {} }, exec(session())),
    /restricted to delegated data agents/,
  )
})

test('request_data：缺 capability 时错误明确（工具层校验，不吞成字符串）', async () => {
  const { toolRuntime } = makeHubAndTools()
  await assert.rejects(() => runTool(toolRuntime, 'request_data', { params: {} }, exec(delegatedSession())), /capability is required/)
})

test('request_data：落盘失败（workspace_not_writable）如实抛出，不返回任何结果', async () => {
  const { store, hub, toolRuntime } = makeHubAndTools()
  hub.registerSource(source('writable'))
  store.save = async () => { throw new Error('workspace_not_writable: read-only workspace') }
  await assert.rejects(
    () => runTool(toolRuntime, 'request_data', { capability: 'writable', params: {} }, exec(delegatedSession())),
    /workspace_not_writable/,
  )
})

test('render 回归：渲染的是返回值而非入参（此前 bug 恒为 {}）', () => {
  const { toolRuntime } = makeHubAndTools()
  const definition = toolRuntime.definitions.find((d) => d.name === 'list_capabilities')
  const blocks = definition.output.render({ some: 'arg' }, [{ capability: 'quote' }])
  assert.equal(blocks[0].type, 'text')
  assert.equal(blocks[0].text, JSON.stringify([{ capability: 'quote' }]), '必须渲染 value 而不是 args')
})

test('list_capabilities：只返回 capability/description/input_schema/output_schema/paginated', async () => {
  const { hub, toolRuntime } = makeHubAndTools()
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
  const capabilities = await runTool(toolRuntime, 'list_capabilities', {}, exec(delegatedSession()))
  assert.equal(capabilities.length, 1)
  assert.deepEqual(Object.keys(capabilities[0]).sort(), ['capability', 'description', 'input_schema', 'output_schema', 'paginated'])
  assert.equal(capabilities[0].capability, 'quote')
})

test('dc_status：上报 registered_capabilities 而非内部 source 名，不泄露密钥值', async () => {
  const { hub, toolRuntime } = makeHubAndTools({
    diagnostics: {
      probeApiKey: async () => ({ present: true, source: 'file' }),
      getRegistrationError: () => undefined,
    },
  })
  hub.registerSource(source('quote'))
  const status = await runTool(toolRuntime, 'dc_status', {}, exec(delegatedSession()))
  assert.equal(status.api_key.present, true)
  assert.equal(status.api_key.source, 'file')
  assert.deepEqual(status.registered_capabilities, ['quote'])
  assert.equal(status.registration_error, null)
})

test('tools 缺失：ctx.get(tools) 为空时不注册也不抛', () => {
  const ctx = fakeCtx(undefined)
  const hub = new DataCollectorHub({ store: fakeStore() })
  registerDataCollectorTools(ctx, hub)
  assert.equal(ctx.effects, undefined)
})
