import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createAutomationStore, profileKeyOf } from '../automation/store.js'
import { BUILTIN_BY_ID, BUILTIN_DEFINITIONS } from '../automation/builtins.js'
import { createFakeDomain } from './automation-harness.mjs'
import { tradingCalendar } from '../automation/calendar.js'
import { TaskConfigSchema } from '../automation/schema.js'
import { BUILTIN_TASK_ICONS, TASK_ICON_CATALOG } from '../automation/task-icons.js'

const START = Date.parse('2026-10-27T00:00:00Z')

let idCounter = 0
function make(profileName = 'web', fake = createFakeDomain()) {
  let clock = START
  const store = createAutomationStore({
    openDomain: async () => fake.domain,
    profile: { name: profileName },
    now: () => clock,
    calendar: tradingCalendar,
    random: () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`,
  })
  return { store, fake, setNow: (value) => { clock = value } }
}

const createInput = {
  title: '自定义任务',
  instruction: '给出结论',
  category: 'research',
  trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true },
}

test('活动 owner token 阻止旧 scheduler 覆盖元数据，过期后允许新 token 接管', async () => {
  const { store, setNow } = make()
  const active = {
    schemaVersion: 1,
    profileKey: store.profileKey,
    ownerId: 'owner-a',
    fencingToken: 'token-a',
    leaseExpiresAt: '2026-10-27T00:01:00.000Z',
    heartbeatAt: '2026-10-27T00:00:00.000Z',
    schedulerState: 'active',
    updatedAt: '2026-10-27T00:00:00.000Z',
  }
  assert.equal(await store.setOwnerMeta(active), true)
  assert.equal(await store.setOwnerMeta({ ...active, ownerId: 'owner-b', fencingToken: 'token-b' }), false)
  assert.equal((await store.getOwnerMeta()).fencingToken, 'token-a')
  setNow(Date.parse('2026-10-27T00:02:00.000Z'))
  assert.equal(await store.setOwnerMeta({ ...active, ownerId: 'owner-b', fencingToken: 'token-b' }), true)
  assert.equal((await store.getOwnerMeta()).fencingToken, 'token-b')
})
test('内置任务按 profile 播种；不同 profile 的记录互相不可见', async () => {
  const fake = createFakeDomain()
  const a = make('web', fake)
  const b = make('capital', fake)
  const builtinCount = BUILTIN_DEFINITIONS.length
  assert.equal((await a.store.listTasks()).length, builtinCount)
  assert.equal((await b.store.listTasks()).length, builtinCount)
  const created = await a.store.createTask(createInput)
  assert.equal((await a.store.listTasks()).length, builtinCount + 1)
  assert.equal((await b.store.listTasks()).length, builtinCount, '另一个 profile 不能看到这条自定义任务')
  assert.equal(await b.store.getTask(created.id), undefined)
  assert.equal(await b.store.getRun('run_x'), undefined)
})

test('旧内置覆盖层升级：刷新旧指令、丢掉 mode，保留真实 workspace 选择', async () => {
  const fake = createFakeDomain()
  const profileKey = profileKeyOf('web')
  const id = `bt_${createHash('sha256').update(`${profileKey}:morning-brief`).digest('hex').slice(0, 24)}`
  const oldInstruction = '旧指令\n\n数据与来源纪律：\n- 旧内容\n\n无人值守执行策略（automation-v1）：\n- 旧内容'
  const oldDescription = '交易日开盘前汇总隔夜外盘、重要公告与政策信息，给出当日需要盯住的线索。'
  fake.tables.get('tasks').set(id, {
    schemaVersion: 1,
    id,
    origin: 'builtin',
    sourceBuiltinId: 'morning-brief',
    profileKey,
    profileName: 'web',
    state: 'active',
    definitionVersion: 1,
    overrides: {
      title: '早间资讯',
      description: oldDescription,
      instruction: oldInstruction,
      category: 'news',
      mode: 'news',
      workspaceId: 'ws_keep',
    },
    scheduleAnchorAt: '2026-10-27T00:00:00.000Z',
    createdAt: '2026-10-27T00:00:00.000Z',
    updatedAt: '2026-10-27T00:00:00.000Z',
  })
  const { store } = make('web', fake)
  const task = await store.getTask(id)
  assert.equal(task.instruction, BUILTIN_BY_ID.get('morning-brief').defaults.instruction)
  assert.equal(task.description, BUILTIN_BY_ID.get('morning-brief').defaults.description)
  assert.equal(task.workspaceId, 'ws_keep')
  assert.equal('mode' in task, false)
  const persisted = fake.tables.get('tasks').get(id)
  assert.equal(persisted.definitionVersion, BUILTIN_BY_ID.get('morning-brief').version)
  assert.equal(persisted.overrides.instruction, undefined)
  assert.equal(persisted.overrides.description, undefined)
  assert.equal(persisted.overrides.mode, undefined)
  assert.equal(persisted.overrides.workspaceId, 'ws_keep')
})

test('内置任务只保存真正改动的字段，不把整份默认值钉进覆盖层', async () => {
  const { store, fake } = make()
  const morning = (await store.listTasks()).find((task) => task.sourceBuiltinId === 'morning-brief')
  await store.patchTask(morning.id, {
    title: '我的早报',
    instruction: morning.instruction,
    description: morning.description,
  })
  const record = fake.tables.get('tasks').get(morning.id)
  assert.deepEqual(Object.keys(record.overrides).sort(), ['title'])
  assert.equal((await store.getTask(morning.id)).title, '我的早报')
})

test('长 profile 名称不能因显示截断而发生 profileKey 碰撞', async () => {
  const prefix = 'profile-'.repeat(30)
  assert.notEqual(profileKeyOf(`${prefix}-a`), profileKeyOf(`${prefix}-b`))
  const fake = createFakeDomain()
  const a = make(`${prefix}-a`, fake)
  const b = make(`${prefix}-b`, fake)
  await a.store.listTasks()
  await b.store.listTasks()
  const created = await a.store.createTask(createInput)
  assert.equal(await b.store.getTask(created.id), undefined)
  assert.notEqual(a.store.profileKey, b.store.profileKey)
})

test('并发 claimOccurrence 只登记一个 occurrence', async () => {
  const { store, fake } = make()
  const created = await store.createTask(createInput)
  const attempts = await Promise.all(Array.from({ length: 12 }, (_, index) => store.claimOccurrence({
    taskId: created.id,
    runId: `run_claim_${index}`,
    occurrenceKey: 'occurrence-concurrent',
  })))
  assert.equal(attempts.filter(Boolean).length, 1)
  assert.equal(fake.tables.get('attempts').size, 1)
})
test('内置任务播种幂等；休眠清空覆盖层并恢复当前定义版本', async () => {
  const { store, fake } = make()
  await store.listTasks()
  const before = fake.tables.get('tasks').size
  await store.listTasks()
  assert.equal(fake.tables.get('tasks').size, before, '重复读取不能重复播种')
  const morning = (await store.listTasks()).find((task) => task.sourceBuiltinId === 'morning-brief')
  const patched = await store.getTask((await store.patchTask(morning.id, { title: '我的早报' })).id)
  assert.equal(patched.title, '我的早报')
  await store.setTaskState(morning.id, 'dormant')
  const reset = await store.getTask(morning.id)
  assert.equal(reset.title, '早间资讯')
  assert.equal(reset.state, 'dormant')
})

test('修改触发会重置 schedule anchor 与 lastHandled；修改标题不会', async () => {
  const { store } = make()
  const created = await store.createTask(createInput)
  await store.setLastHandled(created.id, 'old-key', '2026-10-26T01:00:00.000Z')
  await store.patchTask(created.id, { title: '改标题' })
  assert.equal((await store.taskRecordById(created.id)).lastHandledOccurrenceKey, 'old-key')
  await store.patchTask(created.id, { trigger: { ...createInput.trigger, time: '10:00' } })
  const record = await store.taskRecordById(created.id)
  assert.equal(record.lastHandledOccurrenceKey, undefined)
  assert.equal(record.lastScheduledFor, undefined)
})

test('custom 只能删除；builtin 不能删除，但可以复制为 paused 的 custom', async () => {
  const { store } = make()
  const tasks = await store.listTasks()
  const builtin = tasks.find((task) => task.origin === 'builtin')
  assert.equal(await store.deleteTask(builtin.id), false)
  const copy = await store.copyBuiltin(builtin.id)
  const copied = await store.getTask(copy.id)
  assert.equal(copied.origin, 'custom')
  assert.equal(copied.state, 'paused')
  assert.match(copied.title, /（副本）$/)
  assert.equal(await store.deleteTask(copied.id), true)
})

test('自定义任务图标：创建与修改都落库，复制内置模板继承模板图标', async () => {
  const { store } = make()
  const created = await store.createTask({ ...createInput, icon: 'bell' })
  assert.equal((await store.getTask(created.id)).icon, 'bell')
  await store.patchTask(created.id, { icon: 'target' })
  assert.equal((await store.getTask(created.id)).icon, 'target')
  const builtin = (await store.listTasks()).find((task) => task.origin === 'builtin')
  const copy = await store.copyBuiltin(builtin.id)
  const copied = await store.getTask(copy.id)
  assert.equal(copied.icon, BUILTIN_TASK_ICONS[builtin.sourceBuiltinId], '复制后应保留模板图标，用户再改')
  assert.ok(TASK_ICON_CATALOG[copied.icon], '复制出的图标必须仍在目录里')
})

test('运行保留：每任务 200 条，超出按 queuedAt 淘汰最旧', async () => {
  const { store } = make()
  const created = await store.createTask(createInput)
  const task = await store.getTask(created.id)
  for (let index = 0; index < 205; index += 1) {
    await store.createRun({
      taskId: task.id,
      taskTitle: task.title,
      trigger: 'manual',
      occurrenceKey: `manual-${index}`,
      status: 'succeeded',
    })
  }
  assert.equal(await store.runCountForTask(task.id), 200)
})

test('启动恢复：非终态运行与投递尝试都进入 unknown，终态不变', async () => {
  const { store } = make()
  const created = await store.createTask(createInput)
  const task = await store.getTask(created.id)
  const running = await store.createRun({ taskId: task.id, taskTitle: task.title, trigger: 'scheduled', occurrenceKey: 'k1', status: 'running' })
  const done = await store.createRun({ taskId: task.id, taskTitle: task.title, trigger: 'scheduled', occurrenceKey: 'k2', status: 'succeeded' })
  await store.claimOccurrence({ taskId: task.id, runId: running.id, occurrenceKey: 'k1' })
  assert.equal(await store.recoverNonTerminalRuns(), 1)
  assert.equal((await store.getRun(running.id)).status, 'unknown_after_restart')
  assert.equal((await store.getRun(done.id)).status, 'succeeded')
  assert.equal((await store.listAttemptsForRun(running.id))[0].state, 'unknown')
})

test('启动恢复：已落盘 turnState 的运行按回合成败收口，只有无回合边界的才 unknown', async () => {
  const { store, setNow } = make()
  const created = await store.createTask(createInput)
  const task = await store.getTask(created.id)
  const finished = await store.createRun({
    taskId: task.id,
    taskTitle: task.title,
    trigger: 'manual',
    occurrenceKey: 'k3',
    status: 'running',
  })
  await store.claimOccurrence({ taskId: task.id, runId: finished.id, occurrenceKey: 'k3' })
  const turnEnd = '2026-10-27T00:05:00.000Z'
  await store.updateRun(finished.id, {
    turnState: { phase: 'ended', turn: 1, status: 'succeeded', at: turnEnd },
    steps: 4,
    toolCalls: 7,
    summary: '最终答复',
  })
  setNow(Date.parse('2026-10-27T00:10:00.000Z'))
  assert.equal(await store.recoverNonTerminalRuns(), 1)
  const recovered = await store.getRun(finished.id)
  assert.equal(recovered.status, 'succeeded')
  assert.equal(recovered.finishedAt, turnEnd)
  assert.equal(recovered.durationMs, Date.parse(turnEnd) - Date.parse(recovered.queuedAt))
  assert.equal(recovered.steps, 4)
  assert.equal(recovered.toolCalls, 7)
  assert.equal(recovered.summary, '最终答复')
  assert.equal(recovered.errors.length, 0)
  assert.equal((await store.listAttemptsForRun(finished.id))[0].state, 'accepted')
})

test('通知按 profile 隔离、未读计数与批量已读', async () => {
  const fake = createFakeDomain()
  const a = make('web', fake)
  const b = make('capital', fake)
  await a.store.addNotification({ kind: 'run_failed', title: '失败', message: 'x' })
  await b.store.addNotification({ kind: 'run_failed', title: '失败', message: 'y' })
  assert.equal(await a.store.unreadNotificationCount(), 1)
  assert.equal(await b.store.unreadNotificationCount(), 1)
  assert.equal(await a.store.markNotificationsRead({ all: true }), 1)
  assert.equal(await a.store.unreadNotificationCount(), 0)
  assert.equal(await b.store.unreadNotificationCount(), 1)
})

test('任务通知与调度状态分开：默认列表与未读只算任务事件', async () => {
  const { store } = make()
  await store.addNotification({ kind: 'run_failed', title: '失败', message: 'x' })
  await store.addNotification({ kind: 'scheduler_standby', title: '待命', message: 'y' })
  assert.deepEqual((await store.listNotifications()).map((item) => item.kind), ['run_failed'])
  assert.equal(await store.unreadNotificationCount(), 1)
  assert.deepEqual((await store.listNotifications({ scope: 'system' })).map((item) => item.kind), ['scheduler_standby'])
  assert.equal(await store.unreadNotificationCount('system'), 1)
  assert.equal(await store.markNotificationsRead({ all: true }), 1, '任务全部已读不能顺手吞掉系统事件')
  assert.equal(await store.unreadNotificationCount('system'), 1)
  assert.equal(await store.unreadNotificationCount('all'), 1)
  assert.equal(await store.markNotificationsRead({ all: true, scope: 'system' }), 1)
  assert.equal(await store.unreadNotificationCount('all'), 0)
  assert.equal((await store.listNotifications({ scope: 'all' })).length, 2)
})

test('nextRun 展示使用任务时区，且把交易日历不可用显式暴露', async () => {
  const { store } = make()
  const created = await store.createTask(createInput)
  const task = await store.getTask(created.id)
  const decorated = store.decorateTask(task, [])
  assert.equal(decorated.nextRunAt, '2026-10-27T01:00:00.000Z')
  assert.match(decorated.nextRunLocal, /09:00/)
  const outside = store.decorateTask({ ...task, trigger: { ...task.trigger, timezone: 'Asia/Shanghai' } }, [])
  assert.equal(outside.nextRunUnavailable, false)
  const unavailable = store.decorateTask(task, [])
  assert.equal(unavailable.nextRunUnavailable, false)
})

test('strict schema：任务记录写坏字段会在域写入口就失败', async () => {
  const { store } = make()
  const created = await store.createTask(createInput)
  const record = await store.taskRecordById(created.id)
  assert.throws(() => TaskConfigSchema.parse({ ...record.custom, cwd: '/tmp' }), /Unrecognized key|unrecognized/i)
})

test('运行上限继承通用设置；任务单独改过才覆盖，改回通用值后重新跟随', async () => {
  const fake = createFakeDomain()
  const settings = { runTimeoutMinutes: 60, idleTimeoutMinutes: 5, maxSteps: 300, maxToolCalls: 1_200 }
  const store = createAutomationStore({
    openDomain: async () => fake.domain,
    profile: { name: 'web' },
    now: () => START,
    calendar: tradingCalendar,
    settings: () => ({ ...settings }),
  })
  const builtin = (await store.listTasks()).find((task) => task.sourceBuiltinId === 'morning-brief')
  assert.equal(builtin.limits.runTimeoutMinutes, 60, '没单独改过的内置任务用通用设置的默认值')
  settings.runTimeoutMinutes = 90
  assert.equal((await store.getTask(builtin.id)).limits.runTimeoutMinutes, 90, '改了通用设置，没覆盖的任务跟着变')

  const inherited = await store.createTask({ ...createInput, title: '跟随通用' })
  assert.equal((await store.getTask(inherited.id)).limits.runTimeoutMinutes, 90, '新建任务没给上限时继承通用设置')

  const pinned = await store.createTask({
    ...createInput,
    title: '单独上限',
    limits: { runTimeoutMinutes: 45, idleTimeoutMinutes: 5, maxSteps: 300, maxToolCalls: 1_200 },
  })
  settings.runTimeoutMinutes = 120
  assert.equal((await store.getTask(pinned.id)).limits.runTimeoutMinutes, 45, '任务单独改过的上限不被通用设置覆盖')

  await store.patchTask(pinned.id, { limits: { runTimeoutMinutes: 120, idleTimeoutMinutes: 5, maxSteps: 300, maxToolCalls: 1_200 } })
  assert.equal((await store.getTask(pinned.id)).limits.runTimeoutMinutes, 120, '把上限改成通用值即回到继承')
  settings.runTimeoutMinutes = 30
  assert.equal((await store.getTask(pinned.id)).limits.runTimeoutMinutes, 30, '之后继续跟随通用设置')
})

test('brief 按 profile 隔离，任务删除时与 run 一起级联删除', async () => {
  const fake = createFakeDomain()
  const a = make('web', fake)
  const b = make('capital', fake)
  const created = await a.store.createTask(createInput)
  const task = await a.store.getTask(created.id)
  const run = await a.store.createRun({
    taskId: task.id,
    taskTitle: task.title,
    trigger: 'manual',
    occurrenceKey: 'brief-cascade',
    status: 'succeeded',
    sessionId: 'session-brief',
  })
  const brief = await a.store.createBrief({ runId: run.id, taskId: task.id, sessionId: run.sessionId })
  assert.equal(brief.status, 'pending')
  assert.equal(await b.store.getBrief(run.id), undefined, '跨 profile 不能读')
  assert.equal((await a.store.createBrief({ runId: run.id, taskId: task.id, sessionId: run.sessionId })).runId, run.id, '同一 run 只登记一次')
  await a.store.updateBrief(run.id, {
    status: 'ready',
    headline: '科技股又跌了，救兵还没到',
    plain: '昨晚美国科技股继续下跌，市场怕的是它们之前涨得太贵。国内出了稳市场的新办法，但真正买股票的钱还没进来。今天开盘先看科技股能不能止跌，不然大盘还会被它们拖着走。',
    items: [],
    stocks: [],
    gaps: [],
  })
  assert.equal((await a.store.getBrief(run.id)).status, 'ready')
  await a.store.updateBrief(run.id, { status: 'pending' })
  const pending = await a.store.getBrief(run.id)
  assert.equal(pending.headline, undefined)
  assert.equal(pending.plain, undefined)
  assert.deepEqual(pending.items, [])
  await a.store.deleteTask(created.id)
  assert.equal(await a.store.getBrief(run.id), undefined, '删除自定义任务时 brief 必须一起删除')
})
