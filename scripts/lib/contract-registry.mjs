/**
 * Contract-probe registry (gate body for `docs/dev/tool-schema.md` §10.8): daily / weekly / shadow
 * (probed, not judged) / excluded (with a reason). ⛔ No URLs or field lists — those come from
 * production `execute()` / `output_schema`. Params stay reproducible: omit dates or use `dayShift`.
 */

// Only these verdicts open an issue; pure data so the publish script needn't import the whole lib.
export const ISSUE_VERDICTS = Object.freeze(['GUARD', 'ENVELOPE', 'HTTP_STATUS'])

/** Conservative initial latency budget, to be backfilled from hosted P95. */
export const DEFAULT_BUDGET_MS = 20_000

/** Family = throttle group: serial within, gap between; never concurrent across (two throttles = none). */
export const PROBE_FAMILIES = ['fuyao', 'eastmoney', 'tencent', 'retriever', 'anysearch', 'wind', 'paddle', 'ftshare']

/** Gap between families so connection and rate counters cool down. */
export const PROVIDER_GAP_MS = 2_000

/**
 * Probe-only floor: production fuyao is bare fetch with no spacing (the Hub serializes); 400 ms kept
 * 61 endpoints under 4001. ⚠️ Do not copy this into production.
 */
export const FUYAO_PROBE_GAP_MS = 400

/** Default secret per family; the gate checks only those used. */
export const FAMILY_SECRET = {
  fuyao: 'FUYAO_API_KEY',
  anysearch: 'ANYSEARCH_API_KEY',
  wind: 'WIND_API_KEY',
  paddle: 'PADDLE_OCR_TOKEN',
  ftshare: 'FTSHARE_API_KEY',
}

/** Known upstream gap codes: not a failure, but listed in the report every day. */
export const KNOWN_GAP_CODES = Object.freeze(['1002', '2004', '5003'])

const ETFS = '510300.SH'
const A_SHARE = '600519.SH'

// `dayShift(-1)` = previous calendar day; a marker resolved once per run. ⛔ No absolute dates:
// the window ages until it is permanently EMPTY.
const dayShift = (days) => {
  if (!Number.isInteger(days)) throw new RangeError(`dayShift 要整数天，拿到 ${JSON.stringify(days)}`)
  return { dayShift: days }
}

/** DataSource face (production execute + validateOutput) and probe face (runner's probeTable). */
const ds = (family, capability, tier, params, extra = {}) => ({
  face: 'datasource', family, capability, tier, params, budgetMs: DEFAULT_BUDGET_MS, ...extra,
})
const pr = (family, capability, tier, extra = {}) => ({
  face: 'probe', family, capability, tier, budgetMs: DEFAULT_BUDGET_MS, ...extra,
})
/** Not probed: no tier, skipped by the runner but still required by the coverage test. */
const out = (family, capability, reason, since) => ({
  face: 'probe', family, capability, excluded: { since, reason },
})
/** Same, for a registered DataSource; the coverage test counts faces separately. */
const dsOut = (family, capability, reason, since) => ({
  face: 'datasource', family, capability, params: {}, excluded: { since, reason },
})

const HISTORY_START = Date.UTC(2025, 0, 2)
const HISTORY_END = Date.UTC(2025, 1, 28)

/** Four entries need a real id; an invented id returns 5003, a script bug rather than upstream fault. */
const MANAGER_RESOLVE = {
  requires: 'manager_id',
  resolveFrom: { capability: 'fund_profile', params: { thscode: ETFS }, path: 'item.0.manager_info.0.manager_id' },
}

