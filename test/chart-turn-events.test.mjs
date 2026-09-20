import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CHART_CALL_ID_PREFIX,
  CHART_DELIVERABLE_EVENT,
  MAX_CHARTS_PER_TURN,
  buildChartEventPayload,
  createChartEventPublisher,
  resolveOwnerSession,
} from '../lib/chart/events.js'

/**
 * 「图表 → 对话流」交付通道的契约测试。
 *
 * 这套设计的边界全在这里钉住：
 *  - 事件必须是 **first-party** `deliverables/presented`（见下方防复发用例，2026-09-18 事故）；
 *  - 事件必须落在**根会话**（用户在看的那条），turn 取自 turnBoundary 投影；
 *  - payload 只有官方契约字段（turn / callId / files），没有 rows / series / 绝对路径；
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
function fakeEventCtx({ sessions, projections, logger, turnStopping = false } = {}) {
  const listeners = []
  const disposed = []
  const turnStoppingListeners = []
  const root = {
    on: (event, listener) => { listeners.push({ event, listener }); return () => { disposed.push(event) } },
  }
  if (turnStopping) {
    // 首选钩子在场：模拟宿主平面把 `agent/turn-stopping` 接进来。
    root.onTurnStopping = (listener) => {
      turnStoppingListeners.push(listener)
      return () => { disposed.push('agent/turn-stopping') }
    }
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
  return { ctx, listeners, disposed, turnStoppingListeners }
}

const baseInput = {
  ownerSessionId: 'main-1',
  chart_id: 'ch_1',
  title: '趋势',
  html_path: 'capital-analysis/charts/ch_1/chart.html',
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

/**
 * 防复发（2026-09-18 事故）：图表呈现**只能**用 first-party 事件。
 *
 * 会话日志的事件词汇表是闭集，读取侧 `validateStoredEvents()` 对未知类型
 * fail-closed 且 `Session.append` 无法设置 `ignorable`——写一个自定义类型
 * （曾经的 `capital/chart-rendered`）会让**整份会话在冷加载时打不开**。
 * 这条用例把"不许再发明事件名"钉在源码上，而不是靠记忆。
 */
test('契约：交付事件必须是 first-party `deliverables/presented`，且 append 只能用它', () => {
  assert.equal(CHART_DELIVERABLE_EVENT, 'deliverables/presented', '必须是官方 present 用的同一事件类型')
  assert.equal(CHART_CALL_ID_PREFIX, 'capital-chart:')

  // 语义化守卫：真正写入日志的只有 `append(<事件名>, …)`。断言每一处 append 的首参都是
  // 上面那个（已核验为 first-party 的）常量，而不是手写的自定义类型字符串——这样事故说明
  // 可以留在注释里，而"再发明一个事件名"必然踩红。
  const source = readFileSync(new URL('../src/chart/events.ts', import.meta.url), 'utf8')
  const appendArgs = [...source.matchAll(/\.append\(\s*([^,]+?)\s*,/g)].map((match) => match[1].trim())
  assert.deepEqual(appendArgs, ['CHART_DELIVERABLE_EVENT'],
    `append 只能使用 CHART_DELIVERABLE_EVENT（实际：${appendArgs.join(', ')}）——写闭集词汇表之外的类型会让会话冷加载失败`)
})

test('buildChartEventPayload：只带官方契约字段，且绝不携带 rows / series / 绝对路径', () => {
  const payload = buildChartEventPayload(baseInput, 6)
  // 官方客户端 isPresentedData() 的形状：turn 是 >=1 的安全整数、callId 非空、files 是数组。
  assert.equal(payload.turn, 6)
  assert.equal(payload.callId, 'capital-chart:ch_1')
  assert.equal(Array.isArray(payload.files), true)
  assert.equal(payload.files.length, 1)
  assert.equal(payload.files[0].path, 'capital-analysis/charts/ch_1/chart.html', 'path 必须是工作区相对路径（官方按 session.cwd 解析）')
  assert.equal(payload.files[0].description, '趋势')
  assert.deepEqual(Object.keys(payload).sort(), ['callId', 'files', 'turn'], '不得携带官方契约以外的字段')
  const text = JSON.stringify(payload)
  assert.equal(/rows|series|"data"|item\[\]/.test(text), false, '事件不得携带数据行/序列')
  assert.equal(text.includes('/home/'), false, '事件不得携带绝对路径')
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
  assert.equal(main.appended[0].type, CHART_DELIVERABLE_EVENT)
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

test('publish：回合之间出图先寄存；拿不到 agent/turn-stopping 时退回 turn/start 兜底', async () => {
  const main = fakeSession('main-1')
  const sessions = { get: (id) => (id === 'main-1' ? main : undefined) }
  // 关键场景（2026-09-17 实测）：主 Agent 结束回合等子 Agent，出图时 openTurnStartSeq === null，
  // 此时 lastTurn 指向**已经结束**的回合，照抄它会把交付登记到上一轮。
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

/**
 * 首选时机（2026-09-20 真机教训）：寄存的图必须在**该轮即将关闭**时写入，
 * 不能被下一次 `turn/start` 抢跑——那一轮往往是空的过程轮（实测 session 38bad3f9：
 * 交付行落进中间的 turn 5，而总结答复在 turn 6）。
 */
test('publish：agent/turn-stopping 在场时，寄存的图在该轮关闭前写入，turn/start 不得抢跑', async () => {
  const main = fakeSession('main-1')
  const sessions = { get: (id) => (id === 'main-1' ? main : undefined) }
  let boundary = { openTurnStartSeq: null, lastTurn: 4 }
  const { ctx, listeners, turnStoppingListeners } = fakeEventCtx({
    sessions,
    projections: { stateOf: () => boundary },
    turnStopping: true,
  })
  const publisher = createChartEventPublisher(ctx)
  assert.ok(publisher)
  assert.equal(turnStoppingListeners.length, 1, '首选钩子必须在场')

  assert.equal(publisher.publish(baseInput), true, '回合之间出图 → 寄存')
  assert.equal(publisher.pendingCount('main-1'), 1)

  // turn 5 开始：首选在场时**不得**在这里冲刷（这正是旧行为的病灶）。
  boundary = { openTurnStartSeq: 200, lastTurn: 5 }
  listeners.find((entry) => entry.event === 'session/event')
    .listener({ id: 'main-1' }, { type: 'turn/start', data: { turn: 5 } })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  assert.equal(main.appended.length, 0, 'turn/start 不得抢跑（否则交付行落进过程轮）')
  assert.equal(publisher.pendingCount('main-1'), 1, '仍处寄存')

  // turn 5 即将关闭 → 此时写入，交付行落进 turn 5。
  turnStoppingListeners[0]({ agent: { session: { id: 'main-1' } }, turn: 5 })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  assert.equal(main.appended.length, 1, '必须在该轮关闭前写入')
  assert.equal(main.appended[0].type, CHART_DELIVERABLE_EVENT)
  assert.equal(main.appended[0].data.turn, 5)
  assert.equal(publisher.pendingCount(), 0)

  // 子 Agent 的 turn-stopping 不得误触发：它的 session 不是 owner（也不是 owner 的后代）。
  boundary = { openTurnStartSeq: null, lastTurn: 5 }
  assert.equal(publisher.publish({ ...baseInput, chart_id: 'ch_other' }), true)
  turnStoppingListeners[0]({ agent: { session: { id: 'unrelated-session' } }, turn: 9 })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  assert.equal(publisher.pendingCount('main-1'), 1, '非 owner 会话的 turn-stopping 不得冲刷')
  assert.equal(main.appended.length, 1)
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
