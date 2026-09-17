/**
 * 浏览器侧渲染运行时 —— 以**源码字符串**形式存在，而不是一个模块。
 *
 * 为什么是字符串：同一段渲染代码有两个宿主，二者都不能 pre-built 共用同一份模块——
 *  1. **自包含 HTML 产物**（本步就有）：内联进 `<script>`，离线双击可开；
 *  2. **对话流内嵌视图**（Step 3）：DSH 客户端 bundle 里再包一次。
 * 写成字符串可以保证两边**逐字节同源**，不会出现"文件里对、页面上错"。
 * 代价是这里没有类型检查，所以 test/chart-runtime.test.mjs 会用 `new Function`
 * 做一次语法与 API 形状校验，把笔误挡在测试里而不是浏览器里。
 *
 * 约束：这段源码里**不能**出现反引号或 `${`（它本身在 TS 模板字符串里）。
 * 依赖：DOM，以及**由调用方传入**的图表库对象（自包含 HTML 传 UMD 全局，Step 3 客户端传
 * ESM import）。刻意不读、也不回退到 `globalThis.LightweightCharts`：那条全局正是与其它
 * 插件带的同库不同版本互相覆盖的来源（见内部设计文档 docs/design/chart-visualization.md §9 风险表）。
 * 形态：IIFE **返回** `{ render, version }`，由各宿主自行捕获（HTML 用 `var __capitalChart =`，
 * 客户端 bundle 存为模块局部），**不往任何全局挂载**。
 * 主题：只读 CSS 变量 `--dsw-*`（见 docs/reference/dsh-surface-ledger.md L7），
 * 不调 DSH 的 theme 服务；自包含 HTML 自己定义同一批变量，因此两边渲染完全一致。
 */
