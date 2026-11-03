import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeTimeCoverage } from '../lib/data-collector/time-axis.js'

test('time_coverage：行情字符串按真实最早/最晚取值，不按首末行', () => {
  const rows = [
    { code: 'A', quote_time: '2026-10-30 16:00:01' },
    { code: 'B', quote_time: '2026-10-28 16:00:02' },
    { code: 'C', quote_time: '2026-10-29 16:00:03' },
  ]
  assert.deepEqual(summarizeTimeCoverage(rows), {
    column: 'quote_time',
    from: '2026-10-28 16:00:02',
    to: '2026-10-30 16:00:01',
    format: 'datetime_string',
  })
})

test('time_coverage：日线降序也取覆盖范围，不把首行当最新', () => {
  const rows = [
    { trade_date: '2026-10-30' },
    { trade_date: '2026-10-29' },
    { trade_date: '2026-09-28' },
  ]
  assert.deepEqual(summarizeTimeCoverage(rows), {
    column: 'trade_date',
    from: '2026-09-28',
    to: '2026-10-30',
    format: 'date_string',
  })
})

test('time_coverage：毫秒时间列归一成日期，避免把本地零点显示成前一天', () => {
  const rows = [
    { trade_date_ms: 1793116800000 },
    { trade_date_ms: 1790524800000 },
  ]
  assert.deepEqual(summarizeTimeCoverage(rows), {
    column: 'trade_date_ms',
    from: '2026-09-28',
    to: '2026-10-28',
    format: 'epoch_ms',
  })
})

test('time_coverage：事件日历优先按事件时刻，而不是只给日期的 stat_date', () => {
  const rows = [
    { stat_date: '2026-11-02', event_time_beijing: '2026-11-02 21:30' },
    { stat_date: '2026-11-01', event_time_beijing: '2026-11-01 08:30' },
  ]
  assert.deepEqual(summarizeTimeCoverage(rows), {
    column: 'event_time_beijing',
    from: '2026-11-01 08:30',
    to: '2026-11-02 21:30',
    format: 'datetime_string',
  })
})

test('time_coverage：没有时间列时显式返回 none，不能静默省略', () => {
  assert.deepEqual(summarizeTimeCoverage([{ code: '300803.SZ', price: 44.32 }]), {
    column: null,
    from: null,
    to: null,
    format: 'none',
  })
})

test('time_coverage：普通数值列（成交量/市值）不会被误认成时间轴', () => {
  assert.deepEqual(summarizeTimeCoverage([{ volume: 15080250200, market_cap: 396240000000 }]), {
    column: null,
    from: null,
    to: null,
    format: 'none',
  })
})
