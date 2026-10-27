import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRunRunner, buildRunPrompt, sessionTitleOf } from '../automation/runner.js'
import { createAutomationStore } from '../automation/store.js'
import { createFakeDomain, fakeContext } from './automation-harness.mjs'
import { tradingCalendar } from '../automation/calendar.js'

const NOW = Date.parse('2026-10-27T00:31:00Z')

function taskInput() {
  return {
    title: '早间资讯',
    instruction: '收集隔夜资讯',
    category: 'news',
    trigger: { kind: 'schedule', cadence: 'daily', time: '08:30', timezone: 'Asia/Shanghai', tradingDaysOnly: true },
    mode: 'news',
    limits: { runTimeoutMinutes: 30, idleTimeoutMinutes: 5, maxSteps: 300, maxToolCalls: 1_200 },
  }
}

async function harness({ promptFails = false, createFails = false, createPending = false, workspaces } = {}) {
  const fake = createFakeDomain()
  const store = createAutomationStore({ openDomain: async () => fake.domain, profile: { name: 'web' }, now: () => NOW, calendar: tradingCalendar })
  const created = await store.createTask(taskInput())
  const task = await store.getTask(created.id)
  const agent = {
    session: { id: 'session-run' },
    status: 'running',
    inbox: { nextTurn: [], nextStep: [] },
    canceled: [],
    cancel(cause) { this.canceled.push(cause) },
    async whenIdle() {},
  }
  const sessions = new Map([['session-run', agent.session]])
  const createdWith = []
  const controller = {
    async create(input) {
      createdWith.push(input)
      if (createFails) throw new Error('session create failed')
      return { sessionId: 'session-run' }
    },
    async rename(input) { return { title: input.title } },
    async resolveAgent() { return { agent } },
    async prompt() {
      if (promptFails) throw new Error('prompt admission failed')
      return { accepted: true }
    },
  }
  const { ctx, listeners } = fakeContext({
    sessionController: controller,
    agents: { list: () => [agent], get: () => agent },
    sessions: { get: (id) => sessions.get(id), flush: async () => {} },
    subagents: { waitForChildren: async () => false, drainDescendants: async () => {} },
  })
  const runner = createRunRunner({
    ctx,
    store,
    settings: { inAppNotifications: false },
    profile: { displayName: 'web', runDir: '/tmp/capital-automation-runner-test' },
    workspaces,
    now: () => NOW,
    logger: { info() {}, warn() {}, error() {} },
  })
  runner.installListeners()
  const run = await store.createRun({
    taskId: task.id,
    taskTitle: task.title,
    trigger: 'manual',
    occurrenceKey: 'manual-runner-test',
    status: 'queued',
  })
  await store.claimOccurrence({ taskId: task.id, runId: run.id, occurrenceKey: run.occurrenceKey })
  return { fake, store, task, agent, run, runner, ctx, listeners, sessions, controller, createdWith }
}

test('prompt 模板包含触发原因、occurrence、时区与无人值守标识', async () => {
  const { store } = await harness()
  const task = (await store.listTasks())[0]
  const run = { id: 'run_abcdef12', occurrenceKey: 'p:task:version:instant', scheduledFor: '2026-10-27T00:30:00.000Z' }
  const prompt = buildRunPrompt({ task, run, trigger: 'scheduled', profileName: 'web', now: NOW })
  assert.match(prompt, /运行: run_abcdef12/)
  assert.match(prompt, /触发: 定时触发/)
  assert.match(prompt, /无人值守策略: automation-v1/)
  assert.match(prompt, /Asia\/Shanghai/)
  assert.match(prompt, /禁止 ask_user_question/)
  assert.match(sessionTitleOf(task, 'web', run.id), /^\[CapGen 投研自动化·web\] .+·abcdef12$/)
})

