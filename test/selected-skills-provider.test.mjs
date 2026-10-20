import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerRootSelectedSkills, SELECTED_SKILL_CATALOG } from '../lib/agents/selected-skills-provider.js'
import { SELECTED_SKILL_SKILL_DIRS, SELECTED_SKILL_TASK_IDS } from '../selected-skills/catalog.js'

// Kept in the snapshot but not selectable: aliases, orchestrators, report output, chart authoring.
const INVESTSKILL_EXCLUDED = [
  'fundamental-analysis', 'dcf-valuation', 'research-bundle',
  'full-report',
  'report-generator',
  'chart-master',
]

// Kept as review material; exclusions are execution surface (broker API, paid data, routing).
const TRADING_SKILLS_EXCLUDED = [
  '_lib',
  'etoro',
  'earnings-preview',
  'macro-event-analysis',
  'market-regime-analysis',
  'pre-trade-check',
  'earnings-trade-prep',
  'portfolio-risk-review',
  'post-trade-debrief',
]

// Only the canonical skills root is registered; data catalogs, meta skills, workbook/deck
// outputs and accounting workflows are excluded.
const CHINA_FINANCE_EXCLUDED = [
  'china-market-data',
  'china-skill-creator',
  'china-dcf-model',
  'china-comps',
  'china-tax-loss-harvesting',
  'china-3-statement-model',
  'china-lbo-model',
  'china-xlsx-author',
  'china-pptx-author',
  'china-ppt-template-creator',
  'china-deck-refresh',
  'china-audit-xls',
  'china-ib-check-deck',
  'china-clean-data-xls',
  'china-model-update',
  'china-roll-forward',
  'china-gl-recon',
  'china-accrual-schedule',
  'china-deal-screening',
]

// Excluded as out of domain: accounting operations, personal finance, audit, private markets.
const FINANCESKILLS_EXCLUDED = [
  'financial-analysis',
  'investment-analysis',
  'risk-assessment',
  'working-capital-analysis',
  'crypto-accounting',
  'personal-budgeting',
  'net-worth-tracker',
  'retirement-planning',
  'debt-payoff',
  'tax-planning',
  'tax-efficient-investing',
  'journal-entry',
  'statement-preparation',
  'intercompany-accounting',
  'corporate-consolidation',
  'close-management',
  'automated-reconciliation',
  'deferred-tax',
  'revenue-recognition',
  'lease-accounting',
  'inventory-costing',
  'fixed-asset-accounting',
  'aro-computation',
  'variance-analysis',
  'audit-checklist',
  'sox-compliance',
  'esg-reporting',
  'budget-forecast',
  'predictive-burn-rate',
  'product-profitability',
  'cvp-breakeven',
  'treasury-management',
  'earned-value-mgmt',
  'startup-valuation',
  'lbo-modeling',
  'venture-debt',
  'debt-restructuring',
  'oil-gas-valuation',
  'ai-anomaly-detection',
  'nlp-earnings-sentiment',
]

function candidate(name) {
  return { name, description: name, invocation: { modelInvocable: true, userInvocable: true }, source: 'custom', provider: 'source', rank: 1, locator: name }
}

