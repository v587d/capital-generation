import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPITAL_PRESET_ID,
  OCR_ROOT_URL_DENIED,
  OCR_TOOL_NAME,
  RETRIEVAL_DENIED_TOOLS,
  ROOT_AGENT_DENIED_TOOLS,
  installRootOcrGuard,
  isCapitalAgent,
  isRootAgent,
  registerRootToolPolicy,
  resetRootPolicyProbes,
  restrictRootAgentTools,
  rootOcrGuardReason,
  rootPolicyProbes,
} from '../lib/agents/root-tool-policy.js'

/**
 * 根 Agent 工具收敛的契约测试。
 *
 * 为什么要有这套机制：preset 行注册在 standing 层，主 Agent 与子 Agent 的 scope 都是它的
 * 子节点。在 standing 层 deny 会把 visualization_specialist 一起 deny（allow 是交集过滤，
 * 加不回来）；所以只能在**根 Agent 自己的 scope** 上收敛。
 *
 * 2026-09-17 实测教训（本文件第 5 个用例）：`agent/created` 的路由键是 agent 对象本身，
 * 打标签的 standing-scope 监听器**收不到**这个事件，必须注册在未打标签的 Root context 上。
 */

const childAgent = (tools) => ({ session: { header: { cwd: '/w', parentSession: 'main-1' } }, ctx: { tools } })
const rootAgent = (tools) => ({ session: { header: { cwd: '/w' } }, ctx: { tools } })

test('ROOT_AGENT_DENIED_TOOLS：bash/pwsh 必须点名（主 Agent 不得继承 shell）', () => {
  // preset 的 shell 行注册在 standing 层，主 Agent 会直接继承——收敛只能靠这份名单。
  // 按平台选名，所以两个名字都点名（未注册的那个由逐名 restrict 的 try/catch 跳过）。
  for (const name of ['bash', 'pwsh']) {
    assert.ok(ROOT_AGENT_DENIED_TOOLS.includes(name), `主 Agent 不得看到 ${name}：那是通用执行 + 整机读 + 出网能力`)
  }
})

test('RETRIEVAL_DENIED_TOOLS：十三个出网工具全部从根 Agent 拿掉（出网只有一个入口）', () => {
  // 2026-09-24 review：persona 的禁直连清单写成 `web_retriever_*` 通配，改名后一个都不匹配。
  // 「外部检索只经 web_retriever」因此必须是结构件，而不是靠人设文案；名单长度也是断言的一部分
  // ——少一个名字就等于主 Agent 仍能直连那个来源。
  assert.equal(RETRIEVAL_DENIED_TOOLS.length, 13, '检索面 2 + wind 2 + 具名来源 9 = 13')
  assert.equal(new Set(RETRIEVAL_DENIED_TOOLS).size, 13, '出网名单不得有重名')
  for (const name of RETRIEVAL_DENIED_TOOLS) {
    assert.ok(ROOT_AGENT_DENIED_TOOLS.includes(name), `主 Agent 不得看到出网工具 ${name}`)
  }
  // 宿主的两个检索工具只能在这一层 deny（不由本插件注册 → preset 的 deny 里写它们会炸 child 创建）。
  for (const name of ['web_search', 'web_fetch']) {
    assert.ok(ROOT_AGENT_DENIED_TOOLS.includes(name), `主 Agent 不得看到宿主的 ${name}`)
  }
  // `ocr` 是**刻意的例外**：主 Agent 要能解析用户放在工作目录的本地文档，名字级 deny 做不到
  // "只关外部取数"，所以它不进名单，改由下面的调用级 guard 关掉 `url` 形态。
  assert.ok(!RETRIEVAL_DENIED_TOOLS.includes('ocr'), 'ocr 不得整名 deny（否则本地 file / doc_id 形态一起没了）')
})

