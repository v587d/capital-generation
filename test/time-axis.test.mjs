import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isoDateFromEpoch,
  zoneDayStartMs,
  zoneDayEndMs,
  formatOffset,
  probeTimeAxis,
  readAxisDates,
  resolveAxisWindow,
  resolveDatasetTimeWindow,
  translateFilterDateValue,
  defaultAxisWindows,
} from '../lib/data-collector/time-axis.js'

/** Assertions use observed Shanghai-midnight epoch values; one millisecond must map to one date. */
const SHANGHAI_DAY = (date) => zoneDayStartMs(date, 'Asia/Shanghai')
/** Align an epoch to its Shanghai calendar midnight for direct window comparison. */
const SHANGHAI_MIDNIGHT_OF = (epoch) => zoneDayStartMs(isoDateFromEpoch(epoch, 'Asia/Shanghai'), 'Asia/Shanghai')

test('time-axis：epoch 与日历双向换算按列自身时区对齐', () => {
  assert.equal(isoDateFromEpoch(1695571200000, 'Asia/Shanghai'), '2023-09-25')
  assert.equal(isoDateFromEpoch(1790092800000, 'Asia/Shanghai'), '2026-09-23')
  // Reading the same epoch in UTC shifts it to the prior day; that is the common model error.
  assert.equal(isoDateFromEpoch(1695571200000, 'UTC'), '2023-09-24')
  assert.equal(SHANGHAI_DAY('2023-09-25'), 1695571200000)
  assert.equal(zoneDayEndMs('2026-09-23', 'Asia/Shanghai'), 1790092800000 + 86_400_000 - 1)
  assert.equal(formatOffset(8 * 3_600_000), '+08:00')
  assert.equal(formatOffset(-3.5 * 3_600_000), '-03:30')
})

test('time-axis：探针报告形态与观测偏移，推断不出就说 unknown 而不猜', () => {
  assert.deepEqual(probeTimeAxis('date_ms', [1695571200000, 1695657600000]), {
    column: 'date_ms',
    value_format: 'epoch_ms',
    time_zone: 'Asia/Shanghai',
    utc_offset: '+08:00',
    aligned_to: 'local_midnight',
  })
  assert.deepEqual(probeTimeAxis('trade_date', ['2024-09-30', '2024-10-08']), {
    column: 'trade_date',
    value_format: 'date_string',
    aligned_to: 'calendar_day',
  })
  // Second epochs remain reported accurately but are rejected as daily millisecond axes.
  const seconds = probeTimeAxis('ts', [1695571200, 1695657600])
  assert.equal(seconds.value_format, 'epoch_ms')
  assert.equal(seconds.aligned_to, 'unknown')
  assert.equal(probeTimeAxis('mixed', [1695571200000, '2023-09-25']).value_format, 'unknown')
  assert.equal(probeTimeAxis('empty', []).value_format, 'unknown')
})

test('time-axis：窗口解析把日历夹到真实存在的交易日，并给出可直接用的边界', () => {
  // 2026-09-23 is Wednesday; previous trading day skips the weekend to Friday 09-18.
  const rows = [
    { date_ms: SHANGHAI_DAY('2026-09-18'), close_price: 1258 },
    { date_ms: SHANGHAI_DAY('2026-09-21'), close_price: 1255 },
    { date_ms: SHANGHAI_DAY('2026-09-22'), close_price: 1253.8 },
    { date_ms: SHANGHAI_DAY('2026-09-23'), close_price: 1252.22 },
  ]
  const axis = probeTimeAxis('date_ms', rows.map((row) => row.date_ms))
  const dates = readAxisDates({ axis, rows })
  assert.deepEqual(dates, ['2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23'])

  const window = resolveAxisWindow({ axis, dates, period: 'last_3_days' })
  assert.deepEqual([window.start_date, window.end_date], ['2026-09-21', '2026-09-23'])
  assert.equal(window.value_ge, SHANGHAI_MIDNIGHT_OF(SHANGHAI_DAY('2026-09-21')))
  assert.equal(window.value_le, zoneDayEndMs('2026-09-23', 'Asia/Shanghai'))
  assert.deepEqual([window.data_from, window.data_to], ['2026-09-21', '2026-09-23'])

  // A seven-day window ending on a non-trading day still advances both bounds to real sessions.
  const anchored = resolveAxisWindow({ axis, dates, period: 'last_1_week', anchorDate: '2026-09-20' })
  assert.deepEqual([anchored.start_date, anchored.end_date], ['2026-09-13', '2026-09-20'])
  assert.equal(anchored.data_from, '2026-09-18')
  assert.equal(anchored.data_to, '2026-09-21')

  // A requested window outside the data must fail loudly, not return a plausible empty range.
  assert.throws(() => resolveAxisWindow({ axis, dates, period: 'last_1_month', anchorDate: '2020-01-01' }), /covers no rows/)
})

