/**
 * API service. All mutations serialize on one promise chain so a manual run, a tick claim, and
 * a page cancel cannot interleave profile-visible state. Every lookup goes through the store's
 * profile filter; the wire body never selects a profile.
 */
import {
  ACTIVE_RUN_STATUSES,
  DEFAULT_AUTOMATION_SETTINGS,
  FAILURE_RUN_STATUSES,
  MAX_IDLE_TIMEOUT_MINUTES,
  MAX_MAX_STEPS,
  MAX_MAX_TOOL_CALLS,
  MAX_RUN_TIMEOUT_MINUTES,
  MIN_IDLE_TIMEOUT_MINUTES,
  MIN_MAX_STEPS,
  MIN_MAX_TOOL_CALLS,
  MIN_RUN_TIMEOUT_MINUTES,
} from './defaults.js'
import {
  AskCreateSchema,
  NotificationsReadSchema,
  TaskCategorySchema,
  TaskCreateSchema,
  TaskPatchSchema,
  TodoConfirmSchema,
  parseStrict,
} from './schema.js'
import { sanitizeMessage } from './redact.js'
import { addDays, localPartsAt } from './time.js'

const MAX_RUN_PAGE_LIMIT = 2_000
const RUN_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,120}$/
const HISTORY_DAYS = 371
const ACTIVE_STATUSES = new Set(ACTIVE_RUN_STATUSES)
const FAILURE_STATUSES = new Set(FAILURE_RUN_STATUSES)

function invalidQuery(message) {
  return new AutomationError('invalid_query', message, 400)
}

function historyDaysOf(value) {
  if (value === undefined) return HISTORY_DAYS
  if (typeof value !== 'string' && typeof value !== 'number') throw invalidQuery('运行历史 days 参数无效。')
  const text = String(value)
  if (!/^\d{1,3}$/.test(text)) throw invalidQuery(`运行历史 days 必须是 1–${HISTORY_DAYS} 的整数。`)
  const days = Number(text)
  if (!Number.isSafeInteger(days) || days < 1 || days > HISTORY_DAYS) {
    throw invalidQuery(`运行历史 days 必须是 1–${HISTORY_DAYS} 的整数。`)
  }
  return days
}

function historyTimeZoneOf(value) {
  if (value === undefined) {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    throw invalidQuery('运行历史 tz 参数无效。')
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
  } catch {
    throw invalidQuery('运行历史 tz 参数无效。')
  }
  return value
}

function notificationScopeOf(value) {
  if (value === undefined) return 'task'
  if (value === 'task' || value === 'system' || value === 'all') return value
  throw invalidQuery('通知 scope 参数无效。')
}

function runLimitOf(value) {
  if (value === undefined) return 50
  if (typeof value !== 'string' && typeof value !== 'number') throw invalidQuery('运行分页 limit 无效。')
  const text = String(value)
  if (!/^[1-9]\d{0,3}$/.test(text)) throw invalidQuery('运行分页 limit 必须是 1–2000 的整数。')
  const limit = Number(text)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RUN_PAGE_LIMIT) {
    throw invalidQuery('运行分页 limit 必须是 1–2000 的整数。')
  }
  return limit
}

function runCursorOf(value) {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !RUN_CURSOR_PATTERN.test(value)) {
    throw new AutomationError('invalid_cursor', '运行分页游标无效。', 400)
  }
  return value
}

export class AutomationError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message)
    this.name = 'AutomationError'
    this.code = code
    this.status = status
    this.extra = extra
  }
}

