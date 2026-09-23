import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, LOCAL_FETCH_DEFAULTS } from '../lib/index.js'
import { ROOT_AGENT_DENIED_TOOLS } from '../lib/agents/root-tool-policy.js'
import { collectUndeclaredRequired } from './output-contract.mjs'

/**
 * 装配入口的集成测试。
 *
 * 此前所有测试都是**手工构造 Hub** 或手工注入 diagnostics，没有任何一条真正调用
 * `apply()`；于是"生产装配路径是否真的注册了全部数据源 / 工具 / 诊断状态"只靠声明，
 * 没有证据。这里用最小假 ctx 走一遍真实装配。
 */

/** 最小 ctx：只实现 apply() 真正触达的服务与生命周期方法。 */
function fakeCtx({ credentials } = {}) {
  const tools = []
  const services = new Map()
  const effectResults = []
  const listeners = []
  const ctx = {
    get: (name) => {
      if (name === 'tools') return { register: (definition) => { tools.push(definition); return () => {} } }
      if (name === 'credentials') return credentials
      return services.get(name)
    },
    provide: (name, value) => { services.set(name, value) },
    effect: (callback) => { effectResults.push(callback()); return () => {} },
    on: (event, listener) => { listeners.push({ event, listener }); return () => {} },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    systemPrompt: { section: () => () => {} },
  }
  return { ctx, tools, services, effectResults, listeners }
}

const toolNamed = (tools, name) => tools.find((definition) => definition.name === name)

const SCHEMA_KEYS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
  'description', 'title', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly',
])

function assertSupportedSchema(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  for (const key of Object.keys(value)) {
    assert.ok(SCHEMA_KEYS.has(key), `${path} 使用了 DSH 不支持的 JSON Schema 关键字 ${key}`)
  }
  if (value.properties && typeof value.properties === 'object') {
    for (const [key, child] of Object.entries(value.properties)) assertSupportedSchema(child, `${path}.properties.${key}`)
  }
  if (value.items) assertSupportedSchema(value.items, `${path}.items`)
  if (Array.isArray(value.oneOf)) value.oneOf.forEach((child, index) => assertSupportedSchema(child, `${path}.oneOf[${index}]`))
  if (value.additionalProperties && typeof value.additionalProperties === 'object') {
    assertSupportedSchema(value.additionalProperties, `${path}.additionalProperties`)
  }
}

const assertToolSchemas = (tools) => {
  for (const definition of tools) {
    assertSupportedSchema(definition.parameters, `${definition.name}.parameters`)
    assertSupportedSchema(definition.output?.schema, `${definition.name}.output`)
  }
}

const delegated = { id: 'child-1', header: { cwd: '/workspace/proj', parentSession: 'main-1' } }
const exec = (session) => ({ agent: { id: session.id, session }, signal: new AbortController().signal })

const SAVED_KEY = process.env.FUYAO_API_KEY

