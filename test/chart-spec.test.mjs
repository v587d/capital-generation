import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeChartSpec, MAX_CHART_SERIES } from '../lib/chart/spec.js'

/**
 * spec 归一化的契约测试。
 *
 * 重点不是"happy path 能用"，而是**模型最可能犯的几种表达**都能被正确理解或被
 * 可自愈地拒绝：JSON 字符串参数、别名键、枚举拼错、缺必填。错误信息必须点名
 * 可用取值，模型才能一次改对。
 */

test('normalizeChartSpec：最小 spec 即可用，缺 x 时是分类轴', () => {
  const spec = normalizeChartSpec({ kind: 'line', series: ['close'] })
  assert.equal(spec.kind, 'line')
  assert.equal(spec.axis, 'index')
  assert.equal(spec.timeField, undefined)
  assert.deepEqual(spec.series, [{ field: 'close', label: 'close', type: 'line' }])
  assert.deepEqual(spec.markers, [])
})

test('normalizeChartSpec：给了 x 就是时间轴', () => {
  const spec = normalizeChartSpec({ kind: 'area', x: 'trade_date', series: [{ field: 'close', label: '收盘', type: 'area' }] })
  assert.equal(spec.axis, 'time')
  assert.equal(spec.timeField, 'trade_date')
  assert.equal(spec.series[0].type, 'area')
})

test('normalizeChartSpec：容忍模型把对象/数组序列化成 JSON 字符串', () => {
  const spec = normalizeChartSpec({
    kind: 'line',
    x: 'date',
    series: '[{"field":"close","type":"line"}]',
    ohlc: null,
    markers: '{"time":"2025-01-02","text":"分红"}',
  })
  assert.equal(spec.series.length, 1)
  assert.equal(spec.series[0].field, 'close')
  assert.equal(spec.markers.length, 1)
  assert.equal(spec.markers[0].text, '分红')
})

test('normalizeChartSpec：整个 spec 可以是 JSON 字符串（模型常见传法）', () => {
  const spec = normalizeChartSpec('{"kind":"column","series":["revenue"]}')
  assert.equal(spec.kind, 'column')
  assert.equal(spec.series[0].field, 'revenue')
})

test('normalizeChartSpec：x 的别名 time / time_field 等价', () => {
  assert.equal(normalizeChartSpec({ kind: 'line', time: 'date', series: ['close'] }).timeField, 'date')
  assert.equal(normalizeChartSpec({ kind: 'line', time_field: 'date', series: ['close'] }).timeField, 'date')
})

test('normalizeChartSpec：kind 拼错时点名合法取值与单值柱的正确写法', () => {
  assert.throws(
    () => normalizeChartSpec({ kind: 'pie', series: ['close'] }),
    (error) => error.code === 'chart_spec_invalid' && /column/.test(error.message) && /candlestick/.test(error.message),
  )
})

test('normalizeChartSpec：kind 别名（histogram→column、candles→candlestick）不会硬失败', () => {
  assert.equal(normalizeChartSpec({ kind: 'histogram', series: ['volume'] }).kind, 'column')
  assert.equal(normalizeChartSpec({ kind: 'candles', x: 'd', ohlc: { open: 'o', high: 'h', low: 'l', close: 'c' } }).kind, 'candlestick')
  assert.equal(normalizeChartSpec({ kind: 'column', series: [{ field: 'v', type: 'histogram' }] }).series[0].type, 'column')
})

test('normalizeChartSpec：bar 是 OHLC 柱，单值柱必须报错并指向 column', () => {
  // 实测出来的坑：单值数据塞进 BarSeries（OhlcData）不会报错，只会画出一张空图。
  assert.throws(
    () => normalizeChartSpec({ kind: 'bar', x: 'd', series: ['revenue'] }),
    (error) => error.code === 'chart_spec_invalid' && /spec\.ohlc/.test(error.message),
  )
  const ok = normalizeChartSpec({ kind: 'bar', x: 'd', ohlc: { open: 'o', high: 'h', low: 'l', close: 'c' } })
  assert.equal(ok.kind, 'bar')
  assert.deepEqual(ok.ohlc, { open: 'o', high: 'h', low: 'l', close: 'c' })
})

test('normalizeChartSpec：非 OHLC 图形不接受 spec.ohlc（防止静默丢数据）', () => {
  assert.throws(
    () => normalizeChartSpec({ kind: 'line', x: 'd', ohlc: { open: 'o', high: 'h', low: 'l', close: 'c' }, series: ['c'] }),
    (error) => error.code === 'chart_spec_invalid' && /只用于 candlestick \/ bar/.test(error.message),
  )
})

test('normalizeChartSpec：序列 type 只能是单值图形', () => {
  assert.throws(
    () => normalizeChartSpec({ kind: 'line', series: [{ field: 'c', type: 'bar' }] }),
    (error) => error.code === 'chart_spec_invalid' && /单值字段/.test(error.message),
  )
})

test('normalizeChartSpec：candlestick 必须有 x 与 ohlc 四个字段', () => {
  assert.throws(
    () => normalizeChartSpec({ kind: 'candlestick', ohlc: { open: 'o', high: 'h', low: 'l', close: 'c' } }),
    (error) => error.code === 'chart_spec_invalid' && /requires spec\.x/.test(error.message),
  )
  assert.throws(
    () => normalizeChartSpec({ kind: 'candlestick', x: 'date', ohlc: { open: 'o', high: 'h', low: 'l' } }),
    (error) => error.code === 'chart_spec_invalid' && /spec\.ohlc\.close/.test(error.message),
  )
  const ok = normalizeChartSpec({ kind: 'candlestick', x: 'date', ohlc: { open: 'open', high: 'high', low: 'low', close: 'close' }, volume: 'vol' })
  assert.deepEqual(ok.ohlc, { open: 'open', high: 'high', low: 'low', close: 'close' })
  assert.deepEqual(ok.volume, { field: 'vol' })
})

test('normalizeChartSpec：序列数量与标记数量有上限', () => {
  const many = Array.from({ length: MAX_CHART_SERIES + 1 }, (_value, index) => `f${index}`)
  assert.throws(() => normalizeChartSpec({ kind: 'line', series: many }), /at most 6 entries/)
  assert.throws(() => normalizeChartSpec({ kind: 'line', series: ['close'], markers: [{ text: 'x' }] }), /needs a time .* or a 0-based index/)
})

test('normalizeChartSpec：range 与 title 归一化', () => {
  const spec = normalizeChartSpec({ kind: 'line', x: 'date', series: ['close'], range: { start: '2025-01-01', end: '2025-06-30' }, title: '  贵州茅台  ' })
  assert.deepEqual(spec.range, { from: '2025-01-01', to: '2025-06-30' })
  assert.equal(spec.title, '贵州茅台')
})

test('normalizeChartSpec：完全不是对象的 spec 会被可自愈地拒绝', () => {
  assert.throws(
    () => normalizeChartSpec('not json'),
    (error) => error.code === 'chart_spec_invalid' && /capital-chart-protocol/.test(error.message),
  )
})
