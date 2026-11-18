/**
 * Intraday trend core: identity table, the three upstream shapes (A-share / HK / US), the
 * after-hours and closing-auction cuts, the exchange clock, and every loud-failure guard.
 * Fixtures are verbatim upstream bodies (2026-11-17 session), never hand-built except where a
 * guard needs a shape the upstream would never send.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { elapsedTradingMinutes, fetchTrendSeries, resolveTrendTarget } from '../lib/sources/trend-series.js'
import { tencentHostDownUntil } from '../lib/sources/tencent-public-core.js'
import { EASTMONEY_AAPL, TENCENT_00700, TENCENT_300803_AFTER_HOURS, TENCENT_600519, TENCENT_688599 } from './trend-fixtures.mjs'

/** A-share session close in Asia/Shanghai on the fixture's own session date. */
const AFTER_CLOSE = Date.parse('2026-11-17T16:30:00+08:00')
const NEXT_MORNING = Date.parse('2026-11-18T08:00:00+08:00')

function tencentResponse(body) {
  const bytes = Buffer.from(body, 'utf-8')
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

/** Serves both upstreams; every ifzq host answers so a rotation from an earlier test cannot bite. */
function stubFetch({ tencent = TENCENT_600519, eastmoney = EASTMONEY_AAPL, calls = [] } = {}) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url)
    calls.push({ url: text, signal: init.signal })
    if (text.includes('gtimg.cn')) {
      const body = typeof tencent === 'function' ? tencent(text) : tencent
      if (body === undefined) throw new Error(`no tencent fixture for ${text}`)
      return tencentResponse(body)
    }
    const payload = typeof eastmoney === 'function' ? eastmoney(text) : eastmoney
    return { ok: true, status: 200, json: async () => JSON.parse(payload) }
  }
  return { calls, restore() { globalThis.fetch = original } }
}

function targetFor(thscode, assetType) {
  const target = resolveTrendTarget({ thscode, asset_type: assetType })
  assert.ok(target, `${thscode} / ${assetType} 应当可解析`)
  return target
}

async function withStub(options, run) {
  const stub = stubFetch(options)
  try {
    return await run(stub)
  } finally {
    stub.restore()
    tencentHostDownUntil.clear()
  }
}

test('身份表：四个市场族各自落到唯一上游，画不出来的标的在发请求前就拒绝', () => {
  const cases = [
    ['600519.SH', 'a-share', { source: 'tencent', market: 'a-share', symbol: 'sh600519', isIndex: false, volumeUnit: 'lot', currency: 'CNY' }],
    ['000001.SH', 'a-share-index', { source: 'tencent', market: 'a-share', symbol: 'sh000001', isIndex: true, volumeUnit: 'lot', currency: null }],
    ['510300.SH', 'fund-etf', { source: 'tencent', market: 'a-share', symbol: 'sh510300', isIndex: false, volumeUnit: 'lot', currency: 'CNY' }],
    ['00700.HK', 'hk-stock', { source: 'tencent', market: 'hk', symbol: 'hk00700', isIndex: false, volumeUnit: 'share', currency: 'HKD' }],
    ['HSTECH.HK', 'hk-index', { source: 'tencent', market: 'hk', symbol: 'hkHSTECH', isIndex: true, volumeUnit: null, currency: null }],
    ['AAPL.OQ', 'us-stock', { source: 'eastmoney', market: 'us', secid: '105.AAPL', isIndex: false, volumeUnit: 'share', currency: 'USD' }],
    ['BABA.N', 'us-stock', { source: 'eastmoney', market: 'us', secid: '106.BABA', isIndex: false, volumeUnit: 'share', currency: 'USD' }],
    ['UUUU.AM', 'us-stock', { source: 'eastmoney', market: 'us', secid: '107.UUUU', isIndex: false, volumeUnit: 'share', currency: 'USD' }],
    ['IXIC.US', 'us-index', { source: 'eastmoney', market: 'us', secid: '100.NDX', isIndex: true, volumeUnit: null, currency: null }],
    ['INX.US', 'us-index', { source: 'eastmoney', market: 'us', secid: '100.SPX', isIndex: true, volumeUnit: null, currency: null }],
    ['DJI.US', 'us-index', { source: 'eastmoney', market: 'us', secid: '100.DJIA', isIndex: true, volumeUnit: null, currency: null }],
  ]
  for (const [thscode, assetType, expected] of cases) {
    const target = targetFor(thscode, assetType)
    assert.equal(target.source, expected.source, `${thscode} source`)
    assert.equal(target.market, expected.market, `${thscode} market`)
    assert.equal(target.symbol ?? target.secid, expected.symbol ?? expected.secid, `${thscode} upstream identity`)
    assert.equal(target.isIndex, expected.isIndex, `${thscode} isIndex`)
    assert.equal(target.volumeUnit, expected.volumeUnit, `${thscode} volume unit`)
    assert.equal(target.currency, expected.currency, `${thscode} currency`)
    assert.equal(target.thscode, thscode)
  }

  // OTC pink and exotic US indices have no series on the US source; the route must say so, not probe.
  for (const [thscode, assetType] of [
    ['TCEHY.PS', 'us-stock'],
    ['VIX.US', 'us-index'],
    ['00700.HK', 'us-stock'],
    ['600519.SH', 'hk-stock'],
    ['600519', 'a-share'],
    ['', 'a-share'],
  ]) {
    assert.equal(resolveTrendTarget({ thscode, asset_type: assetType }), undefined, `${thscode} / ${assetType} 应当拒绝`)
  }
})