test('正常运行：创建新 session、接受 prompt、turn/end completed 后收口 succeeded', async () => {
  const { store, task, agent, run, runner, ctx } = await harness()
  await runner.dispatch(run, task, 'manual')
  const running = await store.getRun(run.id)
  assert.equal(running.status, 'running')
  assert.equal(running.sessionId, 'session-run')
  ctx.emit('session/event', agent.session, { type: 'turn/end', turn: 1, reason: { kind: 'completed' } })
  agent.status = 'idle'
  ctx.emit('agent/status', { agent, status: 'idle' })
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const done = await store.getRun(run.id)
  assert.equal(done.status, 'succeeded')
  assert.equal(done.steps, 0)
  runner.dispose()
})

test('runtime dispose 会把仍活动的运行收口为 unknown_after_restart', async () => {
  const { store, task, run, runner } = await harness()
  await runner.dispatch(run, task, 'manual')
  runner.dispose()
  await new Promise((resolve) => setTimeout(resolve, 20))
  const closed = await store.getRun(run.id)
  assert.equal(closed.status, 'unknown_after_restart')
  assert.equal((await store.listAttemptsForRun(run.id))[0].state, 'unknown')
})
test('queued 运行已终态或 runtime 已 dispose 时不创建 session', async () => {
  const canceled = await harness()
  await canceled.store.updateRun(canceled.run.id, {
    status: 'canceled',
    finishedAt: new Date(NOW).toISOString(),
    durationMs: 0,
  })
  assert.equal(await canceled.runner.dispatch(canceled.run, canceled.task, 'manual'), false)
  assert.deepEqual(canceled.createdWith, [])
  canceled.runner.dispose()

  const disposed = await harness()
  const pending = disposed.runner.dispatch(disposed.run, disposed.task, 'manual')
  await disposed.runner.dispose()
  assert.equal(await pending, false)
  assert.equal((await disposed.store.getRun(disposed.run.id)).status, 'unknown_after_restart')
  assert.deepEqual(disposed.createdWith, [])
})
test('session 创建失败留下可见 failed run，而不是空记录', async () => {
  const { store, task, run, runner } = await harness({ createFails: true })
  await runner.dispatch(run, task, 'manual')
  const failed = await store.getRun(run.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.errors[0].code, 'session_create_failed')
  runner.dispose()
})

test('prompt 未被确认进入 unknown_after_restart，不自动重试', async () => {
  const { store, task, run, runner } = await harness({ promptFails: true })
  await runner.dispatch(run, task, 'manual')
  const unknown = await store.getRun(run.id)
  assert.equal(unknown.status, 'unknown_after_restart')
  assert.equal(unknown.errors[0].code, 'prompt_not_accepted')
  assert.equal((await store.listAttemptsForRun(run.id))[0].state, 'unknown')
  runner.dispose()
})

test('profile 级 admission cap 拒绝第三个活动运行并收口 skipped_overlap', async () => {
  const { store, task, runner } = await harness()
  const runs = []
  for (let index = 0; index < 3; index += 1) {
    const run = await store.createRun({
      taskId: task.id,
      taskTitle: task.title,
      trigger: 'manual',
      occurrenceKey: `manual-cap-${index}`,
      status: 'queued',
    })
    await store.claimOccurrence({ taskId: task.id, runId: run.id, occurrenceKey: run.occurrenceKey })
    runs.push(run)
  }
  await runner.dispatch(runs[0], task, 'manual')
  await runner.dispatch(runs[1], task, 'manual')
  assert.equal(runner.canDispatch(), false)
  assert.equal(await runner.dispatch(runs[2], task, 'manual'), false)
  assert.equal((await store.getRun(runs[2].id)).status, 'skipped_overlap')
  runner.dispose()
})
test('工具预算按整棵运行子树计数：tool/call 与 PTC 派发各算一次，同一事件不重复', async () => {
  const { store, task, agent, run, runner, ctx } = await harness()
  await runner.dispatch(run, task, 'manual')
  for (let index = 0; index < 3; index += 1) {
    ctx.emit('session/event', agent.session, { type: 'tool/call', callId: `call-${index}`, name: 'read' })
  }
  for (let index = 0; index < 2; index += 1) {
    ctx.emit('session/event', agent.session, { type: 'tool/ptc-dispatch', callId: `ptc-${index}`, name: 'describe_dataset' })
  }
  ctx.emit('session/event', agent.session, { type: 'turn/end', turn: 1, reason: { kind: 'completed' } })
  agent.status = 'idle'
  ctx.emit('agent/status', { agent, status: 'idle' })
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const done = await store.getRun(run.id)
  assert.equal(done.status, 'succeeded')
  assert.equal(done.toolCalls, 5)
  runner.dispose()
})

