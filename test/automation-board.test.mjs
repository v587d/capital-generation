import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createAutomationStore } from '../automation/store.js'
import { createBoardService, BoardError } from '../automation/board.js'
import { tradingCalendar } from '../automation/calendar.js'
import { BUILTIN_TASK_ICONS } from '../automation/task-icons.js'
import { createFakeDomain } from './automation-harness.mjs'

const NOW = Date.parse('2026-11-04T02:00:00Z')
const TZ = 'Asia/Shanghai'
const PLAIN = '昨晚美国科技股继续下跌，市场怕的是它们之前涨得太贵。国内出了稳市场的新办法，但真正买股票的钱还没进来。今天开盘先看科技股能不能止跌，不然大盘还会被它们拖着走。'

async function makeStore() {
  const fake = createFakeDomain()
  const store = createAutomationStore({
    openDomain: async () => fake.domain,
    profile: { name: 'web' },
    now: () => NOW,
    calendar: tradingCalendar,
  })
  return { fake, store }
}

async function makeTask(store, overrides = {}) {
  const record = await store.createTask({
    title: '早间资讯',
    instruction: '给出结论',
    category: 'news',
    trigger: { kind: 'schedule', cadence: 'daily', time: '08:00', timezone: TZ, tradingDaysOnly: true },
    ...overrides,
  })
  return store.getTask(record.id)
}

async function addBrief(store, task, options = {}) {
  const run = await store.createRun({
    taskId: task.id,
    taskTitle: task.title,
    trigger: options.trigger ?? 'manual',
    occurrenceKey: `manual-${options.key ?? Math.random()}`,
    status: options.status ?? 'succeeded',
    sessionId: options.sessionId ?? `session-${options.key ?? Math.random()}`,
  })
  const finishedAt = options.finishedAt ?? '2026-11-04T00:40:32.876Z'
  await store.updateRun(run.id, { finishedAt, durationMs: 60_000 })
  if (options.status === undefined || options.status === 'succeeded') {
    await store.createBrief({ runId: run.id, taskId: task.id, sessionId: run.sessionId })
    await store.updateBrief(run.id, {
      status: 'ready',
      headline: options.headline ?? '科技股又跌了，救兵还没到',
      plain: PLAIN,
      items: options.items ?? [],
      stocks: options.stocks ?? [],
      gaps: options.gaps ?? [],
      coverage: 'full',
      generatedAt: finishedAt,
    })
  }
  return store.getRun(run.id)
}

function boardService(store) {
  return createBoardService({
    store,
    scheduler: {
      status: () => ({ state: 'active', calendar: { available: true, coverageDays: 420 } }),
      displayNext: (task) => ({ kind: 'occurrence', scheduledFor: '2026-11-05T00:00:00.000Z', taskId: task.id }),
    },
    now: () => NOW,
  })
}

test('看板空态只看 brief；历史成功运行不补卡片', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await store.createRun({
    taskId: task.id,
    taskTitle: task.title,
    trigger: 'manual',
    occurrenceKey: 'history-only',
    status: 'succeeded',
    sessionId: 'session-history',
  })
  const board = await boardService(store).board({ days: '14', tz: TZ })
  assert.equal(board.empty, true)
  assert.deepEqual(board.cards, [])
  assert.equal(board.stats.briefs, 0)
})

test('卡片只含有 brief 的成功运行；顶部统计/TODO/雷达/缺口都从 brief 聚合', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  const item = {
    kind: 'confirm',
    title: '指南针持仓标记是否仍有效',
    detail: '自报 100%，已 26 天未更新',
    symbol: '300803.SZ',
    dueLabel: '尽快',
    sourceQuote: '自选清单里 300803.SZ 指南针标记为持仓、占比 100%',
  }
  for (let index = 0; index < 5; index += 1) {
    await addBrief(store, task, {
      key: `repeat-${index}`,
      finishedAt: `2026-11-0${index < 3 ? 3 : 4}T0${index}:40:32.876Z`,
      items: [item],
      stocks: [{ symbol: '300803.SZ', name: '指南针', roles: index === 0 ? ['holding'] : ['risk'], note: '放量滞涨' }],
      gaps: [{
        kind: 'capability',
        topic: '港股成交额',
        detail: '数据源没有该字段；不是本次取数失败。',
        sourceQuote: '港股主板成交额没有数据源口径',
      }],
    })
  }
  const board = await boardService(store).board({ days: '14', tz: TZ })
  assert.equal(board.empty, false)
  assert.equal(board.cards.length, 5)
  assert.equal(board.todos.length, 1, '5 次运行提到同一持仓确认只保留 1 条')
  assert.equal(board.todos[0].seenCount, 5)
  assert.equal(board.todos[0].sources.length, 5)
  assert.equal(board.stocks.length, 1)
  assert.deepEqual(board.stocks[0].roles, ['holding', 'risk'])
  assert.equal(board.stocks[0].todoCount, 1)
  assert.equal(board.gaps.length, 1)
  assert.equal(board.gaps[0].seenCount, 5)
  assert.deepEqual(board.stats, { briefs: 5, todos: 1, stocks: 1, gaps: 1, issues7d: 0 })
})

