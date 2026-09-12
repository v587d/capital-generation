import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFuyaoRestSources, resolveFuyaoApiKey, MAX_HISTORY_WINDOW_MS, MAX_BATCH_CODES } from '../lib/sources/fuyao-rest.js'

/** 全部已注册的 capability（顺序即注册顺序：Phase 1 四个在前）。 */
const ALL_CAPABILITIES = [
  // Phase 1
  'ticker_search', 'quote', 'history', 'trading_calendar',
  // Phase 2
  'ticker_list', 'corporate_actions', 'income_statement', 'balance_sheet', 'cash_flow',
  'financial_indicators', 'valuation', 'auction', 'limit_up_pool', 'limit_up_ladder',
  'index_catalog', 'index_constituents', 'index_quote', 'index_history',
  // Phase 3
  'limit_down_pool', 'limit_break_pool', 'skyrocket_list', 'hot_stock_list', 'hot_stock_history',
  'hot_stock_rank_trend', 'anomaly_list', 'anomaly_stock', 'dragon_tiger', 'auction_benchmark',
  // Phase 3B
  'fund_profile', 'fund_quote', 'fund_history', 'fund_nav', 'fund_returns', 'fund_drawdowns',
  'fund_holdings', 'fund_asset_allocation', 'fund_industry_allocation', 'fund_stock_history',
  'fund_holders', 'fund_top_holders', 'fund_manager', 'fund_company',
  // Phase 3C
  'fund_performance_history', 'fund_bond_history', 'fund_stock_report_dates', 'fund_bond_report_dates',
  'fund_manager_experience', 'fund_manager_style', 'fund_manager_performance',
  'fund_income', 'fund_balance', 'fund_financial_indicators',
  'fund_indicator_line', 'fund_indicator_table', 'fund_dividends', 'fund_offerings',
  'fund_quota_list', 'fund_quota_summary', 'fund_diagnostics', 'fund_backtest', 'fund_backtest_indicators',
]
const ALL_SOURCE_NAMES = [
  'get_meta_tickers_search', 'get_a_share_prices_snapshot', 'get_a_share_prices_historical', 'get_a_share_calendar_trading_days',
  'get_meta_tickers_list', 'get_a_share_corporate_actions_adjustment_factors',
  'get_a_share_financials_income_statements', 'get_a_share_financials_balance_sheets', 'get_a_share_financials_cash_flow_statements',
  'get_a_share_financials_indicators', 'get_a_share_valuations_snapshot', 'get_a_share_auction_snapshot',
  'get_a_share_special_data_limit_up_pool', 'get_a_share_special_data_limit_up_ladder',
  'get_a_share_index_catalog_ths_index_list', 'get_a_share_index_constituents_ths_stock_list',
  'get_a_share_index_prices_snapshot', 'get_a_share_index_prices_historical',
  'get_a_share_special_data_limit_down_pool', 'get_a_share_special_data_limit_break_pool',
  'get_a_share_special_data_skyrocket_list', 'get_a_share_special_data_hot_stock_list',
  'get_a_share_special_data_hot_stock_list_history', 'get_a_share_special_data_hot_stock_rank_trend',
  'get_a_share_special_data_anomaly_analysis_list', 'get_a_share_special_data_anomaly_analysis_stock',
  'get_a_share_special_data_dragon_tiger_list', 'get_a_share_auction_short_term_benchmark',
  'get_fund_profile_detail', 'get_fund_market_snapshot', 'get_fund_market_historical',
  'get_fund_performance_nav', 'get_fund_performance_returns', 'get_fund_performance_drawdowns',
  'get_fund_portfolio_holdings', 'get_fund_portfolio_asset_allocation', 'get_fund_portfolio_industry_allocation',
  'get_fund_portfolio_stock_history', 'get_fund_holders_detail', 'get_fund_holders_top',
  'get_fund_managers_detail', 'get_fund_companies_detail',
  'get_fund_performance_indicators_historical', 'get_fund_portfolio_bond_history',
  'get_fund_portfolio_stock_report_dates', 'get_fund_portfolio_bond_report_dates',
  'get_fund_managers_experience', 'get_fund_managers_investment_style', 'get_fund_managers_performance',
  'get_fund_financials_income_statements', 'get_fund_financials_balance_sheets', 'get_fund_financials_indicators',
  'get_fund_indicators_line', 'get_fund_indicators_table', 'get_fund_corporate_actions_dividends',
  'get_fund_offerings_list', 'get_fund_quota_list', 'get_fund_quota_summary',
  'get_fund_diagnostics_detail', 'get_fund_backtest_result', 'get_fund_backtest_indicators',
]
/** 真正带分页语义的 capability（其余为一次性全量或窗口型）。 */
const PAGINATED = ['quote', 'history', 'ticker_list', 'limit_up_pool', 'limit_down_pool', 'limit_break_pool', 'fund_indicator_table']

function fakeCtx(credentials) {
  return { get: (name) => (name === 'credentials' ? credentials : undefined) }
}

function request(params, overrides = {}) {
  return {
    capability: 'quote',
    params: params ?? {},
    session: { id: 'session-1', header: { cwd: '/workspace/proj' } },
    ...overrides,
  }
}