const FUYAO = [
  ds('fuyao', 'ticker_search', 'daily', { q: '贵州茅台', limit: 1 }, { expect: { minRows: 1 } }),
  ds('fuyao', 'ticker_list', 'daily', { asset_type: 'a-share', limit: 1 }, { expect: { minRows: 1 } }),
  ds('fuyao', 'quote', 'daily', { thscodes: A_SHARE }, { expect: { minRows: 1, identity: { field: 'thscode', value: '600519.SH' } } }),
  ds('fuyao', 'history', 'daily', { thscode: A_SHARE, interval: '1d', start: HISTORY_START, end: HISTORY_END }, { expect: { minRows: 1 } }),
  ds('fuyao', 'trading_calendar', 'daily', {}, { expect: { minRows: 1 }, note: '巡检第一件事：它决定后面所有 EMPTY 怎么解释' }),
  ds('fuyao', 'corporate_actions', 'daily', { thscode: A_SHARE }),
  ds('fuyao', 'income_statement', 'daily', { thscode: A_SHARE, period: 'annual', limit: 1 }, { expect: { minRows: 1 } }),
  ds('fuyao', 'balance_sheet', 'daily', { thscode: A_SHARE, period: 'annual', limit: 1 }, { expect: { minRows: 1 } }),
  ds('fuyao', 'cash_flow', 'daily', { thscode: A_SHARE, period: 'annual', limit: 1 }, { expect: { minRows: 1 } }),
  ds('fuyao', 'financial_indicators', 'daily', { thscode: '300033.SZ', report: '2024-4' }),
  ds('fuyao', 'valuation', 'daily', { thscodes: A_SHARE }, { expect: { minRows: 1 } }),
  ds('fuyao', 'auction', 'daily', { thscodes: A_SHARE }),
  ds('fuyao', 'limit_up_pool', 'daily', { page: 1, size: 5 }),
  ds('fuyao', 'limit_down_pool', 'daily', { page: 1, size: 5 }),
  ds('fuyao', 'limit_break_pool', 'daily', { page: 1, size: 5 }),
  ds('fuyao', 'limit_up_ladder', 'daily', {}),
  ds('fuyao', 'skyrocket_list', 'daily', { period: 'day' }),
  ds('fuyao', 'hot_stock_list', 'daily', { period: 'day' }),
  ds('fuyao', 'anomaly_list', 'daily', { tag_codes: 'LIMIT_UP' }),
  ds('fuyao', 'anomaly_stock', 'daily', { thscodes: A_SHARE }),
  ds('fuyao', 'dragon_tiger', 'daily', {}, { note: '省略 date：显式传非交易日返回 1002，不自动回退' }),
  ds('fuyao', 'auction_benchmark', 'daily', {}),
  ds('fuyao', 'index_catalog', 'daily', { tag: 'industry' }, { expect: { minRows: 1 } }),
  ds('fuyao', 'index_constituents', 'daily', { thscode: '000300.SH' }, { expect: { minRows: 1 } }),
  ds('fuyao', 'index_quote', 'daily', { thscodes: '000001.SH,399001.SZ' }, { expect: { minRows: 1 } }),
  ds('fuyao', 'index_history', 'daily', { thscode: '000001.SH', interval: '1d', start: HISTORY_START, end: HISTORY_END }, { expect: { minRows: 1 } }),

  ds('fuyao', 'hot_stock_history', 'weekly', { date: '2026-06-21' }),
  ds('fuyao', 'hot_stock_rank_trend', 'weekly', { thscode: '300034.SZ', start_date: '2026-06-21', end_date: '2026-07-01' }),
  ds('fuyao', 'fund_profile', 'weekly', { thscode: ETFS }, { expect: { minRows: 1 }, note: 'manager_id / company_id 从这里解析' }),
  ds('fuyao', 'fund_quote', 'weekly', { thscode: ETFS }),
  ds('fuyao', 'fund_history', 'weekly', { thscode: ETFS, start: HISTORY_START, end: HISTORY_END }),
  ds('fuyao', 'fund_nav', 'weekly', { thscode: ETFS, range: 'month' }),
  ds('fuyao', 'fund_returns', 'weekly', { thscode: ETFS }),
  ds('fuyao', 'fund_drawdowns', 'weekly', { thscode: ETFS }),
  ds('fuyao', 'fund_holdings', 'weekly', { thscode: ETFS }),
  ds('fuyao', 'fund_asset_allocation', 'weekly', { thscode: ETFS }),
  ds('fuyao', 'fund_industry_allocation', 'weekly', { thscode: '025480.OF' }),
  ds('fuyao', 'fund_stock_history', 'weekly', { thscode: ETFS, report_type: 'quarter', end_date: '2026-06-30' }),
  ds('fuyao', 'fund_holders', 'weekly', { thscode: '161725.SZ' }),
  ds('fuyao', 'fund_top_holders', 'weekly', { thscode: ETFS, limit: 10 }),
  ds('fuyao', 'fund_manager', 'weekly', {}, MANAGER_RESOLVE),
  ds('fuyao', 'fund_company', 'weekly', {}, {
    requires: 'company_id',
    resolveFrom: { capability: 'fund_profile', params: { thscode: ETFS }, path: 'item.0.company_id' },
  }),
  ds('fuyao', 'fund_performance_history', 'weekly', { thscode: ETFS, start: HISTORY_START, end: HISTORY_END }),
  ds('fuyao', 'fund_bond_history', 'weekly', { thscode: ETFS, report_type: 'quarter', end_date: '2026-06-30' }),
  ds('fuyao', 'fund_stock_report_dates', 'weekly', { thscode: ETFS }),
  ds('fuyao', 'fund_bond_report_dates', 'weekly', { thscode: ETFS }),
  ds('fuyao', 'fund_manager_experience', 'weekly', {}, MANAGER_RESOLVE),
  ds('fuyao', 'fund_manager_style', 'weekly', {}, { ...MANAGER_RESOLVE, knownCodes: ['5003'] }),
  ds('fuyao', 'fund_manager_performance', 'weekly', { range: 'year' }, { ...MANAGER_RESOLVE, knownCodes: ['5003'] }),
  ds('fuyao', 'fund_income', 'weekly', { thscode: ETFS }),
  ds('fuyao', 'fund_balance', 'weekly', { thscode: ETFS }),
  ds('fuyao', 'fund_financial_indicators', 'weekly', { thscode: ETFS }),
  ds('fuyao', 'fund_indicator_line', 'weekly', {
    indexes: JSON.stringify([{ thscodes: [ETFS], index_info: [{ index_id: 'rsi_pct' }] }]),
    time_range: JSON.stringify({ time_type: 'DAY_1' }),
  }),
  ds('fuyao', 'fund_indicator_table', 'weekly', { indexes: JSON.stringify([{ index_id: 'rsi_pct' }]) }, { knownCodes: ['5003'] }),
  ds('fuyao', 'fund_dividends', 'weekly', { thscode: ETFS }),
  ds('fuyao', 'fund_offerings', 'weekly', { subscribe: 'active' }),
  ds('fuyao', 'fund_quota_list', 'weekly', { tab: JSON.stringify(['remen']) }),
  ds('fuyao', 'fund_quota_summary', 'weekly', { tab: JSON.stringify(['nazhi100']) }),
  ds('fuyao', 'fund_diagnostics', 'weekly', { thscode: ETFS }),
  ds('fuyao', 'fund_backtest', 'weekly', {
    thscode: '000001.OF',
    buy_conditions: JSON.stringify({ indicator_code: 'rsi_pct', operator: '>', value: 0.5 }),
    sell_conditions: JSON.stringify({ indicator_code: 'rsi_pct', operator: '<', value: 0.3 }),
    buy_frequency_type: 'WEEKLY', max_buy_times: 5, per_buy_amount: 100,
  }),
  ds('fuyao', 'fund_backtest_indicators', 'weekly', {}),
]

