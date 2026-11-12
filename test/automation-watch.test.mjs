import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createAutomationStore } from '../automation/store.js'
import { createBoardService } from '../automation/board.js'
import { createTodoWatchService, parseVerifierBrief, parseWatchOutput } from '../automation/watch.js'
import { tradingCalendar } from '../automation/calendar.js'
import { createFakeDomain } from './automation-harness.mjs'

const NOW = Date.parse('2026-11-04T02:00:00Z')
const TZ = 'Asia/Shanghai'
const PLAIN = '昨晚美国科技股继续下跌，市场怕的是它们之前涨得太贵。国内出了稳市场的新办法，但真正买股票的钱还没进来。今天开盘先看科技股能不能止跌，不然大盘还会被它们拖着走。'
const TOOL_TEXT = '指南针今日收盘 44.55 元，站回 44.01。\n腾讯今日收 417.8 港元，量能 0.61 倍。'

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

async function makeVerifierTask(store) {
  const tasks = await store.listTasks()
  return tasks.find((task) => task.sourceBuiltinId === 'todo-verifier-close')
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

function boardService(store, now = NOW) {
  return createBoardService({
    store,
    scheduler: {
      status: () => ({ state: 'active', calendar: { available: true, coverageDays: 420 } }),
      displayNext: (task) => ({ kind: 'occurrence', scheduledFor: '2026-11-05T00:00:00.000Z', taskId: task.id }),
    },
    now: () => now,
  })
}

function watchService(store, now = NOW) {
  return createTodoWatchService({
    store,
    board: boardService(store, now),
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

function verifierAnswer(id, { verdict = 'triggered', evidence = '指南针今日收盘 44.55 元，站回 44.01。', source = 'eastmoney_quote · 2026-11-04 15:00', brief } = {}) {
  return `\`\`\`json\n${JSON.stringify({
    ...(brief === undefined ? {} : { brief }),
    results: [{ id, verdict, confidence: 'high', evidence, source }],
  }, null, 2)}\n\`\`\``
}

test('TODO 核验：同一终稿里的 brief 直接取用，不再额外请求模型', () => {
  const brief = { headline: '1 条核验已触发', plain: '指南针今日收盘 44.55 元，站回 44.01，成交量 1.2 亿，来源 eastmoney_quote。' }
  assert.deepEqual(parseVerifierBrief(verifierAnswer('verify|x|y', { brief })), brief)
  assert.equal(parseVerifierBrief('{"results":[]}'), undefined)
  assert.equal(parseVerifierBrief('not json'), undefined)
})

test('TODO 核验输出：工具原文外的引用、未知 id 与低置信度都不能当成触发', () => {
  const todos = [{ id: 'verify|x|y', kind: 'verify', title: '站回 44.01' }]
  const sourceText = TOOL_TEXT
  const blocks = [{ id: 1, text: TOOL_TEXT }]
  const parsed = parseWatchOutput(JSON.stringify({
    results: [
      { id: 'verify|x|y', verdict: 'triggered', confidence: 'high', evidence: '收盘 44.55 元', source: 'quote' },
      { id: 'unknown', verdict: 'triggered', confidence: 'high', evidence: '收盘 44.55 元', source: 'quote' },
      { id: 'verify|x|y', verdict: 'triggered', confidence: 'low', evidence: '站回 44.01', source: 'quote' },
    ],
  }), { todos, blocks, sourceText })
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].verdict, 'triggered')
  assert.equal(parsed[0].confidence, 'high')
  assert.equal(parsed[0].source, 'quote')

  const fabricated = parseWatchOutput(JSON.stringify({
    results: [{ id: 'verify|x|y', verdict: 'triggered', confidence: 'high', evidence: '收盘 45.00 元', source: 'quote' }],
  }), { todos, blocks, sourceText })
  assert.deepEqual(fabricated, [], '工具结果里没有的数值不能作为核验依据')

  const wrapped = parseWatchOutput(`核验完成\n\`\`\`json\n${JSON.stringify({
    results: [{ id: 'verify|x|y', verdict: 'not_triggered', confidence: 'high', evidence: '收盘 44.55 元', source: 'quote' }],
  })}\n\`\`\`\n`, { todos, blocks, sourceText })
  assert.equal(wrapped.length, 1, 'JSON 前后带说明文字时仍能解析最后一个代码块')
})

test('TODO 核验输出：模型 JSON 的尾逗号不能把整批结论丢掉', () => {
  const todos = [{ id: 'verify|x|y', kind: 'verify', title: '站回 44.01' }]
  const blocks = [{ id: 1, text: TOOL_TEXT }]
  const raw = `核验完成\n\`\`\`json\n{"brief":{"headline":"1 条核验已触发","plain":"指南针今日收盘 44.55 元，站回 44.01。"},"results":[{"id":"verify|x|y","verdict":"triggered","confidence":"high","evidence":"收盘 44.55 元","source":"quote"},]}\n\`\`\``
  const parsed = parseWatchOutput(raw, { todos, blocks, sourceText: TOOL_TEXT })
  assert.equal(parsed.length, 1, '尾逗号不能导致整批 verdict 被丢弃')
  assert.equal(parsed[0].verdict, 'triggered')
  assert.deepEqual(parseVerifierBrief(raw), {
    headline: '1 条核验已触发',
    plain: '指南针今日收盘 44.55 元，站回 44.01。',
  })
})

test('TODO 跟踪：待验证进入 watching，待人工处理直接交给用户并写通知', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [VERIFY_ITEM, CONFIRM_ITEM], { key: 'watch-create' })
  const watches = watchService(store)

  await watches.sync()
  const records = await store.listTodoWatches()
  const verify = records.find((record) => record.todoId.startsWith('verify|'))
  const confirm = records.find((record) => record.todoId.startsWith('confirm|'))
  assert.equal(verify.status, 'watching')
  assert.equal(verify.checkedAt, undefined)
  assert.equal(confirm.status, 'needs_human')
  assert.match(confirm.handoffReason, /看板 TODO 处理/)

  const notifications = await store.listNotifications({ limit: 20 })
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].kind, 'todo_needs_human')
  assert.equal(notifications[0].todoId, confirm.todoId)
  assert.match(notifications[0].title, /待人工处理：/)

  await watches.sync()
  assert.equal((await store.listNotifications({ limit: 20 })).length, 1, '同一状态不重复通知')
})

