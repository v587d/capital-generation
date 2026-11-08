/**
 * Read-time projections for the board. A brief is the only durable board record; TODO, stock
 * radar and data-health rows are merged from briefs here so the three views cannot drift apart.
 */
import { TaskCategorySchema, isValidTimeZone } from './schema.js'
import { taskIconId } from './task-icons.js'
import { addDays, localPartsAt } from './time.js'

const DAY_VALUES = new Set(['7', '14', '30', 'all'])
const DEFAULT_DAYS = '14'
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 50
const MAX_TODOS = 50
const MAX_STOCKS = 12
const MAX_GAPS = 20
const HEALTH_DAYS = 7
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/
const CATEGORY_VALUES = new Set(TaskCategorySchema.options)
const FAILURE_STATUSES = new Set(['failed', 'timed_out', 'blocked_requires_user', 'unknown_after_restart', 'missed'])
const KIND_RANK = { confirm: 0, verify: 1, track: 2 }
const GAP_RANK = { capability: 0, conflict: 1, quality: 2, transient: 3 }
const ROLE_RANK = { holding: 0, risk: 1, event: 2, watch: 3 }

export class BoardError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'BoardError'
    this.code = code
    this.status = status
    this.boardError = true
  }
}

function iso(now) {
  return new Date(now).toISOString()
}

function parseDays(value) {
  if (value === undefined || value === '') return DEFAULT_DAYS
  if (typeof value !== 'string' || !DAY_VALUES.has(value)) {
    throw new BoardError('invalid_query', 'days 必须是 7 / 14 / 30 / all。')
  }
  return value
}

function parseTimeZone(value) {
  if (value === undefined || value === '') {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
    } catch {
      return 'Asia/Shanghai'
    }
  }
  if (typeof value !== 'string' || !isValidTimeZone(value)) {
    throw new BoardError('invalid_query', 'tz 参数无效。')
  }
  return value
}

function parseLimit(value) {
  if (value === undefined || value === '') return DEFAULT_LIMIT
  if (typeof value !== 'string' || !/^[1-9]\d?$/.test(value)) {
    throw new BoardError('invalid_query', 'limit 必须是 1–50 的整数。')
  }
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new BoardError('invalid_query', 'limit 必须是 1–50 的整数。')
  }
  return limit
}

function parseBefore(value) {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value)) {
    throw new BoardError('invalid_cursor', '分页游标无效。')
  }
  return value
}

function parseCategory(value) {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !CATEGORY_VALUES.has(value)) {
    throw new BoardError('invalid_query', 'category 参数无效。')
  }
  return value
}

export function parseBoardQuery(query = {}, now = () => Date.now()) {
  const days = parseDays(query.days)
  const timeZone = parseTimeZone(query.tz)
  const limit = parseLimit(query.limit)
  const before = parseBefore(query.before)
  const category = parseCategory(query.category)
  const today = localPartsAt(now(), timeZone).date
  const from = days === 'all' ? undefined : addDays(today, -(Number(days) - 1)).date
  return { days, timeZone, limit, before, category, from, to: today }
}

function dateOf(isoInstant, timeZone) {
  if (typeof isoInstant !== 'string') return undefined
  const instant = Date.parse(isoInstant)
  if (!Number.isFinite(instant)) return undefined
  return localPartsAt(instant, timeZone).date
}

function inRange(value, from, to, timeZone) {
  const date = dateOf(value, timeZone)
  if (date === undefined) return false
  if (from !== undefined && date < from) return false
  return date <= to
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s|,，。；;:：()[\]{}'"“”‘’\-_/]+/g, '')
}

function todoKey(item) {
  if (item.kind === 'confirm') return `confirm|${item.symbol ?? normalize(item.title)}`
  if (item.kind === 'verify') return `verify|${item.symbol ?? ''}|${normalize(item.trigger ?? item.detail ?? item.title)}`
  return `track|${item.symbol ?? ''}|${item.dueAt ?? normalize(item.title)}`
}

/** An ack hides only the version the user saw; a later run makes the item visible again. */
function todoAckCovers(ack, item) {
  if (ack === undefined) return false
  const confirmedAt = Date.parse(ack.confirmedAt)
  const lastSeenAt = Date.parse(item.lastSeenAt)
  if (!Number.isFinite(confirmedAt) || !Number.isFinite(lastSeenAt)) return true
  return lastSeenAt <= confirmedAt
}

function sourceOf(run, item) {
  return {
    runId: run.id,
    taskTitle: run.taskTitle,
    finishedAt: run.finishedAt ?? run.queuedAt,
    sessionId: run.sessionId ?? null,
    sourceQuote: item.sourceQuote,
  }
}