test('apply()：有 Key 时注册全部数据源，并暴露完整工具表', async () => {
  process.env.FUYAO_API_KEY = 'smoke-key'
  try {
    const { ctx, tools, services, effectResults } = fakeCtx()
    apply(ctx, { customPersona: '', retriever: { baseURL: '', credentialRef: '', windDocs: { endpoint: '', credentialRef: '', timeoutMs: 0 } } })
    await Promise.all(effectResults)

    const hub = services.get('dataCollectorHub')
    assert.ok(hub, 'apply 必须提供 dataCollectorHub 服务')
    assert.ok(services.get('datasetStore'), 'apply 必须提供 datasetStore 服务')
    assert.equal(hub.capabilityNames().length, 61, '装配后应注册全部 61 个 Fuyao capability')

    for (const name of ['request_data', 'list_capabilities', 'describe_capability', 'dc_status', 'describe_dataset', 'inspect_dataset', 'profile_dataset', 'query_dataset', 'prepare_chart_source', 'get_local_datetime', 'resolve_data_time_range', 'web_retriever_search', 'web_retriever_fetch', 'wind_docs_announcements', 'wind_docs_news', 'render_chart']) {
      assert.ok(toolNamed(tools, name), `装配后应注册工具 ${name}`)
    }
    // 2026-09-17 设计修订：final_report 整条链路删除（报告投影不再是主 Agent 的职责）。
    assert.equal(toolNamed(tools, 'final_report'), undefined, 'final_report 不应再注册')
    assertToolSchemas(tools)

    // dc_status 应报告 Key 存在且无注册错误
    const status = await toolNamed(tools, 'dc_status').execute({}, exec(delegated))
    assert.equal(status.api_key.present, true)
    assert.equal(status.api_key.source, 'env(FUYAO_API_KEY)')
    assert.equal(status.registration_error, null)
    assert.equal(status.registered_capabilities.length, 61)

    // 能力目录应可用（两级发现的第一级）
    const directory = await toolNamed(tools, 'list_capabilities').execute({}, exec(delegated))
    assert.equal(directory.length, 61)
    const detail = await toolNamed(tools, 'describe_capability').execute({ capability: 'quote' }, exec(delegated))
    assert.equal(detail.capability, 'quote')
  } finally {
    if (SAVED_KEY === undefined) delete process.env.FUYAO_API_KEY
    else process.env.FUYAO_API_KEY = SAVED_KEY
  }
})

test('apply()：无 Key 时数据源不注册，但工具仍可见且 dc_status 说明原因', async () => {
  delete process.env.FUYAO_API_KEY
  try {
    const { ctx, tools, services, effectResults } = fakeCtx()
    apply(ctx, { customPersona: '', retriever: { baseURL: '', credentialRef: '', windDocs: { endpoint: '', credentialRef: '', timeoutMs: 0 } } })
    await Promise.all(effectResults)

    const hub = services.get('dataCollectorHub')
    assert.equal(hub.capabilityNames().length, 0, '无凭据时不应注册任何 Fuyao 数据源')

    // 工具表与凭据状态解耦：Key 缺失不能让子 Agent 创建失败（toolFilter 里的名字必须真实存在）
    for (const name of ['request_data', 'list_capabilities', 'describe_capability', 'dc_status']) {
      assert.ok(toolNamed(tools, name), `无 Key 时仍应注册 ${name}`)
    }

    const status = await toolNamed(tools, 'dc_status').execute({}, exec(delegated))
    assert.equal(status.api_key.present, false)
    assert.match(status.registration_error, /FUYAO_API_KEY/)
    assert.deepEqual(status.registered_capabilities, [])

    // 目录为空时 describe_capability 必须给出可引导的错误，而不是含糊的 not found
    await assert.rejects(
      () => toolNamed(tools, 'describe_capability').execute({ capability: 'quote' }, exec(delegated)),
      /capability_catalog_empty/,
    )
  } finally {
    if (SAVED_KEY !== undefined) process.env.FUYAO_API_KEY = SAVED_KEY
  }
})

test('apply()：credentials 优先于环境变量', async () => {
  process.env.FUYAO_API_KEY = 'env-key-should-lose'
  try {
    const { ctx, tools, effectResults } = fakeCtx({
      credentials: { resolve: async (ref) => (ref === 'FUYAO_API_KEY' ? { value: 'cred-key', source: 'file' } : undefined) },
    })
    apply(ctx, { customPersona: '', retriever: { baseURL: '', credentialRef: '', windDocs: { endpoint: '', credentialRef: '', timeoutMs: 0 } } })
    await Promise.all(effectResults)

    const status = await toolNamed(tools, 'dc_status').execute({}, exec(delegated))
    assert.equal(status.api_key.present, true)
    assert.equal(status.api_key.source, 'file', 'credentials 解析成功时应报告其 source')
  } finally {
    if (SAVED_KEY === undefined) delete process.env.FUYAO_API_KEY
    else process.env.FUYAO_API_KEY = SAVED_KEY
  }
})

