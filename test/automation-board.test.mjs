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

function boardService(store, asks) {
  return createBoardService({
    store,
    asks,
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
  assert.equal(board.stocks[0].items.length, 1, '个股计数与展开条目共用同一份列表')
  assert.equal(board.gaps.length, 1)
  assert.equal(board.gaps[0].seenCount, 5)
  assert.equal(board.stocks[0].firstSeenAt, '2026-11-03T00:40:32.876Z', '个股新增按首次出现时间判断')
  assert.equal(board.gaps[0].firstSeenAt, '2026-11-03T00:40:32.876Z', '缺口新增按首次出现时间判断')
  assert.deepEqual(board.stats, {
    briefs: 5,
    briefsToday: 2,
    todos: 1,
    stocks: 1,
    stocksNewToday: 0,
    gaps: 1,
    gapsNewToday: 0,
    issues7d: 0,
    issuesToday: 0,
  })
})

test('顶部统计区分今天与总量：简报、个股/缺口新增、今日运行异常', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  const gap = (topic) => ({
    kind: 'capability',
    topic,
    detail: '换时间窗也取不到。',
    sourceQuote: '数据源没有该字段',
  })
  await addBrief(store, task, {
    key: 'stats-old',
    finishedAt: '2026-11-03T00:40:32.876Z',
    stocks: [{ symbol: '300803.SZ', name: '指南针', roles: ['holding'] }],
    gaps: [gap('港股成交额')],
  })
  await addBrief(store, task, {
    key: 'stats-today',
    finishedAt: '2026-11-04T00:40:32.876Z',
    stocks: [
      { symbol: '300803.SZ', name: '指南针', roles: ['holding'] },
      { symbol: '00700.HK', name: '腾讯控股', roles: ['watch'] },
    ],
    gaps: [gap('港股成交额'), gap('北向资金')],
  })
  const failed = await store.createRun({
    taskId: task.id,
    taskTitle: task.title,
    trigger: 'manual',
    occurrenceKey: 'stats-failed-today',
    status: 'failed',
    sessionId: 'session-stats-failed',
  })
  await store.updateRun(failed.id, { finishedAt: '2026-11-04T01:00:00.000Z' })

  const board = await boardService(store).board({ days: '14', tz: TZ })
  assert.equal(board.stats.briefs, 2)
  assert.equal(board.stats.briefsToday, 1, '今天简报只数今天的成功运行')
  assert.equal(board.stats.stocks, 2)
  assert.equal(board.stats.stocksNewToday, 1, '新增只数首次出现就在今天的个股')
  assert.equal(board.stats.gaps, 2)
  assert.equal(board.stats.gapsNewToday, 1, '新增只数首次出现就在今天的缺口')
  assert.equal(board.stats.issues7d, 1)
  assert.equal(board.stats.issuesToday, 1, '今天运行异常只看今天的失败运行')
})

test('个股雷达合并带与不带交易所后缀的同一代码，跟进条目也按同一标的计数', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, {
    key: 'alias-bare',
    finishedAt: '2026-11-03T00:40:32.876Z',
    items: [{
      kind: 'verify',
      title: '指南针能否站回 44.01',
      symbol: '300803',
      trigger: '收盘价站回 44.01',
      dueAt: '2026-11-07',
      sourceQuote: '指南针 300803 跌破 44.01 且成交额不低于 12.66 亿，才确认修复。',
    }],
    stocks: [{ symbol: '300803', name: '指南针', roles: ['watch', 'risk'], note: '无后缀写法' }],
  })
  await addBrief(store, task, {
    key: 'alias-suffixed',
    finishedAt: '2026-11-04T00:40:32.876Z',
    items: [{
      kind: 'confirm',
      title: '指南针持仓标记是否仍有效',
      symbol: '300803.SZ',
      dueLabel: '尽快',
      sourceQuote: '自选清单里 300803.SZ 指南针标记为持仓、占比 100%',
    }],
    stocks: [{ symbol: '300803.SZ', name: '指南针', roles: ['holding', 'event'], note: '带后缀写法' }],
  })
  const board = await boardService(store).board({ days: '14', tz: TZ })
  assert.equal(board.stocks.length, 1, '300803 与 300803.SZ 必须是同一只')
  assert.equal(board.stocks[0].symbol, '300803.SZ', '展示优先保留带交易所后缀的写法')
  assert.equal(board.stocks[0].symbolKey, '300803.SZ')
  assert.deepEqual(board.stocks[0].roles, ['holding', 'risk', 'event', 'watch'])
  assert.equal(board.stocks[0].note, '带后缀写法', '说明取最近一次运行')
  assert.equal(board.stocks[0].todoCount, 2, '两种写法的待跟进事项都归到同一只个股')
  assert.equal(board.stocks[0].items.length, 2, '计数必须等于展开条目数')
  assert.deepEqual(board.todos.map((item) => item.symbolKey), ['300803.SZ', '300803.SZ'], '待跟进事项也要带上规范化后的标的键')
  assert.equal(board.stats.stocks, 1)
})

