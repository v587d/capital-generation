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

// 第五颗 19 里开放 11：下面这些留在快照里当可审查材料（etoro 连发布包都不进），理由逐条写在
// selected-skills/trading-skills/UPSTREAM.md 与 docs/reference/external-skill-scan-2026-10.md。
// 注意这里**不含** position-sizing / position-management：那两颗给的是仓位数字与持仓加减建议，
// 与本插件的冲突只可能在执行面，而本插件没有券商接口（§8.6 第 7 条的判据）。
const TRADING_SKILLS_EXCLUDED = [
  '_lib',                      // 共享 python 计算模块：不是 skill，本插件也没有 shell 能跑它（§1.6）
  'etoro',                     // 券商 API 执行面：在对话里采集凭据、真实下单（§8.6 第 4 与第 7 条）
  'earnings-preview',          // 数据层写死付费 API（curl + 向用户要凭据），且与 InvestSkill 那颗同名
  'macro-event-analysis',      // 同上：ask which supported provider + curl
  'market-regime-analysis',    // 同上
  'pre-trade-check',           // orchestrator：上游自己的 "Workflow routing" 段接管会话路由
  'earnings-trade-prep',       // 同上
  'portfolio-risk-review',     // 同上
  'post-trade-debrief',        // 同上
]

// 第六颗（jwangkun/claude-for-financial-services-cn）：上游有六个 skills 根，这里只登记规范根
// vertical-plugins/china-finance/skills（31 颗），开放其中 12 颗。下面 19 颗留在快照里当可审查材料
// （mcp-servers/ 四份取数服务端连发布包都不进），理由逐条写在
// selected-skills/claude-for-financial-services-cn/UPSTREAM.md 与 docs/reference/external-skill-scan-2026-10.md。
// 这里同样**不收**"给方向与仓位"那一类理由：本插件不收的是执行面（§8.6 第 7 条）。
const CHINA_FINANCE_EXCLUDED = [
  'china-market-data',           // 它本身就是取数目录：服务商 MCP 工具名表 + export 模式开关，无分析产出
  'china-skill-creator',         // 元技能：教造新 skill，模板里硬编码服务商阶梯，还要 python3 scripts/*.py 校验
  'china-dcf-model',             // 上游自标的 alias（"redirects to china-dcf"）：§8.6 第 6 条
  'china-comps',                 // 同题材的薄一份，且带两份 frontmatter
  'china-tax-loss-harvesting',   // §8.6 第 8 条市场口径：wash-sale / 应税账户成本基础是美股税制产物，A 股无此制度
  'china-3-statement-model',     // 要求产出 xlsx 工作簿（还有 OpenPyXL Formatting 一节）
  'china-lbo-model',             // 同上：File named: …_LBO_Model_….xlsx
  'china-xlsx-author',           // 交付物就是一份工作簿
  'china-pptx-author',           // python3 scripts/generate_a_share_ppt.py + .pptx
  'china-ppt-template-creator',  // .pptx 模板与 _Style_Guide.pdf
  'china-deck-refresh',          // 读写既有 deck 并另存 .pptx + .pdf
  'china-audit-xls',             // 审计对象是一份 xlsx 工作簿
  'china-ib-check-deck',         // 质检对象是一份 pitch deck
  'china-clean-data-xls',        // 表格清洗，对象同样是工作簿
  'china-model-update',          // 维护本地模型文件并给新目标价
  'china-roll-forward',          // 把工作簿滚动到新期间（"All cells formula-driven"）
  'china-gl-recon',              // 总账对账：会计作业口径，不是本插件使用者的研究场景
  'china-accrual-schedule',      // 计提计划，同上
  'china-deal-screening',        // 一级市场标的筛选（PE / 投行语境）
]

