/**
 * Fixed `capital_automation` storage domain. Every record carries the server-derived
 * `profileKey`; list/read/write/cancel/notification paths filter on it before doing anything
 * else. The client never supplies a profile, owner, session, preset or cwd.
 */
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  AskRecordSchema,
  AttemptRecordSchema,
  AutomationTaskSchema,
  NotificationSchema,
  OwnerRecordSchema,
  RunRecordSchema,
  TaskConfigSchema,
  TaskBriefSchema,
  TaskOverridesSchema,
  TaskRecordSchema,
  TodoAckSchema,
  TodoWatchSchema,
  isActiveRun,
  parseStrict,
  resolveTaskRecord,
} from './schema.js'
import { BUILTIN_BY_ID, BUILTIN_DEFINITIONS } from './builtins.js'
import { DEFAULT_CUSTOM_ICON, builtinTaskIcon } from './task-icons.js'
import {
  DEFAULT_AUTOMATION_SETTINGS,
  MAX_ASKS_PER_PROFILE,
  MAX_ERRORS_PER_RUN,
  MAX_NOTIFICATIONS_PER_PROFILE,
  MAX_RUNS_PER_PROFILE,
  MAX_RUNS_PER_TASK,
  MAX_TODO_ACKS_PER_PROFILE,
  MAX_TODO_WATCHES_PER_PROFILE,
  SETTLED_RUN_STATUSES,
} from './defaults.js'
import { canonicalTrigger, formatInZone, nextOccurrence } from './time.js'

export const DOMAIN_NAME = 'capital_automation'
export const ROUTE_PATH = '/capital-automation'

const SYSTEM_NOTIFICATION_KINDS = new Set(['scheduler_standby'])

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
    briefs: { valueSchema: TaskBriefSchema },
    todo_acks: { valueSchema: TodoAckSchema },
    todo_watches: { valueSchema: TodoWatchSchema },
    asks: { valueSchema: AskRecordSchema },
  },
}

export function profileKeyOf(profileName) {
  const digest = createHash('sha256').update(String(profileName)).digest('hex').slice(0, 24)
  return `p_${digest}`
}

function builtinRecordId(profileKey, builtinId) {
  return `bt_${createHash('sha256').update(`${profileKey}:${builtinId}`).digest('hex').slice(0, 24)}`
}

/** Hash the long, user-visible TODO id so the storage key stays bounded and plain. */
function todoAckRecordId(profileKey, todoId) {
  return `ta_${createHash('sha256').update(`${profileKey}\u0000${todoId}`).digest('hex').slice(0, 32)}`
}

function iso(now) {
  return new Date(now).toISOString()
}

function stripLegacyMode(value) {
  if (value === undefined || value.mode === undefined) return value
  const { mode: _legacyMode, ...rest } = value
  return rest
}

function stripRecordLegacyMode(record) {
  if (record.origin === 'custom') {
    const custom = stripLegacyMode(record.custom)
    return custom === record.custom ? record : { ...record, custom }
  }
  const overrides = stripLegacyMode(record.overrides)
  if (overrides === record.overrides) return record
  const next = { ...record }
  if (overrides === undefined || Object.keys(overrides).length === 0) delete next.overrides
  else next.overrides = overrides
  return next
}

const LEGACY_MORNING_DESCRIPTION = '交易日开盘前汇总隔夜外盘、重要公告与政策信息，给出当日需要盯住的线索。'

/** Pre-v3 builtins embedded both blocks; only those old template snapshots are refreshed. */
function isLegacyBuiltinInstruction(value) {
  return typeof value === 'string'
    && value.includes('数据与来源纪律：')
    && value.includes('无人值守执行策略（automation-v1）：')
}

