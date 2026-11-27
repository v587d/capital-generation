import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createUsOfficialSources } from '../lib/sources/us-official-http.js'

const signal = new AbortController().signal
const session = { id: 'us-official', header: { cwd: '/workspace/project' } }

function sourceMap() {
  return Object.fromEntries(createUsOfficialSources().map((source) => [source.schema.capability, source]))
}

function textResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

const TREASURY_2019 = 'Date,"1 Mo","2 Mo","3 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"\n'
  + '12/31/2019,1.48,1.51,1.55,1.60,1.59,1.58,1.62,1.69,1.83,1.92,2.25,2.39\n'
  + '12/30/2019,1.51,1.53,1.57,1.60,1.57,1.58,1.59,1.68,1.81,1.90,2.21,2.34\n'

test('us_treasury_yield_curve：表头按名字映射，缺列补 null，输出按日期升序', async () => {
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return textResponse(TREASURY_2019)
  }
  try {
    const source = sourceMap().us_treasury_yield_curve
    const result = await source.execute({ capability: 'us_treasury_yield_curve', params: { start_date: '2019-12-29', end_date: '2019-12-31' }, session }, signal)
    assert.equal(requested.host, 'home.treasury.gov')
    assert.match(requested.pathname, /\/daily-treasury-rates\.csv\/2019\/all$/)
    assert.equal(requested.searchParams.get('type'), 'daily_treasury_yield_curve')
    assert.equal(requested.searchParams.get('field_tdr_date_value'), '2019')
    assert.deepEqual(result.data.map((row) => row.date), ['2019-12-30', '2019-12-31'])
    const [first] = result.data
    assert.equal(first.d1m, 1.51)
    assert.equal(first.d10y, 1.9)
    // 2019 文件没有 1.5 Month / 4 Mo 两列：显式 null，不是缺键也不是 0。
    assert.equal(first.d1_5m, null)
    assert.equal(first.d4m, null)
  } finally { globalThis.fetch = originalFetch }
})

test('us_treasury_yield_curve：表头/行宽/日期畸形与同日重复都响亮失败', async () => {
  const originalFetch = globalThis.fetch
  const source = sourceMap().us_treasury_yield_curve
  const run = (body) => {
    globalThis.fetch = async () => textResponse(body)
    return source.execute({ capability: 'us_treasury_yield_curve', params: { start_date: '2019-12-29', end_date: '2019-12-31' }, session }, signal)
  }
  try {
    await assert.rejects(() => run('DATE,"1 Mo"\n12/30/2019,1.51\n'), /header changed/)
    await assert.rejects(() => run('Date,"1 Mo"\n12/30/2019,1.51,9.99\n'), /row has 3 cells/)
    await assert.rejects(() => run('Date,"1 Mo"\n2019-12-30,1.51\n'), /M\/D\/YYYY/)
    await assert.rejects(() => run('Date,"1 Mo"\n12/30/2019,1.51\n12/30/2019,1.52\n'), /duplicate date/)
  } finally { globalThis.fetch = originalFetch }
})

test('nyfed_reference_rates：字段映射、百分数原值、空区间是合法空', async () => {
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return textResponse(JSON.stringify({ refRates: [
      { effectiveDate: '2026-11-24', type: 'EFFR', percentRate: 3.88, percentPercentile1: 3.85, percentPercentile25: 3.88, percentPercentile75: 3.89, percentPercentile99: 3.95, targetRateFrom: 3.75, targetRateTo: 4, volumeInBillions: 88, revisionIndicator: '' },
      { effectiveDate: '2026-11-23', type: 'EFFR', percentRate: 3.88, volumeInBillions: 87, revisionIndicator: '' },
    ] }))
  }
  try {
    const source = sourceMap().nyfed_reference_rates
    const result = await source.execute({ capability: 'nyfed_reference_rates', params: { rate: 'EFFR', start_date: '2026-11-23', end_date: '2026-11-24' }, session }, signal)
    assert.equal(requested.pathname, '/api/rates/unsecured/effr/search.json')
    assert.equal(requested.searchParams.get('startDate'), '2026-11-23')
    assert.deepEqual(result.data.map((row) => row.effective_date), ['2026-11-23', '2026-11-24'])
    const [first, second] = result.data
    assert.equal(first.percent_rate, 3.88)
    assert.equal(first.volume_billions, 87)
    assert.equal(first.revision_indicator, null, '空串 revisionIndicator 是 null')
    assert.equal(second.target_rate_from, 3.75)
    assert.equal(second.percentile_99, 3.95)

    globalThis.fetch = async () => textResponse(JSON.stringify({ refRates: [] }))
    const empty = await source.execute({ capability: 'nyfed_reference_rates', params: { rate: 'sofr', start_date: '2026-11-21', end_date: '2026-11-22' }, session }, signal)
    assert.deepEqual(empty.data, [], '周末空区间是成功空数组')
  } finally { globalThis.fetch = originalFetch }
})

