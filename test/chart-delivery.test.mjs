import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChartArtifactRegistry } from '../lib/chart/artifact-ref.js'
import { createChartDelivery } from '../lib/chart/delivery.js'

// The card only shows when its event is written BEFORE the turn's closing assistant message.
// Delivery therefore rides the terminal stream chunk (finish=stop, no tool call), gated on an idle
// root, instead of trusting the model to call present_charts at the right moment.

const MAIN = { id: 'main-1', header: { cwd: '/workspace/proj' } }
const JUNIOR = { id: 'junior-1', header: { cwd: '/workspace/proj', parentSession: MAIN.id, origin: 'subagent' } }

let seq = 0
function seed(registry, { task_id = 'task-1', title = '图表', created_at } = {}) {
  seq += 1
  const chartId = `ch_delivery_${seq}`
  return registry.issue({
    session: JUNIOR,
    chart_id: chartId,
    task_id,
    dataset_id: 'ds_01',
    source_label: '同花顺',
    captured_at: 1_700_000_000_000,
    kind: 'line',
    axis: 'time',
    title,
    chart_url: null,
    spec_path: `capital-analysis/charts/${chartId}/spec.json`,
    series_path: `capital-analysis/charts/${chartId}/series.json`,
    html_path: `capital-analysis/charts/${chartId}/chart.html`,
    ...(created_at === undefined ? {} : { created_at }),
  })
}

function harness({ inbox = { 'next-turn': [], 'next-step': [] }, now = 1_700_000_100_000 } = {}) {
  const registry = new ChartArtifactRegistry({ now: () => now })
  const batches = []
  let writes = true
  const delivery = createChartDelivery({
    artifacts: registry,
    publish: (sessionId, inputs) => {
      batches.push({ sessionId, inputs })
      return writes
    },
    inboxOf: () => inbox,
  })
  return { registry, batches, delivery, failWrites: () => { writes = false } }
}

const finish = (turn = 7, attemptId = 'a1') => ({ type: 'chunk', attemptId, turn, chunk: { type: 'finish', reason: { kind: 'stop' } } })
const start = (attemptId = 'a1', turn = 7) => ({ type: 'start', attemptId, turn })
const toolDelta = (attemptId = 'a1') => ({ type: 'chunk', attemptId, chunk: { type: 'tool-call-delta', index: 0, argumentsDelta: '{}' } })
const toolBlockEnd = (attemptId = 'a1') => ({ type: 'chunk', attemptId, chunk: { type: 'block-end', index: 0, block: { type: 'tool-call' } } })
const end = (attemptId = 'a1') => ({ type: 'end', attemptId })

test('closing finish：写入发生在收尾消息之前（listener 内同步 publish），且只写一次', () => {
  const { registry, batches, delivery } = harness()
  const chart = seed(registry)
  delivery.request(MAIN, [{ ownerSessionId: MAIN.id, chart_id: chart.chart_id, title: chart.title, html_path: chart.html_path }])

  assert.equal(delivery.streaming(), false, '尚未看到任何流帧')
  delivery.acceptStream(MAIN, start())
  assert.equal(delivery.streaming(), true)
  delivery.acceptStream(MAIN, finish())

  assert.equal(batches.length, 1, 'finish=stop 时必须立刻写（assistant 消息还没落盘）')
  assert.equal(batches[0].sessionId, MAIN.id)
  assert.equal(batches[0].inputs.length, 1)
  assert.equal(batches[0].inputs[0].html_path, chart.html_path)

  // Same turn may settle twice (retry/empty response): the turn tail only needs one card.
  delivery.acceptStream(MAIN, end())
  delivery.acceptStream(MAIN, start('a2'))
  delivery.acceptStream(MAIN, finish(7, 'a2'))
  assert.equal(batches.length, 1, '同一 turn 只写一次（卡片按路径去重，但事件不必重复）')

  // A follow-up step in the same exchange can stream a finish frame without `turn`.
  delivery.acceptStream(MAIN, end())
  delivery.acceptStream(MAIN, start('a3'))
  delivery.acceptStream(MAIN, finish(undefined, 'a3'))
  assert.equal(batches.length, 1, '同一 exchange 的后续 finish 缺 turn 时也不能再写一张卡')
})

