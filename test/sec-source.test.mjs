import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSecSources } from '../lib/sources/sec-http.js'

// ⛔ 这些 fixture 按 SEC 公开文档的报文形状手写，**尚未经过真报文核对**（写代码时本机出口被 SEC
// Akamai 限流）。真报文核对通过之前，createSecSources() 不接入生产；接入前先跑
// `npm run contract:probe -- --only sec`，任何字段映射不符都在这里补 fixture 再改解析。

const signal = new AbortController().signal
const session = { id: 'sec', header: { cwd: '/workspace/project' } }

function sourceMap() {
  return Object.fromEntries(createSecSources().map((source) => [source.schema.capability, source]))
}

function textResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

const COMPANY_TICKERS = JSON.stringify({
  0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  1: { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft Corp' },
})

const SUBMISSIONS = JSON.stringify({
  cik: '320193',
  entityName: 'Apple Inc.',
  filings: {
    recent: {
      accessionNumber: ['0000320193-26-000123', '0000320193-26-000120', '0000320193-26-000100'],
      filingDate: ['2026-11-25', '2026-11-20', '2026-11-01'],
      reportDate: ['2026-09-26', '', '2026-09-26'],
      acceptanceDateTime: ['2026-11-25T16:30:00.000Z', '2026-11-20T21:00:00.000Z', '2026-11-01T12:00:00.000Z'],
      form: ['8-K', '10-K', '4'],
      primaryDocument: ['aapl-20261125.htm', 'aapl-20260926.htm', 'xslF345X05/doc4.xml'],
      primaryDocDescription: ['Current report', 'Annual report', ''],
      items: ['2.02,9.01', '', ''],
      size: [12345, 987654, 4321],
      isXBRL: [0, 1, 0],
      isInlineXBRL: [0, 1, 0],
      fileNumber: ['001-36743', '001-36743', '001-36743'],
      filmNumber: ['261234567', '261111111', ''],
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

const DAILY_INDEX_SPACED = [
  'Form Type   Company Name                                     CIK         Date Filed  File Name',
  '--------------------------------------------------------------------------------------------------------',
  '8-K        Apple Inc.                                        320193      2026-11-25  edgar/data/320193/000032019326000123/0000320193-26-000123-index.htm',
].join('\n')

const FTS = JSON.stringify({
  total: { value: 2, relation: 'eq' },
  hits: {
    hits: [
      { _id: '0000320193-26-000123:aapl-20261125.htm', _source: { ciks: ['0000320193'], display_names: ['Apple Inc. (CIK 0000320193)'], form: '8-K', file_date: '2026-11-25', period_ending: '2026-11-25', file_type: '8-K', accession_no: '0000320193-26-000123' } },
      { _id: '0000789019-26-000045:msft-20260930.htm', _source: { ciks: ['0000789019'], display_names: ['Microsoft Corp (CIK 0000789019)'], form: '10-Q', file_date: '2026-11-20', period_ending: '2026-09-30', file_type: '10-Q', accession_no: '0000789019-26-000045' } },
    ],
  },
})

test('sec_ticker_cik：批量映射、CIK 零填充、未收录 ticker 显式 found=false', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => textResponse(COMPANY_TICKERS)
  try {
    const source = sourceMap().sec_ticker_cik
    const result = await source.execute({ capability: 'sec_ticker_cik', params: { tickers: ['aapl', 'MSFT', 'ZZZZ'] }, session }, signal)
    assert.deepEqual(result.data, [
      { ticker: 'AAPL', cik: '0000320193', company_name: 'Apple Inc.', found: true },
      { ticker: 'MSFT', cik: '0000789019', company_name: 'Microsoft Corp', found: true },
      { ticker: 'ZZZZ', cik: null, company_name: null, found: false },
    ])
    await assert.rejects(
      () => source.execute({ capability: 'sec_ticker_cik', params: { tickers: [] }, session }, signal),
      /non-empty array/,
    )
  } finally { globalThis.fetch = originalFetch }
})

test('sec_filings：列式 recent 转行、form 精确过滤、url 由 cik+accession 拼出', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(new URL(url))
    return textResponse(SUBMISSIONS)
  }
  try {
    const source = sourceMap().sec_filings
    const result = await source.execute({ capability: 'sec_filings', params: { cik: '320193', form: '8-K' }, session }, signal)
    assert.equal(calls[0].host, 'data.sec.gov')
    assert.equal(calls[0].pathname, '/submissions/CIK0000320193.json')
    assert.equal(result.data.length, 1, 'form 精确过滤后只剩 8-K')
    const [row] = result.data
    assert.equal(row.cik, '0000320193')
    assert.equal(row.company_name, 'Apple Inc.')
    assert.equal(row.form, '8-K')
    assert.equal(row.filing_date, '2026-11-25')
    assert.equal(row.report_date, '2026-09-26')
    assert.equal(row.items, '2.02,9.01')
    assert.equal(row.size, 12345)
    assert.equal(row.is_xbrl, false)
    assert.equal(row.is_inline_xbrl, false)
    assert.equal(row.url, 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/aapl-20261125.htm')

    const tenK = await source.execute({ capability: 'sec_filings', params: { cik: '0000320193', form: '10-K' }, session }, signal)
    assert.equal(tenK.data[0].is_xbrl, true)
    // reportDate 空串 → null，不是空字符串也不是 0
    assert.equal(tenK.data[0].report_date, null)

    const limited = await source.execute({ capability: 'sec_filings', params: { cik: '320193', limit: 2 }, session }, signal)
    assert.equal(limited.data.length, 2)
    await assert.rejects(
      () => source.execute({ capability: 'sec_filings', params: { cik: '320193', ticker: 'AAPL' }, session }, signal),
      /exactly one of ticker or cik/,
    )
  } finally { globalThis.fetch = originalFetch }
})

test('sec_daily_filings：竖线与空格两种 idx 表头都按名字解析，404 响亮失败', async () => {
  const originalFetch = globalThis.fetch
  let body = DAILY_INDEX_PIPE
  let status = 200
  globalThis.fetch = async () => textResponse(body, status)
  try {
    const source = sourceMap().sec_daily_filings
    const piped = await source.execute({ capability: 'sec_daily_filings', params: { filing_date: '2026-11-25' }, session }, signal)
    assert.equal(piped.data.length, 2)
    assert.equal(piped.data[0].form_type, '8-K')
    assert.equal(piped.data[0].cik, '0000320193')
    assert.equal(piped.data[0].url, 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/0000320193-26-000123-index.htm')
    const only8k = await source.execute({ capability: 'sec_daily_filings', params: { filing_date: '2026-11-25', form: '8-K' }, session }, signal)
    assert.equal(only8k.data.length, 1)

    body = DAILY_INDEX_SPACED
    const spaced = await source.execute({ capability: 'sec_daily_filings', params: { filing_date: '2026-11-25' }, session }, signal)
    assert.equal(spaced.data.length, 1)
    assert.equal(spaced.data[0].company_name, 'Apple Inc.')

    status = 404
    await assert.rejects(
      () => source.execute({ capability: 'sec_daily_filings', params: { filing_date: '2026-11-21' }, session }, signal),
      /HTTP 404/,
    )
  } finally { globalThis.fetch = originalFetch }
})

test('sec_fulltext_search：_id 拆 accession 与文件名，cik 零填充并拼 url', async () => {
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return textResponse(FTS)
  }
  try {
    const source = sourceMap().sec_fulltext_search
    const result = await source.execute({ capability: 'sec_fulltext_search', params: { q: '"apple"', forms: ['8-K'], start_date: '2026-11-01', end_date: '2026-11-25' }, session }, signal)
    assert.equal(requested.host, 'efts.sec.gov')
    assert.equal(requested.searchParams.get('q'), '"apple"')
    assert.equal(requested.searchParams.get('forms'), '8-K')
    assert.equal(requested.searchParams.get('dateRange'), 'custom')
    assert.equal(result.data.length, 2)
    const [first] = result.data
    assert.equal(first.accession_number, '0000320193-26-000123')
    assert.equal(first.cik, '0000320193')
    assert.equal(first.file_name, 'aapl-20261125.htm')
    assert.equal(first.url, 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/aapl-20261125.htm')
    await assert.rejects(
      () => source.execute({ capability: 'sec_fulltext_search', params: { q: 'x', start_date: '2026-11-01' }, session }, signal),
      /must be given together/,
    )
  } finally { globalThis.fetch = originalFetch }
})

test('sec_market_frame：frames 横截面映射，instant 行 start_date 为 null，空 data 合法', async () => {
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return textResponse(JSON.stringify({
      taxonomy: 'us-gaap', tag: 'Assets', ccp: 'CY2025Q1I', uom: 'USD', label: 'Assets', pts: 2,
      data: [
        { accn: '0001410578-25-000519', cik: 1750, entityName: 'AAR CORP', loc: 'US-IL', end: '2025-02-28', val: 2859100000 },
        { accn: '0000001961-26-000014', cik: 1961, entityName: 'GEMAXEL INC.', loc: 'US-FL', end: '2025-03-31', val: 9959 },
      ],
    }))
  }
  try {
    const source = sourceMap().sec_market_frame
    const result = await source.execute({ capability: 'sec_market_frame', params: { tag: 'Assets', period: 'cy2025q1i' }, session }, signal)
    assert.equal(requested.pathname, '/api/xbrl/frames/us-gaap/Assets/USD/CY2025Q1I.json')
    assert.equal(result.data.length, 2)
    assert.equal(result.data[0].cik, '0000001750', 'CIK 补零到 10 位')
    assert.equal(result.data[0].entity_name, 'AAR CORP')
    assert.equal(result.data[0].value, 2859100000)
    assert.equal(result.data[0].start_date, null, 'instant 帧没有 start')
    assert.equal(result.data[0].end_date, '2025-02-28')
    assert.equal(result.data[0].location, 'US-IL')
    await assert.rejects(
      () => source.execute({ capability: 'sec_market_frame', params: { tag: 'Assets', period: '2025Q1' }, session }, signal),
      /period must look like/,
    )
    globalThis.fetch = async () => textResponse(JSON.stringify({ taxonomy: 'us-gaap', tag: 'Assets', ccp: 'CY2025Q1I', uom: 'USD', pts: 0, data: [] }))
    const empty = await source.execute({ capability: 'sec_market_frame', params: { tag: 'Assets', period: 'CY2025Q1I' }, session }, signal)
    assert.deepEqual(empty.data, [])
  } finally { globalThis.fetch = originalFetch }
})
