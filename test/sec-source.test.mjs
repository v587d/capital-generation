import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSecSources } from '../lib/sources/sec-http.js'

// Official payload excerpts. The wrapped fixed-width idx header is from SEC's 2018-12-31 file;
// the live 2026 idx remains unverified because direct access is 403 and the host extractor rejects .idx.
const signal = new AbortController().signal
const session = { id: 'sec', header: { cwd: '/workspace/project' } }

function sourceMap() {
  return Object.fromEntries(createSecSources().map((source) => [source.schema.capability, source]))
}

function textResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

function assertRowGuard(source, rows, row, requiredKey) {
  assert.equal(source.validateOutput(rows), true)
  assert.equal(source.validateOutput([{ ...row, rogue: 1 }]), false, 'additionalProperties: false')
  assert.equal(source.validateOutput([{ ...row, [requiredKey]: undefined }]), false, 'required key')
}

const COMPANY_TICKERS = JSON.stringify({
  0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  1: { cik_str: 789019, ticker: 'MSFT', title: 'MICROSOFT CORP' },
})

const SUBMISSIONS = JSON.stringify({
  cik: '0000320193',
  name: 'Apple Inc.',
  tickers: ['AAPL'],
  filings: {
    recent: {
      accessionNumber: ['0001950047-26-011560', '0001140361-26-045775', '0001950047-26-011519', '0000320193-26-000026'],
      filingDate: ['2026-11-27', '2026-11-25', '2026-11-25', '2026-11-03'],
      reportDate: ['', '2026-11-24', '', '2026-09-26'],
      acceptanceDateTime: ['2026-11-27T13:06:41.000Z', '2026-11-25T18:30:25.000Z', '2026-11-25T16:03:28.000Z', '2026-11-03T08:05:15.000Z'],
      form: ['144', '4', '144', '10-K'],
      primaryDocument: ['xsl144X01/primary_doc.xml', 'xslF345X06/form4.xml', 'xsl144X01/primary_doc.xml', 'aapl-20260926.htm'],
      primaryDocDescription: ['', 'FORM 4', '', '10-K'],
      items: ['', '', '', ''],
      size: [4616, 3294, 3880, 1650003],
      isXBRL: [0, 0, 0, 1],
      isInlineXBRL: [0, 0, 0, 1],
      fileNumber: ['001-36743', '001-36743', '001-36743', '001-36743'],
      filmNumber: ['261605483', '261602386', '261600299', '261514222'],
    },
    files: [],
  },
})

const DAILY_INDEX_PIPE = [
  'Description:           Daily Index of EDGAR Dissemination Feed',
  'Last Data Received:    November 25, 2026',
  '',
  'Form Type|Company Name|CIK|Date Filed|File Name',
  '--------------------------------------------------------------------------------------------------------',
  '8-K|Apple Inc.|320193|2026-11-25|edgar/data/320193/000032019326000123/0000320193-26-000123-index.htm',
  '10-Q|Microsoft Corp|789019|2026-11-25|edgar/data/789019/000078901926000045/0000789019-26-000045-index.htm',
].join('\n')

const DAILY_INDEX_WRAPPED = [
  'Description:           Daily Index of EDGAR Dissemination Feed by Form Type',
  'Last Data Received:    Dec 31, 2018',
  'Comments:              webmaster@sec.gov',
  'Anonymous FTP:         ftp://ftp.sec.gov/edgar/',
  '',
  '',
  '',
  'Form Type   Company Name                                                  CIK',
  '      Date Filed  File Name',
  '---------------------------------------------------------------------------------------------------------------------------------------------',
  '1-A/A       American Diversified Energy LLC                               1689500     20181231    edgar/data/1689500/0001683168-18-003825.txt',
  '1-A/A       UMBRA Technologies (US) Inc.                                  1742808     20181231    edgar/data/1742808/0001742808-18-000004.txt',
].join('\n')

const FTS = JSON.stringify({
  total: { value: 2, relation: 'eq' },
  hits: {
    hits: [
      {
        _id: '0001185185-13-001618:ex99-8.htm',
        _source: {
          ciks: ['0001418121'], display_names: ['Apple REIT Nine, Inc.  (APLE)  (CIK 0001418121)'],
          form: '8-K', adsh: '0001185185-13-001618', file_date: '2013-08-08', period_ending: '2013-08-07', file_type: 'EX-99.8',
        },
      },
      {
        _id: '0001193125-18-154515:d563832dex991.htm',
        _source: {
          ciks: ['0000320193'], display_names: ['APPLE INC  (AAPL)  (CIK 0000320193)'],
          form: '8-K', adsh: '0001193125-18-154515', file_date: '2018-05-07', period_ending: '2018-04-30', file_type: 'EX-99.1',
        },
      },
    ],
  },
})

