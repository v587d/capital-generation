import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerRootSelectedSkills, SELECTED_SKILL_CATALOG } from '../lib/agents/selected-skills-provider.js'
import { SELECTED_SKILL_SKILL_DIRS } from '../selected-skills/catalog.js'

// 留在快照里、但不进可选清单的六颗，理由逐条写在 selected-skills/InvestSkill/UPSTREAM.md。
const INVESTSKILL_EXCLUDED = [
  'fundamental-analysis', 'dcf-valuation', 'research-bundle', // 上游自己标注的 alias 残片
  'full-report',       // 编排 skill：接管会话路由（与 china-stock orchestrator 同一条理由）
  'report-generator',  // 上游输出口：与已删除、禁止恢复的报告交付链路冲突
  'chart-master',      // 教 Agent 自己出图：出图只走 render_chart
]

// 第五颗 19 里只开放 9：下面这些留在快照里当可审查材料（etoro 连发布包都不进），理由逐条写在
// selected-skills/trading-skills/UPSTREAM.md 与 docs/reference/external-skill-scan-2026-10.md。
const TRADING_SKILLS_EXCLUDED = [
  '_lib',                      // 共享 python 计算模块：不是 skill，本插件也没有 shell 能跑它（§1.6）
  'etoro',                     // 券商 API 执行面：在对话里采集凭据、真实下单（§8.6 第 4 与第 7 条）
  'position-sizing',           // 输出仓位数字：与「买卖动作和仓位决策属于明确冲突」的既有口径一致
  'position-management',       // hold / trim / close 的持仓动作决断，同上
  'earnings-preview',          // 数据层写死付费 API（curl + 向用户要凭据），且与 InvestSkill 那颗同名
  'macro-event-analysis',      // 同上：ask which supported provider + curl
  'market-regime-analysis',    // 同上
  'pre-trade-check',           // orchestrator：上游自己的 "Workflow routing" 段接管会话路由
  'earnings-trade-prep',       // 同上
  'portfolio-risk-review',     // 同上
  'post-trade-debrief',        // 同上
]

function candidate(name) {
  return { name, description: name, invocation: { modelInvocable: true, userInvocable: true }, source: 'custom', provider: 'source', rank: 1, locator: name }
}

function makeHarness() {
  const listeners = new Map()
  let rootCleanup
  let provider
  let providerRegistrationCount = 0
  let providerUnregisterCount = 0
  let providerDisposeCount = 0
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
      return undefined
    },
    effect(callback) { rootCleanup = callback() },
    logger: { warn() {} },
  }
  function makeAgent({ preset = 'capital-generation', parentSession } = {}) {
    const skills = {
      registerProvider(create) {
        providerRegistrationCount += 1
        provider = create({ signal: new AbortController().signal })
        return () => { providerUnregisterCount += 1 }
      },
    }
    const agentCtx = {
      preset,
      effect(callback) { agentCtx.cleanup = callback() },
      inject(_deps, callback) {
        callback(Object.create(agentCtx, { skills: { value: skills, enumerable: true } }))
      },
    }
    Object.defineProperty(agentCtx, 'skills', {
      configurable: true,
      get() { throw new Error('cannot get property "skills" without inject') },
    })
    return {
      agent: { session: { id: 'session', header: { parentSession } }, ctx: agentCtx },
      agentCtx,
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
    makeAgent,
    createFilesystemProvider,
    disposeRoot() { rootCleanup?.() },
    get provider() { return provider },
    get providerRegistrationCount() { return providerRegistrationCount },
    get providerUnregisterCount() { return providerUnregisterCount },
    get providerDisposeCount() { return providerDisposeCount },
    get providerConfig() { return providerConfig },
  }
}

