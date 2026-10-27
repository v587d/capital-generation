import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAutomationStore, profileKeyOf } from '../automation/store.js'
import { createFakeDomain } from './automation-harness.mjs'
import { tradingCalendar } from '../automation/calendar.js'
import { TaskConfigSchema } from '../automation/schema.js'

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
  mode: 'research',
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
  assert.equal((await a.store.listTasks()).length, 3)
  assert.equal((await b.store.listTasks()).length, 3)
  const created = await a.store.createTask(createInput)
  assert.equal((await a.store.listTasks()).length, 4)
  assert.equal((await b.store.listTasks()).length, 3, '另一个 profile 不能看到这条自定义任务')
  assert.equal(await b.store.getTask(created.id), undefined)
  assert.equal(await b.store.getRun('run_x'), undefined)
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