// Every eastmoney endpoint, not one per family: upstream changes hit a single endpoint.
// Billboard rows use relative bounds and resolve `thscode` from today's real list, so EMPTY can only
// mean upstream trouble. ⚠️ A `requires` key doubles as the injected param name, one per entry.
const BILLBOARD = { start_date: dayShift(-30), end_date: dayShift(-1), page: 1, size: 3 }
const EM_RANGE = { start_date: '2025-01-01', end_date: dayShift(-1), page: 1, size: 3 }
const EM = [
  ds('eastmoney', 'eastmoney_top_buy_sell_market', 'daily', { ...BILLBOARD }, { expect: { minRows: 1 } }),
  ds('eastmoney', 'eastmoney_top_buy_sell_ticker', 'daily', { ...BILLBOARD },
    { requires: 'ticker', resolveFrom: { capability: 'eastmoney_top_buy_sell_market', params: { ...BILLBOARD }, path: 'item.0.thscode' } }),
  ds('eastmoney', 'eastmoney_lockup_expiry', 'daily', { start_date: dayShift(0), end_date: dayShift(90), page: 1, size: 3 }),
  ds('eastmoney', 'eastmoney_sector_rotation', 'daily', { page: 1, size: 3 }, { note: '海外视角经 302 到 push2delay 延迟镜像，禁止对它做新鲜度断言' }),
  ds('eastmoney', 'eastmoney_cashflow_rotation', 'daily', { page: 1, size: 3 }, { note: '同上' }),
  ds('eastmoney', 'eastmoney_cpi', 'daily', EM_RANGE, { expect: { minRows: 1 } }),
  ds('eastmoney', 'eastmoney_ppi', 'daily', EM_RANGE, { expect: { minRows: 1 } }),
  ds('eastmoney', 'eastmoney_gdp', 'daily', EM_RANGE, { expect: { minRows: 1 } }),
  ds('eastmoney', 'eastmoney_pmi', 'daily', EM_RANGE, { expect: { minRows: 1 } }),
  ds('eastmoney', 'eastmoney_money_supply', 'daily', EM_RANGE, { expect: { minRows: 1 } }),
  ds('eastmoney', 'eastmoney_rmb_loan', 'daily', EM_RANGE, { expect: { minRows: 1 } }),
  ds('eastmoney', 'eastmoney_customs_trade', 'daily', EM_RANGE, { expect: { minRows: 1 } }),
  ds('eastmoney', 'eastmoney_retail_sales', 'daily', EM_RANGE, { expect: { minRows: 1 } }),
  ds('eastmoney', 'eastmoney_deposit_reserve', 'daily', EM_RANGE, { expect: { minRows: 1 } }),
  ds('eastmoney', 'eastmoney_mutual_flow', 'daily', { start_date: dayShift(-30), end_date: dayShift(-1), page: 1, size: 3 }),
  ds('eastmoney', 'eastmoney_main_capital_snapshot', 'daily', { page: 1, size: 3 }),
  ds('eastmoney', 'eastmoney_dividend_plan', 'daily', { ticker: A_SHARE, ...EM_RANGE }),
  ds('eastmoney', 'eastmoney_holder_number_snapshot', 'daily', { page: 1, size: 3 }),
  ds('eastmoney', 'eastmoney_mutual_quota', 'daily', {}, { note: '无参数；closed_reason 非空表示休市，是合法结果' }),
  ds('eastmoney', 'eastmoney_margin_trading', 'daily', { ticker: A_SHARE, start_date: dayShift(-30), end_date: dayShift(-1), page: 1, size: 3 }),
  ds('eastmoney', 'eastmoney_convertible_bond_list', 'daily', { start_date: dayShift(-180), end_date: dayShift(-1), page: 1, size: 3 }),
]

