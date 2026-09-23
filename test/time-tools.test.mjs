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

/**
 * Dataset 形态（2026-09-23 真机会话 1e44050e）：
 * data_junior 需要的是"近 1 个月/年初至今"在某份 Dataset 的 `date_ms` 列上对应哪些边界，
 * 而旧契约只服务 request_data 的上游参数——于是它自己算毫秒，单步思考 41,961 字符。
 */
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

  // period 是两种形态共用的必填项；dataset_id 出现时走 Dataset 形态。
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

  // 相对期锚点默认取该 Dataset 最后一天：数据陈旧时也不会解析出一个空窗口。
  const lastMonth = await range.execute({ dataset_id: 'ds_time', period: 'last_1_month' }, { signal: new AbortController().signal, agent: { session: { id: 'junior-1', header: { cwd: '/w', parentSession: 'main-1' } } } })
  assert.deepEqual([lastMonth.range.start_date, lastMonth.range.end_date], ['2026-08-23', '2026-09-23'])
  assert.deepEqual([lastMonth.data.from, lastMonth.data.to], ['2026-09-22', '2026-09-23'])

  // 能力形态不受影响：仍按 capability + period 输出 request_data 参数。
  const capability = await range.execute({ capability: 'history', period: 'last_3_months' }, { signal: new AbortController().signal })
  assert.equal(capability.capability, 'history')
  assert.equal(capability.format, 'epoch_ms')
  assert.ok(capability.params.start < capability.params.end)

  // 没有可用时间轴时明确报错，不编造边界。
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

/**
 * 输出契约（2026-09-23 真机事故，会话 cf464cb6）：
 * 宿主在 `createSuccessResult` 里按 `output.schema` 校验**返回值**，违反即
 * `ToolOutputError: returned invalid output: missing required property "value.mode"`。
 * 而 test 直接调 `definition.execute(...)` **绕过**这层校验——所以
 * `resolve_data_time_range` 的 capability 形态（缺 `mode`）本地全绿、真机每次调用都失败。
 * 下面把"每个形态的返回值都满足声明"变成断言，多形态工具再漏字段就在这里红。
 */
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
  // 取数形态的四种 kind 都要过：epoch_range / enum_range / date_range / date_ms。
  for (const args of [
    { capability: 'history', period: 'last_2_years' },
    { capability: 'fund_nav', period: 'last_3_months' },
    { capability: 'corporate_actions', period: 'last_1_month' },
    { capability: 'limit_up_pool', period: 'today' },
  ]) assertToolOutput(range, await range.execute(args, { signal }))
  // Dataset 形态：字符串 period、对象 period、以及被序列化成字符串的对象 period。
  for (const period of ['ytd', { unit: 'month', count: 1 }, '{"unit":"month","count":1}']) {
    assertToolOutput(range, await range.execute({ dataset_id: 'ds_time', period }, { signal, agent: { session: junior } }))
  }
  // 对象与字符串化对象必须解析成同一个窗口（曾经因为先转展示名再解析而双双失败）。
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
