/**
 * API service. All mutations serialize on one promise chain so a manual run, a tick claim, and
 * a page cancel cannot interleave profile-visible state. Every lookup goes through the store's
 * profile filter; the wire body never selects a profile.
 */
import {
  DEFAULT_AUTOMATION_SETTINGS,
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
  NotificationsReadSchema,
  TaskCreateSchema,
  TaskPatchSchema,
  parseStrict,
} from './schema.js'
import { sanitizeMessage } from './redact.js'

const MAX_RUN_PAGE_LIMIT = 2_000
const RUN_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,120}$/

function invalidQuery(message) {
  return new AutomationError('invalid_query', message, 400)
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
  const { store, scheduler, runner, calendar, profile, workspaces, version, settings, now = () => Date.now() } = options
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
      workspaces: workspaceList,
      defaultWorkspaceId: workspaceList.find((item) => item.default === true)?.id ?? null,
      ...(workspaceError === undefined ? {} : { workspaceError }),
      scheduler: scheduler === undefined ? { state: 'unavailable' } : scheduler.status(),
      calendar: calendar?.status?.(new Date(now())) ?? { available: false, source: 'none' },
      execution: {
        preset: 'capital-generation',
        cwdKind: 'profile',
        policy: 'automation-v1',
        categories: ['news', 'market', 'review', 'research'],
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

  async function createTask(input) {
    const parsed = parseStrict(TaskCreateSchema, input, 'task')
    const defaults = { ...DEFAULT_AUTOMATION_SETTINGS, ...settings() }
    const resolved = {
      ...parsed,
      limits: parsed.limits ?? {
        runTimeoutMinutes: defaults.runTimeoutMinutes,
        idleTimeoutMinutes: defaults.idleTimeoutMinutes,
        maxSteps: defaults.maxSteps,
        maxToolCalls: defaults.maxToolCalls,
      },
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

  async function listNotifications(query = {}) {
    let unreadOnly = false
    if (query.unread !== undefined) {
      if (query.unread === true || query.unread === '1' || query.unread === 'true') unreadOnly = true
      else if (query.unread !== false && query.unread !== '0' && query.unread !== 'false') {
        throw invalidQuery('通知 unread 参数无效。')
      }
    }
    return {
      notifications: await store.listNotifications({ unreadOnly, limit: 200 }),
      unread: await store.unreadNotificationCount(),
    }
  }

  async function markNotificationsRead(input) {
    const parsed = parseStrict(NotificationsReadSchema, input, 'notifications/read')
    return { changed: await store.markNotificationsRead(parsed) }
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