// list() also returns shadow candidates for task skills; catalog assertions strip them.
// The shadowing contract itself is pinned by the cases at the end of this file.
const selectedOnly = (names) => names.filter((name) => !SELECTED_SKILL_TASK_IDS.includes(name))

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
  function makeAgent({ preset = 'capital-generation', parentSession, lateSnapshot = false, injectFails = 0 } = {}) {
    const agent = { session: { id: 'session', header: { parentSession } }, ctx: undefined }
    const preStepListeners = []
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
        if (event !== 'agent/pre-step') return () => {}
        preStepListeners.push(listener)
        return () => {
          const index = preStepListeners.indexOf(listener)
          if (index >= 0) preStepListeners.splice(index, 1)
        }
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
    }
  }
  const createFilesystemProvider = (_ctx, _control, config) => {
    providerConfig = config
    return {
      name: config.providerName,
      async list() { return [candidate('buffett-investment-framework'), candidate('financial-health'), candidate('fact-check')] },
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
  // Large snapshot: catalog must equal snapshot dirs minus exclusions, and name any diff.
  const investSkillCatalog = SELECTED_SKILL_CATALOG
    .filter(({ repository }) => repository === 'InvestSkill')
    .map(({ name }) => name)
    .sort()
  const investSkillDirs = readdirSync(fileURLToPath(new URL('../selected-skills/InvestSkill/plugins/us-stock-analysis/skills', import.meta.url)))
    .filter((dir) => !INVESTSKILL_EXCLUDED.includes(dir))
    .sort()
  assert.deepEqual(investSkillCatalog, investSkillDirs,
    `InvestSkill 的可选清单与快照目录不符：多出或缺少 ${investSkillCatalog.filter((n, i) => n !== investSkillDirs[i]).join('、')}`)
  // Same dirs-minus-exclusions check; catches broker or orchestrator skills added back.
  const tradingSkillsCatalog = SELECTED_SKILL_CATALOG
    .filter(({ repository }) => repository === 'trading-skills')
    .map(({ name }) => name)
    .sort()
  const tradingSkillDirs = readdirSync(fileURLToPath(new URL('../selected-skills/trading-skills/skills', import.meta.url)))
    .filter((dir) => !TRADING_SKILLS_EXCLUDED.includes(dir))
    .sort()
  assert.deepEqual(tradingSkillsCatalog, tradingSkillDirs,
    `trading-skills 的可选清单与快照目录不符：多出或缺少 ${tradingSkillsCatalog.filter((n, i) => n !== tradingSkillDirs[i]).join('、')}`)
  // The skills root comes from the map, not a hardcoded dir, so mapping drift fails here.
  const chinaFinanceCatalog = SELECTED_SKILL_CATALOG
    .filter(({ repository }) => repository === 'claude-for-financial-services-cn')
    .map(({ name }) => name)
    .sort()
  const chinaFinanceRoot = SELECTED_SKILL_SKILL_DIRS['claude-for-financial-services-cn']
  const chinaFinanceDirs = readdirSync(fileURLToPath(new URL(`../selected-skills/claude-for-financial-services-cn/${chinaFinanceRoot}`, import.meta.url)))
    .filter((dir) => !CHINA_FINANCE_EXCLUDED.includes(dir))
    .sort()
  assert.deepEqual(chinaFinanceCatalog, chinaFinanceDirs,
    `claude-for-financial-services-cn 的可选清单与规范根（${chinaFinanceRoot}）不符：`
    + `多出或缺少 ${chinaFinanceCatalog.filter((n, i) => n !== chinaFinanceDirs[i]).join('、')}`)
  // Same derivation; catches out-of-domain skills (personal finance, crypto, accounting) added back.
  const financeskillsCatalog = SELECTED_SKILL_CATALOG
    .filter(({ repository }) => repository === 'financeskills')
    .map(({ name }) => name)
    .sort()
  const financeskillsRoot = SELECTED_SKILL_SKILL_DIRS.financeskills
  const financeskillDirs = readdirSync(fileURLToPath(new URL(`../selected-skills/financeskills/${financeskillsRoot}`, import.meta.url)))
    .filter((dir) => !FINANCESKILLS_EXCLUDED.includes(dir))
    .sort()
  assert.deepEqual(financeskillsCatalog, financeskillDirs,
    `financeskills 的可选清单与快照目录（${financeskillsRoot}）不符：`
    + `多出或缺少 ${financeskillsCatalog.filter((n, i) => n !== financeskillDirs[i]).join('、')}`)
  // Upstream orchestrators are not in the registered skills root; they must stay out of the
  // catalog and never be moved into that root, where a one-line mapping change would expose them.
  const quantCatalog = SELECTED_SKILL_CATALOG
    .filter(({ repository }) => repository === 'quant-agent-skills')
    .map(({ name }) => name)
    .sort()
  const quantRoot = SELECTED_SKILL_SKILL_DIRS['quant-agent-skills']
  const quantDirs = readdirSync(fileURLToPath(new URL(`../selected-skills/quant-agent-skills/${quantRoot}`, import.meta.url)))
    .sort()
  assert.deepEqual(quantCatalog, quantDirs,
    `quant-agent-skills 的可选清单与登记的 skills 根（${quantRoot}）不符：`
    + `多出或缺少 ${quantCatalog.filter((n, i) => n !== quantDirs[i]).join('、')}`)
  for (const orchestrator of ['concept-research', 'industry-research', 'stock-research']) {
    assert.ok(!SELECTED_SKILL_CATALOG.some(({ name }) => name === orchestrator),
      `${orchestrator} 是上游自述的编排器（接管会话路由、并行派生 5–6 个子代理，并指挥公开版不附带的`
      + `私有数据层），不得进入可选清单（docs/dev/selected-skills.md §8.6 第 1、4、5、6 条；逐条实测见该快照 UPSTREAM.md）`)
    assert.ok(!quantDirs.includes(orchestrator),
      `${orchestrator} 不得被挪进 ${quantRoot}：一旦落进登记的 skills 根，provider 就会把它发现并暴露出去`)
  }
  assert.ok(SELECTED_SKILL_CATALOG.every(({ status, tags }) => ['experimental', 'watchlist'].includes(status) && tags.length > 0))
  const harness = makeHarness()
  registerRootSelectedSkills(harness.ctx, { buffettFramework: false }, harness.createFilesystemProvider)
  assert.equal(harness.listeners.size, 0, 'all-false config must not attach an Agent listener')
})

