import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPITAL_PRESET_ID,
  FS_WRITE_READ_ONLY,
  FS_WRITE_TOOL_NAMES,
  OCR_ROOT_URL_DENIED,
  OCR_TOOL_NAME,
  RETRIEVAL_DENIED_TOOLS,
  ROOT_AGENT_DENIED_TOOLS,
  SHELL_TOOL_NAMES,
  fsWriteGuardReasonFor,
  isCapitalAgent,
  isRootAgent,
  ocrFormGuardReasonFor,
  ocrUrlFormRequested,
  registerFsWriteGuard,
  registerRootOcrGuard,
  registerRootToolPolicy,
  resetRootPolicyProbes,
  restrictRootAgentTools,
  rootPolicyProbes,
} from '../lib/agents/root-tool-policy.js'
import { ROLE_PRESET_IDS } from '../lib/preset-ids.js'

/**
 * Root Agent tool convergence contract: deny on the root's own scope and listen on
 * the unscoped ctx.root. Standing-scope deny removes children and misses agent/created.
 */

const childAgent = (tools) => ({ session: { header: { cwd: '/w', parentSession: 'main-1' } }, ctx: { tools } })
const rootAgent = (tools) => ({ session: { header: { cwd: '/w' } }, ctx: { tools } })

test('ROOT_AGENT_DENIED_TOOLS：2026-10-15 用户决策「开 read、同时保留 bash」——shell 不点名，写口点名', () => {
  // Current rule: root keeps shell; deny only file writes, so shell names must stay absent.
  for (const name of SHELL_TOOL_NAMES) {
    assert.ok(!ROOT_AGENT_DENIED_TOOLS.includes(name), `主 Agent 保留 ${name}（2026-10-15 决策）：名单里不许再点名`)
  }
  for (const name of ['write', 'edit']) {
    assert.ok(ROOT_AGENT_DENIED_TOOLS.includes(name), `主 Agent 不得看到 ${name}：业务落盘只走工具实现（store.writeContext 等）`)
  }
  assert.ok(!ROOT_AGENT_DENIED_TOOLS.includes('read'), 'read 是 2026-10-15 决策新开的正当能力，不得进名单')
  // read_image is read-only and conditional; naming it would create permanent failed records.
  assert.ok(!ROOT_AGENT_DENIED_TOOLS.includes('read_image'), 'read_image 不点名：条件注册 + 只读')
})

test('RETRIEVAL_DENIED_TOOLS：十三个出网工具全部从根 Agent 拿掉（出网只有一个入口）', () => {
  // External retrieval isolation must be structural; a missing name leaves that source reachable.
  assert.equal(RETRIEVAL_DENIED_TOOLS.length, 13, '检索面 2 + wind 2 + 具名来源 9 = 13')
  assert.equal(new Set(RETRIEVAL_DENIED_TOOLS).size, 13, '出网名单不得有重名')
  for (const name of RETRIEVAL_DENIED_TOOLS) {
    assert.ok(ROOT_AGENT_DENIED_TOOLS.includes(name), `主 Agent 不得看到出网工具 ${name}`)
  }
  // Host tools currently absent: keeping them would bury real failed denies. Re-add if mounted.
  for (const name of ['web_search', 'web_fetch']) {
    assert.ok(!ROOT_AGENT_DENIED_TOOLS.includes(name), `${name} 在当前宿主根作用域里不存在，不该留在名单里`)
  }
  // OCR is an intentional exception: name-level deny cannot separate local files from external URLs.
  assert.ok(!RETRIEVAL_DENIED_TOOLS.includes('ocr'), 'ocr 不得整名 deny（否则本地 file / doc_id 形态一起没了）')
})

