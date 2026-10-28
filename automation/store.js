/**
 * Fixed `capital_automation` storage domain. Every record carries the server-derived
 * `profileKey`; list/read/write/cancel/notification paths filter on it before doing anything
 * else. The client never supplies a profile, owner, session, preset or cwd.
 */
import { createHash, randomUUID } from 'node:crypto'
import {
  AttemptRecordSchema,
  AutomationTaskSchema,
  NotificationSchema,
  OwnerRecordSchema,
  RunRecordSchema,
  TaskConfigSchema,
  TaskOverridesSchema,
  TaskRecordSchema,
  isActiveRun,
  parseStrict,
  resolveTaskRecord,
} from './schema.js'
import { BUILTIN_BY_ID, BUILTIN_DEFINITIONS } from './builtins.js'
import {
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_RUN_TIMEOUT_MINUTES,
  MAX_ERRORS_PER_RUN,
  MAX_NOTIFICATIONS_PER_PROFILE,
  MAX_RUNS_PER_PROFILE,
  MAX_RUNS_PER_TASK,
  SETTLED_RUN_STATUSES,
} from './defaults.js'
import { canonicalTrigger, formatInZone, nextOccurrence } from './time.js'

export const DOMAIN_NAME = 'capital_automation'
export const ROUTE_PATH = '/capital-automation'

/** Declared as a plain object; `defineDomain` only re-validates the same fields. */
export const domainSpec = {
  name: DOMAIN_NAME,
  version: 1,
  layout: 'single',
  tables: {
    tasks: { valueSchema: TaskRecordSchema },
    runs: { valueSchema: RunRecordSchema },
    attempts: { valueSchema: AttemptRecordSchema },
    notifications: { valueSchema: NotificationSchema },
    meta: { valueSchema: OwnerRecordSchema },
  },
}

export function profileKeyOf(profileName) {
  const digest = createHash('sha256').update(String(profileName)).digest('hex').slice(0, 24)
  return `p_${digest}`
}

function builtinRecordId(profileKey, builtinId) {
  return `bt_${createHash('sha256').update(`${profileKey}:${builtinId}`).digest('hex').slice(0, 24)}`
}

function iso(now) {
  return new Date(now).toISOString()
}

export class StorageUnavailableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StorageUnavailableError'
    this.code = 'storage_unavailable'
  }
}

