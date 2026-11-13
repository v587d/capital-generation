import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAutomationRouteHandler } from '../automation/route.js'
import { createAutomationService } from '../automation/service.js'
import { createAutomationStore } from '../automation/store.js'
import { createFakeDomain, httpFixture } from './automation-harness.mjs'
import { tradingCalendar } from '../automation/calendar.js'

const NOW = Date.parse('2026-10-27T00:00:00Z')

function harness(options = {}) {
  const fake = createFakeDomain()
  const store = createAutomationStore({
    openDomain: async () => fake.domain,
    profile: { name: options.profile ?? 'web' },
    now: () => NOW,
    calendar: tradingCalendar,
  })
  const runner = { cancelRun: () => false }
  const scheduler = {
    status: () => ({ state: options.schedulerState ?? 'active' }),
    runNow: async (task) => options.runNow
      ? options.runNow(task)
      : { ok: true, run: await store.createRun({ taskId: task.id, taskTitle: task.title, trigger: 'manual', occurrenceKey: 'manual-test', status: 'queued' }) },
  }
  const service = createAutomationService({
    store,
    scheduler,
    runner,
    calendar: tradingCalendar,
    profile: { displayName: options.profile ?? 'web' },
    workspaces: options.workspaces,
    version: '2.12.0',
    settings: () => ({ tickMs: 60_000, inAppNotifications: true }),
    briefs: options.briefs,
    asks: options.asks,
    boardService: options.boardService,
    storage: options.storage,
    now: () => NOW,
  })
  const handler = createAutomationRouteHandler(service, { authorize: options.authorize ?? (() => undefined) })
  return { fake, store, service, handler }
}

async function call(handler, input) {
  const { req, res } = httpFixture({ headers: { host: 'localhost' }, ...input })
  await handler(req, res)
  return res
}

test('⛔ 认证先于业务：401 时不读 body、不碰 storage、不解析任务 id', async () => {
  let touched = 0
  const handler = createAutomationRouteHandler(new Proxy({}, {
    get() {
      return async () => { touched += 1; return {} }
    },
  }), { authorize: () => 401 })
  const res = await call(handler, { method: 'POST', url: '/capital-automation/tasks', body: { title: 'x' } })
  assert.equal(res.statusCode, 401)
  assert.equal(res.body, 'unauthorized')
  assert.equal(touched, 0)
})

test('缺少 authorizer 时 route fail closed', async () => {
  const handler = createAutomationRouteHandler({})
  const res = await call(handler, { method: 'GET', url: '/capital-automation/meta' })
  assert.equal(res.statusCode, 401)
  assert.equal(res.body, 'unauthorized')
})

test('authorizer 抛错按 401 收口；403 原样返回', async () => {
  for (const [authorize, status, body] of [
    [() => { throw new Error('gone') }, 401, 'unauthorized'],
    [() => 403, 403, 'forbidden'],
  ]) {
    const handler = createAutomationRouteHandler({}, { authorize })
    const res = await call(handler, { method: 'GET', url: '/capital-automation/meta' })
    assert.equal(res.statusCode, status)
    assert.equal(res.body, body)
  }
})

test('CRUD：创建、列表、详情、补丁、删除；所有响应 no-store', async () => {
  const { handler } = harness()
  const created = await call(handler, {
    method: 'POST',
    url: '/capital-automation/tasks',
    body: {
      title: '测试任务',
      instruction: '给出结论',
      category: 'research',
      icon: 'bell',
      trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true },
    },
  })
  assert.equal(created.statusCode, 201)
  assert.equal(created.headers['cache-control'], 'no-store')
  const task = created.json().task
  const id = task.id
  assert.equal(task.origin, 'custom')
  assert.equal(task.state, 'active')
  assert.equal(task.icon, 'bell')

  const listed = await call(handler, { method: 'GET', url: '/capital-automation/tasks' })
  assert.ok(listed.json().tasks.some((item) => item.id === id))

  const patched = await call(handler, { method: 'PATCH', url: `/capital-automation/tasks/${id}`, body: { title: '改名', icon: 'target' } })
  assert.equal(patched.statusCode, 200)
  assert.equal(patched.json().task.title, '改名')
  assert.equal(patched.json().task.icon, 'target')

  const detail = await call(handler, { method: 'GET', url: `/capital-automation/tasks/${id}` })
  assert.equal(detail.statusCode, 200)
  assert.equal(detail.json().task.title, '改名')

  const removed = await call(handler, { method: 'DELETE', url: `/capital-automation/tasks/${id}` })
  assert.equal(removed.statusCode, 200)
  assert.equal(removed.json().deleted, true)
})

