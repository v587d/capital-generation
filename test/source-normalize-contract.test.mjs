import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEastmoneySources } from '../lib/sources/eastmoney-http.js'
import { createSinaSources } from '../lib/sources/sina-http.js'
import { createOfficialSources } from '../lib/sources/official-http.js'
import { createUsOfficialSources } from '../lib/sources/us-official-http.js'
import { createCsindexSources } from '../lib/sources/csindex-http.js'
import { createThsSources } from '../lib/sources/ths-http.js'
import { createPythonSources } from '../lib/sources/python-remote.js'
import { createTencentSources } from '../lib/sources/tencent-http.js'
import { createWindSources } from '../lib/sources/wind-mcp.js'
import { DataCollectorHub } from '../lib/data-collector/hub.js'

const signal = new AbortController().signal
const session = { id: 'normalize-contract', header: { cwd: '/workspace/project' } }

// Minimum valid params for every public HTTP / MCP capability. Fuyao's 61 rows live in
// scripts/smoke-fuyao.mjs `PARAMS`; same rule on both sides — missing coverage fails, never skipped.
const SAMPLES = {
  eastmoney_top_buy_sell_market: { start_date: '2026-09-01', end_date: '2026-09-24' },
  eastmoney_top_buy_sell_ticker: { ticker: '600519.SH', start_date: '2026-09-01', end_date: '2026-09-24' },
  eastmoney_lockup_expiry: { start_date: '2026-09-01', end_date: '2026-09-30' },
  eastmoney_sector_rotation: { board_type: 'industry', sort_field: 'change_pct' },
  eastmoney_cashflow_rotation: { board_type: 'concept' },
  eastmoney_cpi: { start_date: '2026-01-01', end_date: '2026-09-30' },
  eastmoney_ppi: { start_date: '2026-01-01', end_date: '2026-09-30' },
  eastmoney_gdp: { start_date: '2025-01-01', end_date: '2026-09-30' },
  eastmoney_pmi: { start_date: '2026-01-01', end_date: '2026-09-30' },
  eastmoney_money_supply: { start_date: '2026-01-01', end_date: '2026-09-30' },
  eastmoney_rmb_loan: { start_date: '2026-01-01', end_date: '2026-09-30' },
  eastmoney_customs_trade: { start_date: '2026-01-01', end_date: '2026-09-30' },
  eastmoney_retail_sales: { start_date: '2026-01-01', end_date: '2026-09-30' },
  eastmoney_deposit_reserve: { start_date: '2021-01-01', end_date: '2026-09-30' },
  eastmoney_mutual_flow: { start_date: '2026-09-01', end_date: '2026-09-30', channel: 'sh_stock_connect' },
  eastmoney_main_capital_snapshot: { ticker: '600519.SH' },
  eastmoney_dividend_plan: { ticker: '600519.SH', start_date: '2020-01-01', end_date: '2026-09-30' },
  eastmoney_holder_number_snapshot: { ticker: '600519.SH' },
  eastmoney_mutual_quota: {},
  eastmoney_margin_trading: { ticker: '600519.SH', start_date: '2026-09-01', end_date: '2026-09-30' },
  eastmoney_convertible_bond_list: { start_date: '2026-01-01', end_date: '2026-09-30', stock_code: '600519' },
  eastmoney_global_quote: { symbols: ['SPX', 'HSI'] },
  eastmoney_global_kline: { symbol: 'NDX', start_date: '2026-11-01', end_date: '2026-11-14' },
  eastmoney_offshore_statements: { secucode: 'AAPL.O', statement: 'balance' },
  eastmoney_offshore_indicators: { secucode: '00700.HK' },
  eastmoney_margin_total: { start_date: '2026-11-01', end_date: '2026-11-14', market: 'all' },
  tencent_quote: { codes: ['600519.SH', '000001.SZ'] },
  tencent_kline: { code: '600519.SH', period: 'day', adjust: 'none', count: 5 },
  tencent_ticks: { code: '600519.SH' },
  tencent_hk_quote: { codes: ['00700'] },
  tencent_us_quote: { codes: ['AAPL'] },
  tencent_hk_index_quote: { codes: ['HSI'] },
  tencent_us_index_quote: { codes: ['IXIC'] },
  tencent_hk_kline: { code: '00700', period: 'day', adjust: 'none', count: 5 },
  tencent_us_kline: { code: 'AAPL.OQ', period: 'day', adjust: 'none', count: 5 },
  tencent_us_prepost_quote: { codes: ['AAPL'] },
  eastmoney_security_profile: { ticker: '600519.SH' },
  eastmoney_st_stock_list: {},
  eastmoney_institution_research: { start_date: '2026-10-01', end_date: '2026-11-21' },
  eastmoney_holder_change: { start_date: '2026-10-01', end_date: '2026-11-21' },
  eastmoney_buyback: {},
  eastmoney_pledge: {},
  eastmoney_new_stock: {},
  sina_etf_option_contracts: { underlying: '510050', side: 'call' },
  us_treasury_yield_curve: { start_date: '2026-11-01', end_date: '2026-11-21' },
  nyfed_reference_rates: { rate: 'sofr', start_date: '2026-11-01', end_date: '2026-11-21' },
  finra_short_volume: { symbols: ['AAPL'] },
  finra_short_interest: { symbols: ['AAPL'] },
  sec_ticker_cik: { tickers: ['AAPL'] },
  sec_filings: { ticker: 'AAPL', limit: 5 },
  sec_daily_filings: { filing_date: '2026-11-25' },
  sec_fulltext_search: { q: '"apple"', forms: ['8-K'], limit: 3 },
  sec_market_frame: { tag: 'Assets', period: 'CY2025Q1I' },
  sina_etf_option_tquote: { codes: ['10012837'] },
  sina_etf_option_greeks: { codes: ['10012837'] },
  sina_a50_futures: {},
  sse_etf_shares: {},
  szse_etf_shares: {},
  chinamoney_repo_fixing: {},
  csindex_index_valuation: { index_code: '000300', start_date: '2026-11-01', end_date: '2026-11-20' },
  eastmoney_limit_up_pool: { trade_date: '2026-11-20' },
  eastmoney_limit_break_pool: { trade_date: '2026-11-20' },
  eastmoney_limit_down_pool: { trade_date: '2026-11-20' },
  eastmoney_yesterday_limit_up_pool: { trade_date: '2026-11-20' },
  eastmoney_price_anomaly_list: {},
  eastmoney_price_anomaly_count: {},
  eastmoney_stock_hot_concepts: { ticker: '600519.SH' },
  ths_hot_list: { type: 'hour' },
  ths_limit_up_detail: {},
  baostock_valuation_history: { code: '600519.SH', start_date: '2026-11-01', end_date: '2026-11-21' },
  baostock_stock_basic: { codes: ['600519.SH'] },
  pbc_social_financing: { months: 12 },
  wind_edb_search: { question: '中国GDP相关指标' },
  wind_edb_query: { indicator: 'M5567876', start_date: '2025-01-01', end_date: '2025-12-31' },
  wind_stock_kline: { code: '600519.SH', start_date: '2026-08-01', end_date: '2026-08-15' },
}

