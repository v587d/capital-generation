import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  occurrenceKeyOf,
  previousOccurrenceAtOrBefore,
  nextOccurrence,
  scheduleVersionOf,
  zonedWallToInstant,
} from '../automation/time.js'
import { tradingCalendar } from '../automation/calendar.js'

const at = (iso) => Date.parse(iso)

function daily(overrides = {}) {
  return { kind: 'schedule', cadence: 'daily', time: '08:30', timezone: 'Asia/Shanghai', tradingDaysOnly: false, ...overrides }
}

test('daily：本地 08:30 对应 UTC 00:30，跨午夜取最近的过去/将来', () => {
  const previous = previousOccurrenceAtOrBefore(daily(), at('2026-10-27T01:00:00Z'))
  assert.equal(previous.kind, 'occurrence')
  assert.equal(previous.scheduledFor, '2026-10-27T00:30:00.000Z')
  const next = nextOccurrence(daily(), at('2026-10-27T01:00:00Z'))
  assert.equal(next.scheduledFor, '2026-10-28T00:30:00.000Z')
  const midnight = nextOccurrence(daily({ time: '00:05' }), at('2026-10-27T15:00:00Z'))
  assert.equal(midnight.localDate, '2026-10-28')
})

test('weekly 只落在指定 ISO 星期；monthly 使用 1–28 的固定日', () => {
  const weekly = { kind: 'schedule', cadence: 'weekly', time: '09:00', timezone: 'Asia/Shanghai', weekdays: [1, 3], tradingDaysOnly: false }
  const next = nextOccurrence(weekly, at('2026-10-27T01:00:00Z')) // Tuesday local
  assert.equal(next.localDate, '2026-10-28')
  const monthly = { kind: 'schedule', cadence: 'monthly', time: '09:00', timezone: 'Asia/Shanghai', dayOfMonth: 1, tradingDaysOnly: false }
  const first = nextOccurrence(monthly, at('2026-10-27T01:00:00Z'))
  assert.equal(first.localDate, '2026-11-01')
})

test('DST 春季缺口跳过不存在的那一分钟，秋季重叠取第一个', () => {
  const spring = { kind: 'schedule', cadence: 'daily', time: '02:30', timezone: 'America/New_York', tradingDaysOnly: false }
  const skipped = nextOccurrence(spring, at('2026-03-07T12:00:00Z'))
  assert.equal(skipped.localDate, '2026-03-09')
  const fall = { kind: 'schedule', cadence: 'daily', time: '01:30', timezone: 'America/New_York', tradingDaysOnly: false }
  const overlap = nextOccurrence(fall, at('2026-10-31T12:00:00Z'))
  assert.equal(overlap.scheduledFor, '2026-11-01T05:30:00.000Z')
  assert.equal(zonedWallToInstant('2026-03-08', 2, 30, 'America/New_York'), undefined)
})

test('tradingDaysOnly：周末与交易所假期跳过，日历窗口外 fail-closed', () => {
  const trigger = daily({ tradingDaysOnly: true, time: '08:30' })
  const holiday = previousOccurrenceAtOrBefore(trigger, at('2026-10-02T01:00:00Z'), { calendar: tradingCalendar })
  assert.equal(holiday.kind, 'occurrence')
  assert.ok(holiday.localDate < '2026-10-01', '国庆假期不能返回 2026-10-01')
  const weekend = previousOccurrenceAtOrBefore(trigger, at('2026-10-04T01:00:00Z'), { calendar: tradingCalendar })
  assert.equal(weekend.kind, 'occurrence')
  assert.ok(!['2026-10-03', '2026-10-04'].includes(weekend.localDate))
  const outside = previousOccurrenceAtOrBefore(trigger, at('2027-01-04T01:00:00Z'), { calendar: tradingCalendar })
  assert.equal(outside.kind, 'calendar_unavailable')
  assert.equal(tradingCalendar.isTradingDay('2026-10-27'), true)
  assert.equal(tradingCalendar.isTradingDay('2026-10-01'), false)
  assert.equal(tradingCalendar.isTradingDay('2027-01-04'), undefined)
})

test('occurrenceKey 含 profile、task、schedule 版本与规范化 UTC 时刻', () => {
  const trigger = daily()
  const version = scheduleVersionOf(trigger)
  const key = occurrenceKeyOf('p_x', 'task_1', version, '2026-10-27T00:30:00.000Z')
  assert.equal(key, `p_x:task_1:${version}:2026-10-27T00:30:00.000Z`)
  assert.notEqual(scheduleVersionOf({ ...trigger, time: '08:31' }), version)
  assert.equal(scheduleVersionOf({ ...trigger, weekdays: undefined }), version, '未使用的字段不改变版本')
})