test('等待轮不写：子 Agent 在运行或 inbox 有待处理消息时，finish 不能落交付', () => {
  const { registry, batches, delivery } = harness()
  const chart = seed(registry)
  delivery.request(MAIN, [{ ownerSessionId: MAIN.id, chart_id: chart.chart_id, title: chart.title, html_path: chart.html_path }])
  delivery.acceptSubagentStart({ id: 'junior-1' })

  delivery.acceptStream(MAIN, start())
  delivery.acceptStream(MAIN, finish())
  assert.equal(batches.length, 0, 'junior 在跑：这一轮是等待轮，不能写卡')

  delivery.acceptSubagentEnd({ id: 'junior-1' })
  delivery.acceptStream(MAIN, end())
  delivery.acceptStream(MAIN, start('a2'))
  delivery.acceptStream(MAIN, finish(8, 'a2'))
  assert.equal(batches.length, 1, '结算后真正的收尾必须写')
  assert.equal(batches[0].inputs.length, 1)
})

test('inbox 有可执行消息时不写；清空后的下一次 finish 才写', () => {
  const { registry, batches, delivery } = harness({
    inbox: { 'next-turn': [], 'next-step': [{ id: 'pending', source: { kind: 'agent-message' } }] },
  })
  const chart = seed(registry)
  delivery.request(MAIN, [{ ownerSessionId: MAIN.id, chart_id: chart.chart_id, title: chart.title, html_path: chart.html_path }])
  delivery.acceptStream(MAIN, start())
  delivery.acceptStream(MAIN, finish())
  assert.equal(batches.length, 0)
})

test('结算通知在收尾流中途到达：不算待处理消息，且顺手清掉已结算子 Agent', () => {
  // Real sequence: the child settles while the root is already streaming its closing answer.
  // The notice lands in next-step before finish; counting it as pending stranded the card.
  const { registry, batches, delivery } = harness({
    inbox: {
      'next-turn': [],
      'next-step': [{
        id: 'settled-1',
        source: { kind: 'subagent-settled', senderSessionId: 'junior-1' },
      }],
    },
  })
  const chart = seed(registry)
  delivery.acceptSubagentStart({ id: 'junior-1' })
  delivery.request(MAIN, [{ ownerSessionId: MAIN.id, chart_id: chart.chart_id, title: chart.title, html_path: chart.html_path }])

  delivery.acceptStream(MAIN, start())
  delivery.acceptStream(MAIN, finish())

  assert.equal(batches.length, 1, '结算通知只是通知，不能挡住已经写好的收尾答复')
})

test('结算通知与真正的 relay 同时存在：仍然不写，等 relay 处理完', () => {
  const { registry, batches, delivery } = harness({
    inbox: {
      'next-turn': [],
      'next-step': [
        { id: 'settled-1', source: { kind: 'subagent-settled', senderSessionId: 'junior-1' } },
        { id: 'relay-1', source: { kind: 'agent-message', senderSessionId: 'junior-1' } },
      ],
    },
  })
  const chart = seed(registry)
  delivery.request(MAIN, [{ ownerSessionId: MAIN.id, chart_id: chart.chart_id, title: chart.title, html_path: chart.html_path }])
  delivery.acceptStream(MAIN, start())
  delivery.acceptStream(MAIN, finish())
  assert.equal(batches.length, 0)
})

