/**
 * 数据源契约巡检注册表（`docs/dev/tool-schema.md` §10.8 那道闸门的正文）。
 *
 * 一条能力一行，**四态取一**：
 *   · `tier: 'daily'`   每天 07:00 打，失败算结论
 *   · `tier: 'weekly'`  周六全量打（静态面：基金档案 / 经理 / 回测这一类）
 *   · `shadow: {…}`     照打，但本视角不判——视角差异不是上游故障；每天在报告里露一次脸
 *   · `excluded: {…}`   刻意不打（按次计费等），理由必须写下来
 *
 * ⛔ 本文件**不写 URL、不写字段清单**。字段判据来自 `lib/` 里 `DataSource` 的 `output_schema`
 * 与 `validateOutput`，URL 与参数校验来自生产的 `execute()`——写第二份就是第二份真相（§10.8 第 3 条）。
 * 这里只回答三个问题：**打谁、用什么最小参数、允许多慢**。
 *
 * 参数一律**静态可复现**：能省略的日期一律省略（让上游自己取最近可用交易日），
 * 显式传非交易日会拿到 `1002`（`dragon_tiger` 的 description 明写「不自动回退」），
 * 那是巡检自己造出来的失败。
 */

/**
 * 只有这三类判据开 Issue；其余进 summary。这套东西能不能活过第三周就看这一行。
 * 住在注册表（纯数据模块）而不是 runner：发单脚本不需要为此 import 整条 `lib/` 链。
 */
export const ISSUE_VERDICTS = Object.freeze(['GUARD', 'ENVELOPE', 'HTTP_STATUS'])

/** 延迟预算初值：一律保守，等第一次 hosted 全量的实测 P95 回填（设计 §2.4）。 */
export const DEFAULT_BUDGET_MS = 20_000

/** 家族 = 限速分组。同组串行、组间留 gap；跨组**绝不并发**（两份独立节流 = 没节流）。 */
export const PROBE_FAMILIES = ['fuyao', 'eastmoney', 'tencent', 'retriever', 'anysearch', 'wind', 'paddle']

/** 组间间隔：让上一个上游的连接与风控计数先冷下来。 */
export const PROVIDER_GAP_MS = 2_000

/**
 * Fuyao 巡检专用地板：生产侧 `fuyao-core.ts` 是裸 `fetch`、**没有任何最小间隔**，
 * 只靠 Hub 的串行。400 ms 是 `smoke-fuyao.mjs` 跑 61 端点未触发 4001 的实测节奏。
 * ⚠️ 这是巡检侧新增的常量，不代表生产侧也该有——别顺手搬进 `fuyao-core.ts`。
 */
export const FUYAO_PROBE_GAP_MS = 400

/** 家族级默认凭据；开工前闸门只检查本次真用到的那几个（设计 §6.4）。 */
export const FAMILY_SECRET = {
  fuyao: 'FUYAO_API_KEY',
  anysearch: 'ANYSEARCH_API_KEY',
  wind: 'WIND_API_KEY',
  paddle: 'PADDLE_OCR_TOKEN',
}

/** 已知数据缺口的上游码：命中它不算失败，但每天在正文列一次（§10.4）。 */
export const KNOWN_GAP_CODES = Object.freeze(['1002', '2004', '5003'])

const ETFS = '510300.SH'
const A_SHARE = '600519.SH'

/** DataSource 面：走生产的 `source.execute()` + `source.validateOutput()`。 */
const ds = (family, capability, tier, params, extra = {}) => ({
  face: 'datasource', family, capability, tier, params, budgetMs: DEFAULT_BUDGET_MS, ...extra,
})
/** 非 DataSource 面（具名来源函数 / 协议级探针）：由 runner 里的 probeTable 分派。 */
const pr = (family, capability, tier, extra = {}) => ({
  face: 'probe', family, capability, tier, budgetMs: DEFAULT_BUDGET_MS, ...extra,
})
/** 刻意不打：没有 tier，runner 看见 `excluded` 就跳过，但覆盖测试仍要求这一行存在。 */
const out = (family, capability, reason, since) => ({
  face: 'probe', family, capability, excluded: { since, reason },
})
/** 同上，但这一颗是**真注册出来的 DataSource 能力**——覆盖测试按 face 数分母，别混。 */
const dsOut = (family, capability, reason, since) => ({
  face: 'datasource', family, capability, params: {}, excluded: { since, reason },
})

