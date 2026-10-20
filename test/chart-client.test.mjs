import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

/**
 * Executes the built client bundle (`chart-ui/client.js`) in a minimal DOM sandbox: it has no type
 * checking and runs in a browser, so the factory is exercised for real. Pins exports/registration,
 * inlined chart library, no page-global dependency, and zero chart-specific conversation
 * projections (turn-tail cards broke session cold-load; see src/chart/events.ts).
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLIENT_BUNDLE = join(ROOT, 'chart-ui', 'client.js')
const source = readFileSync(CLIENT_BUNDLE, 'utf8')

/** Minimal DOM sandbox: just enough for the chart library's module-init environment probe. */
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

/** Executes the bundle's registration format and returns the module entry it loaded. */
function loadBundle() {
  let entry
  const sandbox = domSandbox()
  sandbox.window.__ModuleLoader__ = { load: (value) => { entry = value } }
  runInNewContext(source, sandbox)
  assert.ok(entry, 'bundle 必须调用 window.__ModuleLoader__.load 登记模块')
  return entry
}

/** The factory's require only accepts the shell seed `react`; the chart library must be inlined. */
function factoryRequire(name) {
  if (name === 'react') {
    return {
      createElement: () => ({}), useEffect() {}, useRef: () => ({ current: null }), useState: (value) => [value, () => {}],
    }
  }
  throw new Error(`客户端 bundle 不应在运行期 require("${name}")：运行期依赖必须打进 bundle，shell 种子只有 react`)
}

test('客户端 bundle：登记 id 与包名一致，导出 apply / inject（不再需要 uiConversation）', () => {
  const entry = loadBundle()
  assert.equal(entry.id, '@v587d/capital-charts')
  assert.equal(typeof entry.factory, 'function')
  const mod = entry.factory(factoryRequire)
  assert.equal(mod.name, 'capital-charts')
  assert.deepEqual([...mod.inject], ['slots'], '只剩 toolview：图表呈现已交回官方交付通道')
  assert.equal(typeof mod.ChartView, 'function')
})

test('客户端 bundle：只注册 render_chart 工具明细卡片，不再有 turn-tail 卡片', () => {
  const mod = loadBundle().factory(factoryRequire)
  const registrations = []
  const logs = []
  mod.apply({
    slots: {
      inject: (slot, callback) => {
        assert.equal(slot, 'tool.call.toolview')
        return callback()
      },
      register: (declaration, component) => { registrations.push({ declaration, component }); return () => {} },
    },
    logger: { info: (message) => { logs.push(message) } },
  })

  assert.equal(registrations.length, 1, '只应注册 render_chart toolview')
  assert.equal(registrations[0].declaration.name, 'tool.call.toolview')
  assert.equal(registrations[0].declaration.key, 'render_chart', 'render_chart key 必须是工具名')
  assert.equal(typeof registrations[0].component, 'function')
  assert.ok(logs.length > 0, 'apply 应留下挂载日志')
  // The report path must stay entirely gone: no report view, no /capital-reports fetch.
  assert.equal(typeof mod.ReportView, 'undefined', 'final_report 视图应已删除')
  assert.equal(source.includes('capital-reports'), false, '客户端不应再引用报告旁路')
  assert.equal(source.includes('final_report'), false, '客户端不应再引用 final_report')
})

/**
 * Regression pin: an embedded card writes non-first-party events into the session log, which made
 * the whole session fail to cold-load. Presentation goes through official delivery + document preview.
 */
test('客户端 bundle：不得再出现图表专属会话投影或 turn-tail 抢占', () => {
  assert.equal(source.includes('capital/chart-rendered'), false, '不得再引用已废弃的自定义事件类型')
  assert.equal(source.includes('conversation.chat.turnTail'), false, '不得再抢占 turn-tail 座位（那是官方交付行的座位）')
  assert.equal(source.includes('uiConversation'), false, '不得再注册任何 conversation 投影')
  assert.equal(source.includes('capital-turn-charts'), false, '旧的 turn 图表数据键不得残留')
  assert.equal(/turnChartsDefinition|selectTurnCharts|TurnChartsView|ChartCard/.test(source), false, '卡片通道的代码不得残留')
})

test('客户端 bundle：图表库内联、react external、不依赖页面全局', () => {
  assert.equal(/require\(["']lightweight-charts["']\)/.test(source), false, '图表库必须打进 bundle，不能运行期 require')
  assert.ok(source.includes('createChart'), 'bundle 应含内联的 lightweight-charts 实现')
  assert.match(source, /require\(["']react["']\)/, 'react 必须保持 external（shell 静态种子）')
  assert.equal(/globalThis\.LightweightCharts|window\.LightweightCharts/.test(source), false,
    '不得依赖页面全局 LightweightCharts：那是与其它插件互相覆盖的来源')
  assert.equal(source.includes('dangerouslySetInnerHTML'), false, '报告文本必须走 React text node，不得注入 HTML')
})