test('ocrFormGuardReasonFor：只有**确证是主模式人设**的调用被关掉 url 形态，其余一律放行', () => {
  const ctx = { get: () => ({ composedPreset: (agentCtx) => agentCtx?.preset }) }
  const guard = ocrFormGuardReasonFor(ctx)
  const capital = { ctx: { preset: CAPITAL_PRESET_ID } }
  assert.equal(guard({ name: 'ocr', agent: capital, arguments: { url: 'https://pdf.dfcfw.com/pdf/H3_x_1.pdf' } }), OCR_ROOT_URL_DENIED)
  // Empty URL is not a request; let tool validation report it.
  assert.equal(guard({ name: 'ocr', agent: capital, arguments: { url: '' } }), undefined)
  for (const callArgs of [
    { file: 'refs/年报.pdf' },
    { doc_id: 'ocr_0123456789ab', pages: '1-3' },
    { doc_id: 'ocr_0123456789ab', query: '营业收入' },
    { doc_id: 'ocr_0123456789ab', job_id: 'j-1' },
    {},
  ]) {
    assert.equal(guard({ name: 'ocr', agent: capital, arguments: callArgs }), undefined, `本地形态不该被拦：${JSON.stringify(callArgs)}`)
  }
  // The web_retriever role may submit the same URL; identity is preset-based, not topology-based.
  assert.equal(guard({ name: 'ocr', agent: { ctx: { preset: 'capital-web-retriever' } }, arguments: { url: 'https://x/a.pdf' } }), undefined)
  // ⛔ A global guard must fail open on unknown identity; it cannot consume another preset's valid calls.
  assert.equal(guard({ name: 'ocr', agent: { ctx: { preset: 'standard' } }, arguments: { url: 'https://x/a.pdf' } }), undefined, '别的 preset 的 ocr 不归我们管')
  assert.equal(ocrFormGuardReasonFor({ get: () => undefined })({ name: 'ocr', agent: capital, arguments: { url: 'https://x/a.pdf' } }), undefined, 'registry 读不到就放行')
  assert.equal(ocrFormGuardReasonFor({ get: () => ({ composedPreset: () => { throw new Error('boom') } }) })({ name: 'ocr', agent: capital, arguments: { url: 'https://x/a.pdf' } }), undefined, 'composedPreset 抛错就放行')
  // Ignore unrelated tool names; a monotonic guard must not deny what it cannot identify.
  assert.equal(guard({ name: 'web_retriever_fetch', agent: capital, arguments: { url: 'https://example.com/a.pdf' } }), undefined)
  assert.equal(guard({ name: 'ocr', agent: capital }), undefined)
  assert.equal(guard(undefined), undefined)
  assert.equal(ocrUrlFormRequested({ name: 'ocr', arguments: { file: 'a.pdf' } }), false, '形态判据本身可单测')
  // Denial must name the correct path: delegate externally, use local forms directly.
  assert.match(OCR_ROOT_URL_DENIED, /subagent_web_retriever/)
  assert.match(OCR_ROOT_URL_DENIED, /file/)
})

test('registerRootOcrGuard：全局装一次，且拒绝要留下现场记录', () => {
  resetRootPolicyProbes()
  const guards = []
  const ctx = {
    get: (name) => (name === 'agentPresets' ? { composedPreset: (agentCtx) => agentCtx?.preset } : undefined),
    tools: { guard: (guard) => { guards.push(guard); return () => {} } },
    effect: (callback) => { callback(); return () => {} },
    logger: { warn() {} },
  }
  registerRootOcrGuard(ctx)
  registerRootOcrGuard(ctx)
  assert.equal(guards.length, 1, '全局 guard 只装一次：按调用身份判定，不需要按 agent 装')
  const call = { name: 'ocr', agent: { session: { id: 's-capital' }, ctx: { preset: CAPITAL_PRESET_ID } }, arguments: { url: 'https://x/a.pdf' } }
  assert.equal(guards[0](call), OCR_ROOT_URL_DENIED)
  const probes = rootPolicyProbes()
  assert.equal(probes.length, 1, '拦下一次必须记一条（文案之外还得能查"当时判定成谁"）')
  assert.deepEqual(
    { outcome: probes[0].outcome, preset_id: probes[0].presetId, agent_id: probes[0].agentId, root: probes[0].root, denied: probes[0].denied },
    { outcome: 'guard-denied', preset_id: CAPITAL_PRESET_ID, agent_id: 's-capital', root: true, denied: ['ocr'] })
  // Successful calls are not recorded; normal traffic would flush the bounded diagnostic ring.
  guards[0]({ name: 'ocr', agent: { ctx: { preset: 'capital-web-retriever' } }, arguments: { url: 'https://x/b.pdf' } })
  assert.equal(rootPolicyProbes().length, 1)
  // Installation failures must not throw, but must be visible; silent no-op hides real bypasses.
  const warns = []
  assert.doesNotThrow(() => registerRootOcrGuard({
    get: () => undefined, tools: {}, effect: (cb) => cb(), logger: { warn: (message) => warns.push(message) },
  }))
  assert.match(warns.join('\n'), /没装上/, '⛔ `ocr` 形态闸门装不上时必须 warn（capital-policy 漏 inject 就是这个形状）')
})