test('selected skill provider: Capital root only, filtered catalog, scope cleanup', async () => {
  const harness = makeHarness()
  registerRootSelectedSkills(harness.ctx, { buffettFramework: true }, harness.createFilesystemProvider)
  const created = harness.listeners.get('agent/created')
  assert.equal(typeof created, 'function')

  const child = harness.makeAgent({ parentSession: 'parent-session' })
  await created({ agent: child.agent })
  assert.equal(harness.providerRegistrationCount, 0, 'child Agent must not receive a provider')

  const otherPreset = harness.makeAgent({ preset: 'other-preset' })
  await created({ agent: otherPreset.agent })
  assert.equal(harness.providerRegistrationCount, 0, 'other presets must not receive a provider')

  const root = harness.makeAgent()
  const creation = created({ agent: root.agent })
  assert.equal(harness.providerRegistrationCount, 0, 'provider 必须在 agent/created 的异步注入完成前保持未注册')
  await creation
  assert.equal(harness.providerRegistrationCount, 1)
  assert.equal(root.preStepListenerCount, 2, 'pre-step 钩子必须在 agent/created settle 前落位（tool-skill 形状快照 + 本包刷新钩子）')
  assert.equal(harness.providerConfig.includeDefaultRoots, false)
  // Skill roots are derived from the catalog; a hardcoded path silently hides enabled items.
  assert.deepEqual(harness.providerConfig.customSkillDirs.length, Object.keys(SELECTED_SKILL_SKILL_DIRS).length)
  for (const [repository, skillsDir] of Object.entries(SELECTED_SKILL_SKILL_DIRS)) {
    const expected = join(repository, ...skillsDir.split('/'))
    assert.ok(harness.providerConfig.customSkillDirs.some((dir) => dir.endsWith(expected)),
      `provider 的 customSkillDirs 缺少 ${repository} 的 skills 根（应以 ${expected} 结尾）`)
  }
  assert.equal(harness.providerConfig.providerName, 'capital-selected-skills')
  assert.deepEqual(selectedOnly((await harness.provider.list({})).map(({ name }) => name)), ['buffett-investment-framework'])
  assert.equal((await harness.provider.get(candidate('buffett-investment-framework'), {})).content, 'loaded')
   assert.throws(
     () => harness.provider.get(candidate('financial-health'), {}),
     /not enabled/,
     '未选中的 skill 不得通过 get 绕过 catalog 过滤',
   )

  root.agentCtx.cleanup?.()
  assert.equal(harness.providerUnregisterCount, 1)
  assert.equal(harness.providerDisposeCount, 1, 'agent scope teardown must stop the filesystem watcher')
  assert.equal(root.preStepListenerCount, 1, 'scope teardown 必须摘掉每轮刷新钩子，不许留悬挂监听')
  harness.disposeRoot()
  assert.equal(harness.listeners.size, 0, 'plugin teardown must detach the root Agent listener')
})

test('selected skill provider: 先建会话再切 preset（GUI 顺序）也必须注册 provider', async () => {
  // GUI creates the Agent under the default preset, then selects Capital, so agent/created
  // fires first; the agent-preset/selected listener is the only path that registers there.
  const harness = makeHarness()
  registerRootSelectedSkills(harness.ctx, { buffettFramework: true }, harness.createFilesystemProvider)
  const selected = harness.listeners.get('agent-preset/selected')
  assert.equal(typeof selected, 'function', '必须挂 agent-preset/selected：先建后切是 GUI 的真实顺序')

  const root = harness.makeAgent()
  harness.agents.set('session-root', root.agent)

  await selected('session-root', 'cordis')
  assert.equal(harness.providerRegistrationCount, 0, '别的 preset 的切换不许碰')
  await selected('session-missing', 'capital-generation')
  assert.equal(harness.providerRegistrationCount, 0, '活 Agent 表里没有的会话静默跳过（dispose 后仍可能收到事件）')

  const child = harness.makeAgent({ parentSession: 'session-root' })
  harness.agents.set('session-child', child.agent)
  await selected('session-child', 'capital-generation')
  assert.equal(harness.providerRegistrationCount, 0, '子 Agent 一律不注册')

  await selected('session-root', 'capital-generation')
  assert.equal(harness.providerRegistrationCount, 1, '切到 Capital 必须注册 provider')
  assert.deepEqual(selectedOnly((await harness.provider.list({})).map(({ name }) => name)), ['buffett-investment-framework'])
  assert.equal(root.preStepListenerCount, 2, '切换路径同样要落位每轮刷新钩子')

  // Repeated events for one Agent must not register a second provider.
  await selected('session-root', 'capital-generation')
  await harness.listeners.get('agent/created')({ agent: root.agent })
  assert.equal(harness.providerRegistrationCount, 1, '同一个 Agent 只许注册一次')

  harness.disposeRoot()
  assert.equal(harness.listeners.size, 0, 'plugin teardown 必须把两条监听都摘掉')
})

