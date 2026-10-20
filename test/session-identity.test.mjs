import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerDataCollectorTools } from '../lib/data-collector/tools.js'
import { registerDatasetTools } from '../lib/data-collector/dataset-tools.js'
import { registerChartSourceTool } from '../lib/chart/source-token.js'
import { DataCollectorHub } from '../lib/data-collector/hub.js'
import { assertToolOutput } from './output-contract.mjs'
import { resetSessionIdentityDecisions, sessionIdentityDecisions } from '../lib/tool-exec.js'
import { CHART_SOURCE_PRESET_IDS, DATA_COLLECTION_PRESET_IDS, DATASET_READING_PRESET_IDS } from '../lib/preset-ids.js'

// Tool authorization is judged by preset identity, never by session topology (`parentSession`).
// One file because the predicate spans three entry points (data collection / dataset read / chart
// source issuing): the §9.7 incidents were "only the wired entry got tested", and the per-entry
// `delegatedSession` copies are gone. Design: docs/design/agent-preset-four-modes.md §4.1.

const ROOT_CAPITAL = { id: 'root-capital', header: { cwd: '/workspace/proj' } }
const STANDALONE_ROLE = { id: 'root-role', header: { cwd: '/workspace/proj' } }
const DELEGATED_CHILD = { id: 'child-1', header: { cwd: '/workspace/proj', parentSession: 'root-capital' } }

/** Fake registry: `composedPreset` answers from the marker carried on agent.ctx (real one same shape). */
const registry = (agentCtx) => (agentCtx === undefined || agentCtx === null ? undefined : agentCtx.presetId)

function fakeCtx({ presetService = registry, tools } = {}) {
  const definitions = []
  return {
    definitions,
    register(into) { into.push(...definitions.splice(0)) },
    get: (name) => {
      if (name === 'tools') return { register: (definition) => { definitions.push(definition); return () => {} } }
      if (name === 'agentPresets') return presetService === undefined ? undefined : { composedPreset: presetService }
      return undefined
    },
    effect: (fn) => { fn(); return () => {} },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    ...{ tools },
  }
}

const exec = (session, presetId) => ({
  agent: { session, ctx: presetId === NO_PRESET ? undefined : { presetId } },
  signal: new AbortController().signal,
})
const NO_PRESET = Symbol('no preset')

function toolNamed(definitions, name) {
  const definition = definitions.find((candidate) => candidate.name === name)
  assert.ok(definition, `${name} 已注册`)
  return definition
}

/** Collection face: fake store behind the hub, so an open gate really saves a Dataset. */
function collectorTools(ctxOptions) {
  const ctx = fakeCtx(ctxOptions)
  const saves = []
  const store = { async save(input) { saves.push(input); return { dataset_id: 'ds_1', task_id: null, session_id: input.session.id, artifact_ref: 'workspace://capital-data/datasets/ds_1', format: 'json_rows', capability: input.capability, source_label: 'api:test', schema: { type: 'array' }, row_count: 1, captured_at: 1_700_000_000_000, retention_until: 1_700_604_800_000, params_digest: 'digest-1' } } }
  const hub = new DataCollectorHub({ store })
  hub.registerSource({ schema: { capability: 'quote', name: 'src_quote', source: 'api:test', data_key: 'test.quote', input_schema: { type: 'object' } }, execute: async () => ({ data: [{ ok: 1 }] }) })
  const diagnostics = { probeApiKey: async () => ({ present: true, source: 'env', error: null }), rootPolicy: () => [], onCall: () => {} }
  registerDataCollectorTools(ctx, hub, diagnostics)
  return { ctx, saves }
}

/** Dataset-read face: the store only needs to be reached; the gate decision is what is asserted. */
function datasetTools(ctxOptions) {
  const ctx = fakeCtx(ctxOptions)
  const reads = []
  const store = {
    async inspectDataset(dataset_id, session) { reads.push({ dataset_id, session: session.id }); return { dataset_id, artifact_ref: 'workspace://x', query_access: { shape: 'array' } } },
  }
  registerDatasetTools(ctx, store)
  return { ctx, reads }
}

