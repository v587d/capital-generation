import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CHART_CALL_ID_PREFIX,
  CHART_DELIVERABLE_EVENT,
  MAX_CHARTS_PER_TURN,
  buildChartEventPayload,
  createChartEventPublisher,
  resetChartEventPending,
  resetChartEventPublisher,
  resolveOwnerSession,
} from '../lib/chart/events.js'

// pending is module-level and shared within this process; owner ids repeat, so reset first.
resetChartEventPending()

// Chart-to-conversation delivery contract: first-party deliverables/presented only,
// written to the root session, official fields only, and optional (failures degrade).

// Minimal session: append records events; header carries delegation position.
function fakeSession(id, parentSession) {
  const appended = []
  return {
    id,
    header: parentSession === undefined ? { cwd: '/w' } : { cwd: '/w', parentSession, origin: 'subagent' },
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

// turnStopping: false = no hook, true = registered, 'reject' = registration returns undefined.
function fakeEventCtx({ sessions, projections, logger, turnStopping = false } = {}) {
  const listeners = []
  const disposed = []
  const turnStoppingListeners = []
  const root = {
    on: (event, listener) => { listeners.push({ event, listener }); return () => { disposed.push(event) } },
  }
  if (turnStopping === true) {
    root.onTurnStopping = (listener) => {
      turnStoppingListeners.push(listener)
      return () => { disposed.push('agent/turn-stopping') }
    }
  } else if (turnStopping === 'reject') {
    // Matches the adapter's catch branch in src/index.ts.
    root.onTurnStopping = () => undefined
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

// Cordis-shaped ctx with get/on/effect on the prototype. Spread copies own properties
// only, so `{ ...ctx }` loses get and publish silently never runs.
class PrototypeCtx {
  constructor({ sessions, projections, turnStopping = false }) {
    this.listeners = []
    this.turnStoppingListeners = []
    const root = {
      on: (event, listener) => { this.listeners.push({ event, listener }); return () => {} },
    }
    if (turnStopping) {
      root.onTurnStopping = (listener) => { this.turnStoppingListeners.push(listener); return () => {} }
    }
    this._sessions = sessions
    this._projections = projections
    this.root = root
  }

  get(name) {
    if (name === 'sessions') return this._sessions
    if (name === 'sessionProjections') return this._projections
    return undefined
  }

  on(event, listener) { this.listeners.push({ event, listener }); return () => {} }

  effect(callback) { const dispose = callback(); return () => { if (typeof dispose === 'function') dispose() } }
}

// Correct assembly: forward prototype methods explicitly.
function explicitContext(raw) {
  return {
    get: (name) => raw.get(name),
    on: (event, listener) => raw.on.call(raw, event, (...args) => { listener(...args) }),
    onTurnStopping: (listener) => raw.root.onTurnStopping((...args) => { listener(...args) }),
    root: raw.root,
    effect: (callback, label) => raw.effect(callback, label),
  }
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

// The event vocabulary is closed and validated fail-closed on cold load; a custom type
// makes the whole session unreadable, so the source may only append the first-party constant.
test('resolveOwnerSession：fork/branch 顶层会话是根，不沿 seed 谱系走到被 fork 的旧会话', () => {
  const old = fakeSession('main-old')
  const branch = {
    id: 'main-branch',
    header: { cwd: '/w', parentSession: 'main-old', isSeeded: true },
    appended: [],
    append(type, data) { this.appended.push({ type, data }); return { type, seq: 0, data } },
  }
  const junior = fakeSession('junior-branch', 'main-branch')
  const sessions = { get: (id) => ({ 'main-old': old, 'main-branch': branch, 'junior-branch': junior })[id] }

  assert.equal(resolveOwnerSession(sessions, 'main-branch').id, 'main-branch', 'branch 的 parentSession 是 seed 谱系，不是委派')
  assert.equal(resolveOwnerSession(sessions, 'junior-branch').id, 'main-branch', 'branch 下的子 Agent 仍落到 branch 根')

  resetChartEventPublisher()
  resetChartEventPending()
  const publisher = createChartEventPublisher(fakeCtx({
    sessions,
    projections: { stateOf: () => ({ openTurnStartSeq: 1, lastTurn: 7 }) },
  }))
  assert.ok(publisher)
  assert.equal(publisher.publish({ ...baseInput, ownerSessionId: 'main-branch' }), true)
  assert.equal(branch.appended.length, 1, '卡片必须落在 branch 会话')
  assert.equal(old.appended.length, 0, '不能写进被 fork 的旧会话')
  resetChartEventPublisher()
  resetChartEventPending()
})

test('publishMany：一次事件携带全部文件，回合上限按事件计数（不按文件数）', async () => {
  resetChartEventPublisher()
  resetChartEventPending()
  const main = fakeSession('main-1')
  const publisher = createChartEventPublisher(fakeCtx({
    sessions: { get: (id) => (id === 'main-1' ? main : undefined) },
    projections: { stateOf: () => ({ openTurnStartSeq: 100, lastTurn: 7 }) },
  }))
  assert.ok(publisher?.publishMany)
  const inputs = Array.from({ length: 20 }, (_value, index) => ({
    ...baseInput,
    chart_id: `ch_batch_${index}`,
    html_path: `capital-analysis/charts/ch_batch_${index}/chart.html`,
  }))
  assert.equal(publisher.publishMany('main-1', inputs), true)
  assert.equal(main.appended.length, 1, '20 张图必须是 1 个事件（卡片在收尾轮一次收齐）')
  assert.equal(main.appended[0].type, CHART_DELIVERABLE_EVENT)
  assert.equal(main.appended[0].data.turn, 7)
  assert.equal(main.appended[0].data.files.length, 20)
  assert.equal(main.appended[0].data.callId, 'capital-chart:ch_batch_0')
  assert.equal(main.appended[0].data.files[19].path, 'capital-analysis/charts/ch_batch_19/chart.html')
  resetChartEventPublisher()
  resetChartEventPending()
})

test('契约：交付事件必须是 first-party `deliverables/presented`，且 append 只能用它', () => {
  assert.equal(CHART_DELIVERABLE_EVENT, 'deliverables/presented', '必须是官方 present 用的同一事件类型')
  assert.equal(CHART_CALL_ID_PREFIX, 'capital-chart:')

  // Every append() must pass the first-party constant, not a hand-written event string.
  const source = readFileSync(new URL('../src/chart/events.ts', import.meta.url), 'utf8')
  const appendArgs = [...source.matchAll(/\.append\(\s*([^,]+?)\s*,/g)].map((match) => match[1].trim())
  assert.ok(appendArgs.length > 0, '交付通道必须至少有一处 append')
  assert.ok(appendArgs.every((arg) => arg === 'CHART_DELIVERABLE_EVENT'),
    `append 只能使用 CHART_DELIVERABLE_EVENT（实际：${appendArgs.join(', ')}）——写闭集词汇表之外的类型会让会话冷加载失败`)
})

test('buildChartEventPayload：只带官方契约字段，且绝不携带 rows / series / 绝对路径', () => {
  const payload = buildChartEventPayload(baseInput, 6)
  // Official isPresentedData() shape: positive turn, non-empty callId, files array.
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

// Reproduces both shapes: spread loses the prototype get() and fails construction;
// explicit forwarding works and actually writes.
test('ctx 组装：对象展开会丢掉原型方法（事故形态），显式转发才可用', async () => {
  const main = fakeSession('main-1')
  const raw = new PrototypeCtx({
    sessions: { get: (id) => (id === 'main-1' ? main : undefined) },
    projections: { stateOf: () => ({ openTurnStartSeq: 100, lastTurn: 3 }) },
    turnStopping: true,
  })

  const spread = { ...raw }
  assert.equal(typeof spread.get, 'undefined', '展开确实拿不到原型方法（这就是事故）')
  assert.throws(
    () => createChartEventPublisher(spread),
    /get is not a function/,
    '用展开组装的 ctx 必须复现 ctx.get is not a function',
  )

  resetChartEventPublisher()
  resetChartEventPending()
  const publisher = createChartEventPublisher(explicitContext(raw))
  assert.ok(publisher, '显式转发后发布器必须可用')
  assert.equal(publisher.publish(baseInput), true, '回合打开 → 直接登记')
  assert.equal(main.appended.length, 1, '必须真的写进会话（事故时这里是 0）')
  assert.equal(main.appended[0].type, CHART_DELIVERABLE_EVENT)
  resetChartEventPublisher()
  resetChartEventPending()
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

  // The cap is counted per resolved owner, so child-initiated charts share main's bucket.
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
  // While main waits on a child, openTurnStartSeq is null and lastTurn points at a
  // finished turn; reusing it would file delivery into the previous round.
  let boundary = { openTurnStartSeq: null, lastTurn: 4 }
  const { ctx, listeners } = fakeEventCtx({ sessions, projections: { stateOf: () => boundary } })
  const publisher = createChartEventPublisher(ctx)
  assert.ok(publisher)

  assert.equal(publisher.publish(baseInput), true, '寄存也算受理')
  assert.equal(main.appended.length, 0, '回合没打开时不得直接写入')
  assert.equal(publisher.pendingCount('main-1'), 1)

  boundary = { openTurnStartSeq: 200, lastTurn: 5 }
  const turnStart = listeners.find((entry) => entry.event === 'session/event')
  assert.ok(turnStart, '必须监听 session/event 才能等到下一个 turn/start')
  turnStart.listener({ id: 'main-1' }, { type: 'turn/start', data: { turn: 5 } })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  await new Promise((resolve) => { queueMicrotask(resolve) })

  assert.equal(main.appended.length, 1, '寄存的图表必须在新回合写入')
  assert.equal(main.appended[0].data.turn, 5)
  assert.equal(publisher.pendingCount(), 0)

  // Another session's turn/start must not flush anything.
  turnStart.listener({ id: 'other-session' }, { type: 'turn/start', data: { turn: 9 } })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  assert.equal(main.appended.length, 1)

  // Turn closed again: pending; only turn/start flushes.
  boundary = { openTurnStartSeq: null, lastTurn: 5 }
  assert.equal(publisher.publish({ ...baseInput, chart_id: 'ch_2' }), true)
  assert.equal(publisher.pendingCount('main-1'), 1)
  turnStart.listener({ id: 'main-1' }, { type: 'step/start', data: { turn: 6 } })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  assert.equal(publisher.pendingCount('main-1'), 1, '只有 turn/start 才冲刷')
  assert.equal(main.appended.length, 1)

  boundary = { openTurnStartSeq: 300, lastTurn: 6 }
  turnStart.listener({ id: 'main-1' }, { type: 'turn/start', data: { turn: 6 } })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  assert.equal(main.appended.length, 2)
  assert.equal(main.appended[1].data.turn, 6)
  assert.equal(publisher.pendingCount(), 0)
})

// Flush happens when the turn is closing, not on the next turn/start (which may be an
// empty process turn). Pending is keyed by the resolved owner, never the emitting session,
// or a specialist's queued chart is never found and silently dropped.
test('publish：ownerSessionId 是孙会话时，寄存的图仍能被 owner 的 turn-stopping 冲刷（键必须按 owner 归档）', async () => {
  const main = fakeSession('session-root')
  const junior = fakeSession('jnr', 'session-root')
  const specialist = fakeSession('spec', 'jnr')
  const byId = { 'session-root': main, jnr: junior, spec: specialist }
  let boundary = { openTurnStartSeq: null, lastTurn: 4 }
  const { ctx, turnStoppingListeners } = fakeEventCtx({
    sessions: { get: (id) => byId[id] },
    projections: { stateOf: () => boundary },
    turnStopping: true,
  })
  const publisher = createChartEventPublisher(ctx)
  assert.ok(publisher)

  // A depth-2 specialist publishes; the queue must file under the root session.
  assert.equal(publisher.publish({ ...baseInput, ownerSessionId: 'spec' }), true, '寄存也算受理')
  assert.equal(publisher.pendingCount(), 1, '寄存计数必须能查到（曾因键不一致而查不到）')
  assert.equal(main.appended.length, 0)

  boundary = { openTurnStartSeq: 200, lastTurn: 5 }
  turnStoppingListeners[0]({ agent: { session: { id: 'session-root' } }, turn: 5 })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  await new Promise((resolve) => { queueMicrotask(resolve) })

  assert.equal(main.appended.length, 1, '必须写进根会话，而不是发起出图的那条会话')
  assert.equal(main.appended[0].data.turn, 5)
  assert.equal(junior.appended.length + specialist.appended.length, 0, '子会话不得被写入')
  assert.equal(publisher.pendingCount(), 0, '冲刷后队列必须清空')
})

// A failed agent/turn-stopping registration must fall back to turn/start; otherwise the
// fallback is disabled, pending never flushes, and no delivery card appears.
test('publish：turn-stopping 注册失败（适配器返回 undefined）时必须退回 turn/start 兜底', async () => {
  const main = fakeSession('main-1')
  const sessions = { get: (id) => (id === 'main-1' ? main : undefined) }
  let boundary = { openTurnStartSeq: null, lastTurn: 4 }
  const { ctx, listeners, turnStoppingListeners } = fakeEventCtx({
    sessions,
    projections: { stateOf: () => boundary },
    turnStopping: 'reject',
  })
  const publisher = createChartEventPublisher(ctx)
  assert.ok(publisher)
  assert.equal(turnStoppingListeners.length, 0, '注册失败时不应有首选监听器')

  assert.equal(publisher.publish(baseInput), true, '寄存')
  assert.equal(publisher.pendingCount('main-1'), 1)

  boundary = { openTurnStartSeq: 200, lastTurn: 5 }
  listeners.find((entry) => entry.event === 'session/event')
    .listener({ id: 'main-1' }, { type: 'turn/start', data: { turn: 5 } })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  await new Promise((resolve) => { queueMicrotask(resolve) })

  assert.equal(main.appended.length, 1, '注册失败时 turn/start 必须兜底写入（否则卡片永不出现）')
  assert.equal(main.appended[0].data.turn, 5)
  assert.equal(publisher.pendingCount(), 0)
})

// The publisher is resolved per render_chart call, so queue and flush run on different
// instances; a per-instance pending queue loses the chart silently.
test('publish：寄存必须跨发布器实例存活（出图与冲刷是两个实例）', async () => {
  const main = fakeSession('main-1')
  const sessions = { get: (id) => (id === 'main-1' ? main : undefined) }
  let boundary = { openTurnStartSeq: null, lastTurn: 4 }
  const { ctx, turnStoppingListeners } = fakeEventCtx({
    sessions,
    projections: { stateOf: () => boundary },
    turnStopping: true,
  })

  const publisherA = createChartEventPublisher(ctx)
  assert.ok(publisherA)
  assert.equal(publisherA.publish(baseInput), true, '寄存')
  assert.equal(publisherA.pendingCount('main-1'), 1)

  // Second lazy resolution, as a later render_chart would do.
  const publisherB = createChartEventPublisher(ctx)
  assert.ok(publisherB)
  assert.equal(publisherB.pendingCount('main-1'), 1, '新实例必须看到同一个队列（否则冲刷会扑空）')

  boundary = { openTurnStartSeq: 200, lastTurn: 5 }
  turnStoppingListeners[0]({ agent: { session: { id: 'main-1' } }, turn: 5 })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  await new Promise((resolve) => { queueMicrotask(resolve) })

  assert.equal(main.appended.length, 1, '实例 A 寄存的图必须被冲刷写入（跨实例）')
  assert.equal(main.appended[0].data.turn, 5)
  assert.equal(publisherB.pendingCount(), 0, '冲刷后队列清空')
})

// Production re-resolves the publisher on every render_chart with a fresh ctx; it must be
// a process singleton so queue and flush listener never split across instances.
test('createChartEventPublisher：生产形态（每次传新 ctx）必须复用同一个单例', () => {
  const main = fakeSession('main-1')
  const sessions = { get: (id) => (id === 'main-1' ? main : undefined) }
  const projections = { stateOf: () => ({ openTurnStartSeq: null, lastTurn: 4 }) }
  const { ctx, turnStoppingListeners } = fakeEventCtx({
    sessions,
    projections,
    turnStopping: true,
  })

  // Mirrors index.ts: a fresh ctx literal each call, only root is stable.
  const resolve = () => createChartEventPublisher({ ...ctx })

  const a = resolve()
  const b = resolve()
  assert.ok(a && b)
  assert.equal(a, b, '两次解析必须返回同一个实例（否则寄存与冲刷会落在不同实例上）')
  assert.equal(turnStoppingListeners.length, 1, '冲刷监听只能注册一次，不得随实例堆积')
  resetChartEventPublisher()
})

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

  // With turn-stopping present, turn/start must not flush.
  boundary = { openTurnStartSeq: 200, lastTurn: 5 }
  listeners.find((entry) => entry.event === 'session/event')
    .listener({ id: 'main-1' }, { type: 'turn/start', data: { turn: 5 } })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  assert.equal(main.appended.length, 0, 'turn/start 不得抢跑（否则交付行落进过程轮）')
  assert.equal(publisher.pendingCount('main-1'), 1, '仍处寄存')

  turnStoppingListeners[0]({ agent: { session: { id: 'main-1' } }, turn: 5 })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  assert.equal(main.appended.length, 1, '必须在该轮关闭前写入')
  assert.equal(main.appended[0].type, CHART_DELIVERABLE_EVENT)
  assert.equal(main.appended[0].data.turn, 5)
  assert.equal(publisher.pendingCount(), 0)

  // A non-owner session's turn-stopping must not flush.
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
