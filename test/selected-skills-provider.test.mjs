import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerRootSelectedSkills, SELECTED_SKILL_CATALOG } from '../lib/agents/selected-skills-provider.js'

function candidate(name) {
  return { name, description: name, invocation: { modelInvocable: true, userInvocable: true }, source: 'custom', provider: 'source', rank: 1, locator: name }
}

function makeHarness() {
  const listeners = new Map()
  let rootCleanup
  let provider
  let providerRegistrationCount = 0
  let providerUnregisterCount = 0
  let providerDisposeCount = 0
  let providerConfig
  const root = {
    on(event, listener) {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
  }
  const ctx = {
    root,
    get(name) {
      if (name === 'agentPresets') return { composedPreset: (agentCtx) => agentCtx?.preset }
      return undefined
    },
    effect(callback) { rootCleanup = callback() },
    logger: { warn() {} },
  }
  function makeAgent({ preset = 'capital-generation', parentSession } = {}) {
    const skills = {
      registerProvider(create) {
        providerRegistrationCount += 1
        provider = create({ signal: new AbortController().signal })
        return () => { providerUnregisterCount += 1 }
      },
    }
    const agentCtx = {
      preset,
      effect(callback) { agentCtx.cleanup = callback() },
      inject(_deps, callback) {
        callback(Object.create(agentCtx, { skills: { value: skills, enumerable: true } }))
      },
    }
    Object.defineProperty(agentCtx, 'skills', {
      configurable: true,
      get() { throw new Error('cannot get property "skills" without inject') },
    })
    return {
      agent: { session: { id: 'session', header: { parentSession } }, ctx: agentCtx },
      agentCtx,
    }
  }
  const createFilesystemProvider = (_ctx, _control, config) => {
    providerConfig = config
    return {
      name: config.providerName,
      async list() { return [candidate('buffett-investment-framework'), candidate('financial-health')] },
      async get(value) { return { ...value, content: 'loaded' } },
      async dispose() { providerDisposeCount += 1 },
    }
  }
  return {
    ctx,
    listeners,
    makeAgent,
    createFilesystemProvider,
    disposeRoot() { rootCleanup?.() },
    get provider() { return provider },
    get providerRegistrationCount() { return providerRegistrationCount },
    get providerUnregisterCount() { return providerUnregisterCount },
    get providerDisposeCount() { return providerDisposeCount },
    get providerConfig() { return providerConfig },
  }
}

test('selected skill provider: disabled by default and limited to the approved catalog', () => {
  assert.deepEqual(SELECTED_SKILL_CATALOG.map(({ name }) => name), [
    'buffett-investment-framework',
    'financial-health',
    'risk-warning-catalysts',
    'valuation-investment-strategy',
    'strategy-business-transition',
    'industry-competition-moat',
    'business-decomposition-order-quality',
  ])
  assert.ok(SELECTED_SKILL_CATALOG.every(({ status, tags }) => ['experimental', 'watchlist'].includes(status) && tags.length > 0))
  const harness = makeHarness()
  registerRootSelectedSkills(harness.ctx, { buffettFramework: false }, harness.createFilesystemProvider)
  assert.equal(harness.listeners.size, 0, 'all-false config must not attach an Agent listener')
})

test('selected skill provider: Capital root only, filtered catalog, scope cleanup', async () => {
  const harness = makeHarness()
  registerRootSelectedSkills(harness.ctx, { buffettFramework: true }, harness.createFilesystemProvider)
  const created = harness.listeners.get('agent/created')
  assert.equal(typeof created, 'function')

  const child = harness.makeAgent({ parentSession: 'parent-session' })
  created({ agent: child.agent })
  assert.equal(harness.providerRegistrationCount, 0, 'child Agent must not receive a provider')

  const otherPreset = harness.makeAgent({ preset: 'other-preset' })
  created({ agent: otherPreset.agent })
  assert.equal(harness.providerRegistrationCount, 0, 'other presets must not receive a provider')

  const root = harness.makeAgent()
  created({ agent: root.agent })
  assert.equal(harness.providerRegistrationCount, 1)
  assert.equal(harness.providerConfig.includeDefaultRoots, false)
  assert.deepEqual(harness.providerConfig.customSkillDirs.length, 2)
  assert.equal(harness.providerConfig.providerName, 'capital-selected-skills')
  assert.deepEqual((await harness.provider.list({})).map(({ name }) => name), ['buffett-investment-framework'])
  assert.equal((await harness.provider.get(candidate('buffett-investment-framework'), {})).content, 'loaded')
   assert.throws(
     () => harness.provider.get(candidate('financial-health'), {}),
     /not enabled/,
     '未选中的 skill 不得通过 get 绕过 catalog 过滤',
   )

  root.agentCtx.cleanup?.()
  assert.equal(harness.providerUnregisterCount, 1)
  assert.equal(harness.providerDisposeCount, 1, 'agent scope teardown must stop the filesystem watcher')
  harness.disposeRoot()
  assert.equal(harness.listeners.size, 0, 'plugin teardown must detach the root Agent listener')
})

test('selected skill provider: dynamic selection is read for each newly created root Agent', () => {
  const harness = makeHarness()
  let selection = { buffettFramework: false }
  registerRootSelectedSkills(harness.ctx, () => selection, harness.createFilesystemProvider)
  const created = harness.listeners.get('agent/created')
  assert.equal(typeof created, 'function')

  const beforeToggle = harness.makeAgent()
  created({ agent: beforeToggle.agent })
  assert.equal(harness.providerRegistrationCount, 0, '关闭时不注册 provider')

  selection = { buffettFramework: true }
  const afterToggle = harness.makeAgent()
  created({ agent: afterToggle.agent })
  assert.equal(harness.providerRegistrationCount, 1, '新 root Agent 必须读取最新开关')
})
