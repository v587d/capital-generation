import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerTimeTool, readClock, resolveTimeZone, localTimeZone, resolveDataTimeRange } from '../lib/time/tools.js'

/** Minimal ctx exposing only the tools and effect channels used by this test. */
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

/** Dataset mode resolves period boundaries on an existing time column instead of making junior compute epochs. */
test('resolve_data_time_range（Dataset 形态）：按该 Dataset 时间列偏移输出可直接用的边界', async () => {
  const day = (date) => Date.UTC(...date.split('-').map((part, index) => (index === 1 ? Number(part) - 1 : Number(part)))) - 8 * 3_600_000
  const dates = ['2025-09-25', '2026-01-05', '2026-09-22', '2026-09-23']
  const reader = {
    async describeTimeAxis() {
      return {
        dataset_id: 'ds_time',
        columns: ['date_ms', 'close_price'],
        axis: { column: 'date_ms', value_format: 'epoch_ms', time_zone: 'Asia/Shanghai', utc_offset: '+08:00', aligned_to: 'local_midnight' },
        dates,
      }
    },
  }
  const captured = []
  registerTimeTool(fakeCtx((definition) => { captured.push(definition) }), reader)
  const range = captured.find((definition) => definition.name === 'resolve_data_time_range')

  // period is shared by both modes; dataset_id selects Dataset mode.
  assert.deepEqual(range.parameters.required, ['period'])
  assert.ok(range.parameters.properties.dataset_id)
  assert.ok(range.parameters.properties.time_column)

  const ytd = await range.execute({ dataset_id: 'ds_time', period: 'ytd' }, { signal: new AbortController().signal, agent: { session: { id: 'junior-1', header: { cwd: '/w', parentSession: 'main-1' } } } })
  assert.equal(ytd.mode, 'dataset')
  assert.equal(ytd.time_column, 'date_ms')
  assert.equal(ytd.timezone, 'Asia/Shanghai')
  assert.deepEqual(ytd.range, { start_date: '2026-01-01', end_date: '2026-09-23' })
  assert.deepEqual(ytd.data, { from: '2026-01-05', to: '2026-09-23', days: 3 })
  assert.deepEqual(ytd.bounds, { bound_ge: day('2026-01-01'), bound_le: day('2026-09-23') + 86_400_000 - 1, inclusive: true })
  assert.equal(ytd.bounds_are_intraday, true)
  assert.deepEqual(ytd.dataset, { covered_from: '2025-09-25', covered_to: '2026-09-23' })

  // Relative periods default to the dataset's last date, keeping stale data windows non-empty.
  const lastMonth = await range.execute({ dataset_id: 'ds_time', period: 'last_1_month' }, { signal: new AbortController().signal, agent: { session: { id: 'junior-1', header: { cwd: '/w', parentSession: 'main-1' } } } })
  assert.deepEqual([lastMonth.range.start_date, lastMonth.range.end_date], ['2026-08-23', '2026-09-23'])
  assert.deepEqual([lastMonth.data.from, lastMonth.data.to], ['2026-09-22', '2026-09-23'])

  // Capability mode still returns request_data parameters.
  const capability = await range.execute({ capability: 'history', period: 'last_3_months' }, { signal: new AbortController().signal })
  assert.equal(capability.capability, 'history')
  assert.equal(capability.format, 'epoch_ms')
  assert.ok(capability.params.start < capability.params.end)

  // Missing time axis fails loudly; never invent boundaries.
  const blind = {
    async describeTimeAxis() {
      return undefined
    },
  }
  const blindCaptured = []
  registerTimeTool(fakeCtx((definition) => { blindCaptured.push(definition) }), blind)
  const blindRange = blindCaptured.find((definition) => definition.name === 'resolve_data_time_range')
  await assert.rejects(
    () => blindRange.execute({ dataset_id: 'ds_time', period: 'ytd' }, { signal: new AbortController().signal, agent: { session: { id: 'junior-1', header: { cwd: '/w', parentSession: 'main-1' } } } }),
    /has no detectable time column/,
  )
})

