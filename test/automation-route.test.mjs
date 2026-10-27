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
      trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true },
      mode: 'research',
    },
  })
  assert.equal(created.statusCode, 201)
  assert.equal(created.headers['cache-control'], 'no-store')
  const task = created.json().task
  const id = task.id
  assert.equal(task.origin, 'custom')
  assert.equal(task.state, 'active')

  const listed = await call(handler, { method: 'GET', url: '/capital-automation/tasks' })
  assert.ok(listed.json().tasks.some((item) => item.id === id))

  const patched = await call(handler, { method: 'PATCH', url: `/capital-automation/tasks/${id}`, body: { title: '改名' } })
  assert.equal(patched.statusCode, 200)
  assert.equal(patched.json().task.title, '改名')

  const detail = await call(handler, { method: 'GET', url: `/capital-automation/tasks/${id}` })
  assert.equal(detail.statusCode, 200)
  assert.equal(detail.json().task.title, '改名')

  const removed = await call(handler, { method: 'DELETE', url: `/capital-automation/tasks/${id}` })
  assert.equal(removed.statusCode, 200)
  assert.equal(removed.json().deleted, true)
})

test('任务详情按 taskId 先过滤再分页，不被全局最新运行记录遮蔽', async () => {
  const { handler, store, service } = harness()
  const firstRecord = await store.createTask({
    title: '旧任务',
    instruction: '旧指令',
    category: 'research',
    trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: false },
    mode: 'research',
  })
  const first = await store.getTask(firstRecord.id)
  const secondRecord = await store.createTask({
    title: '新任务',
    instruction: '新指令',
    category: 'research',
    trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: false },
    mode: 'research',
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

test('query 参数拒绝未知键、重复键、超长值和非法分页值', async () => {
  const { handler } = harness()
  for (const url of [
    '/capital-automation/runs?unknown=x',
    '/capital-automation/runs?limit=1&limit=2',
    `/capital-automation/runs?before=${'x'.repeat(513)}`,
    '/capital-automation/runs?limit=0',
    '/capital-automation/notifications?unread=maybe',
  ]) {
    const response = await call(handler, { method: 'GET', url })
    assert.equal(response.statusCode, 400, url)
    assert.equal(response.json().code === 'invalid_query' || response.json().code === 'invalid_cursor', true)
  }
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
    mode: 'research',
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
        mode: 'news',
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
    body: { title: 't', instruction: 'i', category: 'news', trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: false }, mode: 'news' },
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
  const { handler } = harness({ workspaces })
  const res = await call(handler, { method: 'GET', url: '/capital-automation/meta' })
  const meta = res.json()
  assert.equal(meta.profile.name, 'web')
  assert.deepEqual(meta.workspaces, [{ id: 'ws_1', title: '研究项目', default: true }])
  assert.equal(meta.defaultWorkspaceId, 'ws_1')
  assert.equal(meta.execution.preset, 'capital-generation')
  assert.equal(meta.execution.cwdKind, 'profile')
  assert.equal(meta.execution.policy, 'automation-v1')
  assert.equal(JSON.stringify(meta).includes('/home/'), false)
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
    mode: 'research',
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
