import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAskPrompt,
  createAskService,
  extractAskOutcome,
  previewOf,
} from '../automation/ask.js'
import { createAutomationStore } from '../automation/store.js'
import { createFakeDomain, fakeContext } from './automation-harness.mjs'
import { tradingCalendar } from '../automation/calendar.js'

const NOW = Date.parse('2026-11-09T00:00:00Z')

function snapshot(events) {
  return { session: { id: 'session-ask' }, inheritedEventCount: 0, events }
}

function event(seq, type, data, time = NOW + seq * 1_000) {
  return { seq, type, time, data }
}

test('追问只取 baseline 之后的第一轮答复，旧简报文本不会被当成回答', () => {
  const outcome = extractAskOutcome(snapshot([
    event(4, 'assistant/message', { message: { content: [{ type: 'text', text: '旧的任务简报结论。' }] } }),
    event(5, 'turn/end', { reason: { kind: 'completed' } }),
    event(11, 'assistant/message', { message: { content: [{ type: 'text', text: '新回答：先看成交量，再看缺口。' }] } }),
    event(12, 'turn/end', { reason: { kind: 'completed' } }),
  ]), 10)
  assert.equal(outcome.status, 'ready')
  assert.match(outcome.preview, /新回答/)
  assert.doesNotMatch(outcome.preview, /旧的任务简报/)
})

test('追问中止 / 空文本 / 未结束三种收口', () => {
  const aborted = extractAskOutcome(snapshot([
    event(11, 'turn/end', { reason: { kind: 'aborted', reason: { kind: 'hook', reason: 'user_cancel' } } }),
  ]), 10)
  assert.equal(aborted.status, 'failed')
  assert.match(aborted.error, /中止/)

  const empty = extractAskOutcome(snapshot([
    event(11, 'turn/end', { reason: { kind: 'completed' } }),
  ]), 10)
  assert.equal(empty.status, 'failed')
  assert.match(empty.error, /没有返回文字/)

  assert.equal(extractAskOutcome(snapshot([
    event(11, 'assistant/message', { message: { content: [{ type: 'text', text: '还在生成…' }] } }),
  ]), 10), undefined)
})