const FRAMES_INSTANT = JSON.stringify({
  taxonomy: 'us-gaap', tag: 'Assets', ccp: 'CY2025Q1I', uom: 'USD', label: 'Assets', pts: 3,
  data: [
    { accn: '0001410578-25-000519', cik: 1750, entityName: 'AAR CORP', loc: 'US-IL', end: '2025-02-28', val: 2859100000 },
    { accn: '0001628280-25-021090', cik: 1800, entityName: 'ABBOTT LABORATORIES', loc: 'US-IL', end: '2025-03-31', val: 81448000000 },
    { accn: '0000001961-26-000014', cik: 1961, entityName: 'GEMAXEL INC. (formerly known as Worlds Inc.)', loc: 'US-FL', end: '2025-03-31', val: 9959 },
  ],
})

const FRAMES_DURATION = JSON.stringify({
  taxonomy: 'us-gaap', tag: 'Revenues', ccp: 'CY2025Q1', uom: 'USD', label: 'Revenues', pts: 2,
  data: [
    { accn: '0001193125-26-209010', cik: 2098, entityName: 'ACME UNITED CORP', loc: 'US-CT', start: '2025-01-01', end: '2025-03-31', val: 45958000 },
    { accn: '0000002969-26-000020', cik: 2969, entityName: 'AIR PRODUCTS AND CHEMICALS, INC.', loc: 'US-PA', start: '2025-01-01', end: '2025-03-31', val: 2916200000 },
  ],
})

test('sec_ticker_cik：批量映射、CIK 零填充、未收录 ticker 显式 found=false', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => textResponse(COMPANY_TICKERS)
  try {
    const source = sourceMap().sec_ticker_cik
    const result = await source.execute({ capability: 'sec_ticker_cik', params: { tickers: ['aapl', 'MSFT', 'ZZZZ'] }, session }, signal)
    assert.deepEqual(result.data, [
      { ticker: 'AAPL', cik: '0000320193', company_name: 'Apple Inc.', found: true },
      { ticker: 'MSFT', cik: '0000789019', company_name: 'MICROSOFT CORP', found: true },
      { ticker: 'ZZZZ', cik: null, company_name: null, found: false },
    ])
    assertRowGuard(source, result.data, result.data[0], 'ticker')
    assert.equal(source.validateOutput([{ ...result.data[0], found: 'yes' }]), false)
    await assert.rejects(
      () => source.execute({ capability: 'sec_ticker_cik', params: { tickers: [] }, session }, signal),
      /non-empty array/,
    )
  } finally { globalThis.fetch = originalFetch }
})

test('sec_filings：真实 recent 列转行、form 过滤、ticker 路径与完整 schema guard', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(new URL(url))
    return textResponse(String(url).includes('company_tickers') ? COMPANY_TICKERS : SUBMISSIONS)
  }
  try {
    const source = sourceMap().sec_filings
    const result = await source.execute({ capability: 'sec_filings', params: { cik: '320193', form: '4' }, session }, signal)
    assert.equal(calls[0].host, 'data.sec.gov')
    assert.equal(calls[0].pathname, '/submissions/CIK0000320193.json')
    assert.equal(result.data.length, 1, 'form 精确过滤后只剩 4')
    const [row] = result.data
    assert.equal(row.cik, '0000320193')
    assert.equal(row.company_name, 'Apple Inc.', 'entityName 缺席时回退到真实 payload 的 name')
    assert.equal(row.form, '4')
    assert.equal(row.filing_date, '2026-11-25')
    assert.equal(row.report_date, '2026-11-24')
    assert.equal(row.items, null)
    assert.equal(row.size, 3294)
    assert.equal(row.is_xbrl, false)
    assert.equal(row.is_inline_xbrl, false)
    assert.equal(row.url, 'https://www.sec.gov/Archives/edgar/data/320193/000114036126045775/xslF345X06/form4.xml')

    const tenK = await source.execute({ capability: 'sec_filings', params: { cik: '0000320193', form: '10-K' }, session }, signal)
    assert.equal(tenK.data[0].is_xbrl, true)
    assert.equal(tenK.data[0].report_date, '2026-09-26')

    const limited = await source.execute({ capability: 'sec_filings', params: { cik: '320193', limit: 2 }, session }, signal)
    assert.equal(limited.data.length, 2)

    const byTicker = await source.execute({ capability: 'sec_filings', params: { ticker: 'AAPL', limit: 1 }, session }, signal)
    assert.equal(byTicker.data[0].cik, '0000320193')
    assert.equal(byTicker.data[0].company_name, 'Apple Inc.')
    assertRowGuard(source, result.data, row, 'accession_number')
    await assert.rejects(
      () => source.execute({ capability: 'sec_filings', params: { cik: '320193', ticker: 'AAPL' }, session }, signal),
      /exactly one of ticker or cik/,
    )
  } finally { globalThis.fetch = originalFetch }
})

