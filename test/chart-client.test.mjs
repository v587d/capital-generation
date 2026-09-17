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
 *  - 断言它导出 apply / inject / name，且 `apply` 按工具名注册 toolview，并注册 turn-tail 最终交付视图；
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
  assert.deepEqual([...mod.inject], ['slots', 'uiConversation'])
  assert.equal(typeof mod.TurnChartsView, 'function')
})

test('客户端 bundle：注册 turn-tail 本轮图表，并保留 render_chart 工具明细卡片', () => {
  const mod = loadBundle().factory(factoryRequire)
  const registrations = []
  const definitions = []
  const logs = []
  mod.apply({
    uiConversation: { events: { register: (definition) => { definitions.push(definition) } } },
    slots: {
      inject: (slot, callback) => {
        assert.ok(slot === 'conversation.chat.turnTail' || slot === 'tool.call.toolview')
        return callback()
      },
      register: (declaration, component) => { registrations.push({ declaration, component }); return () => {} },
    },
    logger: { info: (message) => { logs.push(message) } },
  })

  assert.equal(definitions.length, 1, '必须注册一个 turn-scoped 图表 definition')
  assert.equal(definitions[0].kind, 'capital-turn-charts')
  assert.equal(registrations.length, 2, '必须注册 turn-tail + render_chart toolview（报告卡已删除）')
  assert.equal(registrations[0].declaration.name, 'conversation.chat.turnTail')
  assert.equal(typeof registrations[0].declaration.select, 'function')
  assert.equal(registrations[1].declaration.name, 'tool.call.toolview')
  assert.equal(registrations[1].declaration.key, 'render_chart', 'render_chart key 必须是工具名')
  assert.equal(typeof registrations[0].component, 'function')
  assert.equal(typeof registrations[1].component, 'function')
  assert.ok(logs.some((message) => /turn-tail/.test(message)), 'apply 应留下 turn-tail 挂载日志')
  // 报告链路必须彻底消失：没有 report 视图、没有 /capital-reports 取数。
  assert.equal(typeof mod.ReportView, 'undefined', 'final_report 视图应已删除')
  assert.equal(source.includes('capital-reports'), false, '客户端不应再引用报告旁路')
  assert.equal(source.includes('final_report'), false, '客户端不应再引用 final_report')
})

test('客户端 bundle：turn-tail 只选择本轮宿主登记的图表', () => {
  const mod = loadBundle().factory(factoryRequire)
  const definitions = []
  let tailRegistration
  mod.apply({
    uiConversation: { events: { register: (definition) => { definitions.push(definition) } } },
    slots: {
      inject: (_slot, callback) => callback(),
      register: (declaration, component) => {
        if (declaration.name === 'conversation.chat.turnTail') tailRegistration = declaration
        return { declaration, component }
      },
    },
  })
  const definition = definitions[0]
  const start = definition.start({}, { event: { type: 'turn/start', data: { turn: 7 } } })
  const afterChart = definition.update({ state: start }, {
    event: {
      type: 'capital/chart-rendered',
      seq: 12,
      data: {
        turn: 7,
        chart_id: 'ch_1',
        chart_ref: 'chart_1',
        title: '趋势',
        kind: 'line',
        axis: 'time',
        points: 43,
        chart_url: '/capital-charts/ch_1.json',
        html_path: 'capital-analysis/charts/ch_1/chart.html',
      },
    },
  })
  // 重复事件（重试）必须按 chart_id 去重
  const afterDuplicate = definition.update({ state: afterChart }, {
    event: {
      type: 'capital/chart-rendered',
      seq: 13,
      data: { turn: 7, chart_id: 'ch_1', title: '趋势', chart_url: '/capital-charts/ch_1.json', html_path: 'capital-analysis/charts/ch_1/chart.html' },
    },
  })
  assert.equal(afterDuplicate.charts.length, 1, '同一个 chart_id 只应登记一次')

  const locationData = definition.buildLocationData({ state: afterDuplicate }, 'turn')
  const turnData = (key) => (key === 'capital-turn-charts' ? locationData.value : undefined)
  const matched = tailRegistration.select({ seq: 20, turn: { data: { get: turnData } } })
  assert.equal(matched.charts.length, 1)
  assert.equal(matched.charts[0].chart_id, 'ch_1')
  assert.equal(matched.charts[0].chart_url, '/capital-charts/ch_1.json')

  // 未来的 turn 不得认领：DSH 的 conversation engine 不允许一个 context 先 update 再 start
  // （`received an update before its start Match`），宁可少一张卡片也不能让投影抛错。
  const future = definition.match({
    type: 'capital/chart-rendered',
    seq: 30,
    data: { turn: 99, chart_id: 'ch_future', title: '未来', html_path: 'x' },
  })
  assert.equal(future, null, '未开始的 turn 不得认领')

  // 收尾 assistant 早于图表事件时不得渲染（seq 过滤），避免把后一轮的图挂到前一轮。
  assert.equal(tailRegistration.select({ seq: 11, turn: { data: { get: turnData } } }), null)
  // 没有图表的 turn 必须返回 null，否则会顶掉官方 deliverables 行（chain 是"第一个非 null 胜出"）。
  assert.equal(tailRegistration.select({ seq: 20, turn: { data: { get: () => undefined } } }), null)
  const empty = definition.start({}, { event: { type: 'turn/start', data: { turn: 8 } } })
  const emptyData = definition.buildLocationData({ state: empty }, 'turn')
  assert.equal(tailRegistration.select({ seq: 21, turn: { data: { get: (key) => (key === 'capital-turn-charts' ? emptyData.value : undefined) } } }), null)
})

test('客户端 bundle：图表库内联、react external、不依赖页面全局', () => {
  assert.equal(/require\(["']lightweight-charts["']\)/.test(source), false, '图表库必须打进 bundle，不能运行期 require')
  assert.ok(source.includes('createChart'), 'bundle 应含内联的 lightweight-charts 实现')
  assert.match(source, /require\(["']react["']\)/, 'react 必须保持 external（shell 静态种子）')
  assert.equal(/globalThis\.LightweightCharts|window\.LightweightCharts/.test(source), false,
    '不得依赖页面全局 LightweightCharts：那是与其它插件互相覆盖的来源')
  assert.equal(source.includes('dangerouslySetInnerHTML'), false, '报告文本必须走 React text node，不得注入 HTML')
})
