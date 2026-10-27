import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { DEFAULT_MAX_STEPS, DEFAULT_MAX_TOOL_CALLS } from '../automation/defaults.js'

/**
 * Executes the built automation client bundle in a minimal DOM sandbox. The browser-only apply
 * path is where `style.dataset[own-hyphenated-name]` once threw and left the whole web boot in
 * `loading`; a source-level assertion cannot see that class of failure.
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(ROOT, 'automation', 'client.js'), 'utf8')
const clientSource = readFileSync(join(ROOT, 'automation', 'client.src.cjs'), 'utf8')

function element() {
  const dataset = new Proxy({}, {
    set(target, property, value) {
      if (String(property).includes('-')) throw new SyntaxError(`invalid DOMStringMap property: ${String(property)}`)
      target[property] = value
      return true
    },
  })
  return {
    dataset,
    style: {},
    setAttribute() {},
    appendChild() {},
    remove() {},
  }
}

function loadBundle() {
  let entry
  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { entry = value } } },
    document: {
      createElement: () => element(),
      querySelector: () => null,
      head: { appendChild() {} },
    },
    console,
  }
  runInNewContext(source, sandbox)
  assert.ok(entry, 'bundle 必须调用 window.__ModuleLoader__.load 登记模块')
  return entry
}

function factoryRequire(name) {
  if (name === 'react') {
    return {
      createElement: () => ({}),
      useEffect() {},
      useState: (value) => [value, () => {}],
    }
  }
  if (name === '@deepseek-ai/dsh-client-ui-primitives') {
    const empty = () => null
    return { IconChecklistOutlineRegular: empty, Modal: empty, Switch: empty }
  }
  throw new Error(`客户端 bundle 不应在运行期 require("${name}")`)
}

test('客户端 bundle：apply 在真实 DOM 形状下不抛错，注册 main 与 sidebar.panellist', () => {
  const mod = loadBundle().factory(factoryRequire)
  assert.equal(mod.name, 'capital-automation')
  assert.deepEqual([...mod.inject], ['slots'])
  const registrations = []
  const logs = []
  assert.doesNotThrow(() => mod.apply({
    get: (name) => (name === 'uiWorkspace' ? { openSession() {} } : undefined),
    effect: (callback) => { callback(); return () => {} },
    slots: {
      inject: (slot, callback) => { assert.ok(['main', 'sidebar.panellist'].includes(slot)); return callback() },
      register: (declaration, component) => { registrations.push({ declaration, component }); return () => {} },
    },
    logger: { info: (message) => { logs.push(message) } },
  }))
  assert.deepEqual(registrations.map((item) => item.declaration.name), ['main', 'sidebar.panellist'])
  assert.equal(registrations[0].declaration.key, 'capital-automation')
  assert.equal(registrations[1].declaration.id, 'capital-automation')
  assert.ok(logs.length > 0)
  assert.equal(source.includes('dataset['), false, '样式键必须走 setAttribute，DOMStringMap 不接受带连字符的属性名')
  assert.doesNotMatch(source, /zh\.state\s*\)/, '状态字典对象不能直接作为 React child（error #31）')
  assert.doesNotMatch(source, /zh\.status\s*\)/, '状态字典对象不能直接作为 React child（error #31）')
  assert.match(source, /workspaceField/, '任务详情必须能选择工作区')
  assert.match(source, /workspaceId:/, '工作区 id 必须进入任务请求')
  assert.match(source, /modeHint:/, '输出侧重需要说明它不改变 preset')
  assert.match(source, /presetValue:/, '页面必须显示固定的 Agent preset')
  assert.match(source, /budgetHint:/, '页面必须说明预算覆盖子 Agent 与 PTC 派发')
  assert.match(
    clientSource,
    new RegExp(`maxSteps: ${DEFAULT_MAX_STEPS}, maxToolCalls: ${DEFAULT_MAX_TOOL_CALLS}`),
    '新建任务向导的默认预算必须跟 defaults.js 一致',
  )
  assert.doesNotMatch(clientSource, /if \(selectedId === null && nextTasks\.tasks\.length > 0\) setSelectedId/, '轮询不能捕获初始 selectedId 并强制跳回首项')
  assert.match(clientSource, /const selectedIdRef = useRef\(null\)/, '选中任务必须通过 ref 供轮询与异步回调读取最新值')
  assert.match(clientSource, /const refreshInFlightRef = useRef\(null\)/, '刷新请求必须单飞，避免慢请求叠加')
  assert.match(clientSource, /requestSequence !== refreshSequenceRef\.current/, '刷新结果必须做版本校验')
  assert.match(clientSource, /requestSequence !== detailSequenceRef\.current/, '详情结果必须做版本校验')
  assert.match(clientSource, /onChanged: async \(taskId\)/, '刷新回调必须携带被操作任务 id')
  assert.match(clientSource, /await onChanged\(detail\.task\.id\)/, '操作完成后只应由 act 统一刷新一次')
  assert.doesNotMatch(clientSource, /api\.run\(task\.id\); await onChanged\(\)/, '手动运行不能重复刷新')
  assert.doesNotMatch(clientSource, /api\.action\(task\.id, '(?:activate|pause|hibernate|copy)'\); await onChanged\(\)/, '任务动作不能重复刷新')
  assert.doesNotMatch(clientSource, /api\.cancel\(run\.id\); await onChanged\(\)/, '取消运行不能重复刷新')
  assert.match(clientSource, /typeof patch === 'function' \? patch\(current\) : patch/, '设置草稿更新必须基于最新 state 合并')
  assert.match(clientSource, /AbortController/, 'API 请求必须有可取消的超时边界')
  assert.match(clientSource, /20_000/, 'API 请求超时必须保持在有界值')
  assert.match(clientSource, /visibilityState !== 'hidden'/, '页面隐藏时不得继续轮询')
  assert.match(clientSource, /visibilitychange/, '页面恢复可见时应立即刷新')

})