test('任务选择工作区时以 workspaceId 创建 session；未选择时退回受控 cwd', async () => {
  const withWorkspace = await harness({ workspaces: { resolve: async () => ({ workspaceId: 'ws_1', path: '/tmp/project' }) } })
  await withWorkspace.runner.dispatch(withWorkspace.run, withWorkspace.task, 'manual')
  assert.deepEqual(withWorkspace.createdWith[0], { workspaceId: 'ws_1', agentPreset: 'capital-generation' })
  withWorkspace.runner.dispose()

  const withoutWorkspace = await harness()
  await withoutWorkspace.runner.dispatch(withoutWorkspace.run, withoutWorkspace.task, 'manual')
  assert.deepEqual(withoutWorkspace.createdWith[0], { cwd: '/tmp/capital-automation-runner-test', agentPreset: 'capital-generation' })
  withoutWorkspace.runner.dispose()
})


test('监听器安装幂等且 dispose 清理三类事件订阅', async () => {
  const { runner, listeners } = await harness()
  runner.installListeners()
  runner.installListeners()
  assert.equal(listeners.get('session/event')?.length, 1)
  assert.equal(listeners.get('agent/status')?.length, 1)
  assert.equal(listeners.get('subagent/end')?.length, 1)
  runner.dispose()
  assert.equal(listeners.get('session/event')?.length, 0)
  assert.equal(listeners.get('agent/status')?.length, 0)
  assert.equal(listeners.get('subagent/end')?.length, 0)
})

test('descendant session 走 parent lineage 归属运行并记录 policy 拒绝', async () => {
  const { store, task, agent, run, runner, ctx, sessions } = await harness()
  await runner.dispatch(run, task, 'manual')
  const child = { id: 'session-child', header: { parentSession: 'session-run' } }
  sessions.set(child.id, child)
  assert.equal(runner.hasAutomationSession(child.id), true)
  runner.noteGuardDenied(child.id, 'write', '无人值守运行不能写文件。')
  ctx.emit('session/event', child, { type: 'tool/call', callId: 'child-call', name: 'read' })
  ctx.emit('session/event', child, { type: 'tool/call', callId: 'child-call', name: 'read' })
  ctx.emit('session/event', agent.session, { type: 'turn/end', turn: 1, reason: { kind: 'completed' } })
  agent.status = 'idle'
  ctx.emit('agent/status', { agent, status: 'idle' })
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const done = await store.getRun(run.id)
  assert.equal(done.status, 'blocked_requires_user')
  assert.equal(done.toolCalls, 1)
  assert.equal(done.errors[0].code, 'blocked_requires_user')
  runner.dispose()
})

test('重复 tool event 不绕过预算，超限只发起一次取消', async () => {
  const { store, task, agent, run, runner, ctx } = await harness()
  const limited = { ...task, limits: { ...task.limits, maxToolCalls: 10 } }
  await runner.dispatch(run, limited, 'manual')
  for (let index = 0; index < 10; index += 1) {
    ctx.emit('session/event', agent.session, { type: 'tool/call', callId: `call-${index}`, name: 'read' })
  }
  ctx.emit('session/event', agent.session, { type: 'tool/call', callId: 'call-9', name: 'read' })
  ctx.emit('session/event', agent.session, { type: 'tool/call', callId: 'call-10', name: 'read' })
  assert.equal(agent.canceled.length, 1)
  agent.status = 'idle'
  ctx.emit('agent/status', { agent, status: 'idle' })
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const done = await store.getRun(run.id)
  assert.equal(done.status, 'failed')
  assert.equal(done.toolCalls, 11)
  assert.equal(done.errors[0].code, 'tool_limit')
  runner.dispose()
})