test('createFuyaoRestSources：全部数据源映射短 capability，各带独立完整 schema', () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('unexpected fetch') }
  try {
    const sources = createFuyaoRestSources(async () => 'key-1')
    assert.deepEqual(sources.map((s) => s.schema.capability), ALL_CAPABILITIES)
    assert.deepEqual(sources.map((s) => s.schema.name), ALL_SOURCE_NAMES)
    assert.deepEqual(sources.map((s) => s.schema.paginated), ALL_CAPABILITIES.map((capability) => PAGINATED.includes(capability)), '分页能力标记')
    for (const source of sources) {
      assert.ok(source.schema.input_schema, '每个数据源必须有 input_schema')
      assert.ok(source.schema.output_schema, '每个数据源必须有 output_schema')
      assert.equal(source.schema.source, 'api:fuyao')
      assert.equal(source.schema.source_label, 'fuyao')
      assert.equal(typeof source.schema.data_key, 'string', '内部 data_key 仅宿主保留')
      assert.ok(!('ttl_ms' in source.schema), '旧 TTL 缓存语义已删除')
      assert.ok(source.schema.description.length > 20, `${source.schema.capability} 的描述应自述完整`)
    }
    assert.equal(new Set(sources.map((s) => s.schema.data_key)).size, sources.length, '内部 data_key 必须唯一')
    assert.equal(sources[0].schema.data_key, 'fuyao.api.api.meta.tickers.search')
    assert.equal(sources[1].schema.input_schema.required.length, 0, '快照按代码查询才需 thscodes，未强制 required')
    assert.deepEqual(sources[2].schema.input_schema.required, ['thscode', 'interval', 'start', 'end'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('input_schema 契约：interval/adjust 枚举与参数说明按 ths_api.md 校准', () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('unexpected fetch') }
  try {
    const sources = createFuyaoRestSources(async () => 'key-1')
    const byName = Object.fromEntries(sources.map((s) => [s.schema.name, s.schema.input_schema]))
    // historical：interval 固定 1d；adjust 三取值；start/end 毫秒说明
    const historical = byName['get_a_share_prices_historical']
    assert.deepEqual(historical.properties.interval.enum, ['1d'], 'interval 当前固定支持 1d')
    assert.match(historical.properties.start.description, /毫秒/, 'start 需注明毫秒时间戳')
    assert.match(historical.properties.end.description, /毫秒/, 'end 需注明毫秒时间戳')
    assert.deepEqual(historical.properties.adjust.enum, ['none', 'forward', 'backward'])
    assert.match(historical.properties.adjust.description, /前复权/)
    // search：limit 默认值说明；asset_type 枚举说明
    const search = byName['get_meta_tickers_search']
    assert.match(search.properties.limit.description, /最大 50/)
    assert.match(search.properties.asset_type.description, /a-share|fund-etf/)
    // snapshot：thscodes 逗号分隔说明
    const snapshot = byName['get_a_share_prices_snapshot']
    assert.match(snapshot.properties.thscodes.description, /逗号分隔/)
    // calendar：无参
    assert.deepEqual(byName['get_a_share_calendar_trading_days'].properties, {})
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('execute：构造 X-api-key 头与 query，解析 envelope 数据', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, signal: init.signal })
    return {
      ok: true,
      json: async () => ({ code: 0, request_id: 'fuyao-1', data: { timestamp: 1, total: 1, item: [{ thscode: '600519.SH' }] } }),
    }
  }
  try {
    const sources = createFuyaoRestSources(async () => 'secret-key')
    const result = await sources[1].execute(request({ thscodes: '600519.SH' }), new AbortController().signal)
    assert.deepEqual(result.data.item, [{ thscode: '600519.SH' }])
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /\/api\/a-share\/prices\/snapshot\?thscodes=600519\.SH$/)
    assert.equal(calls[0].headers['X-api-key'], 'secret-key')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('execute：每次调用都重新解析 API Key（按次解析不缓存）', async () => {
  const originalFetch = globalThis.fetch
  let resolves = 0
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ code: 0, data: {} }) })
  try {
    const sources = createFuyaoRestSources(async () => { resolves += 1; return `key-${resolves}` })
    await sources[0].execute(request({ q: '茅台' }), new AbortController().signal)
    assert.equal(resolves, 1)
    await sources[0].execute(request({ q: '茅台' }), new AbortController().signal)
    assert.equal(resolves, 2, '每次 execute 必须重新解析')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('execute：缺 API Key 时明确报错，不静默、不编造', async () => {
  const sources = createFuyaoRestSources(async () => undefined)
  await assert.rejects(
    () => sources[0].execute(request({ q: '茅台' }), new AbortController().signal),
    /FUYAO_API_KEY is not configured/,
  )
})

test('execute：envelope code != 0 时抛带 request_id 的明确错误', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ code: 40001, message: 'bad auth', request_id: 'fuyao-x' }) })
  try {
    const sources = createFuyaoRestSources(async () => 'key')
    await assert.rejects(
      () => sources[1].execute(request({ thscodes: '600519.SH' }), new AbortController().signal),
      /Fuyao API error 40001: bad auth \(request_id: fuyao-x\)/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('execute：HTTP 错误明确报出状态码', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 502 })
  try {
    const sources = createFuyaoRestSources(async () => 'key')
    await assert.rejects(() => sources[1].execute(request({}), new AbortController().signal), /Fuyao HTTP error 502/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('resolveFuyaoApiKey：不使用未命名的通用 API_KEY', async () => {
  const processLike = globalThis.process
  const savedFuyao = processLike.env.FUYAO_API_KEY
  const savedGeneric = processLike.env.API_KEY
  try {
    delete processLike.env.FUYAO_API_KEY
    processLike.env.API_KEY = 'unrelated-key'
    assert.equal(await resolveFuyaoApiKey(fakeCtx(undefined)), undefined)
  } finally {
    if (savedFuyao === undefined) delete processLike.env.FUYAO_API_KEY
    else processLike.env.FUYAO_API_KEY = savedFuyao
    if (savedGeneric === undefined) delete processLike.env.API_KEY
    else processLike.env.API_KEY = savedGeneric
  }
})

test('resolveFuyaoApiKey：优先 credentials，再回退环境变量', async () => {
  const processLike = globalThis.process
  const saved = processLike.env.FUYAO_API_KEY
  try {
    processLike.env.FUYAO_API_KEY = 'env-key'
    const ctxWithCredentials = fakeCtx({ resolve: async (ref) => (ref === 'FUYAO_API_KEY' ? { value: 'cred-key' } : undefined) })
    assert.equal(await resolveFuyaoApiKey(ctxWithCredentials), 'cred-key')
    assert.equal(await resolveFuyaoApiKey(fakeCtx(undefined)), 'env-key')
    delete processLike.env.FUYAO_API_KEY
    assert.equal(await resolveFuyaoApiKey(fakeCtx(undefined)), undefined)
  } finally {
    if (saved === undefined) delete processLike.env.FUYAO_API_KEY
    else processLike.env.FUYAO_API_KEY = saved
  }
})

// ── Phase 1：参数规范化、语义校验与输出护栏 ──────────────────────────────────
// 这一组用例保护的是"本地契约"：非法参数在解析密钥与发请求之前就被拒绝，
// 语义相同、书写不同的请求规范化到同一份参数（Hub 据此复用 Dataset），
// 结构不可用的响应在落盘前被输出护栏拦下。

const sources = () => createFuyaoRestSources(async () => 'key')
const byCapability = (capability) => {
  const source = sources().find((item) => item.schema.capability === capability)
  assert.ok(source, `capability ${capability} 必须已注册`)
  return source
}
const SAMPLE_PARAMS = {
  // Phase 1
  ticker_search: { q: ' 茅台 ' },
  quote: { thscodes: '600519.sh, 000001.sz' },
  history: { thscode: '600519.sh', interval: '1d', start: 1716105600000, end: 1747641600000 },
  trading_calendar: {},
  // Phase 2
  ticker_list: { asset_type: 'A-Share, fund-etf', limit: 1000, offset: 0 },
  corporate_actions: { thscode: '600519.sh', from: '2021-01-01', to: '2026-01-01' },
  income_statement: { thscode: '600519.sh', period: 'annual', limit: 4 },
  balance_sheet: { thscode: '000858.sz', period: 'quarterly', start: 1672502400000, end: 1735574400000 },
  cash_flow: { thscode: '600519.sh', period: 'annual', limit: 4 },
  financial_indicators: { thscode: '300033.sz', report: '2025-1' },
  valuation: { thscodes: '600519.sh,000001.sz' },
  auction: { thscodes: '600519.sh,000001.sz', stage: 'final' },
  limit_up_pool: { date_ms: 1748102400000, page: 1, size: 50, sort_field: 'limit_up_time', sort_dir: 'DESC' },
  limit_up_ladder: {},
  index_catalog: { tag: 'CN_Concept' },
  index_constituents: { thscode: '000300.sh' },
  index_quote: { thscodes: '000001.sh,886042.ti' },
  index_history: { thscode: '000001.sh', interval: '1d', start: 1716105600000, end: 1747641600000 },
  // Phase 3
  limit_down_pool: { page: 1, size: 50, sort_field: 'LAST_LIMIT_TIME', sort_dir: 'DESC' },
  limit_break_pool: { page: 1, size: 50, sort_field: 'open_times', sort_dir: 'desc' },
  skyrocket_list: { period: 'HOUR' },
  hot_stock_list: { period: 'day' },
  hot_stock_history: { date: ' 2026-06-21 ' },
  hot_stock_rank_trend: { thscode: '300034.sz', start_date: '2026-06-21', end_date: '2026-07-01' },
  anomaly_list: { tag_codes: 'limit_up, sharp_fall' },
  anomaly_stock: { thscodes: '600519.sh,000001.SZ' },
  dragon_tiger: { board_type: 'HOT_MONEY', date: '2026-07-01' },
  auction_benchmark: { date: '2026-08-14' },
  // Phase 3B
  fund_profile: { thscode: '510300.sh' },
  fund_quote: { thscode: '510300.SH' },
  fund_history: { thscode: '510300.SH', start: 1716105600000, end: 1747641600000 },
  fund_nav: { thscode: '510300.SH', range: 'MONTH', nav_type: 'unit,ADJ' },
  fund_returns: { thscode: '510300.SH' },
  fund_drawdowns: { thscode: '510300.SH' },
  fund_holdings: { thscode: '025480.of' },
  fund_asset_allocation: { thscode: '510300.SH' },
  fund_industry_allocation: { thscode: '025480.OF' },
  fund_stock_history: { thscode: '510300.SH', report_type: 'quarter', end_date: '2026-06-30' },
  fund_holders: { thscode: '161725.sz', merge_scope: 'ALL' },
  fund_top_holders: { thscode: '510300.SH', limit: 10 },
  fund_manager: { manager_id: 'M000000001' },
  fund_company: { company_id: 'C000000001' },
  // Phase 3C
  fund_performance_history: { thscode: '510300.SH', start: 1716105600000, end: 1747641600000 },
  fund_bond_history: { thscode: '510300.SH', report_type: 'quarter', end_date: '2026-06-30' },
  fund_stock_report_dates: { thscode: '510300.SH' },
  fund_bond_report_dates: { thscode: '510300.SH', report_type: 'quarter' },
  fund_manager_experience: { manager_id: 'M1' },
  fund_manager_style: { manager_id: 'M1' },
  fund_manager_performance: { manager_id: 'M1', range: 'YEAR' },
  fund_income: { thscode: '510300.SH' },
  fund_balance: { thscode: '510300.SH' },
  fund_financial_indicators: { thscode: '510300.SH' },
  fund_indicator_line: { indexes: '[{"thscodes":["510300.SH"],"index_info":[{"index_id":"rsi_pct"}]}]', time_range: '{"time_type":"DAY_1"}' },
  fund_indicator_table: { indexes: '[{"index_id":"rsi_pct"}]' },
  fund_dividends: { thscode: '510300.SH' },
  fund_offerings: { subscribe: 'ACTIVE' },
  fund_quota_list: { tab: '["remen"]', buy: true },
  fund_quota_summary: { tab: '["nazhi100"]' },
  fund_diagnostics: { thscode: '510300.SH' },
  fund_backtest: { thscode: '000001.OF', buy_conditions: '{"indicator_code":"rsi_pct"}', sell_conditions: '{"indicator_code":"rsi_pct"}', buy_frequency_type: 'WEEKLY', max_buy_times: 5, per_buy_amount: 100 },
  fund_backtest_indicators: {},
}

test('normalize：每个数据源都暴露幂等的 normalizeParams（Hub 与 execute 各调用一次）', () => {
  const all = sources()
  assert.equal(all.length, ALL_CAPABILITIES.length)
  for (const source of all) {
    assert.equal(typeof source.normalizeParams, 'function', `${source.schema.capability} 必须提供 normalizeParams`)
    const sample = SAMPLE_PARAMS[source.schema.capability]
    assert.ok(sample, `测试样本缺少 ${source.schema.capability} 的参数`)
    const once = source.normalizeParams(sample)
    assert.deepEqual(source.normalizeParams(once), once, `${source.schema.capability} 的 normalizeParams 必须幂等`)
  }
})

test('normalize：代码列表去空白、转大写、按序去重；单标的自动大写', () => {
  assert.deepEqual(
    byCapability('quote').normalizeParams({ thscodes: ' 600519.sh , 000001.SZ,600519.SH ,, ' }),
    { thscodes: '600519.SH,000001.SZ' },
  )
  assert.deepEqual(
    byCapability('history').normalizeParams({ thscode: ' 600519.sh ', interval: '1d', start: 1, end: 2 }),
    { thscode: '600519.SH', interval: '1d', start: 1, end: 2 },
  )
})

test('normalize：quote 指定标的时丢弃被上游忽略的 limit/offset，避免语义等价的多个 Dataset', () => {
  const quote = byCapability('quote')
  assert.deepEqual(quote.normalizeParams({ thscodes: '600519.SH', limit: 5, offset: 10 }), { thscodes: '600519.SH' })
  assert.deepEqual(quote.normalizeParams({ limit: 5, offset: 10 }), { limit: 5, offset: 10 })
})

test('校验：裸代码与逗号单标的被本地拒绝（不猜交易所后缀）', () => {
  const history = byCapability('history')
  const base = { interval: '1d', start: 1716105600000, end: 1747641600000 }
  assert.throws(() => history.normalizeParams({ ...base, thscode: '600519' }), /full thscode/)
  assert.throws(() => history.normalizeParams({ ...base, thscode: '600519.SH,000001.SZ' }), /full thscode/)
  assert.throws(() => byCapability('quote').normalizeParams({ thscodes: '600519,000001.SZ' }), /full thscode/)
})

test('校验：end < start 与超过 10 年的窗口被本地拒绝', () => {
  const history = byCapability('history')
  assert.throws(
    () => history.normalizeParams({ thscode: '600519.SH', interval: '1d', start: 100, end: 99 }),
    /end must be >= start/,
  )
  assert.throws(
    () => history.normalizeParams({ thscode: '600519.SH', interval: '1d', start: 0, end: MAX_HISTORY_WINDOW_MS + 1 }),
    /10 year limit/,
  )
  assert.doesNotThrow(
    () => history.normalizeParams({ thscode: '600519.SH', interval: '1d', start: 0, end: MAX_HISTORY_WINDOW_MS }),
    '窗口恰好等于上限时必须放行',
  )
})

test('校验：范围、枚举、必填与未知参数都有明确错误', () => {
  const search = byCapability('ticker_search')
  assert.throws(() => search.normalizeParams({ q: '茅台', limit: 51 }), /must be <= 50/)
  assert.throws(() => search.normalizeParams({ q: '茅台', limit: 0 }), /must be >= 1/)
  assert.throws(() => search.normalizeParams({ q: '茅台', limit: 1.5 }), /must be an integer/)
  assert.throws(() => search.normalizeParams({ q: '茅台', exchange: 'HK' }), /has an invalid value/)
  assert.throws(() => search.normalizeParams({ q: '茅台', asset_type: 'a-share,bond' }), /invalid value: bond/)
  assert.throws(() => search.normalizeParams({ q: '   ' }), /must not be empty/)
  assert.throws(() => search.normalizeParams({}), /missing required parameter: q/)
  assert.throws(() => search.normalizeParams({ q: '茅台', typo: 1 }), /unsupported parameter: typo/)
  assert.throws(() => byCapability('quote').normalizeParams({ offset: -1 }), /must be >= 0/)
  assert.throws(() => byCapability('quote').normalizeParams({ thscodes: '   ' }), /must not be empty/)
  assert.throws(() => byCapability('trading_calendar').normalizeParams({ date: '2025-01-01' }), /unsupported parameter: date/)
})

test('校验：非法参数在解析 API Key 与发请求之前就被拒绝', async () => {
  const originalFetch = globalThis.fetch
  let fetches = 0
  let resolved = 0
  globalThis.fetch = async () => { fetches += 1; throw new Error('unexpected fetch') }
  try {
    const all = createFuyaoRestSources(async () => { resolved += 1; return 'key' })
    const history = all.find((item) => item.schema.capability === 'history')
    await assert.rejects(
      () => history.execute(request({ thscode: '600519' }), new AbortController().signal),
      /full thscode/,
    )
    assert.equal(fetches, 0, '参数非法时不得发请求')
    assert.equal(resolved, 0, '参数非法时不得解析密钥')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('输出护栏：契约字段缺失、行非对象、类型不符都判为契约不符', () => {
  const quote = byCapability('quote')
  const search = byCapability('ticker_search')
  const calendar = byCapability('trading_calendar')
  assert.equal(quote.validateOutput({ item: [{ thscode: '600519.SH', last_price: 1 }] }), true)
  assert.equal(quote.validateOutput({ item: [] }), true, '空结果是合法结果')
  assert.equal(quote.validateOutput({ item: [{ thscode: '600519.SH', last_price: null }] }), true, 'null 表示无数据，不是契约不符')
  assert.equal(quote.validateOutput({ item: [{ thscode: '600519.SH' }] }), false, '契约字段缺失')
  assert.equal(quote.validateOutput({ item: [{ last_price: 'not-a-number' }] }), false)
  assert.equal(quote.validateOutput({ item: ['600519.SH'] }), false, '行必须是对象')
  assert.equal(quote.validateOutput(null), false, 'data 为 null 判为契约不符')
  assert.equal(quote.validateOutput({ item: [{ last_price: 1 }], timestamp: 'x' }), false, 'timestamp 非法')
  assert.equal(quote.validateOutput({ item: [{ last_price: 1 }], timestamp: 1716105600000, total: 1 }), true)
  assert.equal(search.validateOutput({ item: [{ thscode: '600519.SH' }] }), false, 'search 缺 name')
  assert.equal(search.validateOutput({ item: [{ thscode: '600519.SH', name: '贵州茅台', exchange: null }] }), true, 'exchange 允许 null')
  assert.equal(calendar.validateOutput({ item: [{ date_ms: 1, date: '19700101' }] }), true)
  assert.equal(calendar.validateOutput({ item: [{ date_ms: 'abc', date: '19700101' }] }), false)
})
// ── Phase 2：首批 14 个新端点的契约 ─────────────────────────────────────────
// 保护口径：端点参数语义（互斥、成对、上限、枚举、代码形态）与输出结构护栏
// （主标识严格、指标宽容、null 放行），以及真正发出去的 query 形态。

/** 用 mock fetch 执行一次 source，返回请求 URL 与上游 data。 */
async function executeWithFetch(source, params, envelope = { code: 0, data: { item: [] } }) {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => { calls.push(String(url)); return { ok: true, json: async () => envelope } }
  try {
    const result = await source.execute(request(params), new AbortController().signal)
    return { url: calls[0], data: result.data }
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('Phase 2 注册：14 个新 capability 与内部 MCP 名一一对应', () => {
  const all = sources()
  assert.deepEqual(all.map((s) => s.schema.capability), ALL_CAPABILITIES)
  assert.deepEqual(all.map((s) => s.schema.name), ALL_SOURCE_NAMES)
  for (const capability of ALL_CAPABILITIES) {
    const source = all.find((item) => item.schema.capability === capability)
    assert.ok(source.output_schema ?? source.schema.output_schema, `${capability} 必须声明输出结构`)
  }
})

test('ticker_list：asset_type 枚举与分页范围', () => {
  const source = byCapability('ticker_list')
  assert.deepEqual(source.normalizeParams({ asset_type: 'A-Share, fund-ETF ,a-share' }), { asset_type: 'a-share,fund-etf' })
  assert.deepEqual(source.normalizeParams({}), {}, '省略参数不下发，也不注入上游默认值')
  assert.deepEqual(source.normalizeParams({ limit: 10000, offset: 0 }), { limit: 10000, offset: 0 })
  assert.throws(() => source.normalizeParams({ limit: 10001 }), /must be <= 10000/)
  assert.throws(() => source.normalizeParams({ offset: -1 }), /must be >= 0/)
  assert.throws(() => source.normalizeParams({ asset_type: 'a-share,bond' }), /invalid value: bond/)
  // 代码表与检索都按官方契约支持 futures/options（元数据域全量放开）。
  assert.doesNotThrow(() => source.normalizeParams({ asset_type: 'futures,options' }))
  assert.doesNotThrow(() => byCapability('ticker_search').normalizeParams({ q: '豆粕', asset_type: 'futures' }))
})

test('corporate_actions：日期格式、日历有效性与区间顺序', () => {
  const source = byCapability('corporate_actions')
  assert.deepEqual(
    source.normalizeParams({ thscode: '600519.sh', from: '2021-01-01', to: '2026-01-01' }),
    { thscode: '600519.SH', from: '2021-01-01', to: '2026-01-01' },
  )
  assert.deepEqual(source.normalizeParams({ thscode: '600519.SH' }), { thscode: '600519.SH' }, 'from/to 可单边省略')
  assert.deepEqual(source.normalizeParams({ thscode: '600519.SH', from: '2021-01-01' }), { thscode: '600519.SH', from: '2021-01-01' })
  assert.throws(() => source.normalizeParams({ thscode: '600519.SH', from: '2021/01/01' }), /YYYY-MM-DD/)
  assert.throws(() => source.normalizeParams({ thscode: '600519.SH', from: '2025-02-30' }), /valid calendar date/)
  assert.throws(() => source.normalizeParams({ thscode: '600519.SH', from: '2025-13-01' }), /valid calendar date/)
  assert.throws(() => source.normalizeParams({ thscode: '600519.SH', from: '2026-01-01', to: '2021-01-01' }), /to must be >= from/)
  assert.throws(() => source.normalizeParams({ thscode: '600519.SH,000001.SZ' }), /full thscode/)
})

test('financials：limit 与 start/end 互斥、成对出现、窗口与范围', () => {
  for (const capability of ['income_statement', 'balance_sheet', 'cash_flow']) {
    const source = byCapability(capability)
    const base = { thscode: '600519.SH', period: 'annual' }
    assert.deepEqual(source.normalizeParams({ ...base, limit: 4 }), { ...base, limit: 4 })
    assert.deepEqual(source.normalizeParams(base), base, '两种模式都不给时按上游默认（最近 4 期）')
    assert.deepEqual(
      source.normalizeParams({ ...base, period: 'quarterly', start: 1672502400000, end: 1735574400000 }),
      { ...base, period: 'quarterly', start: 1672502400000, end: 1735574400000 },
    )
    assert.throws(() => source.normalizeParams({ ...base, limit: 4, start: 1, end: 2 }), /mutually exclusive/)
    assert.throws(() => source.normalizeParams({ ...base, limit: 4, start: 1 }), /mutually exclusive/)
    assert.throws(() => source.normalizeParams({ ...base, start: 1 }), /must be provided together/)
    assert.throws(() => source.normalizeParams({ ...base, end: 1 }), /must be provided together/)
    assert.throws(() => source.normalizeParams({ ...base, start: 2, end: 1 }), /end must be >= start/)
    assert.throws(() => source.normalizeParams({ ...base, start: 0, end: MAX_HISTORY_WINDOW_MS + 1 }), /10 year limit/)
    assert.throws(() => source.normalizeParams({ ...base, limit: 0 }), /must be >= 1/)
    assert.throws(() => source.normalizeParams({ ...base, limit: 21 }), /must be <= 20/)
    assert.throws(() => source.normalizeParams({ thscode: '600519.SH' }), /missing required parameter: period/)
    assert.throws(() => source.normalizeParams({ ...base, period: 'monthly' }), /invalid value/)
    assert.throws(() => source.normalizeParams({ ...base, thscode: '600519.SH,000001.SZ' }), /full thscode/)
  }
})

test('financials：三表字段名按端点契约（以 llm_full 为准，不用 ths_api 的近似名）', () => {
  const balance = byCapability('balance_sheet').schema.output_schema.properties.item.items.properties
  for (const field of ['assets_total', 'total_current_assets', 'non_current_nets_total', 'cash', 'accounts_receivable', 'total_debt', 'holder_equity_total']) {
    assert.ok(field in balance, `资产负债表应含 ${field}`)
  }
  for (const stale of ['total_assets', 'total_liabilities', 'total_equity', 'cash_and_cash_equivalents']) {
    assert.ok(!(stale in balance), `不应使用未确认的字段名 ${stale}`)
  }
  const income = byCapability('income_statement').schema.output_schema.properties.item.items.properties
  for (const field of ['operating_income', 'operating_profit', 'net_profit', 'parent_holder_net_profit', 'basic_eps', 'report_date_ms', 'period_end_ms']) {
    assert.ok(field in income, `利润表应含 ${field}`)
  }
  const cashFlow = byCapability('cash_flow').schema.output_schema.properties.item.items.properties
  for (const field of ['act_cash_flow_net', 'invest_cash_flow_net', 'financing_cash_flow_net', 'pay_fixed_assets_etc_cash']) {
    assert.ok(field in cashFlow, `现金流量表应含 ${field}`)
  }
})

test('financial_indicators：report 格式与嵌套 abilities 结构', () => {
  const source = byCapability('financial_indicators')
  assert.deepEqual(source.normalizeParams({ thscode: '300033.sz', report: '2025-1' }), { thscode: '300033.SZ', report: '2025-1' })
  for (const invalid of ['2025', '2025-0', '2025-5', '25-1', '2025-1-1']) {
    assert.throws(() => source.normalizeParams({ thscode: '300033.SZ', report: invalid }), /report period/, `report=${invalid} 应被拒绝`)
  }
  assert.throws(() => source.normalizeParams({ thscode: '300033.SZ' }), /missing required parameter: report/)
  // 嵌套结构：value 是原始数值字符串（保留精度）或 null，不转 number
  assert.equal(source.validateOutput({ thscode: '300033.SZ', report: '2025-1', abilities: [{ ability: 'profitability', indicators: [{ index_id: 'sale_gross_margin', value: '89.12000000' }, { index_id: 'earned_interest_multiple', value: null }] }] }), true)
  assert.equal(source.validateOutput({ thscode: '300033.SZ', report: '2025-1', abilities: [] }), true, '空 abilities 是合法结果')
  assert.equal(source.validateOutput({ thscode: '300033.SZ', report: '2025-1' }), false, '缺 abilities')
  assert.equal(source.validateOutput({ thscode: '300033.SZ', report: '2025-1', abilities: [{ ability: 'growth' }] }), false, 'ability 缺 indicators')
  assert.equal(source.validateOutput({ thscode: '300033.SZ', report: '2025-1', abilities: [{ ability: 'growth', indicators: [{ index_id: 'x', value: 1 }] }] }), false, 'value 是 number 判为契约不符（应保留字符串）')
  assert.equal(source.validateOutput({ report: '2025-1', abilities: [] }), false, '缺 thscode')
})

test('valuation / auction：批量代码上限按去重前的 token 数校验', () => {
  const valuation = byCapability('valuation')
  const auction = byCapability('auction')
  assert.deepEqual(valuation.normalizeParams({ thscodes: '600519.sh, 000001.SZ' }), { thscodes: '600519.SH,000001.SZ' })
  assert.throws(() => valuation.normalizeParams({}), /missing required parameter: thscodes/)
  assert.throws(() => valuation.normalizeParams({ thscodes: '   ' }), /must not be empty/)
  const overLimit = Array.from({ length: MAX_BATCH_CODES + 1 }, (_, index) => `60${String(index).padStart(4, '0')}.SH`).join(',')
  assert.throws(() => valuation.normalizeParams({ thscodes: overLimit }), /at most 100 codes/)
  // 去重前校验：101 个重复 token 同样超限。
  assert.throws(() => valuation.normalizeParams({ thscodes: Array.from({ length: MAX_BATCH_CODES + 1 }, () => '600519.SH').join(',') }), /at most 100 codes/)
  assert.equal(valuation.normalizeParams({ thscodes: Array.from({ length: MAX_BATCH_CODES }, () => '600519.SH').join(',') }).thscodes, '600519.SH')
  assert.deepEqual(auction.normalizeParams({ thscodes: '600519.SH', stage: 'LIVE' }), { thscodes: '600519.SH', stage: 'live' })
  assert.throws(() => auction.normalizeParams({ thscodes: '600519.SH', stage: 'open' }), /invalid value/)
  assert.throws(() => auction.normalizeParams({ thscodes: '600519.SH', extra: 1 }), /unsupported parameter: extra/)
})

test('limit_up_pool：分页与排序参数校验', () => {
  const source = byCapability('limit_up_pool')
  assert.deepEqual(
    source.normalizeParams({ date_ms: 1748102400000, page: 2, size: 200, sort_field: 'continue_day_cnt', sort_dir: 'ASC' }),
    { date_ms: 1748102400000, page: 2, size: 200, sort_field: 'continue_day_cnt', sort_dir: 'asc' },
  )
  assert.throws(() => source.normalizeParams({ page: 0 }), /must be >= 1/)
  assert.throws(() => source.normalizeParams({ size: 0 }), /must be >= 1/)
  assert.throws(() => source.normalizeParams({ size: 201 }), /must be <= 200/)
  assert.throws(() => source.normalizeParams({ sort_field: 'seal_money_desc' }), /invalid value/)
  assert.throws(() => source.normalizeParams({ sort_dir: 'up' }), /invalid value/)
  assert.throws(() => source.normalizeParams({ date: '2025-06-20' }), /unsupported parameter: date/)
})

test('limit_up_ladder：无入参，传参被拒', () => {
  const source = byCapability('limit_up_ladder')
  assert.deepEqual(source.normalizeParams({}), {})
  assert.throws(() => source.normalizeParams({ date: '20250620' }), /unsupported parameter: date/)
})

test('index 端点：tag 枚举、指数代码形态与接口差异', () => {
  const catalog = byCapability('index_catalog')
  assert.deepEqual(catalog.normalizeParams({ tag: 'CN_Concept' }), { tag: 'cn_concept' })
  assert.deepEqual(catalog.normalizeParams({}), {})
  assert.throws(() => catalog.normalizeParams({ tag: 'concept' }), /invalid value/)

  const constituents = byCapability('index_constituents')
  assert.deepEqual(constituents.normalizeParams({ thscode: '886042.ti' }), { thscode: '886042.TI' })
  assert.deepEqual(constituents.normalizeParams({ thscode: '000300.sh' }), { thscode: '000300.SH' })
  assert.throws(() => constituents.normalizeParams({ thscode: '600519' }), /full index thscode/)
  assert.throws(() => constituents.normalizeParams({ thscode: '000300.SH,399300.SZ' }), /full index thscode/)

  const quote = byCapability('index_quote')
  assert.deepEqual(quote.normalizeParams({ thscodes: '000001.sh,886042.TI' }), { thscodes: '000001.SH,886042.TI' })
  assert.throws(() => quote.normalizeParams({}), /missing required parameter: thscodes/)
  assert.throws(() => quote.normalizeParams({ thscodes: '000001.SH', limit: 10 }), /unsupported parameter: limit/, 'limit/offset 对本接口无效，故不暴露')

  const history = byCapability('index_history')
  assert.deepEqual(
    history.normalizeParams({ thscode: '000001.sh', interval: '1d', start: 1716105600000, end: 1747641600000 }),
    { thscode: '000001.SH', interval: '1d', start: 1716105600000, end: 1747641600000 },
  )
  assert.throws(() => history.normalizeParams({ thscode: '000001.SH', interval: '1d', start: 0, end: 0, adjust: 'forward' }), /unsupported parameter: adjust/, '指数无复权语义')
  assert.throws(() => history.normalizeParams({ thscode: '000001.SH', interval: '1d', start: 0, end: 0, offset: 0 }), /unsupported parameter: offset/, '指数历史无 offset')
  assert.throws(() => history.normalizeParams({ thscode: '000001.SH', interval: '1d', start: 1, end: 0 }), /end must be >= start/)
})

test('query 形态：参数顺序稳定、逗号列表已规范化、缺失参数不下发', async () => {
  const { url: financial } = await executeWithFetch(
    byCapability('income_statement'),
    { thscode: '600519.sh', period: 'annual', limit: 3 },
  )
  assert.match(financial, /^https:\/\/fuyao\.aicubes\.cn\/api\/a-share\/financials\/income-statements\?thscode=600519\.SH&period=annual&limit=3$/)

  const { url: windowed } = await executeWithFetch(
    byCapability('cash_flow'),
    { thscode: '600519.SH', period: 'annual', start: 1577808000000, end: 1735574400000 },
  )
  assert.match(windowed, /\?thscode=600519\.SH&period=annual&start=1577808000000&end=1735574400000$/)

  const { url: indexHistory } = await executeWithFetch(
    byCapability('index_history'),
    { thscode: '000001.SH', interval: '1d', start: 1, end: 2 },
  )
  assert.match(indexHistory, /\/api\/a-share-index\/prices\/historical\?thscode=000001\.SH&interval=1d&start=1&end=2$/)

  const { url: ladder } = await executeWithFetch(byCapability('limit_up_ladder'), {})
  assert.match(ladder, /\/api\/a-share\/special-data\/limit-up-ladder$/, '无参端点不应带问号')

  const { url: deduped } = await executeWithFetch(byCapability('valuation'), { thscodes: '600519.sh,600519.SH' })
  assert.match(deduped, /thscodes=600519\.SH$/, '重复代码必须已去重')
})

test('Phase 2 输出护栏：主标识严格、指标宽容、null 放行', () => {
  const corporate = byCapability('corporate_actions')
  assert.equal(corporate.validateOutput({ thscode: '600519.SH', ticker: '600519', item: [{ ticker: '600519', ex_date_ms: 1766073600000, dividend_per_share: 23.957, per_share_bonus: 0 }] }), true)
  assert.equal(corporate.validateOutput({ thscode: '600519.SH', item: [] }), true, '无事件是合法结果')
  assert.equal(corporate.validateOutput({ item: [] }), false, '缺顶层 thscode')
  assert.equal(corporate.validateOutput({ thscode: '600519.SH', item: [{ dividend_per_share: 1 }] }), false, '缺 ex_date_ms')
  assert.equal(corporate.validateOutput({ thscode: '600519.SH', item: [{ ex_date_ms: 1, dividend_per_share: null, per_share_bonus: null }] }), true, 'null 事件字段放行')

  const financial = byCapability('balance_sheet')
  const row = { thscode: '000858.SZ', period: 'quarterly', fiscal_year: 2024, fiscal_period: 'Q4', report_date_ms: 1735574400000, period_end_ms: 1735574400000, currency: 'CNY', assets_total: 250000000000 }
  assert.equal(financial.validateOutput({ item: [row] }), true)
  assert.equal(financial.validateOutput({ item: [{ ...row, assets_total: null, total_debt: null }] }), true, '未披露金额为 null 放行')
  assert.equal(financial.validateOutput({ item: [{ ...row, assets_total: undefined }] }), true, '指标字段允许缺失（宽容口径）')
  assert.equal(financial.validateOutput({ item: [{ ...row, fiscal_period: undefined }] }), false, '期间标识缺失即判不符')
  assert.equal(financial.validateOutput({ item: [{ ...row, period: undefined }] }), false, 'period 回显缺失即判不符')

  const valuation = byCapability('valuation')
  assert.equal(valuation.validateOutput({ item: [{ thscode: '600519.SH', ticker: '600519', name: '贵州茅台', pe_ttm: 21.35, pe_mrq: null, pb_mrq: null, ps_ttm: null, pcf_ttm: null }] }), true)
  assert.equal(valuation.validateOutput({ item: [] }), true, '无匹配记录返回空数组是合法结果')
  assert.equal(valuation.validateOutput({ item: [{ ticker: '600519' }] }), false, '缺 thscode 判不符')
  assert.equal(valuation.validateOutput({ item: [{ thscode: '600519.SH', pe_ttm: '不是数字' }] }), false)

  const pool = byCapability('limit_up_pool')
  const poolItem = { thscode: '603986.SH', ticker: '603986', name: '兆易创新', is_st: false, is_new: false, last_price: 118.23, price_change_ratio_pct: 10.0008, limit_up_time: '09:34', limit_up_reason: null, continue_day_text: '2连板', continue_day_cnt: 2, seal_money: 123456789.12, max_seal_money: 234567890.12 }
  assert.equal(pool.validateOutput({ timestamp: 1748102400000, pagination: { total: 126, pages: 3, size: 50, page: 1 }, item: [poolItem] }), true)
  assert.equal(pool.validateOutput({ item: [poolItem] }), false, '缺 data.pagination 判不符')
  assert.equal(pool.validateOutput({ pagination: { total: 0, pages: 0, size: 50, page: 1 }, item: [] }), true)

  const ladder = byCapability('limit_up_ladder')
  assert.equal(ladder.validateOutput({ timestamp: 1, window: { length: 30, date_list: ['20250620'] }, item: [{ date: '20250620', boards: { two_board: [], three_board: [], four_board: [], five_board: [], six_board: [], seven_over: [] } }] }), true)
  assert.equal(ladder.validateOutput({ window: {}, item: [{ boards: {} }] }), false, '缺 item.date 判不符')
  assert.equal(ladder.validateOutput({ window: {}, item: [{ date: '20250620' }] }), false, '缺 boards 判不符')
  assert.equal(ladder.validateOutput({ item: [] }), false, '缺 data.window 判不符')

  const indexQuote = byCapability('index_quote')
  assert.equal(indexQuote.validateOutput({ timestamp: 1784275991000, total: 4, item: [{ thscode: '000001.SH', ticker: '000001', last_price: 3388.06, price_change: 12.21, price_change_ratio_pct: 0.3617 }] }), true)
  assert.equal(indexQuote.validateOutput({ item: [{ ticker: '000001', last_price: 1 }] }), false, '缺 thscode 判不符')

  const indexHistory = byCapability('index_history')
  assert.equal(indexHistory.validateOutput({ timestamp: 1, adjust: null, item: [{ date_ms: 1716134400000, close_price: 3120.68 }] }), true, '缺 OHLC 附属字段仍放行')
  assert.equal(indexHistory.validateOutput({ item: [{ close_price: 1 }] }), false, '缺 date_ms 判不符')

  const catalog = byCapability('index_catalog')
  assert.equal(catalog.validateOutput({ timestamp: 1, item: [{ thscode: '886042.TI', name: '白酒概念' }] }), true)
  assert.equal(catalog.validateOutput({ item: [{ name: '白酒概念' }] }), false, '缺 thscode 判不符')
})

// ── Phase 3：盘面特色数据与竞价基准 ─────────────────────────────────────────
// 这一批端点全部经真实探针确认可用；每个端点的 sort_field 白名单不同，
// 共用分页参数但不能共用枚举，故逐端点断言。

test('Phase 3：跌停池与炸板池的排序白名单各自独立', () => {
  const down = byCapability('limit_down_pool')
  const brk = byCapability('limit_break_pool')
  assert.deepEqual(
    down.normalizeParams({ page: 2, size: 200, sort_field: 'FIRST_LIMIT_TIME', sort_dir: 'ASC' }),
    { page: 2, size: 200, sort_field: 'first_limit_time', sort_dir: 'asc' },
  )
  assert.deepEqual(brk.normalizeParams({ sort_field: 'open_times' }), { sort_field: 'open_times' })
  // 两个端点的 sort_field 白名单不同：跌停池没有 open_times，炸板池没有 last_limit_time。
  assert.throws(() => down.normalizeParams({ sort_field: 'open_times' }), /invalid value/)
  assert.throws(() => brk.normalizeParams({ sort_field: 'last_limit_time' }), /invalid value/)
  for (const source of [down, brk]) {
    assert.throws(() => source.normalizeParams({ page: 0 }), /must be >= 1/)
    assert.throws(() => source.normalizeParams({ size: 201 }), /must be <= 200/)
    assert.throws(() => source.normalizeParams({ sort_dir: 'up' }), /invalid value/)
    assert.throws(() => source.normalizeParams({ date: '2026-07-01' }), /unsupported parameter: date/)
  }
})

test('Phase 3：飙升榜/热股榜的 period 与热度字符串口径', () => {
  const sky = byCapability('skyrocket_list')
  const hot = byCapability('hot_stock_list')
  assert.deepEqual(sky.normalizeParams({ period: 'HOUR' }), { period: 'hour' })
  assert.deepEqual(hot.normalizeParams({}), {})
  assert.throws(() => sky.normalizeParams({ period: 'week' }), /invalid value/)
  // heat 是上游原始字符串（保留精度），转成 number 判契约不符。
  const row = { thscode: '603822.SH', ticker: '603822', name: '嘉澳环保', rank: 1, heat: '1941909', rank_change: 7, rank_trend: 'up' }
  assert.equal(sky.validateOutput({ item: [row] }), true)
  assert.equal(sky.validateOutput({ item: [{ ...row, heat: 1941909 }] }), false, 'heat 必须是字符串')
  assert.equal(sky.validateOutput({ item: [{ ...row, rank_change: null }] }), true, 'rank_change 允许 null')
  assert.equal(sky.validateOutput({ item: [{ ticker: '603822' }] }), false, '缺 thscode 判不符')
})

test('Phase 3：历史热股榜 date 必填，排名走势要求日期成对且有序', () => {
  const history = byCapability('hot_stock_history')
  assert.deepEqual(history.normalizeParams({ date: ' 2026-06-21 ' }), { date: '2026-06-21' })
  assert.throws(() => history.normalizeParams({}), /missing required parameter: date/)
  assert.throws(() => history.normalizeParams({ date: '2026/06/21' }), /YYYY-MM-DD/)
  assert.throws(() => history.normalizeParams({ date: '2026-02-30' }), /valid calendar date/)

  const trend = byCapability('hot_stock_rank_trend')
  assert.deepEqual(
    trend.normalizeParams({ thscode: '300034.sz', start_date: '2026-06-21', end_date: '2026-07-01' }),
    { thscode: '300034.SZ', start_date: '2026-06-21', end_date: '2026-07-01' },
  )
  assert.throws(() => trend.normalizeParams({ start_date: '2026-06-21', end_date: '2026-07-01' }), /missing required parameter: thscode/)
  assert.throws(() => trend.normalizeParams({ thscode: '300034.SZ', start_date: '2026-07-01', end_date: '2026-06-21' }), /end_date must be >= start_date/)
  assert.throws(() => trend.normalizeParams({ thscode: '300034.SZ,600519.SH', start_date: '2026-06-21', end_date: '2026-07-01' }), /full thscode/)
})

test('Phase 3：异动标签大小写不敏感、拒绝空 token，批量代码上限 50', () => {
  const list = byCapability('anomaly_list')
  assert.deepEqual(list.normalizeParams({ tag_codes: 'limit_up, SHARP_FALL' }), { tag_codes: 'LIMIT_UP,SHARP_FALL' })
  assert.deepEqual(list.normalizeParams({ tag_codes: 'LIMIT_UP,limit_up' }), { tag_codes: 'LIMIT_UP' }, '重复标签去重')
  assert.deepEqual(list.normalizeParams({}), {}, '不传标签表示全部当日记录')
  assert.throws(() => list.normalizeParams({ tag_codes: 'LIMIT_UP,,SHARP_FALL' }), /empty tokens/)
  assert.throws(() => list.normalizeParams({ tag_codes: 'LIMIT_UP,' }), /empty tokens/)
  assert.throws(() => list.normalizeParams({ tag_codes: 'UP_LIMIT' }), /invalid value/)

  const stock = byCapability('anomaly_stock')
  assert.deepEqual(stock.normalizeParams({ thscodes: '600519.sh, 000001.SZ,600519.SH' }), { thscodes: '600519.SH,000001.SZ' })
  assert.throws(() => stock.normalizeParams({}), /missing required parameter: thscodes/)
  const overLimit = Array.from({ length: 51 }, (_, index) => `60${String(index).padStart(4, '0')}.SH`).join(',')
  assert.throws(() => stock.normalizeParams({ thscodes: overLimit }), /at most 50 codes/)
  // 关键词数组：空数组合法，非数组判不符
  const row = { thscode: '600519.SH', stock_name: '贵州茅台', analysis_content: '异动解读', keyword_list: ['白酒'], tag_name: '大涨' }
  assert.equal(stock.validateOutput({ item: [row] }), true)
  assert.equal(stock.validateOutput({ item: [{ ...row, keyword_list: [] }] }), true)
  assert.equal(stock.validateOutput({ item: [{ ...row, keyword_list: '白酒' }] }), false, 'keyword_list 必须是数组')
  assert.equal(stock.validateOutput({ item: [{ ...row, thscode: undefined }] }), false)
})

test('Phase 3：龙虎榜 board_type/date 校验，行数组是 stock_items 而非 item', () => {
  const tiger = byCapability('dragon_tiger')
  assert.deepEqual(tiger.normalizeParams({ board_type: 'HOT_MONEY', date: '2026-07-01' }), { board_type: 'hot_money', date: '2026-07-01' })
  assert.deepEqual(tiger.normalizeParams({}), {}, '省略时取默认榜与最近可用交易日')
  assert.throws(() => tiger.normalizeParams({ board_type: 'institution' }), /invalid value/)
  assert.throws(() => tiger.normalizeParams({ date: '2026-7-1' }), /YYYY-MM-DD/)

  const stock = { thscode: '002407.SZ', ticker: '002407', name: '多氟多', concept_list: [{ name: '锂电' }], change: 0.09994, net_value: 1786253128.23, net_rate: 0.119, hot_rank: 2, range_days: 3 }
  const container = { timestamp: 1782921600000, board_type: 'all', trade_date: '2026-07-01', count: 80, stock_count: 75, stock_items: [stock], hot_money_items: [] }
  assert.equal(tiger.validateOutput(container), true)
  assert.equal(tiger.validateOutput({ ...container, hot_money_items: undefined }), false, '缺 hot_money_items 判不符（两类榜单互斥但都存在）')
  assert.equal(tiger.validateOutput({ ...container, stock_items: undefined }), false, '缺 stock_items 判不符')
  assert.equal(tiger.validateOutput({ ...container, trade_date: undefined }), false, '缺 trade_date 判不符')
  assert.equal(tiger.validateOutput({ ...container, stock_items: [{ ticker: '002407' }] }), false, '行缺 thscode 判不符')
  // 游资榜：stock_items 为空、hot_money_items 填充
  assert.equal(tiger.validateOutput({ ...container, board_type: 'hot_money', stock_items: [], hot_money_items: [{ name: '某游资', buying: 1234.5, rows: [stock] }] }), true)
})

test('Phase 3：竞价基准 date 可选，错误日期被拒', () => {
  const source = byCapability('auction_benchmark')
  assert.deepEqual(source.normalizeParams({ date: '2026-08-14' }), { date: '2026-08-14' })
  assert.deepEqual(source.normalizeParams({}), {}, '省略时用上海时区当日')
  assert.throws(() => source.normalizeParams({ date: '2026-13-01' }), /valid calendar date/)
  assert.equal(source.validateOutput({ timestamp: 1786690800000, date: '2026-08-14', date_ms: 1786636800000, item: [{ thscode: '600519.SH', ticker: '600519', name: '贵州茅台', auction_pct: 0.35, tags: ['高开', '放量'] }] }), true)
  assert.equal(source.validateOutput({ date: '2026-08-14', date_ms: 1, item: [] }), true, '无精选标的时 item 为空数组')
  assert.equal(source.validateOutput({ date: '2026-08-14', item: [] }), false, '缺 date_ms 判不符')
})

test('Phase 3：2004 是同花顺 AI 客户端专用，错误必须引导停止重试', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ code: 2004, message: '该数据为同花顺AI客户端专用' }) })
  try {
    await assert.rejects(
      () => byCapability('limit_down_pool').execute(request({ page: 1 }), new AbortController().signal),
      (error) => {
        assert.match(error.message, /2004/)
        assert.match(error.message, /AI 客户端专用|未开放外部接入/)
        assert.match(error.message, /不要重试/)
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Phase 3：query 形态（跌停池排序、异动标签、龙虎榜）', async () => {
  const { url: pool } = await executeWithFetch(byCapability('limit_down_pool'), { page: 2, size: 50, sort_field: 'first_limit_time', sort_dir: 'asc' })
  assert.match(pool, /\/api\/a-share\/special-data\/limit-down-pool\?page=2&size=50&sort_field=first_limit_time&sort_dir=asc$/)

  const { url: anomaly } = await executeWithFetch(byCapability('anomaly_list'), { tag_codes: 'limit_up,sharp_fall' })
  assert.match(anomaly, /tag_codes=LIMIT_UP%2CSHARP_FALL$/)

  const { url: tiger } = await executeWithFetch(byCapability('dragon_tiger'), { board_type: 'org', date: '2026-07-01' })
  assert.match(tiger, /\/api\/a-share\/special-data\/dragon-tiger-list\?board_type=org&date=2026-07-01$/)
})

// ── Phase 3B：公募基金 ──────────────────────────────────────────────────────

test('Phase 3B：基金代码校验只接受 .OF/.SH/.SZ，且一律单数 thscode', () => {
  const profile = byCapability('fund_profile')
  assert.deepEqual(profile.normalizeParams({ thscode: ' 025480.of ' }), { thscode: '025480.OF' })
  assert.deepEqual(profile.normalizeParams({ thscode: '161725.sz' }), { thscode: '161725.SZ' })
  assert.throws(() => profile.normalizeParams({ thscode: '025480' }), /full fund thscode/)
  assert.throws(() => profile.normalizeParams({ thscode: '510300.SH,159919.SZ' }), /full fund thscode/, '基金端点不接受逗号多值')
  assert.throws(() => profile.normalizeParams({}), /missing required parameter: thscode/)
  // 标的类型不在本地判定范围：`.SH` 既是个股也是场内 ETF 的后缀，格式上无法区分，
  // 因此 600519.SH 会通过本地校验，由上游按真实标的类型返回 3004/3001。
  assert.deepEqual(profile.normalizeParams({ thscode: '600519.SH' }), { thscode: '600519.SH' })
})

test('Phase 3B：ths_api.md 的 fund_type 不是真实参数，传了必须被拒', () => {
  for (const capability of ['fund_profile', 'fund_quote', 'fund_nav', 'fund_holdings']) {
    assert.throws(
      () => byCapability(capability).normalizeParams({ thscode: '510300.SH', fund_type: 'exchange' }),
      /unsupported parameter: fund_type/,
      `${capability} 不应接受 fund_type（上游只是忽略它，我们不能静默吞掉）`,
    )
  }
})

test('Phase 3B：fund_history 窗口上限是 5 个自然年（不是 A 股的 10 年）', () => {
  const source = byCapability('fund_history')
  assert.throws(
    () => source.normalizeParams({ thscode: '510300.SH', start: 0, end: MAX_HISTORY_WINDOW_MS + 1 }),
    /5 year limit/,
    '6 年窗口必须被拒——A 股的 10 年上限不适用于基金场内历史',
  )
  assert.doesNotThrow(() => source.normalizeParams({ thscode: '510300.SH', start: 0, end: 1830 * 24 * 60 * 60 * 1000 }))
  assert.throws(() => source.normalizeParams({ thscode: '510300.SH', start: 2, end: 1 }), /end must be >= start/)
  assert.throws(() => source.normalizeParams({ thscode: '510300.SH', start: 1 }), /missing required parameter: end/)
  assert.deepEqual(source.normalizeParams({ thscode: '510300.SH', start: 1, end: 2, interval: '1D' }), { thscode: '510300.SH', interval: '1d', start: 1, end: 2 })
  assert.throws(() => source.normalizeParams({ thscode: '510300.SH', start: 1, end: 2, interval: '1m' }), /invalid value/)
})

test('Phase 3B：fund_nav 的 range 与 nav_type 枚举（含逗号取值 unit,adj）', () => {
  const source = byCapability('fund_nav')
  assert.deepEqual(source.normalizeParams({ thscode: '510300.SH', range: 'MONTH', nav_type: 'unit,ADJ' }), { thscode: '510300.SH', range: 'month', nav_type: 'unit,adj' })
  assert.deepEqual(source.normalizeParams({ thscode: '510300.SH' }), { thscode: '510300.SH' }, '省略 range 即最多返回最新一个净值日期')
  assert.throws(() => source.normalizeParams({ thscode: '510300.SH', range: 'day' }), /invalid value/)
  assert.throws(() => source.normalizeParams({ thscode: '510300.SH', nav_type: 'cumulative' }), /invalid value/)
  // nav_date 是毫秒时间戳而非日期字符串；未请求的 nav_type 字段不输出
  assert.equal(source.validateOutput({ item: [{ nav_date: 1782748800000, unit_nav: 3.9 }] }), true, 'nav_type=unit 时缺 adj_nav 合法')
  assert.equal(source.validateOutput({ item: [{ unit_nav: 3.9 }] }), false, '缺 nav_date 判不符')
})

test('Phase 3B：fund_stock_history 三个参数必填，report_type 不做枚举白名单', () => {
  const source = byCapability('fund_stock_history')
  assert.deepEqual(
    source.normalizeParams({ thscode: '510300.SH', report_type: 'quarter', end_date: '2026-06-30' }),
    { thscode: '510300.SH', report_type: 'quarter', end_date: '2026-06-30' },
  )
  assert.throws(() => source.normalizeParams({ thscode: '510300.SH', end_date: '2026-06-30' }), /missing required parameter: report_type/)
  assert.throws(() => source.normalizeParams({ thscode: '510300.SH', report_type: 'quarter' }), /missing required parameter: end_date/)
  assert.throws(() => source.normalizeParams({ thscode: '510300.SH', report_type: 'quarter', end_date: '2026/06/30' }), /YYYY-MM-DD/)
  // 上游 report_type 枚举未公开：annual/half 返回 5003（无该类型数据）而非参数错误，故本地不设白名单。
  assert.doesNotThrow(() => source.normalizeParams({ thscode: '510300.SH', report_type: 'half', end_date: '2026-06-30' }))
  // rank 仅前十大有值，其余为 null
  const row = { thscode: '600519.SH', ticker: '600519', name: '贵州茅台', asset_type: 'stock', hold_ratio: 4.67, market_value: 123456789.12, period_increase_pct: 0.12, rank: null, report_type: 'quarter', end_date_ms: 1782748800000 }
  assert.equal(source.validateOutput({ item: [row] }), true)
  assert.equal(source.validateOutput({ item: [{ ...row, rank: undefined }] }), true, 'rank 允许缺失')
  assert.equal(source.validateOutput({ item: [{ ...row, thscode: undefined }] }), false, '缺持仓代码判不符')
})

test('Phase 3B：fund_holders 口径枚举与 fund_top_holders 的 limit 边界', () => {
  const holders = byCapability('fund_holders')
  assert.deepEqual(holders.normalizeParams({ thscode: '161725.SZ', merge_scope: 'ALL' }), { thscode: '161725.SZ', merge_scope: 'all' })
  assert.deepEqual(holders.normalizeParams({ thscode: '161725.SZ' }), { thscode: '161725.SZ' }, '省略 merge_scope 默认 all')
  assert.throws(() => holders.normalizeParams({ thscode: '161725.SZ', merge_scope: 'single' }), /invalid value/)

  const top = byCapability('fund_top_holders')
  assert.deepEqual(top.normalizeParams({ thscode: '510300.SH', limit: 10 }), { thscode: '510300.SH', limit: 10 })
  assert.throws(() => top.normalizeParams({ thscode: '510300.SH', limit: 0 }), /must be >= 1/)
  assert.throws(() => top.normalizeParams({ thscode: '510300.SH', limit: 11 }), /must be <= 10/)
  // limit 限定报告期数而非行数：data.limit 可缺席，行数不受 limit 约束
  const row = { holder_id: 'T000280241', holder_code: '015016', holder_name: '某机构', holder_type: '一般法人', rank: 1, hold_share: 1000, hold_rate_pct: 20.5, report_date_ms: 1782748800000, publish_date_ms: 1782748800000 }
  assert.equal(top.validateOutput({ timestamp: 1, limit: 10, item: [row] }), true)
  assert.equal(top.validateOutput({ timestamp: 1, item: [row] }), true, 'data.limit 允许缺席')
  assert.equal(top.validateOutput({ timestamp: 1, limit: 10, item: [{ holder_name: '某机构' }] }), false, '缺 holder_id 判不符')
})

test('Phase 3B：fund_manager / fund_company 用 id 定位，可空字段放行', () => {
  const manager = byCapability('fund_manager')
  assert.deepEqual(manager.normalizeParams({ manager_id: ' M000000001 ' }), { manager_id: 'M000000001' })
  assert.throws(() => manager.normalizeParams({}), /missing required parameter: manager_id/)
  assert.throws(() => manager.normalizeParams({ thscode: '510300.SH' }), /unsupported parameter: thscode/,
    '经理端点只认 manager_id；用 thscode 查询属于协议错误')
  assert.equal(manager.validateOutput({ item: [{ manager_id: 'M1', manager_name: '张三', sex: null, degree: null, annual_return_pct: null, radar_comparison: [] }] }), true)
  assert.equal(manager.validateOutput({ item: [{ manager_name: '张三' }] }), false, '缺 manager_id 判不符')

  const company = byCapability('fund_company')
  assert.throws(() => company.normalizeParams({ company_id: '' }), /missing required parameter: company_id/)
  assert.equal(company.validateOutput({ item: [{ company_id: 'C1', company_name: '某基金', company_type: '公募', established_date_ms: 1, fund_count: 100, scale: 1234.5 }] }), true)
})

test('Phase 3B：fund_holdings 的汇总标量条件出现，缺了不算契约不符', () => {
  const source = byCapability('fund_holdings')
  const item = { thscode: '600519.SH', ticker: '600519', stock_name: '贵州茅台', hold_ratio: 4.67, asset_type: 'stock', position_capital: 1, position_count: 2, investment_rank: 1 }
  assert.equal(source.validateOutput({ timestamp: 1, item: [item] }), true, '无汇总标量仍合法')
  assert.equal(source.validateOutput({ timestamp: 1, total_stock_ratio_pct: 95.2, stock_ratio_pct: 95.2, main_industry: '白酒', concentration_ratio: 60.1, item: [item] }), true)
  assert.equal(source.validateOutput({ timestamp: 1, item: [{ ticker: '600519' }] }), false, '缺持仓代码判不符')
})

test('Phase 3B：query 形态（基金端点用单数 thscode、nav 区间、id 端点）', async () => {
  const { url: nav } = await executeWithFetch(byCapability('fund_nav'), { thscode: '510300.sh', range: 'year', nav_type: 'unit,adj' })
  assert.match(nav, /\/api\/fund\/performance\/nav\?thscode=510300\.SH&range=year&nav_type=unit%2Cadj$/)

  const { url: history } = await executeWithFetch(byCapability('fund_history'), { thscode: '510300.SH', start: 1, end: 2 })
  assert.match(history, /\/api\/fund\/market\/historical\?thscode=510300\.SH&start=1&end=2$/, '未传 interval 时不下发')

  const { url: company } = await executeWithFetch(byCapability('fund_company'), { company_id: 'C1' })
  assert.match(company, /\/api\/fund\/companies\/detail\?company_id=C1$/)
})

// ── Phase 3C：基金进阶子模块 ────────────────────────────────────────────────

test('Phase 3C：JSON 查询参数解析、形状校验与键序规范化', () => {
  const line = byCapability('fund_indicator_line')
  const indexes = '[{"index_info":[{"index_id":"rsi_pct"}],"thscodes":["510300.SH"]}]'
  const normalized = line.normalizeParams({ indexes, time_range: '{"time_type":"DAY_1"}' })
  // 键序被规范化（canonicalJson 递归排序），语义相同的 JSON 命中同一个 digest
  assert.equal(normalized.indexes, '[{"index_info":[{"index_id":"rsi_pct"}],"thscodes":["510300.SH"]}]')
  assert.equal(line.normalizeParams({ indexes: '[{"thscodes":["510300.SH"],"index_info":[{"index_id":"rsi_pct"}]}]', time_range: '{"time_type":"DAY_1"}' }).indexes, normalized.indexes,
    '键序不同的等价 JSON 必须归一到同一字符串')

  assert.throws(() => line.normalizeParams({ indexes: 'not json', time_range: '{"time_type":"DAY_1"}' }), /JSON array/)
  assert.throws(() => line.normalizeParams({ indexes: '{"a":1}', time_range: '{"time_type":"DAY_1"}' }), /JSON array/, '顶层必须是数组')
  assert.throws(() => line.normalizeParams({ indexes: '[]', time_range: '{"time_type":"DAY_1"}' }), /at least one group/)
  assert.throws(() => line.normalizeParams({ indexes: '[{"index_info":[{"index_id":"x"}]}]', time_range: '{"time_type":"DAY_1"}' }), /non-empty thscodes/)
  assert.throws(() => line.normalizeParams({ indexes: '[{"thscodes":["510300.SH"],"index_info":[{}]}]', time_range: '{"time_type":"DAY_1"}' }), /string index_id/)
  assert.throws(() => line.normalizeParams({ indexes: '[{"thscodes":["510300.SH"],"index_info":[{"index_id":"x"}]}]', time_range: '{"time_type":""}' }), /string time_type/)
  assert.throws(() => line.normalizeParams({ indexes: '[{"thscodes":["510300.SH"],"index_info":[{"index_id":"x"}]}]', time_range: '{"time_type":"DAY_1","start":"1"}' }), /time_range.start must be an integer/)
  assert.throws(() => line.normalizeParams({ indexes: '[{"thscodes":["510300.SH"],"index_info":[{"index_id":"x"}]}]' }), /missing required parameter: time_range/)
  assert.throws(() => line.normalizeParams({ indexes: '[{"thscodes":["510300.SH"],"index_info":[{"index_id":"x"}]}]', time_range: '{"time_type":"DAY_1"}', extra: 1 }), /unsupported parameter: extra/)
})

test('Phase 3C：indicators/table 四个参数全可选，但至少要给一个', () => {
  const table = byCapability('fund_indicator_table')
  assert.deepEqual(table.normalizeParams({ indexes: '[{"index_id":"rsi_pct"}]' }), { indexes: '[{"index_id":"rsi_pct"}]' })
  assert.deepEqual(table.normalizeParams({ page_info: '{"page_begin":0,"page_size":5}' }), { page_info: '{"page_begin":0,"page_size":5}' })
  assert.deepEqual(
    table.normalizeParams({ code_selectors: '{"fund_code":{"thscodes":["510300.SH"]}}', sort: '[{"idx":0,"type":"desc"}]' }),
    { code_selectors: '{"fund_code":{"thscodes":["510300.SH"]}}', sort: '[{"idx":0,"type":"desc"}]' },
  )
  assert.throws(() => table.normalizeParams({}), /at least one of/)
  assert.throws(() => table.normalizeParams({ code_selectors: '[]' }), /JSON object/)
})

test('Phase 3C：顶层数组响应（quota/summary、backtest/indicators）不能用 envelope 口径解析', () => {
  const summary = byCapability('fund_quota_summary')
  assert.equal(summary.validateOutput([{ name: '纳指100', unlimited: '3', total_limit: '10', total: '13', buy: '5' }]), true)
  assert.equal(summary.validateOutput([]), true, '空数组合法')
  assert.equal(summary.validateOutput({ item: [] }), false, '顶层必须是数组，不是 {item:[]}')
  assert.equal(summary.validateOutput([{ unlimited: '3' }]), false, '缺 name 判不符')
  // 五个字段全部是字符串，数字会判契约不符
  assert.equal(summary.validateOutput([{ name: 'x', total: 13 }]), false)

  const indicators = byCapability('fund_backtest_indicators')
  assert.equal(indicators.validateOutput([{ indicator_code: 'rsi_pct', indicator_name: 'RSI', unit: null, description: null, state_rules: null, create_time: '2026-05-27T16:57:32' }]), true)
  assert.equal(indicators.validateOutput([{ indicator_name: 'RSI' }]), false, '缺 indicator_code 判不符')
  assert.equal(indicators.validateOutput({ status: 'ok' }), false)
})

test('Phase 3C：quota/list 三层嵌套护栏', () => {
  const quota = byCapability('fund_quota_list')
  const good = [{ name: '热门', sub_tab: [{ name: '全部', fund_list: [{ thscode: '513100.SH', fund_name: '纳指ETF', quota: null, year: '12.3' }] }] }]
  assert.equal(quota.validateOutput(good), true)
  assert.equal(quota.validateOutput([]), true)
  assert.equal(quota.validateOutput([{ name: '热门' }]), false, '缺 sub_tab')
  assert.equal(quota.validateOutput([{ name: '热门', sub_tab: [{ name: '全部' }] }]), false, '缺 fund_list')
  assert.equal(quota.validateOutput([{ name: '热门', sub_tab: [{ name: '全部', fund_list: [{ fund_name: 'x' }] }] }]), false, '基金项缺 thscode')
  assert.equal(quota.validateOutput([{ name: '热门', sub_tab: [{ name: '全部', fund_list: [{ thscode: 'x', quota: 5 }] }] }]), false, 'quota 必须是字符串或 null')
  // tab 必须是 JSON 数组；buy 是布尔且省略时不下发
  assert.deepEqual(quota.normalizeParams({ tab: '["remen"]' }), { tab: '["remen"]' })
  assert.deepEqual(quota.normalizeParams({ tab: '["remen"]', buy: true }), { tab: '["remen"]', buy: true })
  assert.throws(() => quota.normalizeParams({ tab: 'remen' }), /JSON array/)
  assert.throws(() => quota.normalizeParams({ tab: '["remen"]', buy: 'yes' }), /must be a boolean/)
})

test('Phase 3C：indicators/line 的三层自定义护栏', () => {
  const line = byCapability('fund_indicator_line')
  const good = { time_range: [1716105600000, null], indexes: [{ index_id: 'rsi_pct' }], data: [{ thscode: '510300.SH', values: [{ idx: 0, values: [1, null] }] }] }
  assert.equal(line.validateOutput(good), true)
  assert.equal(line.validateOutput({ ...good, time_range: 'x' }), false, 'time_range 必须是数组')
  assert.equal(line.validateOutput({ ...good, indexes: [{}] }), false, 'indexes 缺 index_id')
  assert.equal(line.validateOutput({ ...good, data: [{ values: [] }] }), false, 'data 项缺 thscode')
  assert.equal(line.validateOutput({ ...good, data: [{ thscode: 'x', values: [{ idx: '0' }] }] }), false, 'values.idx 必须是整数')
})

test('Phase 3C：json 字段类型容忍"文档写 object、实际是 array/null"', () => {
  const diagnostics = byCapability('fund_diagnostics')
  const base = { thscode: '510300.SH', ticker: '510300', fund_type: 'exchange', peer_code: 'ETF-INDEX' }
  // 实测 dimensions/resilience 是数组、probabilities/ranges 是 null
  assert.equal(diagnostics.validateOutput({ item: [{ ...base, dimensions: [{ year: '2026' }], resilience: [], probabilities: null, ranges: null }] }), true)
  assert.equal(diagnostics.validateOutput({ item: [{ ...base, dimensions: {}, probabilities: null }] }), true, '对象同样放行（上游结构保留）')
  assert.equal(diagnostics.validateOutput({ item: [{ ...base }] }), true, '缺失也放行：这些字段是"保留上游结构"，不做存在性约束')
  assert.equal(diagnostics.validateOutput({ item: [{ ticker: '510300' }] }), false, '缺 thscode 仍判不符')

  const experience = byCapability('fund_manager_experience')
  assert.equal(experience.validateOutput({ item: [{ awards: [], heavy_assets: {}, investment_history: { '460300': { name: 'x', end: '至今' } } }] }), true)
})

test('Phase 3C：经理区间枚举只有 5 个值（与 nav 的 8 值不同）', () => {
  const performance = byCapability('fund_manager_performance')
  assert.deepEqual(performance.normalizeParams({ manager_id: 'M1', range: 'YEAR' }), { manager_id: 'M1', range: 'year' })
  for (const invalid of ['week', 'hyear', 'fyear', 'twoyear', 'tyear']) {
    assert.throws(() => performance.normalizeParams({ manager_id: 'M1', range: invalid }), /invalid value/, `${invalid} 不属于经理区间枚举`)
  }
  assert.throws(() => performance.normalizeParams({ manager_id: 'M1' }), /missing required parameter: range/)
  // 而 nav 的 8 值枚举仍然接受这些值，两者不能共用
  assert.doesNotThrow(() => byCapability('fund_nav').normalizeParams({ thscode: '510300.SH', range: 'hyear' }))
})

test('Phase 3C：回测参数校验与响应口径护栏', () => {
  const backtest = byCapability('fund_backtest')
  const params = { thscode: '000001.of', buy_conditions: '{"indicator_code":"rsi_pct"}', sell_conditions: '[{"indicator_code":"rsi_pct"}]', buy_frequency_type: 'WEEKLY', max_buy_times: 5, per_buy_amount: 100 }
  assert.deepEqual(backtest.normalizeParams(params), { ...params, thscode: '000001.OF' })
  assert.throws(() => backtest.normalizeParams({ ...params, buy_conditions: 'not json' }), /JSON object-or-array/)
  assert.throws(() => backtest.normalizeParams({ ...params, buy_conditions: '"字符串"' }), /JSON object-or-array/, '字符串不是对象也不是数组')
  assert.doesNotThrow(() => backtest.normalizeParams({ ...params, buy_conditions: '[{"indicator_code":"rsi_pct"}]' }), '数组形态合法（文档：对象或数组）')
  assert.throws(() => backtest.normalizeParams({ ...params, max_buy_times: 0 }), /must be >= 1/)
  assert.throws(() => backtest.normalizeParams({ ...params, per_buy_amount: -1 }), /must be >= 0/)
  assert.throws(() => backtest.normalizeParams({ ...params, per_buy_amount: '100' }), /must be a number/)
  assert.throws(() => backtest.normalizeParams({ thscode: '000001.OF' }), /missing required parameter: buy_conditions/)
  // 响应日期是 yyyy-MM-dd 字符串而非毫秒；trades 必为数组
  const data = { start_date: '2023-09-08', end_date: '2026-09-08', metrics: { strategy_return: 0.42, win_rate: 0 }, trade_count: 726, trades: [{ trade_date: '2023-09-11', type: 'BUY', profit: null }], curve_points: { '2023-09-08': 0 } }
  assert.equal(backtest.validateOutput(data), true)
  assert.equal(backtest.validateOutput({ ...data, start_date: 123 }), false, '日期必须是字符串')
  assert.equal(backtest.validateOutput({ ...data, trades: {} }), false, 'trades 必须是数组')
  assert.equal(backtest.validateOutput({ end_date: '2026-09-08', metrics: {}, trades: [] }), false, '缺 start_date')
})

test('Phase 3C：offerings 的 subscribe 是 active|upcoming，不是布尔或日期', () => {
  const offerings = byCapability('fund_offerings')
  assert.deepEqual(offerings.normalizeParams({ subscribe: 'ACTIVE' }), { subscribe: 'active' })
  assert.deepEqual(offerings.normalizeParams({ subscribe: 'upcoming' }), { subscribe: 'upcoming' })
  assert.throws(() => offerings.normalizeParams({}), /missing required parameter: subscribe/)
  assert.throws(() => offerings.normalizeParams({ subscribe: '1' }), /invalid value/)
  assert.throws(() => offerings.normalizeParams({ subscribe: '2026-09-01' }), /invalid value/)
})

test('Phase 3C：基金端点一律不吃复数 thscodes（除既有约定外）', () => {
  for (const capability of ['fund_performance_history', 'fund_income', 'fund_backtest_indicators']) {
    const source = byCapability(capability)
    if (capability === 'fund_backtest_indicators') {
      assert.deepEqual(source.normalizeParams({}), {})
      assert.throws(() => source.normalizeParams({ thscode: '510300.SH' }), /unsupported parameter: thscode/, '该端点无业务参数')
    }
  }
  assert.throws(() => byCapability('fund_income').normalizeParams({ thscodes: '510300.SH,159919.SZ' }), /unsupported parameter: thscodes/)
})

// ── 复核修正（2026-09 独立测试报告）──────────────────────────────────────────

test('修正①：fund_returns 必须接受官方文档示例（其中没有 return_week）', () => {
  const source = byCapability('fund_returns')
  // 官方示例字段（llm_full.md:4385-4394）：只有 8 个 return_*，缺 return_week / return_twoyear
  const documented = { return_month: -3.33, return_tmonth: 0.03, return_hyear: 0.19, return_year: 19.66, return_tyear: 28.69, return_fyear: 1.77, return_nowyear: 2.49, return_now: 121.58 }
  assert.equal(source.validateOutput({ timestamp: 1782748800000, item: [documented] }), true,
    '官方示例是合法响应，护栏不得误杀')
  // 只返回一个排名字段的极端情况同样合法
  assert.equal(source.validateOutput({ item: [{ rank_week: 12 }] }), true)
  assert.equal(source.validateOutput({ item: [{ peer_average_year: 8.1 }] }), true)
  // 但完全不含收益/排名族字段的行仍判契约不符（防垃圾结构）
  assert.equal(source.validateOutput({ item: [{ thscode: '510300.SH' }] }), false)
  assert.equal(source.validateOutput({ item: [{}] }), false)
  assert.equal(source.validateOutput({ item: 'x' }), false)
  assert.equal(source.validateOutput({ items: [documented] }), false, '必须是 item 数组')
})

test('修正④：fund_indicator_table 声明为分页能力（有 page_info/page_begin/page_size）', () => {
  const table = byCapability('fund_indicator_table')
  assert.equal(table.schema.paginated, true)
  const schema = table.schema.input_schema.properties.page_info.description
  assert.match(schema, /page_begin|page_size/)
  // 其余端点不应被顺手标成可分页
  assert.equal(byCapability('fund_income').schema.paginated, false)
})

test('修正⑤：anomaly_list.tag_codes 不得声明为单值 enum（实现支持逗号 OR）', () => {
  const source = byCapability('anomaly_list')
  const descriptor = source.schema.input_schema.properties.tag_codes
  assert.ok(!('enum' in descriptor), 'tag_codes 支持逗号分隔多值，声明 enum 会让模型以为只能传单值')
  assert.match(descriptor.description, /逗号分隔|多个值/)
  assert.deepEqual(source.normalizeParams({ tag_codes: 'LIMIT_UP,SHARP_FALL' }), { tag_codes: 'LIMIT_UP,SHARP_FALL' })
})

test('修正⑥：ticker_search 的交易所与资产类型按官方契约全量放开', () => {
  const search = byCapability('ticker_search')
  const exchange = search.schema.input_schema.properties.exchange
  for (const code of ['SH', 'SZ', 'BJ', 'SSE', 'SZSE', 'CFFEX', 'SHFE', 'INE', 'DCE', 'CZCE', 'GFEX']) {
    assert.ok(exchange.enum.includes(code), `exchange 应支持 ${code}`)
  }
  const assetType = search.schema.input_schema.properties.asset_type.description
  assert.match(assetType, /futures/)
  assert.match(assetType, /options/)
  assert.match(assetType, /仅可用于消歧|不提供其数据端点/, '必须写明期货/期权只做消歧')
  assert.deepEqual(search.normalizeParams({ q: '沪深300', exchange: 'cffex' }), { q: '沪深300', exchange: 'CFFEX' })
  assert.deepEqual(search.normalizeParams({ q: '豆粕', asset_type: 'futures,options' }), { q: '豆粕', asset_type: 'futures,options' })
  assert.throws(() => search.normalizeParams({ q: 'x', exchange: 'NASDAQ' }), /invalid value/)
})

test('修正⑦：envelope 的 timestamp/total 在模型可见 schema 中允许 null', () => {
  const quote = byCapability('fund_quote')
  const properties = quote.schema.output_schema.properties
  for (const field of ['timestamp', 'total']) {
    assert.equal(properties[field].oneOf.length, 2, `${field} 必须声明 integer | null`)
    assert.deepEqual(properties[field].oneOf.map((entry) => entry.type), ['integer', 'null'])
  }
  // 运行时护栏本来就放行 null，两者现在一致
  assert.equal(quote.validateOutput({ timestamp: null, item: [] }), true)
})