test('rootOcrGuardReason：主 Agent 只被关掉 ocr 的 url 形态，本地形态一律放行', () => {
  assert.equal(rootOcrGuardReason({ name: 'ocr', arguments: { url: 'https://pdf.dfcfw.com/pdf/H3_x_1.pdf' } }), OCR_ROOT_URL_DENIED)
  // 空串不是"提交了一个 URL"，交给工具自己的参数校验报响亮错误，这里不抢话。
  assert.equal(rootOcrGuardReason({ name: 'ocr', arguments: { url: '' } }), undefined)
  for (const callArgs of [
    { file: 'refs/年报.pdf' },
    { doc_id: 'ocr_0123456789ab', pages: '1-3' },
    { doc_id: 'ocr_0123456789ab', query: '营业收入' },
    { doc_id: 'ocr_0123456789ab', job_id: 'j-1' },
    {},
  ]) {
    assert.equal(rootOcrGuardReason({ name: 'ocr', arguments: callArgs }), undefined, `本地形态不该被拦：${JSON.stringify(callArgs)}`)
  }
  // 别的工具名一律不看（guard 是单调的，越界一次就可能吃掉别人的正当调用）。
  assert.equal(rootOcrGuardReason({ name: 'web_retriever_fetch', arguments: { url: 'https://example.com/a.pdf' } }), undefined)
  assert.equal(rootOcrGuardReason({ name: 'ocr' }), undefined)
  assert.equal(rootOcrGuardReason(undefined), undefined)
  // 拒绝文案必须给出正确路径（委派 / 本地形态），不能只说"不行"。
  assert.match(OCR_ROOT_URL_DENIED, /subagent_web_retriever/)
  assert.match(OCR_ROOT_URL_DENIED, /file/)
})

test('installRootOcrGuard：只装在根 Agent，安装失败不外抛', () => {
  const installed = []
  const tools = { guard: (guard) => { installed.push(guard); return () => {} } }
  assert.ok(installRootOcrGuard(rootAgent(tools)), '根 Agent 必须装上闸门')
  assert.equal(installed.length, 1)
  assert.equal(installRootOcrGuard(childAgent(tools)), undefined, '子 Agent 不装（url 形态归它们）')
  assert.equal(installRootOcrGuard({ session: { header: {} }, ctx: { tools: {} } }), undefined, 'scope 没有 guard 时静默跳过')
  const throwing = { session: { header: {} } }
  Object.defineProperty(throwing, 'ctx', { get() { throw new Error('no ctx') } })
  assert.equal(installRootOcrGuard(throwing), undefined)
})

test('isRootAgent：只有没有 parentSession 的才是根 Agent', () => {
  assert.equal(isRootAgent(rootAgent({})), true)
  assert.equal(isRootAgent(childAgent({})), false)
  assert.equal(isRootAgent({}), false)
  assert.equal(isRootAgent(undefined), false)
  // 空串等同缺失（header 由宿主写入，防御性判断）
  assert.equal(isRootAgent({ session: { header: { parentSession: '' } } }), true)
})

test('restrictRootAgentTools：只对根 Agent 逐名 deny，且不带 allow', () => {
  const calls = []
  const tools = { restrict: (filter) => { calls.push(filter); return () => {} } }

  assert.equal(restrictRootAgentTools(rootAgent(tools)), 'restricted')
  assert.equal(calls.length, ROOT_AGENT_DENIED_TOOLS.length, '逐名 restrict：单个名字不存在时不影响其余')
  assert.deepEqual(calls.map((filter) => filter.deny[0]).sort(), [...ROOT_AGENT_DENIED_TOOLS].sort())
  assert.ok(calls.every((filter) => filter.allow === undefined), '不能同时传 allow：那会把主 Agent 的其余工具一次砍掉')

  assert.equal(restrictRootAgentTools(childAgent(tools)), 'skipped')
  assert.equal(calls.length, ROOT_AGENT_DENIED_TOOLS.length, '子 Agent 不得被收敛（否则 specialist 拿不到 render_chart）')
})

test('restrictRootAgentTools：单个名字报错（别的 preset 没有这个工具）只是跳过', () => {
  const calls = []
  const tools = {
    restrict: (filter) => {
      calls.push(filter)
      if (filter.deny[0] === 'render_chart') throw new Error('names unknown global tool "render_chart"')
      return () => {}
    },
  }
  assert.equal(restrictRootAgentTools(rootAgent(tools)), 'restricted', '其余名字仍要收敛')
  assert.equal(calls.length, ROOT_AGENT_DENIED_TOOLS.length)
})