const TX = [
  ds('tencent', 'tencent_quote', 'daily', { codes: [A_SHARE] }, { expect: { minRows: 1, identity: { field: 'tencent_symbol', value: 'sh600519' } } }),
  ds('tencent', 'tencent_kline', 'daily', { code: A_SHARE, period: 'day', count: 10 }, { expect: { minRows: 1 } }),
  // Ticks paginate (MAX_TICK_PAGES=300) and can take 4.5 s, so it gets its own budget.
  ds('tencent', 'tencent_ticks', 'daily', { code: '000001.SZ' }, { budgetMs: 30_000 }),
  ds('tencent', 'tencent_hk_quote', 'daily', { codes: ['00700'] }, { expect: { minRows: 1 } }),
  ds('tencent', 'tencent_us_quote', 'daily', { codes: ['AAPL'] }, { expect: { minRows: 1 } }),
  ds('tencent', 'tencent_hk_index_quote', 'daily', { codes: ['HSI'] }, { expect: { minRows: 1 } }),
  ds('tencent', 'tencent_us_index_quote', 'daily', { codes: ['usDJI'] }, { expect: { minRows: 1, identity: { field: 'tencent_symbol', value: 'usDJI' } } }),
  ds('tencent', 'tencent_hk_kline', 'daily', { code: '00700', period: 'day', count: 5 }, { expect: { minRows: 1 } }),
  ds('tencent', 'tencent_us_kline', 'daily', { code: 'AAPL', period: 'day', count: 5 }, { expect: { minRows: 1 } }),
]

const WIND_DATA = [
  dsOut('wind', 'wind_edb_search', '按次消耗上游积分，不进日常巡检；协议级 initialize/tools/list 已覆盖域名与 Key。取数级由人工按需跑 npm run smoke:wind', '2026-10-08'),
  dsOut('wind', 'wind_edb_query', '按次消耗上游积分；同上。这条还实测过「该日缺数」与「上游故障」在线上不可区分（都挂到超时），自动重试只会白烧积分', '2026-10-08'),
  dsOut('wind', 'wind_stock_kline', '按次消耗上游积分；同上', '2026-10-08'),
]

const RETRIEVER = [
  pr('retriever', 'cls_telegraph', 'daily', { params: { limit: 3 }, expect: { minRows: 1 } }),
  pr('retriever', 'wscn_lives', 'daily', { params: { channel: 'global-channel', limit: 3 }, expect: { minRows: 1 }, budgetMs: 30_000, note: '实测 2.8 s，离群但不算失败' }),
  pr('retriever', 'cninfo_irm', 'daily', { params: { code: '000001', pageSize: 3, pageNum: 1 }, expect: { minRows: 0 }, note: '只覆盖深市；样本必须用 000001，用 600519 会合法 NOT_FOUND' }),
  pr('retriever', 'eastmoney_724', 'daily', { params: { limit: 3 }, expect: { minRows: 1 } }),
  pr('retriever', 'eastmoney_stock_news', 'daily', { params: { code: '600519', limit: 3 }, expect: { minRows: 1 }, note: '上游被间歇风控时会整个丢掉 cmsArticleWebOld 键——那是 UPSTREAM 不是空结果' }),
  pr('retriever', 'eastmoney_reports', 'daily', { params: { code: '600519', pageSize: 3, pageNo: 1 }, expect: { minRows: 1 }, note: '只认裸 6 位代码，带 SH 前缀会 hits=0' }),
  pr('retriever', 'sina_reports', 'daily', { params: { code: '688017', page: 1 }, expect: { minRows: 1 }, note: '必须带交易所前缀；重定向会换主机并降级到 http' }),
  pr('retriever', 'ths_eps_forecast', 'daily', { params: { code: '600519' }, expect: { minRows: 1 }, note: '正文是 GBK 而响应头不带 charset，按 UTF-8 解会得到 11800 个替换字符' }),
  // SSE Q&A: WAF 403s the hosted egress (3/3) but not a domestic one (3/3). Shadow: probed,
  // recorded, never alarmed — "we aren't really testing this" shows up in every daily report.
  pr('retriever', 'sseinfo_qa', 'daily', {
    params: { kind: 'questions', page: 1, pageSize: 3 },
    shadow: {
      since: '2026-10-08', verdict: 'HTTP_STATUS 403',
      evidence: 'hosted(Azure AS8075) 3/3 稳定 403 WAF；国内出口(上海联通 AS17621) 3/3 稳定 200 + 11.5KB HTML',
      revisit: '2026-12-01',
    },
  }),
  pr('retriever', 'sseinfo_qa_company', 'weekly', {
    params: { code: '600519', kind: 'answered', page: 1, pageSize: 3 },
    budgetMs: 90_000,
    shadow: {
      since: '2026-10-08', verdict: 'HTTP_STATUS 403',
      evidence: '同 sseinfo_qa；另一次 code→uid 解析要串行 10–13 个请求，预算单列',
      revisit: '2026-12-01',
    },
  }),
]