export const CHART_RUNTIME_SOURCE = `
(function () {
  'use strict'

  var FALLBACK = {
    '--dsw-alias-bg-base': '#ffffff',
    '--dsw-alias-border-l1': 'rgba(0, 0, 0, 0.10)',
    '--dsw-alias-label-primary': '#1f2328',
    '--dsw-alias-label-secondary': '#6b7280',
    '--dsw-alias-brand-primary': '#2563eb',
    '--dsw-alias-state-error-primary': '#d94a3d',
    '--dsw-alias-state-success-primary': '#2f9e44'
  }

  // 主题 token 不一定是十六进制（也可能是 rgb/rgba 或自定义 CSS 色值）。只有确认是
  // 十六进制时才追加 alpha；其余格式转换成 rgba，转换不了就退回原色，绝不拼出非法 CSS。
  function withAlpha(color, alpha) {
    var text = String(color || '').trim()
    var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
    if (hex) {
      var expanded = hex[1].length === 3
        ? '#' + hex[1].split('').map(function (part) { return part + part }).join('')
        : text
      return expanded + Math.round(alpha * 255).toString(16).padStart(2, '0')
    }
    var rgb = /^rgba?\\(\\s*([^)]*)\\)$/i.exec(text)
    if (rgb) {
      var parts = rgb[1].split(/[,\\s/]+/).filter(Boolean)
      if (parts.length >= 3 && parts.slice(0, 3).every(function (part) { return /^[-+]?\\d*\\.?\\d+%?$/.test(part) })) {
        return 'rgba(' + parts.slice(0, 3).join(', ') + ', ' + alpha + ')'
      }
    }
    return text
  }

  // 多序列配色：第一条用主题品牌色，其余用固定色板（保证同一条序列在不同图里颜色一致）。
  var PALETTE = ['#f59e0b', '#10b981', '#8b5cf6', '#0ea5e9', '#ec4899']

  function readToken(name) {
    try {
      var value = getComputedStyle(document.documentElement).getPropertyValue(name)
      if (value && value.trim().length > 0) return value.trim()
    } catch (error) {
      /* 非浏览器环境或取不到样式时退回默认色 */
    }
    return FALLBACK[name]
  }

  function resolveColors() {
    return {
      bg: readToken('--dsw-alias-bg-base'),
      grid: readToken('--dsw-alias-border-l1'),
      text: readToken('--dsw-alias-label-secondary'),
      strong: readToken('--dsw-alias-label-primary'),
      brand: readToken('--dsw-alias-brand-primary'),
      up: readToken('--dsw-alias-state-error-primary'),
      down: readToken('--dsw-alias-state-success-primary')
    }
  }

  function showError(container, message) {
    container.textContent = ''
    var box = document.createElement('div')
    box.setAttribute('data-chart-error', '1')
    box.style.cssText = 'padding:12px;border:0.5px solid ' + readToken('--dsw-alias-border-l1') + ';border-radius:8px;color:' + readToken('--dsw-alias-label-secondary') + ';font-size:13px;line-height:1.6'
    box.textContent = message
    container.appendChild(box)
  }

  function applyIndexLabels(chart, labels) {
    function format(time) {
      var key = String(time)
      return Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : key
    }
    // 轴的刻度文案归 timeScale.tickMarkFormatter 管，十字线/提示归 localization.timeFormatter；
    // 分类轴两边都要换掉，否则标尺上还是 2000 年那种合成日期。
    chart.applyOptions({
      localization: { timeFormatter: format },
      timeScale: { tickMarkFormatter: function (time) { return format(time) } }
    })
  }

  /**
   * 挂标记点。v5 把 markers 从 series API 移到了 createSeriesMarkers(series, markers)
   * 返回的插件对象上；这里同时兼容两种形状，上游再动一次也不会静默丢掉标记。
   */
  function attachMarkers(anchor, markers, LWC) {
    if (typeof LWC.createSeriesMarkers === 'function') {
      LWC.createSeriesMarkers(anchor, markers)
      return true
    }
    if (anchor && typeof anchor.setMarkers === 'function') {
      anchor.setMarkers(markers)
      return true
    }
    return false
  }

  function volumePointColor(point, colors) {
    if (point.direction === 'up') return colors.up
    if (point.direction === 'down') return colors.down
    return colors.brand
  }

  function seriesColor(index, colors) {
    return index === 0 ? colors.brand : PALETTE[(index - 1) % PALETTE.length]
  }

  function appendLegend(container, payload, colors) {
    var items = []
    if (payload.ohlc && payload.ohlc.label) items.push({ label: payload.ohlc.label, color: colors.up })
    if (Array.isArray(payload.series)) {
      payload.series.forEach(function (item, index) {
        if (item && item.label) items.push({ label: item.label, color: seriesColor(index, colors) })
      })
    }
    if (payload.volume && payload.volume.label) items.push({ label: payload.volume.label, color: colors.brand })
    if (items.length === 0) return

    var legend = document.createElement('div')
    legend.setAttribute('data-chart-legend', '1')
    legend.style.cssText = 'position:absolute;z-index:2;top:8px;left:8px;right:8px;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;pointer-events:none;color:' + colors.text + ';font-size:11px;line-height:16px'
    items.forEach(function (item) {
      var entry = document.createElement('span')
      entry.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:1px 5px;border-radius:4px;background:' + withAlpha(colors.bg, 0.8)
      var swatch = document.createElement('span')
      swatch.style.cssText = 'width:7px;height:7px;border-radius:50%;background:' + item.color + ';flex:none'
      var label = document.createElement('span')
      label.textContent = item.label
      entry.appendChild(swatch)
      entry.appendChild(label)
      legend.appendChild(entry)
    })
    container.appendChild(legend)
  }

  function renderCapitalChart(container, payload, library) {
    if (!container) throw new Error('renderCapitalChart: container is required')
    if (!payload || typeof payload !== 'object') throw new Error('renderCapitalChart: payload is required')
    // 图表库由调用方注入，绝不回退到页面全局：回退会让"另一个插件的同库版本"悄悄生效。
    var LWC = library
    if (!LWC || typeof LWC.createChart !== 'function') {
      showError(container, '图表库未加载（调用方未提供 LightweightCharts）。')
      return null
    }

    var colors = resolveColors()
    container.textContent = ''
    if (container.style) container.style.position = 'relative'
    container.setAttribute('data-chart-id', String(payload.chart_id || ''))
    container.setAttribute('data-chart-kind', String(payload.kind || ''))

    var chart = LWC.createChart(container, {
      autoSize: true,
      // attributionLogo 保持开启：这满足 Apache-2.0 归属要求（见 vendor/lightweight-charts/VERSION.json）。
      layout: { background: { color: 'transparent' }, textColor: colors.text, fontFamily: 'inherit', attributionLogo: true },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.grid, entireTextOnly: true },
      timeScale: { borderColor: colors.grid, rightOffset: 2, barSpacing: 6, minBarSpacing: 0.5 },
      crosshair: { mode: LWC.CrosshairMode ? LWC.CrosshairMode.Normal : 0 },
      localization: { locale: 'zh-CN' }
    })

    if (payload.axis === 'index' && payload.labels) applyIndexLabels(chart, payload.labels)

    var anchor = null

    if (payload.ohlc && Array.isArray(payload.ohlc.data) && payload.ohlc.data.length > 0) {
      // kind=bar 用 BarSeries（OHLC 柱），其余 OHLC 图形用 CandlestickSeries。
      // 两者的数据契约相同（都继承 OhlcData），区别只在渲染样式。
      var isOhlcBar = payload.kind === 'bar'
      var candles = chart.addSeries(isOhlcBar ? LWC.BarSeries : LWC.CandlestickSeries, {
        upColor: colors.up,
        downColor: colors.down,
        borderUpColor: colors.up,
        borderDownColor: colors.down,
        wickUpColor: colors.up,
        wickDownColor: colors.down
      })
      candles.setData(payload.ohlc.data)
      anchor = candles
    }

    if (Array.isArray(payload.series)) {
      for (var index = 0; index < payload.series.length; index += 1) {
        var item = payload.series[index]
        if (!item || !Array.isArray(item.data) || item.data.length === 0) continue
        var color = seriesColor(index, colors)
        var options = { title: item.label || '', priceLineVisible: false, lastValueVisible: true }
        var series = null
        if (item.type === 'area') {
          options.lineColor = color
          options.topColor = withAlpha(color, 0.2)
          options.bottomColor = withAlpha(color, 0.02)
          options.lineWidth = 2
          series = chart.addSeries(LWC.AreaSeries, options)
        } else if (item.type === 'column') {
          // 单值柱：HistogramSeries 吃 SingleValueData（{time, value}）。
          // 注意不能用 BarSeries —— 它要 OhlcData，塞单值只会画出空图。
          options.color = color
          options.base = 0
          series = chart.addSeries(LWC.HistogramSeries, options)
        } else {
          options.color = color
          options.lineWidth = 2
          series = chart.addSeries(LWC.LineSeries, options)
        }
        series.setData(item.data)
        if (anchor === null) anchor = series
      }
    }

    if (payload.volume && Array.isArray(payload.volume.data) && payload.volume.data.length > 0) {
      var volume = chart.addSeries(LWC.HistogramSeries, {
        title: payload.volume.label || '',
        priceFormat: { type: 'volume' },
        priceLineVisible: false,
        lastValueVisible: false
      }, 1)
      volume.setData(payload.volume.data.map(function (point) {
        return { time: point.time, value: point.value, color: volumePointColor(point, colors) }
      }))
    }

    if (anchor === null) {
      showError(container, '这张图没有可渲染的序列（payload 里既没有 ohlc 也没有 series）。')
      return chart
    }

    if (Array.isArray(payload.markers) && payload.markers.length > 0) {
      attachMarkers(anchor, payload.markers.map(function (marker) {
        return { time: marker.time, position: marker.position, text: marker.text, color: colors.strong, shape: 'circle' }
      }), LWC)
    }

    appendLegend(container, payload, colors)

    // 主图与成交量副图的高度比 3:1；只有一个 pane 时 panes()[1] 不存在。
    var panes = typeof chart.panes === 'function' ? chart.panes() : []
    if (panes.length > 1) {
      if (typeof panes[0].setStretchFactor === 'function') panes[0].setStretchFactor(3)
      if (typeof panes[1].setStretchFactor === 'function') panes[1].setStretchFactor(1)
    }

    chart.timeScale().fitContent()
    return chart
  }

  return { render: renderCapitalChart, version: 1 }
})()
`;