test('卡片保留任务图标：自定义任务用创建时的选择，内置模板用固定映射', async () => {
  const { store } = await makeStore()
  const custom = await makeTask(store, { title: '深研清单', category: 'research', icon: 'microscope' })
  await addBrief(store, custom, { key: 'custom-icon' })
  const builtin = (await store.listTasks()).find((task) => task.sourceBuiltinId === 'research-topics')
  assert.ok(builtin, '内置模板必须已落库')
  await addBrief(store, builtin, { key: 'builtin-icon' })
  const board = await boardService(store).board({ days: '14', tz: TZ })
  const customCard = board.cards.find((card) => card.taskId === custom.id)
  assert.equal(customCard.icon, 'microscope', '自定义任务必须沿用创建时选的图标')
  assert.equal(customCard.origin, 'custom', '自定义任务的色调按任务页的 custom 处理')
  const builtinCard = board.cards.find((card) => card.taskId === builtin.id)
  assert.equal(builtinCard.icon, BUILTIN_TASK_ICONS['research-topics'], '内置模板必须用固定图标')
  assert.equal(builtinCard.origin, 'builtin')
})

test('TODO 确认：按 profile 落库，确认后从 TODO/雷达隐藏，后续运行再次出现', async () => {
  const { fake, store } = await makeStore()
  const task = await makeTask(store)
  const item = {
    kind: 'verify',
    title: '指南针能否站回 44.01',
    detail: '收盘价站回 44.01 才算修复；否则按短线破位处理。',
    symbol: '300803.SZ',
    trigger: '收盘价站回 44.01',
    dueAt: '2026-11-07',
    sourceQuote: '指南针跌破 44.01 且成交额不低于 12.66 亿，才确认修复。',
  }
  const stock = { symbol: '300803.SZ', name: '指南针', roles: ['holding'] }
  await addBrief(store, task, {
    key: 'ack-old',
    finishedAt: '2026-11-03T00:40:32.876Z',
    items: [item],
    stocks: [stock],
  })
  const service = boardService(store)
  const before = await service.board({ days: '14', tz: TZ })
  assert.equal(before.todos.length, 1)
  assert.equal(before.stocks[0].todoCount, 1)

  const ack = await service.confirmTodo(before.todos[0].id)
  assert.equal(ack.id, before.todos[0].id)
  const stored = [...fake.tables.get('todo_acks').values()]
  assert.equal(stored.length, 1)
  assert.equal(stored[0].profileKey, store.profileKey)
  assert.equal(stored[0].todoId, before.todos[0].id)

  const after = await service.board({ days: '14', tz: TZ })
  assert.equal(after.todos.length, 0, '确认后不再出现在 TODO')
  assert.equal(after.stats.todos, 0)
  assert.equal(after.stocks[0].todoCount, 0, '自选股雷达同步扣除待办数')
  assert.equal(after.gaps.length, 0)

  await service.confirmTodo(before.todos[0].id)
  assert.equal(fake.tables.get('todo_acks').size, 1, '重复确认同一项只保留一条记录')

  await addBrief(store, task, {
    key: 'ack-new',
    finishedAt: '2026-11-04T03:00:00.000Z',
    items: [item],
    stocks: [stock],
  })
  const again = await service.board({ days: '14', tz: TZ })
  assert.equal(again.todos.length, 1, '后续运行再次提到同一项时重新出现')
  assert.equal(again.todos[0].lastSeenAt, '2026-11-04T03:00:00.000Z')
  assert.equal(again.stocks[0].todoCount, 1)
})

test('按分类/游标分页，TODO 与统计仍覆盖整个筛选范围', async () => {
  const { store } = await makeStore()
  const news = await makeTask(store, { title: '早间资讯', category: 'news' })
  const market = await makeTask(store, { title: '午间快照', category: 'market' })
  for (let index = 0; index < 3; index += 1) {
    await addBrief(store, news, { key: `news-${index}`, finishedAt: `2026-11-04T0${index}:00:00.000Z` })
    await addBrief(store, market, { key: `market-${index}`, finishedAt: `2026-11-03T0${index}:00:00.000Z` })
  }
  const service = boardService(store)
  const first = await service.board({ days: '14', tz: TZ, category: 'news', limit: '2' })
  assert.equal(first.cards.length, 2)
  assert.equal(first.stats.briefs, 3, '统计不受分页影响')
  assert.ok(first.nextBefore)
  const second = await service.board({ days: '14', tz: TZ, category: 'news', limit: '2', before: first.nextBefore })
  assert.equal(second.cards.length, 1)
  assert.equal(second.nextBefore, null)
  await assert.rejects(() => service.board({ days: '14', tz: TZ, before: 'missing' }), (error) => error instanceof BoardError && error.code === 'invalid_cursor')
  await assert.rejects(() => service.board({ days: '3', tz: TZ }), (error) => error instanceof BoardError && error.code === 'invalid_query')
})

test('运行健康：7 天失败、简报状态与已补跑', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, { key: 'ok', finishedAt: '2026-11-04T00:40:32.876Z' })
  const failed = await store.createRun({
    taskId: task.id,
    taskTitle: task.title,
    trigger: 'manual',
    occurrenceKey: 'failed-one',
    status: 'failed',
    sessionId: 'session-failed',
  })
  await store.updateRun(failed.id, {
    finishedAt: '2026-11-03T00:30:00.000Z',
    errors: [{
      at: '2026-11-03T00:30:00.000Z',
      phase: 'session',
      severity: 'error',
      code: 'session_create_failed',
      message: '创建运行会话失败。',
    }],
  })
  await addBrief(store, task, { key: 'recovery', finishedAt: '2026-11-03T01:00:00.000Z' })
  const board = await boardService(store).board({ days: '14', tz: TZ })
  assert.equal(board.health.runs.failed, 1)
  assert.equal(board.health.briefs.ready, 2)
  assert.equal(board.health.issueCount, 1)
  assert.equal(board.health.recentIssues.length, 1)
  assert.equal(board.health.recentIssues[0].status, 'failed')
  assert.equal(board.health.recentIssues[0].recoveredByRunId !== undefined, true)
  assert.equal(board.stats.issues7d, 1)
})
