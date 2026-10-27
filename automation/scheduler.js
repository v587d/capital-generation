/**
 * Capital-owned scheduler. One process per profile wins the filesystem lease; the tick reads
 * configuration, computes the latest due occurrence, claims it, and hands one fresh session to
 * the runner. It never waits for a model turn and never reads market data.
 */
import { DEFAULT_CATCH_UP_MS, DEFAULT_OWNER_LEASE_MS } from './defaults.js'
import { createOwnerLease } from './owner.js'
import { sanitizeMessage } from './redact.js'
import { formatInZone, occurrenceKeyOf, previousOccurrenceAtOrBefore, scheduleVersionOf } from './time.js'

function iso(now) {
  return new Date(now).toISOString()
}

export function createScheduler(options) {
  const {
    store,
    runner,
    owner,
    calendar,
    profile,
    getSettings,
    now = () => Date.now(),
    logger,
    random,
  } = options
  const ownerId = owner?.ownerId ?? `owner-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  const lease = options.lease ?? owner?.lease ?? createOwnerLease({
    directory: profile.ownerDir,
    profileKey: store.profileKey,
    ownerId,
    leaseMs: DEFAULT_OWNER_LEASE_MS,
    now,
    random,
  })
  const state = {
    state: 'starting',
    ownerId,
    fencingToken: undefined,
    leaseExpiresAt: null,
    heartbeatAt: null,
    storageError: null,
    recoveredRuns: 0,
    lastTickAt: null,
    lastError: null,
  }
  let timer
  let heartbeatTimer
  let currentTickMs
  let stopped = false
  let tickInFlight
  let stopPromise
  let manualAdmission = Promise.resolve()
  let recovered = false
  let lastStandbyNoticeAt = 0

  function settings() {
    return getSettings()
  }

  async function ownerIsCurrent() {
    if (lease.held !== true) return false
    if (typeof lease.isCurrent === 'function') {
      try {
        return await lease.isCurrent()
      } catch {
        return false
      }
    }
    return lease.fencingToken !== undefined
  }

  async function requireCurrentOwner() {
    if (await ownerIsCurrent()) return true
    await standby('调度租约已失效：本进程不再投递新运行。')
    return false
  }

  async function publishOwner() {
    const at = now()
    const record = {
      schemaVersion: 1,
      profileKey: store.profileKey,
      ownerId,
      fencingToken: lease.fencingToken ?? ownerId,
      leaseExpiresAt: iso(at + (settings().ownerLeaseMs ?? DEFAULT_OWNER_LEASE_MS)),
      heartbeatAt: iso(at),
      schedulerState: state.state === 'active' ? 'active' : 'standby',
      updatedAt: iso(at),
    }
    state.fencingToken = record.fencingToken
    state.leaseExpiresAt = record.leaseExpiresAt
    state.heartbeatAt = record.heartbeatAt
    await store.setOwnerMeta(record).catch((error) => {
      state.storageError = String(error)
    })
  }

  async function standby(message) {
    if (state.state !== 'standby') logger?.warn?.(`capital-automation: ${message}`)
    state.state = 'standby'
    state.leaseExpiresAt = null
    const at = now()
    if (at - lastStandbyNoticeAt < 10 * 60_000) return
    lastStandbyNoticeAt = at
    if (settings().inAppNotifications !== true) return
    await store.addNotification({
      kind: 'scheduler_standby',
      title: '调度器未取得运行权',
      message: message.slice(0, 500),
    }).catch(() => {})
  }

  async function tryAcquire() {
    if (lease.held) {
      const renewed = await lease.renew()
      if (!renewed) {
        await standby('调度租约已失效：本进程不再投递新运行。')
        return false
      }
    } else {
      const acquired = await lease.acquire()
      if (!acquired) {
        await standby('另一个进程持有当前 profile 的调度租约；本页面只读，不投递运行。')
        return false
      }
    }
    if (!(await ownerIsCurrent())) {
      await standby('调度租约未通过当前 owner/token 校验，本进程不再投递新运行。')
      return false
    }
    state.state = 'active'
    startHeartbeat()
    await publishOwner()
    if (!(await ownerIsCurrent())) {
      await standby('调度租约在状态发布期间已被接管，本进程不再投递新运行。')
      return false
    }
    if (!recovered) {
      recovered = true
      try {
        state.recoveredRuns = await store.recoverNonTerminalRuns()
        if (state.recoveredRuns > 0) logger?.warn?.(`capital-automation: ${state.recoveredRuns} 个上次进程的运行已标记 unknown_after_restart`)
      } catch (error) {
        state.lastError = String(error)
      }
    }
    return true
  }

  async function createSkipped(task, occurrenceKey, status, scheduledFor, error) {
    const run = await store.createRun({
      taskId: task.id,
      taskTitle: task.title,
      trigger: 'scheduled',
      occurrenceKey,
      ...(scheduledFor === undefined ? {} : { scheduledFor }),
      status,
    })
    await store.updateRun(run.id, {
      status,
      finishedAt: iso(now()),
      durationMs: 0,
      ...(error === undefined ? {} : { errors: [error] }),
    }).catch(() => {})
    await store.setLastHandled(task.id, occurrenceKey, scheduledFor)
    if (status === 'skipped_calendar_unavailable' && settings().inAppNotifications === true && task.notifications.inApp === true) {
      await store.addNotification({
        kind: 'calendar_unavailable',
        title: `交易日历不可用：${task.title}`.slice(0, 120),
        message: '任务已按 fail-closed 跳过；请更新交易日历表后再启用。',
        runId: run.id,
        taskId: task.id,
      }).catch(() => {})
    }
    return run
  }

  async function dueForTask(task) {
    if (!(await requireCurrentOwner())) return
    const latest = previousOccurrenceAtOrBefore(task.trigger, now(), { calendar })
    if (latest.kind === 'none') return
    if (latest.kind === 'calendar_unavailable') {
      const key = `${store.profileKey}:calendar:${latest.localDate}`
      if (task.lastHandledOccurrenceKey === key) return
      await createSkipped(task, key, 'skipped_calendar_unavailable', undefined, {
        at: iso(now()),
        phase: 'schedule',
        severity: 'warning',
        code: 'calendar_unavailable',
        message: `交易日历不可用（${latest.localDate}）：按 fail-closed 跳过，不按周一至周五猜测运行。`,
      })
      return
    }
    const key = occurrenceKeyOf(store.profileKey, task.id, latest.scheduleVersion, latest.scheduledFor)
    if (task.lastHandledOccurrenceKey === key) return
    // A clock rollback must not re-run a claimed instant: compare the high-water mark, not just keys.
    if (task.lastScheduledFor !== undefined && latest.instant <= Date.parse(task.lastScheduledFor)) return
    const anchor = Date.parse(task.scheduleAnchorAt)
    if (Number.isFinite(anchor) && latest.instant < anchor) {
      await store.setLastHandled(task.id, key, latest.scheduledFor)
      return
    }
    const catchUpMs = settings().catchUpMs ?? DEFAULT_CATCH_UP_MS
    if (now() - latest.instant > catchUpMs) {
      await createSkipped(task, key, 'missed', latest.scheduledFor, {
        at: iso(now()),
        phase: 'schedule',
        severity: 'warning',
        code: 'missed_occurrence',
        message: '进程未在计划时刻运行；按设计不补跑，可在页面手动发起一次新运行。',
      })
      return
    }
    if (await store.activeRunForTask(task.id) !== undefined) {
      await createSkipped(task, key, 'skipped_overlap', latest.scheduledFor)
      return
    }
    if (runner.canDispatch?.() === false) {
      await createSkipped(task, key, 'skipped_overlap', latest.scheduledFor)
      return
    }
    if (await store.hasAttempt(key)) {
      await store.setLastHandled(task.id, key, latest.scheduledFor)
      return
    }
    const run = await store.createRun({
      taskId: task.id,
      taskTitle: task.title,
      trigger: 'scheduled',
      occurrenceKey: key,
      scheduleVersion: latest.scheduleVersion,
      scheduledFor: latest.scheduledFor,
      status: 'queued',
    })
    if (!(await requireCurrentOwner())) {
      await store.updateRun(run.id, {
        status: 'unknown_after_restart',
        finishedAt: iso(now()),
        durationMs: 0,
        errors: [{
          at: iso(now()),
          phase: 'schedule',
          severity: 'warning',
          code: 'owner_lost_before_dispatch',
          message: '调度租约在投递前失效；本次运行未自动重试。',
        }],
      }).catch(() => {})
      await store.setLastHandled(task.id, key, latest.scheduledFor).catch(() => {})
      return
    }
    const claimed = await store.claimOccurrence({ taskId: task.id, runId: run.id, occurrenceKey: key })
    if (!claimed) {
      await store.updateRun(run.id, { status: 'skipped_overlap', finishedAt: iso(now()), durationMs: 0 })
      await store.setLastHandled(task.id, key, latest.scheduledFor)
      return
    }
    if (!(await requireCurrentOwner())) {
      await store.setAttemptState(key, 'unknown').catch(() => {})
      await store.updateRun(run.id, {
        status: 'unknown_after_restart',
        finishedAt: iso(now()),
        durationMs: 0,
        errors: [{
          at: iso(now()),
          phase: 'schedule',
          severity: 'warning',
          code: 'owner_lost_before_dispatch',
          message: '调度租约在投递前失效；本次运行未自动重试。',
        }],
      }).catch(() => {})
      return
    }
    await store.setLastHandled(task.id, key, latest.scheduledFor)
    if (runner.canDispatch?.() === false) {
      await store.setAttemptState(key, 'unknown').catch(() => {})
      await store.updateRun(run.id, {
        status: 'skipped_overlap',
        finishedAt: iso(now()),
        durationMs: Math.max(0, now() - Date.parse(run.queuedAt)),
      }).catch(() => {})
      return
    }
    void Promise.resolve().then(() => runner.dispatch(run, task, 'scheduled')).catch((error) => {
      logger?.warn?.(`capital-automation: scheduled dispatch failed: ${String(error)}`)
    })
  }

  async function tick() {
    if (stopped) return
    if (tickInFlight !== undefined) return tickInFlight
    tickInFlight = (async () => {
      try {
        if (!(await tryAcquire())) return
        if (timer !== undefined && currentTickMs !== Math.max(30_000, settings().tickMs)) armTick()
        state.lastTickAt = iso(now())
        const tasks = await store.listTasks()
        for (const task of tasks) {
          if (stopped) return
          if (task.state !== 'active') continue
          await dueForTask(task)
        }
      } catch (error) {
        state.lastError = String(error)
        logger?.warn?.(`capital-automation: tick 失败：${String(error)}`)
      } finally {
        tickInFlight = undefined
      }
    })()
    return tickInFlight
  }

  function armTick() {
    if (timer !== undefined) clearInterval(timer)
    currentTickMs = Math.max(30_000, settings().tickMs)
    timer = setInterval(() => { void tick() }, currentTickMs)
    timer.unref?.()
  }

  async function start() {
    if (stopped) return
    await tick()
    if (stopped) return
    armTick()
    startHeartbeat()
  }

  /**
   * The tick may be delayed by a long model-independent storage write; renew the lease on its
   * own clock so another process cannot legitimately take over between ticks.
   */
  function startHeartbeat() {
    if (heartbeatTimer !== undefined || stopped) return
    const heartbeatMs = Math.max(15_000, Math.min(settings().tickMs, DEFAULT_OWNER_LEASE_MS / 3))
    heartbeatTimer = setInterval(() => {
      if (stopped || state.state !== 'active') return
      void lease.renew().then(async (renewed) => {
        if (renewed && await ownerIsCurrent()) {
          await publishOwner()
          return
        }
        await standby('调度租约已失效：本进程不再投递新运行。')
      }).catch(() => {})
    }, heartbeatMs)
    heartbeatTimer.unref?.()
  }

  async function stopInternal() {
    stopped = true
    if (timer !== undefined) clearInterval(timer)
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
    timer = undefined
    heartbeatTimer = undefined
    currentTickMs = undefined
    await manualAdmission.catch(() => {})
    await tickInFlight?.catch(() => {})
    if (lease.held && await ownerIsCurrent()) {
      await store.setOwnerMeta({
        schemaVersion: 1,
        profileKey: store.profileKey,
        ownerId,
        fencingToken: lease.fencingToken ?? ownerId,
        leaseExpiresAt: iso(now()),
        heartbeatAt: iso(now()),
        schedulerState: 'standby',
        updatedAt: iso(now()),
      }).catch(() => {})
    }
    await lease.release().catch(() => {})
    state.state = 'stopped'
  }

  function stop() {
    if (stopPromise !== undefined) return stopPromise
    stopPromise = stopInternal()
    return stopPromise
  }

  /** Manual runs require the same owner as scheduled ones; standby never bypasses it. */
  async function runNowInternal(task) {
    if (stopped) return { ok: false, code: 'scheduler_unavailable', message: '调度器已停止。' }
    if (state.state !== 'active') {
      const acquired = await tryAcquire()
      if (!acquired || state.state !== 'active') {
        return { ok: false, code: 'scheduler_unavailable', message: '调度器未取得运行权，无法手动运行。' }
      }
    }
    if (!(await requireCurrentOwner())) {
      return { ok: false, code: 'scheduler_unavailable', message: '调度器未取得当前运行权，无法手动运行。' }
    }
    const active = await store.activeRunForTask(task.id)
    if (active !== undefined) {
      return { ok: false, code: 'run_in_progress', message: '该任务仍在运行，请先取消或等待终态。', runId: active.id }
    }
    if (runner.canDispatch?.() === false) {
      return { ok: false, code: 'run_capacity', message: '当前 profile 已达到自动化并发上限，请等待已有运行结束。' }
    }
    const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    const run = await store.createRun({
      id: runId,
      taskId: task.id,
      taskTitle: task.title,
      trigger: 'manual',
      occurrenceKey: `${store.profileKey}:manual:${runId}`,
      status: 'queued',
    })
    if (!(await requireCurrentOwner())) {
      await store.updateRun(run.id, {
        status: 'unknown_after_restart',
        finishedAt: iso(now()),
        durationMs: 0,
        errors: [{
          at: iso(now()),
          phase: 'schedule',
          severity: 'warning',
          code: 'owner_lost_before_dispatch',
          message: '调度租约在投递前失效；本次运行未自动重试。',
        }],
      }).catch(() => {})
      return { ok: false, code: 'scheduler_unavailable', message: '调度器未取得当前运行权，无法手动运行。', runId: run.id }
    }
    const claimed = await store.claimOccurrence({ taskId: task.id, runId: run.id, occurrenceKey: run.occurrenceKey })
    if (!claimed) {
      await store.updateRun(run.id, { status: 'skipped_overlap', finishedAt: iso(now()), durationMs: 0 }).catch(() => {})
      return { ok: false, code: 'duplicate_run', message: '这次手动运行已经被登记。', runId: run.id }
    }
    if (!(await requireCurrentOwner())) {
      await store.setAttemptState(run.occurrenceKey, 'unknown').catch(() => {})
      await store.updateRun(run.id, {
        status: 'unknown_after_restart',
        finishedAt: iso(now()),
        durationMs: 0,
        errors: [{
          at: iso(now()),
          phase: 'schedule',
          severity: 'warning',
          code: 'owner_lost_before_dispatch',
          message: '调度租约在投递前失效；本次运行未自动重试。',
        }],
      }).catch(() => {})
      return { ok: false, code: 'scheduler_unavailable', message: '调度器未取得当前运行权，无法手动运行。', runId: run.id }
    }
    if (runner.canDispatch?.() === false) {
      await store.setAttemptState(run.occurrenceKey, 'unknown').catch(() => {})
      await store.updateRun(run.id, {
        status: 'skipped_overlap',
        finishedAt: iso(now()),
        durationMs: Math.max(0, now() - Date.parse(run.queuedAt)),
      }).catch(() => {})
      return { ok: false, code: 'run_capacity', message: '当前 profile 已达到自动化并发上限，请等待已有运行结束。', runId: run.id }
    }
    void Promise.resolve().then(() => runner.dispatch(run, task, 'manual')).catch((error) => {
      logger?.warn?.(`capital-automation: manual dispatch failed: ${String(error)}`)
    })
    return { ok: true, run }
  }

  function runNow(task) {
    const next = manualAdmission.then(() => runNowInternal(task), () => runNowInternal(task))
    manualAdmission = next.then(() => {}, () => {})
    return next
  }

  function status() {
    return {
      state: state.state,
      profileKey: store.profileKey,
      leaseExpiresAt: state.leaseExpiresAt,
      heartbeatAt: state.heartbeatAt,
      held: lease.held,
      tickMs: settings().tickMs,
      recoveredRuns: state.recoveredRuns,
      lastTickAt: state.lastTickAt,
      storageError: state.storageError === null ? null : sanitizeMessage(state.storageError),
      lastError: state.lastError === null ? null : sanitizeMessage(state.lastError),
      calendar: calendar?.status?.(new Date(now())) ?? { available: false, source: 'none' },
    }
  }

  return {
    start,
    stop,
    tick,
    runNow,
    status,
    ownerId,
    lease,
    /** Next occurrence for display; the scheduler itself works from the previous occurrence. */
    displayNext(task) {
      return previousOccurrenceAtOrBefore(task.trigger, now(), { calendar })
    },
    formatInZone,
    scheduleVersionOf,
  }
}
