import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerSelectedSkills, renderSelectedSkillsBrief, SELECTED_SKILL_CATALOG } from '../lib/agents/selected-skills-provider.js'
import {
  clearAllSelectedSkillUsage,
  clearSelectedSkillUsage,
  skillUsageNamesForSession,
  skillUsageRows,
} from '../lib/agents/skill-usage.js'
import { SELECTED_SKILL_SKILL_DIRS } from '../selected-skills/catalog.js'
import { SELECTED_SKILL_ROUTING } from '../selected-skills/routing.js'

// Removed from the repository in the 2026-10 convergence: execution surface, report output,
// chart authoring, orchestrators and out-of-domain bodies. None may come back as a directory or
// as a catalog entry (the structural gate checks the tree; this list names the compliance-critical few).
const MUST_NOT_RETURN = [
  'etoro', 'full-report', 'chart-master', 'report-generator', 'research-bundle',
  'china-market-data', 'china-skill-creator', 'concept-research', 'industry-research', 'stock-research',
]

function candidate(name) {
  return { name, description: name, invocation: { modelInvocable: true, userInvocable: true }, source: 'custom', provider: 'source', rank: 1, locator: name }
}

/** Auto-mode cases need the whole catalog on disk, not the five-candidate role fixture. */
function fullCatalogProvider(_ctx, _control, config) {
  return {
    name: config.providerName,
    async list() { return SELECTED_SKILL_CATALOG.map(({ name }) => candidate(name)) },
    async get(value) { return { ...value, content: 'loaded' } },
    async dispose() {},
  }
}

