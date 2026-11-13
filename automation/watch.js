/**
 * TODO tracking. Briefs stay the source of truth; this service derives one watch per
 * confirm/verify item, feeds the dedicated verifier task its candidate list, and applies the
 * verdicts that task returns. No other task's final answer is treated as evidence.
 */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import { includesQuote, sourceBlocksOf } from './brief.js'
import { extractJsonObject } from './json-text.js'
import { sanitizeMessage } from './redact.js'
import { localPartsAt } from './time.js'

export const TODO_WATCH_MAX_AGE_MS = 72 * 60 * 60_000
export const TODO_WATCH_TICK_MS = 5 * 60_000
/** Operational verifier tasks; only these receive the candidate list and return verdicts. */
export const TODO_VERIFIER_TASK_IDS = new Set(['todo-verifier-close'])
export const TODO_VERIFIER_MAX_TODOS = 30
const TODO_WATCH_EVIDENCE_CHARS = 160
const CONFIRM_HANDOFF = '请到看板 TODO 处理。'
const CONFIRM_AUTO_HANDOFF = '自动核验未能确认这条人工判断，需要你处理。'
const VERIFY_HANDOFF = '核验任务没有找到足够的同口径数据，需要你处理。'
const MISSING_HANDOFF = '本次核验没有返回这条的结论，需要你处理。'
const VERDICTS = new Set(['triggered', 'not_triggered', 'insufficient'])
const CONFIDENCE = new Set(['high', 'medium', 'low'])

function iso(now) {
  return new Date(now).toISOString()
}

function timeZoneOf(value) {
  if (typeof value === 'string' && value.length > 0) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
      return value
    } catch {
      // Fall through to the server zone.
    }
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  } catch {
    return 'Asia/Shanghai'
  }
}

function todoWatchId(profileKey, todoId) {
  return `tw_${createHash('sha256').update(`${profileKey}\u0000${todoId}`).digest('hex').slice(0, 32)}`
}

function watchable(item, now, today, existing) {
  if (item?.kind !== 'confirm' && item?.kind !== 'verify') return false
  const seen = Date.parse(item.lastSeenAt)
  if (!Number.isFinite(seen) || now - seen > TODO_WATCH_MAX_AGE_MS) return false
  // Past-due items are not picked up retroactively; an existing watch still needs its handoff.
  if (existing === undefined && item.kind === 'verify' && typeof item.dueAt === 'string' && item.dueAt < today) return false
  return true
}

function cleanEvidence(value) {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length === 0) return undefined
  return Array.from(text).slice(0, TODO_WATCH_EVIDENCE_CHARS).join('')
}

function cleanSource(value) {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length === 0) return undefined
  return Array.from(text).slice(0, 300).join('')
}

function errorText(error) {
  return sanitizeMessage(String(error?.message ?? error)).slice(0, 300)
}

export function isUsSymbol(symbol) {
  if (typeof symbol !== 'string' || symbol.length === 0) return false
  if (/\.(?:HK|SH|SZ|BJ)$/i.test(symbol)) return false
  if (/\.(?:OQ|N|US|NYSE|NASDAQ)$/i.test(symbol)) return true
  // Bare tickers (CRWV, NVDA, BABA) are US; A/H codes are digits or carry an exchange suffix.
  return /^[A-Za-z][A-Za-z.\-]*$/.test(symbol)
}

/** A user decision covers only the version the user saw, exactly like `todo_acks`. */
function decisionCovers(decision, lastSeenAt) {
  if (decision === undefined) return false
  const decidedAt = Date.parse(decision.confirmedAt)
  const seenAt = Date.parse(lastSeenAt)
  if (!Number.isFinite(decidedAt) || !Number.isFinite(seenAt)) return true
  return seenAt <= decidedAt
}

/**
 * The verifier authors the board card in the same final answer as its verdicts, so the brief
 * costs no extra model call. Validation and fallback live in `verifierBriefContent`.
 */