test('图标闭集：未知 icon 在进入 storage 前被 schema 拒绝', async () => {
  const { handler } = harness()
  const res = await call(handler, {
    method: 'POST',
    url: '/capital-automation/tasks',
    body: {
      title: '测试任务',
      instruction: '给出结论',
      category: 'research',
      icon: 'not-in-catalog',
      trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true },
    },
  })
  assert.equal(res.statusCode, 400)
})

test('任务详情按 taskId 先过滤再分页，不被全局最新运行记录遮蔽', async () => {
  const { handler, store, service } = harness()
  const firstRecord = await store.createTask({
    title: '旧任务',
    instruction: '旧指令',
    category: 'research',
    trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: false },
  })
  const first = await store.getTask(firstRecord.id)
  const secondRecord = await store.createTask({
    title: '新任务',
    instruction: '新指令',
    category: 'research',
    trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: false },
  })
  const second = await store.getTask(secondRecord.id)
  await store.createRun({ id: 'run_a_old', taskId: first.id, taskTitle: first.title, trigger: 'manual', occurrenceKey: 'old', status: 'succeeded' })
  for (let index = 0; index < 25; index += 1) {
    await store.createRun({
      id: `run_b_${String(index).padStart(2, '0')}`,
      taskId: second.id,
      taskTitle: second.title,
      trigger: 'manual',
      occurrenceKey: `new-${index}`,
      status: 'succeeded',
    })
  }
  const detail = await service.taskDetail(first.id)
  assert.deepEqual(detail.runs.map((run) => run.id), ['run_a_old'])
  const routed = await call(handler, { method: 'GET', url: `/capital-automation/tasks/${first.id}` })
  assert.deepEqual(routed.json().runs.map((run) => run.id), ['run_a_old'])
})

test('运行历史按浏览器时区聚合，按日返回成功 / 失败 / 进行中', async () => {
  const { handler, store } = harness()
  const succeeded = await store.createRun({
    taskId: 'task_history',
    taskTitle: '历史',
    trigger: 'manual',
    occurrenceKey: 'history-a',
    status: 'succeeded',
  })
  const failed = await store.createRun({
    taskId: 'task_history',
    taskTitle: '历史',
    trigger: 'manual',
    occurrenceKey: 'history-b',
    status: 'failed',
  })
  // 2026-10-26 23:30 in Shanghai, still 2026-10-26 in UTC.
  await store.updateRun(succeeded.id, { queuedAt: '2026-10-26T15:30:00.000Z' })
  // 2026-10-27 00:30 in Shanghai, 2026-10-26 in UTC.
  await store.updateRun(failed.id, { queuedAt: '2026-10-26T16:30:00.000Z' })

  const shanghai = await call(handler, { method: 'GET', url: '/capital-automation/runs/history?days=2&tz=Asia/Shanghai' })
  assert.equal(shanghai.statusCode, 200)
  const shanghaiDays = shanghai.json().days
  assert.deepEqual(shanghaiDays.map((day) => day.date), ['2026-10-26', '2026-10-27'])
  assert.deepEqual(shanghaiDays.map((day) => day.total), [1, 1])
  assert.deepEqual(shanghaiDays.map((day) => day.success), [1, 0])
  assert.deepEqual(shanghaiDays.map((day) => day.failure), [0, 1])
  assert.equal(shanghai.json().total, 2)
  assert.equal(shanghai.json().success, 1)
  assert.equal(shanghai.json().failure, 1)

  const utc = await call(handler, { method: 'GET', url: '/capital-automation/runs/history?days=2&tz=UTC' })
  assert.deepEqual(utc.json().days.map((day) => day.total), [2, 0], '同一天的 UTC 与上海日期不能混用')

  const active = await store.createRun({
    taskId: 'task_history',
    taskTitle: '历史',
    trigger: 'manual',
    occurrenceKey: 'history-c',
    status: 'running',
  })
  const withActive = await call(handler, { method: 'GET', url: '/capital-automation/runs/history?days=2&tz=Asia/Shanghai' })
  assert.equal(withActive.json().days[1].active, 1)
  assert.equal(withActive.json().total, 3)
  assert.equal(withActive.json().days[1].total, 2)
  await store.updateRun(active.id, { status: 'canceled', finishedAt: '2026-10-27T00:01:00.000Z' })
})