// Protocol probes: free, catch domain loss / TLS / bad key / renamed tools. abortMs 60 s matches
// production: three servers take 30–60 s to initialize and 30 s would read "slow" as "broken".
const WIND_PROTOCOL = [
  'vserver_stock_data', 'vserver_fund_data', 'vserver_index_data',
  'vserver_bond_data', 'vserver_financial_docs', 'vserver_economic_data',
].map((server) => pr('wind', `wind_protocol_${server}`, 'daily', { server, abortMs: 60_000 }))

const ANYSEARCH = [
  pr('anysearch', 'anysearch_search', 'daily', {
    params: { query: '贵州茅台 2026 年半年报', max_results: 2 }, expect: { minRows: 1 }, budgetMs: 60_000,
    note: '⛔ 缺 key 也返回 200 + 真结果——必须带 key 打，缺 key 由开工前闸门挡（设计 §6.4）',
  }),
  pr('anysearch', 'anysearch_extract', 'daily', {
    params: { url: 'https://www.gov.cn/' }, budgetMs: 60_000,
    note: '目标站当天不可读会回 UNSUPPORTED_CONTENT 等，不是 AnySearch 坏了——判据只看信封有没有回来',
  }),
]

const PADDLE = [
  out('paddle', 'paddle_ocr_job', '端到端要一份长期可公开访问的样本 PDF，样本未选定；选定后升级为 weekly 真跑', '2026-10-08'),
]