/** Chart-source face: token repo is a stub, only to observe whether the gate lets the call through. */
function chartSourceTools(ctxOptions) {
  const ctx = fakeCtx(ctxOptions)
  const issued = []
  const store = { async inspectDataset(dataset_id) { return { dataset_id, artifact_ref: 'workspace://x', schema: { type: 'array' }, row_count: 1 } } }
  const tokens = { async issue(input) { issued.push(input); return { chart_source_ref: 'cs_test', dataset_id: input.dataset_id, task_id: 'task_1', expires_at: 1_700_000_900_000 } } }
  registerChartSourceTool(ctx, { store, tokens })
  return { ctx, issued }
}

test('判据集合：主 Agent 不在任何授权集合里（§8.4 结构件）', () => {
  for (const set of [DATA_COLLECTION_PRESET_IDS, DATASET_READING_PRESET_IDS, CHART_SOURCE_PRESET_IDS]) {
    assert.ok(!set.includes('capital-generation'), 'capital-generation 一旦进集合，"主 Agent 禁止直连"就退了')
  }
})

test('身份确证 + 角色人设：没有 parentSession 的独立模式放行', async () => {
  resetSessionIdentityDecisions()
  const { ctx, saves } = collectorTools()
  const request = toolNamed(ctx.definitions, 'request_data')
  const result = await request.execute({ capability: 'quote', params: {}, task_id: 'task_1' }, exec(STANDALONE_ROLE, 'capital-data-collector'))
  assert.equal(result.dataset_id, 'ds_1', '闸门放行后应真的落一份 Dataset')
  assert.equal(saves.length, 1)
  const [record] = sessionIdentityDecisions()
  assert.deepEqual(record, { tool: 'request_data', via: 'preset', presetId: 'capital-data-collector', allowed: true })
})

test('身份确证 + 主 Agent：根会话仍被拒，且文案点名人设与须委派', async () => {
  resetSessionIdentityDecisions()
  const { ctx, saves } = collectorTools()
  const list = toolNamed(ctx.definitions, 'list_capabilities')
  await assert.rejects(() => list.execute({}, exec(ROOT_CAPITAL, 'capital-generation')), (error) => {
    assert.equal(error.code, 'dataset_session_mismatch')
    assert.match(error.message, /capital-generation/)
    assert.match(error.message, /主 Agent 请委派/)
    return true
  })
  assert.equal(saves.length, 0)
  assert.deepEqual(sessionIdentityDecisions(), [{ tool: 'list_capabilities', via: 'preset', presetId: 'capital-generation', allowed: false }])
})

test('⛔ 身份确证优先于拓扑：被委派的资讯子 Agent 也拿不到取数工具', async () => {
  // Bought by the preset predicate: the old topology rule let this delegated child through.
  const { ctx, saves } = collectorTools()
  const request = toolNamed(ctx.definitions, 'request_data')
  await assert.rejects(() => request.execute({ capability: 'quote', params: {}, task_id: 'task_1' }, exec(DELEGATED_CHILD, 'capital-web-retriever')), (error) => {
    assert.equal(error.code, 'dataset_session_mismatch')
    assert.match(error.message, /capital-web-retriever/)
    return true
  })
  assert.equal(saves.length, 0, '取数一份都不该发生')
})

test('registry 缺失时回落拓扑：委派子会话照旧放行（不比今天更宽）', async () => {
  resetSessionIdentityDecisions()
  const { ctx, saves } = collectorTools({ presetService: undefined })
  const request = toolNamed(ctx.definitions, 'request_data')
  await request.execute({ capability: 'quote', params: {}, task_id: 'task_1' }, exec(DELEGATED_CHILD, NO_PRESET))
  assert.equal(saves.length, 1)
  // Fallback has no identity to report, so `presetId` is null (§9.5: no undefined holes out of the tool layer).
  assert.deepEqual(sessionIdentityDecisions(), [{ tool: 'request_data', via: 'topology', presetId: null, allowed: true }])
})

test('registry 缺失时回落拓扑：根会话照旧拒绝，文案与今天同字', async () => {
  const { ctx } = collectorTools({ presetService: undefined })
  const list = toolNamed(ctx.definitions, 'list_capabilities')
  await assert.rejects(
    () => list.execute({}, exec(ROOT_CAPITAL, NO_PRESET)),
    /is restricted to delegated data agents; the main Agent must delegate this request/,
  )
})

