import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createScheduler } from '../automation/scheduler.js'
import { createAutomationStore } from '../automation/store.js'
import { tradingCalendar } from '../automation/calendar.js'
import { createFakeDomain } from './automation-harness.mjs'

const BASE_INPUT = {
  title: '定时任务',
  instruction: '给出结论',
  category: 'news',
  trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true },
  mode: 'news',
}

function harness({ owner, calendar = tradingCalendar, now = Date.parse('2026-10-27T00:31:00Z'), runner: runnerOption } = {}) {
  const fake = createFakeDomain()
  const clock = { value: now }
  const store = createAutomationStore({
    openDomain: async () => fake.domain,
    profile: { name: 'web' },
    now: () => clock.value,
    calendar,
  })
  const dispatches = []
  const runner = runnerOption ?? {
    async dispatch(run, task, trigger) { dispatches.push({ run, task, trigger }) },
    cancelRun: () => false,
  }
  const fakeOwner = owner ?? {
    ownerId: 'test-owner',
    held: false,
    fencingToken: undefined,
    lockDir: '/tmp/fake-owner',
    async acquire() { this.held = true; this.fencingToken = 'token'; return true },
    async renew() { return this.held },
    async release() { this.held = false },
  }
  const scheduler = createScheduler({
    store,
    runner,
    owner: { ownerId: fakeOwner.ownerId ?? 'test-owner', lease: fakeOwner },
    calendar,
    profile: { ownerDir: '/tmp/fake-owner' },
    getSettings: () => ({ tickMs: 60_000, catchUpMs: 10 * 60_000, inAppNotifications: true }),
    now: () => clock.value,
    logger: { info() {}, warn() {}, error() {} },
  })
  return { fake, store, scheduler, dispatches, clock }
}

test('到点任务只 claim 一次，下一次 tick 不重复投递', async () => {
  const { store, scheduler, dispatches, clock } = harness({ now: Date.parse('2026-10-27T00:29:00Z') })
  await store.createTask(BASE_INPUT)
  clock.value = Date.parse('2026-10-27T01:05:00Z')
  await scheduler.tick()
  assert.equal(dispatches.length, 1)
  assert.equal(dispatches[0].trigger, 'scheduled')
  await scheduler.tick()
  assert.equal(dispatches.length, 1, '同一 occurrence 不能重复')
})

test('并发手动运行按 scheduler admission 串行，同一任务只创建一个 queued run', async () => {
  const { store, scheduler } = harness()
  const created = await store.createTask(BASE_INPUT)
  const task = await store.getTask(created.id)
  const results = await Promise.all([
    scheduler.runNow(task),
    scheduler.runNow(task),
  ])
  assert.equal(results.filter((result) => result.ok).length, 1)
  assert.equal(results.filter((result) => result.code === 'run_in_progress').length, 1)
  assert.equal((await store.listRunsPage({ limit: 10 })).runs.length, 1)
})

test('创建 queued run 后失去 owner：收口 unknown 且 occurrence 不会下一 tick 重试', async () => {
  let checks = 0
  const owner = {
    ownerId: 'test-owner',
    held: false,
    fencingToken: undefined,
    lockDir: '/tmp/fake-owner',
    async acquire() { this.held = true; this.fencingToken = 'token'; return true },
    async renew() { return true },
    async isCurrent() { checks += 1; return checks < 4 },
    async release() { this.held = false },
  }
  const { store, scheduler, dispatches, clock } = harness({ owner, now: Date.parse('2026-10-27T00:29:00Z') })
  const created = await store.createTask(BASE_INPUT)
  clock.value = Date.parse('2026-10-27T01:05:00Z')
  await scheduler.tick()
  assert.equal(dispatches.length, 0)
  const task = await store.getTask(created.id)
  assert.ok(task.lastHandledOccurrenceKey)
  const runs = (await store.listRunsPage({ limit: 10 })).runs
  assert.equal(runs[0].status, 'unknown_after_restart')
  await scheduler.tick()
  assert.equal(dispatches.length, 0)
  assert.equal((await store.listRunsPage({ limit: 10 })).runs.length, 1)
})
test('时钟回拨不制造重复 occurrence', async () => {
  const { store, scheduler, dispatches, clock } = harness({ now: Date.parse('2026-10-27T00:29:00Z') })
  await store.createTask(BASE_INPUT)
  clock.value = Date.parse('2026-10-27T01:05:00Z')
  await scheduler.tick()
  assert.equal(dispatches.length, 1)
  clock.value = Date.parse('2026-10-26T01:05:00Z')
  await scheduler.tick()
  assert.equal(dispatches.length, 1, '回拨后的旧 occurrence 不能再次投递')
})