// FTShare: dates are always relative (daily endpoints keep ~45 trading days). `page` works but the
// response always says pageNum 1, so probes take page=1; paging is covered by offline stub tests.
const FT_RANGE = { start_date: dayShift(-10), end_date: dayShift(-1), size: 3 }
const FT = [
  // With a code: also verifies that filtering really works.
  ds('ftshare', 'ftshare_stock_daily_flow', 'daily', { ...FT_RANGE, code: A_SHARE }, { expect: { minRows: 1 }, note: '同花顺个股日度资金流；金额单位亿元（与全市场快照成交额交叉核对过）' }),
  ds('ftshare', 'ftshare_industry_daily_flow', 'daily', FT_RANGE, { expect: { minRows: 1 }, note: '同花顺一级行业 90 个板块的资金滚动，是 eastmoney_cashflow_rotation 的第二家上游' }),
  ds('ftshare', 'ftshare_concept_daily_flow', 'daily', FT_RANGE, { expect: { minRows: 1 }, note: '概念板块天然重叠，禁止跨板块相加' }),
  ds('ftshare', 'ftshare_main_capital_flow', 'daily', { size: 3 }, { expect: { minRows: 1 }, note: '15 分钟切片主力资金，单位元；免费档限流 10 QPS / burst 20' }),  ds('ftshare', 'ftshare_ashare_quote', 'daily', { board: 'bjse', size: 3 }, { expect: { minRows: 1 }, note: '北证口径单独一条：本仓只有这一族与日 K 截面含北交所（腾讯那一路明确拒 BJ）' }),
  ds('ftshare', 'ftshare_market_breadth', 'daily', {}, { expect: { minRows: 1 }, note: '单行；九档家数之和实测 = 报价面 total_items（跨能力对账点）' }),
  ds('ftshare', 'ftshare_daily_kline_snapshot', 'daily', { size: 3 }, {
    requires: 'trade_date',
    // A fabricated weekend date gets an upstream 400 "not a trading day": take it from the calendar.
    resolveFrom: { capability: 'ftshare_trading_calendar', params: { start_date: dayShift(-20), end_date: dayShift(-1) }, path: 'item.0.trade_date' },
    expect: { minRows: 1 },
  }),
  ds('ftshare', 'ftshare_prev_close', 'daily', { code: A_SHARE, start_date: dayShift(-20), end_date: dayShift(-1) }, { expect: { minRows: 1 }, note: '响应没有身份列，本层核日期是否落在请求区间内' }),
  ds('ftshare', 'ftshare_trading_calendar', 'daily', { market: 'cn', start_date: dayShift(-20), end_date: dayShift(20) }, { expect: { minRows: 1 } }),
  // Batch C. ⛔ Still only relative dates / real ids; without a date it lands on the latest day with data.
  ds('ftshare', 'ftshare_block_trades', 'daily', { size: 3 }, { expect: { minRows: 1 }, note: '一笔一行；premium_ratio 是比例值（-0.0885 = 折价 8.85%）' }),
  // Forecasts / express reports have no rolling window, so past periods stay valid; modeB also
  // exercises the producer's year / report_type checks.
  ds('ftshare', 'ftshare_performance_forecast', 'daily', { year: 2024, report_type: 'annual', size: 3 }, { expect: { minRows: 1 }, note: 'modeB 全市场实测 3150 行；别名 q4/h1 在参数层就拒' }),
  ds('ftshare', 'ftshare_performance_express', 'daily', { code: A_SHARE }, { expect: { minRows: 1 }, note: 'modeA 单票不分页；上期为负时 net_profit_yoy_pct 的符号是反的，别拿它判方向' }),
  ds('ftshare', 'ftshare_sw_industry_overview', 'daily', { size: 3 }, {
    requires: 'date',
    resolveFrom: { capability: 'ftshare_trading_calendar', params: { start_date: dayShift(-20), end_date: dayShift(-1) }, path: 'item.0.trade_date' },
    expect: { minRows: 1 },
    note: '全部层级实测 497~498 行 = 一级 31 + 二级 131 + 三级 335/336',
  }),
  ds('ftshare', 'ftshare_sw_industry_metrics', 'daily', { industry_code: '801010.SI', start_date: dayShift(-10), end_date: dayShift(-1), size: 3 }, {
    expect: { minRows: 1 },
    note: '42 列宽表；聚合列（amount / total_mv 等）实测自 2026-08-26 起为 null，所以这条只核行数不核数值',
  }),
  // Batch D. Dates resolve from the calendar; ⛔ `requires` is shared by name, so the three 'date'
  // rows below must keep pointing at the same calendar.
  ds('ftshare', 'ftshare_limit_price', 'daily', { size: 3 }, {
    requires: 'date',
    resolveFrom: { capability: 'ftshare_trading_calendar', params: { start_date: dayShift(-20), end_date: dayShift(-1) }, path: 'item.0.trade_date' },
    expect: { minRows: 1 },
    note: '全市场单日模式；stock/etf/cb 三类相加实测正好等于 total（7587 = 5576+1696+315）',
  }),
  ds('ftshare', 'ftshare_dragon_tiger_seats', 'daily', { size: 500 }, {
    requires: 'date',
    // A non-trading day returns data:null, which is a legal empty result.
    resolveFrom: { capability: 'ftshare_trading_calendar', params: { start_date: dayShift(-20), end_date: dayShift(-1) }, path: 'item.0.trade_date' },
    expect: { minRows: 1 },
    note: '前五买入/卖出席位；响应行内没有日期列，trade_date 由本层按请求补写；一天实测 44–72 行，一页取全',
  }),
  ds('ftshare', 'ftshare_holder_number', 'daily', { code: A_SHARE }, {
    expect: { minRows: 1 },
    note: '单票全部历史（实测 600519.SH 107 期，回到 1995 年）；is_last 那档是"各票自己的最新一期"，不是同一报告期截面',
  }),
  ds('ftshare', 'ftshare_index_weight', 'daily', { index_code: '000300', size: 3 }, {
    expect: { minRows: 1 },
    note: '省略 date = 最新一期（实测 2026-09-30）；weight_pct 是百分数，000300 全期 300 行相加 = 100.002',
  }),
  ds('ftshare', 'ftshare_convertible_bond_kline', 'daily', { start_date: dayShift(-60), end_date: dayShift(-1), period: 'day' }, {
    requires: 'code',
    // ⛔ Never hardcode one bond: convertibles redeem and delist. Take a code from today's cb list.
    resolveFrom: { capability: 'ftshare_limit_price', params: { instrument_type: 'cb', size: 1 }, path: 'item.0.thscode' },
    expect: { minRows: 1 },
    note: '单只可转债日 K；跨度上限 12 个自然月由上游 400 说话，本层不换算成天数闸门',
  }),
  // Batch E: the calendar coverage is a rolling window, so absolute dates would rot within weeks.
  ds('ftshare', 'ftshare_lpr', 'daily', {}, {
    expect: { minRows: 1 },
    note: '无参数无分页，一次给完全历史（实测 2661 行）；本层多发参数会在参数层拒，所以这条必须空参打',
  }),
  ds('ftshare', 'ftshare_chinabond_yield', 'daily', { curve_name: '中债国债收益率曲线', start_date: dayShift(-10), end_date: dayShift(-1), size: 3 }, {
    expect: { minRows: 1 },
    note: '带 curve_name 打：这一条同时在验曲线名过滤真的生效（producer 逐行核名）；三条曲线起点不同，早于起点是合法空',
  }),
  ds('ftshare', 'ftshare_shibor', 'daily', { start_date: dayShift(-10), end_date: dayShift(-1), size: 3 }, {
    expect: { minRows: 1 },
    note: '八档期限宽表；周末与未发布日没有行、上游不插值，所以这条只核有没有行不核连续性',
  }),
  ds('ftshare', 'ftshare_hibor', 'daily', { start_date: dayShift(-10), end_date: dayShift(-1), size: 3 }, {
    expect: { minRows: 1 },
    note: '十五档里 m4/m5/m7..m11 七档实测整列为 null（HIBOR 就公布这些档），不是数据缺口、别拿它当 EMPTY 以外的告警',
  }),
  ds('ftshare', 'ftshare_financial_calendar', 'daily', { start_date: dayShift(-3), end_date: dayShift(-1), size: 100 }, {
    expect: { minRows: 1 },
    note: '⛔ 窗上限 3 天差由参数层拦（实测 4 天 400），巡检只打 3 天窗内；event_time 上游给秒，本层转毫秒',
  }),
  // Batch F: ⛔ contract codes come from the listing row — contracts expire, a hardcoded one rots.
  ds('ftshare', 'ftshare_futures_contracts', 'daily', {}, {
    expect: { minRows: 1 },
    note: '一日全量快照实测 1812 行 = 906 只合约 × 两份 future_type 副本（null 与 2），按行计数会翻倍；无分页',
  }),
  ds('ftshare', 'ftshare_futures_contract_detail', 'daily', {}, {
    requires: 'symbol',
    resolveFrom: { capability: 'ftshare_futures_contracts', params: {}, path: 'item.0.symbol' },
    expect: { minRows: 1 },
    note: '带 symbol 打时这条同时在验过滤真的生效（上游大小写不敏感，本层比的是大写后的值）',
  }),
  ds('ftshare', 'ftshare_futures_kline', 'daily', { interval: 'daily', start_date: dayShift(-60), end_date: dayShift(-1) }, {
    requires: 'symbol',
    expect: { minRows: 1 },
    note: '单合约日 K；12 个自然月的跨度上限由上游 400 说话，本层不换算成天数闸门。⛔ interval 只四档，1d 一类会被静默回空',
  }),
  ds('ftshare', 'ftshare_futures_limit_price', 'daily', { exchange: 'SHFE', size: 3 }, {
    requires: 'trade_date',
    expect: { minRows: 1 },
    note: '⛔ size 压在 50（实测 SHFE 60 起整页 400「missing pre-settlement price」，缺前结算价的是上游合约而不是参数）；m_ratio 原样透出不解读',
  }),
  ds('ftshare', 'ftshare_futures_settle', 'daily', { exchange: 'SHFE', size: 3 }, {
    requires: 'trade_date',
    expect: { minRows: 1 },
    note: 'exchange 必填；区间跨度上限 31 天由参数层拦（实测超一天就 400）。四档保证金率是比例值，另外四列 fee 单位未披露',
  }),
  ds('ftshare', 'ftshare_futures_warrant', 'daily', { size: 3 }, {
    requires: 'trade_date',
    expect: { minRows: 1 },
    note: '一日全市场实测 1469 行；⛔ unit 随行而变（张 / 吨 / 手 / 桶，INE 一所之内就有两种），跨品种相加前先按 unit 分组',
  }),
  ds('ftshare', 'ftshare_futures_weekly', 'daily', { prd: 'CU', size: 3 }, {
    expect: { minRows: 1 },
    note: '只给 prd 就能打（实测 CU 一个品种 total=92 周）；⛔ 周报有发布滞后，最新一期实测比当天晚两周，别按"本周"打',
  }),
  ds('ftshare', 'ftshare_futures_index_kline', 'daily', { code: 'AG_NH', start_date: dayShift(-20), end_date: dayShift(-1), size: 3 }, {
    expect: { minRows: 1 },
    note: '南华商品指数；⛔ 聚合指数不保证 high ≥ open（实测 30 行里 1 行违例），别拿单根 K 的自洽性判数据坏了',
  }),
  ds('ftshare', 'ftshare_futures_member_rank', 'daily', { exchange: 'CFFEX', size: 3 }, {
    requires: 'trade_date',
    expect: { minRows: 1 },
    note: '⛔ 上游那族 exchange 只认小写且广期所真名是 gfe（GFEX / gfex 都静默 0 行），本层负责换写法；排名列与数值列同时为空才是"没有这个口径"',
  }),
  ds('ftshare', 'ftshare_bullion_price', 'daily', { symbol: 'AU9999', start_date: dayShift(-400), end_date: dayShift(-1), size: 3 }, {
    expect: { minRows: 1 },
    note: '⛔ 序列实测停在 2026-08 中旬（AU9999 大窗首行 2026-08-14），所以窗要开到 400 天，按"最近一周"打永远 EMPTY；单位上游未披露，只做同 symbol 内比较',
  }),
]