/**
 * 事故回归（2026-09-14）：`query_dataset` 的 parameters 根曾写成 `{ oneOf: [...] }`
 * 而没有 `type: 'object'`。模型供应商在请求进入时整体校验
 * `tools[].function.parameters`，直接返回 400
 * （`Invalid schema for function 'query_dataset': schema must be a JSON Schema of
 * 'type: "object"', got 'type: null'`）。校验早于模型生成第一个 token，而这份工具表
 * 在会话组作用域里主 Agent 也带着 —— 于是**每个** Capital 会话在第 1 轮第 1 步整体
 * 失败，与用户问什么无关。这里把「根 schema 只能是 object + properties」钉成装配期
 * 不变量，任何新增工具踩到同一坑都会在这里失败，而不是上线后在真实会话里 400。
 */
function assertObjectSchemas(node, path, toolName) {
  if (Array.isArray(node)) {
    node.forEach((child, index) => assertObjectSchemas(child, `${path}[${index}]`, toolName))
    return
  }
  if (!node || typeof node !== 'object') return
  if ('properties' in node) {
    assert.equal(node.type, 'object', `${toolName}: ${path} 声明了 properties 却没有 type: 'object'`)
  }
  for (const [key, value] of Object.entries(node)) assertObjectSchemas(value, `${path}.${key}`, toolName)
}

test('apply()：所有注册工具的 parameters 根必须是 object 型 schema', async () => {
  process.env.FUYAO_API_KEY = 'smoke-key'
  try {
    const { ctx, tools, effectResults } = fakeCtx()
    apply(ctx, { customPersona: '', retriever: { baseURL: '', credentialRef: '', windDocs: { endpoint: '', credentialRef: '', timeoutMs: 0 } } })
    await Promise.all(effectResults)

    assert.ok(tools.length >= 12, `工具表过小（${tools.length}），回归测试会失去意义`)
    for (const definition of tools) {
      const parameters = definition.parameters
      assert.ok(parameters && typeof parameters === 'object', `${definition.name} 必须有 parameters`)
      assert.equal(parameters.type, 'object', `${definition.name}: parameters 根必须声明 type: 'object'`)
      assert.ok(parameters.properties && typeof parameters.properties === 'object', `${definition.name}: parameters 必须给出 properties`)
      // 根级组合子会让供应商只看到空参数表；API 侧的 object 校验也可能直接拒绝。
      for (const combinator of ['oneOf', 'anyOf', 'allOf']) {
        assert.equal(combinator in parameters, false, `${definition.name}: parameters 根不允许出现 ${combinator}`)
      }
      assertObjectSchemas(parameters, `${definition.name}.parameters`, definition.name)
    }

    // 本次事故的具体工具必须显式覆盖，避免上面的通用断言被整体绕过
    const query = toolNamed(tools, 'query_dataset')
    assert.equal(query.parameters.type, 'object')
    assert.ok(query.parameters.properties.query, 'envelope 形态的 query 字段必须出现在根 properties 里')
  } finally {
    if (SAVED_KEY === undefined) delete process.env.FUYAO_API_KEY
    else process.env.FUYAO_API_KEY = SAVED_KEY
  }
})

test('apply()：所有注册工具的 output.schema 结构自洽（required 必须声明过）', async () => {
  process.env.FUYAO_API_KEY = 'smoke-key'
  try {
    const { ctx, tools, effectResults } = fakeCtx()
    apply(ctx, { customPersona: '', retriever: { baseURL: '', credentialRef: '', windDocs: { endpoint: '', credentialRef: '', timeoutMs: 0 } } })
    await Promise.all(effectResults)

    // 结构不变量：`required` 里写了一个没在 properties 里声明的键，宿主一定判"缺字段"，
    // 而本地 test 直接调 execute 看不见（2026-09-23 事故，见 test/output-contract.mjs）。
    // 真实返回值是否合规由各工具自己的用例断言（多形态工具必须逐形态来）。
    for (const definition of tools) {
      const schema = definition.output?.schema
      if (schema === undefined) continue
      assert.deepEqual(collectUndeclaredRequired(schema), [], `${definition.name}: output.schema 的 required 含未声明属性`)
    }
  } finally {
    if (SAVED_KEY === undefined) delete process.env.FUYAO_API_KEY
    else process.env.FUYAO_API_KEY = SAVED_KEY
  }
})

