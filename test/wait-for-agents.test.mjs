import { test } from 'node:test'
import assert from 'node:assert/strict'

import { waitForAgentsToolDefinition } from '../lib/agents/wait-for-agents.js'
import { assertToolOutput, collectUndeclaredRequired } from './output-contract.mjs'

// The tool is the root's ordering barrier: it must return on the first actionable relay, not only
// after the whole tree dies, or a collector's early dataset_ready would be serialized behind it.

const MAIN = { id: 'main-1', header: { cwd: '/workspace/proj' } }
const CHILD = { id: 'child-1', header: { cwd: '/workspace/proj', parentSession: MAIN.id, origin: 'subagent' } }

const notice = (childId = 'child-1') => ({
  id: `settled-${childId}`,
  source: { kind: 'subagent-settled', form: 'notice', senderSessionId: childId },
})
const relay = (childId = 'child-1') => ({
  id: `relay-${childId}`,
  source: { kind: 'agent-message', form: 'relay', senderSessionId: childId },
})
const human = (id = 'user-1') => ({ id, source: { kind: 'user' } })

function harness({ waitForChildren = async () => false, listDescendants = async () => [], waitSliceMs = 1_000, agents } = {}) {
  const nextTurn = []
  const nextStep = []
  const agent = { session: MAIN, inbox: { nextTurn, nextStep } }
  const listeners = new Map()
  const events = {
    on(name, listener) {
      listeners.set(name, listener)
      return () => { if (listeners.get(name) === listener) listeners.delete(name) }
    },
  }
  const waits = { calls: 0 }
  const definition = waitForAgentsToolDefinition({
    waitSliceMs,
    events,
    agents,
    subagents: () => ({
      waitForChildren(parent) {
        waits.calls += 1
        return waitForChildren(parent)
      },
      listDescendants,
    }),
  })
  return { agent, nextTurn, nextStep, events, listeners, waits, definition }
}

const exec = (agent, signal = new AbortController().signal) => ({ agent, signal })

test('等待工具：无子 Agent 时立即 all_settled，输出满足 schema 且不声明并发安全', async () => {
  const { agent, definition } = harness()
  const result = await definition.execute({}, exec(agent))

  assert.equal(result.status, 'all_settled')
  assert.equal(result.pending_messages, 0)
  assert.deepEqual(result.running, [])
  assert.ok(result.waited_ms >= 0)
  assert.match(result.hint, /对账/)
  assert.equal(definition.isConcurrencySafe, undefined, '等待是派发与收口之间的顺序屏障，不能声明并发安全')
  assert.equal(definition.parameters.type, 'object')
  assert.deepEqual(collectUndeclaredRequired(definition.output.schema), [])
  assertToolOutput(definition, result)
})

test('收到子 Agent relay：立即返回 message，消息留在 inbox 交给下一 step', async () => {
  const { agent, nextStep, listeners, definition } = harness({
    waitForChildren: () => new Promise(() => {}),
    listDescendants: async () => [{ kind: 'child', id: 'child-1', label: 'data_collector', activity: 'running' }],
  })
  const pending = definition.execute({}, exec(agent))
  assert.equal(typeof listeners.get('agent/inbox/inserted'), 'function', '等待期间必须接住新插入的消息')
  const message = relay()
  nextStep.push(message)
  listeners.get('agent/inbox/inserted')({ agent, message })

  const result = await pending
  assert.equal(result.status, 'message')
  assert.equal(result.pending_messages, 1)
  assert.deepEqual(result.running, [{ id: 'child-1', label: 'data_collector' }])
  assert.equal(nextStep.length, 1, '工具只观察 inbox，不得替宿主消费 relay')
  assert.equal(listeners.size, 0, '返回后必须移除本次等待的 inbox 监听器')
  assertToolOutput(definition, result)
})

test('只收到结算通知：不算可执行消息，子树收敛后 all_settled', async () => {
  const { agent, nextStep, definition } = harness()
  nextStep.push(notice())

  const result = await definition.execute({}, exec(agent))
  assert.equal(result.status, 'all_settled')
  assert.equal(result.pending_messages, 0)
  assert.equal(nextStep.length, 1, '结算通知留给收尾闸门，工具不在这里删')
})

