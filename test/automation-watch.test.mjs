import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createAutomationStore } from '../automation/store.js'
import { createBoardService } from '../automation/board.js'
import { createTodoWatchService, parseWatchOutput } from '../automation/watch.js'
import { tradingCalendar } from '../automation/calendar.js'
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
    title: '每日复盘',
    instruction: '给出结论',
    category: 'review',
    trigger: { kind: 'schedule', cadence: 'daily', time: '18:00', timezone: TZ, tradingDaysOnly: true },
    ...overrides,
  })
  return store.getTask(record.id)
}

async function makeCheckpointTask(store) {
  const tasks = await store.listTasks()
  return tasks.find((task) => task.sourceBuiltinId === 'daily-review')
}

async function addBrief(store, task, items, options = {}) {
  const run = await store.createRun({
    taskId: task.id,
    taskTitle: task.title,
    trigger: 'manual',
    occurrenceKey: `manual-${options.key ?? Math.random()}`,
    status: 'succeeded',
    sessionId: options.sessionId ?? `session-${options.key ?? Math.random()}`,
  })
  const finishedAt = options.finishedAt ?? '2026-11-04T01:40:32.876Z'
  await store.updateRun(run.id, { finishedAt, durationMs: 60_000 })
  await store.createBrief({ runId: run.id, taskId: task.id, sessionId: run.sessionId })
  await store.updateBrief(run.id, {
    status: 'ready',
    headline: '科技股又跌了，救兵还没到',
    plain: PLAIN,
    items,
    stocks: [],
    gaps: [],
    coverage: 'full',
    generatedAt: finishedAt,
  })
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

function fakeLlm(output) {
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      return (async function* generate() {
        yield { type: 'text-delta', text: output }
        yield { type: 'finish', reason: { kind: 'completed' } }
      })()
    },
  }
}

function watchService(store, llm, now = NOW) {
  return createTodoWatchService({
    ctx: { get: (name) => name === 'llm' ? llm : undefined },
    store,
    board: boardService(store),
    now: () => now,
    getSettings: () => ({ inAppNotifications: true }),
  })
}

const VERIFY_ITEM = {
  kind: 'verify',
  title: '指南针收盘能否站回 44.01',
  detail: '收盘价站回 44.01 才算修复；否则按短线破位处理。',
  symbol: '300803.SZ',
  trigger: '收盘价站回 44.01',
  dueAt: '2026-11-04',
  sourceQuote: '指南针跌破 44.01 且成交额不低于 12.66 亿，才确认修复。',
}

const CONFIRM_ITEM = {
  kind: 'confirm',
  title: '指南针持仓标记是否仍有效',
  detail: '自报 100%，已 26 天未更新',
  symbol: '300803.SZ',
  dueLabel: '尽快',
  sourceQuote: '自选清单里 300803.SZ 指南针标记为持仓、占比 100%',
}

function answerOf(line) {
  return `复盘正文\n\n${line}\n\n以上是本次结论。`
}

test('TODO 核验输出：来源外引用、未知 id 与低置信度都不能当成触发', () => {
  const todos = [{ id: 'verify|x|y', kind: 'verify', title: '站回 44.01' }]
  const sourceText = '指南针今日收盘 44.55 元，站回 44.01。'
  const blocks = [{ id: 1, text: '指南针今日收盘 44.55 元，站回 44.01。' }]
  const parsed = parseWatchOutput(JSON.stringify({
    results: [
      { id: 'verify|x|y', verdict: 'triggered', confidence: 'high', sourceId: 1, evidence: '收盘 44.55 元' },
      { id: 'unknown', verdict: 'triggered', confidence: 'high', sourceId: 1, evidence: '收盘 44.55 元' },
      { id: 'verify|x|y', verdict: 'triggered', confidence: 'low', sourceId: 1, evidence: '站回 44.01' },
    ],
  }), { todos, blocks, sourceText })
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].verdict, 'triggered')
  assert.equal(parsed[0].confidence, 'high')

  const fabricated = parseWatchOutput(JSON.stringify({
    results: [{ id: 'verify|x|y', verdict: 'triggered', confidence: 'high', sourceId: 1, evidence: '收盘 45.00 元' }],
  }), { todos, blocks, sourceText })
  assert.deepEqual(fabricated, [], '原文没有的数值不能作为核验依据')
})