function aggregateTodos(entries) {
  const byKey = new Map()
  for (const { run, brief } of entries) {
    if (brief.status !== 'ready') continue
    for (const item of brief.items) {
      const key = todoKey(item)
      const at = run.finishedAt ?? run.queuedAt
      const source = sourceOf(run, item)
      const current = byKey.get(key)
      if (current === undefined) {
        byKey.set(key, {
          id: key,
          ...item,
          runId: run.id,
          taskTitle: run.taskTitle,
          finishedAt: at,
          sessionId: run.sessionId ?? null,
          seenCount: 1,
          firstSeenAt: at,
          lastSeenAt: at,
          sources: [source],
          runIds: new Set([run.id]),
        })
        continue
      }
      if (!current.runIds.has(run.id)) {
        current.runIds.add(run.id)
        current.seenCount += 1
      }
      if (at >= current.lastSeenAt) {
        current.title = item.title
        current.detail = item.detail
        current.symbol = item.symbol
        current.trigger = item.trigger
        current.dueAt = item.dueAt
        current.dueLabel = item.dueLabel
        current.sourceQuote = item.sourceQuote
        current.runId = run.id
        current.taskTitle = run.taskTitle
        current.finishedAt = at
        current.sessionId = run.sessionId ?? null
        current.lastSeenAt = at
      }
      if (at < current.firstSeenAt) current.firstSeenAt = at
      if (!current.sources.some((entry) => entry.runId === run.id) && current.sources.length < 5) {
        current.sources.push(source)
      }
    }
  }
  const result = [...byKey.values()].map(({ runIds: _runIds, ...item }) => item)
  result.sort((left, right) => {
    const kind = (KIND_RANK[left.kind] ?? 9) - (KIND_RANK[right.kind] ?? 9)
    if (kind !== 0) return kind
    const due = String(left.dueAt ?? '9999-12-31').localeCompare(String(right.dueAt ?? '9999-12-31'))
    if (due !== 0) return due
    return String(right.lastSeenAt).localeCompare(String(left.lastSeenAt)) || String(left.id).localeCompare(String(right.id))
  })
  return result
}

function aggregateStocks(entries, todos) {
  const bySymbol = new Map()
  for (const { run, brief } of entries) {
    if (brief.status !== 'ready') continue
    for (const stock of brief.stocks) {
      const at = run.finishedAt ?? run.queuedAt
      const current = bySymbol.get(stock.symbol)
      if (current === undefined) {
        bySymbol.set(stock.symbol, {
          symbol: stock.symbol,
          name: stock.name,
          roles: new Set(stock.roles),
          note: stock.note,
          nextAt: stock.nextAt,
          lastSeenAt: at,
        })
        continue
      }
      for (const role of stock.roles) current.roles.add(role)
      if (at >= current.lastSeenAt) {
        current.name = stock.name
        current.note = stock.note
        current.lastSeenAt = at
      }
      if (stock.nextAt !== undefined && (current.nextAt === undefined || stock.nextAt < current.nextAt)) current.nextAt = stock.nextAt
    }
  }
  const todoCounts = new Map()
  for (const item of todos) if (item.symbol !== undefined) todoCounts.set(item.symbol, (todoCounts.get(item.symbol) ?? 0) + 1)
  const result = [...bySymbol.values()].map((stock) => ({
    symbol: stock.symbol,
    name: stock.name,
    roles: [...stock.roles].sort((left, right) => (ROLE_RANK[left] ?? 9) - (ROLE_RANK[right] ?? 9)),
    ...(stock.note === undefined ? {} : { note: stock.note }),
    ...(stock.nextAt === undefined ? {} : { nextAt: stock.nextAt }),
    todoCount: todoCounts.get(stock.symbol) ?? 0,
    lastSeenAt: stock.lastSeenAt,
  }))
  result.sort((left, right) => {
    const role = (ROLE_RANK[left.roles[0]] ?? 9) - (ROLE_RANK[right.roles[0]] ?? 9)
    if (role !== 0) return role
    return String(right.lastSeenAt).localeCompare(String(left.lastSeenAt)) || left.symbol.localeCompare(right.symbol)
  })
  return result
}

