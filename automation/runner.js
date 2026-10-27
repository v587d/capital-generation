/**
 * One run = one fresh Agent session. The runner owns prompt admission, budgets, cancellation,
 * the session subtree, and the status transition; it never reads market data or touches a
 * Dataset. Session creation failing still leaves a visible synthetic failed run.
 */
import { mkdir } from 'node:fs/promises'
import { CANCEL_GRACE_MS, MAX_ERRORS_PER_RUN, QUIET_SETTLE_MS } from './defaults.js'
import { sanitizeMessage } from './redact.js'

const PRESET_ID = 'capital-generation'
const POLICY_ID = 'automation-v1'
const MAX_SESSION_LINEAGE = 32
const MAX_COUNTED_EVENT_KEYS = 12_000
const MAX_SUMMARY_CHARS = 2_000
const MAX_ACTIVE_RUNS = 2
const FLUSH_TIMEOUT_MS = 5_000
const DISPOSE_TIMEOUT_MS = CANCEL_GRACE_MS + FLUSH_TIMEOUT_MS
const MODE_GUIDANCE = {
  news: '资讯模式：先给当日要点，再按主题分节；每条信息标注来源与时间，旧闻不得冒充新闻。',
  market: '行情模式：先给价格/量能/资金的关键读数与口径，再给异动解释；数值必须带采集时间。',
  review: '复盘模式：先给一句话结论与下一交易日观察条件，再展开证据；不得用未核验数据推断。',
  research: '研究模式：先给结论与风险，再给证据、假设与验证路径；不做交易指令或收益承诺。',
}