test('上一运行仍在 running 时，新 occurrence 记为 skipped_overlap', async () => {
  const { store, scheduler, dispatches, clock } = harness({ now: Date.parse('2026-10-26T00:29:00Z') })
  const record = await store.createTask(BASE_INPUT)
  const task = await store.getTask(record.id)
  // First tick performs boot recovery; a run created after it is a live overlap.
  await scheduler.tick()
  await store.createRun({ taskId: task.id, taskTitle: task.title, trigger: 'manual', occurrenceKey: 'manual-busy', status: 'running' })
  clock.value = Date.parse('2026-10-27T01:05:00Z')
  await scheduler.tick()
  assert.equal(dispatches.length, 0)
  const runs = (await store.listRunsPage({ limit: 10 })).runs
  assert.equal(runs[0].status, 'skipped_overlap')
})

test('超过 catch-up 窗口的历史 occurrence 记为 missed，不补跑', async () => {
  const { store, scheduler, dispatches, clock } = harness({ now: Date.parse('2026-10-27T00:00:00Z') })
  await store.createTask(BASE_INPUT)
  clock.value = Date.parse('2026-10-27T12:00:00Z')
  await scheduler.tick()
  assert.equal(dispatches.length, 0)
  const runs = (await store.listRunsPage({ limit: 10 })).runs
  assert.ok(runs.some((run) => run.status === 'missed'))
})

test('交易日历窗口外 fail-closed：skipped_calendar_unavailable，不按工作日猜', async () => {
  const { store, scheduler, dispatches } = harness({ now: Date.parse('2027-01-04T02:00:00Z') })
  await store.createTask(BASE_INPUT)
  await scheduler.tick()
  assert.equal(dispatches.length, 0)
  const runs = (await store.listRunsPage({ limit: 10 })).runs
  assert.equal(runs[0].status, 'skipped_calendar_unavailable')
})

test('日历刷新在途时不提前烧掉 occurrence；刷新结束仍未知才 fail-closed', async () => {
  let refreshing = true
  const calendar = {
    isTradingDay: () => undefined,
    status: () => ({ available: false, source: 'none' }),
    pendingRefresh: () => refreshing,
  }
  const { store, scheduler } = harness({ calendar, now: Date.parse('2026-10-27T01:05:00Z') })
  await store.createTask(BASE_INPUT)
  await scheduler.tick()
  assert.equal((await store.listRunsPage({ limit: 10 })).runs.length, 0, '刷新在途时应下一 tick 重试')
  refreshing = false
  await scheduler.tick()
  const runs = (await store.listRunsPage({ limit: 10 })).runs
  assert.equal(runs.length, 1)
  assert.equal(runs[0].status, 'skipped_calendar_unavailable')
})


test('本地 held 但根锁 token 已失效时不允许手动投递', async () => {
  const owner = {
    ownerId: 'test-owner',
    held: true,
    fencingToken: 'stale-token',
    lockDir: '/tmp/fake-owner',
    async acquire() { return false },
    async renew() { return true },
    async isCurrent() { return false },
    async release() { this.held = false },
  }
  const { store, scheduler, dispatches } = harness({ owner })
  const record = await store.createTask(BASE_INPUT)
  const task = await store.getTask(record.id)
  const result = await scheduler.runNow(task)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'scheduler_unavailable')
  assert.equal(dispatches.length, 0)
})

test('standby 时手动运行返回 scheduler_unavailable；取得 owner 后才投递', async () => {
  const owner = {
    ownerId: 'test-owner',
    held: true,
    fencingToken: 'foreign',
    lockDir: '/tmp/fake-owner',
    async acquire() { return false },
    async renew() { return false },
    async release() { this.held = false },
  }
  const { store, scheduler } = harness({ owner })
  const record = await store.createTask(BASE_INPUT)
  const task = await store.getTask(record.id)
  const rejected = await scheduler.runNow(task)
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'scheduler_unavailable')

  const free = harness()
  const freeRecord = await free.store.createTask(BASE_INPUT)
  const freeTask = await free.store.getTask(freeRecord.id)
  const accepted = await free.scheduler.runNow(freeTask)
  assert.equal(accepted.ok, true)
  assert.equal(accepted.run.trigger, 'manual')
  assert.equal(free.dispatches.length, 1)
})