test('运行历史拒绝非法 days / tz，且 query 仍走白名单', async () => {
  const { handler } = harness()
  for (const url of [
    '/capital-automation/runs/history?days=0',
    '/capital-automation/runs/history?days=372',
    '/capital-automation/runs/history?days=abc',
    '/capital-automation/runs/history?tz=Mars%2FBase',
    '/capital-automation/runs/history?unknown=x',
  ]) {
    const response = await call(handler, { method: 'GET', url })
    assert.equal(response.statusCode, 400, url)
    assert.equal(response.json().code, 'invalid_query', url)
  }
})

test('query 参数拒绝未知键、重复键、超长值和非法分页值', async () => {
  const { handler } = harness()
  for (const url of [
    '/capital-automation/runs?unknown=x',
    '/capital-automation/runs?limit=1&limit=2',
    `/capital-automation/runs?before=${'x'.repeat(513)}`,
    '/capital-automation/runs?limit=0',
    '/capital-automation/notifications?unread=maybe',
    '/capital-automation/notifications?scope=bad',
  ]) {
    const response = await call(handler, { method: 'GET', url })
    assert.equal(response.statusCode, 400, url)
    assert.equal(response.json().code === 'invalid_query' || response.json().code === 'invalid_cursor', true)
  }
})

test('通知接口默认只返回任务事件，系统状态用 scope=system 取', async () => {
  const { handler, store } = harness()
  await store.addNotification({ kind: 'run_failed', title: '失败', message: 'x' })
  await store.addNotification({ kind: 'scheduler_standby', title: '待命', message: 'y' })
  const taskOnly = await call(handler, { method: 'GET', url: '/capital-automation/notifications' })
  assert.equal(taskOnly.statusCode, 200)
  assert.deepEqual(taskOnly.json().notifications.map((item) => item.kind), ['run_failed'])
  assert.equal(taskOnly.json().unread, 1)
  const system = await call(handler, { method: 'GET', url: '/capital-automation/notifications?scope=system' })
  assert.deepEqual(system.json().notifications.map((item) => item.kind), ['scheduler_standby'])
  assert.equal(system.json().unread, 1)
  const read = await call(handler, { method: 'POST', url: '/capital-automation/notifications/read', body: { all: true } })
  assert.equal(read.json().changed, 1, '全部已读默认只处理任务通知')
  const remaining = await call(handler, { method: 'GET', url: '/capital-automation/notifications?scope=all' })
  assert.equal(remaining.json().unread, 1, '系统事件应保持未读')
})

test('超长 URL 在解析 query 前返回 414', async () => {
  const { handler } = harness()
  const response = await call(handler, {
    method: 'GET',
    url: `/capital-automation/runs?limit=${'x'.repeat(16 * 1024)}`,
  })
  assert.equal(response.statusCode, 414)
  assert.equal(response.json().code, 'url_too_long')
})
test('流式 body 支持字符串 chunk，并在 content-length 超限时提前拒绝', async () => {
  const { handler } = harness()
  const streamed = httpFixture({ method: 'POST', url: '/capital-automation/tasks' })
  const body = JSON.stringify({
    title: '流式任务',
    instruction: '给出结论',
    category: 'research',
    trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: false },
  })
  streamed.req[Symbol.asyncIterator] = async function* () {
    yield body.slice(0, 12)
    yield body.slice(12)
  }
  await handler(streamed.req, streamed.res)
  assert.equal(streamed.res.statusCode, 201)

  const oversized = httpFixture({
    method: 'POST',
    url: '/capital-automation/tasks',
    headers: { 'content-length': String(64 * 1024 + 1) },
  })
  await handler(oversized.req, oversized.res)
  assert.equal(oversized.res.statusCode, 413)
  assert.equal(oversized.res.json().code, 'body_too_large')
})
test('请求体不能伪造 profile / owner / session / preset / cwd / origin / state', async () => {
  const { handler } = harness()
  for (const field of ['profileKey', 'profileName', 'ownerId', 'sessionId', 'agentPreset', 'presetId', 'cwd', 'origin', 'state']) {
    const res = await call(handler, {
      method: 'POST',
      url: '/capital-automation/tasks',
      body: {
        title: 'x',
        instruction: 'y',
        category: 'news',
        trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: false },
        [field]: 'forged',
      },
    })
    assert.equal(res.statusCode, 400, `${field} 必须被拒绝`)
    assert.equal(res.json().ok, false)
  }
})