test('等待期间用户插话：user_input 优先于子 Agent 消息', async () => {
  const { agent, nextStep, listeners, definition } = harness({
    waitForChildren: () => new Promise(() => {}),
  })
  const pending = definition.execute({}, exec(agent))
  const message = human()
  nextStep.push(message)
  listeners.get('agent/inbox/inserted')({ agent, message })

  const result = await pending
  assert.equal(result.status, 'user_input')
  assert.equal(result.pending_messages, 1)
})

test('等待片到期：timeout 列出仍存活的子 Agent，不冒充完成', async () => {
  const { agent, definition } = harness({
    waitSliceMs: 15,
    waitForChildren: () => new Promise(() => {}),
    listDescendants: async () => [
      { kind: 'child', id: 'child-1', label: 'data_collector', activity: 'running' },
      { kind: 'child', id: 'child-2', label: 'data_junior', activity: 'running' },
      { kind: 'diagnostic', id: 'bad-1', reason: 'unavailable' },
    ],
  })

  const result = await definition.execute({}, exec(agent))
  assert.equal(result.status, 'timeout')
  assert.equal(result.pending_messages, 0)
  assert.deepEqual(result.running.map((row) => row.id), ['child-1', 'child-2'])
  assert.match(result.hint, /未收敛/)
  assert.match(result.hint, /不要.*list_agents/)
  assert.match(result.hint, /不要 send_message/)
  assertToolOutput(definition, result)
})

test('调用前已有 relay：不启动等待，直接返回 message', async () => {
  const { agent, nextStep, waits, definition } = harness()
  nextStep.push(relay())

  const result = await definition.execute({}, exec(agent))
  assert.equal(result.status, 'message')
  assert.equal(waits.calls, 0, '已有可执行消息时不应先等 30 秒')
})

test('子 Agent 调用被拒绝：只允许主 Agent 等待自己的子树', async () => {
  const { definition } = harness()
  await assert.rejects(
    () => definition.execute({}, exec({ session: CHILD, inbox: { nextTurn: [], nextStep: [] } })),
    /只对主 Agent 开放/,
  )
})

test('用户 fork / branch（有 parentSession、无 subagent origin）仍被当作根会话', async () => {
  const fork = { session: { id: 'fork-1', header: { cwd: '/workspace/proj', parentSession: 'seed-1' } }, inbox: { nextTurn: [], nextStep: [] } }
  const { definition } = harness()
  const result = await definition.execute({}, exec(fork))
  assert.equal(result.status, 'all_settled')
})

test('缺少 subagents 服务：响亮失败，不静默返回 all_settled', async () => {
  const definition = waitForAgentsToolDefinition({ subagents: () => undefined })
  await assert.rejects(
    () => definition.execute({}, exec({ session: MAIN, inbox: { nextTurn: [], nextStep: [] } })),
    /subagents 服务未挂载/,
  )
})

test('取消信号会结束等待并移除 inbox 监听器', async () => {
  const { agent, listeners, definition } = harness({
    waitForChildren: () => new Promise(() => {}),
  })
  const controller = new AbortController()
  const pending = definition.execute({}, exec(agent, controller.signal))
  assert.equal(listeners.size, 1)
  controller.abort()

  await assert.rejects(pending, /aborted/)
  assert.equal(listeners.size, 0)
})

test('tools/orchestration 入口：把 ctx 的 inbox 插入事件接到等待工具', async () => {
  const tools = []
  const listeners = new Map()
  const nextStep = []
  const agent = { session: MAIN, inbox: { nextTurn: [], nextStep } }
  const ctx = {
    get(name) {
      if (name === 'tools') return { register(definition) { tools.push(definition); return () => {} } }
      if (name === 'subagents') {
        return { waitForChildren: () => new Promise(() => {}), listDescendants: async () => [] }
      }
      return undefined
    },
    on(name, listener) {
      listeners.set(name, listener)
      return () => { if (listeners.get(name) === listener) listeners.delete(name) }
    },
    effect(callback) { return callback() },
  }
  const entry = await import('../lib/orchestration-entry.js')
  entry.apply(ctx)
  assert.deepEqual(tools.map((definition) => definition.name), ['wait_for_agents'])

  const pending = tools[0].execute({}, exec(agent))
  const message = relay()
  nextStep.push(message)
  listeners.get('agent/inbox/inserted')({ agent, message })
  const result = await pending
  assert.equal(result.status, 'message')
  assert.equal(result.pending_messages, 1)
})