test('sec_daily_filings：pipe 与真实跨行定宽表头都按名字解析，404 响亮失败', async () => {
  const originalFetch = globalThis.fetch
  let body = DAILY_INDEX_PIPE
  let status = 200
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return textResponse(body, status)
  }
  try {
    const source = sourceMap().sec_daily_filings
    const piped = await source.execute({ capability: 'sec_daily_filings', params: { filing_date: '2026-11-25' }, session }, signal)
    assert.equal(requested.pathname, '/Archives/edgar/daily-index/2026/QTR4/form.20261125.idx')
    assert.equal(piped.data.length, 2)
    assert.equal(piped.data[0].form_type, '8-K')
    assert.equal(piped.data[0].cik, '0000320193')
    assert.equal(piped.data[0].url, 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/0000320193-26-000123-index.htm')
    const only8k = await source.execute({ capability: 'sec_daily_filings', params: { filing_date: '2026-11-25', form: '8-K' }, session }, signal)
    assert.equal(only8k.data.length, 1)

    body = DAILY_INDEX_WRAPPED
    const wrapped = await source.execute({ capability: 'sec_daily_filings', params: { filing_date: '2018-12-31' }, session }, signal)
    assert.equal(requested.pathname, '/Archives/edgar/daily-index/2018/QTR4/form.20181231.idx')
    assert.equal(wrapped.data.length, 2)
    assert.equal(wrapped.data[0].company_name, 'American Diversified Energy LLC')
    assert.equal(wrapped.data[0].filing_date, '2018-12-31')
    assert.equal(wrapped.data[0].cik, '0001689500')
    assertRowGuard(source, wrapped.data, wrapped.data[0], 'file_name')

    status = 404
    await assert.rejects(
      () => source.execute({ capability: 'sec_daily_filings', params: { filing_date: '2026-11-21' }, session }, signal),
      /HTTP 404/,
    )
  } finally { globalThis.fetch = originalFetch }
})

test('sec_fulltext_search：真实 _source.adsh 优先，cik 零填充并拼 url', async () => {
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return textResponse(FTS)
  }
  try {
    const source = sourceMap().sec_fulltext_search
    const result = await source.execute({ capability: 'sec_fulltext_search', params: { q: '"apple"', forms: ['8-K'], start_date: '2013-01-01', end_date: '2018-12-31' }, session }, signal)
    assert.equal(requested.host, 'efts.sec.gov')
    assert.equal(requested.searchParams.get('q'), '"apple"')
    assert.equal(requested.searchParams.get('forms'), '8-K')
    assert.equal(requested.searchParams.get('dateRange'), 'custom')
    assert.equal(result.data.length, 2)
    const [first] = result.data
    assert.equal(first.accession_number, '0001185185-13-001618')
    assert.equal(first.cik, '0001418121')
    assert.equal(first.file_name, 'ex99-8.htm')
    assert.equal(first.url, 'https://www.sec.gov/Archives/edgar/data/1418121/000118518513001618/ex99-8.htm')
    assertRowGuard(source, result.data, first, 'accession_number')
    await assert.rejects(
      () => source.execute({ capability: 'sec_fulltext_search', params: { q: 'x', start_date: '2026-11-01' }, session }, signal),
      /must be given together/,
    )
  } finally { globalThis.fetch = originalFetch }
})

test('sec_market_frame：真实 instant/duration 映射、空 data 合法与完整 schema guard', async () => {
  const originalFetch = globalThis.fetch
  let requested
  let body = FRAMES_INSTANT
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return textResponse(body)
  }
  try {
    const source = sourceMap().sec_market_frame
    const instant = await source.execute({ capability: 'sec_market_frame', params: { tag: 'Assets', period: 'cy2025q1i' }, session }, signal)
    assert.equal(requested.pathname, '/api/xbrl/frames/us-gaap/Assets/USD/CY2025Q1I.json')
    assert.equal(instant.data.length, 3)
    assert.equal(instant.data[0].cik, '0000001750', 'CIK 补零到 10 位')
    assert.equal(instant.data[0].entity_name, 'AAR CORP')
    assert.equal(instant.data[0].value, 2859100000)
    assert.equal(instant.data[0].start_date, null, 'instant 帧没有 start')
    assert.equal(instant.data[0].end_date, '2025-02-28')
    assert.equal(instant.data[0].location, 'US-IL')
    assertRowGuard(source, instant.data, instant.data[0], 'end_date')

    body = FRAMES_DURATION
    const duration = await source.execute({ capability: 'sec_market_frame', params: { tag: 'Revenues', period: 'CY2025Q1' }, session }, signal)
    assert.equal(requested.pathname, '/api/xbrl/frames/us-gaap/Revenues/USD/CY2025Q1.json')
    assert.equal(duration.data[0].start_date, '2025-01-01')
    assert.equal(duration.data[0].end_date, '2025-03-31')

    await assert.rejects(
      () => source.execute({ capability: 'sec_market_frame', params: { tag: 'Assets', period: '2025Q1' }, session }, signal),
      /period must look like/,
    )
    body = JSON.stringify({ taxonomy: 'us-gaap', tag: 'Assets', ccp: 'CY2025Q1I', uom: 'USD', pts: 0, data: [] })
    const empty = await source.execute({ capability: 'sec_market_frame', params: { tag: 'Assets', period: 'CY2025Q1I' }, session }, signal)
    assert.deepEqual(empty.data, [])
  } finally { globalThis.fetch = originalFetch }
})