export function createAutomationService(options) {
  const { store, scheduler, runner, calendar, profile, workspaces, version, settings, briefs, asks, boardService, now = () => Date.now() } = options
  let chain = Promise.resolve()

  function serialize(operation) {
    const next = chain.then(operation, operation)
    chain = next.then(() => {}, () => {})
    return next
  }

  async function withTask(id) {
    const task = await store.getTask(id)
    if (task === undefined) throw new AutomationError('task_not_found', '任务不存在。', 404)
    return task
  }

  async function runningTask(task) {
    const active = await store.activeRunForTask(task.id)
    if (active !== undefined) {
      throw new AutomationError('run_in_progress', '任务仍在运行，请先取消或等待终态。', 409, { runId: active.id })
    }
  }

  async function assertWorkspace(workspaceId) {
    if (workspaceId === undefined || workspaceId === '') return
    if (workspaces === undefined) {
      throw new AutomationError('workspace_unavailable', '工作区服务暂时不可用，不能指定工作区。', 503)
    }
    try {
      await workspaces.validate(workspaceId)
    } catch (error) {
      if (error?.code === 'workspace_not_found') {
        throw new AutomationError('workspace_not_found', error.message, 400)
      }
      throw new AutomationError('workspace_unavailable', error?.message ?? '工作区服务暂时不可用。', 503)
    }
  }

  async function listTasks() {
    const tasks = await store.listTasks()
    const { runs } = await store.listRunsPage({ limit: 2_000 })
    const runsByTask = new Map()
    for (const run of runs) {
      const taskRuns = runsByTask.get(run.taskId)
      if (taskRuns === undefined) runsByTask.set(run.taskId, [run])
      else taskRuns.push(run)
    }
    const notifications = await store.listNotifications({ unreadOnly: true, limit: 200 })
    const unread = new Map()
    for (const item of notifications) {
      if (item.taskId === undefined) continue
      unread.set(item.taskId, (unread.get(item.taskId) ?? 0) + 1)
    }
    return tasks.map((task) => ({
      ...store.decorateTask(task, runsByTask.get(task.id) ?? []),
      unread: unread.get(task.id) ?? 0,
    }))
  }

  async function meta() {
    let storage = { state: 'ready', error: null }
    try {
      await store.open()
    } catch (error) {
      storage = { state: 'unavailable', error: sanitizeMessage(String(error)) }
    }
    let unread = 0
    if (storage.state === 'ready') {
      // The badge ships with the page shell so entry never has to list notifications.
      try {
        unread = await store.unreadNotificationCount('task')
      } catch {
        unread = 0
      }
    }
    let workspaceList = []
    let workspaceError
    try {
      workspaceList = await workspaces?.list?.() ?? []
    } catch (error) {
      workspaceError = sanitizeMessage(String(error?.message ?? error))
    }
    return {
      profile: { key: store.profileKey, name: profile.displayName, state: 'current' },
      version,
      storage,
      notifications: { unread },
      workspaces: workspaceList,
      defaultWorkspaceId: workspaceList.find((item) => item.default === true)?.id ?? null,
      ...(workspaceError === undefined ? {} : { workspaceError }),
      scheduler: scheduler === undefined ? { state: 'unavailable' } : scheduler.status(),
      calendar: calendar?.status?.(new Date(now())) ?? { available: false, source: 'none' },
      execution: {
        preset: 'capital-generation',
        cwdKind: 'profile',
        policy: 'automation-v1',
        categories: [...TaskCategorySchema.options],
        cadences: ['daily', 'weekly', 'monthly', 'once'],
        limits: {
          runTimeoutMinutes: [MIN_RUN_TIMEOUT_MINUTES, MAX_RUN_TIMEOUT_MINUTES],
          idleTimeoutMinutes: [MIN_IDLE_TIMEOUT_MINUTES, MAX_IDLE_TIMEOUT_MINUTES],
          maxSteps: [MIN_MAX_STEPS, MAX_MAX_STEPS],
          maxToolCalls: [MIN_MAX_TOOL_CALLS, MAX_MAX_TOOL_CALLS],
        },
        settings: settings(),
      },
    }
  }

  async function workspaceCatalog() {
    if (typeof workspaces?.details !== 'function') return { workspaces: [], defaultWorkspaceId: null }
    try {
      return await workspaces.details()
    } catch (error) {
      throw new AutomationError('workspace_unavailable', sanitizeMessage(String(error?.message ?? error)), 503)
    }
  }

  async function createTask(input) {
    const parsed = parseStrict(TaskCreateSchema, input, 'task')
    const defaults = { ...DEFAULT_AUTOMATION_SETTINGS, ...settings() }
    // No limits here: an omitted (or unchanged) block stays inherited from the settings card.
    const resolved = {
      ...parsed,
      notifications: parsed.notifications ?? {
        inApp: defaults.inAppNotifications !== false,
        onFailure: true,
        onSuccess: false,
      },
    }
    return serialize(async () => {
      await assertWorkspace(parsed.workspaceId)
      const record = await store.createTask(resolved)
      return store.getTask(record.id)
    })
  }

  async function patchTask(id, input) {
    const parsed = parseStrict(TaskPatchSchema, input, 'task')
    if (Object.keys(parsed).length === 0) throw new AutomationError('empty_patch', '没有需要修改的字段。', 400)
    return serialize(async () => {
      await withTask(id)
      await assertWorkspace(parsed.workspaceId)
      const record = await store.patchTask(id, parsed)
      if (record === undefined) throw new AutomationError('task_not_found', '任务不存在。', 404)
      return store.getTask(id)
    })
  }

  async function deleteTask(id) {
    return serialize(async () => {
      const task = await withTask(id)
      if (task.origin !== 'custom') throw new AutomationError('builtin_not_deletable', '内置任务只能暂停或休眠，不能删除。', 409)
      await runningTask(task)
      const deleted = await store.deleteTask(id)
      if (!deleted) throw new AutomationError('task_not_found', '任务不存在。', 404)
      return { deleted: true, id }
    })
  }

  async function changeState(id, action) {
    return serialize(async () => {
      const task = await withTask(id)
      if (action === 'activate') {
        if (task.state === 'active') return task
        return store.getTask((await store.setTaskState(id, 'active')).id)
      }
      if (action === 'pause') {
        if (task.state === 'paused') return task
        if (task.state !== 'active') throw new AutomationError('invalid_state', '只有运行中的任务可以暂停。', 409)
        return store.getTask((await store.setTaskState(id, 'paused')).id)
      }
      if (action === 'hibernate') {
        if (task.origin !== 'builtin') throw new AutomationError('invalid_origin', '自定义任务请直接删除；休眠只用于恢复内置默认。', 409)
        await runningTask(task)
        return store.getTask((await store.setTaskState(id, 'dormant')).id)
      }
      throw new AutomationError('invalid_action', '未知的任务动作。', 400)
    })
  }

  async function copyTask(id) {
    return serialize(async () => {
      const task = await withTask(id)
      if (task.origin !== 'builtin') throw new AutomationError('invalid_origin', '只有内置任务可以复制为自定义任务。', 409)
      const record = await store.copyBuiltin(id)
      if (record === undefined) throw new AutomationError('task_not_found', '任务不存在。', 404)
      return store.getTask(record.id)
    })
  }

  async function runTask(id) {
    return serialize(async () => {
      const task = await withTask(id)
      if (scheduler === undefined) throw new AutomationError('scheduler_unavailable', '调度器不可用。', 503)
      const result = await scheduler.runNow(task)
      if (!result.ok) throw new AutomationError(result.code, result.message, result.code === 'scheduler_unavailable' ? 503 : 409, result.runId === undefined ? {} : { runId: result.runId })
      return result.run
    })
  }

  async function cancelRun(id) {
    return serialize(async () => {
      const run = await store.getRun(id)
      if (run === undefined) throw new AutomationError('run_not_found', '运行记录不存在。', 404)
      if (store.isActiveRun(run.status) !== true) throw new AutomationError('run_not_active', '该运行已经结束。', 409)
      const live = runner?.cancelRun?.(id) === true
      if (!live) {
        await store.updateRun(id, {
          status: 'canceled',
          finishedAt: new Date(now()).toISOString(),
          durationMs: Math.max(0, now() - Date.parse(run.queuedAt)),
        })
      }
      return { canceling: true, id }
    })
  }

  async function getRun(id) {
    const run = await store.getRun(id)
    if (run === undefined) throw new AutomationError('run_not_found', '运行记录不存在。', 404)
    return {
      ...store.publicRun(run),
      attempts: await store.listAttemptsForRun(id),
    }
  }

  async function listRuns(query = {}) {
    const limit = runLimitOf(query.limit)
    const before = runCursorOf(query.before)
    const page = await store.listRunsPage({ limit, before })
    if (page.invalidCursor) throw new AutomationError('invalid_cursor', '运行分页游标无效。', 400)
    return {
      runs: page.runs.map((run) => store.publicRun(run)),
      nextBefore: page.nextBefore ?? null,
    }
  }

  /**
   * Daily run counts for the contribution heatmap. Days are bucketed in the browser's zone,
   * because `queuedAt` is an instant and the calendar day is a local fact.
   */
  async function runHistory(query = {}) {
    const days = historyDaysOf(query.days)
    const timeZone = historyTimeZoneOf(query.tz)
    const end = localPartsAt(now(), timeZone)
    const start = addDays(end, -(days - 1))
    const buckets = []
    const byDate = new Map()
    for (let index = 0; index < days; index += 1) {
      const date = addDays(start, index).date
      const bucket = { date, total: 0, success: 0, failure: 0, active: 0 }
      buckets.push(bucket)
      byDate.set(date, bucket)
    }
    const page = await store.listRunsPage({ limit: MAX_RUN_PAGE_LIMIT })
    let total = 0
    let success = 0
    let failure = 0
    for (const run of page.runs) {
      const at = Date.parse(run.queuedAt)
      if (Number.isNaN(at)) continue
      const bucket = byDate.get(localPartsAt(at, timeZone).date)
      if (bucket === undefined) continue
      bucket.total += 1
      total += 1
      if (run.status === 'succeeded') {
        bucket.success += 1
        success += 1
      }
      if (FAILURE_STATUSES.has(run.status)) {
        bucket.failure += 1
        failure += 1
      }
      if (ACTIVE_STATUSES.has(run.status)) bucket.active += 1
    }
    return { days: buckets, total, success, failure }
  }

  async function board(query = {}) {
    if (boardService === undefined || typeof boardService.board !== 'function') {
      throw new AutomationError('board_unavailable', '看板服务暂时不可用。', 503)
    }
    try {
      return await boardService.board(query)
    } catch (error) {
      if (error?.boardError === true) throw new AutomationError(error.code, error.message, error.status ?? 400)
      throw error
    }
  }

  async function confirmTodo(input) {
    if (boardService === undefined || typeof boardService.confirmTodo !== 'function') {
      throw new AutomationError('board_unavailable', '看板服务暂时不可用。', 503)
    }
    const parsed = parseStrict(TodoConfirmSchema, input, 'board/todo-confirm')
    try {
      return await boardService.confirmTodo(parsed.id)
    } catch (error) {
      if (error?.boardError === true) throw new AutomationError(error.code, error.message, error.status ?? 400)
      throw error
    }
  }

  function mapAskError(error) {
    if (error?.askError === true) {
      throw new AutomationError(error.code, error.message, error.status ?? 400, error.extra)
    }
    throw error
  }

  async function askBrief(runId, input) {
    if (asks === undefined || typeof asks.ask !== 'function') {
      throw new AutomationError('ask_unavailable', '追问服务暂时不可用。', 503)
    }
    const parsed = parseStrict(AskCreateSchema, input, 'board/ask')
    try {
      return { ask: await asks.ask(runId, parsed) }
    } catch (error) {
      mapAskError(error)
    }
  }

  async function askStatus(askId) {
    if (asks === undefined || typeof asks.status !== 'function') {
      throw new AutomationError('ask_unavailable', '追问服务暂时不可用。', 503)
    }
    try {
      return { ask: await asks.status(askId) }
    } catch (error) {
      mapAskError(error)
    }
  }

  async function askAnswer(askId) {
    if (asks === undefined || typeof asks.answer !== 'function') {
      throw new AutomationError('ask_unavailable', '追问服务暂时不可用。', 503)
    }
    try {
      return await asks.answer(askId)
    } catch (error) {
      mapAskError(error)
    }
  }

  async function retryBrief(runId) {
    if (briefs === undefined || typeof briefs.retry !== 'function') {
      throw new AutomationError('brief_not_found', '任务简报服务暂时不可用。', 503)
    }
    const result = await briefs.retry(runId)
    if (result?.ok !== true) {
      throw new AutomationError(
        result?.code ?? 'brief_not_retryable',
        result?.message ?? '这条任务简报暂时不能重试。',
        result?.status ?? 409,
      )
    }
    return { queued: true }
  }

  async function listNotifications(query = {}) {
    let unreadOnly = false
    if (query.unread !== undefined) {
      if (query.unread === true || query.unread === '1' || query.unread === 'true') unreadOnly = true
      else if (query.unread !== false && query.unread !== '0' && query.unread !== 'false') {
        throw invalidQuery('通知 unread 参数无效。')
      }
    }
    const scope = notificationScopeOf(query.scope)
    return {
      notifications: await store.listNotifications({ unreadOnly, limit: 200, scope }),
      unread: await store.unreadNotificationCount(scope),
    }
  }

  async function markNotificationsRead(input) {
    const parsed = parseStrict(NotificationsReadSchema, input, 'notifications/read')
    return { changed: await store.markNotificationsRead({ ...parsed, scope: parsed.scope ?? 'task' }) }
  }

  async function taskDetail(id) {
    const task = await withTask(id)
    const page = await store.listRunsPage({ limit: 20, taskId: id })
    const runs = page.runs.map((run) => store.publicRun(run))
    const notifications = await store.listNotifications({ taskId: id, limit: 200 })
    return { task: store.decorateTask(task, page.runs), runs, notifications }
  }

  return {
    serialize,
    meta,
    workspaceCatalog,
    listTasks,
    taskDetail,
    createTask,
    patchTask,
    deleteTask,
    changeState,
    copyTask,
    runTask,
    cancelRun,
    getRun,
    listRuns,
    runHistory,
    board,
    confirmTodo,
    retryBrief,
    askBrief,
    askStatus,
    askAnswer,
    listNotifications,
    markNotificationsRead,
    storageState: async () => {
      try {
        await store.open()
        return { state: 'ready' }
      } catch (error) {
        return { state: 'unavailable', error: sanitizeMessage(String(error)) }
      }
    },
  }
}