export const CONTRACT_PROBES = [...FUYAO, ...EM, ...TX, ...WIND_DATA, ...RETRIEVER, ...WIND_PROTOCOL, ...ANYSEARCH, ...PADDLE, ...FT]

export function secretRefOf(entry) {
  if (entry.excluded) return undefined
  return entry.secret ?? FAMILY_SECRET[entry.family]
}

export function stateOf(entry) {
  if (entry.excluded) return 'excluded'
  if (entry.shadow) return 'shadow'
  return 'active'
}

/**
 * Which tier to run. Timezone conversion happens only here and must name Asia/Shanghai: GitHub cron
 * weekdays are UTC, so reading local time shifts "Saturday full" by a day and it never fires.
 */
export function resolveTier(date = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(date)
  return weekday === 'Sat' ? 'full' : 'daily'
}

/**
 * Schedule truth table in UTC, mirroring the single cron line: Beijing Mon–Sat 04:00 = UTC Sun–Fri
 * 20:00. test/contract-registry.test.mjs pins both sides together.
 */
export const SCHEDULE_UTC = [
  { hour: 20, dow: [0, 1, 2, 3, 4, 5] },
]

/**
 * Latest due slot (UTC), skipping the nonexistent Beijing Sunday. GitHub can run `schedule` 3–4 h
 * late, so a late run still counts as a heartbeat; this is a slot, not a punctuality window.
 */