test('个股跟进数始终等于展开条目数，且不受页面 TODO 50 条上限影响', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  for (let batch = 0; batch < 10; batch += 1) {
    const items = Array.from({ length: 6 }, (_, index) => {
      const number = batch * 6 + index
      return {
        kind: 'track',
        title: `跟踪事项 ${number}`,
        symbol: '300803.SZ',
        sourceQuote: `指南针 300803.SZ 跟踪事项 ${number}`,
      }
    })
    await addBrief(store, task, {
      key: `stock-items-${batch}`,
      finishedAt: `2026-11-04T00:40:${String(batch).padStart(2, '0')}.000Z`,
      items,
      stocks: [{ symbol: '300803.SZ', name: '指南针', roles: ['watch'] }],
    })
  }
  const board = await boardService(store).board({ days: '14', tz: TZ })
  assert.equal(board.todos.length, 50, '页面 TODO 面板仍有 50 条上限')
  assert.equal(board.stocks[0].todoCount, 60, '个股计数覆盖该标的的全部待跟进事项')
  assert.equal(board.stocks[0].items.length, 60, '个股展开条目与计数一致，不被页面 TODO 上限截断')
  assert.ok(board.stocks[0].items.every((item) => typeof item.sessionId === 'string' && item.sessionId.length > 0), '每条都带来源 session')
})

test('个股雷达不把不同市场的同数字代码合并', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, {
    key: 'market-split',
    stocks: [
      { symbol: '000001.SS', name: '上证指数', roles: ['watch'] },
      { symbol: '000001.SZ', name: '平安银行', roles: ['holding'] },
      { symbol: '000001', name: '平安银行', roles: ['risk'] },
    ],
  })
  const board = await boardService(store).board({ days: '14', tz: TZ })
  assert.equal(board.stocks.length, 2, '000001.SS 与 000001.SZ 是不同市场')
  assert.deepEqual(board.stocks.map((stock) => stock.symbolKey).sort(), ['000001.SH', '000001.SZ'])
  const shenzhen = board.stocks.find((stock) => stock.symbolKey === '000001.SZ')
  assert.equal(shenzhen.symbol, '000001.SZ')
  assert.deepEqual(shenzhen.roles, ['holding', 'risk'], '不带后缀的深市代码与 .SZ 合并')
})