// 第七颗（GAJETOso/financeskills）：上游 48 颗扁平排列，这里开放 8 颗。下面 40 颗留在快照里当
// 可审查材料（scripts/ 与 evals/ 连发布包都不进），理由逐条写在
// selected-skills/financeskills/UPSTREAM.md 与 docs/reference/external-skill-scan-2026-10.md。
// 排除的主族不是"给方向与仓位"（§8.6 第 7 条早就不收这一类理由），而是**领域外**：这批正文的
// 角色是总账会计、内控经理、FP&A 经理与个人理财顾问，与本插件使用者的证券研究场景不是一件事。
const FINANCESKILLS_EXCLUDED = [
  // 与既有 59 颗重叠：比率 / 现金周期 / VaR / 综合评估都已有更厚的一份
  'financial-analysis',
  'investment-analysis',
  'risk-assessment',
  'working-capital-analysis',
  // 资产类别：本插件不涉及加密资产
  'crypto-accounting',
  // 个人理财与美国 / 英国税制（401k、Roth、ISA）：不是证券投研，且市场口径不可迁移
  'personal-budgeting',
  'net-worth-tracker',
  'retirement-planning',
  'debt-payoff',
  'tax-planning',
  'tax-efficient-investing',
  // 编制视角的会计作业：怎么把账记对、把报表做出来，不是怎么读别人的披露
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
  // 审计、内控与披露合规的执行面
  'audit-checklist',
  'sox-compliance',
  'esg-reporting',
  // 企业内部经营与资金管理
  'budget-forecast',
  'predictive-burn-rate',
  'product-profitability',
  'cvp-breakeven',
  'treasury-management',
  'earned-value-mgmt',
  // 私有公司与特殊融资语境：本插件没有非上市标的的取数面
  'startup-valuation',
  'lbo-modeling',
  'venture-debt',
  'debt-restructuring',
  'oil-gas-valuation',
  // 依赖本插件不具备的模型 / 数据形态（transformers 情感模型、无监督异常检测）
  'ai-anomaly-detection',
  'nlp-earnings-sentiment',
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
      return undefined
    },
    effect(callback) { rootCleanup = callback() },
    logger: { warn() {} },
  }
  function makeAgent({ preset = 'capital-generation', parentSession, lateSnapshot = false } = {}) {
    const agent = { session: { id: 'session', header: { parentSession } }, ctx: undefined }
    const preStepListeners = []
    let catalogSnapshot = []
    // 模拟 SkillRegistry 的 collect 缓存：list 结果按 revision 缓存，只有 control.invalidate()
    // 才重算。少了这层缓存，"开关变了但没失效缓存"的回归永远抓不到（真注册表里的症状是
    // 每轮 catalog 都还停在旧选择）。
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
    // tool-skill 形状的快照监听：await next() 之后才取 catalog，与 dsh-tool-skill 同形状。
    // 默认在 makeAgent 时先注册（= 运行期 preset 组合先挂、本包钩子在内层）；lateSnapshot
    // 则推迟到 preStep 才挂（= 本包钩子在外层）。两种顺序下本包都必须赶在快照之前失效缓存，
    // 否则这一轮目录仍停在旧选择。
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
  // 第六颗同样是派生钉法，两点不同：它排除得多（规范根 31 里开放 9），而且根路径**从映射现取**、不写死目录名。
  // 这颗的 skills 根是 vertical-plugins/china-finance/skills（上游有六个根），写死就等于"映射漂了"
  // 只能等 provider 装配时才被发现——正是 AGENTS.md §9.7 那一族。排除的 22 颗逐条理由见该快照 UPSTREAM.md。
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
  // 第七颗同样是派生钉法（48 里开放 8）。它排除得最多，理由是**领域外**而不是执行面——所以这条
  // 断言真正钉住的是"别把个人理财、加密与编制会计那几族顺手加回 catalog"：加一颗就红并点名差在哪。
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
  assert.equal(root.preStepListenerCount, 1, 'scope teardown 必须摘掉每轮刷新钩子，不许留悬挂监听')
  harness.disposeRoot()
  assert.equal(harness.listeners.size, 0, 'plugin teardown must detach the root Agent listener')
})

test('selected skill provider: 嵌套 skills 根里的名字走同一个 list/get 闸门', async () => {
  // §9.7 那一族：只验证接好的那个入口，第二个入口就静默漏掉。InvestSkill 的 skill 住在
  // plugins/us-stock-analysis/skills 底下，name 与顶层快照同级，必须同样被 list 过滤、被 get 复核。
  const harness = makeHarness()
  registerRootSelectedSkills(harness.ctx, { factCheck: true }, harness.createFilesystemProvider)
  await harness.listeners.get('agent/created')({ agent: harness.makeAgent().agent })
  assert.deepEqual((await harness.provider.list({})).map(({ name }) => name), ['fact-check'])
  assert.equal((await harness.provider.get(candidate('fact-check'), {})).content, 'loaded')
  assert.throws(
    () => harness.provider.get(candidate('buffett-investment-framework'), {}),
    /not enabled/,
    '未选中的 skill 不得通过 get 绕过 catalog 过滤',
  )
})

test('selected skill provider: 开关每轮现读，已有 Agent 的 catalog 跟随设置刷新', async () => {
  // 会话先建、开关后拨是真实使用顺序。旧实现把 enabled 集合定格在 agent/created（而且全关时
  // 干脆不注册 provider），于是"建好会话再打开开关"永远不出现——本次要修的就是这一族。
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

  // 会话已经存在，用户在设置里打开开关、发下一条指令：
  selection = { buffettFramework: true }
  await live.preStep()
  assert.deepEqual(live.catalogSnapshot, ['buffett-investment-framework'],
    '下一轮 pre-step 的 catalog 快照必须看到新开关，不需要新建会话')
  assert.equal(harness.invalidateCount, 1, '开关变化必须失效目录缓存，否则快照读到缓存里的旧目录')

  await live.preStep()
  assert.equal(harness.invalidateCount, 1, '开关未变不重算目录：每轮零成本')
  assert.deepEqual(live.catalogSnapshot, ['buffett-investment-framework'])

  selection = { buffettFramework: false }
  await live.preStep()
  assert.deepEqual(live.catalogSnapshot, [], '关掉后下一轮目录立即消失')
  assert.equal(harness.invalidateCount, 2)
  assert.throws(
    () => harness.provider.get(candidate('buffett-investment-framework'), {}),
    /not enabled/,
    '关掉后 get 也必须拒绝（目录过滤与正文读取同一道闸门）',
  )

  // 注册顺序反过来也要成立：tool-skill 形状的快照监听若是后挂的（本包钩子在外层），
  // 钩子照样必须在放行 next() 之前失效缓存——两种顺序都要赶得上本轮快照。
  selection = { factCheck: true }
  const innerOrder = harness.makeAgent({ lateSnapshot: true })
  await created({ agent: innerOrder.agent })
  await innerOrder.preStep()
  assert.deepEqual(innerOrder.catalogSnapshot, ['fact-check'])
  selection = { factCheck: false, buffettFramework: true }
  await innerOrder.preStep()
  assert.deepEqual(innerOrder.catalogSnapshot, ['buffett-investment-framework'],
    '快照监听先注册或后注册都要赶得上：钩子必须在 next() 之前失效缓存')
  assert.equal(harness.invalidateCount, 3)

  // 新建的 root Agent 同样读最新开关（这条不回退到"创建时定格"）。
  selection = { factCheck: true }
  const late = harness.makeAgent()
  await created({ agent: late.agent })
  assert.equal(harness.providerRegistrationCount, 3)
  assert.deepEqual((await harness.provider.list({})).map(({ name }) => name), ['fact-check'], '新 root Agent 必须读取最新开关')
})