test('apply()：注册根 Agent 工具收敛监听（只拿掉主 Agent 的专属入口）', async () => {
  process.env.FUYAO_API_KEY = 'smoke-key'
  try {
    const { ctx, listeners, effectResults } = fakeCtx()
    apply(ctx, { customPersona: '', retriever: { baseURL: '', credentialRef: '', windDocs: { endpoint: '', credentialRef: '', timeoutMs: 0 } } })
    await Promise.all(effectResults)

    const created = listeners.filter((entry) => entry.event === 'agent/created')
    assert.equal(created.length, 1, 'apply 必须恰好注册一个 agent/created 监听')

    const restricted = []
    const agentCtx = { tools: { restrict: (filter) => { restricted.push(filter); return () => {} } } }
    // 根 Agent（无 parentSession）→ 收敛；子 Agent（有 parentSession）→ 原样放行。
    created[0].listener({ agent: { session: { header: { cwd: '/w' } }, ctx: agentCtx } })
    created[0].listener({ agent: { session: { header: { cwd: '/w', parentSession: 'main-1' } }, ctx: agentCtx } })
    assert.equal(restricted.length, ROOT_AGENT_DENIED_TOOLS.length, '根 Agent 逐名收敛；子 Agent 一次都不碰')
    assert.deepEqual(restricted.map((filter) => filter.deny[0]).sort(), [...ROOT_AGENT_DENIED_TOOLS].sort())

    // 收敛失败（工具名未知 / ctx 缺工具）不得抛出：调用方是 agent 创建路径。
    assert.doesNotThrow(() => created[0].listener({ agent: { session: { header: {} }, ctx: { tools: { restrict: () => { throw new Error('unknown tool') } } } } }))
    assert.doesNotThrow(() => created[0].listener({ agent: { session: { header: {} }, ctx: {} } }))
  } finally {
    if (SAVED_KEY === undefined) delete process.env.FUYAO_API_KEY
    else process.env.FUYAO_API_KEY = SAVED_KEY
  }
})

test('apply()：render_chart 注册在 standing 层（由根 Agent 收敛决定谁能看见）', async () => {
  process.env.FUYAO_API_KEY = 'smoke-key'
  try {
    const { ctx, tools, effectResults } = fakeCtx()
    apply(ctx, { customPersona: '', retriever: { baseURL: '', credentialRef: '', windDocs: { endpoint: '', credentialRef: '', timeoutMs: 0 } } })
    await Promise.all(effectResults)

    const renderChart = toolNamed(tools, 'render_chart')
    assert.ok(renderChart, 'render_chart 必须仍被注册：visualization_specialist 的 toolFilter.allow 依赖它')
    // 委派调用者（有 parentSession）不带 chart_source_ref 时必须被拒 —— 这正是主 Agent 失去
    // 这个工具后也不会被"顺手出图"的运行时兜底。
    const delegatedSession = { id: 'child-1', header: { cwd: '/workspace/proj', parentSession: 'main-1' } }
    await assert.rejects(
      () => renderChart.execute({ dataset_id: 'ds_1', spec: { kind: 'line', series: ['close'] } }, exec(delegatedSession)),
      (error) => error.code === 'chart_source_scope_mismatch',
      '委派调用者必须用 chart_source_ref，不能用 dataset_id / path',
    )
    // 描述里必须写清"只回小回执"与"不要把图表文件写进正文"。
    assert.match(renderChart.description, /只回一条小回执/)
    assert.match(renderChart.description, /不要.*罗列图表文件/)
  } finally {
    if (SAVED_KEY === undefined) delete process.env.FUYAO_API_KEY
    else process.env.FUYAO_API_KEY = SAVED_KEY
  }
})