test('A 股：截掉收盘后补点，累计量差成分钟量，15:00 累计量与快照相等', async () => {
  await withStub({}, async () => {
    const series = await fetchTrendSeries(targetFor('600519.SH', 'a-share'), { signal: AbortSignal.timeout(5_000), now: AFTER_CLOSE })

    assert.equal(series.points.length, 242, '09:30–11:30 + 13:00–15:00，15:06–15:30 的补点全部丢掉')
    assert.equal(series.points[0][0], '09:30')
    assert.equal(series.points[series.points.length - 1][0], '15:00', '⛔ 最后一根是 15:00，不是补点')
    assert.equal(series.points.some((point) => point[0] > '15:00'), false)

    assert.equal(series.prev_close, 1453.9)
    assert.equal(series.open, 1458.88)
    assert.equal(series.high, 1461.6)
    assert.equal(series.low, 1437.71)
    assert.equal(series.last, 1457.7)
    // 上游 15:00 的累计成交量与当天快照逐位相等，这条断言就是"截到收盘"的证据。
    assert.equal(series.volume, 35116)
    assert.equal(series.points.reduce((sum, point) => sum + point[3], 0), 35116, '分钟量之和必须等于全天量')
    assert.ok(Math.abs(series.amount - 5_094_529_370.28) < 1, `全天成交额取累计值，实测 ${series.amount}`)
    assert.ok(Math.abs(series.avg - 1450.77) < 0.01, '均价 = 累计额 ÷ 累计股数')
    assert.equal(series.points[0][1], 1458.88, '开盘集合竞价的点就是 09:30 那一点')
    assert.equal(series.volume_unit, 'lot')
    assert.equal(series.currency, 'CNY')
    assert.equal(series.session_date, '2026-11-17')
    assert.equal(series.tz, 'Asia/Shanghai')
  })
})

test('⛔ 科创板成交量按股报：量纲与均价必须落在印出的价格上，而不是跟着板子表的假设走', async () => {
  await withStub({ tencent: TENCENT_688599 }, async () => {
    const series = await fetchTrendSeries(targetFor('688599.SH', 'a-share'), { signal: AbortSignal.timeout(5_000), now: Date.parse('2026-11-18T10:40:00+08:00') })

    assert.equal(series.volume_unit, 'share', '688 报的是股数：再乘 100 就是「均价 0.09」那种错')
    assert.ok(Math.abs(series.avg - series.last) / series.last < 0.05, `均价 ${series.avg} 必须与最新价 ${series.last} 同量纲`)
    const tail = series.points[series.points.length - 1]
    assert.ok(Math.abs(tail[2] - series.avg) < 1e-9, '图上的均价线取同一个量纲')
    assert.ok(Math.abs(series.volume - series.points.reduce((sum, point) => sum + point[3], 0)) < 1, '分钟量之和等于全天量')
    assert.ok(Math.abs(series.amount - series.points.reduce((sum, point) => sum + point[4], 0)) < 1, '全天成交额 = 分钟额之和')
    assert.ok(series.volume > 1_000_000 && series.volume < 100_000_000, `全天量是股数：实测 ${series.volume}`)
    assert.equal(series.session_status, 'live', '盘中取到的是当日分时')
  })
})

