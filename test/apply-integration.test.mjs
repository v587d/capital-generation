import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, readCapitalSettings, LOCAL_FETCH_DEFAULTS } from '../lib/index.js'
import { apply as applyPolicy } from '../lib/policy-entry.js'
import { apply as applyRootExtras } from '../lib/root-extras-entry.js'
import { resetRootPolicyProbes } from '../lib/agents/root-tool-policy.js'
import { SIBLING_DENIED_TOOLS, resetRolePolicyProbes } from '../lib/agents/role-tool-policy.js'
import { collectUndeclaredRequired } from './output-contract.mjs'

// apply() integration coverage: fake ctx with production wiring; hand-built hubs would leave registration unproven.
function fakeCtx({ credentials, settings } = {}) {
  const tools = []
  const pluginGuards = []
  const services = new Map()
  const effectResults = []
  const listeners = []
  const sections = []
  const warnings = []
  const ctx = {
    get: (name) => {
      if (name === 'tools') return {
        register: (definition) => { tools.push(definition); return () => {} },
        // Plugin-level guard registration; fs write gate is global, not per agent/created.
        guard: (guard) => { pluginGuards.push(guard); return () => {} },
      }
      if (name === 'credentials') return credentials
      // settings may arrive late: boot applies fibers in parallel.
      if (name === 'settings') return settings ?? services.get('settings')
      return services.get(name)
    },
    provide: (name, value) => { services.set(name, value) },
    effect: (callback) => { effectResults.push(callback()); return () => {} },
    on: (event, listener) => { listeners.push({ event, listener }); return () => {} },
    logger: { info() {}, warn(message) { warnings.push(String(message)) }, error() {}, debug() {} },
    systemPrompt: { section: (section) => { sections.push(section); return () => {} } },
  }
  return { ctx, tools, pluginGuards, services, effectResults, listeners, sections, warnings }
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
    assert.equal(hub.capabilityNames().length, 128, '装配后应注册 61 个 Fuyao、9 个 Tencent、21 个 Eastmoney、3 个 Wind 与 34 个 FTShare capability')

    for (const name of ['request_data', 'list_capabilities', 'describe_capability', 'dc_status', 'describe_dataset', 'inspect_dataset', 'profile_dataset', 'query_dataset', 'prepare_chart_source', 'get_local_datetime', 'resolve_data_time_range', 'get_watchlist', 'anysearch_search', 'web_retriever_fetch', 'wind_docs_announcements', 'wind_docs_news', 'ocr', 'render_chart']) {
      assert.ok(toolNamed(tools, name), `装配后应注册工具 ${name}`)
    }
    // final_report was removed and must not come back.
    assert.equal(toolNamed(tools, 'final_report'), undefined, 'final_report 不应再注册')
    assertToolSchemas(tools)

    const status = await toolNamed(tools, 'dc_status').execute({}, exec(delegated))
    assert.equal(status.api_key.present, true)
    assert.equal(status.api_key.source, 'env(FUYAO_API_KEY)')
    assert.equal(status.registered_capabilities.length, 128)
    // dc_status policy diagnostics come from production wiring and cover child roles too.
    assert.ok(Array.isArray(status.agent_tool_policy), 'apply() 必须把收敛现场注入 dc_status')
    assert.deepEqual(status.agent_tool_policy, [], '假装配里没有 agent 被创建，记录应为空数组而不是缺字段')

    const directory = await toolNamed(tools, 'list_capabilities').execute({}, exec(delegated))
    assert.equal(typeof directory, 'string')
    assert.equal(directory.split('\n').length, 128, '目录必须一行一条能力，行数等于注册数')
    assert.ok(directory.split('\n').every((line) => line.split('|').length >= 3), '每行都是 capability|summary|paginated')
    const detail = await toolNamed(tools, 'describe_capability').execute({ capability: 'quote' }, exec(delegated))
    assert.equal(detail.capability, 'quote')
    assert.ok(typeof detail.output_fields === 'string' && detail.output_fields.includes('item[].'), '详情必须给出字段字典（宽表靠它才不爆预算）')
  } finally {
    if (SAVED_KEY === undefined) delete process.env.FUYAO_API_KEY
    else process.env.FUYAO_API_KEY = SAVED_KEY
  }
})