test('apply()：customPersona 注册为独立 system-prompt 节', () => {
  const { ctx, effectResults } = fakeCtx()
  const sections = []
  ctx.systemPrompt = { section: (section) => { sections.push(section); return () => {} } }
  apply(ctx, { customPersona: '偏好表格化输出', retriever: { baseURL: '', credentialRef: '', windDocs: { endpoint: '', credentialRef: '', timeoutMs: 0 } } })
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'capital:user-customization')
  assert.match(sections[0].text, /NON-OVERRIDABLE SAFETY REMINDER/)
  assert.ok(effectResults.length > 0)
})

/** AnySearch 401/403 → AUTH（可回退失败）；本机直连用 IP 字面量，不触发 DNS。 */
const authFailureResponse = () => ({
  status: 403,
  ok: false,
  headers: { get: () => 'application/json' },
  text: async () => JSON.stringify({ code: 1, message: 'forbidden' }),
})
const htmlResponse = (body) => ({
  status: 200,
  ok: true,
  headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
  body: null,
  text: async () => body,
})

test('apply()：本地回退默认启用并把 UA 落到本机直连请求；enabled:false 时不再发第二次请求', async () => {
  process.env.FUYAO_API_KEY = 'smoke-key'
  const originalFetch = globalThis.fetch
  try {
    // 1) 缺省配置（retriever 未给 localFetch）：AnySearch 403 → 自动本机直连，UA 非空。
    {
      const { ctx, tools, effectResults } = fakeCtx()
      const requests = []
      globalThis.fetch = async (url, init) => {
        requests.push({ url: String(url), init })
        if (String(url).includes('anysearch.test')) return authFailureResponse()
        return htmlResponse('<p>local body</p>')
      }
      apply(ctx, { customPersona: '', retriever: { baseURL: 'https://anysearch.test', credentialRef: '', windDocs: {} } })
      await Promise.all(effectResults)

      const result = await toolNamed(tools, 'web_retriever_fetch')
        .execute({ url: 'http://93.184.216.34/page' }, exec(delegated))
      assert.equal(result.ok, true)
      assert.equal(result.via, 'local-http')
      assert.equal(result.fallback.code, 'AUTH')
      assert.equal(requests.length, 2, '缺省配置必须启用本地回退（消费点默认值独立生效）')
      assert.equal(requests[1].init.headers['user-agent'], LOCAL_FETCH_DEFAULTS.userAgent)
      assert.equal(LOCAL_FETCH_DEFAULTS.userAgent, '@v587d/capital-generation')
    }

    // 2) enabled:false：AnySearch 403 → 工具错误（抛错，isError:true），只有一次请求。
    {
      const { ctx, tools, effectResults } = fakeCtx()
      let calls = 0
      globalThis.fetch = async () => { calls += 1; return authFailureResponse() }
      apply(ctx, { customPersona: '', retriever: { baseURL: 'https://anysearch.test', credentialRef: '', windDocs: {}, localFetch: { enabled: false } } })
      await Promise.all(effectResults)

      let payload
      await assert.rejects(
        () => toolNamed(tools, 'web_retriever_fetch')
          .execute({ url: 'http://93.184.216.34/page' }, exec(delegated)),
        (error) => { payload = JSON.parse(error.message); return true },
      )
      assert.equal(payload.ok, false)
      assert.equal(payload.via, 'anysearch')
      assert.equal(payload.code, 'AUTH')
      assert.equal(payload.fallback, undefined)
      assert.equal(calls, 1, '回退被禁用时不得发起第二次网络请求')
    }
  } finally {
    globalThis.fetch = originalFetch
    if (SAVED_KEY === undefined) delete process.env.FUYAO_API_KEY
    else process.env.FUYAO_API_KEY = SAVED_KEY
  }
})
