import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerBashGuard } from '../lib/agents/bash-guard.js'
import { registerFsWriteGuard, registerRootOcrGuard, registerRootToolPolicy } from '../lib/agents/root-tool-policy.js'
import { registerRoleSiblingGuard, registerRoleToolPolicy } from '../lib/agents/role-tool-policy.js'

// During the 0.2.1 transition the host `capital-policy` row and the monolith's old call sites
// register the same listeners; they must dedupe per root, else one root session gets 6 root probes
// and 6 bash-guard attempts. Two ctx objects sharing one root reproduce both call sites here.
function policyCtx(sharedRoot, guards) {
  const tools = {
    guard(guard) {
      guards.push(guard)
      return () => {}
    },
  }
  return {
    root: sharedRoot,
    get(name) {
      if (name === 'agentPresets') return { composedPreset: () => 'capital-generation' }
      if (name === 'tools') return tools
      return undefined
    },
    effect(callback) {
      const dispose = callback()
      return () => { if (typeof dispose === 'function') dispose() }
    },
    logger: { warn() {} },
  }
}

test('host policy 与旧调用点共享 root 时，监听器与全局 guard 各只装一份', () => {
  const listeners = []
  const guards = []
  const root = {
    on(event) {
      listeners.push(event)
      return () => {}
    },
  }
  const a = policyCtx(root, guards)
  const b = policyCtx(root, guards)

  for (const ctx of [a, b]) {
    registerRootToolPolicy(ctx)
    registerRoleToolPolicy(ctx)
    registerBashGuard(ctx)
    registerFsWriteGuard(ctx)
    registerRootOcrGuard(ctx)
    registerRoleSiblingGuard(ctx)
  }

  const created = listeners.filter((event) => event === 'agent/created').length
  const disposed = listeners.filter((event) => event === 'agent/disposed').length
  assert.equal(created, 3, 'root / role / bash 三套监听各一份；重复调用必须被 root 去重')
  // 2, not 3: the root-side agent/disposed listener retired with the `ocr` shape gate going global
  // (it freed a per-agent guard disposer). ⛔ only listeners holding per-agent resources may watch agent/disposed.
  assert.equal(disposed, 2, '只有 role（restrict disposer）与 bash（per-agent guard disposer）还留着按 agent 的资源')
  assert.equal(guards.length, 3, '三颗全局 guard（fs 写口 / ocr 形态 / 兄弟名字）各只装一次')
})

test('effect dispose 后同一 root 重新安装不被 WeakSet 吞掉', () => {
  const listeners = []
  const guards = []
  const root = {
    on(event) {
      listeners.push(event)
      return () => {}
    },
  }
  const disposers = []
  const makeCtx = () => {
    const ctx = policyCtx(root, guards)
    const effect = ctx.effect
    ctx.effect = (callback) => {
      const dispose = effect(callback)
      disposers.push(dispose)
      return dispose
    }
    return ctx
  }
  const install = () => {
    const ctx = makeCtx()
    registerRootToolPolicy(ctx)
    registerRoleToolPolicy(ctx)
    registerBashGuard(ctx)
    registerFsWriteGuard(ctx)
    registerRootOcrGuard(ctx)
    registerRoleSiblingGuard(ctx)
  }

  install()
  assert.equal(listeners.filter((event) => event === 'agent/created').length, 3)
  assert.equal(listeners.filter((event) => event === 'agent/disposed').length, 2)
  assert.equal(guards.length, 3)

  while (disposers.length > 0) disposers.pop()()
  install()
  assert.equal(listeners.filter((event) => event === 'agent/created').length, 6, '同一 root 重新装配后 created 监听必须重装')
  assert.equal(listeners.filter((event) => event === 'agent/disposed').length, 4, '同一 root 重新装配后 disposed 监听必须重装')
  assert.equal(guards.length, 6, '同一 root 重新装配后三颗全局 guard 必须重装')
})
