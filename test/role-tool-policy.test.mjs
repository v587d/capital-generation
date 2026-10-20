import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ROLE_PRESET_IDS,
  ROLE_PRESET_ID_LIST,
  ROLE_TOOL_SURFACES,
  registerRoleSiblingGuard,
  registerRoleToolPolicy,
  resetRolePolicyProbes,
  restrictRoleAgentTools,
  rolePolicyProbes,
  rolePresetIdOf,
  roleSiblingGuardReasonFor,
  SIBLING_DENIED_TOOLS,
} from '../lib/agents/role-tool-policy.js'
import { resetRootPolicyProbes, rootPolicyProbes } from '../lib/agents/root-tool-policy.js'

/**
 * Role surface is closed by row composition; this file covers the residual sibling deny.
 * tool-subagent-control welds send_message to interrupt_agent, so leaf roles must tolerate
 * denying whichever name is absent.
 */

/** Recording fake tool surface; unknown names throw exactly like restrict(). */
function fakeTools(known = null) {
  const calls = []
  return {
    calls,
    restrict(filter) {
      const names = [...(filter.allow ?? []), ...(filter.deny ?? [])]
      if (known !== null && names.some((name) => !known.has(name))) throw new Error(`unknown global tool: ${names.join(', ')}`)
      calls.push(filter)
      return () => {}
    },
  }
}

const childAgent = (tools, presetId = ROLE_PRESET_IDS.collector, id = 'child-1') => ({
  session: { id, header: { cwd: '/w', parentSession: 'main-1' } },
  ctx: { tools, presetId },
})

/** Separate root and standing registries: attaching to the wrong one silently misses events. */
function fakeCtx(presetOf, { registry = true } = {}) {
  const rootListeners = []
  const standingListeners = []
  const root = {
    on(event, listener) {
      rootListeners.push({ event, listener })
      return () => {}
    },
  }
  const ctx = {
    logger: { warn() {} },
    get(name) {
      if (name === 'agentPresets' && registry) return { composedPreset: (agentCtx) => presetOf?.(agentCtx) }
      return undefined
    },
    on(event, listener) {
      standingListeners.push({ event, listener })
      return () => {}
    },
    root,
    effect: (callback) => callback(),
  }
  return { ctx, root, rootListeners, standingListeners }
}

test('角色残留面只剩"同行兄弟"：不许出现 allow 清单', () => {
  assert.deepEqual(Object.values(ROLE_PRESET_IDS).sort(), [...ROLE_PRESET_ID_LIST].sort())
  for (const presetId of ROLE_PRESET_ID_LIST) {
    const surface = ROLE_TOOL_SURFACES[presetId]
    assert.ok(surface, `${presetId} 没有残留面`)
    assert.equal(surface.allow, undefined, `${presetId} 不许再有整份 allow 名单：工具面由 preset 挂的族行决定`)
    for (const name of surface.denySiblings ?? []) {
      assert.ok(SIBLING_DENIED_TOOLS.includes(name), `${presetId} 的 deny 里出现了不是"同行兄弟”的名字（${name}）——那就是 §6.1 禁止恢复的"继承全部再划掉"形状`)
    }
  }
  // Only control-row roles have a sibling name to deny.
  for (const role of [ROLE_PRESET_IDS.collector, ROLE_PRESET_IDS.junior, ROLE_PRESET_IDS.retriever, ROLE_PRESET_IDS.analyst]) {
    assert.deepEqual([...ROLE_TOOL_SURFACES[role].denySiblings], [...SIBLING_DENIED_TOOLS], `${role} 要 send_message，就得减掉焊在一起的 interrupt_agent`)
  }
  for (const role of [ROLE_PRESET_IDS.specialist]) {
    assert.equal(ROLE_TOOL_SURFACES[role].denySiblings, undefined, `${role} 不挂 control 行，不该有清单`)
  }
})

