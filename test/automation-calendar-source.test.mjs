import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCalendarSource } from '../automation/calendar-source.js'
import { tradingCalendar } from '../automation/calendar.js'

const NOW = Date.parse('2026-10-28T02:00:00Z')

function datesOf(month) {
  const [year, value] = month.split('-').map(Number)
  const count = new Date(Date.UTC(year, value, 0)).getUTCDate()
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
}

function weekdayTrading(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day !== 0 && day !== 6
}

function monthPayload(month, trading = (date) => tradingCalendar.isTradingDay(date) === true) {
  return {
    data: datesOf(month).map((date) => ({ jyrq: date, jybz: trading(date) ? '1' : '0' })),
    nowdate: '2026-10-28',
  }
}

function response(body, { status = 200, contentType = 'application/json;charset=UTF-8' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body) },
  }
}

function fakeFetch(handler) {
  const calls = []
  const fetch = async (url) => {
    const month = new URL(url).searchParams.get('month')
    calls.push(month)
    return handler(month, calls.length)
  }
  return { fetch, calls }
}

function source({ now = () => NOW, fetch, cacheFile, logger } = {}) {
  return createCalendarSource({ now, fetch, cacheFile, fallback: tradingCalendar, logger, timeoutMs: 1_000 })
}

test('拉取到的月份覆盖内置表：交易所说开市就是开市', async () => {
  const fake = fakeFetch((month) => {
    if (month === '2026-10') return response(monthPayload(month, (date) => date === '2026-10-01'))
    return response({ data: [] })
  })
  const calendar = source({ fetch: fake.fetch })
  await calendar.refresh()
  assert.equal(calendar.isTradingDay('2026-10-01'), true, '远端把国庆改成交易日时以内置表为单位会被覆盖')
  assert.equal(calendar.isTradingDay('2026-10-02'), false)
  const status = calendar.status()
  assert.equal(status.source, 'szse')
  assert.equal(status.available, true)
  assert.equal(status.through, '2026-12-31')
})

test('未公布的月份回退内置表，不把空数组当成全月休市', async () => {
  const fake = fakeFetch(() => response({ data: [] }))
  const calendar = source({ fetch: fake.fetch })
  await calendar.refresh()
  assert.equal(calendar.isTradingDay('2026-10-28'), true)
  assert.equal(calendar.isTradingDay('2026-10-01'), false)
  const status = calendar.status()
  assert.equal(status.source, 'bundled')
  assert.equal(status.available, true)
  assert.equal(status.through, '2026-12-31')
})

test('非法响应不覆盖上一次成功结果，并留下可读错误', async () => {
  let broken = false
  const fake = fakeFetch((month) => {
    if (month !== '2026-10') return response({ data: [] })
    if (broken) return response({ data: datesOf('2026-10').slice(0, -1).map((date) => ({ jyrq: date, jybz: '1' })) })
    return response(monthPayload(month, (date) => date === '2026-10-01'))
  })
  const calendar = source({ fetch: fake.fetch })
  await calendar.refresh()
  assert.equal(calendar.isTradingDay('2026-10-01'), true)
  broken = true
  await calendar.refresh({ force: true })
  assert.equal(calendar.isTradingDay('2026-10-01'), true, '坏响应不能把已知日期改回未知/休市')
  assert.match(calendar.status().lastError, /expected 31 rows/)
})

test('网络失败保留内置表答案，并记录错误供页面提示', async () => {
  const fake = fakeFetch(() => { throw new Error('ECONNRESET') })
  const calendar = source({ fetch: fake.fetch })
  await calendar.refresh()
  assert.equal(calendar.isTradingDay('2026-10-28'), true)
  const status = calendar.status()
  assert.equal(status.available, true)
  assert.match(status.lastError, /ECONNRESET/)
})

test('缓存跨进程复用：第二实例不联网也能回答', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cg-calendar-'))
  const cacheFile = join(dir, 'szse.json')
  try {
    const writer = source({
      cacheFile,
      fetch: fakeFetch((month) => (
        month === '2026-10'
          ? response(monthPayload(month, (date) => date === '2026-10-01'))
          : response({ data: [] })
      )).fetch,
    })
    await writer.refresh()
    writer.dispose()

    const reader = source({ cacheFile, fetch: async () => { throw new Error('offline') } })
    await reader.load()
    assert.equal(reader.isTradingDay('2026-10-01'), true)
    assert.equal(reader.status().source, 'szse')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('启动时今天未知会先等一次拉取，避免新年第一天误跳过', async () => {
  const before = Date.parse('2027-01-04T01:00:00Z')
  const fake = fakeFetch((month) => (
    month === '2027-01'
      ? response(monthPayload(month, weekdayTrading))
      : response({ data: [] })
  ))
  const calendar = source({ now: () => before, fetch: fake.fetch })
  await calendar.ready()
  assert.equal(calendar.isTradingDay('2027-01-04'), true)
  assert.equal(calendar.status().available, true)
  assert.equal(calendar.status().source, 'szse')
})

test('coverage 扫描给出 through 与 firstUnknown，页面据此提前告警', async () => {
  const at = Date.parse('2026-12-20T02:00:00Z')
  const fake = fakeFetch((month) => (
    month === '2027-01' || month === '2027-02'
      ? response(monthPayload(month, weekdayTrading))
      : response({ data: [] })
  ))
  const calendar = source({ now: () => at, fetch: fake.fetch })
  await calendar.refresh()
  const status = calendar.status()
  assert.equal(status.available, true)
  assert.equal(status.through, '2027-02-28')
  assert.equal(status.firstUnknown, '2027-03-01')
  assert.ok(status.coverageDays > 30, '覆盖 70 天左右，不应触发 <30 天告警')
})
