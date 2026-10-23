import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChartArtifactRegistry } from '../lib/chart/artifact-ref.js'
import { resetChartEventPending, resetChartEventPublisher } from '../lib/chart/events.js'
import * as presentEntry from '../lib/present-entry.js'

// Wiring test: the row must feed assistant-stream frames into the delivery manager, and the actual
// event must be written by the closing finish frame (not by the present_charts tool call).

const MAIN = { id: 'main-1', header: { cwd: '/workspace/proj' } }
const JUNIOR = { id: 'junior-1', header: { cwd: '/workspace/proj', parentSession: MAIN.id, origin: 'subagent' } }

test('tools/present：present_charts 记录清单，收尾 finish 帧才写官方交付事件', async () => {
  resetChartEventPublisher()
  resetChartEventPending()
  try {
    const main = {
      id: MAIN.id,
      header: MAIN.header,
      appended: [],
      append(type, data) { this.appended.push({ type, data }); return { type, seq: this.appended.length, data } },
    }
    const registry = new ChartArtifactRegistry({ now: () => 1_700_000_000_000 })
    const chart = registry.issue({
      session: JUNIOR,
      chart_id: 'ch_entry_1',
      task_id: 'task-1',
      dataset_id: 'ds_01',
      source_label: '同花顺',
      captured_at: 1_700_000_000_000,
      kind: 'line',
      axis: 'time',
      title: '营收趋势',
      chart_url: null,
      spec_path: 'capital-analysis/charts/ch_entry_1/spec.json',
      series_path: 'capital-analysis/charts/ch_entry_1/series.json',
      html_path: 'capital-analysis/charts/ch_entry_1/chart.html',
    })
    const listeners = new Map()
    const tools = []
    const ctx = {
      get(name) {
        if (name === 'tools') return { register(definition) { tools.push(definition); return () => {} } }
        if (name === 'sessions') return { get: (id) => (id === MAIN.id ? main : undefined) }
        if (name === 'sessionProjections') {
          return {
            stateOf: (_session, key) => key === 'inbox'
              ? { 'next-turn': [], 'next-step': [] }
              : key === 'turnBoundary' ? { openTurnStartSeq: 1, lastTurn: 5 } : undefined,
          }
        }
        if (name === 'capitalChartRuntime') return { artifacts: registry, sourceTokens: {} }
        return undefined
      },
      on(event, listener) { listeners.set(event, listener); return () => {} },
      effect(callback) { const dispose = callback(); return () => { if (typeof dispose === 'function') dispose() } },
    }
    presentEntry.apply(ctx)
    const tool = tools.find((definition) => definition.name === 'present_charts')
    assert.ok(tool, 'present_charts 必须注册')
    assert.ok(typeof listeners.get('agent/assistant-stream') === 'function', '必须订阅 assistant-stream')
    assert.ok(typeof listeners.get('subagent/start') === 'function', '必须跟踪子 Agent 启动')
    assert.ok(typeof listeners.get('subagent/end') === 'function', '必须跟踪子 Agent 结束')

    const stream = listeners.get('agent/assistant-stream')
    stream({ agent: { session: main }, frame: { type: 'start', attemptId: 'a1', turn: 5 } })
    const receipt = await tool.execute(
      { chart_refs: [chart.chart_ref] },
      { agent: { session: main }, signal: new AbortController().signal },
    )
    assert.deepEqual(receipt.presented.map((item) => item.chart_ref), [chart.chart_ref])
    assert.equal(main.appended.length, 0, '工具调用阶段不能写事件（那时还不知道这是不是收尾轮）')

    // A settlement notice is authoritative even if subagent/end was missed or out of scope.
    listeners.get('subagent/start')({ id: 'junior-1' })
    const sessionEvent = listeners.get('session/event')
    assert.ok(typeof sessionEvent === 'function', '必须订阅 session/event 以对账结算通知')
    sessionEvent(main, {
      type: 'user/message',
      time: 1_700_000_000_100,
      data: { source: { kind: 'subagent-settled', senderSessionId: 'junior-1' } },
    })

    stream({ agent: { session: main }, frame: { type: 'chunk', attemptId: 'a1', turn: 5, chunk: { type: 'finish', reason: { kind: 'stop' } } } })

    assert.equal(main.appended.length, 1, '收尾 finish 帧必须写入交付事件')
    assert.equal(main.appended[0].type, 'deliverables/presented')
    assert.equal(main.appended[0].data.turn, 5)
    assert.equal(main.appended[0].data.files[0].path, chart.html_path)
    assert.equal(main.appended[0].data.files[0].description, '营收趋势')
  } finally {
    resetChartEventPublisher()
    resetChartEventPending()
  }
})