test('selected skill provider: 切换路径注入失败要留重试余地', async () => {
  // A failed inject must stay retryable, not latch the Agent into permanent failure.
  const harness = makeHarness()
  registerRootSelectedSkills(harness.ctx, { buffettFramework: true }, harness.createFilesystemProvider)
  const selected = harness.listeners.get('agent-preset/selected')
  const root = harness.makeAgent({ injectFails: 1 })
  harness.agents.set('session-root', root.agent)

  await selected('session-root', 'capital-generation')
  assert.equal(harness.providerRegistrationCount, 0)
  assert.ok(harness.warnings.some((message) => message.includes('selected skills are unavailable')),
    '注入失败只降级告警')

  await selected('session-root', 'capital-generation')
  assert.equal(harness.providerRegistrationCount, 1, '一次注入失败不许把该 Agent 钉成永久失败')
})

test('selected skill provider: 嵌套 skills 根里的名字走同一个 list/get 闸门', async () => {
  // Nested skills root: its names must pass the same list filter and get check.
  const harness = makeHarness()
  registerRootSelectedSkills(harness.ctx, { factCheck: true }, harness.createFilesystemProvider)
  await harness.listeners.get('agent/created')({ agent: harness.makeAgent().agent })
  assert.deepEqual(selectedOnly((await harness.provider.list({})).map(({ name }) => name)), ['fact-check'])
  assert.equal((await harness.provider.get(candidate('fact-check'), {})).content, 'loaded')
  assert.throws(
    () => harness.provider.get(candidate('buffett-investment-framework'), {}),
    /not enabled/,
    '未选中的 skill 不得通过 get 绕过 catalog 过滤',
  )
})

test('selected skill provider: 开关每轮现读，已有 Agent 的 catalog 跟随设置刷新', async () => {
  // Real order is create then toggle; the old code froze enabled state at agent/created.
  const harness = makeHarness()
  let selection = { buffettFramework: false }
  registerRootSelectedSkills(harness.ctx, () => selection, harness.createFilesystemProvider)
  const created = harness.listeners.get('agent/created')
  assert.equal(typeof created, 'function')

  const live = harness.makeAgent()
  await created({ agent: live.agent })
  assert.equal(harness.providerRegistrationCount, 1, '初始全关也必须注册 provider（空目录）')
  assert.deepEqual((await harness.provider.list({})).map(({ name }) => name), [])
  assert.equal(harness.invalidateCount, 0)

  selection = { buffettFramework: true }
  await live.preStep()
  assert.deepEqual(selectedOnly(live.catalogSnapshot), ['buffett-investment-framework'],
    '下一轮 pre-step 的 catalog 快照必须看到新开关，不需要新建会话')
  assert.equal(harness.invalidateCount, 1, '开关变化必须失效目录缓存，否则快照读到缓存里的旧目录')

  await live.preStep()
  assert.equal(harness.invalidateCount, 1, '开关未变不重算目录：每轮零成本')
  assert.deepEqual(selectedOnly(live.catalogSnapshot), ['buffett-investment-framework'])

  selection = { buffettFramework: false }
  await live.preStep()
  assert.deepEqual(live.catalogSnapshot, [], '关掉后下一轮目录立即消失')
  assert.equal(harness.invalidateCount, 2)
  assert.throws(
    () => harness.provider.get(candidate('buffett-investment-framework'), {}),
    /not enabled/,
    '关掉后 get 也必须拒绝（目录过滤与正文读取同一道闸门）',
  )

  // With the snapshot listener mounted later, invalidation must still precede next().
  selection = { factCheck: true }
  const innerOrder = harness.makeAgent({ lateSnapshot: true })
  await created({ agent: innerOrder.agent })
  await innerOrder.preStep()
  assert.deepEqual(selectedOnly(innerOrder.catalogSnapshot), ['fact-check'])
  selection = { factCheck: false, buffettFramework: true }
  await innerOrder.preStep()
  assert.deepEqual(selectedOnly(innerOrder.catalogSnapshot), ['buffett-investment-framework'],
    '快照监听先注册或后注册都要赶得上：钩子必须在 next() 之前失效缓存')
  assert.equal(harness.invalidateCount, 3)

  // New root Agents read the latest switches too, not a creation-time snapshot.
  selection = { factCheck: true }
  const late = harness.makeAgent()
  await created({ agent: late.agent })
  assert.equal(harness.providerRegistrationCount, 3)
  assert.deepEqual(selectedOnly((await harness.provider.list({})).map(({ name }) => name)), ['fact-check'], '新 root Agent 必须读取最新开关')
})