test('组合入口负责的角色不再走 agent/created 的 restrict（specialist 是第一个）', () => {
  resetRolePolicyProbes()
  const { ctx, rootListeners } = fakeCtx((agentCtx) => agentCtx?.presetId)
  registerRoleToolPolicy(ctx)
  const created = rootListeners.find((entry) => entry.event === 'agent/created').listener

  const tools = fakeTools()
  created({ agent: childAgent(tools, ROLE_PRESET_IDS.specialist, 'specialist-1') })
  assert.deepEqual(tools.calls, [], 'specialist 的工具面由 preset 入口决定，不该再提交 restrict')
  assert.deepEqual(rolePolicyProbes(), [], '没有提交运行期名单就不该产生收敛现场；否则会误导诊断')
})

test('兄弟名字逐个 deny 提交（deny 是并集语义，逐名与整批等价，但失败方向不同）', () => {
  const tools = fakeTools()
  const result = restrictRoleAgentTools(childAgent(tools), ROLE_TOOL_SURFACES[ROLE_PRESET_IDS.junior])
  assert.equal(result.outcome, 'restricted')
  assert.deepEqual(tools.calls, SIBLING_DENIED_TOOLS.map((name) => ({ deny: [name] })))
  assert.deepEqual(result.denied, [...SIBLING_DENIED_TOOLS])
  assert.equal(tools.calls.filter((call) => call.allow !== undefined).length, 0, '角色侧不再提交 allow')
})

test('看不见的名字只跳过它自己：其余照常收敛（旧 allow 形状是整批 fail-open）', () => {
  // An absent interrupt name means only one tolerant deny fails; it cannot remove the whole allow list.
  const tools = fakeTools(new Set(['send_message']))
  const result = restrictRoleAgentTools(childAgent(tools), ROLE_TOOL_SURFACES[ROLE_PRESET_IDS.collector])
  assert.equal(result.outcome, 'restricted')
  assert.deepEqual(result.denied, [])
  assert.deepEqual(result.failed, [...SIBLING_DENIED_TOOLS], '现场记录点名跳过的名字')
})

test('rolePresetIdOf 只认角色 preset：根 Agent、别的 preset、读不到 registry 都判 undefined', () => {
  const { ctx } = fakeCtx((agentCtx) => agentCtx?.presetId)
  for (const presetId of ROLE_PRESET_ID_LIST) {
    assert.equal(rolePresetIdOf(ctx, childAgent({}, presetId)), presetId)
  }
  assert.equal(rolePresetIdOf(ctx, { session: { id: 'main-1', header: { cwd: '/w' } }, ctx: { presetId: 'capital-generation' } }), undefined,
    '主 Agent 由 root-tool-policy 收敛，这里必须判 undefined')
  assert.equal(rolePresetIdOf(ctx, { session: { id: 'x', header: { cwd: '/w', parentSession: 'm' } }, ctx: { presetId: 'other-mode' } }), undefined,
    '别的 preset 的 child 不许被我们碰')
  const blind = fakeCtx(() => ROLE_PRESET_IDS.collector, { registry: false })
  assert.equal(rolePresetIdOf(blind.ctx, childAgent({})), undefined, '读不到 agentPresets 时不收敛')
})

test('监听只装未打标签的 root context（standing 上装了收不到事件且不报错）', () => {
  resetRolePolicyProbes()
  const { ctx, rootListeners, standingListeners } = fakeCtx((agentCtx) => agentCtx?.presetId)
  registerRoleToolPolicy(ctx)
  assert.deepEqual(rootListeners.map((entry) => entry.event), ['agent/created', 'agent/disposed'])
  assert.deepEqual(standingListeners, [], '监听器不许落在打标签的 standing ctx 上')
})