test('TODO 核验：候选注入只发 A/H 与无标的条目，美股留给后续窗口', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  const usItem = {
    ...VERIFY_ITEM,
    title: '英伟达收盘跌破 181.46',
    symbol: 'NVDA.OQ',
    trigger: '收盘跌破 181.46',
  }
  const bareUsItem = {
    ...VERIFY_ITEM,
    title: 'CoreWeave 财报指引能否兑现',
    symbol: 'CRWV',
    trigger: '指引兑现',
  }
  await addBrief(store, task, [VERIFY_ITEM, usItem, bareUsItem], { key: 'watch-context' })
  const watches = watchService(store)
  await watches.sync()

  const verifier = await makeVerifierTask(store)
  const context = await watches.promptContextFor(verifier)
  assert.ok(context)
  assert.match(context.text, /"brief"/, '核验 prompt 要求同一次终稿写出看板简报')
  assert.match(context.text, /给用户看的核验依据/, 'evidence 是展示文案，不是工具原文片段')
  assert.match(context.text, /不要出现内部 ID/)
  assert.match(context.text, /data_ds_/)
  assert.doesNotMatch(context.text, /"evidence":"工具结果中的原文片段"/)
  assert.match(context.text, /300803\.SZ/)
  assert.doesNotMatch(context.text, /NVDA\.OQ/)
  assert.doesNotMatch(context.text, /CRWV/, '无后缀美股代码也不能送进 A/H 核验')
  assert.equal(context.empty, false)
  assert.equal(await watches.hasCandidates(verifier), true)
  assert.equal(await watches.hasCandidates(task), true, '非核验任务不受候选检查影响')
})