test('time-axis：默认窗口只给数据里确实存在的那些', () => {
  const rows = [
    { date_ms: SHANGHAI_DAY('2025-09-25') },
    { date_ms: SHANGHAI_DAY('2026-01-05') },
    { date_ms: SHANGHAI_DAY('2026-09-23') },
  ]
  const axis = probeTimeAxis('date_ms', rows.map((row) => row.date_ms))
  const dates = readAxisDates({ axis, rows })
  const windows = defaultAxisWindows({ axis, dates })
  assert.deepEqual(windows.map((window) => window.name), ['last_1_month', 'last_3_months', 'last_1_year', 'ytd'])
  const ytd = windows.find((window) => window.name === 'ytd')
  assert.equal(ytd.start_date, '2026-01-01')
  assert.equal(ytd.value_ge, SHANGHAI_DAY('2026-01-01'))
  assert.equal(ytd.data_from, '2026-01-05')
})

test('time-axis：日期写法翻译成边界，无意义的写法响亮失败', () => {
  const axis = probeTimeAxis('date_ms', [SHANGHAI_DAY('2026-09-23')])
  const dates = ['2026-08-21', '2026-09-23']

  assert.deepEqual(translateFilterDateValue({ axis, dates, column: 'date_ms', operator: '>=', value: '2026-08-23' }), [
    { operator: '>=', value: SHANGHAI_DAY('2026-08-23') },
  ])
  assert.deepEqual(translateFilterDateValue({ axis, dates, column: 'date_ms', operator: '<=', value: '2026-08-23' }), [
    { operator: '<=', value: zoneDayEndMs('2026-08-23', 'Asia/Shanghai') },
  ])
  // `=` expands to the local midnight boundaries of that single date.
  assert.deepEqual(translateFilterDateValue({ axis, dates, column: 'date_ms', operator: '=', value: '2026-09-23' }), [
    { operator: '>=', value: SHANGHAI_DAY('2026-09-23') },
    { operator: '<=', value: zoneDayEndMs('2026-09-23', 'Asia/Shanghai') },
  ])
  // Relative periods without an anchor use the last observed dataset date.
  const period = translateFilterDateValue({ axis, dates, column: 'date_ms', operator: '>=', value: { period: 'last_1_month' } })
  assert.equal(period?.[0].value, SHANGHAI_DAY('2026-08-23'))

  assert.throws(
    () => translateFilterDateValue({ axis, dates, column: 'date_ms', operator: '>', value: '2026-08-23' }),
    /cannot take a date-like value with operator >/,
  )
  assert.throws(
    () => translateFilterDateValue({ axis, dates, column: 'date_ms', operator: '!=', value: '2026-08-23' }),
    /cannot take a date-like value with operator !=/,
  )
  assert.throws(
    () => translateFilterDateValue({ axis, dates, column: 'date_ms', operator: 'in', value: ['2026-08-23'] }),
    /cannot take a date-like value with operator in/,
  )
  // Non-time columns and non-date spellings pass through unchanged.
  assert.equal(translateFilterDateValue({ axis, dates, column: 'close_price', operator: '>', value: '2026-08-23' }), undefined)
  assert.equal(translateFilterDateValue({ axis, dates, column: 'date_ms', operator: '>=', value: 1787414400000 }), undefined)
})

test('time-axis：date_string 轴不做毫秒换算，直接按 ISO 比较', () => {
  const axis = probeTimeAxis('trade_date', ['2026-09-18', '2026-09-23'])
  const dates = ['2026-09-18', '2026-09-23']
  assert.deepEqual(translateFilterDateValue({ axis, dates, column: 'trade_date', operator: '>=', value: '2026-09-20' }), [
    { operator: '>=', value: '2026-09-20' },
  ])
})

test('time-axis：数据集模式输出可直接使用的查询边界与真实首末日期', () => {
  const rows = [
    { date_ms: SHANGHAI_DAY('2025-09-25') },
    { date_ms: SHANGHAI_DAY('2026-09-22') },
    { date_ms: SHANGHAI_DAY('2026-09-23') },
  ]
  const axis = probeTimeAxis('date_ms', rows.map((row) => row.date_ms))
  const dates = readAxisDates({ axis, rows })
  const resolution = resolveDatasetTimeWindow({ dataset_id: 'ds_1', axis, dates, period: 'ytd' })
  assert.equal(resolution.mode, 'dataset')
  assert.equal(resolution.time_column, 'date_ms')
  assert.equal(resolution.timezone, 'Asia/Shanghai')
  assert.deepEqual(resolution.range, { start_date: '2026-01-01', end_date: '2026-09-23' })
  assert.deepEqual(resolution.data, { from: '2026-09-22', to: '2026-09-23', days: 2 })
  assert.deepEqual(resolution.bounds, {
    bound_ge: SHANGHAI_DAY('2026-01-01'),
    bound_le: zoneDayEndMs('2026-09-23', 'Asia/Shanghai'),
    inclusive: true,
  })
  assert.deepEqual(resolution.dataset, { covered_from: '2025-09-25', covered_to: '2026-09-23' })
  assert.equal(resolution.bounds_are_intraday, true)

  // No usable axis must raise; never fabricate bounds.
  assert.throws(
    () => resolveDatasetTimeWindow({ dataset_id: 'ds_2', axis: probeTimeAxis('ts', [1695571200]), dates: [], period: 'ytd' }),
    /has no usable time values/,
  )
})