test('isRootAgent：只有没有 parentSession 的才是根 Agent', () => {
  assert.equal(isRootAgent(rootAgent({})), true)
  assert.equal(isRootAgent(childAgent({})), false)
  assert.equal(isRootAgent({}), false)
  assert.equal(isRootAgent(undefined), false)
  // Empty parentSession is equivalent to missing; defensive header handling.
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

  assert.deepEqual(rootListeners.map((entry) => entry.event), ['agent/created'],
    '视图层收敛只需要 created；`ocr` 形态闸门不再按 agent 装（手开模式的身份在 created 之后才选定）')
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
  assert.equal(guards.length, 0, 'created 监听不再装 `ocr` guard：那颗改成全局一次（registerRootOcrGuard），装在这里会漏掉手开模式')

  // Unavailable convergence must warn without throwing on the agent-creation path.
  assert.doesNotThrow(() => rootListeners[0].listener({ agent: { session: { header: {} } } }))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /根 Agent 工具收敛未生效/)

  // Malformed host payloads cannot crash convergence; losing some restriction is safer.
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
 * ⛔ Forensic cases: all three silent exits — registry read, preset mismatch, and per-name
 * restrict failure — must be distinguishable in the bounded probe history.
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

  // Exit 1: composedPreset cannot identify this root Agent.
  const judged = fire({ composedPreset: () => 'standard', restrict: () => {} })
  assert.equal(judged.presetId, 'standard', '现场记录要原样带出 composedPreset 的返回值，否则无法判断是不是判错了预设')
  assert.equal(judged.outcome, 'not-capital')
  assert.deepEqual(judged.denied, [])

  // Exit 2: a per-name restrict throws and is caught; the failed list proves convergence was partial.
  const failed = fire({
    composedPreset: () => CAPITAL_PRESET_ID,
    restrict: () => { throw new Error('unknown tool name') },
  })
  assert.equal(failed.outcome, 'restricted')
  assert.deepEqual(failed.failed, [...ROOT_AGENT_DENIED_TOOLS], '每一个被跳过的名字都必须点名')
  assert.deepEqual(failed.denied, [])

  // Exit 3: registry is absent and the conservative claim path runs.
  const noRegistry = fire({ composedPreset: undefined, restrict: () => {} })
  assert.equal(noRegistry.presetId, 'no-registry')
  assert.equal(noRegistry.denied.length, ROOT_AGENT_DENIED_TOOLS.length, '保守放行也要如实记下 deny 成功的名')

  // Children are too numerous for the root-convergence window and would evict meaningful rows.
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
  assert.deepEqual(disposed, ['agent/created'], 'Root 监听器必须由本 fiber 释放（不释放就是跨实例泄漏）')
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

test('fsWriteGuardReasonFor：write / edit 对本插件的根与角色都拒；读口与别的 preset 一律放行', () => {
  const ctx = { get: () => ({ composedPreset: (agentCtx) => agentCtx?.preset }) }
  const guard = fsWriteGuardReasonFor(ctx)
  const capital = { ctx: { preset: CAPITAL_PRESET_ID } }
  assert.deepEqual([...FS_WRITE_TOOL_NAMES], ['write', 'edit'], '写口名单就是这两个名字；改动它要有明确设计决策')
  for (const name of FS_WRITE_TOOL_NAMES) {
    assert.equal(guard({ name, agent: capital, arguments: { file_path: '/w/a.md' } }), FS_WRITE_READ_ONLY)
    // ⛔ Row config cannot remove inherited write names; this call guard covers all Capital presets.
    assert.equal(guard({ name, agent: { ctx: { preset: ROLE_PRESET_IDS.junior } } }), FS_WRITE_READ_ONLY,
      '子角色同样不许直接写文件：业务落盘只走工具实现')
    // ⛔ A global guard must not consume another preset's write access.
    assert.equal(guard({ name, agent: { ctx: { preset: 'standard' } } }), undefined)
    assert.equal(guard({ name, agent: { ctx: {} } }), undefined, 'composedPreset 返回 undefined 时不认领、放行')
  }
  for (const name of ['read', 'read_image', 'bash', 'describe_dataset', undefined]) {
    assert.equal(guard({ name, agent: capital }), undefined, `${name} 不是写口，闸门不得插手`)
  }
  // ⛔ Unknown identity fails open; closing it would deny writes process-wide.
  assert.equal(fsWriteGuardReasonFor({ get: () => undefined })({ name: 'write', agent: capital }), undefined)
  assert.equal(fsWriteGuardReasonFor({ get: () => ({ composedPreset: () => { throw new Error('boom') } }) })({ name: 'write', agent: capital }), undefined)
  assert.equal(guard({ name: 'write' }), undefined)
  assert.equal(guard(undefined), undefined)
  // Denial text must name both write tools and the supported read/data_gap path.
  assert.match(FS_WRITE_READ_ONLY, /read/)
  assert.match(FS_WRITE_READ_ONLY, /data_gap/)
  assert.match(FS_WRITE_READ_ONLY, /write/)
  assert.match(FS_WRITE_READ_ONLY, /edit/)
})

test('registerFsWriteGuard：全局装一次（不按 agent 装），拒绝要留下现场记录，guard 不可用 / 抛错都不外抛', () => {
  resetRootPolicyProbes()
  const guards = []
  const disposed = []
  const tools = { guard: (guard) => { guards.push(guard); return () => { disposed.push('guard') } } }
  const ctx = {
    get: (name) => (name === 'agentPresets' ? { composedPreset: (agentCtx) => agentCtx?.preset } : undefined),
    tools,
    effect: (callback) => { const dispose = callback(); dispose(); return () => {} },
  }
  registerFsWriteGuard(ctx)
  assert.equal(guards.length, 1, '全局 guard 只装一次：它按调用身份判定，不需要按 agent 装')
  assert.equal(guards[0]({ name: 'write', agent: { session: { id: 's-fs' }, ctx: { preset: CAPITAL_PRESET_ID } } }), FS_WRITE_READ_ONLY,
    '装的必须是 fs 写口闸门（同一份判定实现）')
  // Guard denials share the probe channel: "denied" and "no write tool" look identical to the model.
  const last = rootPolicyProbes().at(-1)
  assert.deepEqual(
    { outcome: last.outcome, preset_id: last.presetId, agent_id: last.agentId, root: last.root, denied: last.denied },
    { outcome: 'guard-denied', preset_id: CAPITAL_PRESET_ID, agent_id: 's-fs', root: true, denied: ['write'] })
  guards[0]({ name: 'read', agent: { ctx: { preset: CAPITAL_PRESET_ID } } })
  assert.equal(rootPolicyProbes().length, 1, '放行不记')
  assert.deepEqual(disposed, ['guard'], 'disposer 由 ctx.effect 持有并随 fiber 释放')
  // Guard unavailable or installation exceptions must not escape the assembly path.
  assert.doesNotThrow(() => registerFsWriteGuard({}))
  assert.doesNotThrow(() => registerFsWriteGuard({ get: () => undefined }))
  assert.doesNotThrow(() => registerFsWriteGuard({ tools: { guard: () => { throw new Error('boom') } } }))
})