test('内置任务不可删除；运行中不可删除/休眠；已结束运行不可再取消', async () => {
  const { handler, store } = harness()
  const tasks = (await call(handler, { method: 'GET', url: '/capital-automation/tasks' })).json().tasks
  const builtin = tasks.find((task) => task.origin === 'builtin')
  const deleted = await call(handler, { method: 'DELETE', url: `/capital-automation/tasks/${builtin.id}` })
  assert.equal(deleted.statusCode, 409)
  assert.equal(deleted.json().code, 'builtin_not_deletable')

  const created = await call(handler, {
    method: 'POST',
    url: '/capital-automation/tasks',
    body: { title: 't', instruction: 'i', category: 'news', trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: false } },
  })
  const id = created.json().task.id
  const run = await store.createRun({ taskId: id, taskTitle: 't', trigger: 'manual', occurrenceKey: 'm1', status: 'running' })
  const remove = await call(handler, { method: 'DELETE', url: `/capital-automation/tasks/${id}` })
  assert.equal(remove.statusCode, 409)
  assert.equal(remove.json().code, 'run_in_progress')
  await store.updateRun(run.id, { status: 'succeeded', finishedAt: '2026-10-27T00:01:00.000Z', durationMs: 60_000 })
  const cancel = await call(handler, { method: 'POST', url: `/capital-automation/runs/${run.id}/cancel` })
  assert.equal(cancel.statusCode, 409)
  assert.equal(cancel.json().code, 'run_not_active')
})

test('非法 JSON、未知字段、非法 id 与未知路径都返回稳定 code', async () => {
  const { handler } = harness()
  const broken = await call(handler, { method: 'POST', url: '/capital-automation/tasks', body: '{ not json' })
  assert.equal(broken.statusCode, 400)
  assert.equal(broken.json().code, 'invalid_json')
  const unknown = await call(handler, { method: 'GET', url: '/capital-automation/nope' })
  assert.equal(unknown.statusCode, 404)
  const badId = await call(handler, { method: 'GET', url: '/capital-automation/tasks/%2E%2E%2Fetc%2Fpasswd' })
  assert.equal(badId.statusCode, 400)
  assert.equal(badId.json().code, 'invalid_id')
  const wrongMethod = await call(handler, { method: 'PUT', url: '/capital-automation/meta' })
  assert.equal(wrongMethod.statusCode, 405)
})

test('手动运行在 standby 时返回 scheduler_unavailable；active 时返回 run', async () => {
  const standby = harness({ schedulerState: 'standby', runNow: async () => ({ ok: false, code: 'scheduler_unavailable', message: '未取得运行权' }) })
  const task = (await call(standby.handler, { method: 'GET', url: '/capital-automation/tasks' })).json().tasks[0]
  const rejected = await call(standby.handler, { method: 'POST', url: `/capital-automation/tasks/${task.id}/run` })
  assert.equal(rejected.statusCode, 503)
  assert.equal(rejected.json().code, 'scheduler_unavailable')

  const active = harness()
  const accepted = await call(active.handler, { method: 'POST', url: `/capital-automation/tasks/${task.id}/run` })
  assert.equal(accepted.statusCode, 202)
  assert.equal(accepted.json().run.trigger, 'manual')
})