export function parseVerifierBrief(raw) {
  const brief = extractJsonObject(raw)?.brief
  if (brief === null || typeof brief !== 'object' || Array.isArray(brief)) return undefined
  return { headline: brief.headline, plain: brief.plain }
}

export function parseWatchOutput(raw, { todos, blocks, sourceText }) {
  const value = extractJsonObject(raw)
  if (value === undefined) return []
  const byId = new Map((Array.isArray(todos) ? todos : []).map((todo) => [todo.id, todo]))
  const blockList = Array.isArray(blocks) ? blocks : []
  const results = []
  const seen = new Set()
  for (const entry of Array.isArray(value.results) ? value.results : []) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    if (typeof entry.id !== 'string' || !byId.has(entry.id) || seen.has(entry.id)) continue
    if (!VERDICTS.has(entry.verdict)) continue
    const sourceId = Number(entry.sourceId)
    const block = Number.isInteger(sourceId) && sourceId >= 1 && sourceId <= blockList.length
      ? blockList[sourceId - 1]
      : undefined
    const evidence = cleanEvidence(entry.evidence)
    if (evidence === undefined) continue
    if (!(block !== undefined && includesQuote(block.text, evidence)) && !includesQuote(sourceText, evidence)) continue
    const confidence = CONFIDENCE.has(entry.confidence) ? entry.confidence : 'low'
    const verdict = (entry.verdict === 'triggered' || entry.verdict === 'not_triggered') && confidence === 'low'
      ? 'insufficient'
      : entry.verdict
    seen.add(entry.id)
    results.push({
      id: entry.id,
      verdict,
      confidence,
      evidence,
      source: cleanSource(entry.source),
    })
  }
  return results
}