test('restrictRootAgentTools：缺 ctx / 缺 tools 返回 unavailable，不抛出', () => {
  assert.equal(restrictRootAgentTools({ session: { header: {} } }), 'unavailable')
  assert.equal(restrictRootAgentTools(rootAgent(undefined)), 'unavailable')
  const throwing = { session: { header: {} } }
  Object.defineProperty(throwing, 'ctx', { get() { throw new Error('no ctx') } })
  assert.equal(restrictRootAgentTools(throwing), 'unavailable')
})

test('registerRootToolPolicy：注册在 Root context 的 agent/created 上（scoped 监听收不到该事件）', () => {
  const scopedListeners = []
  const rootListeners = []
  const warnings = []
  const scoped = {
    on: (event, listener) => { scopedListeners.push({ event, listener }); return () => {} },
    effect: (callback) => callback(),
    logger: { warn: (message) => warnings.push(message) },
  }
  scoped.root = { on: (event, listener) => { rootListeners.push({ event, listener }); return () => {} } }
  registerRootToolPolicy(scoped)

  assert.deepEqual(rootListeners.map((entry) => entry.event), ['agent/created', 'agent/disposed'], '必须注册在 Root context 上（两个事件）')
  assert.equal(scopedListeners.length, 0, '不得注册在 scoped context 上（那会静默失效）')
  assert.equal(rootListeners[0].event, 'agent/created')

  const calls = []
  const guards = []
  const tools = {
    restrict: (filter) => { calls.push(filter); return () => {} },
    guard: (guard) => { guards.push(guard); return () => {} },
  }
  rootListeners[0].listener({ agent: rootAgent(tools) })
  rootListeners[0].listener({ agent: childAgent(tools) })
  assert.equal(calls.length, ROOT_AGENT_DENIED_TOOLS.length, '只有根 Agent 被收敛')
  assert.equal(guards.length, 1, '`ocr` 的调用级闸门只装在主 Agent 自己的 scope 上（子 Agent 保留 url 形态）')

  // 收敛不可用必须留诊断，且不得抛回 agent 创建路径。
  assert.doesNotThrow(() => rootListeners[0].listener({ agent: { session: { header: {} } } }))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /根 Agent 工具收敛未生效/)

  // 载荷异常也不能炸（事件来自宿主，宁可少收敛）。
  assert.doesNotThrow(() => rootListeners[0].listener({}))
  assert.doesNotThrow(() => rootListeners[0].listener(undefined))
})

test('registerRootToolPolicy：别的 preset 的根 Agent 不动', () => {
  const rootListeners = []
  const calls = []
  const ctx = {
    get: (name) => (name === 'agentPresets' ? { composedPreset: () => 'standard' } : undefined),
    on: (event, listener) => { rootListeners.push({ event, listener }); return () => {} },
    logger: { warn() {} },
  }
  registerRootToolPolicy(ctx)
  rootListeners[0].listener({ agent: { session: { header: {} }, ctx: { tools: { restrict: (filter) => { calls.push(filter) } } } } })
  assert.equal(calls.length, 0, 'standard preset 的根 Agent 不该被我们 restrict')
})

/**
 * ⛔ 取证用例（2026-09-30 桌面端）。
 *
 * 桌面端 Capital 根会话的 `request.header.tools` 里 `pwsh` / `request_data` / `dc_status` /
 * `render_chart` **全都在**——收敛一步没走，而当时**没有任何一处能看出来为什么**：三条出口
 * （registry 读不到、`composedPreset` 判 false、逐名 `restrict()` 抛错被 catch）都不留痕迹，
 * 桌面端又不落盘 `ctx.logger`。这条用例钉的是"三条出口各自必须在现场记录里可分辨"——
 * 它不证明收敛成功，只保证下次再坏的时候**看得见坏在哪一步**。
 */