test('meta 暴露当前 profile、scheduler、工作区列表与 execution policy，但不含绝对路径', async () => {
  const workspaces = {
    list: async () => [{ id: 'ws_1', title: '研究项目', default: true }],
    validate: async () => {},
  }
  const { handler, store } = harness({ workspaces })
  await store.addNotification({ kind: 'run_failed', title: '失败', message: 'x' })
  await store.addNotification({ kind: 'scheduler_standby', title: '待命', message: 'y' })
  const res = await call(handler, { method: 'GET', url: '/capital-automation/meta' })
  const meta = res.json()
  assert.equal(meta.profile.name, 'web')
  assert.deepEqual(meta.notifications, { unread: 1 }, '未读徽标随页面壳返回，且只算任务通知')
  assert.deepEqual(meta.workspaces, [{ id: 'ws_1', title: '研究项目', default: true }])
  assert.equal(meta.defaultWorkspaceId, 'ws_1')
  assert.equal(meta.execution.preset, 'capital-generation')
  assert.equal(meta.execution.cwdKind, 'profile')
  assert.equal(meta.execution.policy, 'automation-v1')
  assert.deepEqual(meta.execution.cadences, ['daily', 'weekly', 'monthly', 'once'])
  assert.equal(JSON.stringify(meta).includes('/home/'), false)
})

test('/workspaces 只给设置卡片读路径与专属默认标记，meta 仍不暴露绝对路径', async () => {
  const workspaces = {
    list: async () => [],
    validate: async () => {},
    details: async () => ({
      workspaces: [
        { id: 'ws_default', title: 'CapGen 投研自动化（web）', path: '/home/shawn/.dsh/CapGen-automation-workspace/web', displayPath: '~/.dsh/CapGen-automation-workspace/web', default: true, dedicated: true },
        { id: 'ws_project', title: '研究项目', path: '/home/shawn/project', displayPath: '~/project', default: false, dedicated: false },
      ],
      defaultWorkspaceId: 'ws_default',
    }),
  }
  const { handler } = harness({ workspaces })
  const res = await call(handler, { method: 'GET', url: '/capital-automation/workspaces' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['cache-control'], 'no-store')
  const body = res.json()
  assert.equal(body.defaultWorkspaceId, 'ws_default')
  assert.equal(body.workspaces[1].displayPath, '~/project')
  assert.equal(body.workspaces[0].dedicated, true)
})

test('保存任务时工作区 id 走服务端 allowlist；未知 id 拒绝，空值表示默认工作区', async () => {
  const workspaces = {
    list: async () => [],
    validate: async (id) => {
      if (id !== 'ws_1') {
        const error = new Error('选择的工作区不存在或已被移除。')
        error.code = 'workspace_not_found'
        throw error
      }
    },
  }
  const { handler } = harness({ workspaces })
  const base = {
    title: '工作区任务',
    instruction: '给出结论',
    category: 'research',
    trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true },
  }
  const created = await call(handler, { method: 'POST', url: '/capital-automation/tasks', body: { ...base, workspaceId: 'ws_1' } })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().task.workspaceId, 'ws_1')
  const rejected = await call(handler, { method: 'POST', url: '/capital-automation/tasks', body: { ...base, workspaceId: 'ws_missing' } })
  assert.equal(rejected.statusCode, 400)
  assert.equal(rejected.json().code, 'workspace_not_found')
  const defaulted = await call(handler, { method: 'POST', url: '/capital-automation/tasks', body: { ...base, workspaceId: '' } })
  assert.equal(defaulted.statusCode, 201)
  assert.equal(defaulted.json().task.workspaceId, '')
})