function aggregateGaps(entries) {
  const byKey = new Map()
  for (const { run, brief } of entries) {
    if (brief.status !== 'ready') continue
    for (const gap of brief.gaps) {
      const key = `${gap.kind}|${normalize(gap.topic)}`
      const at = run.finishedAt ?? run.queuedAt
      const source = {
        runId: run.id,
        taskTitle: run.taskTitle,
        finishedAt: at,
        sessionId: run.sessionId ?? null,
        sourceQuote: gap.sourceQuote,
      }
      const current = byKey.get(key)
      if (current === undefined) {
        byKey.set(key, {
          id: key,
          ...gap,
          seenCount: 1,
          firstSeenAt: at,
          lastSeenAt: at,
          sources: [source],
          runIds: new Set([run.id]),
        })
        continue
      }
      if (!current.runIds.has(run.id)) {
        current.runIds.add(run.id)
        current.seenCount += 1
      }
      if (at >= current.lastSeenAt) {
        current.detail = gap.detail
        current.sourceQuote = gap.sourceQuote
        current.lastSeenAt = at
      }
      if (at < current.firstSeenAt) current.firstSeenAt = at
      if (!current.sources.some((entry) => entry.runId === run.id) && current.sources.length < 5) current.sources.push(source)
    }
  }
  const result = [...byKey.values()].map(({ runIds: _runIds, ...gap }) => gap)
  result.sort((left, right) => {
    const kind = (GAP_RANK[left.kind] ?? 9) - (GAP_RANK[right.kind] ?? 9)
    if (kind !== 0) return kind
    const seen = right.seenCount - left.seenCount
    if (seen !== 0) return seen
    return String(right.lastSeenAt).localeCompare(String(left.lastSeenAt)) || String(left.id).localeCompare(String(right.id))
  })
  return result
}

function statusCounts(runs) {
  const counts = {
    total: runs.length,
    succeeded: 0,
    failed: 0,
    timedOut: 0,
    missed: 0,
    unknown: 0,
    blocked: 0,
    active: 0,
  }
  for (const run of runs) {
    if (run.status === 'succeeded') counts.succeeded += 1
    else if (run.status === 'failed') counts.failed += 1
    else if (run.status === 'timed_out') counts.timedOut += 1
    else if (run.status === 'missed') counts.missed += 1
    else if (run.status === 'unknown_after_restart') counts.unknown += 1
    else if (run.status === 'blocked_requires_user') counts.blocked += 1
    else if (['queued', 'starting', 'running'].includes(run.status)) counts.active += 1
  }
  return counts
}

function briefCounts(briefs) {
  const counts = { ready: 0, pending: 0, failed: 0, skipped: 0 }
  for (const brief of briefs) {
    if (Object.prototype.hasOwnProperty.call(counts, brief.status)) counts[brief.status] += 1
  }
  return counts
}

function healthOf({ runs, briefs, timeZone, now, scheduler, tasks }) {
  const today = localPartsAt(now, timeZone).date
  const from = addDays(today, -(HEALTH_DAYS - 1)).date
  const windowRuns = runs.filter((run) => inRange(run.finishedAt ?? run.queuedAt, from, today, timeZone))
  const counts = statusCounts(windowRuns)
  const windowRunIds = new Set(windowRuns.map((run) => run.id))
  const windowBriefs = [...briefs.values()].filter((brief) => windowRunIds.has(brief.runId))
  const ordered = [...windowRuns].sort((left, right) =>
    String(right.finishedAt ?? right.queuedAt).localeCompare(String(left.finishedAt ?? left.queuedAt))
    || String(right.id).localeCompare(String(left.id)))
  const recentIssues = []
  for (const run of ordered) {
    if (!FAILURE_STATUSES.has(run.status)) continue
    const recoveredBy = ordered.find((candidate) =>
      candidate.taskId === run.taskId
      && candidate.status === 'succeeded'
      && Date.parse(candidate.finishedAt ?? candidate.queuedAt) > Date.parse(run.finishedAt ?? run.queuedAt)
      && Date.parse(candidate.finishedAt ?? candidate.queuedAt) - Date.parse(run.finishedAt ?? run.queuedAt) <= 86_400_000)
    recentIssues.push({
      runId: run.id,
      taskId: run.taskId,
      taskTitle: run.taskTitle,
      status: run.status,
      finishedAt: run.finishedAt ?? run.queuedAt,
      sessionId: run.sessionId ?? null,
      message: run.errors.at(-1)?.message ?? '',
      ...(recoveredBy === undefined ? {} : { recoveredByRunId: recoveredBy.id }),
    })
    if (recentIssues.length >= 5) break
  }
  const schedulerStatus = scheduler?.status?.() ?? { state: 'unavailable' }
  const nextRuns = tasks
    .filter((task) => task.state === 'active')
    .map((task) => {
      const next = scheduler?.displayNext?.(task)
      if (next?.kind !== 'occurrence') return undefined
      return { taskId: task.id, taskTitle: task.title, nextAt: next.scheduledFor }
    })
    .filter((item) => item !== undefined)
    .sort((left, right) => String(left.nextAt).localeCompare(String(right.nextAt)))
    .slice(0, 3)
  return {
    windowDays: HEALTH_DAYS,
    runs: counts,
    briefs: briefCounts(windowBriefs),
    scheduler: { state: schedulerStatus.state ?? 'unavailable' },
    calendar: schedulerStatus.calendar ?? { available: false, source: 'none' },
    recentIssues,
    issueCount: ordered.filter((run) => FAILURE_STATUSES.has(run.status)).length,
    nextRuns,
  }
}

