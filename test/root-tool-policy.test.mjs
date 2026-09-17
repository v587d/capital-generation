import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPITAL_PRESET_ID,
  ROOT_AGENT_DENIED_TOOLS,
  isCapitalAgent,
  isRootAgent,
  registerRootToolPolicy,
  restrictRootAgentTools,
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

  assert.equal(rootListeners.length, 1, '必须注册在 Root context 上')
  assert.equal(scopedListeners.length, 0, '不得注册在 scoped context 上（那会静默失效）')
  assert.equal(rootListeners[0].event, 'agent/created')

  const calls = []
  const tools = { restrict: (filter) => { calls.push(filter); return () => {} } }
  rootListeners[0].listener({ agent: rootAgent(tools) })
  rootListeners[0].listener({ agent: childAgent(tools) })
  assert.equal(calls.length, ROOT_AGENT_DENIED_TOOLS.length, '只有根 Agent 被收敛')

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
    root: { on: () => () => { disposed.push('listener') } },
    effect: (callback) => { const dispose = callback(); dispose(); return () => {} },
  }
  registerRootToolPolicy(scoped)
  assert.deepEqual(disposed, ['listener'])
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
