import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

/**
 * 客户端半边（`chart-ui/client.js`）的**真实执行**测试。
 *
 * 这个产物是构建出来的（scripts/build-client.mjs），在浏览器里跑、平时没有类型检查，
 * 所以这里把 bundle 放进一个最小 DOM 沙箱里真的执行一遍工厂函数：
 *  - 断言它导出 apply / inject / name，且 `apply` 按工具名 `render_chart` 注册 toolview；
 *  - 断言图表库是**内联**的（bundle 里没有 require("lightweight-charts")），
 *    且不依赖页面全局（设计 §9：避免与其它插件的同库不同版本互相覆盖）。
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLIENT_BUNDLE = join(ROOT, 'chart-ui', 'client.js')
const source = readFileSync(CLIENT_BUNDLE, 'utf8')

/** 最小 DOM 沙箱：足够让轻量图表库在模块初始化时探测环境，不做真实布局。 */
function domSandbox() {
  const element = () => ({
    style: {}, setAttribute() {}, appendChild() {}, remove() {},
    getContext: () => null, addEventListener() {}, removeEventListener() {},
  })
  return {
    window: {},
    document: {
      createElement: element,
      documentElement: { style: {} },
      querySelector: () => null,
      head: { appendChild() {} },
      addEventListener() {}, removeEventListener() {},
    },
    navigator: { userAgent: 'node' },
    console,
  }
}

/** 执行 bundle 的登记格式，返回它注册进模块表的条目。 */
function loadBundle() {
  let entry
  const sandbox = domSandbox()
  sandbox.window.__ModuleLoader__ = { load: (value) => { entry = value } }
  runInNewContext(source, sandbox)
  assert.ok(entry, 'bundle 必须调用 window.__ModuleLoader__.load 登记模块')
  return entry
}

/** 工厂函数的 require 只接受 shell 种子 `react`（图表库应已内联，不应再走 require）。 */
function factoryRequire(name) {
  if (name === 'react') {
    return {
      createElement: () => ({}), useEffect() {}, useRef: () => ({ current: null }), useState: (value) => [value, () => {}],
    }
  }
  throw new Error(`客户端 bundle 不应在运行期 require("${name}")：运行期依赖必须打进 bundle，shell 种子只有 react`)
}

test('客户端 bundle：登记 id 与包名一致，导出 apply / inject / name', () => {
  const entry = loadBundle()
  assert.equal(entry.id, '@v587d/capital-charts')
  assert.equal(typeof entry.factory, 'function')
  const mod = entry.factory(factoryRequire)
  assert.equal(mod.name, 'capital-charts')
  assert.deepEqual([...mod.inject], ['slots'])
  assert.equal(typeof mod.apply, 'function')
})

test('客户端 bundle：apply 按工具名 render_chart 注册 tool.call.toolview', () => {
  const mod = loadBundle().factory(factoryRequire)
  const registrations = []
  const logs = []
  mod.apply({
    slots: {
      inject: (slot, callback) => { assert.equal(slot, 'tool.call.toolview'); return callback() },
      register: (declaration, component) => { registrations.push({ declaration, component }); return () => {} },
    },
    logger: { info: (message) => { logs.push(message) } },
  })

  assert.equal(registrations.length, 1, '必须恰好注册一个 toolview')
  assert.equal(registrations[0].declaration.name, 'tool.call.toolview')
  assert.equal(registrations[0].declaration.key, 'render_chart', 'key 必须是工具名，否则卡片静默回退成通用工具行')
  assert.equal(typeof registrations[0].component, 'function')
  // 这行日志是 runbook 判断 bundle 是否真的到了浏览器的锚点。
  assert.ok(logs.some((message) => /capital-charts/.test(message)), 'apply 应留下可观测的挂载日志')
})

test('客户端 bundle：图表库内联、react external、不依赖页面全局', () => {
  assert.equal(/require\(["']lightweight-charts["']\)/.test(source), false, '图表库必须打进 bundle，不能运行期 require')
  assert.ok(source.includes('createChart'), 'bundle 应含内联的 lightweight-charts 实现')
  assert.match(source, /require\(["']react["']\)/, 'react 必须保持 external（shell 静态种子）')
  assert.equal(/globalThis\.LightweightCharts|window\.LightweightCharts/.test(source), false,
    '不得依赖页面全局 LightweightCharts：那是与其它插件互相覆盖的来源')
})
