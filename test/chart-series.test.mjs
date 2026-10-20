import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildChartPayload, extractRows, parseTimeValue, MAX_CHART_POINTS } from '../lib/chart/series.js'
import { normalizeChartSpec } from '../lib/chart/spec.js'

/**
 * Series building, pinned on properties that would mislead users if broken: deterministic time
 * parsing, strictly ascending unique axis, shared time set after downsampling, markers that
 * survive downsampling, and numeric handling consistent with Dataset.
 */

const meta = { source_kind: 'dataset', dataset_id: 'ds_1', source_label: '同花顺 日线', captured_at: 1_700_000_000_000 }

function build(rows, rawSpec) {
  return buildChartPayload({ chart_id: 'ch_test', spec: normalizeChartSpec(rawSpec), rows, meta })
}

test('parseTimeValue：口径确定（业务日字符串 / epoch 秒 / epoch 毫秒 / 无时区按 UTC）', () => {
  assert.deepEqual(parseTimeValue('2025-01-02'), { display: '2025-01-02', seconds: 1735776000, dateOnly: true })
  assert.equal(parseTimeValue(1735776000).seconds, 1735776000)
  assert.equal(parseTimeValue(1735776000000).seconds, 1735776000)
  assert.equal(parseTimeValue('1735776000000').seconds, 1735776000)
  assert.equal(parseTimeValue('2025-01-02T08:00:00Z').seconds, 1735804800)
  // A timezone-less datetime is read as UTC so the same data yields the same axis on every machine.
  assert.equal(parseTimeValue('2025-01-02 08:00:00').seconds, 1735804800)
  assert.equal(parseTimeValue('2025-02-30'), undefined, '不存在的日历日必须被拒绝')
  assert.equal(parseTimeValue('not a date'), undefined)
  assert.equal(parseTimeValue(null), undefined)
})

test('extractRows：顶层数组直接用；envelope 找到行数组；多候选时点名让人选', () => {
  assert.deepEqual(extractRows([{ a: 1 }]).rows, [{ a: 1 }])
  assert.deepEqual(extractRows({ code: 0, item: [{ a: 1 }] }).rows, [{ a: 1 }])
  // Known envelope keys win in candidate order when both item and data appear, never guessed.
  assert.deepEqual(extractRows({ item: [{ a: 1 }], data: [{ b: 2 }] }).rows, [{ a: 1 }])
  // A single non-candidate array key is accepted (user JSON is often named stock_items).
  assert.deepEqual(extractRows({ other: 1, stock_items: [{ a: 1 }] }).rows, [{ a: 1 }])
  // Ambiguity is an error rather than silently charting the wrong rows.
  assert.throws(
    () => extractRows({ alpha: [{ a: 1 }], beta: [{ b: 2 }] }),
    (error) => error.code === 'chart_source_invalid' && /several candidate row arrays/.test(error.message),
  )
  assert.throws(() => extractRows({ code: 0 }), (error) => error.code === 'chart_no_rows')
})

test('buildChartPayload：时间轴按升序唯一，并如实披露重排与去重', () => {
  const payload = build([
    { date: '2025-01-03', close: 3 },
    { date: '2025-01-01', close: 1 },
    { date: '2025-01-01', close: 11 },
    { date: '2025-01-02', close: 2 },
  ], { kind: 'line', x: 'date', series: ['close'] })

  assert.equal(payload.axis, 'time')
  assert.deepEqual(payload.series[0].data.map((point) => point.time), ['2025-01-01', '2025-01-02', '2025-01-03'])
  assert.equal(payload.series[0].data[0].value, 11, '同一时间戳保留后出现的那一行')
  assert.equal(payload.meta.points, 3)
  assert.ok(payload.meta.warnings.some((warning) => /reordered/.test(warning)))
  assert.ok(payload.meta.warnings.some((warning) => /duplicate/.test(warning)))
})

test('buildChartPayload：x 不是时间时自动降级为分类轴，并用 x 取值做刻度', () => {
  const payload = build([
    { sector: '白酒', revenue: 100 },
    { sector: '银行', revenue: 200 },
  ], { kind: 'column', x: 'sector', series: ['revenue'] })

  assert.equal(payload.axis, 'index')
  const labels = Object.values(payload.labels)
  assert.deepEqual(labels, ['白酒', '银行'])
})

test('buildChartPayload：时间轴判定看全量数据，不被前置脏行误导', () => {
  const rows = [
    ...Array.from({ length: 21 }, (_value, index) => ({ date: `bad-${index}`, close: index })),
    ...Array.from({ length: 100 }, (_value, index) => ({
      date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
      close: index + 21,
    })),
  ]
  const payload = build(rows, { kind: 'line', x: 'date', series: ['close'] })
  assert.equal(payload.axis, 'time')
  assert.ok(payload.meta.warnings.some((warning) => /skipped/.test(warning)))
})

test('buildChartPayload：分类轴拒绝日期 range，但 marker time 可匹配原始分类标签', () => {
  assert.throws(
    () => build([
      { sector: '白酒', revenue: 100 },
      { sector: '银行', revenue: 200 },
    ], { kind: 'column', x: 'sector', series: ['revenue'], range: { from: '2025-01-01' } }),
    (error) => error.code === 'chart_spec_invalid' && /requires a time axis/.test(error.message),
  )
  const payload = build([
    { sector: '白酒', revenue: 100 },
    { sector: '银行', revenue: 200 },
  ], { kind: 'column', x: 'sector', series: ['revenue'], markers: [{ time: '银行', text: '重点行业' }] })
  assert.equal(payload.markers.length, 1)
  assert.equal(payload.markers[0].time, payload.series[0].data[1].time)
})

