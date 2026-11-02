/**
 * Browser render runtime, kept as source text: the same bytes are inlined into standalone HTML
 * and re-packaged in the client bundle. Must contain no backtick or `${`, and must never fall
 * back to `globalThis.LightweightCharts` — another plugin's copy could silently win. The IIFE
 * returns `{ render, version }`; nothing is attached to globals.
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

  // Hex colors receive alpha; other formats convert to rgba or stay unchanged, never emit invalid CSS.
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

  // First series uses brand color; later series use a stable palette so one symbol keeps its color.
  var PALETTE = ['#f59e0b', '#10b981', '#8b5cf6', '#0ea5e9', '#ec4899']

  function readToken(name) {
    try {
      var value = getComputedStyle(document.documentElement).getPropertyValue(name)
      if (value && value.trim().length > 0) return value.trim()
    } catch (error) {
      /* Non-browser or unavailable styles fall back to defaults. */
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
    // Replace both tick and crosshair formatters for category axes or synthetic dates leak through.
    chart.applyOptions({
      localization: { timeFormatter: format },
      timeScale: { tickMarkFormatter: function (time) { return format(time) } }
    })
  }

  var CHART_TIME_ZONE = 'Asia/Shanghai'
  var CHART_DAY_SECONDS = 86400
  var CHART_LOCAL_MIDNIGHT_UTC = 57600

  function pad2(value) {
    var text = String(value)
    return text.length < 2 ? '0' + text : text
  }

  function timeLabel(time) {
    if (typeof time === 'string') return time
    if (time && typeof time === 'object') {
      var year = time.year
      var month = time.month
      var day = time.day
      if (year !== undefined && month !== undefined && day !== undefined) {
        return String(year) + '-' + pad2(month) + '-' + pad2(day)
      }
    }
    return String(time)
  }

  function collectNumericTimes(payload) {
    var times = []
    function add(list) {
      if (!Array.isArray(list)) return
      for (var i = 0; i < list.length; i += 1) {
        var point = list[i]
        if (point && typeof point.time === 'number' && isFinite(point.time)) times.push(point.time)
      }
    }
    if (payload.ohlc) add(payload.ohlc.data)
    if (Array.isArray(payload.series)) {
      for (var i = 0; i < payload.series.length; i += 1) add(payload.series[i] && payload.series[i].data)
    }
    if (payload.volume) add(payload.volume.data)
    return times
  }

  // Numeric epochs are true instants; render them in Asia/Shanghai. Business-day strings keep
  // their own labels, so no formatter is applied when every point is a date string.
  function makeTimeAxisFormatter(payload) {
    var times = collectNumericTimes(payload)
    if (times.length === 0) return null
    var min = times[0]
    var max = times[0]
    var daily = true
    for (var i = 0; i < times.length; i += 1) {
      if (times[i] < min) min = times[i]
      if (times[i] > max) max = times[i]
      var mod = ((times[i] % CHART_DAY_SECONDS) + CHART_DAY_SECONDS) % CHART_DAY_SECONDS
      if (mod !== 0 && mod !== CHART_LOCAL_MIDNIGHT_UTC) daily = false
    }
    var span = max - min
    var formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: CHART_TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    })
    function parts(seconds) {
      var values = formatter.formatToParts(new Date(seconds * 1000))
      var out = {}
      for (var j = 0; j < values.length; j += 1) out[values[j].type] = values[j].value
      return out
    }
    function tick(time) {
      if (typeof time !== 'number') return timeLabel(time)
      var p = parts(time)
      if (daily) {
        if (span > 3 * 365 * CHART_DAY_SECONDS) return p.year
        if (span > 120 * CHART_DAY_SECONDS) return p.year + '-' + p.month
        return p.month + '-' + p.day
      }
      if (span > 2 * CHART_DAY_SECONDS) return p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute
      return p.hour + ':' + p.minute
    }
    function full(time) {
      if (typeof time !== 'number') return timeLabel(time)
      var p = parts(time)
      return daily
        ? p.year + '-' + p.month + '-' + p.day
        : p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute
    }
    return { tick: tick, full: full }
  }

  /** Support both v5 plugin markers and the older series API so markers never disappear silently. */
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
    // Use the injected library; never fall back to a global copy owned by another plugin.
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
      // attributionLogo stays enabled for Apache-2.0 attribution.
      layout: { background: { color: 'transparent' }, textColor: colors.text, fontFamily: 'inherit', attributionLogo: true },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.grid, entireTextOnly: true },
      timeScale: { borderColor: colors.grid, rightOffset: 2, barSpacing: 6, minBarSpacing: 0.5 },
      crosshair: { mode: LWC.CrosshairMode ? LWC.CrosshairMode.Normal : 0 },
      localization: { locale: 'zh-CN' }
    })

    if (payload.axis === 'index' && payload.labels) applyIndexLabels(chart, payload.labels)
    if (payload.axis === 'time') {
      var timeAxis = makeTimeAxisFormatter(payload)
      if (timeAxis) {
        chart.applyOptions({
          localization: { timeFormatter: timeAxis.full },
          timeScale: { tickMarkFormatter: timeAxis.tick }
        })
      }
    }

    var anchor = null

    if (payload.ohlc && Array.isArray(payload.ohlc.data) && payload.ohlc.data.length > 0) {
      // kind=bar uses BarSeries; other OHLC kinds use CandlestickSeries with the same data contract.
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
          // Single-value histograms need HistogramSeries; BarSeries would render an empty chart.
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

    // Main/volume panes use a 3:1 ratio; a single pane has no second pane object.
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
`