test('composedPreset 抛错按"确证不了"处理：不因此放行根会话', async () => {
  const ctx = fakeCtx({ presetService: () => { throw new Error('registry 炸了') } })
  const saves = []
  const store = { async save(input) { saves.push(input); return {} } }
  const hub = new DataCollectorHub({ store })
  registerDataCollectorTools(ctx, hub, { probeApiKey: async () => ({ present: true, source: null, error: null }) })
  const list = toolNamed(ctx.definitions, 'list_capabilities')
  await assert.rejects(() => list.execute({}, exec(ROOT_CAPITAL, 'capital-data-collector')), /delegated data agents/)
  assert.equal(saves.length, 0)
})

test('Dataset 读面：独立开启的数据人设能读，主 Agent 不能', async () => {
  resetSessionIdentityDecisions()
  const { ctx, reads } = datasetTools()
  const inspect = toolNamed(ctx.definitions, 'inspect_dataset')
  for (const presetId of DATASET_READING_PRESET_IDS) {
    await inspect.execute({ dataset_id: 'ds_1' }, exec(STANDALONE_ROLE, presetId))
  }
  assert.deepEqual(reads.map((read) => read.session), DATASET_READING_PRESET_IDS.map(() => 'root-role'))
  assert.deepEqual(sessionIdentityDecisions().map(({ tool, presetId, allowed }) => ({ tool, presetId, allowed })),
    DATASET_READING_PRESET_IDS.map((presetId) => ({ tool: 'inspect_dataset', presetId, allowed: true })),
    '挂了 dataset-read 的 preset 必须在授权集合里，否则工具可见但一调用就拒绝')
  await assert.rejects(() => inspect.execute({ dataset_id: 'ds_1' }, exec(ROOT_CAPITAL, 'capital-generation')), (error) => error.code === 'dataset_session_mismatch')
  assert.equal(reads.length, DATASET_READING_PRESET_IDS.length, '主 Agent 那次不该落到 store')
})

test('出图签发面：身份确证即签发，报错形状留在 chart 域', async () => {
  resetSessionIdentityDecisions()
  const { ctx, issued } = chartSourceTools()
  const prepare = toolNamed(ctx.definitions, 'prepare_chart_source')
  const result = await prepare.execute({ dataset_id: 'ds_1', task_id: 'task_1' }, exec(STANDALONE_ROLE, 'capital-data-junior'))
  assert.equal(result.chart_source_ref, 'cs_test')
  assert.equal(issued.length, 1)
  // The decision shows up uniformly for all three entry points (via=preset), not only on the data side.
  assert.deepEqual(sessionIdentityDecisions(), [{ tool: 'prepare_chart_source', via: 'preset', presetId: 'capital-data-junior', allowed: true }])
  await assert.rejects(() => prepare.execute({ dataset_id: 'ds_1', task_id: 'task_1' }, exec(ROOT_CAPITAL, 'capital-generation')), (error) => {
    assert.equal(error.code, 'chart_source_scope_mismatch', 'code 不许被共用判定冲掉')
    return true
  })
})

test('dc_status 的 session_identity：形状无损且满足自己声明的 output.schema（§9.5 §9.6）', async () => {
  resetSessionIdentityDecisions()
  const { ctx } = collectorTools()
  const list = toolNamed(ctx.definitions, 'list_capabilities')
  await assert.rejects(() => list.execute({}, exec(ROOT_CAPITAL, 'capital-generation')))
  const status = toolNamed(ctx.definitions, 'dc_status')
  const value = await status.execute({}, exec(DELEGATED_CHILD, 'capital-data-collector'))
  assert.ok(Array.isArray(value.session_identity), 'session_identity 必须是数组')
  for (const record of value.session_identity) {
    assert.equal(typeof record.tool, 'string')
    assert.ok(record.via === 'preset' || record.via === 'topology')
    assert.equal(typeof record.allowed, 'boolean')
    assert.ok(record.preset_id === null || typeof record.preset_id === 'string', 'preset_id 不许带 undefined 出去')
  }
  assertToolOutput(status, value)
})