// Task-skill index: get() returns disk body + index block, disk file unchanged.
// Shadowing is additive: nothing enabled or no index means no shadow at all.
test('任务型 skill 索引：只有"确实有索引可给"的那几颗才遮蔽，正文在读取期拼装', async () => {
  const harness = makeHarness()
  const skillsDir = fileURLToPath(new URL('../preset/capital-generation/skills', import.meta.url))
  // Separate fixture roots so per-task index filtering is observable.
  const createFilesystemProvider = (_ctx, _control, config) => ({
    name: config.providerName,
    async list() { return [candidate('china-comps-analysis'), candidate('tax-lens')] },
    async get(value) { return { ...value, content: 'loaded' } },
    async dispose() {},
  })
  // Selection is a function because settings are read per turn.
  const selection = { chinaCompsAnalysis: false }
  registerRootSelectedSkills(harness.ctx, () => selection, createFilesystemProvider)
  const created = harness.listeners.get('agent/created')

  const off = harness.makeAgent()
  await created({ agent: off.agent })
  assert.deepEqual(await harness.provider.list({}), [], '一颗都没启用时不许遮蔽任何内置 skill')

  selection.chinaCompsAnalysis = true
  const live = harness.makeAgent()
  await created({ agent: live.agent })
  const shadows = (await harness.provider.list({})).filter(({ name }) => SELECTED_SKILL_TASK_IDS.includes(name))
  assert.deepEqual(shadows.map(({ name }) => name), ['capital-equity-research', 'capital-event-impact'],
    '索引为空的任务型 skill 不许遮蔽；有索引的才遮蔽')
  assert.ok(shadows.every(({ rank }) => rank < 300),
    '遮蔽候选的 rank 必须低于同层自定义根（CUSTOM_RANK = 300），否则同名时赢不了，索引永远看不见')
  assert.ok(shadows.every(({ invocation }) => invocation.modelInvocable === true),
    '遮蔽候选必须自带 invocation：isModelInvocable 直接读它，缺了会在 tool-skill 里抛错')

  const definition = await harness.provider.get(candidate('capital-equity-research'), {})
  const raw = readFileSync(join(skillsDir, 'capital-equity-research', 'SKILL.md'), 'utf8')
  // CR is optional: Windows checkouts return CRLF.
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
  assert.ok(definition.content.startsWith(body), '正文必须以磁盘原文开头，索引只往后接')
  assert.match(definition.content, /## 附：本轮可用的外部精选 Skill（索引）/)
  assert.match(definition.content, /以本 skill 为准/, '索引块必须自带冲突判据（协议优先）')
  assert.match(definition.content, /`china-comps-analysis`: china-comps-analysis/, '索引行 = name + 运行时描述')
  assert.equal(definition.content.includes('`tax-lens`'), false, '没启用的精选 skill 不许出现在索引里')
  assert.equal(definition.resourceBase.kind, 'directory', '正文里的相对链接仍要能按目录解析')
  assert.ok(definition.resourceBase.path.endsWith(join('skills', 'capital-equity-research')))

  // Switches take effect on the next pre-step, as in real use.
  selection.chinaCompsAnalysis = false
  selection.taxLens = true
  await live.preStep()
  assert.deepEqual((await harness.provider.list({}))
    .filter(({ name }) => SELECTED_SKILL_TASK_IDS.includes(name)).map(({ name }) => name),
  ['capital-portfolio-review'], '索引跟着启用集合走：谁有料谁才遮蔽')
  const plain = await harness.provider.get(candidate('capital-equity-research'), {})
  assert.equal(plain.content, body, '没有索引时正文必须与磁盘原文逐字相同（遮蔽在内容上不可见）')
})
