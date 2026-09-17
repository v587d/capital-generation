import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadVendoredChartLibrary } from '../lib/chart/html.js'
import { CHART_RUNTIME_SOURCE } from '../lib/chart/runtime.js'

/**
 * 浏览器运行时的契约测试。
 *
 * 这段代码在浏览器里跑，平时拿不到类型检查，所以用两层测试把它钉住：
 *  1. **装上真实的 vendored 库**（headless + 最小 DOM stub 能加载），断言运行时用到的
 *     每一个导出名都还在。上游 v5→v6 改名会在这里失败，而不是在用户屏幕上白屏。
 *  2. 把运行时对着一个 spy 版图表 API 跑一遍，断言调用序列：pane 分配、A 股涨红跌绿、
 *     标记点走 createSeriesMarkers、分类轴刻度被替换。
 *
 * 这个文件会读改 globalThis（window/document/LightweightCharts）——node --test 每个文件
 * 独立进程，不会污染其它测试。
 */

// ── 1. 与 vendored 库的接口契约 ───────────────────────────────────────────────
globalThis.window = globalThis
globalThis.document = {
  createElement: () => ({ style: {}, getContext: () => null, setAttribute() {}, appendChild() {} }),
  documentElement: { style: {} },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.devicePixelRatio = 1
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

test('vendored lightweight-charts 可加载，且运行时依赖的导出名都还在', () => {
  const library = loadVendoredChartLibrary()
  ;(0, eval)(library.source)
  const LWC = globalThis.LightweightCharts
  assert.ok(LWC, 'standalone 构建必须挂出 globalThis.LightweightCharts')
  for (const name of ['createChart', 'LineSeries', 'AreaSeries', 'BarSeries', 'CandlestickSeries', 'HistogramSeries', 'CrosshairMode']) {
    assert.ok(LWC[name] !== undefined, `运行时依赖 ${name}，vendored 版本里没有了 —— 升级 lightweight-charts 时必须同步改 src/chart/runtime.ts`)
  }
  // v5 把 markers 挪到了 createSeriesMarkers；运行时对两种形状都兼容，但至少要有一个。
  assert.ok(
    typeof LWC.createSeriesMarkers === 'function',
    'v5 起 markers 由 createSeriesMarkers 提供；若上游再次改动，必须更新 runtime 的 attachMarkers',
  )
  assert.match(library.version, /^5\./, `版本已不是 5.x（当前 ${library.version}）：先读 v6 迁移说明再改运行时`)
  assert.equal(library.license, 'Apache-2.0')
  delete globalThis.LightweightCharts
})

// ── 2. 渲染调用序列 ──────────────────────────────────────────────────────────
const TOKENS = {
  '--dsw-alias-state-error-primary': 'rgb(217, 74, 61)',
  '--dsw-alias-state-success-primary': 'rgb(47, 158, 68)',
  '--dsw-alias-brand-primary': 'rgb(37, 99, 235)',
}
globalThis.getComputedStyle = () => ({ getPropertyValue: (name) => TOKENS[name] ?? '' })

function makeContainer() {
  return {
    textContent: '',
    attrs: {},
    children: [],
    setAttribute(key, value) { this.attrs[key] = value },
    appendChild(child) { this.children.push(child) },
  }
}

function makeChartStub() {
  const calls = { series: [], markers: [], applied: [], stretch: [], fitted: false, chartOptions: undefined }
  const LWC = {
    CrosshairMode: { Normal: 0 },
    LineSeries: { kind: 'line' },
    AreaSeries: { kind: 'area' },
    BarSeries: { kind: 'bar' },
    CandlestickSeries: { kind: 'candle' },
    HistogramSeries: { kind: 'hist' },
    createSeriesMarkers(series, markers) { calls.markers.push({ series, markers }); return { setMarkers() {} } },
    createChart(container, options) {
      calls.chartOptions = options
      return {
        addSeries(definition, seriesOptions, paneIndex) {
          const series = {
            kind: definition.kind,
            options: seriesOptions,
            paneIndex,
            data: undefined,
            setData(data) { this.data = data },
          }
          calls.series.push(series)
          return series
        },
        applyOptions(options) { calls.applied.push(options) },
        panes() { return [
          { setStretchFactor(factor) { calls.stretch.push(factor) } },
          { setStretchFactor(factor) { calls.stretch.push(factor) } },
        ] },
        timeScale() { return { fitContent() { calls.fitted = true } } },
      }
    },
  }
  return { calls, LWC }
}

function render(payload) {
  const { calls, LWC } = makeChartStub()
  const __capitalChart = (0, eval)(CHART_RUNTIME_SOURCE)
  const container = makeContainer()
  const chart = __capitalChart.render(container, payload, LWC)
  return { calls, container, chart }
}

const CANDLE_PAYLOAD = {
  chart_id: 'ch_1',
  title: '日线',
  kind: 'candlestick',
  axis: 'time',
  series: [],
  ohlc: { label: 'OHLC', data: [{ time: '2025-01-01', open: 10, high: 12, low: 9, close: 11 }] },
  volume: { label: '成交量', data: [{ time: '2025-01-01', value: 100, direction: 'up' }] },
  markers: [{ time: '2025-01-01', text: '分红', position: 'aboveBar' }],
  meta: { points: 1, original_points: 1, downsampled: false, axis: 'time', source_kind: 'dataset', skipped_rows: 0, warnings: [] },
}

test('runtime：K 线 + 成交量副图 + 标记点，调用序列正确', () => {
  const { calls, container } = render(CANDLE_PAYLOAD)

  assert.equal(calls.chartOptions.layout.attributionLogo, true, '归属 logo 必须保持开启（Apache-2.0 归属要求）')
  assert.equal(calls.series[0].kind, 'candle')
  assert.equal(calls.series[1].kind, 'hist')
  assert.equal(calls.series[1].paneIndex, 1, '成交量必须落在副图 pane 1')
  // A 股习惯：涨用红色（error 语义色），跌用绿色（success 语义色），且颜色来自主题变量。
  assert.equal(calls.series[0].options.upColor, 'rgb(217, 74, 61)')
  assert.equal(calls.series[0].options.downColor, 'rgb(47, 158, 68)')
  assert.equal(calls.series[1].data[0].color, 'rgb(217, 74, 61)')
  assert.equal(calls.markers.length, 1, '标记点必须经 createSeriesMarkers 挂上')
  assert.equal(calls.markers[0].markers[0].text, '分红')
  assert.deepEqual(calls.stretch, [3, 1], '主图与副图高度比 3:1')
  assert.equal(calls.fitted, true, '渲染后必须 fitContent')
  assert.equal(container.attrs['data-chart-id'], 'ch_1')
})

test('runtime：分类轴的刻度与十字线文案都用原始标签替换', () => {
  const { calls } = render({
    chart_id: 'ch_2',
    title: '营收',
    kind: 'column',
    axis: 'index',
    series: [{ id: 'revenue', label: '营收', type: 'column', data: [{ time: 946684800, value: 100 }] }],
    markers: [],
    labels: { 946684800: '白酒' },
    meta: { points: 1, original_points: 1, downsampled: false, axis: 'index', source_kind: 'path', skipped_rows: 0, warnings: [] },
  })

  assert.equal(calls.series[0].kind, 'hist', '单值柱必须用 HistogramSeries（BarSeries 要 OhlcData，会画出空图）')
  const applied = calls.applied.find((options) => options.timeScale && options.timeScale.tickMarkFormatter)
  assert.ok(applied, '分类轴必须替换 timeScale.tickMarkFormatter（否则标尺显示合成日期）')
  assert.equal(applied.timeScale.tickMarkFormatter(946684800), '白酒')
  assert.equal(applied.localization.timeFormatter(946684800), '白酒')
})

test('runtime：kind=bar 用 BarSeries，kind=candlestick 用 CandlestickSeries（数据同形、样式不同）', () => {
  const ohlc = { label: 'OHLC', data: [{ time: '2025-01-01', open: 10, high: 12, low: 9, close: 11 }] }
  const meta = { points: 1, original_points: 1, downsampled: false, axis: 'time', source_kind: 'dataset', skipped_rows: 0, warnings: [] }

  const asBar = render({ chart_id: 'ch_bar', title: 't', kind: 'bar', axis: 'time', series: [], ohlc, markers: [], meta })
  assert.equal(asBar.calls.series[0].kind, 'bar')

  const asCandle = render({ chart_id: 'ch_candle', title: 't', kind: 'candlestick', axis: 'time', series: [], ohlc, markers: [], meta })
  assert.equal(asCandle.calls.series[0].kind, 'candle')
})

test('runtime：图表库缺失时给出可见错误，而不是静默空白', () => {
  const __capitalChart = (0, eval)(CHART_RUNTIME_SOURCE)
  const container = makeContainer()
  __capitalChart.render(container, CANDLE_PAYLOAD, undefined)
  assert.equal(container.children.length, 1, '必须渲染一个错误框')
  assert.match(container.children[0].textContent, /图表库未加载/)
})

test('runtime：库由调用方注入，渲染不依赖也不产生页面全局（Step 3 前提）', () => {
  delete globalThis.LightweightCharts
  const { calls } = render(CANDLE_PAYLOAD)
  assert.equal(globalThis.LightweightCharts, undefined, '运行时不得回退到或挂出页面全局')
  assert.equal(globalThis.__capitalChart, undefined, '运行时不得往全局挂载 __capitalChart（宿主自行捕获返回值）')
  assert.equal(calls.series[0].kind, 'candle', '仅靠注入的库即可完成渲染')
})

test('runtime：area 序列把 rgb 主题色转换为合法 rgba，而不是直接拼接 alpha', () => {
  const { calls } = render({
    chart_id: 'ch_area',
    title: '面积图',
    kind: 'area',
    axis: 'time',
    series: [{ id: 'close', label: '收盘', type: 'area', data: [{ time: '2025-01-01', value: 1 }] }],
    markers: [],
    meta: { points: 1, original_points: 1, downsampled: false, axis: 'time', source_kind: 'path', skipped_rows: 0, warnings: [] },
  })

  assert.equal(calls.series[0].options.topColor, 'rgba(37, 99, 235, 0.2)')
  assert.equal(calls.series[0].options.bottomColor, 'rgba(37, 99, 235, 0.02)')
})

test('runtime：多序列使用不同颜色，第一条用主题品牌色', () => {
  const { calls } = render({
    chart_id: 'ch_3',
    title: '对比',
    kind: 'line',
    axis: 'time',
    series: [
      { id: 'a', label: 'A', type: 'line', data: [{ time: '2025-01-01', value: 1 }] },
      { id: 'b', label: 'B', type: 'line', data: [{ time: '2025-01-01', value: 2 }] },
    ],
    markers: [],
    meta: { points: 1, original_points: 1, downsampled: false, axis: 'time', source_kind: 'dataset', skipped_rows: 0, warnings: [] },
  })

  assert.equal(calls.series.length, 2)
  assert.equal(calls.series[0].options.color, 'rgb(37, 99, 235)')
  assert.notEqual(calls.series[1].options.color, calls.series[0].options.color)
})