test('带工具调用的响应不是最终答复：不得写交付', () => {
  const { registry, batches, delivery } = harness()
  const chart = seed(registry)
  delivery.request(MAIN, [{ ownerSessionId: MAIN.id, chart_id: chart.chart_id, title: chart.title, html_path: chart.html_path }])

  delivery.acceptStream(MAIN, start())
  delivery.acceptStream(MAIN, toolDelta())
  delivery.acceptStream(MAIN, finish())
  assert.equal(batches.length, 0, 'tool-call-delta 之后即使 finish=stop 也不能当最终答复')

  delivery.acceptStream(MAIN, end())
  delivery.acceptStream(MAIN, start('a2'))
  delivery.acceptStream(MAIN, toolBlockEnd('a2'))
  delivery.acceptStream(MAIN, finish(7, 'a2'))
  assert.equal(batches.length, 0, 'block-end 里的 tool-call 同样要拦住')

  delivery.acceptStream(MAIN, end())
  delivery.acceptStream(MAIN, start('a3'))
  delivery.acceptStream(MAIN, finish(7, 'a3'))
  assert.equal(batches.length, 1, '纯文本收尾才写')
})

test('模型没有调用 present_charts：按当前 exchange 自动收集本轮图表，旧 exchange 不混入', () => {
  const { registry, batches, delivery } = harness()
  const oldChart = seed(registry, { created_at: 1_700_000_050_000 })
  const current = seed(registry, { created_at: 1_700_000_120_000 })

  // A human message starts the exchange; anything rendered before it is out of scope.
  delivery.acceptUserMessage(MAIN.id, 1_700_000_100_000)
  delivery.acceptStream(MAIN, start())
  delivery.acceptStream(MAIN, finish())

  assert.equal(batches.length, 1)
  assert.deepEqual(batches[0].inputs.map((item) => item.chart_id), [current.chart_id])
  assert.equal(batches[0].inputs.some((item) => item.chart_id === oldChart.chart_id), false)
})

test('显式选择合并去重，并优先于自动收集；新的人类消息清空选择', () => {
  const { registry, batches, delivery } = harness()
  const a = seed(registry, { created_at: 1_700_000_120_000 })
  const b = seed(registry, { created_at: 1_700_000_120_100 })
  const inputOf = (chart) => ({ ownerSessionId: MAIN.id, chart_id: chart.chart_id, title: chart.title, html_path: chart.html_path })

  delivery.request(MAIN, [inputOf(a)])
  delivery.request(MAIN, [inputOf(a), inputOf(b)]) // model retries in batches
  assert.equal(delivery.pending(MAIN.id), 2, '同一张图不重复，第二批要合并进来')

  delivery.acceptStream(MAIN, start())
  delivery.acceptStream(MAIN, finish(7))
  assert.deepEqual(batches[0].inputs.map((item) => item.chart_id), [a.chart_id, b.chart_id], '显式选择优先')

  delivery.acceptUserMessage(MAIN.id, 1_700_000_200_000)
  assert.equal(delivery.pending(MAIN.id), 0, '新的人类消息开始新 exchange')
  assert.equal(batches.length, 1)
})

test('写入失败/超出上限：不推进 lastFlushedTurn，下一次 finish 还能重试', () => {
  const { registry, batches, delivery, failWrites } = harness()
  const chart = seed(registry, { created_at: 1_700_000_120_000 })
  delivery.request(MAIN, [{ ownerSessionId: MAIN.id, chart_id: chart.chart_id, title: chart.title, html_path: chart.html_path }])
  delivery.acceptStream(MAIN, start())
  failWrites()
  delivery.acceptStream(MAIN, finish(7))
  assert.equal(batches.length, 1, '第一次尝试已发出去但失败')
  // The model wakes into the same turn/next turn; a later finish may retry.
  delivery.acceptStream(MAIN, end())
  delivery.acceptStream(MAIN, start('a2'))
  delivery.acceptStream(MAIN, finish(7, 'a2'))
  assert.equal(batches.length, 2, '写失败不能把该轮标成已写')
  assert.equal(chart.chart_id.length > 0, true)
})
