import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHART_RENDERED_EVENT,
  MAX_CHARTS_PER_TURN,
  buildChartEventPayload,
  createChartEventPublisher,
  resolveOwnerSession,
  sanitizeEventWarnings,
} from '../lib/chart/events.js'

/**
 * 「图表 → 对话流」事件通道的契约测试。
 *
 * 这套设计的边界全在这里钉住：
 *  - 事件必须落在**根会话**（用户在看的那条），turn 取自 turnBoundary 投影；
 *  - 事件不是 surface 事件、payload 只有元数据 —— 没有 rows / series / 绝对路径；
 *  - 通道是**可选**的：服务缺失、turn 缺失、写入抛错都只降级，绝不影响出图。
 */

/** 最小会话：append 记录事件，header 决定它在委派树里的位置。 */
function fakeSession(id, parentSession) {
  const appended = []
  return {
    id,
    header: parentSession === undefined ? { cwd: '/w' } : { cwd: '/w', parentSession },
    appended,
    append(type, data) { appended.push({ type, data }); return { type, seq: appended.length - 1, data } },
  }
}

function fakeCtx({ sessions, projections, logger } = {}) {
  const services = new Map()
  if (sessions !== undefined) services.set('sessions', sessions)
  if (projections !== undefined) services.set('sessionProjections', projections)
  return {
    get: (name) => services.get(name),
    logger,
  }
}

/** 带事件监听能力的 ctx：root 监听器由测试手动触发（模拟 owner 的 turn/start）。 */
function fakeEventCtx({ sessions, projections, logger } = {}) {
  const listeners = []
  const disposed = []
  const root = {
    on: (event, listener) => { listeners.push({ event, listener }); return () => { disposed.push(event) } },
  }
  const ctx = {
    get: (name) => {
      if (name === 'sessions') return sessions
      if (name === 'sessionProjections') return projections
      return undefined
    },
    on: (event, listener) => { listeners.push({ event, listener }); return () => {} },
    effect: (callback) => { const dispose = callback(); return () => { if (typeof dispose === 'function') dispose() } },
    root,
    logger,
  }
  return { ctx, listeners, disposed }
}

const baseInput = {
  ownerSessionId: 'main-1',
  chart_id: 'ch_1',
  chart_ref: 'chart_1',
  title: '趋势',
  kind: 'line',
  axis: 'time',
  points: 43,
  chart_url: '/capital-charts/ch_1.json',
  html_path: 'capital-analysis/charts/ch_1/chart.html',
  source_label: 'fuyao',
  captured_at: 1_789_000_000_000,
  task_id: 'task-1',
  warnings: ['跨数据集归一化对照被拒绝'],
}

test('resolveOwnerSession：从 owner scope 向上走到根会话', () => {
  const main = fakeSession('main-1')
  const junior = fakeSession('junior-1', 'main-1')
  const specialist = fakeSession('spec-1', 'junior-1')
  const sessions = { get: (id) => ({ 'main-1': main, 'junior-1': junior, 'spec-1': specialist })[id] }
  assert.equal(resolveOwnerSession(sessions, 'spec-1').id, 'main-1', '三层委派必须落到根会话')
  assert.equal(resolveOwnerSession(sessions, 'junior-1').id, 'main-1')
  assert.equal(resolveOwnerSession(sessions, 'main-1').id, 'main-1')
  assert.equal(resolveOwnerSession(sessions, 'missing'), undefined)
})

test('buildChartEventPayload：只带元数据，且绝不携带 rows / series / 绝对路径', () => {
  const payload = buildChartEventPayload(baseInput, 6)
  assert.equal(payload.turn, 6)
  assert.equal(payload.chart_id, 'ch_1')
  assert.equal(payload.chart_url, '/capital-charts/ch_1.json')
  assert.equal(payload.html_path, 'capital-analysis/charts/ch_1/chart.html')
  const text = JSON.stringify(payload)
  assert.equal(/rows|series|"data"|item\[\]/.test(text), false, '事件不得携带数据行/序列')
  assert.equal(text.includes('/home/'), false, '事件不得携带绝对路径')
})

test('sanitizeEventWarnings：只留字符串、截断并限量', () => {
  const warnings = sanitizeEventWarnings([1, null, 'a', 'x'.repeat(500), 'b', 'c', 'd'])
  assert.equal(warnings.length, 3)
  assert.equal(warnings[0], 'a')
  assert.equal(warnings[1].length, 200)
})

test('createChartEventPublisher：服务缺失时返回 undefined（可选通道）', () => {
  assert.equal(createChartEventPublisher(fakeCtx({})), undefined)
  assert.equal(createChartEventPublisher(fakeCtx({ sessions: { get: () => undefined } })), undefined)
  assert.equal(
    createChartEventPublisher(fakeCtx({ sessions: { get: () => undefined }, projections: {} })),
    undefined,
    'projections 缺 stateOf 时同样不可用',
  )
})