export function createAutomationStore(options) {
  const {
    openDomain,
    profile,
    now = () => Date.now(),
    random = () => randomUUID(),
    builtins = BUILTIN_DEFINITIONS,
  } = options
  const rawProfileName = String(profile?.name ?? '')
  const profileName = rawProfileName.slice(0, 200)
  const profileKey = profileKeyOf(rawProfileName)
  const profileById = new Map(builtins.map((definition) => [definition.id, definition]))
  let opening
  let claimChain = Promise.resolve()

  function serializeClaim(operation) {
    const next = claimChain.then(operation, operation)
    claimChain = next.then(() => {}, () => {})
    return next
  }

  async function open() {
    if (opening === undefined) {
      opening = (async () => {
        const domain = await openDomain()
        return {
          domain,
          tasks: domain.table('tasks'),
          runs: domain.table('runs'),
          attempts: domain.table('attempts'),
          notifications: domain.table('notifications'),
          meta: domain.table('meta'),
        }
      })()
    }
    try {
      return await opening
    } catch (error) {
      // Never memoize a failed open: the facility may mount after this call.
      opening = undefined
      throw new StorageUnavailableError(error instanceof Error ? error.message : String(error))
    }
  }

  function ownTask(record) {
    return record !== undefined && record.profileKey === profileKey
  }

  function ownRun(record) {
    return record !== undefined && record.profileKey === profileKey
  }

  async function seedBuiltins(tables) {
    const at = iso(now())
    for (const definition of builtins) {
      const id = builtinRecordId(profileKey, definition.id)
      const existing = tables.tasks.get(id)
      if (!ownTask(existing)) {
        const record = parseStrict(TaskRecordSchema, {
          schemaVersion: 1,
          id,
          origin: 'builtin',
          sourceBuiltinId: definition.id,
          profileKey,
          profileName,
          state: 'dormant',
          definitionVersion: definition.version,
          scheduleAnchorAt: at,
          createdAt: at,
          updatedAt: at,
        }, 'builtin task')
        await tables.tasks.put(id, record)
        continue
      }
      if (existing.definitionVersion !== definition.version || existing.profileName !== profileName) {
        const next = parseStrict(TaskRecordSchema, {
          ...existing,
          profileName,
          definitionVersion: definition.version,
          updatedAt: at,
        }, 'builtin task')
        await tables.tasks.put(id, next)
      }
    }
  }

  async function ensure() {
    const tables = await open()
    if (!tables.seeded) {
      await seedBuiltins(tables)
      tables.seeded = true
    }
    return tables
  }

  async function listTaskRecords() {
    const tables = await ensure()
    const records = []
    for (const [, record] of tables.tasks.entries()) {
      if (ownTask(record)) records.push(record)
    }
    records.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    return records
  }

  async function taskRecordById(id) {
    const tables = await ensure()
    const record = tables.tasks.get(id)
    return ownTask(record) ? record : undefined
  }

  function definitionOf(record) {
    return record.origin === 'builtin' ? profileById.get(record.sourceBuiltinId) : undefined
  }

  function resolve(record) {
    if (record.origin === 'builtin' && definitionOf(record) === undefined) return undefined
    return resolveTaskRecord(record, definitionOf(record))
  }

  async function listTasks() {
    const records = await listTaskRecords()
    return records.map(resolve).filter((task) => task !== undefined)
  }

  async function getTask(id) {
    const record = await taskRecordById(id)
    if (record === undefined) return undefined
    return resolve(record)
  }

  async function putTaskRecord(record) {
    const tables = await ensure()
    const clean = parseStrict(TaskRecordSchema, record, 'task record')
    await tables.tasks.put(clean.id, clean)
    return clean
  }

  function defaultCustomConfig() {
    return {
      category: 'research',
      title: '新建任务',
      description: '',
      instruction: '按任务说明完成一次研究并给出可核查的结论。',
      trigger: {
        kind: 'schedule',
        cadence: 'daily',
        time: '09:00',
        timezone: 'Asia/Shanghai',
        tradingDaysOnly: true,
      },
      mode: 'research',
      cwdKind: 'profile',
      limits: {
        runTimeoutMinutes: DEFAULT_RUN_TIMEOUT_MINUTES,
        idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
        maxSteps: DEFAULT_MAX_STEPS,
        maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
      },
      notifications: { inApp: true, onFailure: true, onSuccess: false },
    }
  }

  async function createTask(input) {
    const at = iso(now())
    const config = TaskConfigSchema.parse({
      ...defaultCustomConfig(),
      ...input,
      cwdKind: 'profile',
    })
    const record = parseStrict(TaskRecordSchema, {
      schemaVersion: 1,
      id: `task_${random().replace(/-/g, '')}`,
      origin: 'custom',
      profileKey,
      profileName,
      state: 'active',
      definitionVersion: 1,
      custom: config,
      scheduleAnchorAt: at,
      createdAt: at,
      updatedAt: at,
    }, 'custom task')
    return putTaskRecord(record)
  }

  async function patchTask(id, patch) {
    const record = await taskRecordById(id)
    if (record === undefined) return undefined
    const at = iso(now())
    const triggerChanged = patch.trigger !== undefined && canonicalTrigger(patch.trigger) !== canonicalTrigger(resolve(record).trigger)
    const next = { ...record, updatedAt: at }
    if (record.origin === 'builtin') {
      const merged = TaskOverridesSchema.parse({ ...(record.overrides ?? {}), ...patch })
      next.overrides = merged
    } else {
      const merged = TaskConfigSchema.parse({ ...record.custom, ...patch, cwdKind: 'profile' })
      next.custom = merged
    }
    if (triggerChanged) {
      next.scheduleAnchorAt = at
      delete next.lastHandledOccurrenceKey
      delete next.lastScheduledFor
    }
    return putTaskRecord(next)
  }

  async function setTaskState(id, state) {
    const record = await taskRecordById(id)
    if (record === undefined) return undefined
    const at = iso(now())
    const next = { ...record, state, scheduleAnchorAt: at, updatedAt: at }
    delete next.lastHandledOccurrenceKey
    delete next.lastScheduledFor
    if (state === 'dormant' && record.origin === 'builtin') {
      delete next.overrides
      const definition = definitionOf(record)
      next.definitionVersion = definition?.version ?? record.definitionVersion
    }
    return putTaskRecord(next)
  }

  async function deleteTask(id) {
    const record = await taskRecordById(id)
    if (record === undefined) return false
    if (record.origin !== 'custom') return false
    const tables = await ensure()
    const runIds = new Set()
    for (const [runId, run] of [...tables.runs.entries()]) {
      if (ownRun(run) && run.taskId === id) {
        runIds.add(runId)
        await tables.runs.delete(runId)
      }
    }
    for (const [attemptId, attempt] of [...tables.attempts.entries()]) {
      if (attempt.profileKey === profileKey && (attempt.taskId === id || runIds.has(attempt.runId))) {
        await tables.attempts.delete(attemptId)
      }
    }
    for (const [notificationId, notification] of [...tables.notifications.entries()]) {
      if (notification.profileKey === profileKey && notification.taskId === id) {
        await tables.notifications.delete(notificationId)
      }
    }
    return tables.tasks.delete(id)
  }

  async function copyBuiltin(id) {
    const record = await taskRecordById(id)
    if (record === undefined || record.origin !== 'builtin') return undefined
    const task = resolve(record)
    if (task === undefined) return undefined
    const at = iso(now())
    const config = TaskConfigSchema.parse({
      category: task.category,
      title: `${task.title}（副本）`.slice(0, 120),
      description: task.description,
      trigger: task.trigger,
      instruction: task.instruction,
      mode: task.mode,
      cwdKind: 'profile',
      ...(task.workspaceId === undefined ? {} : { workspaceId: task.workspaceId }),
      limits: task.limits,
      notifications: task.notifications,
    })
    const custom = parseStrict(TaskRecordSchema, {
      schemaVersion: 1,
      id: `task_${random().replace(/-/g, '')}`,
      origin: 'custom',
      profileKey,
      profileName,
      state: 'paused',
      definitionVersion: 1,
      custom: config,
      scheduleAnchorAt: at,
      createdAt: at,
      updatedAt: at,
    }, 'copied task')
    return putTaskRecord(custom)
  }

  async function setLastHandled(id, occurrenceKey, scheduledFor) {
    const record = await taskRecordById(id)
    if (record === undefined) return
    const next = {
      ...record,
      lastHandledOccurrenceKey: occurrenceKey,
      updatedAt: iso(now()),
    }
    if (scheduledFor === undefined) delete next.lastScheduledFor
    else next.lastScheduledFor = scheduledFor
    await putTaskRecord(next)
  }

  async function createRun(input) {
    const tables = await ensure()
    const at = iso(now())
    const run = parseStrict(RunRecordSchema, {
      schemaVersion: 1,
      id: input.id ?? `run_${random().replace(/-/g, '')}`,
      profileKey,
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      trigger: input.trigger,
      occurrenceKey: input.occurrenceKey,
      ...(input.scheduleVersion === undefined ? {} : { scheduleVersion: input.scheduleVersion }),
      ...(input.scheduledFor === undefined ? {} : { scheduledFor: input.scheduledFor }),
      status: input.status ?? 'queued',
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.sessionTitle === undefined ? {} : { sessionTitle: input.sessionTitle }),
      queuedAt: at,
      steps: 0,
      toolCalls: 0,
      blockedRequiresUser: false,
      errors: [],
    }, 'run')
    await tables.runs.put(run.id, run)
    await retainRuns(tables)
    return run
  }

  async function updateRun(id, patch) {
    const tables = await ensure()
    const current = tables.runs.get(id)
    if (!ownRun(current)) return undefined
    if (current === undefined) return undefined
    const terminal = !isActiveRun(current.status)
    const nextStatus = patch.status ?? current.status
    const safe = terminal && nextStatus !== current.status ? { ...patch, status: current.status } : patch
    const next = parseStrict(RunRecordSchema, { ...current, ...safe }, 'run')
    await tables.runs.put(id, next)
    await retainRuns(tables)
    return next
  }

  async function getRun(id) {
    const tables = await ensure()
    const run = tables.runs.get(id)
    return ownRun(run) ? run : undefined
  }

  async function listRunsPage({ limit = 50, before, taskId } = {}) {
    const tables = await ensure()
    const runs = []
    for (const [, run] of tables.runs.entries()) {
      if (!ownRun(run)) continue
      if (taskId !== undefined && run.taskId !== taskId) continue
      runs.push(run)
    }
    runs.sort((left, right) => right.queuedAt.localeCompare(left.queuedAt) || right.id.localeCompare(left.id))
    let start = 0
    if (before !== undefined) {
      const index = runs.findIndex((run) => run.id === before)
      if (index === -1) return { runs: [], nextBefore: undefined, invalidCursor: true }
      start = index + 1
    }
    const page = runs.slice(start, start + Math.max(1, Math.min(2_000, limit)))
    const last = page.at(-1)
    return {
      runs: page,
      nextBefore: start + page.length < runs.length ? last?.id : undefined,
      invalidCursor: false,
    }
  }

  async function activeRunForTask(taskId) {
    const tables = await ensure()
    for (const [, run] of tables.runs.entries()) {
      if (ownRun(run) && run.taskId === taskId && isActiveRun(run.status)) return run
    }
    return undefined
  }

  async function runCountForTask(taskId) {
    const tables = await ensure()
    let count = 0
    for (const [, run] of tables.runs.entries()) if (ownRun(run) && run.taskId === taskId) count += 1
    return count
  }

  async function retainRuns(tables) {
    const byProfile = []
    for (const [, run] of tables.runs.entries()) if (ownRun(run)) byProfile.push(run)
    byProfile.sort((left, right) => right.queuedAt.localeCompare(left.queuedAt) || right.id.localeCompare(left.id))
    const perTask = new Map()
    const doomed = new Set()
    byProfile.forEach((run, index) => {
      const count = (perTask.get(run.taskId) ?? 0) + 1
      perTask.set(run.taskId, count)
      if (index >= MAX_RUNS_PER_PROFILE || count > MAX_RUNS_PER_TASK) doomed.add(run.id)
    })
    for (const id of doomed) await tables.runs.delete(id)
  }

  async function claimOccurrence(input) {
    return serializeClaim(async () => {
      const tables = await ensure()
      const id = input.occurrenceKey
      const existing = tables.attempts.get(id)
      if (existing !== undefined) return false
      const at = iso(now())
      const record = parseStrict(AttemptRecordSchema, {
        schemaVersion: 1,
        id,
        profileKey,
        taskId: input.taskId,
        runId: input.runId,
        occurrenceKey: input.occurrenceKey,
        state: 'claimed',
        createdAt: at,
        updatedAt: at,
      }, 'attempt')
      await tables.attempts.put(id, record)
      return true
    })
  }

  async function hasAttempt(occurrenceKey) {
    const tables = await ensure()
    const record = tables.attempts.get(occurrenceKey)
    return record?.profileKey === profileKey
  }

  async function setAttemptState(occurrenceKey, state) {
    const tables = await ensure()
    const current = tables.attempts.get(occurrenceKey)
    if (current === undefined || current.profileKey !== profileKey) return undefined
    const next = parseStrict(AttemptRecordSchema, {
      ...current,
      state,
      updatedAt: iso(now()),
    }, 'attempt')
    await tables.attempts.put(occurrenceKey, next)
    return next
  }

  async function listAttemptsForRun(runId) {
    const tables = await ensure()
    const records = []
    for (const [, record] of tables.attempts.entries()) {
      if (record.profileKey === profileKey && record.runId === runId) records.push(record)
    }
    return records
  }

  async function addNotification(input) {
    const tables = await ensure()
    const record = parseStrict(NotificationSchema, {
      schemaVersion: 1,
      id: `ntf_${random().replace(/-/g, '')}`,
      profileKey,
      kind: input.kind,
      title: input.title,
      message: input.message,
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      createdAt: iso(now()),
    }, 'notification')
    await tables.notifications.put(record.id, record)
    await retainNotifications(tables)
    return record
  }

  async function retainNotifications(tables) {
    const records = []
    for (const [, record] of tables.notifications.entries()) if (record.profileKey === profileKey) records.push(record)
    records.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    for (const record of records.slice(MAX_NOTIFICATIONS_PER_PROFILE)) await tables.notifications.delete(record.id)
  }

  async function listNotifications({ unreadOnly = false, limit = 50, taskId } = {}) {
    const tables = await ensure()
    const records = []
    for (const [, record] of tables.notifications.entries()) {
      if (record.profileKey !== profileKey) continue
      if (taskId !== undefined && record.taskId !== taskId) continue
      if (unreadOnly && record.readAt !== undefined) continue
      records.push(record)
    }
    records.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    return records.slice(0, Math.max(1, Math.min(200, limit)))
  }

  async function unreadNotificationCount() {
    const tables = await ensure()
    let count = 0
    for (const [, record] of tables.notifications.entries()) {
      if (record.profileKey === profileKey && record.readAt === undefined) count += 1
    }
    return count
  }

  async function markNotificationsRead({ ids, all = false }) {
    const tables = await ensure()
    const wanted = new Set(ids ?? [])
    let changed = 0
    const at = iso(now())
    for (const [id, record] of [...tables.notifications.entries()]) {
      if (record.profileKey !== profileKey || record.readAt !== undefined) continue
      if (!all && !wanted.has(id)) continue
      const next = parseStrict(NotificationSchema, { ...record, readAt: at }, 'notification')
      await tables.notifications.put(id, next)
      changed += 1
    }
    return changed
  }

  async function setOwnerMeta(record) {
    const tables = await ensure()
    const clean = parseStrict(OwnerRecordSchema, record, 'owner meta')
    const existing = tables.meta.get(profileKey)
    if (existing !== undefined
      && existing.fencingToken !== clean.fencingToken
      && Date.parse(existing.leaseExpiresAt) > now()) return false
    await tables.meta.put(profileKey, clean)
    return true
  }

  async function getOwnerMeta() {
    const tables = await ensure()
    const record = tables.meta.get(profileKey)
    return record?.profileKey === profileKey ? record : undefined
  }

  /**
   * Startup recovery: a durable turn boundary proves how the run ended. Only runs with no
   * finished turn are left unknown (and never retried silently).
   */
  async function recoverNonTerminalRuns() {
    const tables = await ensure()
    const at = iso(now())
    const outcomes = new Map()
    let recovered = 0
    for (const [id, run] of [...tables.runs.entries()]) {
      if (!ownRun(run) || !isActiveRun(run.status)) continue
      const turn = run.turnState
      const settled = turn?.phase === 'ended' && SETTLED_RUN_STATUSES.includes(turn.status) ? turn.status : undefined
      const status = settled ?? 'unknown_after_restart'
      const finishedAt = settled === undefined ? at : turn.at
      const errors = settled === undefined
        ? [...run.errors, {
            at: finishedAt,
            phase: 'session',
            severity: 'warning',
            code: 'unknown_after_restart',
            message: '进程重启时无法证明本轮运行已经结束，结果未知；为避免重复执行，未自动重试。',
          }].slice(-MAX_ERRORS_PER_RUN)
        : status === 'succeeded'
          ? run.errors
          : [...run.errors, {
              at: finishedAt,
              phase: 'session',
              severity: 'warning',
              code: 'recovered_after_restart',
              message: `进程重启前回合已结束（${status}）；按该终态收口。`,
            }].slice(-MAX_ERRORS_PER_RUN)
      const next = parseStrict(RunRecordSchema, {
        ...run,
        status,
        finishedAt,
        durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(run.startedAt ?? run.queuedAt)),
        ...(status === 'blocked_requires_user' ? { blockedRequiresUser: true } : {}),
        errors,
      }, 'run')
      await tables.runs.put(id, next)
      if (settled !== undefined) outcomes.set(id, status)
      recovered += 1
    }
    for (const [id, attempt] of [...tables.attempts.entries()]) {
      if (attempt.profileKey !== profileKey) continue
      if (!['claimed', 'session_created', 'prompt_submitted'].includes(attempt.state)) continue
      const status = outcomes.get(attempt.runId)
      const state = status === undefined ? 'unknown' : status === 'failed' ? 'failed' : 'accepted'
      const next = parseStrict(AttemptRecordSchema, { ...attempt, state, updatedAt: at }, 'attempt')
      await tables.attempts.put(id, next)
    }
    return recovered
  }

  async function close() {
    if (opening === undefined) return
    const tables = await opening.catch(() => undefined)
    opening = undefined
    await tables?.domain?.close?.().catch(() => {})
  }

  function decorateTask(task, runs) {
    const latest = runs.find((run) => run.taskId === task.id)
    const next = nextOccurrence(task.trigger, now(), { calendar: options.calendar })
    return {
      ...task,
      nextRunAt: next.kind === 'occurrence' ? next.scheduledFor : null,
      nextRunLocal: next.kind === 'occurrence' ? formatInZone(next.scheduledFor, task.trigger.timezone) : null,
      nextRunUnavailable: next.kind === 'calendar_unavailable',
      lastRun: latest === undefined ? null : publicRun(latest),
    }
  }

  function publicRun(run) {
    return {
      id: run.id,
      taskId: run.taskId,
      taskTitle: run.taskTitle,
      trigger: run.trigger,
      status: run.status,
      occurrenceKey: run.occurrenceKey,
      scheduledFor: run.scheduledFor ?? null,
      sessionId: run.sessionId ?? null,
      sessionTitle: run.sessionTitle ?? null,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
      durationMs: run.durationMs ?? null,
      steps: run.steps,
      toolCalls: run.toolCalls,
      blockedRequiresUser: run.blockedRequiresUser,
      errors: run.errors,
      summary: run.summary ?? null,
    }
  }

  return {
    profileKey,
    profileName,
    domainSpec,
    open: ensure,
    close,
    listTaskRecords,
    listTasks,
    getTask,
    taskRecordById,
    createTask,
    patchTask,
    setTaskState,
    deleteTask,
    copyBuiltin,
    setLastHandled,
    createRun,
    updateRun,
    getRun,
    listRunsPage,
    activeRunForTask,
    runCountForTask,
    claimOccurrence,
    hasAttempt,
    setAttemptState,
    listAttemptsForRun,
    addNotification,
    listNotifications,
    unreadNotificationCount,
    markNotificationsRead,
    setOwnerMeta,
    getOwnerMeta,
    recoverNonTerminalRuns,
    decorateTask,
    publicRun,
    definitions: profileById,
    AutomationTaskSchema,
    isActiveRun,
  }
}
