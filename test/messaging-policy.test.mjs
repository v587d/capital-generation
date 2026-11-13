import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isDirectChildName,
  registerSendMessageGuard,
  ROLE_MESSAGE_TARGETS,
  sendMessageGuardReasonFor,
  sendMessageTargetOf,
} from '../lib/agents/messaging-policy.js'
import { ROLE_PRESET_IDS } from '../lib/preset-ids.js'
import { resetRootPolicyProbes, rootPolicyProbes } from '../lib/agents/root-tool-policy.js'

// rc.2 lets any two members of one subagent tree message each other. Capital keeps the root as the
// relay: root -> direct child, leaf -> lead, specialist -> none. These are call-level denials because
// tool visibility cannot express "target name is a direct child".

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

test('主 Agent：只发直系 name；lead 与带 / 的孙 Agent 被拒', () => {
  const guard = sendMessageGuardReasonFor(ctxWith((agentCtx) => agentCtx?.preset))
  assert.equal(guard(call('capital-generation', 'data-collector')), undefined)
  assert.equal(guard(call('capital-generation', 'web-retriever')), undefined)
  assert.match(String(guard(call('capital-generation', 'lead'))), /直系子 Agent/)
  assert.match(String(guard(call('capital-generation', 'data-junior/chart-1'))), /直系子 Agent/)
})

test('叶子角色：只能发 lead；兄弟 / 孙 Agent 被拒', () => {
  const guard = sendMessageGuardReasonFor(ctxWith((agentCtx) => agentCtx?.preset))
  for (const preset of [ROLE_PRESET_IDS.collector, ROLE_PRESET_IDS.junior, ROLE_PRESET_IDS.retriever, ROLE_PRESET_IDS.analyst]) {
    assert.equal(guard(call(preset, 'lead')), undefined, `${preset} 发 lead 应放行`)
    assert.match(String(guard(call(preset, 'data-collector'))), /只能发给 `lead`/, `${preset} 不得发兄弟`)
    assert.match(String(guard(call(preset, 'data-junior/chart-1'))), /只能发给 `lead`/, `${preset} 不得发孙 Agent`)
  }
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