test('看板 GET 允许 5 个 query 参数，未知/超限参数仍被白名单拒绝', async () => {
  let seen
  const boardService = {
    async board(query) {
      seen = query
      return {
        ok: true,
        empty: true,
        range: { days: 14, from: null, to: '2026-11-04' },
        stats: { briefs: 0, todos: 0, stocks: 0, gaps: 0, issues7d: 0 },
        cards: [],
        todos: [],
        stocks: [],
        gaps: [],
        health: { windowDays: 7, runs: {}, briefs: {}, recentIssues: [] },
        nextBefore: null,
      }
    },
  }
  const { handler } = harness({ boardService })
  const response = await call(handler, {
    method: 'GET',
    url: '/capital-automation/board?days=14&tz=Asia%2FShanghai&limit=30&category=news&before=run_x',
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().empty, true)
  assert.deepEqual(seen, { days: '14', tz: 'Asia/Shanghai', limit: '30', category: 'news', before: 'run_x' })
  for (const url of [
    '/capital-automation/board?days=14&tz=UTC&limit=30&category=news&before=run_x&extra=1',
    '/capital-automation/board?days=14&tz=UTC&limit=30&before=run_x&extra=1',
  ]) {
    const rejected = await call(handler, { method: 'GET', url })
    assert.equal(rejected.statusCode, 400, url)
    assert.equal(rejected.json().code, 'invalid_query', url)
  }
})

test('TODO 确认：POST /board/todos/confirm 只接受字符串 id', async () => {
  let seen
  const boardService = {
    async confirmTodo(id) {
      seen = id
      return { id, confirmedAt: '2026-11-07T00:00:00.000Z' }
    },
  }
  const { handler } = harness({ boardService })
  const id = 'verify|300803.SZ|收盘价站回 44.01'
  const confirmed = await call(handler, {
    method: 'POST',
    url: '/capital-automation/board/todos/confirm',
    body: { id },
  })
  assert.equal(confirmed.statusCode, 200)
  assert.equal(confirmed.json().id, id)
  assert.equal(confirmed.json().confirmedAt, '2026-11-07T00:00:00.000Z')
  assert.equal(seen, id)

  for (const body of [{ id: '' }, { id: 5 }, { id: 'x', extra: true }, {}]) {
    const rejected = await call(handler, {
      method: 'POST',
      url: '/capital-automation/board/todos/confirm',
      body,
    })
    assert.equal(rejected.statusCode, 400, JSON.stringify(body))
    assert.equal(rejected.json().code, 'invalid_request')
  }
})


test('TODO 决定：POST /board/todos/decision 只接受三分支与字符串 id', async () => {
  let seen
  const boardService = {
    async decideTodo(id, action) {
      seen = { id, action }
      return {
        id,
        action,
        decision: action === 'defer' ? 'deferred' : 'confirmed',
        decidedAt: '2026-11-07T00:00:00.000Z',
      }
    },
  }
  const { handler } = harness({ boardService })
  const id = 'confirm|300803.SZ'
  for (const action of ['confirm', 'defer', 'auto']) {
    const response = await call(handler, {
      method: 'POST',
      url: '/capital-automation/board/todos/decision',
      body: { id, action },
    })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().id, id)
    assert.equal(seen.action, action)
  }

  for (const body of [
    { id: '', action: 'confirm' },
    { id, action: 'unknown' },
    { id, action: 'confirm', extra: true },
    { id: 5, action: 'confirm' },
    {},
  ]) {
    const rejected = await call(handler, {
      method: 'POST',
      url: '/capital-automation/board/todos/decision',
      body,
    })
    assert.equal(rejected.statusCode, 400, JSON.stringify(body))
    assert.equal(rejected.json().code, 'invalid_request')
  }
})

test('看板追问：POST 只接受严格 body，GET 按 id 读状态', async () => {
  const seen = []
  const asks = {
    async ask(runId, input) {
      seen.push({ runId, input })
      return {
        id: 'ask_1',
        runId,
        sessionId: 'session_ask',
        question: input.question,
        status: 'running',
        preview: null,
        error: null,
        createdAt: '2026-11-09T00:00:00.000Z',
        finishedAt: null,
      }
    },
    async status(id) {
      seen.push({ id })
      return { id, status: 'ready', preview: '先看成交量。', sessionId: 'session_ask' }
    },
  }
  const { handler } = harness({ asks })
  const created = await call(handler, {
    method: 'POST',
    url: '/capital-automation/board/briefs/run_ask/ask',
    body: { question: '成交量怎么看？', timeZone: 'Asia/Shanghai' },
  })
  assert.equal(created.statusCode, 202)
  assert.equal(created.json().ask.id, 'ask_1')
  assert.equal(seen[0].runId, 'run_ask')
  assert.equal(seen[0].input.question, '成交量怎么看？')

  const state = await call(handler, { method: 'GET', url: '/capital-automation/board/asks/ask_1' })
  assert.equal(state.statusCode, 200)
  assert.equal(state.json().ask.preview, '先看成交量。')
  assert.deepEqual(seen[1], { id: 'ask_1' })

  for (const body of [{}, { question: '' }, { question: 'x', extra: true }]) {
    const rejected = await call(handler, {
      method: 'POST',
      url: '/capital-automation/board/briefs/run_ask/ask',
      body,
    })
    assert.equal(rejected.statusCode, 400, JSON.stringify(body))
    assert.equal(rejected.json().code, 'invalid_request')
  }
  const wrongMethod = await call(handler, { method: 'POST', url: '/capital-automation/board/asks/ask_1' })
  assert.equal(wrongMethod.statusCode, 405)
})