test('港股：16:08 收盘竞价点保留为最后一点，16:00 之后的连续竞价格子不再跟着排', async () => {
  await withStub({ tencent: TENCENT_00700 }, async () => {
    const series = await fetchTrendSeries(targetFor('00700.HK', 'hk-stock'), { signal: AbortSignal.timeout(5_000), now: AFTER_CLOSE })

    const afterClose = series.points.filter((point) => point[0] > '16:00')
    assert.deepEqual(afterClose.map((point) => point[0]), ['16:08'], '只有收盘竞价那一点')
    assert.equal(afterClose[0][1], 376, '竞价价就是官方收盘价')
    assert.equal(series.points[series.points.length - 1][1], series.last, '序列末点与官方最新价一致')
    assert.equal(series.volume, 31_401_095)
    assert.ok(Math.abs(series.amount - 11_892_584_512.65) < 1)
    assert.equal(series.volume_unit, 'share', '港股按股计，不乘 100')
    assert.ok(Math.abs(series.avg - 378.73) < 0.01)
    assert.equal(series.currency, 'HKD')
  })
})

test('美股：东财时间戳是北京时间，必须换算成交易所本地钟点', async () => {
  await withStub({}, async () => {
    const series = await fetchTrendSeries(targetFor('AAPL.OQ', 'us-stock'), { signal: AbortSignal.timeout(5_000), now: Date.parse('2026-11-18T09:00:00+08:00') })

    assert.equal(series.source, 'eastmoney')
    assert.equal(series.points.length, 391)
    assert.equal(series.points[0][0], '09:30', '⛔ 上游首行是北京 22:30，换算后必须是 09:30')
    assert.equal(series.points[series.points.length - 1][0], '16:00', '⛔ 上游末行是北京 05:00，换算后必须是 16:00')
    const times = series.points.map((point) => point[0])
    assert.deepEqual(times, [...times].sort(), '换算后仍按时间升序')
    assert.equal(series.session_date, '2026-11-17', '交易日按纽约日期，不是北京日期')
    assert.equal(series.prev_close, 352.78)
    assert.equal(series.last, 351.91)
    assert.equal(series.volume, 37_400_014)
    assert.ok(Math.abs(series.amount - 13_158_326_239) < 1)
    assert.ok(Math.abs(series.avg - 351.84) < 0.01)
    assert.equal(series.session_status, 'closed', '美东已收盘')
  })
})

test('画不出来的标的绝不发请求（OTC 与冷门美股指数）', async () => {
  const calls = []
  await withStub({ calls }, async () => {
    assert.equal(resolveTrendTarget({ thscode: 'TCEHY.PS', asset_type: 'us-stock' }), undefined)
    assert.equal(calls.length, 0, '解析失败就不该打上游')
  })
})

test('会话时钟：午休不算流逝，状态与滞后按交易所本地时间算', async () => {
  assert.equal(elapsedTradingMinutes('a-share', 9 * 60 + 15), 0, '开盘前')
  assert.equal(elapsedTradingMinutes('a-share', 10 * 60), 30)
  assert.equal(elapsedTradingMinutes('a-share', 12 * 60), 120, '午休期间停在 120')
  assert.equal(elapsedTradingMinutes('a-share', 13 * 60 + 30), 150, '午后重新计时')
  assert.equal(elapsedTradingMinutes('a-share', 15 * 60 + 30), 240, '收盘后封顶')
  assert.equal(elapsedTradingMinutes('hk', 12 * 60 + 30), 150, '港股午休更长')
  assert.equal(elapsedTradingMinutes('us', 11 * 60), 90, '美股连续交易')

  const quote = (price, volume) => {
    // Field layout mirrors the upstream array: 3 price, 4 previous close, 5 open, 6 volume, 33 high, 34 low.
    const fields = new Array(35).fill(null)
    fields[1] = 'x'
    fields[2] = '600519'
    fields[3] = price
    fields[4] = '9.50'
    fields[5] = '9.60'
    fields[6] = String(volume)
    fields[33] = '10.20'
    fields[34] = '9.40'
    return fields
  }
  const body = (date, rows, price = '10.00', volume = 1000) => JSON.stringify({
    code: 0,
    data: { sh600519: { data: { date, data: rows }, qt: { sh600519: quote(price, volume) } } },
  })

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('/', '-')
  const rows = ['0930 9.60 100 9600.00', '0931 9.70 300 29000.00', '0932 9.80 600 58000.00']

  await withStub({ tencent: body(today.replaceAll('-', ''), rows, '10.00', 600) }, async () => {
    const live = await fetchTrendSeries(targetFor('600519.SH', 'a-share'), { signal: AbortSignal.timeout(5_000), now: Date.parse(`${today}T10:00:00+08:00`) })
    assert.equal(live.session_status, 'live')
    assert.equal(live.stale, true, '最后一根在 09:32，10:00 看已经超过 10 分钟没更新')

    const closed = await fetchTrendSeries(targetFor('600519.SH', 'a-share'), { signal: AbortSignal.timeout(5_000), now: Date.parse(`${today}T16:00:00+08:00`) })
    assert.equal(closed.session_status, 'closed')
    assert.equal(closed.stale, false, '收盘后不再谈滞后')
  })

  // A session date that is not today is a fact, not an error: the desk labels it as yesterday.
  await withStub({}, async () => {
    const previous = await fetchTrendSeries(targetFor('600519.SH', 'a-share'), { signal: AbortSignal.timeout(5_000), now: NEXT_MORNING })
    assert.equal(previous.session_status, 'previous')
    assert.equal(previous.stale, false)
  })
})