function cardOf(run, brief, task) {
  return {
    runId: run.id,
    taskId: run.taskId,
    taskTitle: run.taskTitle,
    category: task?.category ?? 'research',
    // Cards keep the task's identity tile: custom tasks show the icon they were created with,
    // builtins their fixed glyph. The fallback only covers a task record missing from the store.
    origin: task?.origin ?? 'builtin',
    icon: taskIconId(task),
    trigger: run.trigger,
    finishedAt: run.finishedAt ?? run.queuedAt,
    sessionId: run.sessionId ?? null,
    brief: brief === undefined ? null : {
      status: brief.status,
      headline: brief.headline ?? null,
      plain: brief.plain ?? null,
      coverage: brief.coverage ?? null,
      error: brief.error ?? null,
      generatedAt: brief.generatedAt ?? null,
      counts: {
        items: brief.items.length,
        stocks: brief.stocks.length,
        gaps: brief.gaps.length,
      },
    },
  }
}

export function createBoardService(options) {
  const { store, scheduler, now = () => Date.now() } = options

  async function board(query = {}) {
    const parsed = parseBoardQuery(query, now)
    const page = await store.listRunsPage({ limit: 2_000 })
    const tasks = await store.listTasks()
    const taskById = new Map(tasks.map((task) => [task.id, task]))
    const briefs = await store.listBriefsForRuns(page.runs.map((run) => run.id))
    const todoAcks = await store.listTodoAcks()
    const lifetime = await store.countBriefs()
    const entries = []
    for (const run of page.runs) {
      const brief = briefs.get(run.id)
      if (run.status !== 'succeeded' || brief === undefined) continue
      const task = taskById.get(run.taskId)
      if (parsed.category !== undefined && task?.category !== parsed.category) continue
      if (!inRange(run.finishedAt ?? run.queuedAt, parsed.from, parsed.to, parsed.timeZone)) continue
      entries.push({ run, task, brief })
    }
    entries.sort((left, right) =>
      String(right.run.finishedAt ?? right.run.queuedAt).localeCompare(String(left.run.finishedAt ?? left.run.queuedAt))
      || String(right.run.id).localeCompare(String(left.run.id)))
    let start = 0
    if (parsed.before !== undefined) {
      const index = entries.findIndex((entry) => entry.run.id === parsed.before)
      if (index === -1) throw new BoardError('invalid_cursor', '分页游标无效。')
      start = index + 1
    }
    const pageEntries = entries.slice(start, start + parsed.limit)
    const nextBefore = start + pageEntries.length < entries.length ? pageEntries.at(-1)?.run.id ?? null : null
    const ackById = new Map(todoAcks.map((ack) => [ack.todoId, ack]))
    const todos = aggregateTodos(entries).filter((item) => !todoAckCovers(ackById.get(item.id), item))
    const stocks = aggregateStocks(entries, todos)
    const gaps = aggregateGaps(entries)
    const health = healthOf({
      runs: page.runs,
      briefs,
      timeZone: parsed.timeZone,
      now: now(),
      scheduler,
      tasks,
    })
    return {
      ok: true,
      generatedAt: iso(now()),
      empty: lifetime === 0,
      range: { days: parsed.days === 'all' ? 'all' : Number(parsed.days), from: parsed.from ?? null, to: parsed.to },
      stats: {
        briefs: entries.length,
        todos: todos.length,
        stocks: stocks.length,
        gaps: gaps.length,
        issues7d: health.issueCount,
      },
      cards: pageEntries.map((entry) => cardOf(entry.run, entry.brief, entry.task)),
      todos: todos.slice(0, MAX_TODOS),
      stocks: stocks.slice(0, MAX_STOCKS),
      gaps: gaps.slice(0, MAX_GAPS),
      health,
      nextBefore: nextBefore ?? null,
    }
  }

  async function confirmTodo(todoId) {
    const record = await store.confirmTodo(todoId)
    return { id: record.todoId, confirmedAt: record.confirmedAt }
  }

  return { board, confirmTodo }
}