test('看板历史：GET /board/briefs/:runId/asks 返回全部追问', async () => {
  let seen
  const asks = {
    async history(runId) {
      seen = runId
      return [
        { id: 'ask_1', question: '第一问', status: 'ready' },
        { id: 'ask_2', question: '第二问', status: 'running' },
      ]
    },
  }
  const { handler } = harness({ asks })
  const response = await call(handler, { method: 'GET', url: '/capital-automation/board/briefs/run_ask/asks' })
  assert.equal(response.statusCode, 200)
  assert.equal(seen, 'run_ask')
  assert.deepEqual(response.json().asks.map((ask) => ask.id), ['ask_1', 'ask_2'])
  const wrongMethod = await call(handler, { method: 'POST', url: '/capital-automation/board/briefs/run_ask/asks' })
  assert.equal(wrongMethod.statusCode, 405)
})

test('看板完整回答：GET /board/asks/:id/answer，不被单条状态路由吞掉', async () => {
  let seen
  const asks = {
    async answer(id) {
      seen = id
      return { answer: '完整回答正文', truncated: false, finishedAt: '2026-11-09T00:01:00.000Z' }
    },
  }
  const { handler } = harness({ asks })
  const response = await call(handler, { method: 'GET', url: '/capital-automation/board/asks/ask_1/answer' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().answer, '完整回答正文')
  assert.equal(response.json().truncated, false)
  assert.equal(seen, 'ask_1')
  const wrongMethod = await call(handler, { method: 'POST', url: '/capital-automation/board/asks/ask_1/answer' })
  assert.equal(wrongMethod.statusCode, 405)
})
test('失败简报重试：只走单条 POST，状态码与错误码稳定', async () => {
  let called = 0
  const briefs = {
    async retry(runId) {
      called += 1
      assert.equal(runId, 'run_brief')
      return { ok: false, code: 'brief_not_retryable', message: '这条简报已达到重试上限。', status: 409 }
    },
  }
  const { handler } = harness({ briefs })
  const rejected = await call(handler, { method: 'POST', url: '/capital-automation/board/briefs/run_brief/retry' })
  assert.equal(called, 1)
  assert.equal(rejected.statusCode, 409)
  assert.equal(rejected.json().code, 'brief_not_retryable')
  const noBackfill = await call(handler, { method: 'POST', url: '/capital-automation/board/backfill' })
  assert.equal(noBackfill.statusCode, 404)
})

test('存储：GET /storage 返回缓存/分析/会话三段，响应 no-store', async () => {
  const storage = {
    async stats() {
      return {
        workspace: { id: 'ws-1', title: 'CapGen 投研自动化（web）', displayPath: '~/T', scope: 'dedicated' },
        cache: { bytes: 123, files: 2, categories: { datasets: { bytes: 123, files: 2 }, profiles: { bytes: 0, files: 0 }, ocr: { bytes: 0, files: 0 }, other: { bytes: 0, files: 0 } }, truncated: false, unreadable: 0, unsafe: false },
        analysis: { bytes: 456, files: 1, categories: { charts: { bytes: 456, files: 1 }, runs: { bytes: 0, files: 0 }, other: { bytes: 0, files: 0 } }, truncated: false, unreadable: 0, unsafe: false },
        sessions: { available: true, bytes: 789, count: 3 },
      }
    },
    async clear() { throw new Error('must not clear on GET') },
  }
  const { handler } = harness({ storage })
  const response = await call(handler, { method: 'GET', url: '/capital-automation/storage' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  const body = response.json().storage
  assert.equal(body.workspace.id, 'ws-1')
  assert.equal(body.cache.bytes, 123)
  assert.equal(body.analysis.bytes, 456)
  assert.deepEqual(body.sessions, { available: true, bytes: 789, count: 3 })
  assert.equal(body.canClear, true)
  assert.equal(body.activeRuns, 0)
})

test('存储：活动运行存在时 GET /storage 标 canClear=false', async () => {
  const storage = {
    async stats() {
      return {
        workspace: { displayPath: '~/T' },
        cache: { bytes: 10, files: 1, categories: {}, truncated: false, unreadable: 0, unsafe: false },
        analysis: { bytes: 0, files: 0, categories: {}, truncated: false, unreadable: 0, unsafe: false },
        sessions: { available: true, bytes: 0, count: 0 },
      }
    },
    async clear() { throw new Error('must not clear on GET') },
  }
  const { store, handler } = harness({ storage })
  await store.createRun({ taskId: 't1', taskTitle: 'T', trigger: 'manual', occurrenceKey: 'manual-t1', status: 'running' })
  const response = await call(handler, { method: 'GET', url: '/capital-automation/storage' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().storage.activeRuns, 1)
  assert.equal(response.json().storage.canClear, false)
})

test('存储：POST /storage/clear 只接受 {confirm:true}，成功返回释放量', async () => {
  let calls = 0
  const storage = {
    async stats() { return { workspace: {}, cache: {}, analysis: {}, sessions: {} } },
    async clear() {
      calls += 1
      return { bytes: 123, files: 2, categories: { datasets: { bytes: 123, files: 2 } }, failed: [] }
    },
  }
  const { handler } = harness({ storage })
  const cleared = await call(handler, { method: 'POST', url: '/capital-automation/storage/clear', body: { confirm: true } })
  assert.equal(cleared.statusCode, 200)
  assert.equal(cleared.json().cleared.bytes, 123)
  assert.equal(calls, 1)

  for (const body of [{}, { confirm: false }, { confirm: true, extra: 1 }]) {
    const rejected = await call(handler, { method: 'POST', url: '/capital-automation/storage/clear', body })
    assert.equal(rejected.statusCode, 400, JSON.stringify(body))
    assert.equal(rejected.json().code, 'invalid_request')
  }
  assert.equal(calls, 1, '校验失败不能进入删除')
  const wrongMethod = await call(handler, { method: 'GET', url: '/capital-automation/storage/clear' })
  assert.equal(wrongMethod.statusCode, 405)
  const wrongGet = await call(handler, { method: 'POST', url: '/capital-automation/storage', body: { confirm: true } })
  assert.equal(wrongGet.statusCode, 405)
})

test('存储：活动运行存在时 409，且 storage.clear 一次都不调用', async () => {
  let calls = 0
  const storage = {
    async stats() { return { workspace: {}, cache: {}, analysis: {}, sessions: {} } },
    async clear() { calls += 1; return { bytes: 0, files: 0, failed: [] } },
  }
  const { store, handler } = harness({ storage })
  await store.createRun({ taskId: 't1', taskTitle: 'T', trigger: 'manual', occurrenceKey: 'manual-t1', status: 'queued' })
  const response = await call(handler, { method: 'POST', url: '/capital-automation/storage/clear', body: { confirm: true } })
  assert.equal(response.statusCode, 409)
  assert.equal(response.json().code, 'run_in_progress')
  assert.equal(calls, 0)
})

test('存储：未认证请求在读取 body 与存储前 401', async () => {
  let touched = 0
  const storage = {
    async stats() { touched += 1; return {} },
    async clear() { touched += 1; return {} },
  }
  const { handler } = harness({ storage, authorize: () => 401 })
  const get = await call(handler, { method: 'GET', url: '/capital-automation/storage' })
  assert.equal(get.statusCode, 401)
  const post = await call(handler, { method: 'POST', url: '/capital-automation/storage/clear', body: { confirm: true } })
  assert.equal(post.statusCode, 401)
  assert.equal(touched, 0)
})