test('buildChartPayload：下采样后所有子序列共用同一组时间（否则副图会错位）', () => {
  const rows = Array.from({ length: 5000 }, (_value, index) => ({
    date: new Date(Date.UTC(2000, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
    close: 100 + Math.sin(index / 20) * 10,
    volume: 1000 + (index % 7),
  }))
  const payload = build(rows, { kind: 'candlestick', x: 'date', ohlc: { open: 'close', high: 'close', low: 'close', close: 'close' }, volume: 'volume' })

  assert.equal(payload.meta.points, MAX_CHART_POINTS)
  assert.equal(payload.meta.original_points, 5000)
  assert.equal(payload.meta.downsampled, true)
  assert.equal(payload.ohlc.data.length, MAX_CHART_POINTS)
  assert.deepEqual(
    payload.ohlc.data.map((point) => point.time),
    payload.volume.data.map((point) => point.time),
    '主图与成交量副图必须逐点对齐',
  )
})

test('buildChartPayload：标记点在下采样后吸附到保留的时间点，而不是消失', () => {
  const rows = Array.from({ length: 4000 }, (_value, index) => ({
    date: new Date(Date.UTC(2000, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
    close: 10 + (index % 13),
  }))
  const target = rows[1234].date
  const payload = build(rows, { kind: 'line', x: 'date', series: ['close'], markers: [{ time: target, text: '分红公告' }] })

  assert.equal(payload.markers.length, 1)
  assert.equal(payload.markers[0].text, '分红公告')
  const charted = new Set(payload.series[0].data.map((point) => point.time))
  assert.ok(charted.has(payload.markers[0].time), '吸附后的标记时间必须真实存在于数据里')
})

test('buildChartPayload：数值口径与 Dataset 一致（数字字符串兼容，空值丢弃并披露）', () => {
  const payload = build([
    { date: '2025-01-01', close: '12.5' },
    { date: '2025-01-02', close: null },
    { date: '2025-01-03', close: 13 },
  ], { kind: 'line', x: 'date', series: ['close'] })

  assert.deepEqual(payload.series[0].data.map((point) => point.value), [12.5, 13])
  assert.ok(payload.meta.warnings.some((warning) => /non-numeric or missing/.test(warning)))
})

test('buildChartPayload：字段不存在时把可用字段写进错误文本（模型据此一次改对）', () => {
  assert.throws(
    () => build([{ date: '2025-01-01', close: 1, volume: 2 }], { kind: 'line', x: 'date', series: ['close_price'] }),
    (error) => error.code === 'chart_field_not_found'
      && /close_price/.test(error.message)
      && /available fields: .*close/.test(error.message),
  )
})

test('buildChartPayload：range 过滤与空区间披露', () => {
  const rows = [
    { date: '2025-01-01', close: 1 },
    { date: '2025-06-01', close: 2 },
    { date: '2025-12-01', close: 3 },
  ]
  const payload = build(rows, { kind: 'line', x: 'date', series: ['close'], range: { from: '2025-05-01', to: '2025-07-01' } })
  assert.deepEqual(payload.series[0].data.map((point) => point.value), [2])
  assert.throws(() => build(rows, { kind: 'line', x: 'date', series: ['close'], range: { from: '2030-01-01' } }), /excludes every row/)
})

test('buildChartPayload：成交量按 A 股习惯标注涨跌方向', () => {
  const payload = build([
    { date: '2025-01-01', open: 10, close: 11, volume: 100 },
    { date: '2025-01-02', open: 11, close: 10, volume: 200 },
  ], { kind: 'candlestick', x: 'date', ohlc: { open: 'open', high: 'close', low: 'open', close: 'close' }, volume: 'volume' })

  assert.deepEqual(payload.volume.data.map((point) => point.direction), ['up', 'down'])
})

test('buildChartPayload：OHLC 不自洽时照画但必须披露（不静默把错柱子当行情）', () => {
  const payload = build([
    { date: '2025-01-01', open: 10, high: 12, low: 9, close: 11 },   // 正常
    { date: '2025-01-02', open: 10, high: 8, low: 12, close: 11 },   // high < low
    { date: '2025-01-03', open: 10, high: 12, low: 9, close: 20 },   // close 越界
  ], { kind: 'candlestick', x: 'date', ohlc: { open: 'open', high: 'high', low: 'low', close: 'close' } })

  assert.equal(payload.ohlc.data.length, 3, '脏数据不拦截：用户仍要看到图')
  const warning = payload.meta.warnings.find((item) => /OHLC 不自洽/.test(item))
  assert.ok(warning, '必须有一条不自洽披露')
  assert.match(warning, /2 根/)
  assert.match(warning, /2025-01-02/)
})

test('buildChartPayload：OHLC 图形不接受分类数据，并把模型引向 column', () => {
  // bar and candlestick share OhlcData and need a real ordered time axis: error rather than a misaligned chart.
  assert.throws(
    () => build([
      { when: '第一期', open: 1, high: 2, low: 0.5, close: 1.5 },
      { when: '第二期', open: 2, high: 3, low: 1.5, close: 2.5 },
    ], { kind: 'bar', x: 'when', ohlc: { open: 'open', high: 'high', low: 'low', close: 'close' } }),
    (error) => error.code === 'chart_no_rows' && /kind=column/.test(error.message),
  )
  // Same data as a single-value column is valid and falls back to a category axis.
  const payload = build([
    { when: '第一期', value: 1 },
    { when: '第二期', value: 2 },
  ], { kind: 'column', x: 'when', series: ['value'] })
  assert.equal(payload.axis, 'index')
})