test('TODO 核验：专用任务给出工具原文证据后标记触发，且只通知一次', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [VERIFY_ITEM], { key: 'watch-trigger' })
  const verifier = await makeVerifierTask(store)
  const run = await addBrief(store, verifier, [], { key: 'verifier-run' })
  const watches = watchService(store)
  await watches.sync()
  const id = await todoIdOf(store)

  const authored = {
    headline: '1 条核验已触发',
    plain: '指南针今日收盘 44.55 元，站回 44.01，成交量 1.2 亿，来源 eastmoney_quote。',
  }
  const summary = await watches.onFinalAnswer({
    run,
    task: verifier,
    text: verifierAnswer(id, { brief: authored }),
    toolText: TOOL_TEXT,
  })
  assert.deepEqual(summary.brief, authored)
  assert.equal(summary.checked, 1)
  assert.deepEqual(summary.triggered.map((entry) => entry.title), [VERIFY_ITEM.title])
  assert.equal(summary.notTriggered + summary.needsHuman + summary.expired, 0)
  const verify = (await store.listTodoWatches()).find((record) => record.kind === 'verify')
  assert.equal(verify.status, 'triggered')
  assert.equal(verify.verdict, 'triggered')
  assert.match(verify.evidence, /44\.55/)
  assert.equal(verify.source, 'eastmoney_quote · 2026-11-04 15:00')
  assert.equal(verify.evidenceRunId, run.id)
  const notifications = (await store.listNotifications({ limit: 20 })).filter((item) => item.kind === 'todo_triggered')
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].todoId, verify.todoId)

  await watches.onFinalAnswer({
    run,
    task: verifier,
    text: verifierAnswer(id),
    toolText: TOOL_TEXT,
  })
  assert.equal((await store.listNotifications({ limit: 20 })).filter((item) => item.kind === 'todo_triggered').length, 1, '重复核验不重复通知')
})

test('TODO 核验任务：读取 session 的终稿与工具原文后应用结果', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [VERIFY_ITEM], { key: 'watch-read' })
  const verifier = await makeVerifierTask(store)
  const run = await addBrief(store, verifier, [], { key: 'verifier-read' })
  const watches = createTodoWatchService({
    store,
    board: boardService(store),
    now: () => NOW,
    getSettings: () => ({ inAppNotifications: true }),
    readAnswer: async () => ({
      text: verifierAnswer(await todoIdOf(store)),
      toolText: TOOL_TEXT,
    }),
  })
  await watches.sync()
  const summary = await watches.onVerifierRun({ run, task: verifier })
  assert.equal(summary.checked, 1)
  assert.equal(summary.triggered.length, 1)
  const verify = (await store.listTodoWatches()).find((record) => record.kind === 'verify')
  assert.equal(verify.status, 'triggered')
  assert.match(verify.evidence, /44\.55/)
})

test('TODO 核验：数据不足交给用户，未返回结论的候选也不能静默漏掉', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [VERIFY_ITEM], { key: 'watch-handoff' })
  const verifier = await makeVerifierTask(store)
  const run = await addBrief(store, verifier, [], { key: 'verifier-handoff' })
  const watches = watchService(store)
  await watches.sync()
  const id = await todoIdOf(store)

  await watches.onFinalAnswer({
    run,
    task: verifier,
    text: verifierAnswer(id, { verdict: 'insufficient', evidence: '腾讯今日收 417.8 港元，量能 0.61 倍。' }),
    toolText: TOOL_TEXT,
  })
  const verify = (await store.listTodoWatches()).find((record) => record.kind === 'verify')
  assert.equal(verify.status, 'needs_human')
  assert.match(verify.handoffReason, /同口径数据|没有找到/)
  assert.equal((await store.listNotifications({ limit: 20 })).filter((item) => item.kind === 'todo_needs_human').length, 1)

  const second = await addBrief(store, task, [{ ...VERIFY_ITEM, title: '另一条待验证条件', trigger: '另一条条件' }], { key: 'watch-missing' })
  void second
  await watches.sync()
  const verifierRun = await addBrief(store, verifier, [], { key: 'verifier-missing' })
  await watches.onFinalAnswer({
    run: verifierRun,
    task: verifier,
    text: '```json\n{"results":[]}\n```',
    toolText: TOOL_TEXT,
  })
  const secondWatch = (await store.listTodoWatches()).find((record) => record.title === '另一条待验证条件')
  assert.equal(secondWatch.status, 'needs_human')
  assert.match(secondWatch.handoffReason, /没有返回/)
})

