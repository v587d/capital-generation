/**
 * Read-time projections for the board. A brief is the only durable board record; TODO, stock
 * radar and data-health rows are merged from briefs here so the three views cannot drift apart.
 */
import { TaskCategorySchema, isValidTimeZone } from './schema.js'
import { taskIconId } from './task-icons.js'
import { addDays, localPartsAt } from './time.js'
import { isUsSymbol } from './watch.js'

const DAY_VALUES = new Set(['7', '14', '30', 'all'])
const DEFAULT_DAYS = '14'
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 50
// The client paints 12 rows first and reveals the rest on demand. 200 leaves room for that
// interaction across a large run window without letting symbol churn inflate one response.
const MAX_STOCKS = 200
// Stock rows carry their own follow-up summaries so the count always equals what expands,
// even when the page-wide TODO slice is capped. 100 leaves ample room per instrument without
// duplicating every historical item into the board response.
const MAX_STOCK_ITEMS = 100
const HEALTH_DAYS = 7
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/
const CATEGORY_VALUES = new Set(TaskCategorySchema.options)
const FAILURE_STATUSES = new Set(['failed', 'timed_out', 'blocked_requires_user', 'unknown_after_restart', 'missed'])
const KIND_RANK = { confirm: 0, verify: 1, track: 2 }
const WATCH_RANK = { triggered: 0, needs_human: 1, watching: 2, expired: 3, resolved: 4 }
const GAP_RANK = { capability: 0, conflict: 1, quality: 2, transient: 3 }
const ROLE_RANK = { holding: 0, risk: 1, event: 2, watch: 3 }
const A_SHARE_MARKETS = new Set(['SH', 'SZ', 'BJ'])
const US_MARKETS = new Set(['OQ', 'N', 'US', 'NYSE', 'NASDAQ'])

function inferredMarket(code) {
  if (/^\d{6}$/.test(code)) {
    if (code.startsWith('6')) return 'SH'
    if (code.startsWith('4') || code.startsWith('8')) return 'BJ'
    return 'SZ'
  }
  if (/^\d{5}$/.test(code)) return 'HK'
  return undefined
}

/**
 * Merge the same instrument written with and without an exchange suffix. A bare six-digit A-share
 * code can infer its market from the code pattern; explicit suffixes still win, so an index such as
 * `000001.SS` does not collapse into Shenzhen's `000001`.
 */
export function stockSymbolKey(value) {
  const raw = String(value ?? '').trim().toUpperCase()
  if (raw.length === 0) return raw
  const match = /^([A-Z0-9]+)\.([A-Z]+)$/.exec(raw)
  if (match === null) {
    const market = inferredMarket(raw)
    return market === undefined ? raw : `${raw}.${market}`
  }
  const [, base, suffix] = match
  if (/^\d{6}$/.test(base) && (suffix === 'SS' || A_SHARE_MARKETS.has(suffix))) {
    return `${base}.${suffix === 'SS' ? 'SH' : suffix}`
  }
  if (/^\d{5}$/.test(base) && suffix === 'HK') return `${base}.HK`
  if (US_MARKETS.has(suffix)) return base
  return `${base}.${suffix}`
}

function symbolDisplayScore(symbol) {
  const raw = String(symbol ?? '')
  return (raw === raw.toUpperCase() ? 1 : 0) + (raw.includes('.') ? 2 : 0)
}

function preferredSymbol(current, incoming) {
  return symbolDisplayScore(incoming) > symbolDisplayScore(current) ? incoming : current
}

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

function gapKey(gap) {
  return `${gap.kind}|${normalize(gap.topic)}`
}

function todoKey(item) {
  if (item.kind === 'confirm') return `confirm|${item.symbol ?? normalize(item.title)}`
  if (item.kind === 'verify') return `verify|${item.symbol ?? ''}|${normalize(item.trigger ?? item.detail ?? item.title)}`
  return `track|${item.symbol ?? ''}|${item.dueAt ?? normalize(item.title)}`
}

/** An ack covers only the version the user saw; a later run makes the item open again. */
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

// The verifier occasionally pastes dataset ids, tool names and capture timestamps into the
// user-facing evidence/source fields. Strip that plumbing at the read boundary so old records
// render as cleanly as new ones; the stored value stays untouched for audit.
const TODO_INTERNAL_MARK = /(?:data_)?ds_[0-9a-z]+|capital-data|captured_at|quote_time|art_code|dataset_id|sourceId/i
const TODO_ID_RUN = /(?:capital-data[\s_]*)?(?:data_)?ds_[0-9a-z]+(?:\s*[/、,，+]\s*(?:data_)?ds_[0-9a-z]+)*(?:\s*[（(][^）)]*[）)])?/gi