function makeHarness() {
  const listeners = new Map()
  const agents = new Map()
  const warnings = []
  let rootCleanup
  let provider
  let providerRegistrationCount = 0
  let providerUnregisterCount = 0
  let providerDisposeCount = 0
  let invalidateCount = 0
  let providerConfig
  const root = {
    on(event, listener) {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
  }
  const ctx = {
    root,
    get(name) {
      if (name === 'agentPresets') return { composedPreset: (agentCtx) => agentCtx?.preset }
      if (name === 'agents') return { get: (id) => agents.get(id) }
      return undefined
    },
    effect(callback) { rootCleanup = callback() },
    logger: { warn(message) { warnings.push(message) } },
  }
  function makeAgent({ preset = 'capital-generation', parentSession, sessionId = 'session', lateSnapshot = false, injectFails = 0 } = {}) {
    const agent = { session: { id: sessionId, header: { parentSession } }, ctx: undefined }
    const preStepListeners = []
    const eventListeners = new Map()
    let catalogSnapshot = []
    let remainingInjectFailures = injectFails
    // Mirrors SkillRegistry caching: list is cached until control.invalidate().
    const skills = {
      registerProvider(create) {
        providerRegistrationCount += 1
        let cache
        const control = {
          signal: new AbortController().signal,
          invalidate() { invalidateCount += 1; cache = undefined },
        }
        const created = create(control)
        provider = {
          name: created.name,
          async list(options) {
            if (cache) return cache
            cache = await created.list(options)
            return cache
          },
          get: created.get,
        }
        return () => { providerUnregisterCount += 1 }
      },
    }
    const agentCtx = {
      preset,
      effect(callback) { agentCtx.cleanup = callback() },
      inject(_deps, callback) {
        if (remainingInjectFailures > 0) {
          remainingInjectFailures -= 1
          return Promise.reject(new Error('inject refused'))
        }
        return Promise.resolve().then(() => callback(Object.create(agentCtx, { skills: { value: skills, enumerable: true } })))
      },
      on(event, listener) {
        if (event === 'agent/pre-step') {
          preStepListeners.push(listener)
          return () => {
            const index = preStepListeners.indexOf(listener)
            if (index >= 0) preStepListeners.splice(index, 1)
          }
        }
        const listeners = eventListeners.get(event) ?? new Set()
        listeners.add(listener)
        eventListeners.set(event, listeners)
        return () => { listeners.delete(listener) }
      },
    }
    agent.ctx = agentCtx
    // dsh-tool-skill-shaped snapshot listener. lateSnapshot mounts it later, putting this
    // package's hook outside; cache invalidation must still happen before the snapshot.
    const snapshotListener = async (_payload, next) => {
      const decision = await next()
      catalogSnapshot = provider ? (await provider.list({})).map(({ name }) => name) : []
      return decision
    }
    if (!lateSnapshot) preStepListeners.push(snapshotListener)
    Object.defineProperty(agentCtx, 'skills', {
      configurable: true,
      get() { throw new Error('cannot get property "skills" without inject') },
    })
    return {
      agent,
      agentCtx,
      async preStep() {
        if (lateSnapshot && !preStepListeners.includes(snapshotListener)) preStepListeners.push(snapshotListener)
        const chain = [...preStepListeners]
        const next = () => {
          const listener = chain.shift()
          return listener ? listener({ agent }, next) : { kind: 'admit' }
        }
        return next()
      },
      get catalogSnapshot() { return catalogSnapshot },
      get preStepListenerCount() { return preStepListeners.length },
      emit(event, ...args) {
        for (const listener of [...(eventListeners.get(event) ?? [])]) listener(...args)
      },
      emitToolResult(exec, result) { this.emit('tools/result', exec, result) },
      emitSession(session, event) { this.emit('session/event', session, event) },
    }
  }
  const createFilesystemProvider = (_ctx, _control, config) => {
    providerConfig = config
    return {
      name: config.providerName,
      async list() { return [candidate('buffett-investment-framework'), candidate('financial-health'), candidate('fact-check'), candidate('china-dcf'), candidate('10k-digest')] },
      async get(value) { return { ...value, content: 'loaded' } },
      async dispose() { providerDisposeCount += 1 },
    }
  }
  return {
    ctx,
    listeners,
    agents,
    warnings,
    makeAgent,
    createFilesystemProvider,
    disposeRoot() { rootCleanup?.() },
    get provider() { return provider },
    get providerRegistrationCount() { return providerRegistrationCount },
    get providerUnregisterCount() { return providerUnregisterCount },
    get providerDisposeCount() { return providerDisposeCount },
    get invalidateCount() { return invalidateCount },
    get providerConfig() { return providerConfig },
  }
}


test('selected skill provider: disabled by default and limited to the approved catalog', () => {
  // Keys are already shipped; renaming one clears a user's toggle. Pin by repository.
  const pinnedRepositories = ['investment-skills', 'china-stock-research-skills']
  assert.deepEqual(SELECTED_SKILL_CATALOG.filter(({ repository }) => pinnedRepositories.includes(repository)).map(({ name }) => name), [
    'buffett-investment-framework',
    'financial-health',
    'risk-warning-catalysts',
    'valuation-investment-strategy',
    'strategy-business-transition',
    'industry-competition-moat',
    'business-decomposition-order-quality',
  ])
  // Every registered skills root now holds exactly the catalog bodies: non-catalog skills were
  // deleted in the 2026-10 convergence, so a diff in either direction is a real regression.
  const rootOf = (repository) => SELECTED_SKILL_SKILL_DIRS[repository]
  for (const repository of ['InvestSkill', 'trading-skills', 'claude-for-financial-services-cn', 'financeskills', 'quant-agent-skills']) {
    const catalogNames = SELECTED_SKILL_CATALOG
      .filter((entry) => entry.repository === repository)
      .map(({ name }) => name)
      .sort()
    const root = rootOf(repository)
    const dirs = readdirSync(fileURLToPath(new URL(`../selected-skills/${repository}/${root}`, import.meta.url)))
      .filter((name) => !name.startsWith('.'))
      .sort()
    assert.deepEqual(catalogNames, dirs,
      `${repository} 的可选清单与 skills 根（${root}）不符：多出或缺少 ${catalogNames.filter((n, i) => n !== dirs[i]).join('、')}`)
  }
  for (const removed of MUST_NOT_RETURN) {
    assert.ok(!SELECTED_SKILL_CATALOG.some(({ name }) => name === removed),
      `${removed} 已在 2026-10 收敛中删除（执行面 / 报告出图 / 编排 / 领域外），不得回到 catalog`)
  }

  for (const orchestrator of ['concept-research', 'industry-research', 'stock-research']) {
    assert.ok(!SELECTED_SKILL_CATALOG.some(({ name }) => name === orchestrator),
      `${orchestrator} 是上游自述的编排器（接管会话路由、并行派生 5–6 个子代理，并指挥公开版不附带的`
      + `私有数据层），不得进入可选清单（docs/dev/selected-skills.md §8.6 第 1、4、5、6 条；逐条实测见该快照 UPSTREAM.md）`)
    assert.ok(!readdirSync(fileURLToPath(new URL(`../selected-skills/quant-agent-skills/${SELECTED_SKILL_SKILL_DIRS['quant-agent-skills']}`, import.meta.url))).includes(orchestrator),
      `${orchestrator} 不得被挪进登记的 skills 根：一旦落进去，provider 就会把它发现并暴露出去`)
  }
  assert.ok(SELECTED_SKILL_CATALOG.every(({ status, tags }) => ['experimental', 'watchlist'].includes(status) && tags.length > 0))
})

test('selected skill provider: 按角色过滤，主 Agent 看不到只属于数据侧的方法', async () => {
  const harness = makeHarness()
  const selection = { buffettFramework: true, financialHealth: true, factCheck: true }
  registerSelectedSkills(harness.ctx, 'main', selection, harness.createFilesystemProvider)
  const created = harness.listeners.get('agent/created')
  assert.equal(typeof created, 'function')

  const root = harness.makeAgent()
  await created({ agent: root.agent })
  assert.equal(harness.providerRegistrationCount, 1)
  assert.equal(root.preStepListenerCount, 2, 'pre-step 钩子必须在 agent/created settle 前落位')
  // fact-check is web_retriever + main; financial-health is data_junior only.
  assert.deepEqual((await harness.provider.list({})).map(({ name }) => name), ['buffett-investment-framework', 'fact-check'])
  assert.equal((await harness.provider.get(candidate('fact-check'), {})).content, 'loaded')
  assert.throws(
    () => harness.provider.get(candidate('financial-health'), {}),
    /not enabled for main/,
    '角色不匹配的 skill 不得通过 get 绕过目录过滤',
  )
  assert.equal(harness.providerConfig.includeDefaultRoots, false)
  assert.equal(harness.providerConfig.providerName, 'capital-selected-skills')
  assert.deepEqual(harness.providerConfig.customSkillDirs.length, Object.keys(SELECTED_SKILL_SKILL_DIRS).length)

  root.agentCtx.cleanup?.()
  assert.equal(harness.providerUnregisterCount, 1)
  assert.equal(harness.providerDisposeCount, 1, 'agent scope teardown must stop the filesystem watcher')
  harness.disposeRoot()
  assert.equal(harness.listeners.size, 0, 'plugin teardown must detach the root Agent listener')
})

test('selected skill provider: 数据侧与检索侧各自拿到自己的方法，reserved analyst 走别名', async () => {
  const harness = makeHarness()
  const selection = { buffettFramework: true, financialHealth: true, factCheck: true, tenKDigest: true }
  registerSelectedSkills(harness.ctx, 'data_junior', selection, harness.createFilesystemProvider)
  const created = harness.listeners.get('agent/created')
  const junior = harness.makeAgent({ preset: 'capital-data-junior', parentSession: 'root' })
  await created({ agent: junior.agent })
  assert.deepEqual((await harness.provider.list({})).map(({ name }) => name), ['financial-health'])

  const retrieverHarness = makeHarness()
  registerSelectedSkills(retrieverHarness.ctx, 'web_retriever', selection, retrieverHarness.createFilesystemProvider)
  const retriever = retrieverHarness.makeAgent({ preset: 'capital-web-retriever', parentSession: 'root' })
  await retrieverHarness.listeners.get('agent/created')({ agent: retriever.agent })
  assert.deepEqual((await retrieverHarness.provider.list({})).map(({ name }) => name), ['fact-check', '10k-digest'])

  const analystHarness = makeHarness()
  registerSelectedSkills(analystHarness.ctx, 'data_analyst', selection, analystHarness.createFilesystemProvider)
  const analyst = analystHarness.makeAgent({ preset: 'capital-data-analyst', parentSession: 'root' })
  await analystHarness.listeners.get('agent/created')({ agent: analyst.agent })
  assert.deepEqual((await analystHarness.provider.list({})).map(({ name }) => name), ['financial-health'],
    'data_analyst 是保留角色，启用前与 data_junior 共用方法集')
})

test('selected skill provider: auto 模式按角色开放全部方法，勾选不参与过滤', async () => {
  const cases = [
    { role: 'main', preset: 'capital-generation', count: 39, included: 'buffett-investment-framework', excluded: 'china-dcf' },
    { role: 'data_junior', preset: 'capital-data-junior', count: 40, included: 'china-dcf', excluded: 'buffett-investment-framework' },
    { role: 'web_retriever', preset: 'capital-web-retriever', count: 8, included: 'fact-check', excluded: 'china-dcf' },
  ]
  for (const item of cases) {
    const harness = makeHarness()
    const access = { selection: { buffettFramework: false }, mode: 'auto' }
    registerSelectedSkills(harness.ctx, item.role, access, fullCatalogProvider)
    const agent = harness.makeAgent({
      preset: item.preset,
      ...(item.role === 'main' ? {} : { parentSession: 'root' }),
    })
    await harness.listeners.get('agent/created')({ agent: agent.agent })
    const names = (await harness.provider.list({})).map(({ name }) => name)
    assert.equal(names.length, item.count, `${item.role} 的 auto 目录必须是该角色全部方法`)
    assert.ok(names.includes(item.included), `${item.role} auto 目录缺少 ${item.included}`)
    assert.ok(!names.includes(item.excluded), `${item.role} auto 目录混入了别的角色：${item.excluded}`)
    assert.equal((await harness.provider.get(candidate(item.included), {})).content, 'loaded',
      'auto 模式下未勾选的方法也必须能加载')
    assert.throws(() => harness.provider.get(candidate(item.excluded), {}), /not enabled for/,
      'auto 只放开角色边界以内的方法')
    harness.disposeRoot()
  }
})

test('selected skill provider: auto 与 manual 的切换会让目录缓存失效', async () => {
  const harness = makeHarness()
  let mode = 'manual'
  const access = { selection: { buffettFramework: true }, mode: () => mode }
  registerSelectedSkills(harness.ctx, 'main', access, fullCatalogProvider)
  const root = harness.makeAgent()
  await harness.listeners.get('agent/created')({ agent: root.agent })
  await root.preStep()
  assert.deepEqual(root.catalogSnapshot, ['buffett-investment-framework'], 'manual 只给勾选项')
  assert.equal(harness.invalidateCount, 0)

  mode = 'auto'
  await root.preStep()
  assert.equal(harness.invalidateCount, 1, '模式变化必须失效目录缓存')
  assert.equal(root.catalogSnapshot.length, 39, 'auto 的下一轮目录快照必须包含整个角色方法集')
  assert.ok(root.catalogSnapshot.includes('buffett-investment-framework'))
  await root.preStep()
  assert.equal(harness.invalidateCount, 1, '模式未变不重算目录')

  mode = 'manual'
  await root.preStep()
  assert.equal(harness.invalidateCount, 2)
  assert.deepEqual(root.catalogSnapshot, ['buffett-investment-framework'], '切回 manual 恢复勾选过滤')
  harness.disposeRoot()
})

test('selected skill provider: 预设不匹配时一颗都不注册', async () => {
  const harness = makeHarness()
  registerSelectedSkills(harness.ctx, 'data_junior', { financialHealth: true }, harness.createFilesystemProvider)
  const created = harness.listeners.get('agent/created')
  const mainAgent = harness.makeAgent({ preset: 'capital-generation' })
  await created({ agent: mainAgent.agent })
  assert.equal(harness.providerRegistrationCount, 0, 'junior 的行不许给主 Agent 注册')
  const otherPreset = harness.makeAgent({ preset: 'standard' })
  await created({ agent: otherPreset.agent })
  assert.equal(harness.providerRegistrationCount, 0, '其他 preset 一律不碰')
  const inheritedRoot = harness.makeAgent({ preset: 'capital-generation', parentSession: 'root' })
  await created({ agent: inheritedRoot.agent })
  assert.equal(harness.providerRegistrationCount, 0, 'main 方法只留根 Agent：继承 root preset 的 generic child 也不许注册')
})

test('selected skill provider: 先建会话再切 preset（GUI 顺序）也必须注册', async () => {
  const harness = makeHarness()
  registerSelectedSkills(harness.ctx, 'data_junior', { financialHealth: true }, harness.createFilesystemProvider)
  const selected = harness.listeners.get('agent-preset/selected')
  assert.equal(typeof selected, 'function', '必须挂 agent-preset/selected：先建后切是 GUI 的真实顺序')
  const child = harness.makeAgent({ preset: 'capital-data-junior', parentSession: 'root' })
  harness.agents.set('session-child', child.agent)

  await selected('session-child', 'capital-generation')
  assert.equal(harness.providerRegistrationCount, 0, '别的 preset 的切换不许碰')
  await selected('session-missing', 'capital-data-junior')
  assert.equal(harness.providerRegistrationCount, 0, '活 Agent 表里没有的会话静默跳过')
  await selected('session-child', 'capital-data-junior')
  assert.equal(harness.providerRegistrationCount, 1, '切到该角色 preset 必须注册 provider')
  assert.deepEqual((await harness.provider.list({})).map(({ name }) => name), ['financial-health'])

  await selected('session-child', 'capital-data-junior')
  await harness.listeners.get('agent/created')({ agent: child.agent })
  assert.equal(harness.providerRegistrationCount, 1, '同一个 Agent 只许注册一次')
  harness.disposeRoot()
  assert.equal(harness.listeners.size, 0)
})

test('selected skill provider: 注入失败留重试余地，开关每轮现读并失效缓存', async () => {
  const harness = makeHarness()
  let selection = { buffettFramework: false }
  registerSelectedSkills(harness.ctx, 'main', () => selection, harness.createFilesystemProvider)
  const created = harness.listeners.get('agent/created')
  const root = harness.makeAgent({ injectFails: 1 })
  harness.agents.set('session-root', root.agent)
  await created({ agent: root.agent })
  assert.equal(harness.providerRegistrationCount, 0)
  assert.ok(harness.warnings.some((message) => message.includes('selected skills are unavailable')))
  await created({ agent: root.agent })
  assert.equal(harness.providerRegistrationCount, 1, '一次注入失败不许把该 Agent 钉成永久失败')

  assert.deepEqual((await harness.provider.list({})).map(({ name }) => name), [])
  selection = { buffettFramework: true }
  await root.preStep()
  assert.deepEqual(root.catalogSnapshot, ['buffett-investment-framework'], '下一轮 pre-step 的目录快照必须看到新开关')
  assert.equal(harness.invalidateCount, 1, '开关变化必须失效目录缓存')
  await root.preStep()
  assert.equal(harness.invalidateCount, 1, '开关未变不重算目录')
  selection = { buffettFramework: false }
  await root.preStep()
  assert.deepEqual(root.catalogSnapshot, [])
  assert.throws(() => harness.provider.get(candidate('buffett-investment-framework'), {}), /not enabled for main/)
})

test('selected skill provider: 建会话时全关也必须注册，之后切 auto 才能生效', async () => {
  const harness = makeHarness()
  let mode = 'manual'
  const access = { selection: {}, mode: () => mode }
  registerSelectedSkills(harness.ctx, 'main', access, fullCatalogProvider)
  const root = harness.makeAgent()
  await harness.listeners.get('agent/created')({ agent: root.agent })
  assert.equal(harness.providerRegistrationCount, 1, '全关不是"永不注册"：设置是活偏好')
  assert.deepEqual((await harness.provider.list({})), [])

  mode = 'auto'
  await root.preStep()
  assert.equal(harness.invalidateCount, 1)
  assert.equal((await harness.provider.list({})).length, 39, '切到 auto 后同一 Agent 必须看到全量目录')
  harness.disposeRoot()
})

test('selected skill provider: 目录描述用 useWhen，不把上游 description 交给模型', async () => {
  const harness = makeHarness()
  registerSelectedSkills(harness.ctx, 'main', { buffettFramework: true }, harness.createFilesystemProvider)
  await harness.listeners.get('agent/created')({ agent: harness.makeAgent().agent })
  const [buffett] = await harness.provider.list({})
  assert.equal(buffett.description, SELECTED_SKILL_ROUTING['buffett-investment-framework'].useWhen.zh)
  assert.notEqual(buffett.description, 'buffett-investment-framework')
})

test('role prompt：只列当前角色已启用的方法，规则是强制加载而非附录', () => {
  const main = renderSelectedSkillsBrief('main', { buffettFramework: true, financialHealth: true, factCheck: true })
  assert.match(main, /^# 外部精选方法/)
  assert.match(main, /先.*`skill`.*加载/)
  assert.match(main, /1–2 条/)
  assert.match(main, /方法层（金融分析框架）/, '精选方法是分析层，不是流程协议')
  assert.match(main, /协议负责流程、证据门、工具委派与输出形状/, '内置协议的定位必须写清楚')
  assert.match(main, /两者正交/, '协议与方法必须被写成互不替代的两层')
  assert.match(main, /不得用协议替代方法/, '内置协议不得遮住分析方法')
  assert.match(main, /不得用方法改写协议/, '分析方法不得改写流程与证据门')
  assert.match(main, /`buffett-investment-framework`/)
  assert.match(main, /`fact-check`/)
  assert.doesNotMatch(main, /`financial-health`/, '数据侧专属方法不许出现在主 Agent 的短清单里')
  assert.match(main, /data_junior/, '主 Agent 的短清单要说明计算归 data_junior')
  assert.match(main, /你的目录只含主角色可用的方法/, '主 Agent 必须知道只属于自己的角色方法不在目录里')
  assert.match(main, /只属于 data_junior \/ web_retriever 的方法/, '共享方法仍在主目录，不能把角色归属写成绝对排除')
  assert.match(main, /不代表不存在/, '目录里没有不等于方法不存在：点名时要交给角色按名加载')
  assert.match(main, /不要改用通用方法自己算/, '点名的角色方法不可见时，不得退化成主 Agent 自己算')

  const junior = renderSelectedSkillsBrief('data_junior', { buffettFramework: true, financialHealth: true })
  assert.match(junior, /`financial-health`/)
  assert.doesNotMatch(junior, /`buffett-investment-framework`/)
  assert.match(junior, /结论与最终写作留给主 Agent/)

  assert.equal(renderSelectedSkillsBrief('main', {}), '', '一颗没启用时零成本')
  const auto = renderSelectedSkillsBrief('main', { selection: {}, mode: 'auto' })
  assert.match(auto, /自动模式/, 'auto 的短清单必须自报模式，不能再说"用户已启用"')
  assert.doesNotMatch(auto, /用户已启用/)
  assert.match(auto, /本角色共 39 颗可用/)
  assert.ok((auto.match(/^- `/gm) ?? []).length <= 12, 'auto 仍只列 12 条，完整目录在宿主技能目录里')
  assert.match(auto, /不要一次搬空目录/)
  assert.match(auto, /两者正交/, 'auto 同样要说明协议与方法两层')
  const all = Object.fromEntries(SELECTED_SKILL_CATALOG.map(({ key }) => [key, true]))
  const capped = renderSelectedSkillsBrief('main', all)
  assert.ok((capped.match(/^- `/gm) ?? []).length <= 12, '角色短清单最多列 12 条，完整目录仍在宿主技能目录里')
  assert.match(capped, /另有 \d+ 颗已启用/)
})


test('selected skill usage：原生 skill / PTC / 用户 /name 都记账，失败与非精选不计', async () => {
  clearAllSelectedSkillUsage()
  try {
    const mainHarness = makeHarness()
    registerSelectedSkills(mainHarness.ctx, 'main', { buffettFramework: true, factCheck: true }, mainHarness.createFilesystemProvider)
    const root = mainHarness.makeAgent({ sessionId: 'session-root' })
    await mainHarness.listeners.get('agent/created')({ agent: root.agent })

    root.emitToolResult({ name: 'skill' }, { isError: false, value: { name: 'buffett-investment-framework', provider: 'capital-selected-skills' } })
    root.emitToolResult({ name: 'skill' }, { isError: true, value: { name: 'fact-check', provider: 'capital-selected-skills' } })
    root.emitToolResult({ name: 'skill' }, { isError: false, value: { name: 'capital-data-protocol', provider: 'capital-filesystem' } })
    root.emitToolResult({ name: 'other' }, { isError: false, value: { name: 'fact-check', provider: 'capital-selected-skills' } })
    assert.deepEqual(skillUsageNamesForSession('session-root'), ['buffett-investment-framework'],
      '只有成功返回精选 provider 正文的 skill 调用才算一次实际加载')

    root.emitSession({ id: 'session-root' }, {
      type: 'user/message',
      data: { source: { kind: 'skill-invocation', name: 'fact-check' } },
    })
    assert.deepEqual(skillUsageNamesForSession('session-root'), ['buffett-investment-framework', 'fact-check'],
      '/name 直接注入也算实际加载')

    const juniorHarness = makeHarness()
    registerSelectedSkills(juniorHarness.ctx, 'data_junior', { financialHealth: true }, juniorHarness.createFilesystemProvider)
    const junior = juniorHarness.makeAgent({ preset: 'capital-data-junior', parentSession: 'session-root', sessionId: 'session-junior' })
    await juniorHarness.listeners.get('agent/created')({ agent: junior.agent })
    junior.emitSession({ id: 'session-junior' }, {
      type: 'tool/ptc-dispatch',
      data: { name: 'skill', arguments: { name: 'financial-health' }, isError: false },
    })
    assert.deepEqual(skillUsageNamesForSession('session-junior'), ['financial-health'],
      'data_junior 的 tools.skill 走 PTC dispatch，同样必须入账')

    assert.deepEqual(skillUsageRows('session-root').map((row) => [row.role, row.sessionId, row.names]), [
      ['main', 'root', ['buffett-investment-framework', 'fact-check']],
      ['data_junior', 'junior', ['financial-health']],
    ])

    const onlyChildUsage = renderSelectedSkillsBrief('main', {}, root.agent)
    assert.match(onlyChildUsage, /## 本次已实际加载的精选方法（程序记录）/)
    assert.match(onlyChildUsage, /`financial-health`/, '主 Agent 自己没启用任何方法时，子 Agent 的用量也必须送达并触发引用规则')

    const mainBrief = renderSelectedSkillsBrief('main', { buffettFramework: true }, root.agent)
    assert.match(mainBrief, /## 本次已实际加载的精选方法（程序记录）/)
    assert.match(mainBrief, /`buffett-investment-framework`/)
    assert.match(mainBrief, /`financial-health`/, '主 Agent 必须看到子 Agent 实际加载的方法')
    assert.match(mainBrief, /最终答复必须有一节「使用的方法」/)
    assert.match(mainBrief, /数据分析（junior）/, '子 Agent 的记账要标出角色与会话，不能混成主 Agent 自己加载的')

    assert.equal(renderSelectedSkillsBrief('main', { buffettFramework: true }, junior.agent), '',
    '继承 root preset 的 generic child 不得看到主 Agent 的方法清单或引用规则')

  const juniorBrief = renderSelectedSkillsBrief('data_junior', { financialHealth: true }, junior.agent)
    assert.match(juniorBrief, /本次你已实际加载：`financial-health`/)
    assert.match(juniorBrief, /skills_used: financial-health/)

    // New user turn clears names for the whole tree but keeps the child edge usable.
    root.emitSession({ id: 'session-root' }, { type: 'user/message', data: { source: { kind: 'user' } } })
    assert.deepEqual(skillUsageNamesForSession('session-root'), [])
    assert.deepEqual(skillUsageNamesForSession('session-junior'), [], '新用户轮次清空整棵树的引用窗口')
    junior.emitSession({ id: 'session-junior' }, {
      type: 'tool/ptc-dispatch',
      data: { name: 'skill', arguments: { name: 'financial-health' }, isError: false },
    })
    assert.deepEqual(skillUsageRows('session-root').map((row) => row.names), [['financial-health']])

    root.agentCtx.cleanup?.()
    assert.deepEqual(skillUsageRows('session-root'), [], '根 Agent 销毁后整棵树不再保留用量')
    assert.deepEqual(skillUsageNamesForSession('session-junior'), [], '子会话的记录也必须一并删除，不能留下孤儿')
  } finally {
    clearAllSelectedSkillUsage()
  }
})

test('selected skill usage：其他会话的记账不会串进当前根', async () => {
  clearAllSelectedSkillUsage()
  try {
    const harness = makeHarness()
    registerSelectedSkills(harness.ctx, 'main', { buffettFramework: true }, harness.createFilesystemProvider)
    const created = harness.listeners.get('agent/created')
    const first = harness.makeAgent({ sessionId: 'session-a' })
    const second = harness.makeAgent({ sessionId: 'session-b' })
    await created({ agent: first.agent })
    await created({ agent: second.agent })
    first.emitToolResult({ name: 'skill' }, { isError: false, value: { name: 'buffett-investment-framework', provider: 'capital-selected-skills' } })
    assert.deepEqual(skillUsageRows('session-b'), [])
    assert.deepEqual(skillUsageRows('session-a').map((row) => row.names), [['buffett-investment-framework']])
    clearSelectedSkillUsage('session-a')
    assert.deepEqual(skillUsageRows('session-a'), [])
  } finally {
    clearAllSelectedSkillUsage()
  }
})