test('TODO 跟踪：待验证进入 watching，待人工确认直接交给用户并写通知', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [VERIFY_ITEM, CONFIRM_ITEM], { key: 'watch-create' })
  const watches = watchService(store, fakeLlm('{}'))

  await watches.sync()
  const records = await store.listTodoWatches()
  const verify = records.find((record) => record.todoId.startsWith('verify|'))
  const confirm = records.find((record) => record.todoId.startsWith('confirm|'))
  assert.equal(verify.status, 'watching')
  assert.equal(verify.checkedAt, undefined)
  assert.equal(confirm.status, 'needs_human')
  assert.match(confirm.handoffReason, /看板 TODO 确认/)

  const notifications = await store.listNotifications({ limit: 20 })
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].kind, 'todo_needs_human')
  assert.equal(notifications[0].todoId, confirm.todoId)
  assert.match(notifications[0].title, /待人工确认：/)

  await watches.sync()
  assert.equal((await store.listNotifications({ limit: 20 })).length, 1, '同一状态不重复通知')
})

test('TODO 跟踪：新运行给出原文证据后标记触发，且只通知一次', async () => {
  const { store } = await makeStore()
  const task = await makeCheckpointTask(store)
  const run = await addBrief(store, task, [VERIFY_ITEM], { key: 'watch-trigger' })
  const llm = fakeLlm(JSON.stringify({
    results: [{
      id: await todoIdOf(store),
      verdict: 'triggered',
      confidence: 'high',
      sourceId: 2,
      evidence: '指南针今日收盘 44.55 元，站回 44.01。',
    }],
  }))
  const watches = watchService(store, llm)
  await watches.sync()
  watches.onBriefReady({
    run,
    task,
    text: answerOf('指南针今日收盘 44.55 元，站回 44.01。'),
    route: { provider: 'p', model: 'm' },
  })
  await watches.flush()

  const verify = (await store.listTodoWatches()).find((record) => record.kind === 'verify')
  assert.equal(verify.status, 'triggered')
  assert.equal(verify.verdict, 'triggered')
  assert.match(verify.evidence, /44\.55/)
  assert.equal(verify.evidenceRunId, run.id)
  const notifications = (await store.listNotifications({ limit: 20 })).filter((item) => item.kind === 'todo_triggered')
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].todoId, verify.todoId)

  watches.onBriefReady({
    run,
    task,
    text: answerOf('指南针今日收盘 44.55 元，站回 44.01。'),
    route: { provider: 'p', model: 'm' },
  })
  await watches.flush()
  assert.equal((await store.listNotifications({ limit: 20 })).filter((item) => item.kind === 'todo_triggered').length, 1, '重复核验不重复通知')
})

test('TODO 跟踪：原文提到但缺少核验数据时交给用户；到期后转 expired', async () => {
  const { store } = await makeStore()
  const task = await makeCheckpointTask(store)
  const run = await addBrief(store, task, [VERIFY_ITEM], { key: 'watch-handoff' })
  const id = await todoIdOf(store)
  const llm = fakeLlm(JSON.stringify({
    results: [{ id, verdict: 'insufficient', confidence: 'low', sourceId: 2, evidence: '指南针今日收盘 44.55 元，站回 44.01。' }],
  }))
  const watches = watchService(store, llm)
  await watches.sync()
  watches.onBriefReady({
    run,
    task,
    text: answerOf('指南针今日收盘 44.55 元，站回 44.01。'),
    route: { provider: 'p', model: 'm' },
  })
  await watches.flush()

  const verify = (await store.listTodoWatches()).find((record) => record.kind === 'verify')
  assert.equal(verify.status, 'needs_human')
  assert.match(verify.handoffReason, /数据或口径/)
  assert.equal((await store.listNotifications({ limit: 20 })).filter((item) => item.kind === 'todo_needs_human').length, 1)
})

test('TODO 跟踪：到期前没拿到可复核数据，次日转人工而不是静默过期', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [VERIFY_ITEM], { key: 'watch-overdue' })
  const first = watchService(store, fakeLlm('{}'))
  await first.sync()
  assert.equal((await store.listTodoWatches())[0].status, 'watching')

  const nextDay = watchService(store, fakeLlm('{}'), NOW + 24 * 60 * 60_000)
  await nextDay.sync()
  const watch = (await store.listTodoWatches())[0]
  assert.equal(watch.status, 'needs_human')
  assert.match(watch.handoffReason, /到期前/)
  const notifications = (await store.listNotifications({ limit: 20 })).filter((item) => item.kind === 'todo_needs_human')
  assert.equal(notifications.length, 1)
  assert.match(notifications[0].title, /待人工确认：/)
})