export function createTodoWatchService(options) {
  const { store, board, now = () => Date.now(), logger, getSettings, readAnswer } = options
  const profileKey = store.profileKey
  const timeZone = timeZoneOf(options.timeZone)
  let chain = Promise.resolve()
  let timer
  let stopped = false

  function settings() {
    return typeof getSettings === 'function' ? getSettings() ?? {} : getSettings ?? {}
  }

  function owner() {
    return typeof options.isOwner === 'function' ? options.isOwner() === true : true
  }

  function serialize(operation) {
    const next = chain.then(operation, operation)
    chain = next.then(() => {}, () => {})
    return next
  }

  async function openTodos() {
    if (board === undefined || typeof board.openTodos !== 'function') return []
    return board.openTodos({ days: '14', tz: timeZone })
  }

  /** Explicit dates win; a "today" label expires at the end of the day it was written. */
  function dueDateOf(item) {
    if (typeof item.dueAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dueAt)) return item.dueAt
    const label = typeof item.dueLabel === 'string' ? item.dueLabel.trim() : ''
    if (label !== '今天' && label !== '今日') return undefined
    const seen = Date.parse(item.lastSeenAt)
    return Number.isFinite(seen) ? localPartsAt(seen, timeZone).date : undefined
  }

  /** Distinguishes "checked and missed" from "never got a deadline-grade answer". */
  function expiredReasonFor(existing, item, dueDate) {
    if (item.kind === 'confirm') return 'not_confirmed'
    const checkedAt = existing?.checkedAt === undefined ? NaN : Date.parse(existing.checkedAt)
    const checkedDate = Number.isFinite(checkedAt) ? localPartsAt(checkedAt, timeZone).date : undefined
    if (existing?.verdict === 'not_triggered' && checkedDate !== undefined && dueDate !== undefined && checkedDate >= dueDate) {
      return 'not_triggered'
    }
    if (existing?.verdict === 'insufficient' || existing?.status === 'needs_human') return 'no_data'
    return 'not_verified'
  }

  function buildWatch(existing, item, at, today, decision) {
    const firstSeenAt = existing === undefined || Date.parse(item.lastSeenAt) < Date.parse(existing.firstSeenAt)
      ? item.lastSeenAt
      : existing.firstSeenAt
    const reopened = existing !== undefined
      && (existing.status === 'resolved' || existing.status === 'expired')
      && Date.parse(item.lastSeenAt) > Date.parse(existing.lastSeenAt)
    const covered = decisionCovers(decision, item.lastSeenAt)
    let status = existing?.status ?? (item.kind === 'confirm' ? 'needs_human' : 'watching')
    let handoffReason = existing?.handoffReason
    let resolvedFrom = existing?.resolvedFrom
    let autoRequestedAt = existing?.autoRequestedAt
    let expiredReason = existing?.expiredReason
    const dueDate = dueDateOf(item)
    if (reopened) {
      status = item.kind === 'confirm' ? 'needs_human' : 'watching'
      handoffReason = undefined
      resolvedFrom = undefined
      expiredReason = undefined
    }
    if (autoRequestedAt !== undefined && status !== 'triggered' && status !== 'resolved') {
      status = 'watching'
      handoffReason = undefined
    }
    if (covered) {
      status = 'resolved'
      handoffReason = undefined
      autoRequestedAt = undefined
      expiredReason = undefined
      if (existing !== undefined && existing.status !== 'resolved') resolvedFrom = existing.status
    }
    if (item.kind === 'confirm' && (status === 'watching' || status === 'needs_human') && autoRequestedAt === undefined) {
      status = 'needs_human'
      if (handoffReason === undefined) handoffReason = CONFIRM_HANDOFF
    }
    if (dueDate !== undefined && dueDate < today && status !== 'triggered' && status !== 'resolved') {
      status = 'expired'
      handoffReason = undefined
      autoRequestedAt = undefined
      if (expiredReason === undefined) expiredReason = expiredReasonFor(existing, item, dueDate)
    }
    if (status !== 'expired') expiredReason = undefined
    if (status !== 'needs_human') handoffReason = undefined
    const next = {
      schemaVersion: 1,
      id: existing?.id ?? todoWatchId(profileKey, item.id),
      profileKey,
      todoId: item.id,
      kind: item.kind,
      status,
      title: item.title,
      ...(item.detail === undefined ? {} : { detail: item.detail }),
      ...(item.symbol === undefined ? {} : { symbol: item.symbol }),
      ...(item.trigger === undefined ? {} : { trigger: item.trigger }),
      ...(item.dueAt === undefined ? {} : { dueAt: item.dueAt }),
      firstSeenAt,
      lastSeenAt: item.lastSeenAt,
      ...(existing?.checkedAt === undefined || reopened ? {} : { checkedAt: existing.checkedAt }),
      ...(autoRequestedAt === undefined ? {} : { autoRequestedAt }),
      ...(expiredReason === undefined ? {} : { expiredReason }),
      ...(existing?.verdict === undefined || reopened ? {} : { verdict: existing.verdict }),
      ...(existing?.evidence === undefined || reopened ? {} : { evidence: existing.evidence }),
      ...(existing?.source === undefined || reopened ? {} : { source: existing.source }),
      ...(handoffReason === undefined ? {} : { handoffReason }),
      ...(existing?.evidenceRunId === undefined || reopened ? {} : { evidenceRunId: existing.evidenceRunId }),
      ...(existing?.evidenceSessionId === undefined || reopened ? {} : { evidenceSessionId: existing.evidenceSessionId }),
      ...(resolvedFrom === undefined ? {} : { resolvedFrom }),
      ...(reopened || existing?.notifiedAt === undefined ? {} : { notifiedAt: existing.notifiedAt }),
      ...(reopened || existing?.notifiedStatus === undefined ? {} : { notifiedStatus: existing.notifiedStatus }),
      createdAt: existing?.createdAt ?? at,
      updatedAt: existing?.updatedAt ?? at,
    }
    if (isDeepStrictEqual(next, existing)) return undefined
    return { ...next, updatedAt: at }
  }

  function expireMissing(existing, at, ackById) {
    if (existing.status === 'resolved' || existing.status === 'expired') return undefined
    const ack = ackById.get(existing.todoId)
    if (ack !== undefined && Date.parse(ack.confirmedAt) >= Date.parse(existing.lastSeenAt)) {
      const next = {
        ...existing,
        status: 'resolved',
        ...(existing.status === 'resolved' ? {} : { resolvedFrom: existing.status }),
        updatedAt: at,
      }
      delete next.autoRequestedAt
      delete next.handoffReason
      delete next.expiredReason
      return isDeepStrictEqual(next, existing) ? undefined : next
    }
    // A triggered condition stays visible until the user acknowledges it.
    if (existing.status === 'triggered') return undefined
    const next = { ...existing, status: 'expired', expiredReason: 'stale', updatedAt: at }
    delete next.autoRequestedAt
    delete next.handoffReason
    return isDeepStrictEqual(next, existing) ? undefined : next
  }

  async function syncInternal() {
    if (!owner()) return
    const at = iso(now())
    const today = localPartsAt(now(), timeZone).date
    const todos = await openTodos()
    const acks = await store.listTodoAcks()
    const ackById = new Map(acks.map((ack) => [ack.todoId, ack]))
    const existing = await store.listTodoWatches()
    const existingById = new Map(existing.map((record) => [record.todoId, record]))
    const openIds = new Set()
    for (const item of todos) {
      const existingWatch = existingById.get(item.id)
      if (!watchable(item, now(), today, existingWatch)) continue
      openIds.add(item.id)
      const next = buildWatch(existingWatch, item, at, today, ackById.get(item.id))
      if (next !== undefined) await store.putTodoWatch(next)
    }
    for (const record of existing) {
      if (openIds.has(record.todoId)) continue
      const next = expireMissing(record, at, ackById)
      if (next !== undefined) await store.putTodoWatch(next)
    }
  }

  async function notifyPendingInternal() {
    if (!owner()) return
    const at = iso(now())
    const enabled = settings().inAppNotifications !== false
    const acks = await store.listTodoAcks()
    const decisionById = new Map(acks.map((ack) => [ack.todoId, ack]))
    for (const watch of await store.listTodoWatches()) {
      if (watch.status !== 'triggered' && watch.status !== 'needs_human') continue
      if (decisionCovers(decisionById.get(watch.todoId), watch.lastSeenAt)) continue
      if (watch.notifiedStatus === watch.status) continue
      // A disabled inbox or an item that has already aged out must not turn into a backlog
      // notification the moment settings change. Mark it seen without sending.
      const age = now() - Date.parse(watch.lastSeenAt)
      const suppress = !enabled || (watch.kind === 'confirm' && age > TODO_WATCH_MAX_AGE_MS)
      if (!suppress) {
        const triggered = watch.status === 'triggered'
        const prefix = triggered ? '已触发' : '待人工处理'
        const message = triggered
          ? [watch.evidence, watch.source].filter((value) => typeof value === 'string' && value.length > 0).join(' · ')
          : watch.handoffReason ?? VERIFY_HANDOFF
        await store.addNotification({
          kind: triggered ? 'todo_triggered' : 'todo_needs_human',
          title: `${prefix}：${watch.title}`.slice(0, 120),
          message: sanitizeMessage(message).slice(0, 500),
          todoId: watch.todoId,
          ...(watch.evidenceRunId === undefined ? {} : { runId: watch.evidenceRunId }),
        })
      }
      await store.putTodoWatch({
        ...watch,
        notifiedAt: at,
        notifiedStatus: watch.status,
        updatedAt: at,
      })
    }
  }

  async function sync() {
    return serialize(async () => {
      await syncInternal()
      await notifyPendingInternal()
    })
  }

  function isVerifierTask(task) {
    return TODO_VERIFIER_TASK_IDS.has(task?.sourceBuiltinId)
  }

  async function candidateWatches(task) {
    if (!isVerifierTask(task)) return []
    const [watches, acks] = await Promise.all([store.listTodoWatches(), store.listTodoAcks()])
    const decisionById = new Map(acks.map((ack) => [ack.todoId, ack]))
    const today = localPartsAt(now(), timeZone).date
    return watches
      .filter((watch) => {
        if (decisionCovers(decisionById.get(watch.todoId), watch.lastSeenAt)) return false
        if (watch.kind !== 'verify' && watch.autoRequestedAt === undefined) return false
        if (watch.status !== 'watching' && watch.status !== 'needs_human') return false
        // Expired conditions are settled, not re-checked with post-deadline data.
        if (typeof watch.dueAt === 'string' && watch.dueAt < today) return false
        return !isUsSymbol(watch.symbol)
      })
      .sort((left, right) =>
        (left.autoRequestedAt === undefined ? 1 : 0) - (right.autoRequestedAt === undefined ? 1 : 0)
        || String(left.autoRequestedAt ?? '').localeCompare(String(right.autoRequestedAt ?? ''))
        || String(left.dueAt ?? '9999-12-31').localeCompare(String(right.dueAt ?? '9999-12-31'))
        || String(left.checkedAt ?? '').localeCompare(String(right.checkedAt ?? ''))
        || String(right.lastSeenAt).localeCompare(String(left.lastSeenAt))
        || left.todoId.localeCompare(right.todoId))
      .slice(0, TODO_VERIFIER_MAX_TODOS)
  }

  async function hasCandidates(task) {
    if (!isVerifierTask(task)) return true
    return (await candidateWatches(task)).length > 0
  }

  function candidatePayload(watch) {
    return {
      id: watch.todoId,
      title: watch.title,
      ...(watch.detail === undefined ? {} : { detail: watch.detail }),
      ...(watch.symbol === undefined ? {} : { symbol: watch.symbol }),
      ...(watch.trigger === undefined ? {} : { trigger: watch.trigger }),
      ...(watch.dueAt === undefined ? {} : { dueAt: watch.dueAt }),
      kind: watch.kind,
      status: watch.status,
      lastSeenAt: watch.lastSeenAt,
    }
  }

  async function promptContextFor(task) {
    if (!isVerifierTask(task)) return undefined
    const candidates = await candidateWatches(task)
    const trigger = task?.trigger ?? {}
    const header = [
      `核验窗口：A 股/港股收盘后（交易日 ${trigger.time ?? '16:30'}，${trigger.timezone ?? timeZone}）`,
      `当前时间：${iso(now())}`,
    ]
    if (candidates.length === 0) {
      return {
        text: `${header.join('\n')}\n\n本次没有待核验的 TODO。直接返回 {"brief":{"headline":"核验完成：本次无候选","plain":"本次没有待核验的 TODO，核验任务按计划结束。"},"results":[]}，不要调用工具。`,
        candidates: [],
        empty: true,
      }
    }
    return {
      text: [
        ...header,
        `候选 TODO（共 ${candidates.length} 条，必须逐条返回）：`,
        JSON.stringify(candidates.map(candidatePayload), null, 2),
        '输出要求：先写一句本次核验摘要，再输出一个 ```json 代码块：',
        '{"brief":{"headline":"≤24 字","plain":"40–200 字：先写触发了什么，再写核实线索（数据/公告、关键数值、截至时间）"},"results":[{"id":"候选 id","verdict":"triggered|not_triggered|insufficient","confidence":"high|medium|low","evidence":"给用户看的核验依据：结论 + 关键数字，≤120 字","source":"人类可读的来源与口径，如「Wind 日线，截至 11-12 收盘」，≤60 字"}]}',
        'triggered / not_triggered 必须能在工具结果中找到依据；缺数据、只见到媒体转述、口径不一致或条件有歧义一律 insufficient。',
        'evidence 与 source 会原样展示在 TODO 卡片：不要出现内部 ID（data_ds_…、ds_…、art_code）、工具或能力名（wind_stock_kline、fuyao_history、index_quote 等）、采集字段（captured_at、quote_time、as-of、sourceId）、Markdown 或反引号；不要贴工具原文或「来源：」引用块。数据口径用中文写，如「截至 11-12 收盘」；source 没有可读来源就留空。',
        'JSON 必须严格合法：不要尾逗号、注释或省略引号；每条候选都要用候选 id 返回一次。',
        'brief 只写已触发的条目与线索，没有触发就直说；不要写 Markdown、链接或表情，也不要给买卖建议；同样不要写工具名、ID 或 as-of。',
      ].join('\n'),
      candidates: candidates.map(candidatePayload),
      empty: false,
    }
  }

  async function applyVerifierAnswer(payload) {
    if (!owner()) return
    const { run, task, text, toolText } = payload
    if (typeof text !== 'string' || text.trim().length === 0) return
    const authoredBrief = parseVerifierBrief(text)
    await syncInternal()
    const all = await store.listTodoWatches()
    const acks = await store.listTodoAcks()
    const decisionById = new Map(acks.map((ack) => [ack.todoId, ack]))
    const snapshot = Array.isArray(run.verificationTodoIds) ? new Set(run.verificationTodoIds) : undefined
    const candidates = all
      .filter((watch) => (watch.kind === 'verify' || watch.autoRequestedAt !== undefined)
        && (watch.status === 'watching' || watch.status === 'needs_human')
        && !decisionCovers(decisionById.get(watch.todoId), watch.lastSeenAt)
        && (snapshot === undefined || snapshot.has(watch.todoId)))
      .sort((left, right) => String(left.todoId).localeCompare(String(right.todoId)))
    if (candidates.length === 0) {
      await notifyPendingInternal()
      return { checked: 0, triggered: [], notTriggered: 0, needsHuman: 0, expired: 0, ...(authoredBrief === undefined ? {} : { brief: authoredBrief }) }
    }
    // Subagents keep their raw tool output in child sessions; the main answer is the compiled
    // evidence record. Accept either source rather than rejecting every delegated lookup.
    const evidenceText = [toolText, text]
      .filter((value) => typeof value === 'string' && value.trim().length > 0)
      .join('\n')
    const blocks = sourceBlocksOf(evidenceText, Number.POSITIVE_INFINITY)
    const todos = candidates.map(candidatePayload)
    const results = parseWatchOutput(text, { todos, blocks, sourceText: evidenceText })
    if (results.length === 0 && /"results"\s*:/.test(text)) {
      logger?.warn?.('capital-automation: 核验结果解析为空，候选按数据不足处理')
    }
    const resultById = new Map(results.map((result) => [result.id, result]))
    const today = localPartsAt(now(), timeZone).date
    const currentById = new Map((await store.listTodoWatches()).map((watch) => [watch.todoId, watch]))
    const decisionByIdAtApply = new Map((await store.listTodoAcks()).map((ack) => [ack.todoId, ack]))
    const at = iso(now())
    const summary = { checked: 0, triggered: [], notTriggered: 0, needsHuman: 0, expired: 0 }
    for (const candidate of candidates) {
      const current = currentById.get(candidate.todoId)
      if (current === undefined) continue
      if (current.kind !== 'verify' && current.autoRequestedAt === undefined) continue
      if (current.status !== 'watching' && current.status !== 'needs_human') continue
      if (decisionCovers(decisionByIdAtApply.get(current.todoId), current.lastSeenAt)) continue
      const result = resultById.get(candidate.todoId)
      const overdue = typeof current.dueAt === 'string' && current.dueAt < today
      let status = current.status
      let handoffReason
      let expiredReason
      if (result === undefined) {
        if (overdue) {
          status = 'expired'
          expiredReason = 'no_data'
        } else {
          status = 'needs_human'
          handoffReason = MISSING_HANDOFF
        }
      } else if (result.verdict === 'triggered') {
        status = 'triggered'
      } else if (result.verdict === 'not_triggered') {
        if (overdue) {
          status = 'expired'
          expiredReason = current.kind === 'confirm' ? 'not_confirmed' : 'not_triggered'
        } else if (current.kind === 'confirm') {
          status = 'needs_human'
          handoffReason = CONFIRM_AUTO_HANDOFF
        } else {
          status = 'watching'
        }
      } else if (overdue) {
        status = 'expired'
        expiredReason = 'no_data'
      } else {
        status = 'needs_human'
        handoffReason = VERIFY_HANDOFF
      }
      const next = {
        ...current,
        status,
        checkedAt: at,
        verdict: result?.verdict ?? 'insufficient',
        evidenceRunId: run.id,
        ...(run.sessionId === undefined ? {} : { evidenceSessionId: run.sessionId }),
        ...(handoffReason === undefined ? {} : { handoffReason }),
        ...(expiredReason === undefined ? {} : { expiredReason }),
        updatedAt: at,
      }
      // A promoted item gets one user-requested attempt; a failed one returns to manual before
      // the deadline, and is archived once the deadline has passed.
      delete next.autoRequestedAt
      if (status !== 'expired') delete next.expiredReason
      if (result?.evidence === undefined) delete next.evidence
      else next.evidence = result.evidence
      if (result?.source === undefined) delete next.source
      else next.source = result.source
      if (handoffReason === undefined) delete next.handoffReason
      await store.putTodoWatch(next)
      summary.checked += 1
      if (status === 'triggered') {
        summary.triggered.push({
          title: current.title,
          ...(current.symbol === undefined ? {} : { symbol: current.symbol }),
          ...(result?.evidence === undefined ? {} : { evidence: result.evidence }),
        })
      } else if (status === 'watching') {
        summary.notTriggered += 1
      } else if (status === 'needs_human') {
        summary.needsHuman += 1
      } else if (status === 'expired') {
        summary.expired += 1
      }
    }
    await notifyPendingInternal()
    return { ...summary, ...(authoredBrief === undefined ? {} : { brief: authoredBrief }) }
  }

  async function onFinalAnswer(payload) {
    if (stopped || payload?.run?.status !== 'succeeded') return
    if (!isVerifierTask(payload?.task)) return
    return serialize(() => applyVerifierAnswer(payload)).catch((error) => {
      logger?.warn?.(`capital-automation: TODO 核验结果处理失败：${errorText(error)}`)
    })
  }

  async function onVerifierRun(payload) {
    if (stopped || !isVerifierTask(payload?.task) || payload?.run?.status !== 'succeeded') return
    if (typeof readAnswer !== 'function' || typeof payload.run.sessionId !== 'string') return
    try {
      const answer = await readAnswer(payload.run.sessionId)
      return onFinalAnswer({ ...payload, text: answer.text, toolText: answer.toolText })
    } catch (error) {
      logger?.warn?.(`capital-automation: TODO 核验读取 session 失败：${errorText(error)}`)
    }
  }

  function start() {
    if (timer !== undefined || stopped) return
    void sync().catch((error) => logger?.warn?.(`capital-automation: TODO 同步失败：${errorText(error)}`))
    timer = setInterval(() => {
      void sync().catch((error) => logger?.warn?.(`capital-automation: TODO 同步失败：${errorText(error)}`))
    }, TODO_WATCH_TICK_MS)
    timer.unref?.()
  }

  function stop() {
    stopped = true
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  async function flush() {
    await chain
  }

  return {
    onFinalAnswer,
    onVerifierRun,
    isVerifierTask,
    promptContextFor,
    hasCandidates,
    sync,
    flush,
    start,
    stop,
    dispose: stop,
  }
}