const sources = [...createEastmoneySources(), ...createTencentSources(), ...createSinaSources(), ...createOfficialSources(), ...createUsOfficialSources(), ...createCsindexSources(), ...createThsSources(), ...createPythonSources(async () => { throw new Error('normalize only') }), ...createWindSources(async () => 'secret')]

test('参数样例表必须覆盖全部已注册的公开 HTTP 能力：新增没登记就失败，不静默少测', () => {
  const registered = sources.map((source) => source.schema.capability).sort()
  assert.deepEqual(registered, Object.keys(SAMPLES).sort(), 'SAMPLES 与注册表不一致：缺样例的能力不会被下面的归一化回归覆盖')
})

// normalizeParams runs TWICE per call: once at Hub enqueue (merge key + digest use the normalized
// params, hub.ts normalizeRequest) and once inside createSource's execute, so direct calls get it too.
// Two invariants: ① output keys must be ones the model declared — renaming `ticker` to the internal
// `thscode` trips the second pass's own `assertKnown` (`unsupported parameter: thscode`) and kills
// ticker filters; ② idempotent — the second pass's input is the first pass's output.
test('公开 HTTP 与 MCP 归一化：不发明未声明的键，且双跑幂等', () => {
  for (const source of sources) {
    const capability = source.schema.capability
    const declared = Object.keys(source.schema.input_schema.properties ?? {}).sort()
    const once = source.normalizeParams(SAMPLES[capability])
    assert.deepEqual(Object.keys(once).filter((key) => !declared.includes(key)), [],
      `${capability} 归一化发明了模型没声明的键：Hub 的第二遍归一化会把它当非法参数拒掉`)
    assert.deepEqual(source.normalizeParams(once), once, `${capability} normalizeParams 必须幂等（Hub 与 execute 各跑一次）`)
  }
})

test('走 Hub 的真实入口：原始 ticker 参数一路落到上游 filter，不在第二遍归一化被拒', async () => {
  const originalFetch = globalThis.fetch
  const requested = []
  globalThis.fetch = async (url) => {
    requested.push(new URL(String(url)))
    return { ok: true, status: 200, json: async () => ({ success: true, code: 0, result: { pages: 0, count: 0, data: [] } }) }
  }
  const hub = new DataCollectorHub({ store: { async save() { return {} }, async findLatest() { return undefined } } })
  for (const source of createEastmoneySources()) hub.registerSource(source)
  const cases = [
    ['eastmoney_margin_trading', { ticker: '600519.SH', start_date: '2026-09-01', end_date: '2026-09-30' }, /600519/],
    ['eastmoney_dividend_plan', { ticker: '600519.SH', start_date: '2020-01-01', end_date: '2026-09-30' }, /600519\.SH/],
    ['eastmoney_main_capital_snapshot', { ticker: '600519.SH' }, /600519\.SH/],
    ['eastmoney_holder_number_snapshot', { ticker: '600519.SH' }, /600519\.SH/],
  ]
  try {
    for (const [capability, params, filterPattern] of cases) {
      requested.length = 0
      // An empty result is a real data gap and throws data-side. Pinned here: no parameter-side
      // rejection, and the request really carried the ticker.
      await hub.request({ capability, params, session }, { signal }).catch(() => undefined)
      assert.equal(requested.length, 1, `${capability} 必须走到上游，而不是在归一化阶段就被拒`)
      const filter = requested[0].searchParams.get('filter') ?? ''
      assert.match(filter, filterPattern, `${capability} 的单票过滤必须带上请求的代码，收到 filter=${filter}`)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})