test('TODO 跟踪：用户确认后 watch 收口为 resolved', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [CONFIRM_ITEM], { key: 'watch-ack' })
  const watches = watchService(store, fakeLlm('{}'))
  await watches.sync()
  const before = (await store.listTodoWatches())[0]
  assert.equal(before.status, 'needs_human')

  const board = boardService(store)
  await board.confirmTodo(before.todoId)
  await watches.sync()
  const after = (await store.listTodoWatches())[0]
  assert.equal(after.status, 'resolved')
  assert.equal(after.resolvedFrom, 'needs_human')
})

test('TODO 跟踪：已触发的条目确认后收口为 resolved，并记住触发状态', async () => {
  const { store } = await makeStore()
  const task = await makeCheckpointTask(store)
  await addBrief(store, task, [VERIFY_ITEM], { key: 'watch-trigger-ack' })
  const watches = watchService(store, fakeLlm('{}'))
  await watches.sync()
  const before = (await store.listTodoWatches())[0]
  await store.putTodoWatch({
    ...before,
    status: 'triggered',
    checkedAt: new Date(NOW).toISOString(),
    verdict: 'triggered',
    evidence: '指南针今日收盘 44.55 元，站回 44.01。',
    updatedAt: new Date(NOW).toISOString(),
  })
  const board = boardService(store)
  await board.confirmTodo(before.todoId)
  await watches.sync()
  const after = (await store.listTodoWatches())[0]
  assert.equal(after.status, 'resolved')
  assert.equal(after.resolvedFrom, 'triggered')
})

test('TODO 跟踪：连续 3 天没被新运行提到就不再创建 watch', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [VERIFY_ITEM], { key: 'stale', finishedAt: '2026-10-31T02:00:00.000Z' })
  const watches = watchService(store, fakeLlm('{}'))
  await watches.sync()
  assert.equal((await store.listTodoWatches()).length, 0)
})

test('TODO 核验只认内置检查点：午间快照 / 每日复盘，其他任务不当判卷人', async () => {
  const { store } = await makeStore()
  const custom = await makeTask(store)
  const run = await addBrief(store, custom, [VERIFY_ITEM], { key: 'watch-gate' })
  const llm = fakeLlm('{}')
  const watches = watchService(store, llm)
  await watches.sync()
  watches.onBriefReady({
    run,
    task: custom,
    text: answerOf('指南针今日收盘 44.55 元，站回 44.01。'),
    route: { provider: 'p', model: 'm' },
  })
  await watches.flush()
  assert.equal(llm.calls.length, 0, '自定义任务不触发 TODO 核验')
  assert.equal((await store.listTodoWatches()).find((record) => record.kind === 'verify').status, 'watching')
})

test('TODO 核验：判卷稿用全文，候选不设 16 条上限', async () => {
  const { store } = await makeStore()
  const task = await makeCheckpointTask(store)
  const items = []
  for (let index = 0; index < 24; index += 1) {
    items.push({
      kind: 'verify',
      title: `条件 ${index + 1}`,
      detail: `第 ${index + 1} 条待验证条件。`,
      dueAt: '2026-11-04',
      sourceQuote: `第 ${index + 1} 条待验证条件。`,
    })
  }
  for (let batch = 0; batch < 4; batch += 1) {
    await addBrief(store, task, items.slice(batch * 6, batch * 6 + 6), { key: `watch-all-${batch}` })
  }
  const llm = fakeLlm('{"results":[]}')
  const watches = watchService(store, llm)
  const run = (await store.listRunsPage({ limit: 20 })).runs[0]
  const longText = `复盘开头\n${'长'.repeat(20_000)}\n尾部标记`
  watches.onBriefReady({
    run,
    task,
    text: longText,
    route: { provider: 'p', model: 'm' },
  })
  await watches.flush()
  assert.equal(llm.calls.length, 1)
  const payload = JSON.parse(llm.calls[0].messages[0].content[0].text)
  assert.equal(payload.todos.length, 24, '所有 watching 的 verify 都要进入判卷，不再截 16 条')
  assert.ok(payload.sourceBlocks.some((block) => block.text.length > 12_000), '终稿正文不能被 12k 截断')
  assert.match(payload.sourceBlocks.at(-1).text, /尾部标记/, '全文最后一行必须进入判卷')
})

async function todoIdOf(store) {
  const board = boardService(store)
  const todos = await board.openTodos({ days: '14', tz: TZ })
  return todos.find((item) => item.kind === 'verify').id
}
