import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerTimeTool, readClock, resolveTimeZone, localTimeZone, resolveDataTimeRange } from '../lib/time/tools.js'

/** 最小 Cordis ctx：只实现本工具用到的 tools + effect 通道。 */
function fakeCtx(registerFn) {
  const fakeTools = { register(definition) { registerFn?.(definition); return () => {} } }
  return {
    get(name) { return name === 'tools' ? fakeTools : undefined },
    effect(callback) { const disposer = callback(); return typeof disposer === 'function' ? disposer : () => {} },
  }
}

test('registerTimeTool：向会话组 tools 注册 get_local_datetime', () => {
  const captured = []
  registerTimeTool(fakeCtx((definition) => { captured.push(definition) }))
  const clock = captured.find((definition) => definition.name === 'get_local_datetime')
  const range = captured.find((definition) => definition.name === 'resolve_data_time_range')
  assert.ok(clock, '必须注册 get_local_datetime')
  assert.ok(range, '必须注册 resolve_data_time_range')
  assert.match(clock.description, /知识截止日期绝不是当前时间/)
  assert.equal(clock.parameters.type, 'object')
  assert.equal(clock.parameters.additionalProperties, false)
  assert.ok(clock.parameters.properties.timezone, '支持可选 timezone 参数')
  assert.equal(typeof clock.execute, 'function')
  assert.equal(range.parameters.type, 'object')
  assert.ok(range.parameters.properties.capability)
  assert.ok(range.parameters.properties.period)
})

test('registerTimeTool：tools 服务缺失时静默跳过', () => {
  assert.doesNotThrow(() => registerTimeTool({ get: () => undefined, effect: () => () => {} }))
})

test('readClock：UTC 时区读数自洽', () => {
  const now = Date.UTC(2025, 8, 7, 8, 9, 10) // 2025-09-07T08:09:10Z
  const reading = readClock(now, 'UTC')
  assert.equal(reading.iso_utc, new Date(now).toISOString())
  assert.equal(reading.iso_local, '2025-09-07T08:09:10+00:00')
  assert.equal(reading.date, '2025-09-07')
  assert.equal(reading.time, '08:09:10')
  assert.equal(reading.weekday, 'Sunday')
  assert.equal(reading.timezone, 'UTC')
  assert.equal(reading.utc_offset, '+00:00')
  assert.equal(reading.utc_offset_minutes, 0)
  assert.equal(reading.epoch_ms, now)
})

test('readClock：Asia/Shanghai 换算（UTC+8）', () => {
  const now = Date.UTC(2025, 8, 7, 8, 9, 10)
  const reading = readClock(now, 'Asia/Shanghai')
  assert.equal(reading.iso_local, '2025-09-07T16:09:10+08:00')
  assert.equal(reading.timezone, 'Asia/Shanghai')
  assert.equal(reading.utc_offset, '+08:00')
  assert.equal(reading.utc_offset_minutes, 480)
  assert.equal(reading.iso_utc, new Date(now).toISOString())
})

test('readClock：缺省时区为宿主本地时区', () => {
  const now = Date.now()
  const reading = readClock(now)
  assert.equal(reading.timezone, localTimeZone())
  assert.equal(reading.epoch_ms, now)
})

test('resolveTimeZone：拒绝非法输入', () => {
  assert.throws(() => resolveTimeZone('Not/AZone!'), /IANA/)
  assert.throws(() => resolveTimeZone(42), /IANA/)
  assert.throws(() => resolveTimeZone(''), /IANA/)
  assert.equal(resolveTimeZone(undefined), undefined)
})
test('resolveDataTimeRange：按数据 capability 输出上海时区毫秒区间', () => {
  const result = resolveDataTimeRange({ capability: 'history', period: 'last_3_months', anchor_date: '2025-09-07' })
  assert.equal(result.format, 'epoch_ms')
  assert.deepEqual(result.range, {
    start_date: '2025-06-07', end_date: '2025-09-07',
    start_epoch_ms: Date.UTC(2025, 5, 6, 16, 0, 0, 0),
    end_epoch_ms: Date.UTC(2025, 8, 7, 15, 59, 59, 999),
  })
  assert.deepEqual(result.params, { start: result.range.start_epoch_ms, end: result.range.end_epoch_ms })
})

test('resolveDataTimeRange：日期接口返回字段名正确，不让模型自行改名', () => {
  const result = resolveDataTimeRange({ capability: 'hot_stock_rank_trend', period: { unit: 'day', count: 7 }, anchor_date: '2025-09-07' })
  assert.equal(result.format, 'date_string')
  assert.deepEqual(result.params, { start_date: '2025-09-01', end_date: '2025-09-07' })
})

test('resolveDataTimeRange：固定区间接口直接返回上游枚举', () => {
  const result = resolveDataTimeRange({ capability: 'fund_nav', period: 'last_3_months' })
  assert.deepEqual(result.params, { range: 'tmonth' })
  assert.equal(result.format, 'enum')
})

test('resolveDataTimeRange：保留交易日与报告期边界提示，并校验窗口上限', () => {
  const pool = resolveDataTimeRange({ capability: 'limit_up_pool', period: 'today', anchor_date: '2025-09-07' })
  assert.deepEqual(pool.params, { date_ms: Date.UTC(2025, 8, 6, 16) })
  assert.match(pool.warnings[0], /交易日/)
  const holding = resolveDataTimeRange({ capability: 'fund_stock_history', period: 'today', anchor_date: '2025-09-07' })
  assert.deepEqual(holding.params, { end_date: '2025-09-07' })
  assert.match(holding.warnings[0], /报告期/)
  assert.throws(() => resolveDataTimeRange({ capability: 'fund_history', period: 'last_10_years', anchor_date: '2025-09-07' }), /interface limit/)
})