// ── Fuyao（同花顺 REST，61 颗能力）────────────────────────────────────────────
// 参数表自 scripts/smoke-fuyao.mjs 原样搬入，不重写。
const HISTORY_START = Date.UTC(2025, 0, 2)
const HISTORY_END = Date.UTC(2025, 1, 28)

/** 依赖真实 id 的四颗：编造 id 会拿到 5003，那是脚本问题不是上游故障（§10.3）。 */
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

  // 基金 / 经理 / 回测：结构稳定、变化慢，周六全量覆盖即可。
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

// ── Eastmoney 数据面（21 颗，全部每天）────────────────────────────────────────
// 全量而非"每族一个代表"：上游改版通常打中一个端点，不打中一族。
const EM_RANGE = { start_date: '2025-01-01', end_date: '2026-09-30', page: 1, size: 3 }
const EM = [
  ds('eastmoney', 'eastmoney_top_buy_sell_market', 'daily', { start_date: '2026-09-21', end_date: '2026-09-25', page: 1, size: 3 }),
  ds('eastmoney', 'eastmoney_top_buy_sell_ticker', 'daily', { ticker: A_SHARE, start_date: '2026-01-01', end_date: '2026-09-30', page: 1, size: 3 }),
  ds('eastmoney', 'eastmoney_lockup_expiry', 'daily', { start_date: '2026-10-01', end_date: '2026-12-31', page: 1, size: 3 }),
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
  ds('eastmoney', 'eastmoney_mutual_flow', 'daily', { start_date: '2026-09-01', end_date: '2026-09-30', page: 1, size: 3 }),
  ds('eastmoney', 'eastmoney_main_capital_snapshot', 'daily', { page: 1, size: 3 }),
  ds('eastmoney', 'eastmoney_dividend_plan', 'daily', { ticker: A_SHARE, ...EM_RANGE }),
  ds('eastmoney', 'eastmoney_holder_number_snapshot', 'daily', { page: 1, size: 3 }),
  ds('eastmoney', 'eastmoney_mutual_quota', 'daily', {}, { note: '无参数；closed_reason 非空表示休市，是合法结果' }),
  ds('eastmoney', 'eastmoney_margin_trading', 'daily', { ticker: A_SHARE, start_date: '2026-09-01', end_date: '2026-09-30', page: 1, size: 3 }),
  ds('eastmoney', 'eastmoney_convertible_bond_list', 'daily', { start_date: '2026-01-01', end_date: '2026-12-31', page: 1, size: 3 }),
]

// ── Tencent 公开端点（9 颗，全部每天；免密，120 ms 一条链）─────────────────────
const TX = [
  ds('tencent', 'tencent_quote', 'daily', { codes: [A_SHARE] }, { expect: { minRows: 1, identity: { field: 'tencent_symbol', value: 'sh600519' } } }),
  ds('tencent', 'tencent_kline', 'daily', { code: A_SHARE, period: 'day', count: 10 }, { expect: { minRows: 1 } }),
  // 分笔会翻页（MAX_TICK_PAGES=300），实测单次可达 4.5 s，预算单列。
  ds('tencent', 'tencent_ticks', 'daily', { code: '000001.SZ' }, { budgetMs: 30_000 }),
  ds('tencent', 'tencent_hk_quote', 'daily', { codes: ['00700'] }, { expect: { minRows: 1 } }),
  ds('tencent', 'tencent_us_quote', 'daily', { codes: ['AAPL'] }, { expect: { minRows: 1 } }),
  ds('tencent', 'tencent_hk_index_quote', 'daily', { codes: ['HSI'] }, { expect: { minRows: 1 } }),
  ds('tencent', 'tencent_us_index_quote', 'daily', { codes: ['usDJI'] }, { expect: { minRows: 1, identity: { field: 'tencent_symbol', value: 'usDJI' } } }),
  ds('tencent', 'tencent_hk_kline', 'daily', { code: '00700', period: 'day', count: 5 }, { expect: { minRows: 1 } }),
  ds('tencent', 'tencent_us_kline', 'daily', { code: 'AAPL', period: 'day', count: 5 }, { expect: { minRows: 1 } }),
]

// ── Wind 数据面：按次消耗积分，刻意不进巡检（设计 §10 第 1 条）──────────────────
const WIND_DATA = [
  dsOut('wind', 'wind_edb_search', '按次消耗上游积分，不进日常巡检；协议级 initialize/tools/list 已覆盖域名与 Key。取数级由人工按需跑 npm run smoke:wind', '2026-10-08'),
  dsOut('wind', 'wind_edb_query', '按次消耗上游积分；同上。这条还实测过「该日缺数」与「上游故障」在线上不可区分（都挂到超时），自动重试只会白烧积分', '2026-10-08'),
  dsOut('wind', 'wind_stock_kline', '按次消耗上游积分；同上', '2026-10-08'),
]

