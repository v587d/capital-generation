import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerTimeTool, readClock, resolveTimeZone, localTimeZone } from '../lib/time/tools.js'

/** 最小 Cordis ctx：只实现本工具用到的 tools + effect 通道。 */
function fakeCtx(registerFn) {
  const fakeTools = { register(definition) { registerFn?.(definition); return () => {} } }
  return {
    get(name) { return name === 'tools' ? fakeTools : undefined },
    effect(callback) { const disposer = callback(); return typeof disposer === 'function' ? disposer : () => {} },
  }
}

test('registerTimeTool：向会话组 tools 注册 get_local_datetime', () => {
  let captured = null
  registerTimeTool(fakeCtx((definition) => { captured = definition }))
  assert.ok(captured, '必须注册一个工具定义')
  assert.equal(captured.name, 'get_local_datetime')
  assert.match(captured.description, /知识截止日期绝不是当前时间/)
  assert.equal(captured.parameters.type, 'object')
  assert.equal(captured.parameters.additionalProperties, false)
  assert.ok(captured.parameters.properties.timezone, '支持可选 timezone 参数')
  assert.equal(typeof captured.execute, 'function')
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