test('publish：事件写进根会话的当前 turn，并被同 turn 上限拦住', () => {
  const main = fakeSession('main-1')
  const junior = fakeSession('junior-1', 'main-1')
  const sessions = { get: (id) => ({ 'main-1': main, 'junior-1': junior })[id] }
  const visited = []
  const projections = { stateOf: (session) => { visited.push(session.id); return { openTurnStartSeq: 99, lastTurn: 6 } } }
  const publisher = createChartEventPublisher(fakeCtx({ sessions, projections }))
  assert.ok(publisher)

  assert.equal(publisher.publish({ ...baseInput, ownerSessionId: 'junior-1' }), true)
  assert.equal(main.appended.length, 1)
  assert.equal(junior.appended.length, 0, '事件必须落在根会话，而不是发起出图的那条会话')
  assert.equal(main.appended[0].type, CHART_RENDERED_EVENT)
  assert.equal(main.appended[0].data.turn, 6)
  assert.equal(visited.includes('main-1'), true, 'turn 必须读根会话的 turnBoundary')

  // 上限按**解析后的 owner** 计：从 junior 发起的那张图也落在 main 的 (会话, turn) 桶里。
  // 已有 1 张 → 再补 MAX-1 张刚好到顶。
  for (let index = 1; index < MAX_CHARTS_PER_TURN; index += 1) {
    assert.equal(publisher.publish({ ...baseInput, chart_id: `ch_${index}` }), true)
  }
  assert.equal(main.appended.length, MAX_CHARTS_PER_TURN)
  assert.equal(publisher.publish({ ...baseInput, chart_id: 'ch_overflow' }), false, '超过同 turn 上限后跳过')
  assert.equal(main.appended.length, MAX_CHARTS_PER_TURN)
})

test('publish：回合之间出图先寄存，等 owner 的下一个 turn/start 才写入', async () => {
  const main = fakeSession('main-1')
  const sessions = { get: (id) => (id === 'main-1' ? main : undefined) }
  // 关键场景（2026-09-17 实测）：主 Agent 结束回合等子 Agent，出图时 openTurnStartSeq === null，
  // 此时 lastTurn 指向**已经结束**的回合，照抄它会把卡片挂到上一轮。
  let boundary = { openTurnStartSeq: null, lastTurn: 4 }
  const { ctx, listeners } = fakeEventCtx({ sessions, projections: { stateOf: () => boundary } })
  const publisher = createChartEventPublisher(ctx)
  assert.ok(publisher)

  assert.equal(publisher.publish(baseInput), true, '寄存也算受理')
  assert.equal(main.appended.length, 0, '回合没打开时不得直接写入')
  assert.equal(publisher.pendingCount('main-1'), 1)

  // owner 打开下一回合（turn 5）→ 微任务里冲刷，写入 turn 5
  boundary = { openTurnStartSeq: 200, lastTurn: 5 }
  const turnStart = listeners.find((entry) => entry.event === 'session/event')
  assert.ok(turnStart, '必须监听 session/event 才能等到下一个 turn/start')
  turnStart.listener({ id: 'main-1' }, { type: 'turn/start', data: { turn: 5 } })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  await new Promise((resolve) => { queueMicrotask(resolve) })

  assert.equal(main.appended.length, 1, '寄存的图表必须在新回合写入')
  assert.equal(main.appended[0].data.turn, 5)
  assert.equal(publisher.pendingCount(), 0)

  // 与本次 turn/start 无关的会话不触发任何写入
  turnStart.listener({ id: 'other-session' }, { type: 'turn/start', data: { turn: 9 } })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  assert.equal(main.appended.length, 1)

  // 回合再次关闭 → 重新寄存；非 turn/start 事件不得冲刷
  boundary = { openTurnStartSeq: null, lastTurn: 5 }
  assert.equal(publisher.publish({ ...baseInput, chart_id: 'ch_2' }), true)
  assert.equal(publisher.pendingCount('main-1'), 1)
  turnStart.listener({ id: 'main-1' }, { type: 'step/start', data: { turn: 6 } })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  assert.equal(publisher.pendingCount('main-1'), 1, '只有 turn/start 才冲刷')
  assert.equal(main.appended.length, 1)

  // 下个回合真的开了 → 冲刷到 turn 6
  boundary = { openTurnStartSeq: 300, lastTurn: 6 }
  turnStart.listener({ id: 'main-1' }, { type: 'turn/start', data: { turn: 6 } })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  assert.equal(main.appended.length, 2)
  assert.equal(main.appended[1].data.turn, 6)
  assert.equal(publisher.pendingCount(), 0)
})

test('publish：回合打开时立即写入，turn 缺失 / append 抛错都只降级，不抛出', () => {
  const main = fakeSession('main-1')
  const sessions = { get: () => main }

  const noTurn = createChartEventPublisher(fakeCtx({ sessions, projections: { stateOf: () => ({ openTurnStartSeq: 10, lastTurn: 0 }) } }))
  assert.equal(noTurn.publish(baseInput), false, 'turn 0（会话还没真正开过回合）不得写入')
  assert.equal(main.appended.length, 0)

  const openTurn = createChartEventPublisher(fakeCtx({ sessions, projections: { stateOf: () => ({ openTurnStartSeq: 10, lastTurn: 3 }) } }))
  assert.equal(openTurn.publish(baseInput), true)
  assert.equal(main.appended[0].data.turn, 3)

  const original = main.append
  main.append = () => { throw new Error('persistence down') }
  const throwing = createChartEventPublisher(fakeCtx({ sessions, projections: { stateOf: () => ({ openTurnStartSeq: 10, lastTurn: 3 }) } }))
  assert.equal(throwing.publish(baseInput), false, 'append 抛错不得冒泡到出图路径')
  main.append = original

  const missingOwner = createChartEventPublisher(fakeCtx({ sessions: { get: () => undefined }, projections: { stateOf: () => ({ openTurnStartSeq: 10, lastTurn: 3 }) } }))
  assert.equal(missingOwner.publish(baseInput), false)
})

test('publish：告警只报一次，避免每个 turn 刷屏', () => {
  const warnings = []
  const publisher = createChartEventPublisher(fakeCtx({
    sessions: { get: () => undefined },
    projections: { stateOf: () => ({ openTurnStartSeq: 99, lastTurn: 3 }) },
    logger: { warn: (message) => warnings.push(message) },
  }))
  publisher.publish(baseInput)
  publisher.publish(baseInput)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /图表对话流事件跳过/)
})