// apply-time credential resolve() can be undefined without throwing: registration must not depend on it.
test('apply()：装配期凭据尚未装载时同花顺源照常注册，失败留到调用期点名', async () => {
  delete process.env.FUYAO_API_KEY
  try {
    let snapshotLoaded = false
    const { ctx, tools, services, effectResults } = fakeCtx({
      credentials: {
        resolve: async (ref) => (snapshotLoaded && ref === 'FUYAO_API_KEY'
          ? { value: 'cred-key', source: 'file' }
          : undefined),
      },
    })
    apply(ctx, { customPersona: '', retriever: { baseURL: '', credentialRef: '', windDocs: { endpoint: '', credentialRef: '', timeoutMs: 0 } } })
    await Promise.all(effectResults)

    const hub = services.get('dataCollectorHub')
    assert.equal(hub.capabilityNames().length, 128,
      '⛔ 61 个同花顺能力不得因"装配期没读到 key"缺席（桌面端实测：整场进程只剩 8 项且无重试）；FTShare 那 34 条同理，也不得因装配期没有 FTSHARE_API_KEY 而缺席')

    const unloaded = await toolNamed(tools, 'dc_status').execute({}, exec(delegated))
    assert.equal(unloaded.api_key.present, false, '快照未装载时探针必须如实报告拿不到 key')
    assert.equal('registration_error' in unloaded, false,
      '注册结果与凭据时刻解耦后，同一份 dc_status 不可能再同时报「key 有」和「源未注册」')

    // Tool table is decoupled from key state: toolFilter names must exist without a key.
    for (const name of ['request_data', 'list_capabilities', 'describe_capability', 'dc_status']) {
      assert.ok(toolNamed(tools, name), `无 Key 时仍应注册 ${name}`)
    }
    await assert.rejects(
      () => toolNamed(tools, 'request_data').execute({
        capability: 'quote', params: { thscodes: '600519.SH' }, task_id: 'task-no-key', force_refresh: true,
      }, exec(delegated)),
      /FUYAO_API_KEY/,
      '缺 key 必须响亮失败并点名引用名，不是含糊的 capability_unknown，也不是内存假成功',
    )

    snapshotLoaded = true
    const loaded = await toolNamed(tools, 'dc_status').execute({}, exec(delegated))
    assert.equal(loaded.api_key.present, true, '调用期解析必须看见晚到的凭据（README「卡片保存即生效」的前提）')
    assert.equal(loaded.api_key.source, 'file')
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

// Editable config comes from the capital-config entry via settings.describe(); a missing entry or throwing describe falls back to preset.
test('apply()：配置读自 capital-config 条目，条目缺席或报错时回落 preset 配置', async () => {
  process.env.FUYAO_API_KEY = 'env-key-should-lose'
  try {
    const asked = []
    const { ctx, tools, sections, effectResults } = fakeCtx({
      credentials: {
        resolve: async (ref) => {
          asked.push(ref)
          return ref === 'CUSTOM_FUYAO' ? { value: 'entry-key', source: 'credentials(CUSTOM_FUYAO)' } : undefined
        },
      },
      settings: {
        describe: () => [
          { ns: 'dsh-brand', value: {} },
          { ns: 'capital-config', value: { customPersona: '  从卡片保存的人设  ', fuyaoCredentialRef: 'CUSTOM_FUYAO' } },
        ],
      },
    })
    apply(ctx, { customPersona: '', fuyaoCredentialRef: 'FUYAO_API_KEY', retriever: { baseURL: '', credentialRef: '', windDocs: { endpoint: '', credentialRef: '', timeoutMs: 0 } } })
    await Promise.all(effectResults)

    const status = await toolNamed(tools, 'dc_status').execute({}, exec(delegated))
    assert.equal(status.api_key.present, true, '条目里的引用名必须被用上（否则卡片改了名却仍找默认名）')
    assert.equal(status.api_key.source, 'credentials(CUSTOM_FUYAO)')
    assert.ok(asked.includes('CUSTOM_FUYAO') && !asked.includes('FUYAO_API_KEY'),
      `解析凭证只能问条目给出的引用名，实际问过：${asked.join(', ')}`)
    assert.equal(sections.length, 1, '条目里的 customPersona 必须注册成人设节')
    assert.match(sections[0].text, /从卡片保存的人设/, '人设正文来自条目配置（首尾空白按实现 trim）')

    const falling = fakeCtx({
      credentials: { resolve: async () => undefined },
      settings: { describe: () => { throw new Error('entry not mounted') } },
    })
    apply(falling.ctx, { customPersona: 'preset 人设', fuyaoCredentialRef: 'FUYAO_API_KEY', retriever: {} })
    await Promise.all(falling.effectResults)
    assert.equal(falling.sections[0].text.includes('preset 人设'), true, 'describe 抛错时不得丢掉 preset 配置')
    const fallbackStatus = await toolNamed(falling.tools, 'dc_status').execute({}, exec(delegated))
    assert.equal(fallbackStatus.api_key.present, true, '回落路径仍按 FUYAO_API_KEY 找得到环境变量里的密钥')
  } finally {
    if (SAVED_KEY === undefined) delete process.env.FUYAO_API_KEY
    else process.env.FUYAO_API_KEY = SAVED_KEY
  }
})

// Read services at call time, never at apply time: boot can register settings late, and the silent all-off default looks like the user disabling everything.
test('readCapitalSettings：服务引用调用期现取，保存层兜底，preset 回落可辨认', () => {
  const boot = { customPersona: 'preset 人设' }
  let services
  const ctx = { get: (name) => services?.get(name) }

  assert.equal(readCapitalSettings(ctx, boot).source, 'preset')

  services = new Map([
    ['settings', { describe: () => [{ ns: 'capital-config', value: { customPersona: '  条目人设  ' } }] }],
  ])
  const applied = readCapitalSettings(ctx, boot)
  assert.equal(applied.source, 'settings-describe')
  assert.equal(applied.config.customPersona.trim(), '条目人设')

  services = new Map([
    ['settings', { describe: () => [{ ns: 'other-entry', value: {} }] }],
    ['configEditor', { entries: () => [{ options: { id: 'capital-config', config: { customPersona: '保存层人设' } } }] }],
  ])
  const saved = readCapitalSettings(ctx, boot)
  assert.equal(saved.source, 'config-editor')
  assert.equal(saved.config.customPersona, '保存层人设')

  services = new Map([
    ['settings', { describe: () => { throw new Error('entry not mounted') } }],
    ['configEditor', { entries: () => [{ options: { id: 'other', config: {} } }] }],
  ])
  assert.equal(readCapitalSettings(ctx, boot).source, 'preset')
})

test('tools/root-extras：settings 晚到也必须挂住精选 Skills 读取链路（保存后立刻建会话就得看得到）', async () => {
  const { ctx, listeners, services, effectResults } = fakeCtx()
  services.set('agentPresets', { composedPreset: () => 'capital-generation' })
  // No settings service at apply time, the real boot race.
  applyRootExtras(ctx)
  await Promise.all(effectResults)

  // A static all-off shortcut would skip the listener and lock selected skills for the process.
  let provider
  const cleanups = []
  const injectedCtx = {
    get: () => undefined,
    skills: {
      registerProvider(create) {
        provider = create({ signal: new AbortController().signal, invalidate() {} })
        return () => {}
      },
    },
    effect(callback) { cleanups.push(callback()) },
    on() { return () => {} },
  }
  const agent = {
    session: { id: 's-1', header: {} },
    ctx: { inject(_deps, callback) { callback(injectedCtx) } },
  }
  try {
    for (const { event, listener } of listeners) {
      if (event === 'agent/created') await listener({ agent })
    }
    assert.ok(provider, 'settings 服务缺席时也必须注册 selected skills provider（默认全关只是空目录）')
    assert.deepEqual((await provider.list({})).map(({ name }) => name), [], '默认全关：空目录')

    services.set('settings', {
      describe: () => [{ ns: 'capital-config', value: { selectedSkills: { buffettFramework: true } } }],
    })
    const names = (await provider.list({})).map(({ name }) => name)
    assert.ok(names.includes('buffett-investment-framework'),
      `晚到的 settings 必须立刻生效（首轮 catalog 就该看到），实际目录：${names.join(', ') || '(空)'}`)
    assert.ok(!names.includes('financial-health'), '没开的仍然不进目录（默认全关不许破）')
  } finally {
    // Dispose always: the real provider owns process-pinning watchers.
    for (const dispose of cleanups) dispose?.()
  }
})

test('tools/root-extras：customPersona 在下一轮 assembly 重读，保存后无需重启', () => {
  const { ctx, sections, services } = fakeCtx()
  applyRootExtras(ctx)
  assert.equal(sections.length, 1, 'root-extras 必须注册 customPersona 节')
  assert.equal(sections[0].name, 'capital:user-customization')
  assert.equal(sections[0].text(), '', '未保存人设时不注入正文')
  services.set('settings', {
    describe: () => [{ ns: 'capital-config', value: { customPersona: '  保存后的人设  ' } }],
  })
  assert.match(sections[0].text(), /保存后的人设/, '装配期只读一次会把保存前的人设钉到进程结束')
  assert.match(sections[0].text(), /NON-OVERRIDABLE SAFETY REMINDER/, '动态正文仍必须带安全脚注')
  services.set('settings', {
    describe: () => [{ ns: 'capital-config', value: { customPersona: 'x'.repeat(8_001) } }],
  })
  assert.equal(sections[0].text(), '', '超长人设不能把 prompt 组装打崩')
})

// A root `oneOf` without type: object makes the provider 400 the whole tool table before the first token.
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

// get_watchlist reads a late-arriving host service; register unconditionally and fail loudly.
test('apply()：get_watchlist 无条件注册，capitalWatchlist 晚到也照样读得到', async () => {
  process.env.FUYAO_API_KEY = 'smoke-key'
  try {
    const { ctx, tools, services, effectResults } = fakeCtx()
    apply(ctx, { customPersona: '', retriever: { baseURL: '', credentialRef: '', windDocs: { endpoint: '', credentialRef: '', timeoutMs: 0 } } })
    await Promise.all(effectResults)

    const definition = toolNamed(tools, 'get_watchlist')
    assert.ok(definition, '装配后必须注册 get_watchlist（host 平面那行在不在都要注册，否则它不在回归保护内）')

    const before = await definition.execute({}, exec(delegated))
    assert.equal(before.ok, false, '⛔ 服务没挂载时绝不回空清单：那会被模型答成"你还没加自选股"')
    assert.equal(before.code, 'watchlist_unavailable')
    assert.equal(before.items, undefined)

    services.set('capitalWatchlist', {
      list: async () => ({
        ok: true,
        limit: 30,
        items: [{ thscode: '300750.SZ', name: '宁德时代', asset_type: 'a-share', added_at: Date.now() - 86_400_000 }],
      }),
    })
    const after = await definition.execute({}, exec(delegated))
    assert.equal(after.ok, true, '同一进程里服务后到就要立刻读得到——装配期取一次 = 把用户的自选股锁到进程结束')
    assert.equal(after.count, 1)
    assert.equal(after.items[0].thscode, '300750.SZ')
    assert.equal(after.items[0].held, false, '没标过持仓就是未持仓，不是 0%')
    assert.equal(after.limit, 30, '上限从宿主回包来，不在插件侧抄常量')

    // Read-only: add/remove/mark live only in the panel UI.
    assert.equal(Object.keys(definition.parameters.properties).length, 0, 'get_watchlist 不该有任何入参')
  } finally {
    if (SAVED_KEY === undefined) delete process.env.FUYAO_API_KEY
    else process.env.FUYAO_API_KEY = SAVED_KEY
  }
})

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
      for (const combinator of ['oneOf', 'anyOf', 'allOf']) {
        assert.equal(combinator in parameters, false, `${definition.name}: parameters 根不允许出现 ${combinator}`)
      }
      assertObjectSchemas(parameters, `${definition.name}.parameters`, definition.name)
    }

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

    // required must name declared properties; per-tool cases cover actual return values.
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

test('capital-policy + tools/root-extras：注册根 Agent 工具收敛监听（只拿掉主 Agent 的专属入口）', async () => {
  process.env.FUYAO_API_KEY = 'smoke-key'
  try {
    const { ctx, listeners, effectResults } = fakeCtx()
    apply(ctx, { customPersona: '', retriever: { baseURL: '', credentialRef: '', windDocs: { endpoint: '', credentialRef: '', timeoutMs: 0 } } })
    applyPolicy(ctx)
    applyRootExtras(ctx)
    await Promise.all(effectResults)

    const created = listeners.filter((entry) => entry.event === 'agent/created')
    // Four distinct duties; assert behavior, not registration order.
    assert.equal(created.length, 4, 'apply 必须注册四个 agent/created 监听：根收敛 + 角色收敛 + shell 闸门 + selected skills')
    const notifyCreated = (agent) => { for (const entry of created) entry.listener({ agent }) }

    const restricted = []
    const guarded = []
    const agentCtx = {
      tools: {
        restrict: (filter) => { restricted.push(filter); return () => {} },
        guard: (guard) => { guarded.push(guard); return () => {} },
      },
    }
    // Root visibility is closed at composition time; no per-name deny for absent tools.
    notifyCreated({ session: { header: { cwd: '/w' } }, ctx: agentCtx })
    notifyCreated({ session: { header: { cwd: '/w', parentSession: 'main-1' } }, ctx: agentCtx })
    assert.equal(restricted.length, 0, '根可见性在组合期决定；host 不再对不存在的名字提交 deny')
    // Only the shell gate is per agent: identity gates are global because the Agent exists before preset selection.
    const rootBashCall = () => ({ name: 'bash', agent: { session: { header: { cwd: '/w' } } }, arguments: { command: 'date' } })
    const childBashEscalation = () => ({ name: 'bash', agent: { session: { header: { cwd: '/w', parentSession: 'main-1' } } }, arguments: { command: 'date', sandbox_permissions: 'x' } })
    const bashGuards = guarded.filter((guard) => /沙箱升级/.test(String(guard(childBashEscalation()))))
    assert.equal(bashGuards.length, 2, '每个 agent 各装一次 shell 闸门（同一实现，按调用身份判定）')
    assert.equal(bashGuards[0], bashGuards[1], '闸门必须是同一个函数：判定只有一份实现')
    assert.equal(guarded.length, 2, '⛔ 除 shell 闸门外不许再按 agent 装任何闸门：身份判据一律全局装（见下面的专属用例）')
    assert.equal(guarded.every((guard) => bashGuards.includes(guard)), true, '识别出的 shell 闸门就是全部按 agent 安装的闸门')
    assert.equal(bashGuards[0](rootBashCall()), undefined, '主 Agent 的 shell 调用放行')
    assert.match(String(bashGuards[0](childBashEscalation())), /不会去问用户/)
    assert.equal(bashGuards[0]({ name: 'bash', agent: { session: { header: { cwd: '/w', parentSession: 'main-1' } } }, arguments: { command: 'node -e 1' } }), undefined)

    // Policy failures (unknown tool, missing ctx) must not throw: runs on agent creation.
    assert.doesNotThrow(() => notifyCreated({ agent: { session: { header: {} }, ctx: { tools: { restrict: () => { throw new Error('unknown tool') } } } } }))
    assert.doesNotThrow(() => notifyCreated({ agent: { session: { header: {} }, ctx: {} } }))
  } finally {
    if (SAVED_KEY === undefined) delete process.env.FUYAO_API_KEY
    else process.env.FUYAO_API_KEY = SAVED_KEY
  }
})

test('apply()：角色会话只减掉焊死的兄弟名字，并原样回到 dc_status', async () => {
  process.env.FUYAO_API_KEY = 'smoke-key'
  try {
    // Probes are module-level and earlier cases wrote root records; reset for a clean deepEqual.
    resetRootPolicyProbes()
    resetRolePolicyProbes()
    const { ctx, tools, listeners, effectResults } = fakeCtx()
    ctx.provide('agentPresets', { composedPreset: (agentCtx) => agentCtx?.preset })
    apply(ctx, { customPersona: '', retriever: { baseURL: '', credentialRef: '', windDocs: { endpoint: '', credentialRef: '', timeoutMs: 0 } } })
    applyPolicy(ctx)
    await Promise.all(effectResults)
    const created = listeners.filter((entry) => entry.event === 'agent/created')

    const restricted = []
    const agentCtx = { tools: { restrict: (filter) => { restricted.push(filter); return () => {} }, guard: () => () => {} } }
    const notify = (agent) => { for (const entry of created) entry.listener({ agent }) }

    notify({ session: { id: 'junior-1', header: { cwd: '/w', parentSession: 'main-1' } }, ctx: { ...agentCtx, preset: 'capital-data-junior' } })
    assert.deepEqual(restricted, SIBLING_DENIED_TOOLS.map((deny) => ({ deny: [deny] })),
      '角色侧只提交逐名 deny：整份 allow 名单已由 D0 删除，工具面在组合期就封闭了')
    assert.equal(restricted.filter((filter) => filter.allow !== undefined).length, 0,
      '⛔ 不许出现 allow：那是"继承全部再划掉"的形状，§6.1 禁止恢复')

    const before = restricted.length
    notify({ session: { id: 'other-1', header: { cwd: '/w', parentSession: 'main-1' } }, ctx: { ...agentCtx, preset: 'some-other-preset' } })
    assert.equal(restricted.length, before, '别的 preset 的 child 不许被我们碰')

    const status = await toolNamed(tools, 'dc_status').execute({}, exec(delegated))
    assert.deepEqual(status.agent_tool_policy, [
      {
        agent_id: 'junior-1', root: false, preset_id: 'capital-data-junior', outcome: 'restricted',
        allowed: [], denied: [...SIBLING_DENIED_TOOLS], failed: [],
      },
    ], '角色收敛现场必须由生产装配原样带回会话侧')
  } finally {
    if (SAVED_KEY === undefined) delete process.env.FUYAO_API_KEY
    else process.env.FUYAO_API_KEY = SAVED_KEY
  }
})

test('capital-policy 行必须把 tools 声明成注入：否则三颗闸门静默不装', async () => {
  // Without inject, ctx.get('tools') is undefined and all three identity gates no-op silently.
  const policy = await import('../lib/policy-entry.js')
  assert.ok(Array.isArray(policy.inject) && policy.inject.includes('tools'),
    'capital-policy 必须 export const inject = ["tools"]（host 平面行读服务只有这一条不静默的路）')
})

test('apply()：三颗身份闸门都装在插件 ctx（各一次），按人设判定且 fail-open', async () => {
  // Identity gates install once, globally, keyed by preset; other presets fail open.
  process.env.FUYAO_API_KEY = 'smoke-key'
  try {
    const { ctx, pluginGuards, effectResults } = fakeCtx()
    ctx.provide('agentPresets', { composedPreset: (agentCtx) => agentCtx?.preset })
    apply(ctx, { customPersona: '', retriever: { baseURL: '', credentialRef: '', windDocs: { endpoint: '', credentialRef: '', timeoutMs: 0 } } })
    applyPolicy(ctx)
    await Promise.all(effectResults)

    const capital = { ctx: { preset: 'capital-generation' } }
    const junior = { ctx: { preset: 'capital-data-junior' } }
    const writeCall = (agent) => ({ name: 'write', agent, arguments: { file_path: '/w/a.md' } })
    const ocrUrlCall = (agent, arguments_) => ({ name: 'ocr', agent, arguments: arguments_ })
    const siblingCall = (agent) => ({ name: 'interrupt_agent', agent, arguments: { agent_id: 'x' } })
    const byName = (call) => pluginGuards.filter((guard) => guard(call) !== undefined)

    const fsGuards = byName(writeCall(capital))
    const ocrGuards = byName(ocrUrlCall(capital, { url: 'https://pdf.dfcfw.com/H3_x_1.pdf' }))
    const siblingGuards = byName(siblingCall(junior))
    assert.equal(fsGuards.length, 1, '全局 fs 写口 guard 只装一次，不走 agent/created')
    assert.equal(ocrGuards.length, 1, '⛔ `ocr` 的 url 形态 guard 只装一次且必须全局：主 Agent 不自己抓外链，本地解析留给它')
    assert.equal(siblingGuards.length, 1, '兄弟名字 guard 只装一次：可见性减不掉的（与 send_message 焊在同一行）只能在调用期拦')
    assert.equal(pluginGuards.length, 3, `插件 ctx 上的全局闸门就是这三颗，第四颗意味着新增了一份按实例安装的身份判据（收到 ${pluginGuards.length}）`)
    assert.equal(new Set([fsGuards[0], ocrGuards[0], siblingGuards[0]]).size, 3, '三颗闸门互不冒充：各认自己的工具名')

    const guard = fsGuards[0]
    assert.notEqual(guard({ name: 'edit', agent: capital }), undefined, '本 preset 的 edit 被拦')
    assert.notEqual(guard(writeCall(junior)), undefined, '角色会话的 write 同样被拦：行 config 删不掉继承来的写口（账本 L33）')
    assert.equal(guard({ name: 'read', agent: capital }), undefined, 'read 放行（2026-10-15 决策新开的口）')
    assert.equal(guard(writeCall({ ctx: { preset: 'standard' } })), undefined, '别的 preset 照常写（fail-open）')
    assert.equal(guard(writeCall({ ctx: {} })), undefined, '认领不出 preset 就放行')

    const ocr = ocrGuards[0]
    assert.equal(ocr(ocrUrlCall(capital, { file: 'refs/茅台研报.pdf' })), undefined, 'file 形态放行：那是主 Agent 的正当入口')
    assert.equal(ocr(ocrUrlCall(capital, { doc_id: 'ocr_000000000000', pages: '1' })), undefined, '读盘形态放行')
    assert.equal(ocr(ocrUrlCall({ ctx: { preset: 'capital-web-retriever' } }, { url: 'https://pdf.dfcfw.com/H3_x_1.pdf' })), undefined,
      '⛔ 检索人设的 url 形态放行：判据是人设，不是会话拓扑（委派子与手开角色都走这一支）')
    assert.equal(ocr(ocrUrlCall({ ctx: { preset: 'standard' } }, { url: 'https://x/y.pdf' })), undefined, '别的 preset 的 url 形态放行（fail-open）')

    const sibling = siblingGuards[0]
    assert.equal(sibling(siblingCall(capital)), undefined, '主 Agent 保留打断权：它才是决定要不要让别的会话停下来的人')
    assert.equal(sibling(siblingCall({ ctx: { preset: 'standard' } })), undefined, '别的 preset 的 interrupt_agent 放行（fail-open）')
    assert.equal(sibling({ name: 'send_message', agent: junior, arguments: {} }), undefined, 'send_message 是叶子角色的正当出口，不在这颗闸门里')
    assert.doesNotThrow(() => fakeCtx().pluginGuards)
    // Clear denial records so later deepEqual probe assertions start clean.
    resetRootPolicyProbes()
    resetRolePolicyProbes()
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
    const delegatedSession = { id: 'child-1', header: { cwd: '/workspace/proj', parentSession: 'main-1', origin: 'subagent' } }
    await assert.rejects(
      () => renderChart.execute({ dataset_id: 'ds_1', spec: { kind: 'line', series: ['close'] } }, exec(delegatedSession)),
      (error) => error.code === 'chart_source_scope_mismatch',
      '委派调用者必须用 chart_source_ref，不能用 dataset_id / path',
    )
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

// AnySearch 401/403 maps to AUTH; IP literals avoid DNS in local fallback.
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