test('预览是单行纯文本，长度不超过上限', () => {
  const preview = previewOf('## 标题\n\n- **结论**：先看 [成交量](https://example.com)。\n\n| 指标 | 值 |\n| --- | --- |\n| A | 1 |')
  assert.doesNotMatch(preview, /[#*|]/)
  assert.match(preview, /标题/)
  assert.match(previewOf('-1.8% 的跌幅'), /^-1\.8% 的跌幅/)
  const long = previewOf('字'.repeat(200))
  assert.ok(Array.from(long).length <= 160, '预览长度必须留在服务端声明上限内')
  assert.match(long, /…$/)
  assert.match(buildAskPrompt('成交量怎么看？'), /成交量怎么看？/)
})

function harness(options = {}) {
  let clock = NOW
  const fake = createFakeDomain()
  const store = createAutomationStore({
    openDomain: async () => fake.domain,
    profile: { name: 'web' },
    now: () => clock,
    calendar: tradingCalendar,
    random: () => `00000000-0000-4000-8000-${String(++randomId).padStart(12, '0')}`,
  })
  const prompts = []
  let randomId = 0
  const state = options.state ?? { cursor: 10, active: false, running: false, queue: [] }
  const controller = {
    async state(_request, signal) {
      signal?.throwIfAborted?.()
      return typeof state === 'function' ? state() : state
    },
    async prompt(request) {
      if (options.promptError !== undefined) throw options.promptError
      prompts.push(request)
      return { accepted: true }
    },
  }
  const query = {
    async readSession() {
      return options.snapshot ?? snapshot([
        event(11, 'assistant/message', { message: { content: [{ type: 'text', text: '先看成交量。' }] } }),
        event(12, 'turn/end', { reason: { kind: 'completed' } }),
      ])
    },
  }
  const { ctx } = fakeContext({ sessionController: controller, sessionQuery: query })
  const asks = createAskService({ ctx, store, now: () => clock, timeoutMs: 60_000 })
  return { store, asks, prompts, setNow: (value) => { clock = value } }
}

async function seededRun(store) {
  return store.createRun({
    taskId: 'task-ask',
    taskTitle: '每日复盘',
    trigger: 'manual',
    occurrenceKey: 'ask-test',
    status: 'succeeded',
    sessionId: 'session-ask',
  })
}

test('追问写入同一 session，完成后落成预览，查看更多用同一个 sessionId', async () => {
  const { store, asks, prompts } = harness()
  const run = await seededRun(store)
  const ask = await asks.ask(run.id, { question: '成交量怎么看？', timeZone: 'Asia/Shanghai' })
  assert.equal(ask.status, 'running')
  assert.equal(ask.sessionId, 'session-ask')
  assert.equal(prompts.length, 1)
  assert.match(prompts[0].content[0].text, /成交量怎么看？/)
  assert.equal(prompts[0].clientTimeZone, 'Asia/Shanghai')
  assert.equal(prompts[0].requestId, `ask-${ask.id}`)

  const resolved = await asks.status(ask.id)
  assert.equal(resolved.status, 'ready')
  assert.equal(resolved.preview, '先看成交量。')
  assert.equal((await store.getAsk(ask.id)).status, 'ready')
})

test('live 但空闲的 session 仍可追问（active 不等于 running）', async () => {
  const { store, asks, prompts } = harness({ state: { cursor: 10, active: true, running: false, queue: [] } })
  const run = await seededRun(store)
  const ask = await asks.ask(run.id, { question: 'live 空闲也要能问' })
  assert.equal(ask.status, 'running')
  assert.equal(prompts.length, 1)
  assert.equal((await asks.status(ask.id)).status, 'ready')
})

test('完整回答按需读取，不受 160 字预览限制', async () => {
  const full = `这是一段完整回答。${'细节'.repeat(120)}`
  const { store, asks } = harness({
    snapshot: snapshot([
      event(11, 'assistant/message', { message: { content: [{ type: 'text', text: full }] } }),
      event(12, 'turn/end', { reason: { kind: 'completed' } }),
    ]),
  })
  const run = await seededRun(store)
  const ask = await asks.ask(run.id, { question: '给我完整回答' })
  assert.equal((await asks.status(ask.id)).status, 'ready')
  const answer = await asks.answer(ask.id)
  assert.equal(answer.answer, full)
  assert.equal(answer.truncated, false)
  const pendingHarness = harness({ snapshot: snapshot([event(11, 'turn/start', { turn: 1 })]) })
  const pendingRun = await seededRun(pendingHarness.store)
  const pending = await pendingHarness.asks.ask(pendingRun.id, { question: '还没答完' })
  await assert.rejects(() => pendingHarness.asks.answer(pending.id), (error) => error.code === 'ask_not_ready')
})

test('旧版 80 字摘要读取时会补到当前上限，不要求用户重新提问', async () => {
  const full = `旧回答补长。${'细节'.repeat(100)}`
  const { store, asks } = harness({
    snapshot: snapshot([
      event(11, 'assistant/message', { message: { content: [{ type: 'text', text: full }] } }),
      event(12, 'turn/end', { reason: { kind: 'completed' } }),
    ]),
  })
  const run = await seededRun(store)
  const ask = await asks.ask(run.id, { question: '旧问题' })
  await store.updateAsk(ask.id, {
    status: 'ready',
    preview: '旧摘要…',
    finishedAt: '2026-11-09T00:01:00.000Z',
  })
  const refreshed = await asks.status(ask.id)
  assert.notEqual(refreshed.preview, '旧摘要…')
  assert.ok(Array.from(refreshed.preview).length > 80)
})

test('上一条还在回答、session 忙、prompt 未接受都响亮拒绝', async () => {
  const pendingHarness = harness({ snapshot: snapshot([event(11, 'turn/start', { turn: 1 })]) })
  const pendingRun = await seededRun(pendingHarness.store)
  const first = await pendingHarness.asks.ask(pendingRun.id, { question: '第一条' })
  await assert.rejects(
    () => pendingHarness.asks.ask(pendingRun.id, { question: '第二条' }),
    (error) => error.code === 'ask_pending' && error.status === 409,
  )
  assert.equal((await pendingHarness.asks.status(first.id)).status, 'running')

  const busyHarness = harness({ state: { cursor: 10, active: true, running: true, queue: [] } })
  const busyRun = await seededRun(busyHarness.store)
  await assert.rejects(
    () => busyHarness.asks.ask(busyRun.id, { question: '忙时提问' }),
    (error) => error.code === 'session_busy' && error.status === 409,
  )

  const failedHarness = harness({ promptError: new Error('模型拒绝了这次追问') })
  const failedRun = await seededRun(failedHarness.store)
  await assert.rejects(
    () => failedHarness.asks.ask(failedRun.id, { question: '会失败的问题' }),
    (error) => error.code === 'ask_failed' && error.status === 502,
  )
  assert.equal((await failedHarness.store.pendingAskForRun(failedRun.id)), undefined)
})

test('一直 running 的追问也会在超时后落成失败，不永远转圈', async () => {
  let running = false
  const { store, asks, setNow } = harness({
    state: () => ({ cursor: 10, active: true, running, queue: [] }),
    snapshot: snapshot([event(11, 'turn/start', { turn: 1 })]),
  })
  const run = await seededRun(store)
  const ask = await asks.ask(run.id, { question: '会一直跑吗？' })
  running = true
  setNow(NOW + 61_000)
  const expired = await asks.status(ask.id)
  assert.equal(expired.status, 'failed')
  assert.match(expired.error, /超时/)
})

test('超时未结束的追问落成失败，已结束的旧追问不重复读 session', async () => {
  const { store, asks, setNow } = harness({
    snapshot: snapshot([event(11, 'turn/start', { turn: 1 })]),
  })
  const run = await seededRun(store)
  const ask = await asks.ask(run.id, { question: '会不会超时？' })
  setNow(NOW + 61_000)
  const expired = await asks.status(ask.id)
  assert.equal(expired.status, 'failed')
  assert.match(expired.error, /超时/)
})