test('TODO 核验：非核验任务不能写 watch 状态', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [VERIFY_ITEM], { key: 'watch-gate' })
  const run = await addBrief(store, task, [VERIFY_ITEM], { key: 'watch-gate-run' })
  const watches = watchService(store)
  await watches.sync()
  await watches.onFinalAnswer({
    run,
    task,
    text: verifierAnswer(await todoIdOf(store)),
    toolText: TOOL_TEXT,
  })
  const verify = (await store.listTodoWatches()).find((record) => record.kind === 'verify')
  assert.equal(verify.status, 'watching')
})

test('TODO 核验：候选按到期日排序，超过上限时只送前一批', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  const items = []
  for (let index = 0; index < 32; index += 1) {
    items.push({
      kind: 'verify',
      title: `条件 ${index + 1}`,
      detail: `第 ${index + 1} 条待验证条件。`,
      dueAt: '2026-11-04',
      sourceQuote: `第 ${index + 1} 条待验证条件。`,
    })
  }
  for (let batch = 0; batch < 6; batch += 1) {
    await addBrief(store, task, items.slice(batch * 6, batch * 6 + 6), { key: `watch-all-${batch}` })
  }
  const verifier = await makeVerifierTask(store)
  const watches = watchService(store)
  await watches.sync()
  const context = await watches.promptContextFor(verifier)
  assert.equal(context.candidates.length, 30, '单批上限 30，剩余条目留到下一窗口')
})

test('TODO 跟踪：到期后直接归档，不再转人工或通知', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [VERIFY_ITEM], { key: 'watch-overdue' })
  const first = watchService(store)
  await first.sync()
  assert.equal((await store.listTodoWatches())[0].status, 'watching')

  const nextDay = watchService(store, NOW + 24 * 60 * 60_000)
  await nextDay.sync()
  const watch = (await store.listTodoWatches())[0]
  assert.equal(watch.status, 'expired')
  assert.equal(watch.expiredReason, 'not_verified')
  assert.equal(watch.autoRequestedAt, undefined)
  const notifications = (await store.listNotifications({ limit: 20 })).filter((item) => item.kind === 'todo_needs_human')
  assert.equal(notifications.length, 0, '过期归档不再新增人工通知')
})

test('TODO 跟踪：到期后待人工直接归档，过期条目不再进入候选', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [VERIFY_ITEM], { key: 'watch-overdue-human' })
  const watches = watchService(store)
  await watches.sync()
  const before = (await store.listTodoWatches())[0]
  assert.equal(before.status, 'watching')

  const verifier = await makeVerifierTask(store)
  const run = await addBrief(store, verifier, [], { key: 'watch-overdue-human-run' })
  await watches.onFinalAnswer({
    run,
    task: verifier,
    text: verifierAnswer(before.todoId, { verdict: 'insufficient' }),
    toolText: TOOL_TEXT,
  })
  assert.equal((await store.listTodoWatches())[0].status, 'needs_human')

  const nextAt = NOW + 24 * 60 * 60_000
  const nextDay = watchService(store, nextAt)
  await nextDay.sync()
  const watch = (await store.listTodoWatches())[0]
  assert.equal(watch.status, 'expired')
  assert.equal(watch.expiredReason, 'no_data')
  assert.equal(watch.handoffReason, undefined)
  const nextBoard = await boardService(store, nextAt).openTodos({ days: '14', tz: TZ })
  assert.equal(nextBoard.find((item) => item.id === watch.todoId).watch.expiredReason, 'no_data', '看板摘要必须带过期原因')
  const context = await nextDay.promptContextFor(verifier)
  assert.equal(context.candidates.length, 0, '过期条目不再送给核验')
  await assert.rejects(
    boardService(store, nextAt).decideTodo(watch.todoId, 'auto'),
    (error) => error.code === 'todo_expired',
    '过期条目不能再转入自动核验',
  )
})

