import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

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
  const ctx = {
    get: (name) => {
      if (name === 'tools') return { register: (definition) => { tools.push(definition); return () => {} } }
      if (name === 'credentials') return credentials
      return services.get(name)
    },
    provide: (name, value) => { services.set(name, value) },
    effect: (callback) => { effectResults.push(callback()); return () => {} },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    systemPrompt: { section: () => () => {} },
  }
  return { ctx, tools, services, effectResults }
}

const toolNamed = (tools, name) => tools.find((definition) => definition.name === name)
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

    for (const name of ['request_data', 'list_capabilities', 'describe_capability', 'dc_status', 'inspect_dataset', 'profile_dataset', 'get_local_datetime', 'web_retriever_search', 'web_retriever_fetch', 'wind_docs_announcements', 'wind_docs_news']) {
      assert.ok(toolNamed(tools, name), `装配后应注册工具 ${name}`)
    }

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