test('registerRootToolPolicy：三条静默出口都要在现场记录里留下可分辨的痕迹', () => {
  resetRootPolicyProbes()
  const fire = ({ composedPreset, restrict }) => {
    const listeners = []
    registerRootToolPolicy({
      get: (name) => (name === 'agentPresets' ? (composedPreset === undefined ? undefined : { composedPreset }) : undefined),
      on: (event, listener) => { listeners.push({ event, listener }); return () => {} },
      logger: { warn() {}, info() {}, error() {} },
    })
    listeners[0].listener({ agent: { id: 'root-1', session: { id: 'root-1', header: {} }, ctx: { tools: { restrict } } } })
    return rootPolicyProbes().at(-1)
  }

  // 出口一：`composedPreset` 认不出这个根 Agent（桌面端最可疑的一条）。
  const judged = fire({ composedPreset: () => 'standard', restrict: () => {} })
  assert.equal(judged.presetId, 'standard', '现场记录要原样带出 composedPreset 的返回值，否则无法判断是不是判错了预设')
  assert.equal(judged.outcome, 'not-capital')
  assert.deepEqual(judged.denied, [])

  // 出口二：逐名 `restrict()` 抛错被 catch 跳过——**旧实现连这条都不留**，
  // outcome 照样是 restricted，看起来像"收敛成功了"。
  const failed = fire({
    composedPreset: () => CAPITAL_PRESET_ID,
    restrict: () => { throw new Error('unknown tool name') },
  })
  assert.equal(failed.outcome, 'restricted')
  assert.deepEqual(failed.failed, [...ROOT_AGENT_DENIED_TOOLS], '每一个被跳过的名字都必须点名')
  assert.deepEqual(failed.denied, [])

  // 出口三：registry 压根读不到（保守放行分支）。
  const noRegistry = fire({ composedPreset: undefined, restrict: () => {} })
  assert.equal(noRegistry.presetId, 'no-registry')
  assert.equal(noRegistry.denied.length, ROOT_AGENT_DENIED_TOOLS.length, '保守放行也要如实记下 deny 成功的名')

  // 子 Agent 不进这份窗口：它们是绝大多数 agent/created 的来源，会把唯一有意义的那行挤掉。
  resetRootPolicyProbes()
  const listeners = []
  registerRootToolPolicy({
    get: () => ({ composedPreset: () => CAPITAL_PRESET_ID }),
    on: (event, listener) => { listeners.push({ event, listener }); return () => {} },
    logger: { warn() {} },
  })
  listeners[0].listener({ agent: { session: { id: 'kid', header: { parentSession: 'root-1' } }, ctx: { tools: { restrict: () => {} } } } })
  assert.deepEqual(rootPolicyProbes(), [], '现场记录只留根 Agent')
  resetRootPolicyProbes()
})

test('registerRootToolPolicy：registry 读不到时保守放行（逐名 restrict 自己会拒绝未知名字）', () => {
  const listeners = []
  const calls = []
  registerRootToolPolicy({
    get: () => undefined,
    on: (event, listener) => { listeners.push({ event, listener }); return () => {} },
  })
  listeners[0].listener({ agent: { session: { header: {} }, ctx: { tools: { restrict: (filter) => { calls.push(filter) } } } } })
  assert.equal(calls.length, ROOT_AGENT_DENIED_TOOLS.length)
})

test('registerRootToolPolicy：Root 监听器必须由本 fiber 持有 disposer（否则卸载后泄漏）', () => {
  const disposed = []
  const scoped = {
    root: { on: (event) => () => { disposed.push(event) } },
    effect: (callback) => { const dispose = callback(); dispose(); return () => {} },
  }
  registerRootToolPolicy(scoped)
  assert.deepEqual(disposed, ['agent/created', 'agent/disposed'], '两个 Root 监听器都要被本 fiber 释放')
})

test('isCapitalAgent：按 composedPreset 筛本 preset', () => {
  const ctx = { get: () => ({ composedPreset: (agentCtx) => agentCtx?.preset }) }
  assert.equal(isCapitalAgent(ctx, { ctx: { preset: CAPITAL_PRESET_ID } }), true)
  assert.equal(isCapitalAgent(ctx, { ctx: { preset: 'standard' } }), false)
  assert.equal(isCapitalAgent(ctx, {}), false, 'composedPreset 返回 undefined 时不认领')
  assert.equal(isCapitalAgent({ get: () => ({ composedPreset: () => { throw new Error('boom') } }) }, { ctx: {} }), false)
})

test('registerRootToolPolicy：ctx 没有 on 时安静跳过（不改装配结果）', () => {
  assert.doesNotThrow(() => registerRootToolPolicy({}))
})
