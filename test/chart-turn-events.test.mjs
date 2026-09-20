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

// `pending` 是模块级的（必须跨发布器实例存活），进程内所有用例共享它。
// 本用例集内各测试的 owner id 会复用（main-1 / session-root），所以先清一次底。
// 文件之间天然隔离：node --test 每个测试文件一个进程。
resetChartEventPending()

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
/**
 * @param turnStopping - `false` 不给钩子；`true` 给一个注册成功的钩子；
 *   `'reject'` 给一个**注册失败**的钩子（模拟 `ctx.on('agent/turn-stopping')` 抛错，
 *   适配器 catch 后返回 undefined）——此时必须退回 `turn/start` 兜底。
 */
function fakeEventCtx({ sessions, projections, logger, turnStopping = false } = {}) {
  const listeners = []
  const disposed = []
  const turnStoppingListeners = []
  const root = {
    on: (event, listener) => { listeners.push({ event, listener }); return () => { disposed.push(event) } },
  }
  if (turnStopping === true) {
    // 首选钩子在场且注册成功：模拟宿主平面把 `agent/turn-stopping` 正常接进来。
    root.onTurnStopping = (listener) => {
      turnStoppingListeners.push(listener)
      return () => { disposed.push('agent/turn-stopping') }
    }
  } else if (turnStopping === 'reject') {
    // 注册失败：与 src/index.ts 适配器的 catch 分支一致——返回 undefined。
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

/**
 * 与 cordis 同形的 ctx：`get` / `on` / `effect` 挂在**原型**上。
 *
 * ⚠️ 这是 2026-09-20 事故的复刻：`index.ts` 曾用 `{ ...ctx }` 组装交付 ctx，
 * 而对象展开只复制**自有可枚举属性**，原型上的 `get` 会丢失 →
 * `ctx.get('sessions')` 抛 `ctx.get is not a function` → 被 tool.ts 的 catch 吞掉 →
 * **publish 从未执行**（"专家确实出图、主会话零交付事件"）。
 * 所有用它做的测试，都能挡住"用 spread 组装 ctx"这类回归。
 */
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

/** 模拟 index.ts 的正确组装方式：逐项显式转发（原型方法不能靠展开复制）。 */
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

/**
 * 防复发（2026-09-20 事故，trace 落盘才定位到）：交付 ctx 必须**显式转发**原型方法。
 *
 * 这条用例正面复刻事故：用一个"方法与 cordis 同形、挂在原型上"的 ctx，
 * ① `{ ...ctx }` 组装（错误方式）→ publisher 构造必须失败，证明这才是事故形态；
 * ② 显式转发（正确方式）→ publisher 必须可用且能真正写入。
 */
test('ctx 组装：对象展开会丢掉原型方法（事故形态），显式转发才可用', async () => {
  const main = fakeSession('main-1')
  const raw = new PrototypeCtx({
    sessions: { get: (id) => (id === 'main-1' ? main : undefined) },
    projections: { stateOf: () => ({ openTurnStartSeq: 100, lastTurn: 3 }) },
    turnStopping: true,
  })

  // ① 事故形态：展开只复制自有属性，原型上的 get 丢失
  const spread = { ...raw }
  assert.equal(typeof spread.get, 'undefined', '展开确实拿不到原型方法（这就是事故）')
  assert.throws(
    () => createChartEventPublisher(spread),
    /get is not a function/,
    '用展开组装的 ctx 必须复现 ctx.get is not a function',
  )

  // ② 正确形态：显式转发
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
/**
 * 防复发（2026-09-20 真机事故）：出图会话 ≠ owner 会话时，寄存队列必须按 **owner** 归档。
 *
 * 真实拓扑是 root ← data_junior ← visualization_specialist（孙会话发起出图），
 * 而冲刷时机（`turn/start` / `agent/turn-stopping`）拿到的都是 **owner** 的 session id。
 * 曾经按 `input.ownerSessionId`（= specialist）归档，于是 `flush()` 永远查不到，
 * 图**永久滞留 pending、静默不登记**——实测三个 specialist 会话 `render_chart=2` 而
 * `deliverables/presented=0`，且没有任何报错。
 */
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

  // specialist（depth 2）出图：owner 解析为根会话，队列必须归档在根会话上。
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

/**
 * 防复发（2026-09-20 真机事故）：`agent/turn-stopping` **注册失败**时必须退回 `turn/start`。
 *
 * 早先的实现无条件把 `turnStoppingActive` 置 true，哪怕适配器注册失败、返回 undefined。
 * 结果：闸门被打开、`turn/start` 兜底被永久关掉，而首选钩子其实并不存在 ⇒ 图永久滞留
 * pending ⇒ **交付卡片从头到尾不出现**，且零报错（用户实测）。
 */
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

  // 首选不可用 ⇒ turn/start 必须接上兜底，否则图永远不写。
  boundary = { openTurnStartSeq: 200, lastTurn: 5 }
  listeners.find((entry) => entry.event === 'session/event')
    .listener({ id: 'main-1' }, { type: 'turn/start', data: { turn: 5 } })
  await new Promise((resolve) => { queueMicrotask(resolve) })
  await new Promise((resolve) => { queueMicrotask(resolve) })

  assert.equal(main.appended.length, 1, '注册失败时 turn/start 必须兜底写入（否则卡片永不出现）')
  assert.equal(main.appended[0].data.turn, 5)
  assert.equal(publisher.pendingCount(), 0)
})

/**
 * 防复发（2026-09-20 真机事故主因）：寄存队列必须**跨发布器实例**存活。
 *
 * 生产里 `createChartEventPublisher()` 是**每次 `render_chart`** 惰性调用的
 * （`src/index.ts` 的 `chartEvents: () => …`），所以"出图时寄存"与"轮关闭时冲刷"
 * 跑在**两个不同的实例**上。若 pending 是实例级：
 *   实例 A 寄存 → 实例 B 冲刷时自己的 pending 是空的 → 图永久丢失，且零报错。
 * 症状：可视化专家确实出图（render_chart isError=false），但主会话日志里
 * 一条 `deliverables/presented` 都没有。
 */
test('publish：寄存必须跨发布器实例存活（出图与冲刷是两个实例）', async () => {
  const main = fakeSession('main-1')
  const sessions = { get: (id) => (id === 'main-1' ? main : undefined) }
  let boundary = { openTurnStartSeq: null, lastTurn: 4 }
  const { ctx, turnStoppingListeners } = fakeEventCtx({
    sessions,
    projections: { stateOf: () => boundary },
    turnStopping: true,
  })

  // 实例 A：出图（回合关着）→ 寄存
  const publisherA = createChartEventPublisher(ctx)
  assert.ok(publisherA)
  assert.equal(publisherA.publish(baseInput), true, '寄存')
  assert.equal(publisherA.pendingCount('main-1'), 1)

  // 实例 B：另一次惰性解析（生产里每次 render_chart 都会新建一个）
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

/**
 * 防复发（2026-09-20 真机事故真根因）：发布器必须是进程级单例。
 *
 * 生产调用形态是 `chartEvents: () => createChartEventPublisher(<每次新建的 spread ctx>)`
 * —— **每次 `render_chart` 都重新解析一次**。若每次都新建发布器：
 * 寄存落在实例 A，冲刷监听却绑在别的实例上，图静默丢失。
 * 本用例直接照抄这个调用形态（每次传一个新的 ctx 字面量）。
 */
test('createChartEventPublisher：生产形态（每次传新 ctx）必须复用同一个单例', () => {
  const main = fakeSession('main-1')
  const sessions = { get: (id) => (id === 'main-1' ? main : undefined) }
  const projections = { stateOf: () => ({ openTurnStartSeq: null, lastTurn: 4 }) }
  const { ctx, turnStoppingListeners } = fakeEventCtx({
    sessions,
    projections,
    turnStopping: true,
  })

  // 照抄 index.ts：每次调用都组装一个新的 ctx 字面量（只有 root 是稳定的）
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