test('resolve_data_time_range（Dataset 形态）：未挂 store 时明确失败，不静默返回空', async () => {
  const captured = []
  registerTimeTool(fakeCtx((definition) => { captured.push(definition) }))
  const range = captured.find((definition) => definition.name === 'resolve_data_time_range')
  await assert.rejects(
    () => range.execute({ dataset_id: 'ds_time', period: 'ytd' }, { signal: new AbortController().signal, agent: { session: { id: 'junior-1', header: { cwd: '/w', parentSession: 'main-1' } } } }),
    /Dataset store is not mounted/,
  )
})

/** Host validates result objects against output.schema; direct execute() tests bypass that check. */
test('输出契约：resolve_data_time_range 的每个形态都必须满足 output.schema', async () => {
  const { assertToolOutput } = await import('./output-contract.mjs')
  const day = (date) => Date.UTC(...date.split('-').map((part, index) => (index === 1 ? Number(part) - 1 : Number(part)))) - 8 * 3_600_000
  const reader = {
    async describeTimeAxis() {
      return {
        dataset_id: 'ds_time',
        columns: ['date_ms', 'close_price'],
        axis: { column: 'date_ms', value_format: 'epoch_ms', time_zone: 'Asia/Shanghai', utc_offset: '+08:00', aligned_to: 'local_midnight' },
        dates: ['2025-09-25', '2026-01-05', '2026-09-22', '2026-09-23'],
      }
    },
  }
  const captured = []
  registerTimeTool(fakeCtx((definition) => { captured.push(definition) }), reader)
  const range = captured.find((definition) => definition.name === 'resolve_data_time_range')
  const clock = captured.find((definition) => definition.name === 'get_local_datetime')
  const signal = new AbortController().signal
  const junior = { id: 'junior-1', header: { cwd: '/w', parentSession: 'main-1' } }

  assertToolOutput(clock, await clock.execute({}, { signal }))
  // Cover all four capability result kinds.
  for (const args of [
    { capability: 'history', period: 'last_2_years' },
    { capability: 'fund_nav', period: 'last_3_months' },
    { capability: 'corporate_actions', period: 'last_1_month' },
    { capability: 'limit_up_pool', period: 'today' },
  ]) assertToolOutput(range, await range.execute(args, { signal }))
  // Cover period as a string, object, and serialized object.
  for (const period of ['ytd', { unit: 'month', count: 1 }, '{"unit":"month","count":1}']) {
    assertToolOutput(range, await range.execute({ dataset_id: 'ds_time', period }, { signal, agent: { session: junior } }))
  }
  // Object and serialized-object forms must resolve identically.
  const asObject = await range.execute({ dataset_id: 'ds_time', period: { unit: 'month', count: 1 } }, { signal, agent: { session: junior } })
  const asText = await range.execute({ dataset_id: 'ds_time', period: '{"unit":"month","count":1}' }, { signal, agent: { session: junior } })
  assert.deepEqual(asObject.range, asText.range)
  assert.equal(asObject.mode, 'dataset')
})

test('输出契约：period 被序列化成 JSON 字符串时按对象解析（真机两次白跑一轮的写法）', async () => {
  const captured = []
  registerTimeTool(fakeCtx((definition) => { captured.push(definition) }))
  const range = captured.find((definition) => definition.name === 'resolve_data_time_range')
  const signal = new AbortController().signal
  const plain = await range.execute({ capability: 'history', period: 'last_2_years' }, { signal })
  const stringified = await range.execute({ capability: 'history', period: '{"unit":"year","count":2}' }, { signal })
  assert.deepEqual(stringified.range, plain.range, '字符串化的 {unit,count} 必须与对象形态等价')
  assert.equal(stringified.mode, 'capability')
})
