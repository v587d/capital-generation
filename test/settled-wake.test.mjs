import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSettledWakeGuard } from '../lib/agents/settled-wake.js'

// The host loop treats every inbox message as work. A settlement notice that arrives while the
// closing answer streams must be removed before the loop claims it; otherwise step 2's full answer
// is folded and the short step-3 "done" text becomes the visible last message.

const MAIN = { id: 'main-1', header: { cwd: '/workspace/proj' } }
const CHILD = { id: 'child-1', header: { cwd: '/workspace/proj', parentSession: MAIN.id, origin: 'subagent' } }

const notice = (childId = 'child-1', id = 'settled-1') => ({
  id,
  source: { kind: 'subagent-settled', senderSessionId: childId },
})

const agentMessage = (childId = 'child-1') => ({
  kind: 'agent-message',
  senderSessionId: childId,
})

function harness() {
  const nextTurn = []
  const nextStep = []
  const removed = []
  let removeResult = true
  const agent = {
    session: MAIN,
    inbox: {
      get nextTurn() { return nextTurn },
      get nextStep() { return nextStep },
      remove(id) {
        if (!removeResult) return false
        for (const list of [nextStep, nextTurn]) {
          const index = list.findIndex((message) => message.id === id)
          if (index < 0) continue
          list.splice(index, 1)
          removed.push(id)
          return true
        }
        return false
      },
    },
  }
  return {
    agent,
    nextTurn,
    nextStep,
    removed,
    setRemoveResult: (value) => { removeResult = value },
  }
}

test('收尾帧撤掉冗余结算通知：该 child 已有 admitted 的 agent-message', () => {
  const { agent, nextStep, removed } = harness()
  const guard = createSettledWakeGuard()
  nextStep.push(notice())

  guard.acceptUserMessage(MAIN, agentMessage())
  guard.acceptClosing(agent)

  assert.deepEqual(removed, ['settled-1'], '通知只重复“它结束了”，必须在 loop claim 前移除')
  assert.equal(nextStep.length, 0)
  assert.equal(guard.closing(), true)
  assert.deepEqual(guard.admitted(), [], '结算后清掉该 child 的 exchange marker')
})

test('该 child 从没发过消息：保留通知（它可能是唯一结果/失败信号）', () => {
  const { agent, nextStep, removed } = harness()
  const guard = createSettledWakeGuard()
  nextStep.push(notice())

  guard.acceptUserMessage(MAIN, { kind: 'user' })
  guard.acceptClosing(agent)

  assert.deepEqual(removed, [])
  assert.equal(nextStep.length, 1)
})

test('该 child 的消息还只是 pending、没有 admitted：保留通知', () => {
  const { agent, nextStep, removed } = harness()
  const guard = createSettledWakeGuard()
  nextStep.push(notice())

  // An inserted agent-message is not admitted until it becomes a user/message event.
  guard.acceptUserMessage(MAIN, { kind: 'user' })
  guard.acceptClosing(agent)

  assert.deepEqual(removed, [])
  assert.equal(nextStep.length, 1)
})

test('收尾后才插入的通知：立即移除，不再开一步', () => {
  const { agent, nextStep, removed } = harness()
  const guard = createSettledWakeGuard()

  guard.acceptUserMessage(MAIN, agentMessage())
  guard.acceptClosing(agent)
  assert.deepEqual(removed, [], '收尾时没有 pending 通知')

  nextStep.push(notice())
  guard.acceptInboxInserted(agent, nextStep[0])

  assert.deepEqual(removed, ['settled-1'])
  assert.equal(nextStep.length, 0)
})

test('收尾前插入的通知：不动，等真正的收尾帧再判断', () => {
  const { agent, nextStep, removed } = harness()
  const guard = createSettledWakeGuard()

  guard.acceptUserMessage(MAIN, agentMessage())
  nextStep.push(notice())
  guard.acceptInboxInserted(agent, nextStep[0])

  assert.deepEqual(removed, [])
  assert.equal(nextStep.length, 1)
})

test('人类消息开始新 exchange：旧 marker 清空，晚到的通知保留', () => {
  const { agent, nextStep, removed } = harness()
  const guard = createSettledWakeGuard()

  guard.acceptUserMessage(MAIN, agentMessage())
  guard.acceptUserMessage(MAIN, { kind: 'user' })
  guard.acceptClosing(agent)
  nextStep.push(notice())
  guard.acceptInboxInserted(agent, nextStep[0])

  assert.deepEqual(removed, [])
  assert.equal(nextStep.length, 1)
})

test('同一 child 新 activation 清掉旧 marker：不能拿上一次的回传当本次结果', () => {
  const { agent, nextStep, removed } = harness()
  const guard = createSettledWakeGuard()

  guard.acceptUserMessage(MAIN, agentMessage())
  guard.acceptSubagentStart({ id: 'child-1' })
  nextStep.push(notice())
  guard.acceptClosing(agent)

  assert.deepEqual(removed, [])
  assert.equal(nextStep.length, 1)
})

test('child 自己的 user/message 不污染 root 状态', () => {
  const { agent, nextStep, removed } = harness()
  const guard = createSettledWakeGuard()

  guard.acceptUserMessage(CHILD, { kind: 'user' })
  guard.acceptUserMessage(MAIN, agentMessage())
  guard.acceptClosing(agent)
  nextStep.push(notice())
  guard.acceptInboxInserted(agent, nextStep[0])

  assert.deepEqual(removed, ['settled-1'], 'child 事件不能清掉 root 的 admitted marker')
})

test('移除失败不推进状态：下一次收尾还能重试', () => {
  const { agent, nextStep, removed, setRemoveResult } = harness()
  const guard = createSettledWakeGuard()
  nextStep.push(notice())

  guard.acceptUserMessage(MAIN, agentMessage())
  setRemoveResult(false)
  guard.acceptClosing(agent)
  assert.deepEqual(removed, [], 'inbox.remove 失败时不能假装已处理')
  assert.equal(nextStep.length, 1)
  assert.deepEqual(guard.admitted(), ['child-1'], '失败时必须保留 marker，下一次才能重试')

  setRemoveResult(true)
  guard.acceptClosing(agent)
  assert.deepEqual(removed, ['settled-1'])
  assert.equal(nextStep.length, 0)
})
