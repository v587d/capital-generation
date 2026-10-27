import { test } from 'node:test'
import assert from 'node:assert/strict'
import { automationGuardReason, BLOCKED_TOOL_NAMES, installAutomationPolicy } from '../automation/policy.js'

function runner() {
  const sessions = new Set(['session-run'])
  const denied = []
  return {
    denied,
    hasAutomationSession: (id) => sessions.has(id),
    noteGuardDenied: (sessionId, tool, reason) => denied.push({ sessionId, tool, reason }),
  }
}

function exec(name, sessionId = 'session-run', extra = {}) {
  return { name, arguments: extra, agent: { session: { id: sessionId } } }
}

test('无人值守运行拒绝提问与写文件，并记入运行错误；普通会话不受影响', () => {
  const fake = runner()
  assert.ok(BLOCKED_TOOL_NAMES.includes('ask_user_question'))
  for (const name of ['ask_user_question', 'write', 'edit']) {
    const reason = automationGuardReason(exec(name), fake)
    assert.equal(typeof reason, 'string')
    assert.equal(fake.denied.at(-1).tool, name)
  }
  assert.equal(automationGuardReason(exec('ask_user_question', 'session-human'), fake), undefined)
  assert.equal(automationGuardReason(exec('read'), fake), undefined)
  assert.equal(fake.denied.length, 3)
})


test('run_code 的 sandbox 提权请求同样被无人值守 policy 拒绝', () => {
  const fake = runner()
  const reason = automationGuardReason(exec('run_code', 'session-run', { sandbox_permissions: 'workspace-write' }), fake)
  assert.match(reason, /提权/)
  assert.equal(fake.denied.at(-1).tool, 'run_code')
})

test('tools.guard 尚未就绪时不锁死安装状态，依赖就绪后可安装一次', () => {
  const root = {}
  let tools
  const guards = []
  const ctx = {
    root,
    get: () => tools,
    effect: (callback) => callback(),
  }
  const fake = runner()
  installAutomationPolicy({ ctx, runner: fake, logger: { warn() {}, info() {} } })
  tools = {
    guard: (guard) => {
      guards.push(guard)
      return () => {}
    },
  }
  installAutomationPolicy({ ctx, runner: fake, logger: { warn() {}, info() {} } })
  installAutomationPolicy({ ctx, runner: fake, logger: { warn() {}, info() {} } })
  assert.equal(guards.length, 1)
})
test('profile reload 更新动态 runner，旧 effect cleanup 不会拆掉新 guard', () => {
  const root = {}
  const first = runner()
  const second = runner()
  let active = first
  const guards = []
  const cleanups = []
  let disposed = 0
  const ctx = {
    root,
    tools: {
      guard: (guard) => {
        guards.push(guard)
        return () => { disposed += 1 }
      },
    },
    effect: (callback) => {
      const cleanup = callback()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }
  installAutomationPolicy({ ctx, runner: () => active, logger: { warn() {}, info() {} } })
  active = second
  installAutomationPolicy({ ctx, runner: () => active, logger: { warn() {}, info() {} } })
  assert.equal(guards.length, 1)
  assert.match(guards[0](exec('write')), /无人值守/)
  assert.equal(first.denied.length, 0)
  assert.equal(second.denied.length, 1)
  cleanups[0]()
  assert.equal(disposed, 0)
  cleanups[1]()
  assert.equal(disposed, 1)
})

