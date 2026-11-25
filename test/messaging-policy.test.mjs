import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isDirectChildName,
  peerSendCount,
  PEER_BUDGET_DENIED,
  registerSendMessageGuard,
  ROLE_MESSAGE_TARGETS,
  ROLE_TREE_NAMES,
  sendMessageGuardReasonFor,
  sendMessageTargetOf,
} from '../lib/agents/messaging-policy.js'
import { ROLE_PRESET_IDS } from '../lib/preset-ids.js'
import { resetRootPolicyProbes, rootPolicyProbes } from '../lib/agents/root-tool-policy.js'

// The host lets any two members of one subagent tree message each other. Capital allows only the
// §5.2 adjacency table: root -> direct child, the peer edges listed there, specialist -> none.
// Targets are matched as strings because the guard cannot resolve names synchronously.

const ctxWith = (presetOf) => ({
  get(name) {
    if (name === 'agentPresets') return { composedPreset: (agentCtx) => presetOf(agentCtx) }
    return undefined
  },
})
const presetCtx = (preset) => ({ ctx: { preset } })
const call = (preset, target, extra = {}) => ({
  name: 'send_message',
  agent: presetCtx(preset),
  arguments: { agent: target, message: 'hello', ...extra },
})
/** Budget counting keys on the sender session, so peer-edge calls need one. */
const sessionCall = (preset, target, sessionId) => ({
  name: 'send_message',
  agent: { ctx: { preset }, session: { id: sessionId } },
  arguments: { agent: target, message: 'hello' },
})

test('目标读取：只认 send_message 的字符串 agent；缺参数交给宿主校验', () => {
  const exec = { name: 'send_message', arguments: { agent: 'data-collector', message: 'x' } }
  assert.equal(sendMessageTargetOf(exec), 'data-collector')
  assert.equal(sendMessageTargetOf({ name: 'send_message', arguments: {} }), undefined)
  assert.equal(sendMessageTargetOf({ name: 'send_message', arguments: { agent: '' } }), undefined)
  assert.equal(sendMessageTargetOf({ name: 'send_message', arguments: { agent: 42 } }), undefined)
  assert.equal(sendMessageTargetOf({ name: 'list_agents', arguments: { agent: 'x' } }), undefined)
})

test('直系名判定：无 `/` 且不是 `lead`', () => {
  assert.equal(isDirectChildName('data-collector'), true)
  assert.equal(isDirectChildName('agent-1'), true)
  assert.equal(isDirectChildName('6f1c2d9e-session-id'), true)
  assert.equal(isDirectChildName('lead'), false)
  assert.equal(isDirectChildName('data-junior/chart-1'), false)
})

test('邻接表：与设计 §5.2 逐边一致（唯一事实源）', () => {
  assert.deepEqual(ROLE_MESSAGE_TARGETS[ROLE_PRESET_IDS.collector], ['data-junior', 'senior-analyst', 'lead'])
  assert.deepEqual(ROLE_MESSAGE_TARGETS[ROLE_PRESET_IDS.junior], ['senior-analyst', 'lead'])
  assert.deepEqual(ROLE_MESSAGE_TARGETS[ROLE_PRESET_IDS.retriever], ['senior-analyst', 'lead'])
  assert.deepEqual(ROLE_MESSAGE_TARGETS[ROLE_PRESET_IDS.analyst], ['data-junior', 'lead'])
  assert.deepEqual(ROLE_MESSAGE_TARGETS[ROLE_PRESET_IDS.specialist], [])
  assert.deepEqual(ROLE_TREE_NAMES, {
    collector: 'data-collector',
    junior: 'data-junior',
    retriever: 'web-retriever',
    specialist: 'visualization-specialist',
    analyst: 'senior-analyst',
    lead: 'lead',
  })
})