test('selected skill provider: disabled by default and limited to the approved catalog', () => {
  // 前两颗快照的清单逐条钉住：这些 key 已经发出去了，改名等于把使用者已拨开的开关清掉。
  // 按仓库点名而不是"减去某一颗"：后面追加的快照不在这条的钉子范围内（InvestSkill 与 trading-skills
  // 由下面「目录 − 排除清单」派生，peter-lynch-skill 只有一颗，由 test/persona.test.mjs 逐条核对身份）。
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
  // 第三颗是 34 颗的大快照，不写死名单：可选清单必须正好等于「目录里的 skill 减去排除的六颗」。
  // 有人把 chart-master 或 report-generator 顺手加回 catalog，这条就红并点名差在哪。
  const investSkillCatalog = SELECTED_SKILL_CATALOG
    .filter(({ repository }) => repository === 'InvestSkill')
    .map(({ name }) => name)
    .sort()
  const investSkillDirs = readdirSync(fileURLToPath(new URL('../selected-skills/InvestSkill/plugins/us-stock-analysis/skills', import.meta.url)))
    .filter((dir) => !INVESTSKILL_EXCLUDED.includes(dir))
    .sort()
  assert.deepEqual(investSkillCatalog, investSkillDirs,
    `InvestSkill 的可选清单与快照目录不符：多出或缺少 ${investSkillCatalog.filter((n, i) => n !== investSkillDirs[i]).join('、')}`)
  // 第五颗同样是「目录 − 排除清单」的派生钉法，而且排除得多（19 里开放 9）：
  // 有人把 etoro（券商下单）、position-sizing（仓位数字）或某颗 orchestrator 顺手加回 catalog，这条就红。
  const tradingSkillsCatalog = SELECTED_SKILL_CATALOG
    .filter(({ repository }) => repository === 'trading-skills')
    .map(({ name }) => name)
    .sort()
  const tradingSkillDirs = readdirSync(fileURLToPath(new URL('../selected-skills/trading-skills/skills', import.meta.url)))
    .filter((dir) => !TRADING_SKILLS_EXCLUDED.includes(dir))
    .sort()
  assert.deepEqual(tradingSkillsCatalog, tradingSkillDirs,
    `trading-skills 的可选清单与快照目录不符：多出或缺少 ${tradingSkillsCatalog.filter((n, i) => n !== tradingSkillDirs[i]).join('、')}`)
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
  created({ agent: child.agent })
  assert.equal(harness.providerRegistrationCount, 0, 'child Agent must not receive a provider')

  const otherPreset = harness.makeAgent({ preset: 'other-preset' })
  created({ agent: otherPreset.agent })
  assert.equal(harness.providerRegistrationCount, 0, 'other presets must not receive a provider')

  const root = harness.makeAgent()
  created({ agent: root.agent })
  assert.equal(harness.providerRegistrationCount, 1)
  assert.equal(harness.providerConfig.includeDefaultRoots, false)
  // skills 根按 catalog 的「仓库 → 相对路径」现算：InvestSkill 的 skill 不在 <repo>/skills 底下，
  // 而在 plugins/us-stock-analysis/skills。写死两颗的表现不是报错，是勾了那一格永远不出现。
  assert.deepEqual(harness.providerConfig.customSkillDirs.length, Object.keys(SELECTED_SKILL_SKILL_DIRS).length)
  for (const [repository, skillsDir] of Object.entries(SELECTED_SKILL_SKILL_DIRS)) {
    const expected = join(repository, ...skillsDir.split('/'))
    assert.ok(harness.providerConfig.customSkillDirs.some((dir) => dir.endsWith(expected)),
      `provider 的 customSkillDirs 缺少 ${repository} 的 skills 根（应以 ${expected} 结尾）`)
  }
  assert.equal(harness.providerConfig.providerName, 'capital-selected-skills')
  assert.deepEqual((await harness.provider.list({})).map(({ name }) => name), ['buffett-investment-framework'])
  assert.equal((await harness.provider.get(candidate('buffett-investment-framework'), {})).content, 'loaded')
   assert.throws(
     () => harness.provider.get(candidate('financial-health'), {}),
     /not enabled/,
     '未选中的 skill 不得通过 get 绕过 catalog 过滤',
   )

  root.agentCtx.cleanup?.()
  assert.equal(harness.providerUnregisterCount, 1)
  assert.equal(harness.providerDisposeCount, 1, 'agent scope teardown must stop the filesystem watcher')
  harness.disposeRoot()
  assert.equal(harness.listeners.size, 0, 'plugin teardown must detach the root Agent listener')
})

test('selected skill provider: 嵌套 skills 根里的名字走同一个 list/get 闸门', async () => {
  // §9.7 那一族：只验证接好的那个入口，第二个入口就静默漏掉。InvestSkill 的 skill 住在
  // plugins/us-stock-analysis/skills 底下，name 与顶层快照同级，必须同样被 list 过滤、被 get 复核。
  const harness = makeHarness()
  registerRootSelectedSkills(harness.ctx, { factCheck: true }, harness.createFilesystemProvider)
  harness.listeners.get('agent/created')({ agent: harness.makeAgent().agent })
  assert.deepEqual((await harness.provider.list({})).map(({ name }) => name), ['fact-check'])
  assert.equal((await harness.provider.get(candidate('fact-check'), {})).content, 'loaded')
  assert.throws(
    () => harness.provider.get(candidate('buffett-investment-framework'), {}),
    /not enabled/,
    '未选中的 skill 不得通过 get 绕过 catalog 过滤',
  )
})

test('selected skill provider: dynamic selection is read for each newly created root Agent', () => {
  const harness = makeHarness()
  let selection = { buffettFramework: false }
  registerRootSelectedSkills(harness.ctx, () => selection, harness.createFilesystemProvider)
  const created = harness.listeners.get('agent/created')
  assert.equal(typeof created, 'function')

  const beforeToggle = harness.makeAgent()
  created({ agent: beforeToggle.agent })
  assert.equal(harness.providerRegistrationCount, 0, '关闭时不注册 provider')

  selection = { buffettFramework: true }
  const afterToggle = harness.makeAgent()
  created({ agent: afterToggle.agent })
  assert.equal(harness.providerRegistrationCount, 1, '新 root Agent 必须读取最新开关')
})