test('nyfed_reference_rates：未知 rate 出网前拒绝；refRates 缺失/重复日期响亮失败', async () => {
  const originalFetch = globalThis.fetch
  const source = sourceMap().nyfed_reference_rates
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return textResponse('{}') }
  try {
    await assert.rejects(
      () => source.execute({ capability: 'nyfed_reference_rates', params: { rate: 'sonia', start_date: '2026-11-01', end_date: '2026-11-02' }, session }, signal),
      /rate must be one of/,
    )
    assert.equal(calls, 0, '参数错误不发请求')
    await assert.rejects(
      () => source.execute({ capability: 'nyfed_reference_rates', params: { rate: 'sofr', start_date: '2026-11-01', end_date: '2026-11-02' }, session }, signal),
      /refRates missing/,
    )
    globalThis.fetch = async () => textResponse(JSON.stringify({ refRates: [
      { effectiveDate: '2026-11-03', type: 'SOFR' },
      { effectiveDate: '2026-11-03', type: 'SOFR' },
    ] }))
    await assert.rejects(
      () => source.execute({ capability: 'nyfed_reference_rates', params: { rate: 'sofr', start_date: '2026-11-01', end_date: '2026-11-04' }, session }, signal),
      /duplicate effectiveDate/,
    )
  } finally { globalThis.fetch = originalFetch }
})

// ── FINRA ────────────────────────────────────────────────────────────────────

const FINRA_SHORT_VOLUME = 'Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\r\n'
  + '20261125|AAPL|9758284.194435|27391.31|16888251.033617|B,Q,N\r\n'
  + '20261125|MSFT|3667369.01856|20396|8092743.376544|B,Q,N\r\n'
  + '2\r\n'

test('finra_short_volume：解析小数成交量与末尾行数校验，symbols 本地过滤', async () => {
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return textResponse(FINRA_SHORT_VOLUME)
  }
  try {
    const source = sourceMap().finra_short_volume
    const result = await source.execute({ capability: 'finra_short_volume', params: { trade_date: '2026-11-25', symbols: ['aapl'] }, session }, signal)
    assert.equal(requested.host, 'cdn.finra.org')
    assert.equal(requested.pathname, '/equity/regsho/daily/CNMSshvol20261125.txt')
    assert.equal(result.data.length, 1, 'symbols 过滤后只剩 AAPL')
    const [row] = result.data
    assert.equal(row.trade_date, '2026-11-25')
    assert.equal(row.symbol, 'AAPL')
    assert.equal(row.short_volume, 9758284.194435, '成交量是小数，不是整数')
    assert.equal(row.total_volume, 16888251.033617)
    assert.equal(row.market, 'B,Q,N')
  } finally { globalThis.fetch = originalFetch }
})

test('finra_short_volume：行数与 trailer 不符、表头变化、未发布日都响亮失败', async () => {
  const originalFetch = globalThis.fetch
  const source = sourceMap().finra_short_volume
  try {
    globalThis.fetch = async () => textResponse(FINRA_SHORT_VOLUME.replace('\r\n2\r\n', '\r\n3\r\n'))
    await assert.rejects(
      () => source.execute({ capability: 'finra_short_volume', params: { trade_date: '2026-11-25' }, session }, signal),
      /trailer declares 3 rows but 2 parsed/,
    )
    globalThis.fetch = async () => textResponse('Date|Symbol|ShortVolume\n20261125|AAPL|1\n')
    await assert.rejects(
      () => source.execute({ capability: 'finra_short_volume', params: { trade_date: '2026-11-25' }, session }, signal),
      /header changed/,
    )
    globalThis.fetch = async () => textResponse('', 403)
    await assert.rejects(
      () => source.execute({ capability: 'finra_short_volume', params: { trade_date: '2026-11-21' }, session }, signal),
      (error) => error?.code === 'finra_not_published',
    )
  } finally { globalThis.fetch = originalFetch }
})

test('finra_short_interest：字段映射、204 合法空、未知参数与超量 symbols 出网前拒绝', async () => {
  const originalFetch = globalThis.fetch
  let body
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body)
    if (body.compareFilters[1].fieldValue === 'MSFT') return textResponse('', 204)
    return textResponse(JSON.stringify([{
      symbolCode: 'AAPL', issueName: 'Apple Inc. Common Stock', settlementDate: '2026-11-13',
      currentShortPositionQuantity: 143471087, previousShortPositionQuantity: 144791472,
      changePreviousNumber: -1320385, changePercent: -0.91, averageDailyVolumeQuantity: 51185713,
      daysToCoverQuantity: 2.8, marketClassCode: 'NNM', issuerServicesGroupExchangeCode: 'R',
      stockSplitFlag: null, revisionFlag: null, accountingYearMonthNumber: 20261113,
    }]))
  }
  try {
    const source = sourceMap().finra_short_interest
    const result = await source.execute({ capability: 'finra_short_interest', params: { symbols: ['AAPL', 'MSFT'], settlement_date: '2026-11-13' }, session }, signal)
    assert.equal(body.compareFilters[0].fieldValue, '2026-11-13')
    assert.equal(result.data.length, 1, 'MSFT 的 204 是合法空，不产生行也不报错')
    const [row] = result.data
    assert.equal(row.symbol, 'AAPL')
    assert.equal(row.current_short_position, 143471087)
    assert.equal(row.change_percent, -0.91)
    assert.equal(row.days_to_cover, 2.8)
    assert.equal(row.accounting_year_month, 20261113)
    await assert.rejects(
      () => source.execute({ capability: 'finra_short_interest', params: { symbols: Array.from({ length: 11 }, (_, i) => `S${i}`) }, session }, signal),
      /exceeds maximum 10/,
    )
    await assert.rejects(
      () => source.execute({ capability: 'finra_short_interest', params: { symbols: ['AAPL'], settlement_date: '2026-13-01' }, session }, signal),
      /YYYY-MM-DD/,
    )
  } finally { globalThis.fetch = originalFetch }
})