test('解析护栏：行形态、时间倒流、空序列都响亮失败；累计量回退只当一次重述', async () => {
  const start = Date.parse('2026-11-17T09:00:00+08:00')

  // 300803.SZ 真报文：盘后最后一行把成交额改低 0.04%（创业板盘后定价到 15:30）。整块分时不许因此判死。
  await withStub({ tencent: TENCENT_300803_AFTER_HOURS }, async () => {
    const series = await fetchTrendSeries(targetFor('300803.SZ', 'a-share'), {
      signal: AbortSignal.timeout(5_000),
      now: Date.parse('2026-11-18T15:40:00+08:00'),
    })
    assert.equal(series.session_status, 'closed')
    assert.ok(series.points.length > 200, `只留盘中，实得 ${series.points.length} 根`)
    assert.equal(series.points[series.points.length - 1][0], '15:00', '15:05 之后的盘后定价行不上图')
    assert.ok(series.points.every((point) => point[3] >= 0 && point[4] >= 0), '回退不许变成负的成交量/额')
    assert.equal(series.volume, 144232, '成交量取报价口径，不含盘后定价')
  })

  // 回退落在盘中的行上：那一根 delta 归零，后面接着按高水位继续累计。
  const restated = JSON.stringify({
    code: 0,
    data: {
      sh600519: {
        data: { date: '20261117', data: ['0930 10.00 500 5000.00', '0931 10.10 480 4900.00', '0932 10.20 520 5300.00'] },
        qt: { sh600519: [, 'x', '600519', '10.20', '10.00', '10.00', '520', , , , , , , , , , , , , , , , , , , , , , , , , , , '10.20', '9.40'] },
      },
    },
  })
  await withStub({ tencent: restated }, async () => {
    const series = await fetchTrendSeries(targetFor('600519.SH', 'a-share'), { signal: AbortSignal.timeout(5_000), now: start })
    // 高水位留在 500：0932 的 520 只算新增 20 股，回退的 480 不加回也不倒扣。
    assert.deepEqual(series.points.map((point) => point[3]), [500, 0, 20], '回退那一根没有新成交')
    assert.deepEqual(series.points.map((point) => point[4]), [5000, 0, 300])
    assert.ok(series.points.every((point) => point[2] > 0), '均价仍按累计额算')
  })

  // 时间倒流不是重述而是坏报文：横轴会回头，必须响亮失败。
  const reversed = JSON.stringify({
    code: 0,
    data: {
      sh600519: {
        data: { date: '20261117', data: ['0931 10.00 500 5000.00', '0930 10.10 600 6100.00'] },
        qt: { sh600519: [, 'x', '600519', '10.10', '10.00', '10.00', '600'] },
      },
    },
  })
  await withStub({ tencent: reversed }, async () => {
    await assert.rejects(
      fetchTrendSeries(targetFor('600519.SH', 'a-share'), { signal: AbortSignal.timeout(5_000), now: start }),
      (error) => error.code === 'trend_parse_failed' && /time moved backwards/u.test(error.message),
    )
  })

  const malformed = JSON.stringify({
    code: 0,
    data: {
      sh600519: {
        data: { date: '20261117', data: ['0930 10.00 500'] },
        qt: { sh600519: [, 'x', '600519', '10.10', '10.00', '10.00', '500'] },
      },
    },
  })
  await withStub({ tencent: malformed }, async () => {
    await assert.rejects(
      fetchTrendSeries(targetFor('600519.SH', 'a-share'), { signal: AbortSignal.timeout(5_000), now: start }),
      (error) => error.code === 'trend_parse_failed' && /row shape changed/u.test(error.message),
    )
  })

  const empty = JSON.stringify({ rc: 0, data: { preClose: 10, trends: [] } })
  await withStub({ eastmoney: empty }, async () => {
    await assert.rejects(
      fetchTrendSeries(targetFor('AAPL.OQ', 'us-stock'), { signal: AbortSignal.timeout(5_000), now: start }),
      (error) => error.code === 'trend_unavailable' && /no points/u.test(error.message),
    )
  })
})