test('主 Agent：只发直系 name；lead 与带 / 的孙 Agent 被拒', () => {
  const guard = sendMessageGuardReasonFor(ctxWith((agentCtx) => agentCtx?.preset))
  assert.equal(guard(call('capital-generation', 'data-collector')), undefined)
  assert.equal(guard(call('capital-generation', 'web-retriever')), undefined)
  assert.equal(guard(call('capital-generation', 'senior-analyst')), undefined)
  assert.match(String(guard(call('capital-generation', 'lead'))), /直系子 Agent/)
  assert.match(String(guard(call('capital-generation', 'data-junior/chart-1'))), /直系子 Agent/)
})

test('允许边：collector → junior / senior，junior 与 retriever → senior，analyst → junior，都可回 lead', () => {
  const guard = sendMessageGuardReasonFor(ctxWith((agentCtx) => agentCtx?.preset))
  const allowed = [
    [ROLE_PRESET_IDS.collector, 'data-junior'],
    [ROLE_PRESET_IDS.collector, 'senior-analyst'],
    [ROLE_PRESET_IDS.junior, 'senior-analyst'],
    [ROLE_PRESET_IDS.retriever, 'senior-analyst'],
    [ROLE_PRESET_IDS.analyst, 'data-junior', 'allowed-edge-analyst'],
  ]
  for (const [preset, target, sessionId] of allowed) {
    const result = sessionId === undefined ? guard(call(preset, target)) : guard(sessionCall(preset, target, sessionId))
    assert.equal(result, undefined, `${preset} → ${target} 应放行`)
  }
  for (const preset of [ROLE_PRESET_IDS.collector, ROLE_PRESET_IDS.junior, ROLE_PRESET_IDS.retriever, ROLE_PRESET_IDS.analyst]) {
    assert.equal(guard(call(preset, 'lead')), undefined, `${preset} 回 lead 必须放行`)
  }
})

test('禁止边：表外目标逐角色拒绝，拒语点名可用目标与范围闸门', () => {
  const guard = sendMessageGuardReasonFor(ctxWith((agentCtx) => agentCtx?.preset))
  // collector 只能到 junior / senior / lead：兄弟里剩下的是自己、retriever 与孙 Agent。
  assert.match(String(guard(call(ROLE_PRESET_IDS.collector, 'web-retriever'))), /只能发给 lead、data-junior 或 senior-analyst/)
  assert.match(String(guard(call(ROLE_PRESET_IDS.collector, 'data-collector'))), /新数据请求仍经 lead/)
  // junior 只能到 senior / lead：不能回头找 collector，也不能越过 lead 找 retriever。
  assert.match(String(guard(call(ROLE_PRESET_IDS.junior, 'data-collector'))), /只能发给 lead 或 senior-analyst/)
  assert.match(String(guard(call(ROLE_PRESET_IDS.junior, 'data-junior/chart-1'))), /其他兄弟与孙 Agent 经 lead/)
  // retriever 只能到 senior / lead，不能把证据直发 junior 或 collector。
  assert.match(String(guard(call(ROLE_PRESET_IDS.retriever, 'data-junior'))), /带来源的证据可直发 senior/)
  // senior：新数据/新检索必须经 lead（范围闸门）；孙 Agent 一律不在表内。
  assert.match(String(guard(call(ROLE_PRESET_IDS.analyst, 'data-collector'))), /新数据\/新检索经 lead/)
  assert.match(String(guard(call(ROLE_PRESET_IDS.analyst, 'web-retriever'))), /只有"用已有 Dataset\/profile 补计算"可直连 data-junior/)
  assert.match(String(guard(call(ROLE_PRESET_IDS.analyst, 'data-junior/chart-1'))), /只能发给 lead 或 data-junior/)
})