test('TODO 跟踪：到期前未触发，到期后归档为 not_triggered', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [VERIFY_ITEM], { key: 'watch-overdue-miss' })
  const watches = watchService(store)
  await watches.sync()
  const before = (await store.listTodoWatches())[0]
  const verifier = await makeVerifierTask(store)
  const run = await addBrief(store, verifier, [], { key: 'watch-overdue-miss-run' })
  await watches.onFinalAnswer({
    run,
    task: verifier,
    text: verifierAnswer(before.todoId, { verdict: 'not_triggered' }),
    toolText: TOOL_TEXT,
  })
  assert.equal((await store.listTodoWatches())[0].status, 'watching')

  const nextDay = watchService(store, NOW + 24 * 60 * 60_000)
  await nextDay.sync()
  const watch = (await store.listTodoWatches())[0]
  assert.equal(watch.status, 'expired')
  assert.equal(watch.expiredReason, 'not_triggered')
})

test('TODO 跟踪：已触发条目到期后仍留在今天，不自动归档', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [VERIFY_ITEM], { key: 'watch-overdue-trigger' })
  const watches = watchService(store)
  await watches.sync()
  const before = (await store.listTodoWatches())[0]
  const at = new Date(NOW).toISOString()
  await store.putTodoWatch({
    ...before,
    status: 'triggered',
    checkedAt: at,
    verdict: 'triggered',
    evidence: '指南针今日收盘 44.55 元，站回 44.01。',
    updatedAt: at,
  })

  const nextDay = watchService(store, NOW + 24 * 60 * 60_000)
  await nextDay.sync()
  const watch = (await store.listTodoWatches())[0]
  assert.equal(watch.status, 'triggered', '已触发是事实，不随到期日归档')
  assert.equal(watch.expiredReason, undefined)
})

test('TODO 跟踪：3 天没有新运行提到，watch 归档为 stale', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [CONFIRM_ITEM], { key: 'watch-stale-reason' })
  await watchService(store).sync()
  assert.equal((await store.listTodoWatches())[0].status, 'needs_human')

  const later = watchService(store, NOW + 4 * 24 * 60 * 60_000)
  await later.sync()
  const watch = (await store.listTodoWatches())[0]
  assert.equal(watch.status, 'expired')
  assert.equal(watch.expiredReason, 'stale')
})

test('TODO 跟踪：用户确认后 watch 收口为 resolved', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [CONFIRM_ITEM], { key: 'watch-ack' })
  const watches = watchService(store)
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
  const task = await makeTask(store)
  await addBrief(store, task, [VERIFY_ITEM], { key: 'watch-trigger-ack' })
  const watches = watchService(store)
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
  const watches = watchService(store)
  await watches.sync()
  assert.equal((await store.listTodoWatches()).length, 0)
})

test('TODO 决定：忽略软关闭当前版本，新版本重新打开', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [CONFIRM_ITEM], { key: 'defer-close' })
  const watches = watchService(store)
  await watches.sync()
  const before = (await store.listTodoWatches())[0]
  assert.equal(before.status, 'needs_human')

  const board = boardService(store)
  const result = await board.decideTodo(before.todoId, 'defer')
  assert.equal(result.decision, 'deferred')
  const closed = (await store.listTodoWatches())[0]
  assert.equal(closed.status, 'resolved')
  assert.equal(closed.resolvedFrom, 'needs_human')

  const deferredBoard = await board.board({ days: '14', tz: TZ })
  const deferredItem = deferredBoard.todos.find((item) => item.id === before.todoId)
  assert.equal(deferredItem.decision, 'deferred')
  assert.equal(deferredItem.deferredAt, result.decidedAt)
  assert.equal(deferredItem.ackedAt, undefined)
  assert.equal(deferredBoard.stats.todos, 0, '忽略不计入今日 TODO')

  const notifyCount = (await store.listNotifications({ limit: 20 })).length
  await watches.sync()
  assert.equal((await store.listNotifications({ limit: 20 })).length, notifyCount, '忽略后不再提醒')

  await addBrief(store, task, [CONFIRM_ITEM], { key: 'defer-reopen', finishedAt: '2026-11-05T01:40:32.876Z' })
  const nextDay = watchService(store, NOW + 24 * 60 * 60_000)
  await nextDay.sync()
  const reopened = (await store.listTodoWatches())[0]
  assert.equal(reopened.status, 'needs_human', '新版本重新打开人工确认')
  const reopenedBoard = await boardService(store, NOW + 24 * 60 * 60_000).board({ days: '14', tz: TZ })
  assert.equal(reopenedBoard.todos.find((item) => item.id === before.todoId).deferredAt, undefined, '新版本不再沿用忽略决定')
})