test('个股雷达超过 12 只仍返回完整列表，供前端默认 12 条后展开', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  const stocks = Array.from({ length: 15 }, (_, index) => ({
    symbol: `6000${String(index).padStart(2, '0')}.SH`,
    name: `测试股${index}`,
    roles: [index % 2 === 0 ? 'holding' : 'watch'],
  }))
  await addBrief(store, task, { key: 'many-stocks-a', stocks: stocks.slice(0, 8) })
  await addBrief(store, task, { key: 'many-stocks-b', finishedAt: '2026-11-04T03:40:32.876Z', stocks: stocks.slice(8) })
  const board = await boardService(store).board({ days: '14', tz: TZ })
  assert.equal(board.stocks.length, 15)
  assert.equal(board.stats.stocks, 15)
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

test('TODO 确认：按 profile 落库，确认后保留已确认标记，后续运行再次出现', async () => {
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
  assert.equal(after.todos.length, 1, '确认后保留该版本，由页面显示已确认')
  assert.equal(after.todos[0].ackedAt, stored[0].confirmedAt)
  assert.equal(after.stats.todos, 0, '已确认不再计入今日 TODO')
  assert.equal(after.stocks[0].todoCount, 0, '个股跟进数同步扣除已确认条目')
  assert.equal(after.stocks[0].items.length, 0, '确认后展开列表也必须为空')
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
  assert.equal(again.todos[0].ackedAt, undefined, '新版本不再沿用旧确认')
  assert.equal(again.todos[0].lastSeenAt, '2026-11-04T03:00:00.000Z')
  assert.equal(again.stocks[0].todoCount, 1)
})

test('TODO 跟踪状态随 board 返回：触发与待人工的条目排在前面', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  const triggered = {
    kind: 'verify',
    title: '指南针收盘站回 44.01',
    symbol: '300803.SZ',
    trigger: '收盘价站回 44.01',
    dueAt: '2026-11-07',
    sourceQuote: '指南针跌破 44.01 且成交额不低于 12.66 亿，才确认修复。',
  }
  const watching = {
    kind: 'verify',
    title: '腾讯能否守住 416',
    symbol: '00700.HK',
    trigger: '收盘失守 416',
    dueAt: '2026-11-07',
    sourceQuote: '腾讯今日低点 416.00，观察是否失守。',
  }
  const run = await addBrief(store, task, { key: 'watch-board', items: [watching, triggered] })
  const board = boardService(store)
  const before = await board.board({ days: '14', tz: TZ })
  const byTitle = new Map(before.todos.map((item) => [item.title, item]))
  const triggerItem = [...byTitle.values()].find((item) => item.title.includes('44.01'))
  const watchItem = byTitle.get('腾讯能否守住 416')
  await store.putTodoWatch({
    schemaVersion: 1,
    id: 'tw_x',
    profileKey: store.profileKey,
    todoId: triggerItem.id,
    kind: 'verify',
    status: 'triggered',
    title: triggerItem.title,
    trigger: triggerItem.trigger,
    dueAt: triggerItem.dueAt,
    firstSeenAt: run.finishedAt,
    lastSeenAt: run.finishedAt,
    checkedAt: '2026-11-04T03:00:00.000Z',
    verdict: 'triggered',
    evidence: '指南针今日收盘 44.55。',
    evidenceRunId: run.id,
    createdAt: '2026-11-04T03:00:00.000Z',
    updatedAt: '2026-11-04T03:00:00.000Z',
  })
  await store.putTodoWatch({
    schemaVersion: 1,
    id: 'tw_y',
    profileKey: store.profileKey,
    todoId: watchItem.id,
    kind: 'verify',
    status: 'needs_human',
    title: watchItem.title,
    trigger: watchItem.trigger,
    dueAt: watchItem.dueAt,
    firstSeenAt: run.finishedAt,
    lastSeenAt: run.finishedAt,
    handoffReason: '缺少收盘价。',
    createdAt: '2026-11-04T03:00:00.000Z',
    updatedAt: '2026-11-04T03:00:00.000Z',
  })
  const after = await board.board({ days: '14', tz: TZ })
  assert.equal(after.todos[0].watch.status, 'triggered')
  assert.equal(after.todos[0].watch.evidence, '指南针今日收盘 44.55。')
  assert.equal(after.todos[1].watch.status, 'needs_human')
  assert.equal(after.todos[1].watch.handoffReason, '缺少收盘价。')
  assert.equal(after.todos[0].watch.profileKey, undefined, 'watch 摘要不能带 profileKey')
  const all = await board.openTodos({ days: '14', tz: TZ })
  assert.equal(all.length, 2, 'watcher 投影不受页面 50 条上限影响')
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
  assert.equal(board.stats.issuesToday, 0, '昨天的异常不计入今天运行异常')
})

test('看板卡片带上该 run 的最新追问，不被别的 run 串走', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  const run = await addBrief(store, task, { key: 'ask-card' })
  let wanted
  const asks = {
    async latestForRuns(runIds) {
      wanted = runIds
      return new Map([[run.id, {
        id: 'ask_card',
        runId: run.id,
        sessionId: run.sessionId,
        question: '成交量怎么看？',
        status: 'ready',
        preview: '先看成交量。',
        error: null,
        createdAt: '2026-11-04T00:41:00.000Z',
        finishedAt: '2026-11-04T00:42:00.000Z',
      }]])
    },
  }
  const board = await boardService(store, asks).board({ days: '14', tz: TZ })
  assert.deepEqual(wanted, [run.id])
  assert.equal(board.cards[0].ask.id, 'ask_card')
  assert.equal(board.cards[0].ask.preview, '先看成交量。')
  assert.equal(board.cards[0].ask.sessionId, run.sessionId)
})