// ── web_retriever 具名来源（provider + operation，不是 DataSource）─────────────
const RETRIEVER = [
  pr('retriever', 'cls_telegraph', 'daily', { params: { limit: 3 }, expect: { minRows: 1 } }),
  pr('retriever', 'wscn_lives', 'daily', { params: { channel: 'global-channel', limit: 3 }, expect: { minRows: 1 }, budgetMs: 30_000, note: '实测 2.8 s，离群但不算失败' }),
  pr('retriever', 'cninfo_irm', 'daily', { params: { code: '000001', pageSize: 3, pageNum: 1 }, expect: { minRows: 0 }, note: '只覆盖深市；样本必须用 000001，用 600519 会合法 NOT_FOUND' }),
  pr('retriever', 'eastmoney_724', 'daily', { params: { limit: 3 }, expect: { minRows: 1 } }),
  pr('retriever', 'eastmoney_stock_news', 'daily', { params: { code: '600519', limit: 3 }, expect: { minRows: 1 }, note: '上游被间歇风控时会整个丢掉 cmsArticleWebOld 键——那是 UPSTREAM 不是空结果' }),
  pr('retriever', 'eastmoney_reports', 'daily', { params: { code: '600519', pageSize: 3, pageNo: 1 }, expect: { minRows: 1 }, note: '只认裸 6 位代码，带 SH 前缀会 hits=0' }),
  pr('retriever', 'sina_reports', 'daily', { params: { code: '688017', page: 1 }, expect: { minRows: 1 }, note: '必须带交易所前缀；重定向会换主机并降级到 http' }),
  pr('retriever', 'ths_eps_forecast', 'daily', { params: { code: '600519' }, expect: { minRows: 1 }, note: '正文是 GBK 而响应头不带 charset，按 UTF-8 解会得到 11800 个替换字符' }),
  // 上交所互动：hosted 视角被 WAF 稳定 403（实测 3/3），国内出口 3/3 正常 200。
  // 走影子：照打、留痕、不报警——"我们其实没在测它"每天早上在报告里露一次脸。
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

// ── 协议级探针：不计费，专抓域名下线 / TLS / Key 失效 / MCP 工具改名 ────────────
// analytics_data 刻意不在这里：本仓未接，实测连 initialize 都挂满 60 秒。
// abortMs 给到 60 s 与生产 `WIND_REQUEST_TIMEOUT_MS` 同值：实测 index_data / financial_docs /
// economic_data 三台的 initialize 就要 30–60 s，卡在 30 s 会把"慢"误判成"坏了"（2026-10-08 实测）。
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

/** 全量注册表。覆盖测试拿它对着 `lib/` 的真实注册数逐条核。 */
export const CONTRACT_PROBES = [...FUYAO, ...EM, ...TX, ...WIND_DATA, ...RETRIEVER, ...WIND_PROTOCOL, ...ANYSEARCH, ...PADDLE]

/** 该条真打时需要的凭据（`excluded` 返回空——它永远不发请求）。 */
export function secretRefOf(entry) {
  if (entry.excluded) return undefined
  return entry.secret ?? FAMILY_SECRET[entry.family]
}

/** 状态：excluded / shadow / active。四态里 daily|weekly 是 active 的两个子档。 */
export function stateOf(entry) {
  if (entry.excluded) return 'excluded'
  if (entry.shadow) return 'shadow'
  return 'active'
}

/**
 * 本次该打哪一档。**时区换算只有这一处**，且必须显式 `Asia/Shanghai`：
 * GitHub cron 的星期字段是 UTC，直接读 runner 本地时间会拿到 UTC，于是"周六全量"错位一天、
 * 全量档静默永不触发（设计 §5.1）。给 `date` 参数是为了能被测试钉住。
 */
export function resolveTier(date = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(date)
  return weekday === 'Sat' ? 'full' : 'daily'
}

/** 本次要真打的条目（含影子——影子照打，只是不计入结论）。
 * `tier: 'daily'` 只打日档；`tier: 'full'`（北京周六）打日档 + 周档。 */
export function probesForTier(tier) {
  const wanted = tier === 'full' ? new Set(['daily', 'weekly']) : new Set(['daily'])
  return CONTRACT_PROBES.filter((entry) => !entry.excluded && wanted.has(entry.tier))
}