test('TODO 决定：confirm 转入自动核验后进入候选，失败退回人工', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [CONFIRM_ITEM], { key: 'auto-confirm' })
  const watches = watchService(store)
  await watches.sync()
  const before = (await store.listTodoWatches())[0]
  assert.equal(before.status, 'needs_human')

  const board = boardService(store)
  const promoted = await board.decideTodo(before.todoId, 'auto')
  assert.equal(promoted.status, 'watching')
  const watch = (await store.listTodoWatches())[0]
  assert.equal(watch.status, 'watching')
  assert.equal(typeof watch.autoRequestedAt, 'string')

  const verifier = await makeVerifierTask(store)
  const context = await watches.promptContextFor(verifier)
  assert.equal(context.candidates.some((candidate) => candidate.id === before.todoId), true, 'confirm 转入后必须进入候选')

  const run = await addBrief(store, verifier, [], { key: 'auto-confirm-run' })
  await watches.onFinalAnswer({
    run,
    task: verifier,
    text: verifierAnswer(before.todoId, { verdict: 'insufficient' }),
    toolText: TOOL_TEXT,
  })
  const after = (await store.listTodoWatches())[0]
  assert.equal(after.status, 'needs_human', '核验失败退回人工')
  assert.equal(after.autoRequestedAt, undefined, '一次请求只尝试一轮')
  assert.match(after.handoffReason, /同口径数据|人工判断/)
})

test('TODO 决定：忽略后不再进入自动核验候选', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  await addBrief(store, task, [VERIFY_ITEM], { key: 'defer-candidate' })
  const watches = watchService(store)
  await watches.sync()
  const before = (await store.listTodoWatches())[0]
  assert.equal(before.status, 'watching')

  const board = boardService(store)
  await board.decideTodo(before.todoId, 'defer')
  const verifier = await makeVerifierTask(store)
  const context = await watches.promptContextFor(verifier)
  assert.equal(context.candidates.length, 0, '用户忽略的条目不进入候选')
  assert.equal(await watches.hasCandidates(verifier), false)
})

test('TODO 决定：美股和未跟踪条目不能转入自动核验', async () => {
  const { store } = await makeStore()
  const task = await makeTask(store)
  const usItem = {
    ...VERIFY_ITEM,
    title: '英伟达收盘跌破 181.46',
    symbol: 'NVDA.OQ',
    trigger: '收盘跌破 181.46',
  }
  const trackItem = {
    kind: 'track',
    title: '只跟踪的油价方向',
    detail: '仅展示，不自动核验。',
    dueAt: '2026-11-04',
    sourceQuote: '油价方向只在简报里跟踪。',
  }
  await addBrief(store, task, [usItem, trackItem], { key: 'auto-reject' })
  const watches = watchService(store)
  await watches.sync()
  const board = boardService(store)
  const todos = await board.openTodos({ days: '14', tz: TZ })
  const usTodo = todos.find((item) => item.symbol === 'NVDA.OQ')
  const trackId = todos.find((item) => item.kind === 'track').id
  assert.equal(usTodo.watch.autoEligible, false, '美股不能转入自动核验')
  assert.equal(usTodo.watch.autoIneligibleReason, 'us_symbol', '美股必须带禁用原因')

  await assert.rejects(board.decideTodo(usTodo.id, 'auto'), (error) => error.code === 'todo_auto_unsupported')
  await assert.rejects(board.decideTodo(trackId, 'auto'), (error) => error.code === 'todo_not_tracked')
})

async function todoIdOf(store) {
  const board = boardService(store)
  const todos = await board.openTodos({ days: '14', tz: TZ })
  return todos.find((item) => item.kind === 'verify').id
}
