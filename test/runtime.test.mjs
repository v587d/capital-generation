// Cross-preset instance identity: a hard precondition of the 0.2.1 migration (AGENTS.md §9.7).
// Each sub-agent mounts its own role preset, so this plugin's `apply()` runs several times per
// process. Getting sharing wrong breaks features silently, never loudly: per-instance chart-source
// tokens → render_chart always reports chart_source_expired; one shared hub → the 2nd mount throws
// `data source capability already registered: tencent_quote`. Asserted here is identity, not behaviour.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { capitalDatasetStore, capitalSharedRuntime, resetCapitalRuntime } from '../lib/runtime.js'

/** Fake ctx with a stable root. */
const fakeCtx = (root, { withServices = true } = {}) => ({
  root,
  get(name) {
    if (!withServices) return undefined
    if (name === 'fs') return { async readFile() { return '' }, async writeFile() {} }
    if (name === 'sandboxPolicy') return { async assertWritable() {} }
    return undefined
  },
})

test('同一个 root 上多次挂载必须拿到同一份出图凭证与产物登记', () => {
  resetCapitalRuntime()
  const root = {}
  const first = capitalSharedRuntime(fakeCtx(root))
  const second = capitalSharedRuntime(fakeCtx(root))

  for (const key of ['sourceTokens', 'artifacts']) {
    assert.equal(first[key], second[key], `第二次挂载重新构造了 ${key}——data_junior 签发的凭证，specialist 查不到`)
  }
})

test('不同 root 各拿一份（凭证不能跨会话根泄漏）', () => {
  resetCapitalRuntime()
  const a = capitalSharedRuntime(fakeCtx({}))
  const b = capitalSharedRuntime(fakeCtx({}))
  assert.notEqual(a.sourceTokens, b.sourceTokens, '缓存键没有按 root 区分，两个会话会共用同一张凭证表')
  assert.notEqual(a.artifacts, b.artifacts, '缓存键没有按 root 区分，两个会话会共用同一份产物登记')
})

test('root 交替挂载 A → B → A 仍复用 A 的实例', () => {
  resetCapitalRuntime()
  const aRoot = {}
  const bRoot = {}
  const a1 = capitalSharedRuntime(fakeCtx(aRoot))
  capitalSharedRuntime(fakeCtx(bRoot))
  const a2 = capitalSharedRuntime(fakeCtx(aRoot))
  assert.equal(a2.sourceTokens, a1.sourceTokens, '单槽缓存被 B 覆盖后，A 再挂载会重建凭证表')
  assert.equal(a2.artifacts, a1.artifacts, '单槽缓存被 B 覆盖后，A 再挂载会重建产物登记')
})

test('Dataset 存储必须每次挂载各一份（共享会撞能力注册表）', () => {
  resetCapitalRuntime()
  const root = {}
  assert.notEqual(capitalDatasetStore(fakeCtx(root)), capitalDatasetStore(fakeCtx(root)),
    'store 被共享了：hub 跟着共享即第二次挂载注册同名数据源直接失败，'
    + '而 capital-generation-scope 行的 isolate 名单本来就把它按 realm 隔离')
})

test('宿主服务未就绪时给出可用实例，失败留到调用期响亮', () => {
  resetCapitalRuntime()
  const root = {}
  // Services absent: fail loudly at the save step, never at assembly (a throw/undefined there poisons the process).
  const cold = capitalDatasetStore(fakeCtx(root, { withServices: false }))
  assert.ok(cold, '缺席时也要给出一个可用的 store')
  assert.ok(capitalDatasetStore(fakeCtx(root)), '就绪时同样给出实例')
})