/** Drop a trailing unclosed parenthetical left by the 160-char evidence cap. */
function trimDanglingTail(text) {
  let result = text
  for (;;) {
    const open = Math.max(result.lastIndexOf('（'), result.lastIndexOf('('))
    const close = Math.max(result.lastIndexOf('）'), result.lastIndexOf(')'))
    if (open < 0 || open < close) break
    const tail = result.slice(open + 1)
    if (/[。；;]/.test(tail) || tail.length > 40) break
    result = result.slice(0, open)
  }
  return result.replace(/[\s；;，,、+·/]+$/u, '').trim()
}

export function todoEvidenceText(value) {
  if (typeof value !== 'string') return null
  const text = trimDanglingTail(value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\bas-of\b/gi, '截至')
    .replace(/\b(?:captured_at|quote_time)\b\s*[:：]?\s*[0-9][0-9T:.\-–—\s]*(?:Asia\/Shanghai|HKT)?/gi, '')
    .replace(/\bart_code\s+[A-Za-z0-9]+/gi, '')
    .replace(TODO_ID_RUN, '')
    .replace(/\s{2,}/g, ' ')
    .trim())
  return text.length > 0 ? text : null
}

/** A source that only carries dataset ids or capture metadata is noise, not provenance. */
export function todoSourceText(value) {
  if (typeof value !== 'string' || TODO_INTERNAL_MARK.test(value)) return null
  const text = value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\bas-of\b/gi, '截至')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return text.length > 0 ? text : null
}

/** Only the tracking facts belong on the wire; profileKey and storage ids stay server-side. */
function watchSummary(watch, today) {
  if (watch === undefined) return null
  const pastDue = typeof watch.dueAt === 'string' && typeof today === 'string' && watch.dueAt < today
  return {
    status: watch.status,
    resolvedFrom: watch.resolvedFrom ?? null,
    checkedAt: watch.checkedAt ?? null,
    evidence: todoEvidenceText(watch.evidence),
    source: todoSourceText(watch.source),
    handoffReason: watch.handoffReason ?? null,
    dueAt: watch.dueAt ?? null,
    autoRequestedAt: watch.autoRequestedAt ?? null,
    expiredReason: watch.expiredReason ?? null,
    autoEligible: watch.status !== 'triggered'
      && watch.status !== 'expired'
      && !pastDue
      && !isUsSymbol(watch.symbol),
    autoIneligibleReason: watch.status === 'triggered'
      ? 'triggered'
      : watch.status === 'expired' || pastDue
        ? 'expired'
        : isUsSymbol(watch.symbol) ? 'us_symbol' : null,
  }
}

function watchRank(item) {
  if (item.watch === null || item.watch === undefined) return 9
  return WATCH_RANK[item.watch.resolvedFrom ?? item.watch.status] ?? 9
}