function service(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

function iso(now) {
  return new Date(now).toISOString()
}

function shortRunId(id) {
  return String(id).replace(/^run_/, '').slice(-8) || 'unknown'
}

export function sessionTitleOf(task, profileName, runId) {
  const raw = `[CapGen 投研自动化·${profileName}] ${task.title}·${shortRunId(runId)}`
  return raw.length > 200 ? `${raw.slice(0, 197)}...` : raw
}

export function buildRunPrompt({ task, run, trigger, profileName, now }) {
  const local = new Intl.DateTimeFormat('zh-CN', {
    timeZone: task.trigger.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(now))
  const reason = trigger === 'manual' ? '手动运行' : '定时触发'
  return `【CapGen 投研自动化】
运行: ${run.id}
任务: ${task.title}（${task.id}）
触发: ${reason}
occurrence: ${run.occurrenceKey}
${run.scheduledFor === undefined ? '' : `计划时刻: ${run.scheduledFor}\n`}当前时间: ${local}（${task.trigger.timezone}）
profile: ${profileName}
执行模式: ${task.mode}
无人值守策略: ${POLICY_ID}

任务说明:
${task.description.length > 0 ? task.description : '（无补充说明）'}

任务指令:
${task.instruction}

模式要求: ${MODE_GUIDANCE[task.mode] ?? MODE_GUIDANCE.research}

执行要求:
- 这是无人值守运行：禁止 ask_user_question、禁止等待审批、禁止写文件或提权。
- 使用当前角色可见的工具面；结构化数据交 data_collector，网页材料交 web_retriever，分析交 data_junior。
- 最终答复必须自足：结论、证据与来源、局限与风险；不要写“见上”“已完成”。
- 缺少关键输入时，采用最保守的可核查口径继续，并在开头写明「需要用户确认」及具体缺口。`
}

export function createRunRunner(options) {
  const { ctx, store, settings, profile, workspaces, now = () => Date.now(), logger, random } = options
  const entries = new Map()
  const pendingDispatches = new Set()
  const bySession = new Map()
  let disposed = false
  let disposePromise
  let listenersInstalled = false
  const listenerDisposers = []

  function settingsOf() {
    return typeof settings === 'function' ? settings() ?? {} : settings ?? {}
  }

  function listDescendantAgents(entry) {
    const agents = service(ctx, 'agents')
    const root = entry.agent
    if (!root || typeof agents?.list !== 'function') return []
    return agents.list().filter((agent) => {
      if (agent === root) return false
      let session = agent?.session
      let hops = 0
      while (session?.header?.parentSession !== undefined && hops < MAX_SESSION_LINEAGE) {
        if (session.id === entry.sessionId) return true
        session = service(ctx, 'sessions')?.get?.(session.header.parentSession)
        hops += 1
      }
      return session?.id === entry.sessionId
    })
  }

  function sessionForId(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
    return service(ctx, 'sessions')?.get?.(sessionId)
  }

  /** Resolve a root or descendant without walking every active run on the event hot path. */
  function entryForSession(session) {
    let cursor = session
    let sessionId = cursor?.id
    const visited = new Set()
    for (let hops = 0; typeof sessionId === 'string' && sessionId.length > 0 && hops < MAX_SESSION_LINEAGE; hops += 1) {
      if (visited.has(sessionId)) return undefined
      visited.add(sessionId)
      const entry = entries.get(bySession.get(sessionId))
      if (entry !== undefined) return entry
      const parentSession = cursor?.header?.parentSession
      if (typeof parentSession !== 'string' || parentSession.length === 0) return undefined
      sessionId = parentSession
      cursor = sessionForId(sessionId) ?? { id: sessionId }
    }
    return undefined
  }

  function entryForSessionId(sessionId) {
    return entryForSession(sessionForId(sessionId) ?? { id: sessionId })
  }

  async function hasRunningDescendants(entry) {
    const subagents = service(ctx, 'subagents')
    if (typeof subagents?.listDescendants === 'function' && entry.sessionId !== undefined) {
      try {
        const descendants = await subagents.listDescendants(entry.sessionId)
        return descendants.some((item) => item?.kind === 'child' && item.activity === 'running')
      } catch {
        // Fall back to the live registry when the catalog is unavailable.
      }
    }
    return listDescendantAgents(entry).some((agent) => agent.status === 'running')
  }

  function armWall(entry) {
    if (entry.wallTimer !== undefined) return
    entry.wallTimer = setTimeout(() => {
      if (entry.finished) return
      void cancelEntry(entry, 'automation_run_timeout', 'timed_out', {
        phase: 'timeout',
        code: 'run_timeout',
        message: `运行超过 ${entry.task.limits.runTimeoutMinutes} 分钟，已取消。`,
      })
    }, entry.task.limits.runTimeoutMinutes * 60_000)
    entry.wallTimer.unref?.()
  }

  function armIdle(entry) {
    if (entry.idleTimer !== undefined) clearTimeout(entry.idleTimer)
    const idleMs = Math.max(60_000, entry.task.limits.idleTimeoutMinutes * 60_000)
    entry.idleTimer = setTimeout(() => {
      if (entry.finished) return
      void cancelEntry(entry, 'automation_idle_timeout', 'failed', {
        phase: 'timeout',
        code: 'idle_timeout',
        message: `运行连续 ${entry.task.limits.idleTimeoutMinutes} 分钟没有活动，已取消。`,
      })
    }, idleMs)
    entry.idleTimer.unref?.()
  }

  function clearTimers(entry) {
    for (const timer of [entry.wallTimer, entry.idleTimer, entry.cancelTimer, entry.settleTimer]) {
      if (timer !== undefined) clearTimeout(timer)
    }
    entry.wallTimer = undefined
    entry.idleTimer = undefined
    entry.cancelTimer = undefined
    entry.settleTimer = undefined
  }

  function pushError(entry, error) {
    const message = sanitizeMessage(error.message ?? String(error))
    if (entry.errors.some((item) => item.code === error.code && item.message === message && item.phase === error.phase)) return
    entry.errors.push({
      at: iso(now()),
      phase: error.phase ?? 'turn',
      severity: error.severity ?? 'error',
      code: error.code ?? 'automation_error',
      message,
      ...(error.tool === undefined ? {} : { tool: error.tool }),
    })
    if (entry.errors.length > MAX_ERRORS_PER_RUN) entry.errors.splice(0, entry.errors.length - MAX_ERRORS_PER_RUN)
  }

  async function updateEntryRun(entry, patch) {
    const updated = await store.updateRun(entry.run.id, patch).catch((error) => {
      pushError(entry, { phase: 'storage', code: 'run_update_failed', message: String(error) })
      return undefined
    })
    if (updated !== undefined) entry.run = updated
    return updated
  }

  async function flushSessionBounded(agent) {
    const sessions = service(ctx, 'sessions')
    const flush = sessions?.flush
    if (typeof flush !== 'function') return
    let timer
    try {
      await Promise.race([
        Promise.resolve().then(() => flush.call(sessions, agent.session)).catch(() => {}),
        new Promise((resolve) => {
          timer = setTimeout(resolve, FLUSH_TIMEOUT_MS)
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  async function finalize(entry, status, options = {}) {
    if (entry.finished) return
    entry.finished = true
    clearTimers(entry)
    const finishedAt = now()
    if (options.error !== undefined) pushError(entry, options.error)
    const started = entry.run.startedAt === undefined ? undefined : Date.parse(entry.run.startedAt)
    const agent = entry.agent
    if (agent !== undefined) await flushSessionBounded(agent)
    const updated = await updateEntryRun(entry, {
      status,
      finishedAt: iso(finishedAt),
      durationMs: Math.max(0, finishedAt - (started ?? Date.parse(entry.run.queuedAt))),
      steps: entry.steps,
      toolCalls: entry.toolCalls,
      blockedRequiresUser: entry.blocked === true,
      errors: [...entry.errors],
      ...(entry.summary === undefined ? {} : { summary: entry.summary }),
    })
    entries.delete(entry.id)
    if (entry.sessionId !== undefined) bySession.delete(entry.sessionId)
    await notify(entry, updated ?? { ...entry.run, status })
  }

  async function notify(entry, run) {
    if (settingsOf().inAppNotifications !== true) return
    const task = entry.task
    if (task.notifications.inApp !== true) return
    let kind
    if (run.status === 'failed' || run.status === 'blocked_requires_user') kind = 'run_failed'
    else if (run.status === 'timed_out') kind = 'run_timeout'
    else if (run.status === 'succeeded') {
      if (task.notifications.onSuccess !== true) return
      kind = 'run_succeeded'
    } else if (run.status.startsWith('skipped_') || run.status === 'missed') {
      return
    } else {
      return
    }
    if ((kind === 'run_failed' || kind === 'run_timeout') && task.notifications.onFailure !== true) return
    const title = (kind === 'run_succeeded'
      ? `任务完成：${task.title}`
      : kind === 'run_timeout'
        ? `任务超时：${task.title}`
        : `任务失败：${task.title}`).slice(0, 120)
    const message = run.errors?.at(-1)?.message ?? (run.summary ?? '')
    await store.addNotification({
      kind,
      title,
      message: sanitizeMessage(message).slice(0, 500),
      runId: run.id,
      taskId: task.id,
    }).catch(() => {})
  }

  async function cancelEntry(entry, reason, status, error) {
    if (entry.finished) return
    const previous = entry.cancelRequested
    if (previous !== undefined) {
      if (previous.status !== 'timed_out' && status === 'timed_out') previous.status = status
      if (error !== undefined) pushError(entry, error)
      return
    }
    entry.cancelRequested = { reason, status }
    entry.promptController?.abort()
    if (error !== undefined) pushError(entry, error)
    const finalStatus = () => entry.cancelRequested?.status ?? status
    entry.cancelTimer = setTimeout(() => {
      if (entry.finished) return
      const terminalStatus = finalStatus()
      const note = terminalStatus === 'timed_out'
        ? { phase: 'timeout', code: 'cancel_timeout', message: '取消宽限期已过，底层工具可能仍在运行；运行按超时收口。' }
        : { phase: 'timeout', code: 'cancel_grace_expired', message: '取消宽限期已过，底层工具可能仍在运行。' }
      void finalize(entry, terminalStatus, { error: note })
    }, CANCEL_GRACE_MS)
    entry.cancelTimer.unref?.()
    const agent = entry.agent
    if (agent !== undefined) {
      try {
        agent.cancel({ kind: 'hook', reason })
      } catch {
        // Agent already idle/disposed: the stored status still has to settle.
      }
      await drainDescendantsBounded(agent)
    }
    void maybeComplete(entry, true)
  }

  async function maybeComplete(entry, force = false) {
    if (entry.finished || (entry.promptAccepted !== true && entry.cancelRequested === undefined) || entry.completing === true) return
    if (!force && entry.cancelRequested === undefined) {
      if (entry.lastTurnEnd === undefined) return
      if (entry.agent?.status !== 'idle') return
      if ((entry.agent?.inbox?.nextTurn?.length ?? 0) + (entry.agent?.inbox?.nextStep?.length ?? 0) > 0) return
    }
    if (entry.settleTimer !== undefined) return
    entry.settleTimer = setTimeout(() => {
      entry.settleTimer = undefined
      entry.completing = true
      void (async () => {
        try {
          if (entry.finished) return
          const subagents = service(ctx, 'subagents')
          if (subagents?.waitForChildren !== undefined && entry.agent !== undefined) {
            const joined = await subagents.waitForChildren(entry.agent).catch(() => true)
            if (joined && !entry.finished && entry.cancelRequested === undefined) {
              armIdle(entry)
              return
            }
          }
          if (entry.cancelRequested !== undefined) {
            // The owner cancels descendants first; only report the terminal status after the root
            // and descendants are idle. The grace timer is the hard bound when they refuse to stop.
            if (entry.agent?.status !== undefined && entry.agent.status !== 'idle') {
              armIdle(entry)
              return
            }
            if (await hasRunningDescendants(entry)) {
              armIdle(entry)
              return
            }
            await finalize(entry, entry.cancelRequested.status)
            return
          }
          if (await hasRunningDescendants(entry)) {
            armIdle(entry)
            return
          }
          if (entry.agent?.status !== 'idle') {
            armIdle(entry)
            return
          }
          await finalize(entry, outcomeOf(entry), outcomeError(entry))
        } finally {
          entry.completing = false
        }
      })()
    }, force ? 0 : QUIET_SETTLE_MS)
    entry.settleTimer.unref?.()
  }

  function outcomeOf(entry) {
    if (entry.blocked === true) return 'blocked_requires_user'
    if (entry.lastTurnEnd === undefined) return 'unknown_after_restart'
    const reason = entry.lastTurnEnd.reason ?? {}
    if (reason.kind === 'completed') return 'succeeded'
    if (reason.kind === 'blocked') return 'blocked_requires_user'
    if (reason.kind === 'error' || reason.kind === 'max-tokens') return 'failed'
    if (reason.kind === 'interrupted' || reason.kind === 'forked') return 'unknown_after_restart'
    if (reason.kind === 'aborted') {
      const cause = reason.reason ?? {}
      if (cause.kind === 'hook' && String(cause.reason).includes('timeout')) return 'timed_out'
      return 'canceled'
    }
    return 'failed'
  }

  function outcomeError(entry) {
    if (entry.lastTurnEnd?.reason?.kind === 'error') {
      return {
        phase: 'llm',
        code: entry.lastTurnEnd.reason.error?.code ?? 'llm_error',
        message: entry.lastTurnEnd.reason.error?.message ?? '本轮模型请求失败。',
      }
    }
    if (entry.lastTurnEnd?.reason?.kind === 'max-tokens') {
      return { phase: 'turn', code: 'max_tokens', message: '本轮达到输出上限，未能形成完整结论。' }
    }
    return undefined
  }

  function countedEventKey(session, event) {
    const sessionId = typeof session?.id === 'string' ? session.id : ''
    if (Number.isSafeInteger(event.seq)) return `${sessionId}:seq:${event.seq}`
    if ((event.type === 'tool/call' || event.type === 'tool/ptc-dispatch') && typeof event.callId === 'string') {
      return `${sessionId}:${event.type}:${event.callId}`
    }
    if (event.type === 'step/start' && Number.isSafeInteger(event.turn) && Number.isSafeInteger(event.step)) {
      return `${sessionId}:step:${event.turn}:${event.step}`
    }
    return undefined
  }

  function countEventOnce(entry, session, event) {
    const key = countedEventKey(session, event)
    if (key === undefined) return true
    if (entry.countedEvents.has(key)) return false
    entry.countedEvents.add(key)
    if (entry.countedEvents.size > MAX_COUNTED_EVENT_KEYS) {
      entry.countedEvents.delete(entry.countedEvents.values().next().value)
    }
    return true
  }

  function onSessionEvent(session, event) {
    if (event === undefined || typeof event.type !== 'string') return
    const entry = entryForSession(session)
    if (entry === undefined || entry.finished) return
    const rootEvent = session?.id === entry.sessionId
    if (event.type === 'step/start') {
      if (!countEventOnce(entry, session, event)) return
      armIdle(entry)
      entry.steps += 1
      if (entry.steps > entry.task.limits.maxSteps) {
        void cancelEntry(entry, 'automation_step_limit', 'failed', {
          phase: 'timeout',
          code: 'step_limit',
          message: `运行步数超过上限 ${entry.task.limits.maxSteps}，已取消。`,
        })
      }
      return
    }
    if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch') {
      if (!countEventOnce(entry, session, event)) return
      armIdle(entry)
      entry.toolCalls += 1
      if (typeof event.callId === 'string' && typeof event.name === 'string') entry.toolNames.set(event.callId, event.name)
      if (entry.toolCalls > entry.task.limits.maxToolCalls) {
        void cancelEntry(entry, 'automation_tool_limit', 'failed', {
          phase: 'timeout',
          code: 'tool_limit',
          message: `工具调用数超过上限 ${entry.task.limits.maxToolCalls}，已取消。`,
        })
      }
      return
    }
    if (event.type === 'tool/result') {
      armIdle(entry)
      if (event.message?.isError !== true) return
      const tool = entry.toolNames.get(event.callId)
      pushError(entry, {
        phase: 'tool',
        code: event.error?.code ?? 'tool_error',
        message: event.error?.reason ?? '工具调用失败。',
        ...(tool === undefined ? {} : { tool }),
        ...(typeof event.callId === 'string' ? { callId: event.callId } : {}),
      })
      return
    }
    if (event.type === 'assistant/message') {
      armIdle(entry)
      if (!rootEvent) return
      const text = textOfMessage(event.message)
      if (text.length > 0) entry.summary = sanitizeMessage(text).slice(0, MAX_SUMMARY_CHARS)
      return
    }
    if (event.type === 'turn/end') {
      armIdle(entry)
      if (!rootEvent) return
      entry.lastTurnEnd = { turn: event.turn, reason: event.reason }
      void maybeComplete(entry)
    }
  }

  function onAgentStatus(payload) {
    const agent = payload?.agent
    if (agent === undefined) return
    const entry = entryForSession(agent.session)
    if (entry === undefined || entry.finished) return
    if (payload.status === 'running') armIdle(entry)
    else void maybeComplete(entry)
  }

  function onSubagentEnd(info) {
    const entry = entryForSessionId(info?.id)
    if (entry !== undefined && !entry.finished) void maybeComplete(entry)
  }

  function installListeners() {
    if (listenersInstalled || typeof ctx.on !== 'function') return
    listenersInstalled = true
    const disposers = []
    try {
      for (const [event, listener] of [
        ['session/event', onSessionEvent],
        ['agent/status', onAgentStatus],
        ['subagent/end', onSubagentEnd],
      ]) {
        const dispose = ctx.on(event, listener)
        if (typeof dispose === 'function') disposers.push(dispose)
      }
      listenerDisposers.push(...disposers)
    } catch (error) {
      for (const dispose of disposers.reverse()) {
        try { dispose() } catch { /* best effort */ }
      }
      listenersInstalled = false
      logger?.warn?.(`capital-automation: 运行监听器安装失败：${String(error)}`)
    }
  }

  function disposeListeners() {
    for (const dispose of listenerDisposers.splice(0).reverse()) {
      try { dispose() } catch { /* best effort */ }
    }
    listenersInstalled = false
  }

  async function drainDescendantsBounded(agent) {
    const subagents = service(ctx, 'subagents')
    const drain = subagents?.drainDescendants
    if (typeof drain !== 'function') return
    let timer
    try {
      await Promise.race([
        Promise.resolve().then(() => drain.call(subagents, [agent])).catch(() => {}),
        new Promise((resolve) => {
          timer = setTimeout(resolve, CANCEL_GRACE_MS)
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  async function stopEntryAgent(entry, controller) {
    let agent = entry.agent
    if (agent === undefined && entry.sessionId !== undefined && typeof controller?.resolveAgent === 'function') {
      try {
        agent = (await controller.resolveAgent(entry.sessionId))?.agent
        if (agent !== undefined) entry.agent = agent
      } catch {
        return
      }
    }
    if (agent === undefined) return
    try {
      agent.cancel({ kind: 'hook', reason: 'automation_disposed' })
    } catch {
      // The Agent may already have been disposed.
    }
    await drainDescendantsBounded(agent)
  }

  async function markDisposedRun(run) {
    const current = await store.getRun(run.id).catch(() => undefined)
    if (current === undefined || !store.isActiveRun(current.status)) return
    const finishedAt = now()
    await store.setAttemptState(run.occurrenceKey, 'unknown').catch(() => {})
    await store.updateRun(run.id, {
      status: 'unknown_after_restart',
      finishedAt: iso(finishedAt),
      durationMs: Math.max(0, finishedAt - Date.parse(current.queuedAt)),
      errors: [...current.errors, {
        at: iso(finishedAt),
        phase: 'session',
        severity: 'warning',
        code: 'unknown_after_restart',
        message: '自动化 runtime 在运行开始前结束；未自动重试。',
      }].slice(-MAX_ERRORS_PER_RUN),
    }).catch(() => {})
  }

  async function abandonEntry(entry, controller) {
    if (entry.abandonPromise !== undefined) return entry.abandonPromise
    entry.abandoned = true
    entry.finished = true
    clearTimers(entry)
    entry.promptController?.abort()
    entry.abandonPromise = (async () => {
      await stopEntryAgent(entry, controller)
      const at = now()
      const current = await store.getRun(entry.id).catch(() => undefined)
      if (current !== undefined && store.isActiveRun(current.status)) {
        await store.setAttemptState(entry.run.occurrenceKey, 'unknown').catch(() => {})
        await store.updateRun(entry.id, {
          status: 'unknown_after_restart',
          finishedAt: iso(at),
          durationMs: Math.max(0, at - Date.parse(current.queuedAt)),
          errors: [...current.errors, {
            at: iso(at),
            phase: 'session',
            severity: 'warning',
            code: 'unknown_after_restart',
            message: '自动化 runtime 结束时无法证明本轮运行已经结束；未自动重试。',
          }].slice(-MAX_ERRORS_PER_RUN),
        }).catch(() => {})
      }
      entries.delete(entry.id)
      if (entry.sessionId !== undefined && bySession.get(entry.sessionId) === entry.id) bySession.delete(entry.sessionId)
      entry.toolNames.clear()
      entry.countedEvents.clear()
    })()
    return entry.abandonPromise
  }

  function dispatchStopped(entry) {
    return disposed || entry.abandoned || entry.finished || entry.cancelRequested !== undefined
  }

  function canDispatch() {
    return !disposed && entries.size < MAX_ACTIVE_RUNS
  }

  async function dispatchInternal(run, task, trigger) {
    if (disposed) {
      await markDisposedRun(run)
      return false
    }
    if (entries.has(run.id)) return false
    const current = await store.getRun(run.id).catch(() => undefined)
    if (current === undefined || current.status !== 'queued') return false
    if (disposed) {
      await markDisposedRun(run)
      return false
    }
    if (!canDispatch()) {
      const finishedAt = now()
      await store.updateRun(run.id, {
        status: 'skipped_overlap',
        finishedAt: iso(finishedAt),
        durationMs: Math.max(0, finishedAt - Date.parse(run.queuedAt)),
      }).catch(() => {})
      return false
    }
    const entry = {
      id: run.id,
      run,
      task,
      trigger,
      sessionId: undefined,
      agent: undefined,
      steps: 0,
      toolCalls: 0,
      errors: [],
      toolNames: new Map(),
      countedEvents: new Set(),
      blocked: false,
      abandoned: false,
      abandonPromise: undefined,
      promptController: undefined,
      summary: undefined,
      lastTurnEnd: undefined,
      promptAccepted: false,
      finished: false,
      completing: false,
      cancelRequested: undefined,
      wallTimer: undefined,
      idleTimer: undefined,
      cancelTimer: undefined,
      settleTimer: undefined,
    }
    entries.set(entry.id, entry)
    armWall(entry)
    try {
      const started = await updateEntryRun(entry, { status: 'starting', startedAt: iso(now()) })
      if (started !== undefined && !store.isActiveRun(started.status)) {
        entry.finished = true
        clearTimers(entry)
        entries.delete(entry.id)
        return false
      }
      if (dispatchStopped(entry)) {
        if (disposed || entry.abandoned) await abandonEntry(entry)
        return
      }
      const controller = service(ctx, 'sessionController')
      if (controller?.create === undefined) throw new Error('sessionController 不可用')
      if (profile.runDir === undefined) throw new Error('profile run directory 不可用')
      const target = workspaces === undefined
        ? { workspaceId: undefined, path: profile.runDir }
        : await workspaces.resolve(task.workspaceId)
      if (dispatchStopped(entry)) {
        if (disposed || entry.abandoned) await abandonEntry(entry, controller)
        return
      }
      if (target.workspaceId === undefined) await mkdir(target.path ?? profile.runDir, { recursive: true, mode: 0o700 })
      const created = target.workspaceId === undefined
        ? await controller.create({ cwd: target.path ?? profile.runDir, agentPreset: PRESET_ID })
        : await controller.create({ workspaceId: target.workspaceId, agentPreset: PRESET_ID })
      entry.sessionId = created.sessionId
      if (disposed || entry.abandoned) {
        await stopEntryAgent(entry, controller)
        return
      }
      bySession.set(created.sessionId, entry.id)
      if (entry.cancelRequested !== undefined) {
        await stopEntryAgent(entry, controller)
        return
      }
      const title = sessionTitleOf(task, profile.displayName, run.id)
      const renamed = controller.rename === undefined
        ? undefined
        : await controller.rename({ sessionId: created.sessionId, title }).catch(() => undefined)
      const sessionTitle = renamed?.title ?? title
      await store.setAttemptState(run.occurrenceKey, 'session_created')
      await updateEntryRun(entry, { sessionId: created.sessionId, sessionTitle })
      if (dispatchStopped(entry)) {
        if (disposed || entry.abandoned) await abandonEntry(entry, controller)
        else await stopEntryAgent(entry, controller)
        return
      }
      const resolved = await controller.resolveAgent(created.sessionId)
      if (resolved?.error !== undefined) throw new Error(`session resolve failed: ${resolved.error?.code ?? resolved.error}`)
      entry.agent = resolved.agent
      if (dispatchStopped(entry)) {
        if (disposed || entry.abandoned) await abandonEntry(entry, controller)
        else await stopEntryAgent(entry, controller)
        return
      }
      if (typeof ctx.on === 'function') {
        installListeners()
      }
      armIdle(entry)
      if (dispatchStopped(entry)) {
        if (disposed || entry.abandoned) await abandonEntry(entry, controller)
        else await stopEntryAgent(entry, controller)
        return
      }
      await store.setAttemptState(run.occurrenceKey, 'prompt_submitted')
      if (dispatchStopped(entry)) return
      entry.promptController = new AbortController()
      let receipt
      try {
        receipt = await controller.prompt({
          requestId: `automation-${run.id}`,
          sessionId: created.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: buildRunPrompt({ task, run, trigger, profileName: profile.displayName, now: now() }) }],
          clientTimeZone: task.trigger.timezone,
        }, entry.promptController.signal)
      } catch (error) {
        if (entry.abandoned || disposed || entry.cancelRequested !== undefined || entry.finished) return
        entry.promptAccepted = false
        await store.setAttemptState(run.occurrenceKey, 'unknown').catch(() => {})
        await finalize(entry, 'unknown_after_restart', {
          error: { phase: 'session', code: 'prompt_not_accepted', message: `无法确认首条指令是否被 Agent 接受：${String(error)}` },
        })
        return
      } finally {
        entry.promptController = undefined
      }
      if (dispatchStopped(entry)) return
      if (receipt?.accepted !== true) {
        await store.setAttemptState(run.occurrenceKey, 'unknown').catch(() => {})
        await finalize(entry, 'unknown_after_restart', {
          error: { phase: 'session', code: 'prompt_not_accepted', message: 'Agent 未明确接受首条指令。' },
        })
        return
      }
      if (dispatchStopped(entry)) return
      entry.promptAccepted = true
      await store.setAttemptState(run.occurrenceKey, 'accepted')
      if (dispatchStopped(entry)) return
      await updateEntryRun(entry, { status: 'running' })
      if (dispatchStopped(entry)) return
      armIdle(entry)
      void maybeComplete(entry)
    } catch (error) {
      if (entry.abandoned || disposed || entry.finished || entry.cancelRequested !== undefined) return
      await store.setAttemptState(run.occurrenceKey, 'failed').catch(() => {})
      const code = error?.code === 'workspace_not_found' || error?.code === 'workspace_unavailable'
        ? error.code
        : 'session_create_failed'
      const message = code === 'session_create_failed' ? `创建运行会话失败：${String(error)}` : String(error.message ?? error)
      await finalize(entry, 'failed', { error: { phase: 'session', code, message } })
    }
  }

  function dispatch(run, task, trigger) {
    const pending = dispatchInternal(run, task, trigger)
    pendingDispatches.add(pending)
    pending.finally(() => pendingDispatches.delete(pending)).catch(() => {})
    return pending
  }

  function cancelRun(runId, status = 'canceled') {
    const entry = entries.get(runId)
    if (entry === undefined) return false
    void cancelEntry(entry, 'automation_user_cancel', status)
    return true
  }

  function noteGuardDenied(sessionId, tool, reason) {
    const entry = entryForSessionId(sessionId)
    if (entry === undefined) return
    entry.blocked = true
    pushError(entry, { phase: 'tool', code: 'blocked_requires_user', message: reason, tool })
  }

  function dispose() {
    if (disposePromise !== undefined) return disposePromise
    disposed = true
    disposeListeners()
    const pending = [...entries.values()].map((entry) => abandonEntry(entry))
    const dispatches = [...pendingDispatches]
    const all = Promise.allSettled([...pending, ...dispatches])
    let timer
    disposePromise = Promise.race([
      all,
      new Promise((resolve) => {
        timer = setTimeout(resolve, DISPOSE_TIMEOUT_MS)
        timer.unref?.()
      }),
    ]).finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    }).then(() => undefined)
    return disposePromise
  }

  return {
    dispatch,
    cancelRun,
    noteGuardDenied,
    hasAutomationSession: (sessionId) => entryForSessionId(sessionId) !== undefined,
    runForSession: (sessionId) => entryForSessionId(sessionId)?.id,
    activeRuns: () => [...entries.keys()],
    canDispatch,
    dispose,
    installListeners,
  }
}

function textOfMessage(message, maxChars = MAX_SUMMARY_CHARS) {
  const content = message?.content
  if (!Array.isArray(content) || maxChars <= 0) return ''
  const chunks = []
  let remaining = maxChars
  for (const block of content) {
    if (remaining <= 0) break
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    const text = block.text.slice(0, remaining)
    chunks.push(text)
    remaining -= text.length
  }
  return chunks.join('\n')
}