test('agent/created 只收敛角色 child，且同一颗 child 只收敛一次', () => {
  resetRolePolicyProbes()
  const first = fakeCtx((agentCtx) => agentCtx?.presetId)
  registerRoleToolPolicy(first.ctx)
  const created = (entry) => entry.listener

  const rootTools = fakeTools()
  created(first.rootListeners.find((entry) => entry.event === 'agent/created'))(
    { agent: { session: { id: 'main-1', header: { cwd: '/w' } }, ctx: { tools: rootTools, presetId: 'capital-generation' } } })
  assert.deepEqual(rootTools.calls, [], '主 Agent 不该在这里被收敛')

  const tools = fakeTools()
  created(first.rootListeners.find((entry) => entry.event === 'agent/created'))({ agent: childAgent(tools) })
  assert.equal(tools.calls.length, 1, '角色 child 应被收敛一次')

  // Two preset listeners may see the same child; convergence must be idempotent.
  const second = fakeCtx((agentCtx) => agentCtx?.presetId)
  registerRoleToolPolicy(second.ctx)
  created(second.rootListeners.find((entry) => entry.event === 'agent/created'))({ agent: childAgent(tools) })
  assert.equal(tools.calls.length, 1, '同一颗 child 被两个监听器各收敛一次')

  const probes = rolePolicyProbes()
  assert.equal(probes.length, 1, '现场记录必须去重（否则窗口被同一颗 child 刷满）')
  assert.equal(probes[0].presetId, ROLE_PRESET_IDS.collector)
  assert.equal(probes[0].agentId, 'child-1')
  assert.deepEqual(probes[0].denied, [...SIBLING_DENIED_TOOLS])

  // Release the dedupe key on disposal so a reused id is converged again.
  created(second.rootListeners.find((entry) => entry.event === 'agent/disposed'))({ agent: childAgent(fakeTools()) })
  const redo = fakeTools()
  created(first.rootListeners.find((entry) => entry.event === 'agent/created'))({ agent: childAgent(redo) })
  assert.equal(redo.calls.length, 1, '释放后同 id 的 child 必须能重新收敛')
})

test('deny 名单只写真存在的兄弟名字：shell 名字不归这里管（在 bash-guard 与 YAML 行里）', () => {
  for (const role of ROLE_PRESET_ID_LIST) {
    for (const name of ROLE_TOOL_SURFACES[role].denySiblings ?? []) {
      assert.ok(!['bash', 'pwsh'].includes(name), `${role} 的残留清单里不许出现 shell：行级 shell 由 YAML 的平台互斥行管（§1.6）`)
      assert.ok(!name.startsWith('anysearch') && name !== 'web_fetch', `${role} 的残留清单不许拿去挡宿主/第三方挂的名字（§1.5：那是 permission/approval 那一格）`)
    }
  }
})

/** Role presets can be opened manually; row composition is the only gate on that path. */
test('挂在角色 preset 的根会话（用户手选角色 preset 开的会话）同样只拿到那份清单', () => {
  resetRolePolicyProbes()
  const { ctx, rootListeners } = fakeCtx((agentCtx) => agentCtx?.presetId)
  registerRoleToolPolicy(ctx)
  const created = rootListeners.find((entry) => entry.event === 'agent/created').listener

  const tools = fakeTools()
  created({ agent: { session: { id: 'root-as-retriever', header: { cwd: '/w' } }, ctx: { tools, presetId: ROLE_PRESET_IDS.retriever } } })
  assert.deepEqual(tools.calls, SIBLING_DENIED_TOOLS.map((name) => ({ deny: [name] })), '根会话也要收敛（无 parentSession 不是豁免理由）')
  assert.deepEqual(rolePolicyProbes().map((probe) => probe.agentId), ['root-as-retriever'])

  // The main root id remains owned by root-tool-policy.
  const mainTools = fakeTools()
  created({ agent: { session: { id: 'root-main', header: { cwd: '/w' } }, ctx: { tools: mainTools, presetId: 'capital-generation' } } })
  assert.deepEqual(mainTools.calls, [], 'capital-generation 不是角色 preset，这里不许碰它')
})


/**
 * ⛔ The call-level guard, not created-time restrict, covers manually opened sessions:
 * the host creates the Agent before selecting its preset.
 */