export function lastScheduledDue(now = new Date()) {
  for (let back = 0; back <= 7; back += 1) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back))
    const spec = SCHEDULE_UTC.find((entry) => entry.dow.includes(day.getUTCDay()))
    if (!spec) continue
    const slot = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), spec.hour))
    if (slot <= now) return slot
  }
  throw new Error('SCHEDULE_UTC 一周里没有任何排程，lastScheduledDue 无法回看')
}

/**
 * **Previous** slot (one day back, then `lastScheduledDue`); the watchdog uses this one.
 * A real ordering inversion: probes scheduled 07:00 landed 10:13 while the watchdog's nominal 09:30
 * had already run, so a punctual probe looked missing. A full day of slack costs ~24 h of detection
 * latency but never false-alarms; manual dispatch is not a heartbeat.
 */
export function previousScheduledDue(now = new Date()) {
  return lastScheduledDue(new Date(now.getTime() - 24 * 3_600_000))
}

/** Report dates must be Beijing dates: 04:00 Beijing is the previous UTC day, and dedupe/streaks read this. */
export function beijingDateOf(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value))
  const of = (type) => parts.find((part) => part.type === type).value
  return `${of('year')}-${of('month')}-${of('day')}`
}

/**
 * Replaces `dayShift` markers with concrete Beijing dates; the runner calls it once per run.
 * Only a lone `{ dayShift: n }` object counts as a marker — anything else is left to fail loudly in
 * normalizeParams. Arrays recurse; other values (and undefined) pass through untouched.
 */
export function resolveDayShifts(value, runAt = new Date()) {
  if (Array.isArray(value)) return value.map((item) => resolveDayShifts(item, runAt))
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 1 && keys[0] === 'dayShift') {
      const days = value.dayShift
      if (!Number.isInteger(days)) throw new TypeError(`dayShift 要整数天，拿到 ${JSON.stringify(days)}`)
      // Shift by whole days first: China has no DST, so ±24 h never crosses a date boundary.
      return beijingDateOf(new Date(runAt.getTime() + days * 86_400_000))
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveDayShifts(item, runAt)]))
  }
  return value
}

/** Entries to probe for a tier: shadows included; `full` adds weekly to daily. */
export function probesForTier(tier) {
  const wanted = tier === 'full' ? new Set(['daily', 'weekly']) : new Set(['daily'])
  return CONTRACT_PROBES.filter((entry) => !entry.excluded && wanted.has(entry.tier))
}