/** Expired rows stay in the TODO archive but must not inflate stock follow-up counts. */
function todoExpired(item, today, timeZone) {
  const decidedAt = typeof item.ackedAt === 'string' ? item.ackedAt : item.deferredAt
  if (decidedAt !== undefined) {
    const decidedDate = dateOf(decidedAt, timeZone)
    return decidedDate === undefined || decidedDate < today
  }
  const watchStatus = item.watch?.resolvedFrom ?? item.watch?.status
  // A triggered condition is a fact, but it only belongs to "today" through the day it fired
  // (or was due). From the next day it is history, like any other settled TODO.
  if (watchStatus === 'triggered') {
    const due = typeof item.dueAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dueAt) ? item.dueAt : ''
    const checked = dateOf(item.watch?.checkedAt, timeZone) ?? ''
    const latest = due > checked ? due : checked
    return latest.length > 0 && latest < today
  }
  if (item.watch?.status === 'expired') return true
  if (typeof item.dueAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dueAt)) return item.dueAt < today
  const label = typeof item.dueLabel === 'string' ? item.dueLabel.trim() : ''
  if (label === '今天' || label === '今日') {
    const seen = dateOf(item.lastSeenAt, timeZone)
    return seen !== undefined && seen < today
  }
  return false
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
      if (!current.sources.some((entry) => entry.runId === run.id)) {
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

function aggregateStocks(entries, todos, firstSeenByKey = new Map()) {
  const bySymbol = new Map()
  for (const { run, brief } of entries) {
    if (brief.status !== 'ready') continue
    for (const stock of brief.stocks) {
      const at = run.finishedAt ?? run.queuedAt
      const symbolKey = stockSymbolKey(stock.symbol)
      const current = bySymbol.get(symbolKey)
      if (current === undefined) {
        bySymbol.set(symbolKey, {
          symbolKey,
          symbol: stock.symbol,
          name: stock.name,
          roles: new Set(stock.roles),
          note: stock.note,
          nextAt: stock.nextAt,
          firstSeenAt: firstSeenByKey.get(symbolKey) ?? at,
          lastSeenAt: at,
        })
        continue
      }
      for (const role of stock.roles) current.roles.add(role)
      current.symbol = preferredSymbol(current.symbol, stock.symbol)
      if (at < current.firstSeenAt) current.firstSeenAt = at
      if (at >= current.lastSeenAt) {
        current.name = stock.name
        current.note = stock.note
        current.lastSeenAt = at
      }
      if (stock.nextAt !== undefined && (current.nextAt === undefined || stock.nextAt < current.nextAt)) current.nextAt = stock.nextAt
    }
  }
  const stockItems = new Map()
  for (const item of todos) {
    if (item.symbol === undefined) continue
    const key = stockSymbolKey(item.symbol)
    const items = stockItems.get(key) ?? []
    if (items.length >= MAX_STOCK_ITEMS) continue
    items.push({ id: item.id, title: item.title, sessionId: item.sessionId ?? null })
    stockItems.set(key, items)
  }
  const result = [...bySymbol.values()].map((stock) => {
    const items = stockItems.get(stock.symbolKey) ?? []
    return {
      symbol: stock.symbol,
      symbolKey: stock.symbolKey,
      name: stock.name,
      roles: [...stock.roles].sort((left, right) => (ROLE_RANK[left] ?? 9) - (ROLE_RANK[right] ?? 9)),
      ...(stock.note === undefined ? {} : { note: stock.note }),
      ...(stock.nextAt === undefined ? {} : { nextAt: stock.nextAt }),
      todoCount: items.length,
      items,
      firstSeenAt: stock.firstSeenAt,
      lastSeenAt: stock.lastSeenAt,
    }
  })
  result.sort((left, right) => {
    const role = (ROLE_RANK[left.roles[0]] ?? 9) - (ROLE_RANK[right.roles[0]] ?? 9)
    if (role !== 0) return role
    return String(right.lastSeenAt).localeCompare(String(left.lastSeenAt)) || left.symbol.localeCompare(right.symbol)
  })
  return result
}

function aggregateGaps(entries, firstSeenByKey = new Map()) {
  const byKey = new Map()
  for (const { run, brief } of entries) {
    if (brief.status !== 'ready') continue
    for (const gap of brief.gaps) {
      const key = gapKey(gap)
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
          firstSeenAt: firstSeenByKey.get(key) ?? at,
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

/** First mention across the whole retained run window, not just the selected date range. */
function firstSeenMaps(entries) {
  const stocks = new Map()
  const gaps = new Map()
  for (const { run, brief } of entries) {
    if (brief.status !== 'ready') continue
    const at = run.finishedAt ?? run.queuedAt
    for (const stock of brief.stocks) {
      const key = stockSymbolKey(stock.symbol)
      if (!stocks.has(key) || at < stocks.get(key)) stocks.set(key, at)
    }
    for (const gap of brief.gaps) {
      const key = gapKey(gap)
      if (!gaps.has(key) || at < gaps.get(key)) gaps.set(key, at)
    }
  }
  return { stocks, gaps }
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
    todayIssueCount: runs.filter((run) => FAILURE_STATUSES.has(run.status)
      && dateOf(run.finishedAt ?? run.queuedAt, timeZone) === today).length,
    nextRuns,
  }
}

function cardOf(run, brief, task, ask) {
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
    ask: ask ?? null,
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
  const { store, scheduler, asks, now = () => Date.now() } = options

  /** Same entries back the page projection and the unbounded watcher projection. */
  async function entriesFor(parsed) {
    const page = await store.listRunsPage({ limit: 2_000 })
    const tasks = await store.listTasks()
    const taskById = new Map(tasks.map((task) => [task.id, task]))
    const briefs = await store.listBriefsForRuns(page.runs.map((run) => run.id))
    const entries = []
    const historyEntries = []
    for (const run of page.runs) {
      const brief = briefs.get(run.id)
      if (run.status !== 'succeeded' || brief === undefined) continue
      const task = taskById.get(run.taskId)
      if (parsed.category !== undefined && task?.category !== parsed.category) continue
      const entry = { run, task, brief }
      historyEntries.push(entry)
      if (!inRange(run.finishedAt ?? run.queuedAt, parsed.from, parsed.to, parsed.timeZone)) continue
      entries.push(entry)
    }
    entries.sort((left, right) =>
      String(right.run.finishedAt ?? right.run.queuedAt).localeCompare(String(left.run.finishedAt ?? left.run.queuedAt))
      || String(right.run.id).localeCompare(String(left.run.id)))
    return { page, tasks, briefs, entries, historyEntries }
  }

  async function todosFor(parsed, sourceEntries, options = {}) {
    const entries = sourceEntries ?? (await entriesFor(parsed)).entries
    const [acks, watches] = await Promise.all([store.listTodoAcks(), store.listTodoWatches()])
    const ackById = new Map(acks.map((ack) => [ack.todoId, ack]))
    const watchById = new Map(watches.map((watch) => [watch.todoId, watch]))
    const todos = aggregateTodos(entries).map((item) => {
      const ack = ackById.get(item.id)
      const decision = ack !== undefined && todoAckCovers(ack, item) ? (ack.decision ?? 'confirmed') : undefined
      const decidedAt = decision === undefined ? undefined : ack.confirmedAt
      return {
        ...item,
        watch: watchSummary(watchById.get(item.id), parsed.to),
        ...(item.symbol === undefined ? {} : { symbolKey: stockSymbolKey(item.symbol) }),
        ...(decision === 'confirmed' ? { ackedAt: decidedAt } : {}),
        ...(decision === 'deferred' ? { deferredAt: decidedAt } : {}),
        ...(decision === undefined ? {} : { decision }),
      }
    })
    const visible = options.includeAcked === true ? todos : todos.filter((item) => item.ackedAt === undefined)
    const expiredIds = new Set(visible.filter((item) => todoExpired(item, parsed.to, parsed.timeZone)).map((item) => item.id))
    visible.sort((left, right) => {
      const archive = (expiredIds.has(left.id) ? 1 : 0) - (expiredIds.has(right.id) ? 1 : 0)
      if (archive !== 0) return archive
      if (expiredIds.has(left.id)) {
        return String(right.dueAt ?? '').localeCompare(String(left.dueAt ?? ''))
          || String(right.lastSeenAt).localeCompare(String(left.lastSeenAt))
          || String(left.id).localeCompare(String(right.id))
      }
      const kind = (KIND_RANK[left.kind] ?? 9) - (KIND_RANK[right.kind] ?? 9)
      if (kind !== 0) return kind
      const watch = watchRank(left) - watchRank(right)
      if (watch !== 0) return watch
      return String(left.dueAt ?? '9999-12-31').localeCompare(String(right.dueAt ?? '9999-12-31'))
        || String(right.lastSeenAt).localeCompare(String(left.lastSeenAt))
        || String(left.id).localeCompare(String(right.id))
    })
    return visible
  }

  async function board(query = {}) {
    const parsed = parseBoardQuery(query, now)
    const { page, tasks, briefs, entries, historyEntries } = await entriesFor(parsed)
    const lifetime = await store.countBriefs()
    let start = 0
    if (parsed.before !== undefined) {
      const index = entries.findIndex((entry) => entry.run.id === parsed.before)
      if (index === -1) throw new BoardError('invalid_cursor', '分页游标无效。')
      start = index + 1
    }
    const pageEntries = entries.slice(start, start + parsed.limit)
    const nextBefore = start + pageEntries.length < entries.length ? pageEntries.at(-1)?.run.id ?? null : null
    const pageRunIds = pageEntries.map((entry) => entry.run.id)
    const askByRun = typeof asks?.latestForRuns === 'function'
      ? await asks.latestForRuns(pageRunIds)
      : new Map()
    const todos = await todosFor(parsed, entries, { includeAcked: true })
    const openTodos = todos.filter((item) => item.ackedAt === undefined && item.deferredAt === undefined)
    const activeTodos = openTodos.filter((item) => !todoExpired(item, parsed.to, parsed.timeZone))
    const firstSeen = firstSeenMaps(historyEntries)
    const stocks = aggregateStocks(entries, activeTodos, firstSeen.stocks)
    const gaps = aggregateGaps(entries, firstSeen.gaps)
    const health = healthOf({
      runs: page.runs,
      briefs,
      timeZone: parsed.timeZone,
      now: now(),
      scheduler,
      tasks,
    })
    const today = parsed.to
    const isToday = (value) => dateOf(value, parsed.timeZone) === today
    return {
      ok: true,
      generatedAt: iso(now()),
      empty: lifetime === 0,
      range: { days: parsed.days === 'all' ? 'all' : Number(parsed.days), from: parsed.from ?? null, to: parsed.to },
      stats: {
        briefs: entries.length,
        briefsToday: entries.filter((entry) => isToday(entry.run.finishedAt ?? entry.run.queuedAt)).length,
        todos: openTodos.length,
        stocks: stocks.length,
        stocksNewToday: stocks.filter((stock) => isToday(stock.firstSeenAt)).length,
        gaps: gaps.length,
        gapsNewToday: gaps.filter((gap) => isToday(gap.firstSeenAt)).length,
        issues7d: health.issueCount,
        issuesToday: health.todayIssueCount,
      },
      cards: pageEntries.map((entry) => cardOf(entry.run, entry.brief, entry.task, askByRun.get(entry.run.id))),
      todos,
      stocks: stocks.slice(0, MAX_STOCKS),
      gaps,
      health,
      nextBefore: nextBefore ?? null,
    }
  }

  /** Same unbounded projection the page reads; the watcher must not miss a candidate. */
  async function openTodos(query = {}) {
    return todosFor(parseBoardQuery(query, now))
  }

  async function closeWatch(todoId, at) {
    const watches = await store.listTodoWatches()
    const watch = watches.find((entry) => entry.todoId === todoId)
    if (watch === undefined || watch.status === 'resolved') return
    const next = {
      ...watch,
      status: 'resolved',
      ...(watch.status === 'resolved' ? {} : { resolvedFrom: watch.status }),
      updatedAt: at,
    }
    delete next.handoffReason
    delete next.autoRequestedAt
    delete next.expiredReason
    await store.putTodoWatch(next)
  }

  async function promoteTodo(todoId) {
    const watches = await store.listTodoWatches()
    const watch = watches.find((entry) => entry.todoId === todoId)
    if (watch === undefined) {
      throw new BoardError('todo_not_tracked', '这条 TODO 没有跟踪记录，暂时不能转入自动核验。', 409)
    }
    if (watch.kind !== 'confirm' && watch.kind !== 'verify') {
      throw new BoardError('todo_auto_unsupported', '这条 TODO 暂不支持自动核验。', 409)
    }
    if (watch.status === 'expired' || (typeof watch.dueAt === 'string' && watch.dueAt < localPartsAt(now()).date)) {
      throw new BoardError('todo_expired', '这条 TODO 已过期，不能再转入自动核验。', 409)
    }
    if (isUsSymbol(watch.symbol)) {
      throw new BoardError('todo_auto_unsupported', '美股标的暂不支持自动核验。', 409)
    }
    if (watch.status === 'triggered') {
      throw new BoardError('todo_already_triggered', '这条条件已经触发，请直接确认或忽略。', 409)
    }
    const at = iso(now())
    const next = {
      ...watch,
      status: 'watching',
      autoRequestedAt: at,
      updatedAt: at,
    }
    delete next.resolvedFrom
    delete next.handoffReason
    delete next.expiredReason
    delete next.verdict
    delete next.evidence
    delete next.source
    delete next.evidenceRunId
    delete next.evidenceSessionId
    delete next.notifiedAt
    delete next.notifiedStatus
    await store.putTodoWatch(next)
    await store.clearTodoDecision(todoId)
    return { id: todoId, action: 'auto', status: 'watching', requestedAt: at }
  }

  async function decideTodo(todoId, action) {
    if (action === 'auto') return promoteTodo(todoId)
    if (action !== 'confirm' && action !== 'defer') {
      throw new BoardError('invalid_action', '未知的 TODO 操作。', 400)
    }
    const decision = action === 'defer' ? 'deferred' : 'confirmed'
    const record = await store.decideTodo(todoId, decision)
    await closeWatch(todoId, record.confirmedAt)
    return { id: record.todoId, action, decision, decidedAt: record.confirmedAt }
  }

  async function confirmTodo(todoId) {
    const result = await decideTodo(todoId, 'confirm')
    return { id: result.id, confirmedAt: result.decidedAt }
  }

  return { board, openTodos, confirmTodo, decideTodo }
}