function migrateBuiltinRecord(record, definition) {
  let next = stripRecordLegacyMode(record)
  if (next.definitionVersion >= definition.version) return next
  const overrides = { ...(next.overrides ?? {}) }
  if (isLegacyBuiltinInstruction(overrides.instruction)) delete overrides.instruction
  if (definition.id === 'morning-brief' && overrides.description === LEGACY_MORNING_DESCRIPTION) delete overrides.description
  for (const key of Object.keys(overrides)) {
    // A workspace choice is real even when it equals the default; everything else can fall back.
    if (key === 'workspaceId') continue
    if (isDeepStrictEqual(overrides[key], definition.defaults[key])) delete overrides[key]
  }
  next = { ...next }
  if (Object.keys(overrides).length === 0) delete next.overrides
  else next.overrides = overrides
  return next
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
    settings,
  } = options
  const rawProfileName = String(profile?.name ?? '')
  const profileName = rawProfileName.slice(0, 200)
  const profileKey = profileKeyOf(rawProfileName)
  const profileById = new Map(builtins.map((definition) => [definition.id, definition]))
  let opening
  let claimChain = Promise.resolve()
  let askChain = Promise.resolve()

  /** Profile-level defaults; a task without its own limits inherits these. */
  function defaultLimits() {
    let current
    try {
      current = typeof settings === 'function' ? settings() : undefined
    } catch {
      current = undefined
    }
    const source = current ?? DEFAULT_AUTOMATION_SETTINGS
    return {
      runTimeoutMinutes: source.runTimeoutMinutes,
      idleTimeoutMinutes: source.idleTimeoutMinutes,
      maxSteps: source.maxSteps,
      maxToolCalls: source.maxToolCalls,
    }
  }

  function isDefaultLimits(limits) {
    if (limits === undefined) return false
    const defaults = defaultLimits()
    return Object.keys(defaults).every((key) => limits[key] === defaults[key])
  }

  /**
   * Storing the current defaults would pin the task to them. Drop the block instead so the
   * resolved task keeps following the settings card.
   */
  function withoutInheritedLimits(config) {
    if (config?.limits === undefined || !isDefaultLimits(config.limits)) return config
    const { limits: _inherited, ...rest } = config
    return rest
  }

  function serializeClaim(operation) {
    const next = claimChain.then(operation, operation)
    claimChain = next.then(() => {}, () => {})
    return next
  }

  function serializeAsk(operation) {
    const next = askChain.then(operation, operation)
    askChain = next.then(() => {}, () => {})
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
          briefs: domain.table('briefs'),
          todoAcks: domain.table('todo_acks'),
          todoWatches: domain.table('todo_watches'),
          asks: domain.table('asks'),
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

  function ownBrief(record) {
    return record !== undefined && record.profileKey === profileKey
  }

  function ownAsk(record) {
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
          state: definition.defaults.state,
          definitionVersion: definition.version,
          scheduleAnchorAt: at,
          createdAt: at,
          updatedAt: at,
        }, 'builtin task')
        await tables.tasks.put(id, record)
        continue
      }
      const migrated = migrateBuiltinRecord(existing, definition)
      if (!isDeepStrictEqual(migrated, existing) || migrated.definitionVersion !== definition.version || migrated.profileName !== profileName) {
        const next = parseStrict(TaskRecordSchema, {
          ...migrated,
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
    return resolveTaskRecord(record, definitionOf(record), defaultLimits())
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
    const clean = parseStrict(TaskRecordSchema, stripRecordLegacyMode(record), 'task record')
    await tables.tasks.put(clean.id, clean)
    return clean
  }

  function defaultCustomConfig() {
    return {
      category: 'research',
      icon: DEFAULT_CUSTOM_ICON,
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
      cwdKind: 'profile',
      notifications: { inApp: true, onFailure: true, onSuccess: false },
    }
  }

  async function createTask(input) {
    const at = iso(now())
    const config = TaskConfigSchema.parse(withoutInheritedLimits({
      ...defaultCustomConfig(),
      ...input,
      cwdKind: 'profile',
    }))
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
      // Persist only fields the user actually changed; a full snapshot would pin every future
      // builtin default and make a shipped template fix unreachable.
      const current = resolve(record)
      const changed = {}
      for (const [key, value] of Object.entries(patch)) {
        if (!isDeepStrictEqual(value, current[key])) changed[key] = value
      }
      const merged = TaskOverridesSchema.parse({ ...(record.overrides ?? {}), ...changed })
      if (isDefaultLimits(merged.limits)) delete merged.limits
      if (Object.keys(merged).length === 0) delete next.overrides
      else next.overrides = merged
    } else {
      const merged = TaskConfigSchema.parse({ ...record.custom, ...patch, cwdKind: 'profile' })
      next.custom = withoutInheritedLimits(merged)
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
    for (const [briefId, brief] of [...tables.briefs.entries()]) {
      if (ownBrief(brief) && (brief.taskId === id || runIds.has(brief.runId))) {
        await tables.briefs.delete(briefId)
      }
    }
    for (const [askId, ask] of [...tables.asks.entries()]) {
      if (ownAsk(ask) && runIds.has(ask.runId)) await tables.asks.delete(askId)
    }
    return tables.tasks.delete(id)
  }

  async function copyBuiltin(id) {
    const record = await taskRecordById(id)
    if (record === undefined || record.origin !== 'builtin') return undefined
    const task = resolve(record)
    if (task === undefined) return undefined
    const at = iso(now())
    const config = TaskConfigSchema.parse(withoutInheritedLimits({
      category: task.category,
      icon: builtinTaskIcon(record.sourceBuiltinId),
      title: `${task.title}（副本）`.slice(0, 120),
      description: task.description,
      trigger: task.trigger,
      instruction: task.instruction,
      cwdKind: 'profile',
      ...(task.workspaceId === undefined ? {} : { workspaceId: task.workspaceId }),
      limits: task.limits,
      notifications: task.notifications,
    }))
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
    for (const id of doomed) {
      await tables.runs.delete(id)
      const brief = tables.briefs.get(id)
      if (ownBrief(brief)) await tables.briefs.delete(id)
      for (const [askId, ask] of [...tables.asks.entries()]) {
        if (ownAsk(ask) && ask.runId === id) await tables.asks.delete(askId)
      }
    }
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
      ...(input.todoId === undefined ? {} : { todoId: input.todoId }),
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

  // Scheduler standby is a system state, not a task outcome: keep it out of the task inbox and
  // its unread badge. One predicate for list/count/read so the three cannot drift apart.
  function notificationInScope(record, scope) {
    const system = SYSTEM_NOTIFICATION_KINDS.has(record.kind)
    if (scope === 'system') return system
    if (scope === 'all') return true
    return !system
  }

  async function listNotifications({ unreadOnly = false, limit = 50, taskId, scope = 'task' } = {}) {
    const tables = await ensure()
    const records = []
    for (const [, record] of tables.notifications.entries()) {
      if (record.profileKey !== profileKey) continue
      if (!notificationInScope(record, scope)) continue
      if (taskId !== undefined && record.taskId !== taskId) continue
      if (unreadOnly && record.readAt !== undefined) continue
      records.push(record)
    }
    records.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    return records.slice(0, Math.max(1, Math.min(200, limit)))
  }

  async function unreadNotificationCount(scope = 'task') {
    const tables = await ensure()
    let count = 0
    for (const [, record] of tables.notifications.entries()) {
      if (record.profileKey === profileKey && notificationInScope(record, scope) && record.readAt === undefined) count += 1
    }
    return count
  }

  async function markNotificationsRead({ ids, all = false, scope = 'task' }) {
    const tables = await ensure()
    const wanted = new Set(ids ?? [])
    let changed = 0
    const at = iso(now())
    for (const [id, record] of [...tables.notifications.entries()]) {
      if (record.profileKey !== profileKey || record.readAt !== undefined) continue
      if (!notificationInScope(record, scope)) continue
      if (!all && !wanted.has(id)) continue
      const next = parseStrict(NotificationSchema, { ...record, readAt: at }, 'notification')
      await tables.notifications.put(id, next)
      changed += 1
    }
    return changed
  }

  async function createBrief(input) {
    const tables = await ensure()
    const existing = tables.briefs.get(input.runId)
    if (existing !== undefined) return ownBrief(existing) ? existing : undefined
    const at = iso(now())
    const record = parseStrict(TaskBriefSchema, {
      schemaVersion: 1,
      profileKey,
      runId: input.runId,
      taskId: input.taskId,
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      status: 'pending',
      items: [],
      stocks: [],
      gaps: [],
      promptVersion: input.promptVersion ?? 1,
      attempts: 0,
      updatedAt: at,
    }, 'brief')
    await tables.briefs.put(record.runId, record)
    return record
  }

  async function putBrief(record) {
    const tables = await ensure()
    const clean = parseStrict(TaskBriefSchema, { ...record, profileKey }, 'brief')
    await tables.briefs.put(clean.runId, clean)
    return clean
  }

  async function getBrief(runId) {
    const tables = await ensure()
    const record = tables.briefs.get(runId)
    return ownBrief(record) ? record : undefined
  }

  async function listBriefsForRuns(runIds) {
    const tables = await ensure()
    const result = new Map()
    for (const runId of runIds) {
      const record = tables.briefs.get(runId)
      if (ownBrief(record)) result.set(runId, record)
    }
    return result
  }

  async function listBriefsForProfile() {
    const tables = await ensure()
    const records = []
    for (const [, record] of tables.briefs.entries()) if (ownBrief(record)) records.push(record)
    records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.runId.localeCompare(right.runId))
    return records
  }

  async function countBriefs() {
    const tables = await ensure()
    let count = 0
    for (const [, record] of tables.briefs.entries()) if (ownBrief(record)) count += 1
    return count
  }

  async function retainAsks(tables) {
    const records = []
    for (const [, record] of tables.asks.entries()) if (ownAsk(record)) records.push(record)
    if (records.length <= MAX_ASKS_PER_PROFILE) return
    records.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    for (const record of records.slice(MAX_ASKS_PER_PROFILE)) {
      // A running ask is still the user's only handle on that turn; drop it only after it settles.
      if (record.status !== 'running') await tables.asks.delete(record.id)
    }
  }

  async function pendingAskForRunIn(tables, runId) {
    let found
    for (const [, record] of tables.asks.entries()) {
      if (!ownAsk(record) || record.runId !== runId || record.status !== 'running') continue
      if (found === undefined || record.createdAt > found.createdAt) found = record
    }
    return found
  }

  async function createAsk(input) {
    return serializeAsk(async () => {
      const tables = await ensure()
      const pending = await pendingAskForRunIn(tables, input.runId)
      if (pending !== undefined) {
        const error = new Error('上一条追问还在回答，等它结束再问。')
        error.code = 'ask_pending'
        error.askId = pending.id
        throw error
      }
      const at = iso(now())
      const record = parseStrict(AskRecordSchema, {
        schemaVersion: 1,
        id: `ask_${random().replace(/-/g, '')}`,
        profileKey,
        runId: input.runId,
        sessionId: input.sessionId,
        question: input.question,
        baselineSeq: Number.isSafeInteger(input.baselineSeq) ? input.baselineSeq : -1,
        status: 'running',
        createdAt: at,
        updatedAt: at,
      }, 'ask')
      await tables.asks.put(record.id, record)
      await retainAsks(tables)
      return record
    })
  }

  async function getAsk(id) {
    const tables = await ensure()
    const record = tables.asks.get(id)
    return ownAsk(record) ? record : undefined
  }

  async function pendingAskForRun(runId) {
    const tables = await ensure()
    return pendingAskForRunIn(tables, runId)
  }

  async function latestAsksForRuns(runIds) {
    const tables = await ensure()
    const wanted = new Set(runIds)
    const result = new Map()
    for (const [, record] of tables.asks.entries()) {
      if (!ownAsk(record) || !wanted.has(record.runId)) continue
      const current = result.get(record.runId)
      if (current === undefined || record.createdAt > current.createdAt) result.set(record.runId, record)
    }
    return result
  }

  async function listAsksForRun(runId) {
    const tables = await ensure()
    const records = []
    for (const [, record] of tables.asks.entries()) {
      if (ownAsk(record) && record.runId === runId) records.push(record)
    }
    records.sort((left, right) =>
      String(left.createdAt).localeCompare(String(right.createdAt))
      || String(left.id).localeCompare(String(right.id)))
    return records
  }

  async function updateAsk(id, patch) {
    const tables = await ensure()
    const current = tables.asks.get(id)
    if (!ownAsk(current)) return undefined
    const next = parseStrict(AskRecordSchema, {
      ...current,
      ...patch,
      updatedAt: iso(now()),
    }, 'ask')
    await tables.asks.put(id, next)
    return next
  }

  async function deleteAsk(id) {
    const tables = await ensure()
    const current = tables.asks.get(id)
    if (!ownAsk(current)) return false
    return tables.asks.delete(id)
  }

  async function listTodoAcks() {
    const tables = await ensure()
    const records = []
    for (const [, record] of tables.todoAcks.entries()) {
      if (record.profileKey === profileKey) records.push(record)
    }
    return records
  }

  async function retainTodoAcks(tables) {
    const records = []
    for (const [key, record] of tables.todoAcks.entries()) {
      if (record.profileKey === profileKey) records.push({ key, record })
    }
    if (records.length <= MAX_TODO_ACKS_PER_PROFILE) return
    records.sort((left, right) =>
      right.record.confirmedAt.localeCompare(left.record.confirmedAt)
      || right.key.localeCompare(left.key))
    for (const entry of records.slice(MAX_TODO_ACKS_PER_PROFILE)) await tables.todoAcks.delete(entry.key)
  }

  async function decideTodo(todoId, decision = 'confirmed') {
    const tables = await ensure()
    const record = parseStrict(TodoAckSchema, {
      schemaVersion: 1,
      profileKey,
      todoId,
      confirmedAt: iso(now()),
      ...(decision === 'confirmed' ? {} : { decision }),
    }, 'todo decision')
    await tables.todoAcks.put(todoAckRecordId(profileKey, todoId), record)
    await retainTodoAcks(tables)
    return record
  }

  async function confirmTodo(todoId) {
    return decideTodo(todoId, 'confirmed')
  }

  /** Changing a confirmed/deferred item back to automatic verification drops the old decision. */
  async function clearTodoDecision(todoId) {
    const tables = await ensure()
    return tables.todoAcks.delete(todoAckRecordId(profileKey, todoId))
  }

  async function listTodoWatches() {
    const tables = await ensure()
    const records = []
    for (const [, record] of tables.todoWatches.entries()) {
      if (record.profileKey === profileKey) records.push(record)
    }
    return records
  }

  async function putTodoWatch(record) {
    const tables = await ensure()
    const next = parseStrict(TodoWatchSchema, { ...record, profileKey }, 'todo watch')
    await tables.todoWatches.put(next.id, next)
    await retainTodoWatches(tables)
    return next
  }

  async function retainTodoWatches(tables) {
    const records = []
    for (const [key, record] of tables.todoWatches.entries()) {
      if (record.profileKey === profileKey) records.push({ key, record })
    }
    if (records.length <= MAX_TODO_WATCHES_PER_PROFILE) return
    records.sort((left, right) =>
      right.record.updatedAt.localeCompare(left.record.updatedAt)
      || right.key.localeCompare(left.key))
    for (const entry of records.slice(MAX_TODO_WATCHES_PER_PROFILE)) await tables.todoWatches.delete(entry.key)
  }

  async function updateBrief(runId, patch) {
    const tables = await ensure()
    const current = tables.briefs.get(runId)
    if (!ownBrief(current)) return undefined
    const next = {
      ...current,
      ...patch,
      profileKey,
      updatedAt: iso(now()),
    }
    if (next.status === 'pending') {
      if (typeof current.error === 'string' && current.error.length > 0) {
        next.lastError = current.error
        next.lastErrorAt = iso(now())
      }
      delete next.headline
      delete next.plain
      delete next.error
      delete next.generatedAt
      next.items = []
      next.stocks = []
      next.gaps = []
    }
    const clean = parseStrict(TaskBriefSchema, next, 'brief')
    await tables.briefs.put(runId, clean)
    return clean
  }

  async function deleteBrief(runId) {
    const tables = await ensure()
    const current = tables.briefs.get(runId)
    if (!ownBrief(current)) return false
    return tables.briefs.delete(runId)
  }

  function publicBrief(brief) {
    return {
      runId: brief.runId,
      taskId: brief.taskId,
      sessionId: brief.sessionId ?? null,
      status: brief.status,
      headline: brief.headline ?? null,
      plain: brief.plain ?? null,
      coverage: brief.coverage ?? null,
      error: brief.error ?? null,
      attempts: brief.attempts,
      generatedAt: brief.generatedAt ?? null,
      counts: {
        items: brief.items.length,
        stocks: brief.stocks.length,
        gaps: brief.gaps.length,
      },
    }
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
    createBrief,
    putBrief,
    getBrief,
    listBriefsForRuns,
    listBriefsForProfile,
    countBriefs,
    createAsk,
    getAsk,
    pendingAskForRun,
    latestAsksForRuns,
    listAsksForRun,
    updateAsk,
    deleteAsk,
    listTodoAcks,
    confirmTodo,
    decideTodo,
    clearTodoDecision,
    listTodoWatches,
    putTodoWatch,
    updateBrief,
    deleteBrief,
    publicBrief,
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