test('analyst → data-junior：同一会话最多 3 次，第 4 次被拒且不消耗到 lead', () => {
  const guard = sendMessageGuardReasonFor(ctxWith((agentCtx) => agentCtx?.preset))
  const session = 'budget-session-1'
  for (let round = 1; round <= 3; round += 1) {
    assert.equal(guard(sessionCall(ROLE_PRESET_IDS.analyst, 'data-junior', session)), undefined, `第 ${round} 次应放行`)
  }
  assert.equal(peerSendCount(session), 3)
  assert.match(String(guard(sessionCall(ROLE_PRESET_IDS.analyst, 'data-junior', session))), /3 次上限/)
  assert.equal(guard(sessionCall(ROLE_PRESET_IDS.analyst, 'lead', session)), undefined, '回 lead 不占 peer 预算')
  assert.equal(peerSendCount(session), 3, '被拒的发送不计入预算')
  // 另一个 senior 会话语义独立。
  assert.equal(guard(sessionCall(ROLE_PRESET_IDS.analyst, 'data-junior', 'budget-session-2')), undefined)
})

test('预算只属于 analyst 的出向 peer 边：collector → junior 不限次，且 peer 计数按会话隔离', () => {
  const guard = sendMessageGuardReasonFor(ctxWith((agentCtx) => agentCtx?.preset))
  const session = 'budget-session-collector'
  for (let round = 0; round < 6; round += 1) {
    assert.equal(guard(sessionCall(ROLE_PRESET_IDS.collector, 'data-junior', session)), undefined, 'collector 的 dataset_ready 不限次')
  }
  assert.equal(peerSendCount(session), 0)
  assert.equal(PEER_BUDGET_DENIED, '补计算往返已达 3 次上限：不要再向同行发请求，改用 analysis_blocked + peer_budget_exhausted 把未决缺口回给 lead 裁决。')
})

test('specialist：没有可发目标，lead 也拒', () => {
  const guard = sendMessageGuardReasonFor(ctxWith((agentCtx) => agentCtx?.preset))
  assert.deepEqual(ROLE_MESSAGE_TARGETS[ROLE_PRESET_IDS.specialist], [])
  assert.match(String(guard(call(ROLE_PRESET_IDS.specialist, 'lead'))), /不直接发消息/)
})

test('非 Capital / 认领不出身份：fail-open，不消耗别的 preset 的合法调用', () => {
  const guard = sendMessageGuardReasonFor(ctxWith((agentCtx) => agentCtx?.preset))
  assert.equal(guard(call('standard', 'anything')), undefined)
  assert.equal(guard(call(undefined, 'anything')), undefined)
  const blind = sendMessageGuardReasonFor({ get: () => undefined })
  assert.equal(blind(call('capital-generation', 'lead')), undefined, 'registry 缺失时不许误伤')
})

test('安装：每个 root 只装一次；拒绝会写 dc_status 现场；guard 不可用不外抛', () => {
  resetRootPolicyProbes()
  const guards = []
  const listeners = []
  const root = { on(event) { listeners.push(event); return () => {} } }
  const ctx = {
    root,
    get(name) {
      if (name === 'agentPresets') return { composedPreset: (agentCtx) => agentCtx?.preset }
      if (name === 'tools') return { guard: (guard) => { guards.push(guard); return () => {} } }
      return undefined
    },
    effect(callback) { return callback() },
    logger: { warn() {} },
  }
  registerSendMessageGuard(ctx)
  registerSendMessageGuard(ctx)
  assert.equal(guards.length, 1, '同一 root 只装一次')
  assert.deepEqual(listeners, [], 'send_message guard 不按 agent/created 安装')

  assert.match(String(guards[0](call('capital-generation', 'lead'))), /直系子 Agent/)
  const probes = rootPolicyProbes()
  assert.equal(probes.length, 1)
  assert.equal(probes[0].outcome, 'guard-denied')
  assert.deepEqual(probes[0].denied, ['send_message'])

  assert.doesNotThrow(() => registerSendMessageGuard({
    get: (name) => name === 'tools' ? { guard: () => { throw new Error('boom') } } : undefined,
  }))
})