test('roleSiblingGuardReasonFor：角色人设调 interrupt_agent 被拒，其余一律放行', () => {
  const guard = roleSiblingGuardReasonFor(fakeCtx((agentCtx) => agentCtx?.presetId).ctx)
  for (const presetId of [ROLE_PRESET_IDS.collector, ROLE_PRESET_IDS.junior, ROLE_PRESET_IDS.retriever, ROLE_PRESET_IDS.analyst]) {
    const reason = guard({ name: 'interrupt_agent', agent: { ctx: { presetId } } })
    assert.ok(typeof reason === 'string' && reason.length > 0, `${presetId} 必须拦下 interrupt_agent`)
    assert.match(reason, new RegExp(presetId), '拒绝要点名是谁被拒')
    assert.match(reason, /send_message/, '拒绝必须给出正确路径（回告主 Agent）')
  }
  // Root may interrupt its children; unknown presets must remain allowed.
  assert.equal(guard({ name: 'interrupt_agent', agent: { ctx: { presetId: 'capital-generation' } } }), undefined)
  assert.equal(guard({ name: 'interrupt_agent', agent: { ctx: { presetId: 'standard' } } }), undefined)
  assert.equal(guard({ name: 'interrupt_agent', agent: { ctx: {} } }), undefined)
  assert.equal(roleSiblingGuardReasonFor(fakeCtx(undefined, { registry: false }).ctx)({ name: 'interrupt_agent', agent: { ctx: { presetId: ROLE_PRESET_IDS.retriever } } }), undefined,
    'registry 读不到就放行：宁可少一层闸门，也不能吃掉开发会话')
  // send_message is the leaf role's return channel and must never be denied.
  for (const name of ['send_message', 'list_agents', 'request_data', undefined]) {
    assert.equal(guard({ name, agent: { ctx: { presetId: ROLE_PRESET_IDS.retriever } } }), undefined, `${name} 不是这格管的`)
  }
})

test('registerRoleSiblingGuard：全局装一次，拒绝记进现场且照实记会话形状', () => {
  resetRolePolicyProbes()
  const guards = []
  const { ctx } = fakeCtx((agentCtx) => agentCtx?.presetId)
  ctx.tools = { guard: (guard) => { guards.push(guard); return () => {} } }
  ctx.effect = (callback) => { callback(); return () => {} }
  registerRoleSiblingGuard(ctx)
  registerRoleSiblingGuard(ctx)
  assert.equal(guards.length, 1, '全局 guard 只装一次')

  // Manually opened root sessions rely on the guard because restrict never ran for them.
  guards[0]({ name: 'interrupt_agent', agent: { session: { id: 'root-as-retriever', header: { cwd: '/w' } }, ctx: { presetId: ROLE_PRESET_IDS.retriever } } })
  // Delegated calls also use the guard; visibility reduction alone is not enforcement.
  guards[0]({ name: 'interrupt_agent', agent: { session: { id: 'child-2', header: { parentSession: 'main-1' } }, ctx: { presetId: ROLE_PRESET_IDS.collector } } })
  // All identity guards share one probe channel so their denials are comparable.
  resetRootPolicyProbes()
  guards[0]({ name: 'interrupt_agent', agent: { session: { id: 'root-as-retriever', header: { cwd: '/w' } }, ctx: { presetId: ROLE_PRESET_IDS.retriever } } })
  guards[0]({ name: 'interrupt_agent', agent: { session: { id: 'child-2', header: { parentSession: 'main-1' } }, ctx: { presetId: ROLE_PRESET_IDS.collector } } })
  const probes = rootPolicyProbes()
  assert.deepEqual(probes.map((probe) => ({ id: probe.agentId, root: probe.root, outcome: probe.outcome, preset: probe.presetId, denied: probe.denied })), [
    { id: 'root-as-retriever', root: true, outcome: 'guard-denied', preset: ROLE_PRESET_IDS.retriever, denied: ['interrupt_agent'] },
    { id: 'child-2', root: false, outcome: 'guard-denied', preset: ROLE_PRESET_IDS.collector, denied: ['interrupt_agent'] },
  ], '两种会话形状都要留记录，且 root 必须照实（写死一个值就等于把两种失败混成一种）')
  assert.deepEqual(rolePolicyProbes(), [], 'guard 的拒绝不进 created 那条 restrict 通道：两条通道各说各的事')
  assert.doesNotThrow(() => {
    const noTools = { get: () => undefined, effect: (cb) => cb(), logger: { warn() {} } }
    registerRoleSiblingGuard(noTools)
  }, 'guard 面不可用不得挡装配路径')
})
