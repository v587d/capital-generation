import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEastmoneySources } from '../lib/sources/eastmoney-http.js'
import { DataCollectorHub } from '../lib/data-collector/hub.js'
import { normalizeEastmoneyBoardIdentity, normalizeEastmoneySecurityIdentity } from '../lib/sources/security-identity.js'

const signal = new AbortController().signal
const session = { id: 'session-1', header: { cwd: '/workspace/proj' } }

function sourceMap() {
  return Object.fromEntries(createEastmoneySources().map((source) => [source.schema.capability, source]))
}

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload }
}

test('Eastmoney identity：明确市场才归一证券，板块保持独立类型', () => {
  assert.deepEqual(normalizeEastmoneySecurityIdentity({ secucode: '600519.SH' }), {
    thscode: '600519.SH', ticker: '600519', eastmoney_code: '600519', eastmoney_market: 'SH',
  })
  assert.deepEqual(normalizeEastmoneySecurityIdentity({ secucode: '000430', market: 'SZ' }).thscode, '000430.SZ')
  assert.deepEqual(normalizeEastmoneySecurityIdentity({ secid: '1.600519' }).thscode, '600519.SH')
  // secid 市场码实测（2026-09-24 push2）：北交所与深市共用 `0.`，`2.*` 上游直接 rc=100。
  assert.deepEqual(normalizeEastmoneySecurityIdentity({ secid: '0.920982' }).thscode, '920982.BJ')
  assert.deepEqual(normalizeEastmoneySecurityIdentity({ secid: '0.430047' }).thscode, '430047.BJ')
  assert.deepEqual(normalizeEastmoneySecurityIdentity({ secid: '0.000993' }).thscode, '000993.SZ')
  assert.throws(() => normalizeEastmoneySecurityIdentity({ secid: '2.920982' }), /secid must have the form/)
  assert.throws(() => normalizeEastmoneySecurityIdentity({ secucode: '000430' }), /requires an explicit market/)
  assert.deepEqual(normalizeEastmoneyBoardIdentity('bk0481', '汽车零部件', 'industry'), {
    board_code: 'BK0481', board_name: '汽车零部件', board_type: 'industry',
  })
  assert.throws(() => normalizeEastmoneyBoardIdentity('600519', '贵州茅台', 'industry'), /board_code/)
})

const MACRO_CAPABILITIES = [
  'eastmoney_cpi', 'eastmoney_ppi', 'eastmoney_gdp', 'eastmoney_pmi', 'eastmoney_money_supply',
  'eastmoney_rmb_loan', 'eastmoney_customs_trade', 'eastmoney_retail_sales', 'eastmoney_deposit_reserve',
]
const SNAKE_CASE_CAPABILITIES = [...MACRO_CAPABILITIES, 'eastmoney_mutual_flow', 'eastmoney_mutual_quota', 'eastmoney_main_capital_snapshot', 'eastmoney_dividend_plan', 'eastmoney_holder_number_snapshot', 'eastmoney_margin_trading', 'eastmoney_convertible_bond_list']

test('Eastmoney source：注册二十一个 capability 与内部身份', () => {
  const sources = createEastmoneySources()
  assert.deepEqual(sources.map((source) => source.schema.capability), [
    'eastmoney_top_buy_sell_market', 'eastmoney_top_buy_sell_ticker', 'eastmoney_lockup_expiry',
    'eastmoney_sector_rotation', 'eastmoney_cashflow_rotation', ...MACRO_CAPABILITIES,
    'eastmoney_mutual_flow', 'eastmoney_main_capital_snapshot',
    'eastmoney_dividend_plan', 'eastmoney_holder_number_snapshot', 'eastmoney_mutual_quota', 'eastmoney_margin_trading',
    'eastmoney_convertible_bond_list',
  ])
  assert.equal(new Set(sources.map((source) => source.schema.data_key)).size, 21)
  for (const source of sources) {
    assert.equal(source.schema.source_label, 'eastmoney')
    assert.match(source.schema.data_key, /^eastmoney\.http\./)
    assert.ok(source.schema.description.length > 20)
    assert.ok(source.schema.output_schema)
  }
})

test('Eastmoney 宏观表：行键名一律 ASCII snake_case（§10.6 不许透传上游缩写）', () => {
  for (const capability of SNAKE_CASE_CAPABILITIES) {
    const source = sourceMap()[capability]
    assert.ok(source, `${capability} 必须已注册`)
    const declared = Object.keys(source.schema.output_schema.properties.item.items.properties)
    assert.ok(declared.length > 0, `${capability} 必须声明行字段`)
    for (const key of declared) {
      assert.match(key, /^[a-z][a-z0-9_]*$/, `${capability} 的行键 ${key} 不是 ASCII snake_case：全半角或中文键名会让 query_dataset 匹配零行`)
    }
    // 上游键名（大写缩写）一个都不许出现在行字段里——映射表必须逐字段改名而不是原样透传。
    for (const key of declared) assert.ok(!/^[A-Z]/.test(key), `${capability} 透传了上游键名 ${key}`)
    assert.equal(source.schema.paginated, capability === 'eastmoney_mutual_quota' ? false : true, '额度表是当日四条快照，不分页')
    assert.deepEqual(source.schema.rowShape, { rowKey: 'item' })
  }
})


test('eastmoney_cpi：真报文形状映射成 snake_case，未声明的上游键丢弃', async () => {
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return response({ success: true, code: 0, result: { pages: 1, count: 1, data: [{
      REPORT_DATE: '2026-08-01 00:00:00', TIME: '2026年08月份',
      NATIONAL_SAME: 0.8, NATIONAL_BASE: 100.8, NATIONAL_SEQUENTIAL: 0.4, NATIONAL_ACCUMULATE: 100.9,
      CITY_SAME: 0.8, CITY_BASE: 100.8, CITY_SEQUENTIAL: 0.4, CITY_ACCUMULATE: 100.9,
      RURAL_SAME: 0.7, RURAL_BASE: 100.7, RURAL_SEQUENTIAL: 0.4, RURAL_ACCUMULATE: 100.7,
      UPSTREAM_ADDED_COLUMN: '上游改版新增的列，未经核验不入库',
    }] } })
  }
  try {
    const source = sourceMap().eastmoney_cpi
    const result = await source.execute({ capability: 'eastmoney_cpi', params: { start_date: '2026-08-01', end_date: '2026-08-31', page: 1, size: 20 }, session }, signal)
    assert.equal(requested.searchParams.get('reportName'), 'RPT_ECONOMY_CPI')
    assert.equal(requested.searchParams.get('sortColumns'), 'REPORT_DATE')
    assert.equal(requested.searchParams.get('filter'), "(REPORT_DATE>='2026-08-01')(REPORT_DATE<='2026-08-31')")
    const [row] = result.data.item
    assert.equal(row.report_date, '2026-08-01')
    assert.equal(row.report_date_ms, Date.parse('2026-08-01T00:00:00+08:00'))
    assert.equal(row.period_label, '2026年08月份')
    assert.equal(row.national_yoy_pct, 0.8)
    assert.equal(row.national_index, 100.8)
    assert.equal(row.rural_ytd_index, 100.7)
    assert.ok(!('UPSTREAM_ADDED_COLUMN' in row) && !('NATIONAL_SAME' in row), '映射表之外的上游键必须丢弃，不许原样透传')
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_retail_sales：上游 null 原样保留，不补 0 也不删列（实测 15/200 行为空）', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => response({ success: true, code: 0, result: { pages: 1, count: 1, data: [{
    REPORT_DATE: '2025-02-01 00:00:00', TIME: '2025年02月份',
    RETAIL_TOTAL: null, RETAIL_TOTAL_SAME: null, RETAIL_TOTAL_SEQUENTIAL: null,
    RETAIL_TOTAL_ACCUMULATE: 82657.2, RETAIL_ACCUMULATE_SAME: 4,
  }] } })
  try {
    const source = sourceMap().eastmoney_retail_sales
    const result = await source.execute({ capability: 'eastmoney_retail_sales', params: { start_date: '2025-02-01', end_date: '2025-02-28' }, session }, signal)
    const [row] = result.data.item
    assert.equal(row.total_retail, null)
    assert.equal(row.total_retail_yoy_pct, null)
    assert.equal(row.ytd_total_retail, 82657.2)
    assert.ok(Object.hasOwn(row, 'total_retail'), '空值列要留在行里，query_dataset 才分得清「没有数据」和「没有这列」')
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_deposit_reserve：事件表——区间无调整是空结果，中文公告日归一', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => response({ success: false, code: 9201, message: '返回数据为空' })
  try {
    const source = sourceMap().eastmoney_deposit_reserve
    const empty = await source.execute({ capability: 'eastmoney_deposit_reserve', params: { start_date: '2025-01-01', end_date: '2025-04-30' }, session }, signal)
    assert.deepEqual(empty.data.item, [], '上游 9201（该窗口确实没有调整）是真实数据缺口，不是取数失败')
    assert.equal(empty.data.pagination.total, 0)
  } finally { globalThis.fetch = originalFetch }

  globalThis.fetch = async () => response({ success: true, code: 0, result: { pages: 1, count: 1, data: [{
    REPORT_DATE: '2025-05-07 00:00:00', PUBLISH_DATE: '2025年05月07日', TRADE_DATE: '2025年05月15日',
    INTEREST_RATE_BB: 9.5, INTEREST_RATE_BA: 9, CHANGE_RATE_B: -0.5,
    INTEREST_RATE_SB: 6.5, INTEREST_RATE_SA: 6, CHANGE_RATE_S: -0.5,
    NEXT_SH_RATE: 0.279139540482, NEXT_SZ_RATE: 0.925667157483, MONTH_DATE: '2025年05月',
    REMARK: '中国人民银行决定，自2025年5月15日起下调金融机构存款准备金率0.5个百分点。', TRADE_DATE_NEW: '2025-05-15 00:00:00',
  }] } })
  try {
    const source = sourceMap().eastmoney_deposit_reserve
    const result = await source.execute({ capability: 'eastmoney_deposit_reserve', params: { start_date: '2025-05-01', end_date: '2025-05-31' }, session }, signal)
    const [row] = result.data.item
    assert.equal(row.effective_date, '2025-05-15', '生效日取 TRADE_DATE_NEW，与公告日 report_date 不是一回事')
    assert.equal(row.publish_date, '2025-05-07', '中文公告日必须归一成 YYYY-MM-DD')
    assert.equal(row.large_change_pct, -0.5)
    assert.equal(row.announcement, '中国人民银行决定，自2025年5月15日起下调金融机构存款准备金率0.5个百分点。')
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_mutual_flow：北向金额列上游不披露，原样保留 null 而不是编造成交', async () => {
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return response({ success: true, code: 0, result: { pages: 1, count: 1, data: [{
      MUTUAL_TYPE: '005', TRADE_DATE: '2026-09-30 00:00:00', FUND_INFLOW: null, NET_DEAL_AMT: null, QUOTA_BALANCE: null,
      ACCUM_DEAL_AMT: null, BUY_AMT: null, SELL_AMT: null, LEAD_STOCKS_CODE: '301190.SZ', LEAD_STOCKS_NAME: '善水科技',
      LS_CHANGE_RATE: -9.99, INDEX_CLOSE_PRICE: 3842.19, INDEX_CHANGE_RATE: 0.31, HOLD_MARKET_CAP: 0,
      DEAL_AMT: 207941.62, QUOTA_BALANCE_TEXT: '额度充足', DEAL_NUM: 5269396,
    }] } })
  }
  try {
    const source = sourceMap().eastmoney_mutual_flow
    const result = await source.execute({ capability: 'eastmoney_mutual_flow', params: { start_date: '2026-09-01', end_date: '2026-09-30' }, session }, signal)
    assert.equal(requested.searchParams.get('filter'), "(TRADE_DATE>='2026-09-01')(TRADE_DATE<='2026-09-30')(MUTUAL_TYPE=\"005\")", '缺省渠道必须是北向合计')
    const [row] = result.data.item
    assert.equal(row.channel, 'north_total')
    assert.equal(row.channel_code, '005')
    assert.equal(row.deal_amt_raw, 207941.62)
    assert.equal(row.buy_amt_raw, null, '交易所已停披露北向每日买入：null 是事实，不许补 0')
    assert.equal(row.net_deal_amt_raw, null)
    assert.equal(row.hold_market_cap_raw, 0, '北向合计的市值列上游给占位 0，原样保留、由描述负责说清')
    assert.equal(row.lead_thscode, '301190.SZ')
    assert.ok(!('FUND_INFLOW' in row) && !('LS_CHANGE_RATE' in row), '映射表外的上游键必须丢弃')
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_mutual_flow：渠道枚举在发请求之前就拒绝，南向四档金额有值', async () => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = async () => {
    called = true
    return response({ success: true, code: 0, result: { pages: 1, count: 1, data: [{
      MUTUAL_TYPE: '006', TRADE_DATE: '2026-09-30 00:00:00', BUY_AMT: 38395.24, SELL_AMT: 31531.63, NET_DEAL_AMT: 6863.61,
      ACCUM_DEAL_AMT: 5537700.9, DEAL_AMT: 69926.87, DEAL_NUM: 1000, HOLD_MARKET_CAP: 11999836484848, QUOTA_BALANCE_TEXT: '额度充足',
    }] } })
  }
  try {
    const source = sourceMap().eastmoney_mutual_flow
    await assert.rejects(
      () => source.execute({ capability: 'eastmoney_mutual_flow', params: { start_date: '2026-09-01', end_date: '2026-09-30', channel: 'north_net_buy' }, session }, signal),
      /channel must be one of/,
    )
    assert.equal(called, false, '非法渠道属于参数错误：本地报错，不发请求、不落盘')
    const result = await source.execute({ capability: 'eastmoney_mutual_flow', params: { start_date: '2026-09-01', end_date: '2026-09-30', channel: 'south_total' }, session }, signal)
    const [row] = result.data.item
    assert.equal(row.channel_code, '006')
    assert.equal(row.buy_amt_raw, 38395.24)
    assert.equal(row.net_deal_amt_raw, 6863.61)
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_mutual_quota：当日四条快照、休市原因与跨方向额度口径', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => response({ success: true, code: 0, result: { pages: 1, count: 4, data: [
    { TRADE_DATE: '2026-10-05 00:00:00', MUTUAL_TYPE: '001', TRADE_QUOTA: 52000, CLOSED_REASON: '国庆节', BOARD_TYPE: '沪港通', MUTUAL_TYPE_NAME: '沪股通', FUNDS_DIRECTION: '北向', INDEX_CODE: '000001', INDEX_NAME: '上证指数', START_TIME: null, END_TIME: null, BOARD_CODE: 'BK0707' },
    { TRADE_DATE: '2026-10-05 00:00:00', MUTUAL_TYPE: '002', TRADE_QUOTA: 42000000000, CLOSED_REASON: '国庆节', BOARD_TYPE: '沪港通', MUTUAL_TYPE_NAME: '港股通(沪)', FUNDS_DIRECTION: '南向', INDEX_CODE: 'HSI', INDEX_NAME: '恒生指数', START_TIME: null, END_TIME: null, BOARD_CODE: 'HK32' },
    { TRADE_DATE: '2026-10-05 00:00:00', MUTUAL_TYPE: '003', TRADE_QUOTA: 52000, CLOSED_REASON: '国庆节', BOARD_TYPE: '深港通', MUTUAL_TYPE_NAME: '深股通', FUNDS_DIRECTION: '北向', INDEX_CODE: '399001', INDEX_NAME: '深证成指', START_TIME: null, END_TIME: null, BOARD_CODE: 'BK0804' },
    { TRADE_DATE: '2026-10-05 00:00:00', MUTUAL_TYPE: '004', TRADE_QUOTA: 42000000000, CLOSED_REASON: '国庆节', BOARD_TYPE: '深港通', MUTUAL_TYPE_NAME: '港股通(深)', FUNDS_DIRECTION: '南向', INDEX_CODE: 'HSI', INDEX_NAME: '恒生指数', START_TIME: null, END_TIME: null, BOARD_CODE: 'HK31' },
  ] } })
  try {
    const source = sourceMap().eastmoney_mutual_quota
    const result = await source.execute({ capability: 'eastmoney_mutual_quota', params: {}, session }, signal)
    assert.deepEqual(result.data.item.map((row) => row.channel), ['sh_stock_connect', 'hk_connect_sh', 'sz_stock_connect', 'hk_connect_sz'])
    const [north, south] = result.data.item
    assert.equal(north.direction, 'north')
    assert.equal(north.closed_reason, '国庆节')
    assert.equal(south.channel_label, '港股通(沪)', '上游原文留着，便于与东财页面对照')
    assert.equal(south.trade_quota_raw, 42000000000, '额度原值跨方向口径不一致，由描述负责禁止直接比较')
    assert.ok(!('START_TIME' in north), '全为 null 的交易时段字段不收录')
    await assert.rejects(
      () => source.execute({ capability: 'eastmoney_mutual_quota', params: { page: 2 }, session }, signal),
      /unsupported parameter/,
    )
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_main_capital_snapshot：全市场快照，只有查询日、不接受日期参数', async () => {
  const originalFetch = globalThis.fetch
  let requested
  const row = (over = {}) => ({
    SECURITY_CODE: '000501', SECUCODE: '000501.SZ', SECURITY_NAME_ABBR: '武商集团', TRADE_DATE: '2026-09-30 00:00:00',
    CLOSE_PRICE: 7.14, CHANGE_RATE: 1.1331, TURNOVERRATE: 0.6011, PE_DYNAMIC: 20.93650625,
    PRIME_INFLOW: -3822595, SUPERDEAL_INFLOW: 0, SUPERDEAL_OUTFLOW: 0, BIGDEAL_INFLOW: 3924900, BIGDEAL_OUTFLOW: 7747495,
    PRIME_COST: 7.097213452002, PRIME_COST_20DAYS: 7.422605499561, PRIME_COST_60DAYS: 7.229456356095,
    BUY_SUPERDEAL_RATIO: 0, BUY_BIGDEAL_RATIO: 0.1198, RATIO: 0.1198, RATIO_3DAYS: 0.1126, RATIO_50DAYS: 0.206178,
    ORG_PARTICIPATE: 0.1349156, PARTICIPATE_TYPE: '1', TOTALSCORE: 62.5918564, RANK: 2319, RANK_UP: 552, FOCUS: 75.2,
    ...over,
  })
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    const filtered = requested.searchParams.get('filter')
    const rows = filtered ? [row({ SECUCODE: '600519.SH', SECURITY_CODE: '600519', SECURITY_NAME_ABBR: '贵州茅台', CLOSE_PRICE: 1258.62 })] : [row(), row({ SECUCODE: '000501.SZ', SECURITY_CODE: '000501', CHANGE_RATE: null, TURNOVERRATE: null })]
    return response({ success: true, code: 0, result: { pages: filtered ? 1 : 52, count: filtered ? 1 : 5199, data: rows } })
  }
  try {
    const source = sourceMap().eastmoney_main_capital_snapshot
    const result = await source.execute({ capability: 'eastmoney_main_capital_snapshot', params: {}, session }, signal)
    assert.equal(requested.searchParams.get('sortColumns'), 'PRIME_INFLOW', '缺省按主力净流入排序')
    assert.equal(requested.searchParams.get('sortTypes'), '-1')
    assert.equal(requested.searchParams.get('filter'), null, '全市场快照不带过滤器')
    const [first, suspended] = result.data.item
    assert.deepEqual([first.thscode, first.ticker, first.name], ['000501.SZ', '000501', '武商集团'])
    assert.equal(first.main_net_inflow, -3822595)
    assert.equal(first.main_cost, 7.097213452002)
    assert.equal(first.trade_date, '2026-09-30')
    assert.equal(suspended.change_pct, null, '停牌行原样保留 null')
    assert.ok(!('SECURITY_INNER_CODE' in first) && !('TRADE_MARKET_CODE' in first), '内部编码不进取')
    // 排序列与方向的枚举在发请求前把关
    await assert.rejects(
      () => source.execute({ capability: 'eastmoney_main_capital_snapshot', params: { sort_field: 'trade_date' }, session }, signal),
      /sort_field must be one of/,
    )
    await assert.rejects(
      () => source.execute({ capability: 'eastmoney_main_capital_snapshot', params: { start_date: '2026-09-01' }, session }, signal),
      /unsupported parameter/,
      '快照能力没有日期参数：给了就要拒绝，不能让模型以为取得到历史',
    )
    const single = await source.execute({ capability: 'eastmoney_main_capital_snapshot', params: { ticker: '600519.SH' }, session }, signal)
    assert.equal(requested.searchParams.get('filter'), '(SECUCODE="600519.SH")', '单票过滤器用带市场的 SECUCODE')
    assert.equal(single.data.item.length, 1)
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_main_capital_snapshot：SECUCODE 丢市场后缀就响亮失败，不按代码首位猜市场', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => response({ success: true, code: 0, result: { pages: 1, count: 1, data: [{ SECUCODE: '000501', SECURITY_CODE: '000501', SECURITY_NAME_ABBR: '武商集团', TRADE_DATE: '2026-09-30 00:00:00' }] } })
  try {
    const source = sourceMap().eastmoney_main_capital_snapshot
    await assert.rejects(
      () => source.execute({ capability: 'eastmoney_main_capital_snapshot', params: {}, session }, signal),
      (error) => error?.code === 'eastmoney_invalid_response',
    )
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_dividend_plan：每 10 股口径照原值给、日期四列分职、未定登记日留 null', async () => {
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return response({ success: true, code: 0, result: { pages: 1, count: 2, data: [
      { SECUCODE: '600519.SH', SECURITY_CODE: '600519', SECURITY_NAME_ABBR: '贵州茅台', REPORT_DATE: '2025-12-31 00:00:00',
        PLAN_NOTICE_DATE: '2026-04-17 00:00:00', NOTICE_DATE: '2026-06-22 00:00:00', EQUITY_RECORD_DATE: '2026-06-25 00:00:00',
        EX_DIVIDEND_DATE: '2026-06-26 00:00:00', ASSIGN_PROGRESS: '实施分配', IMPL_PLAN_PROFILE: '10派280.2423元(含税)',
        PRETAX_BONUS_RMB: 280.2423, BONUS_RATIO: null, IT_RATIO: null, BONUS_IT_RATIO: null, EX_DIVIDEND_DAYS: 101,
        TOTAL_SHARES: 1256197800, BASIC_EPS: 65.66, BVPS: 195.355449727901, PNP_YOY_RATIO: -4.532254817208,
        IS_KCB: null, PUBLISH_DATE: null, SECURITY_INNER_CODE: '1000002162', ORG_CODE: '10002602', MARKET_TYPE: '069001001001' },
      { SECUCODE: '600519.SH', SECURITY_CODE: '600519', SECURITY_NAME_ABBR: '贵州茅台', REPORT_DATE: '2026-06-30 00:00:00',
        PLAN_NOTICE_DATE: '2026-08-29 00:00:00', NOTICE_DATE: '2026-09-18 00:00:00', EQUITY_RECORD_DATE: null,
        EX_DIVIDEND_DATE: '2026-10-23 00:00:00', ASSIGN_PROGRESS: '董事会决议通过', IMPL_PLAN_PROFILE: '10派1.80元(含税)',
        PRETAX_BONUS_RMB: 1.8, EX_DIVIDEND_DAYS: -17 },
    ] } })
  }
  try {
    const source = sourceMap().eastmoney_dividend_plan
    const result = await source.execute({ capability: 'eastmoney_dividend_plan', params: { ticker: '600519.SH', start_date: '2023-01-01', end_date: '2026-10-05' }, session }, signal)
    assert.equal(requested.searchParams.get('sortColumns'), 'EX_DIVIDEND_DATE')
    assert.equal(requested.searchParams.get('filter'), `(SECUCODE="600519.SH")(EX_DIVIDEND_DATE>='2023-01-01')(EX_DIVIDEND_DATE<='2026-10-05')`)
    const [done, pending] = result.data.item
    assert.deepEqual([done.thscode, done.ticker], ['600519.SH', '600519'])
    assert.equal(done.report_date, '2025-12-31', 'report_date 是报告期')
    assert.equal(done.equity_record_date, '2026-06-25')
    assert.equal(done.ex_dividend_date_ms, Date.parse('2026-06-26T00:00:00+08:00'))
    assert.equal(done.pretax_cash_per_10, 280.2423, '每 10 股派息按原值给，plan_profile 原文可对照')
    assert.equal(done.plan_profile, '10派280.2423元(含税)')
    assert.equal(done.bonus_shares_per_10, null, '纯派息方案的送转列为 null，不补 0')
    for (const dropped of ['IS_KCB', 'PUBLISH_DATE', 'SECURITY_INNER_CODE', 'ORG_CODE', 'MARKET_TYPE']) {
      assert.ok(!(dropped in done), `${dropped} 不进取`)
    }
    assert.equal(pending.equity_record_date, null, '方案未定登记日是正常状态')
    assert.equal(pending.ex_dividend_days, -17, '距除权日为负=还没除权，原样保留')
    assert.equal(pending.assign_progress, '董事会决议通过')
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_dividend_plan：缺市场后缀与畸形除权日都响亮失败', async () => {
  const originalFetch = globalThis.fetch
  try {
    const source = sourceMap().eastmoney_dividend_plan
    await assert.rejects(
      () => source.execute({ capability: 'eastmoney_dividend_plan', params: { ticker: '600519', start_date: '2023-01-01', end_date: '2026-10-05' }, session }, signal),
      /requires an explicit market/,
    )
    globalThis.fetch = async () => response({ success: true, code: 0, result: { pages: 1, count: 1, data: [{ SECUCODE: '600519.SH', EX_DIVIDEND_DATE: '2026年6月26日' }] } })
    await assert.rejects(
      () => source.execute({ capability: 'eastmoney_dividend_plan', params: { ticker: '600519.SH', start_date: '2023-01-01', end_date: '2026-10-05' }, session }, signal),
      (error) => error?.code === 'eastmoney_invalid_response',
    )
    globalThis.fetch = async () => response({ success: true, code: 0, result: { pages: 1, count: 1, data: [{ SECUCODE: '600519.SH', EX_DIVIDEND_DATE: '2026-06-26 00:00:00', REPORT_DATE: '2025-12-31 00:00:00', PLAN_NOTICE_DATE: '2026-04-17 00:00:00' }] } })
    await assert.rejects(
      () => source.execute({ capability: 'eastmoney_dividend_plan', params: { ticker: '600519.SH', start_date: '2023-01-01', end_date: '2026-10-05' }, session }, signal),
      (error) => error?.code === 'eastmoney_invalid_response',
      '实施公告日实测从不缺席，缺了就是上游形状变了',
    )
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_holder_number_snapshot：披露日与报告期分列，新股无上期可比留 null', async () => {
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    const rows = [
      { SECUCODE: '600519.SH', SECURITY_CODE: '600519', SECURITY_NAME_ABBR: '贵州茅台', HOLDER_NUM: 296404, PRE_HOLDER_NUM: 243159,
        HOLDER_NUM_CHANGE: 53245, HOLDER_NUM_RATIO: 21.897194839591, INTERVAL_CHRATE: -16.30735947, END_DATE: '2026-06-30 00:00:00',
        PRE_END_DATE: '2026-03-31 00:00:00', PRE_E_DATE: '03/31', AVG_MARKET_CAP: 4999794.99996454, AVG_HOLD_NUM: 4217.49234490762,
        TOTAL_MARKET_CAP: 1481959237169.49, TOTAL_A_SHARES: 1250081601, HOLD_NOTICE_DATE: '2026-08-15 00:00:00', HOLD_N_DATE: '08/15',
        CHANGE_SHARES: -2188614, CHANGE_REASON: '资产重组', CLOSE_PRICE: 1185.49, ORG_CODE: '10002602' },
      { SECUCODE: '001246.SZ', SECURITY_CODE: '001246', SECURITY_NAME_ABBR: '力勤资源', HOLDER_NUM: 250527, PRE_HOLDER_NUM: 0,
        HOLDER_NUM_CHANGE: 250527, HOLDER_NUM_RATIO: null, INTERVAL_CHRATE: null, END_DATE: '2026-09-30 00:00:00',
        PRE_END_DATE: null, HOLD_NOTICE_DATE: '2026-09-29 00:00:00', TOTAL_MARKET_CAP: 76684290270.31, CLOSE_PRICE: 65.09,
        CHANGE_SHARES: 1178127059, CHANGE_REASON: '发行融资' },
    ]
    const filter = requested.searchParams.get('filter')
    const kept = filter ? rows.filter((row) => filter.includes(row.SECUCODE)) : rows
    return response({ success: true, code: 0, result: { pages: 1, count: kept.length, data: kept } })
  }
  try {
    const source = sourceMap().eastmoney_holder_number_snapshot
    const result = await source.execute({ capability: 'eastmoney_holder_number_snapshot', params: {}, session }, signal)
    assert.equal(requested.searchParams.get('sortColumns'), 'HOLDER_NUM')
    assert.equal(requested.searchParams.get('filter'), null, '全市场截面不带过滤器')
    const [moutai, newIssue] = result.data.item
    assert.equal(moutai.end_date, '2026-06-30', 'end_date 是报告期')
    assert.equal(moutai.hold_notice_date, '2026-08-15', '披露日是另一列，不能顶替报告期')
    assert.equal(moutai.end_date_ms, Date.parse('2026-06-30T00:00:00+08:00'))
    assert.equal(moutai.holder_num_ratio_pct, 21.897194839591)
    assert.equal(moutai.change_reason, '资产重组', '中文原因原文照存')
    assert.ok(!('PRE_E_DATE' in moutai) && !('HOLD_N_DATE' in moutai) && !('ORG_CODE' in moutai), '短标签与内部编码不进取')
    assert.equal(newIssue.holder_num_ratio_pct, null, '新股没有上期：null 而不是 0%')
    assert.equal(newIssue.pre_end_date, null)
    await assert.rejects(
      () => source.execute({ capability: 'eastmoney_holder_number_snapshot', params: { sort_field: 'end_date', start_date: '2026-01-01' }, session }, signal),
      /unsupported parameter/,
      '截面能力没有日期参数：给了就拒绝，不能让它以为取得到历史',
    )
    const single = await source.execute({ capability: 'eastmoney_holder_number_snapshot', params: { ticker: '001246.SZ' }, session }, signal)
    assert.equal(requested.searchParams.get('filter'), '(SECUCODE="001246.SZ")')
    assert.deepEqual(single.data.item.map((row) => row.thscode), ['001246.SZ'], '单票过滤器把截面收窄成一行')
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_margin_trading：真实行按加减法映射，行身份与上游 SECUCODE 不符就失败', async () => {
  const originalFetch = globalThis.fetch
  let requested
  const raw = {
    DATE: '2026-09-30 00:00:00', MARKET: '融资融券_沪证', SCODE: '600519', SECNAME: '贵州茅台', SECUCODE: '600519.SH',
    RZYE: 22131853460, RQYE: 3139145745, RZRQYE: 25270999205, RZRQYECZ: 18992707715,
    RZMRE: 715885371, RZCHE: 1000245646, RZJME: -284360275,
    RQMCL: 21400, RQCHL: 28670, RQJMG: -7270,
    RZMRE3D: 2559321377, RZCHE10D: 8116247340, RQJMG5D: -41981,
    SZ: 2568296402100, SPJ: 2044.5, ZDF: 1.767, RCHANGE10DCP: -1.2176, RZYEZB: 0.86173284, FIN_BALANCE_GR: -1.268547304026,
    KCB: 0, TRADE_MARKET_CODE: '069001001001', TRADE_MARKET: '上交所主板',
  }
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return response({ success: true, code: 0, result: { pages: 190, count: 3992, data: [raw] } })
  }
  try {
    const source = sourceMap().eastmoney_margin_trading
    const result = await source.execute({ capability: 'eastmoney_margin_trading', params: { ticker: '600519.SH', start_date: '2026-09-01', end_date: '2026-09-30' }, session }, signal)
    assert.equal(requested.searchParams.get('sortColumns'), 'DATE')
    assert.equal(requested.searchParams.get('filter'), `(SCODE="600519")(DATE>='2026-09-01')(DATE<='2026-09-30')`, '过滤器用不带后缀的 SCODE，日期用 DATE')
    const [row] = result.data.item
    assert.deepEqual([row.thscode, row.ticker, row.name], ['600519.SH', '600519', '贵州茅台'])
    assert.equal(row.trade_date, '2026-09-30')
    assert.equal(row.margin_balance, 22131853460)
    assert.equal(row.total_balance, 25270999205)
    assert.equal(row.margin_net_buy, -284360275, '净买入为负是事实，不夹正')
    assert.equal(row.short_sell_volume, 21400)
    assert.equal(row.margin_balance_pct, 0.86173284)
    assert.equal(row.market_segment, '融资融券_沪证', '市场原文保留')
    assert.ok(!('KCB' in row) && !('TRADE_MARKET' in row) && !('TRADE_MARKET_CODE' in row) && !('SCODE' in row), '内部编码与裸代码不进取')
    // 上游把明细串行到别的票上，不能挂到请求的那只下面
    globalThis.fetch = async () => response({ success: true, code: 0, result: { pages: 1, count: 1, data: [{ ...raw, SECUCODE: '600519.SZ' }] } })
    await assert.rejects(
      () => source.execute({ capability: 'eastmoney_margin_trading', params: { ticker: '600519.SH', start_date: '2026-09-01', end_date: '2026-09-30' }, session }, signal),
      (error) => error?.code === 'eastmoney_invalid_response',
    )
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_margin_trading：42 列宽表靠字段字典仍在详情预算内（§2.2 的兑现处）', () => {
  const source = sourceMap().eastmoney_margin_trading
  const hub = new DataCollectorHub({ store: { async save() { return {} } } })
  hub.registerSource(source)
  const described = hub.describeCapability('eastmoney_margin_trading')
  const declared = Object.keys(source.schema.output_schema.properties.item.items.properties)
  assert.equal(declared.length, 42, '两融映射表的列数变了就同步更新这条回归与下面的体积对比')
  assert.equal(declared.filter((key) => /^[a-z][a-z0-9_]*$/.test(key)).length, declared.length, '行键全部 ASCII snake_case')
  assert.equal(described.output_fields.split('\n').filter((line) => line.startsWith('item[].')).length, declared.length,
    '映射表每一列都要出现在字典里，投影不能漏列')
  const dictionary = JSON.stringify(described)
  // 同一份详情把字典换成逐列 JSON Schema 就越过 4096（实测 4900+）：这条断言钉住"为什么需要投影"，
  // 也意味着再往这张表加列时先看这里，而不是等运行时静默截断。
  const withSchema = JSON.stringify({ ...described, output_schema: source.schema.output_schema, output_fields: undefined })
  assert.ok(dictionary.length < 4096, `字典形态详情 ${dictionary.length} 字符，已打穿单能力 4096 预算`)
  assert.ok(withSchema.length > 4096, `schema 直发形态只有 ${withSchema.length} 字符，这条回归失去意义`)
})

/**
 * 可转债行的上游形状（2026-10-05 live 复核过）。`BOND_EXPIRE` 上游就是**字符串**，
 * `*_DATE` 一律带 ` 00:00:00`，行情列整表恒 null——这三点是这张表最容易踩的地方。
 */
const bondRaw = (overrides = {}) => ({
  SECURITY_CODE: '118077', SECUCODE: '118077.SH', TRADE_MARKET: 'CNSESH', SECURITY_NAME_ABBR: '莱特转债',
  CONVERT_STOCK_CODE: '688150', SECURITY_SHORT_NAME: '莱特光电',
  PUBLIC_START_DATE: '2026-09-29 00:00:00', VALUE_DATE: '2026-09-29 00:00:00', LISTING_DATE: null,
  EXPIRE_DATE: '2032-09-29 00:00:00', CEASE_DATE: '2032-09-28 00:00:00', DELIST_DATE: null,
  TRANSFER_START_DATE: '2027-04-12 00:00:00', TRANSFER_END_DATE: '2032-09-28 00:00:00', BOND_EXPIRE: '6',
  RATING: 'AA', PARTY_NAME: '中证鹏元资信评估股份有限公司', ACTUAL_ISSUE_SCALE: 5.24779, PAR_VALUE: 100, ISSUE_PRICE: 100,
  INITIAL_TRANSFER_PRICE: 44.82, TRANSFER_VALUE: 44.82, COUPON_IR: 0.1,
  IB_START_DATE: '2026-09-29 00:00:00', IB_END_DATE: '2027-09-28 00:00:00', CASHFLOW_DATE: '2027-09-29 00:00:00',
  PAY_INTEREST_DAY: '09-29', INTEREST_RATE_EXPLAIN: '第一年0.10%、第二年0.30%、第三年0.60%、第四年1.00%、第五年1.50%、第六年2.00%。',
  FIRST_PER_PREPLACING: 1.313, ONLINE_GENERAL_AAU: 1000, ONLINE_GENERAL_LWR: 0.00118203, IS_CONVERT_STOCK: '否',
  // 恒 null / 恒占位的行情列与内部编码：live 实测整表如此，必须留在 fixture 里验证"被丢弃"。
  CONVERT_STOCK_PRICE: null, CURRENT_BOND_PRICE: null, TRANSFER_PRICE: null, TRANSFER_PREMIUM_RATIO: 100,
  RESALE_TRIG_PRICE: null, REDEEM_TRIG_PRICE: null, PBV_RATIO: null, MARKET: null,
  ISSUE_TYPE: '1,4', REDEEM_TYPE: '2', PARAM_NAME: '交易所系统网上向社会公众投资者发行', BOND_COMBINE_CODE: '26092900001LTZ',
  FIRST_PROFIT: 39.3, RESALE_CLAUSE: '回售条款正文……', REDEEM_CLAUSE: '赎回条款正文……', ISSUE_OBJECT: '发行对象……',
  ...overrides,
})

test('eastmoney_convertible_bond_list：日期轴是起息日，正股市场只认上游 TRADE_MARKET', async () => {
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return response({ success: true, code: 0, result: { pages: 1, count: 9, data: [bondRaw()] } })
  }
  try {
    const source = sourceMap().eastmoney_convertible_bond_list
    const result = await source.execute({ capability: 'eastmoney_convertible_bond_list', params: { start_date: '2026-09-01', end_date: '2026-09-30' }, session }, signal)
    assert.equal(requested.searchParams.get('sortColumns'), 'PUBLIC_START_DATE')
    // 过滤列与排序列同为 PUBLIC_START_DATE（实测与 VALUE_DATE 1059/1059 相同且从不为空）：
    // 换成 LISTING_DATE 就会静默吞掉"已发行未上市"的债。
    assert.equal(requested.searchParams.get('filter'), `(PUBLIC_START_DATE>='2026-09-01')(PUBLIC_START_DATE<='2026-09-30')`)
    const [row] = result.data.item
    assert.deepEqual([row.thscode, row.ticker, row.name, row.market], ['118077.SH', '118077', '莱特转债', 'CNSESH'], '行主体是债券本身')
    assert.deepEqual([row.stock_ticker, row.stock_name, row.stock_thscode], ['688150', '莱特光电', '688150.SH'], '正股另起一组键，不与债券混用')
    assert.equal(row.value_date, '2026-09-29')
    assert.equal(row.value_date_ms, Date.parse('2026-09-29T00:00:00+08:00'))
    assert.equal(row.listing_date, null, '未上市就是 null，不拿申购日顶替')
    assert.equal(row.bond_expire_years, 6, 'BOND_EXPIRE 上游是字符串，映射成数值')
    assert.equal(row.issue_scale_yi, 5.24779, '发行规模按亿元原值给')
    assert.equal(row.coupon_rate_pct, 0.1, '当年票面利率是百分数原值')
    assert.deepEqual([row.interest_year_start_date, row.interest_year_end_date, row.next_cashflow_date], ['2026-09-29', '2027-09-28', '2027-09-29'])
    assert.equal(row.pay_interest_day, '09-29', '付息日原文是 MM-DD，不硬造年份')
    assert.equal(row.in_conversion_period, '否', '上游 是/否 原文保留')
    for (const dropped of ['CONVERT_STOCK_PRICE', 'CURRENT_BOND_PRICE', 'TRANSFER_PRICE', 'TRANSFER_PREMIUM_RATIO', 'PBV_RATIO', 'RESALE_TRIG_PRICE', 'REDEEM_TRIG_PRICE', 'MARKET', 'TRANSFER_VALUE', 'PAR_VALUE', 'ISSUE_PRICE', 'ONLINE_GENERAL_AAU', 'ISSUE_TYPE', 'REDEEM_TYPE', 'PARAM_NAME', 'BOND_COMBINE_CODE', 'FIRST_PROFIT', 'RESALE_CLAUSE', 'REDEEM_CLAUSE', 'ISSUE_OBJECT', 'PUBLIC_START_DATE']) {
      assert.ok(!(dropped in row), `${dropped} 不该出现在行里：恒 null/恒占位的行情列、内部编码与条款正文一律丢弃（§4.3 第 2 条）`)
    }
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_convertible_bond_list：老三板与 126 段老债都不按代码首位猜市场', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => response({
    success: true, code: 0,
    result: {
      pages: 1, count: 2,
      data: [
        // live 实测：404005.NQ 普利退债，TRADE_MARKET=STAS00，正股 400266 是老三板标的。
        // 按数字首位（4/8/92 → 北交所）会把它写成 400266.BJ——那就是给一只证券编造了市场。
        bondRaw({ SECUCODE: '404005.NQ', SECURITY_CODE: '404005', TRADE_MARKET: 'STAS00', SECURITY_NAME_ABBR: '普利退债', CONVERT_STOCK_CODE: '400266', SECURITY_SHORT_NAME: 'R普利1' }),
        // live 实测：126 段沪市老债（分离交易可转债）没有转股期，四列同批为 null。
        bondRaw({ SECUCODE: '126018.SH', SECURITY_CODE: '126018', TRADE_MARKET: 'CNSESH', SECURITY_NAME_ABBR: '08江铜债', CONVERT_STOCK_CODE: '600362', SECURITY_SHORT_NAME: '江西铜业', TRANSFER_START_DATE: null, TRANSFER_END_DATE: null, INITIAL_TRANSFER_PRICE: null, IS_CONVERT_STOCK: null, COUPON_IR: null, IB_START_DATE: null, IB_END_DATE: null, CASHFLOW_DATE: null }),
      ],
    },
  })
  try {
    const source = sourceMap().eastmoney_convertible_bond_list
    const { data } = await source.execute({ capability: 'eastmoney_convertible_bond_list', params: { start_date: '2008-01-01', end_date: '2026-10-05' }, session }, signal)
    assert.equal(data.item[0].stock_thscode, null, '未知市场不给后缀，也不给 .BJ')
    assert.equal(data.item[0].stock_ticker, '400266', '正股代码本身仍然给出去')
    assert.equal(data.item[0].market, 'STAS00', '市场原文保留，让调用方能自己看出这是老三板')
    assert.deepEqual([data.item[1].stock_thscode, data.item[1].stock_ticker], ['600362.SH', '600362'], '126 开头照样按上游市场挂沪')
    for (const key of ['transfer_start_date', 'transfer_end_date', 'initial_transfer_price', 'in_conversion_period', 'coupon_rate_pct', 'interest_year_start_date']) {
      assert.equal(data.item[1][key], null, `${key} 在分离交易可转债上是真实空缺，不许夹成占位值`)
    }
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_convertible_bond_list：SECUCODE 丢后缀或起息/到期日畸形就响亮失败', async () => {
  const originalFetch = globalThis.fetch
  const source = sourceMap().eastmoney_convertible_bond_list
  const call = () => source.execute({ capability: 'eastmoney_convertible_bond_list', params: { start_date: '2026-09-01', end_date: '2026-09-30' }, session }, signal)
  for (const broken of [
    bondRaw({ SECUCODE: '118077' }),
    bondRaw({ VALUE_DATE: '' }),
    bondRaw({ VALUE_DATE: '2026年9月' }),
    bondRaw({ EXPIRE_DATE: null }),
    bondRaw({ CONVERT_STOCK_CODE: '68815' }),
  ]) {
    globalThis.fetch = async () => response({ success: true, code: 0, result: { pages: 1, count: 1, data: [broken] } })
    await assert.rejects(call, (error) => error?.code === 'eastmoney_invalid_response', '半截行不能出库：' + JSON.stringify(broken.SECUCODE ?? broken.CONVERT_STOCK_CODE))
  }
  // 区间内没有发行是**数据缺口**（上游 code 9201），给空结果而不是错误，免得模型反复重试。
  globalThis.fetch = async () => response({ success: false, code: 9201, message: '返回数据为空' })
  const empty = await call()
  assert.deepEqual([empty.data.item, empty.data.pagination.total], [[], 0])
})

test('eastmoney_convertible_bond_list：代码参数剥市场后缀，畸形代码在出网前就拒绝', async () => {
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return response({ success: true, code: 0, result: { pages: 1, count: 1, data: [bondRaw()] } })
  }
  try {
    const source = sourceMap().eastmoney_convertible_bond_list
    // 后缀只用来收窄：过滤走不带市场的 SECURITY_CODE / CONVERT_STOCK_CODE（债市代码 11/12/13/40 都有）。
    await source.execute({ capability: 'eastmoney_convertible_bond_list', params: { start_date: '2019-01-01', end_date: '2019-12-31', bond_code: '110059.SH' }, session }, signal)
    assert.equal(requested.searchParams.get('filter'), `(PUBLIC_START_DATE>='2019-01-01')(PUBLIC_START_DATE<='2019-12-31')(SECURITY_CODE="110059")`)
    await source.execute({ capability: 'eastmoney_convertible_bond_list', params: { start_date: '2019-01-01', end_date: '2019-12-31', stock_code: '600000' }, session }, signal)
    assert.equal(requested.searchParams.get('filter'), `(PUBLIC_START_DATE>='2019-01-01')(PUBLIC_START_DATE<='2019-12-31')(CONVERT_STOCK_CODE="600000")`)
    // 老三板退市债（404005.NQ）也是本表的真实成员，后缀必须认。
    await source.execute({ capability: 'eastmoney_convertible_bond_list', params: { start_date: '2021-01-01', end_date: '2021-12-31', bond_code: '404005.nq' }, session }, signal)
    assert.equal(requested.searchParams.get('filter'), `(PUBLIC_START_DATE>='2021-01-01')(PUBLIC_START_DATE<='2021-12-31')(SECURITY_CODE="404005")`)
    for (const bad of ['11005', 'abc123', '600000.XX', '', '600000.SHX']) {
      requested = undefined
      await assert.rejects(
        () => source.execute({ capability: 'eastmoney_convertible_bond_list', params: { start_date: '2026-01-01', end_date: '2026-10-05', bond_code: bad }, session }, signal),
        /bond_code/,
      )
      assert.equal(requested, undefined, '参数畸形必须在上网之前拒绝')
    }
    await assert.rejects(
      () => source.execute({ capability: 'eastmoney_convertible_bond_list', params: { start_date: '2026-01-01', end_date: '2026-10-05', listing_year: 2026 }, session }, signal),
      /unsupported parameter/,
    )
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_convertible_bond_list：72 列表取 29 列，字典形态才装得进详情预算', () => {
  const source = sourceMap().eastmoney_convertible_bond_list
  const hub = new DataCollectorHub({ store: { async save() { return {} } } })
  hub.registerSource(source)
  const described = hub.describeCapability('eastmoney_convertible_bond_list')
  const declared = Object.keys(source.schema.output_schema.properties.item.items.properties)
  assert.equal(declared.length, 29, '转债表列数变了就同步更新这条回归与下面的体积对比')
  assert.equal(described.output_fields.split('\n').filter((line) => line.startsWith('item[].')).length, declared.length, '投影不能漏列')
  const dictionary = JSON.stringify(described)
  const withSchema = JSON.stringify({ ...described, output_schema: source.schema.output_schema, output_fields: undefined })
  assert.ok(dictionary.length < 4096, `字典形态详情 ${dictionary.length} 字符，已打穿单能力 4096 预算`)
  assert.ok(withSchema.length > 4096, `schema 直发形态只有 ${withSchema.length} 字符，这条回归失去意义`)
  // 契约层面必须能读出这三件事，否则丢弃列会被当成取数失败、量纲会被猜错。
  for (const promise of [/不含行情/, /1059\/1059/, /亿元/, /百分数原值/, /实际存续年数/, /当前计息年度/, /按代码首位/]) {
    assert.match(described.description, promise, `转债表描述缺少契约承诺 ${promise}`)
  }
})

test('eastmoney 宏观表：报告期缺失或畸形一律响亮失败，不产出半截行', async () => {
  const originalFetch = globalThis.fetch
  for (const bad of [{}, { REPORT_DATE: '' }, { REPORT_DATE: '2026年8月' }]) {
    globalThis.fetch = async () => response({ success: true, code: 0, result: { pages: 1, count: 1, data: [{ ...bad, TIME: '2026年08月份', NATIONAL_SAME: 0.8 }] } })
    const source = sourceMap().eastmoney_cpi
    await assert.rejects(
      () => source.execute({ capability: 'eastmoney_cpi', params: { start_date: '2026-08-01', end_date: '2026-08-31' }, session }, signal),
      (error) => error?.code === 'eastmoney_invalid_response',
      `畸形报告期 ${JSON.stringify(bad)} 必须报 eastmoney_invalid_response`,
    )
  }
  globalThis.fetch = originalFetch
})

test('Eastmoney normalizeParams：Hub 与 execute 的双重归一化保持幂等', () => {
  const sources = sourceMap()
  const cases = [
    ['eastmoney_top_buy_sell_ticker', { ticker: '600519.SH', start_date: '2026-09-01', end_date: '2026-09-24' }],
    ['eastmoney_cashflow_rotation', { board_type: 'industry', page: 1, size: 50 }],
  ]
  for (const [capability, params] of cases) {
    const source = sources[capability]
    const once = source.normalizeParams(params)
    assert.deepEqual(source.normalizeParams(once), once, `${capability} normalizeParams 必须幂等`)
    const declared = Object.keys(source.schema.input_schema.properties).sort()
    assert.deepEqual(Object.keys(once).filter((key) => !declared.includes(key)), [], `${capability} 不得注入未声明参数`)
  }
})

test('eastmoney_top_buy_sell_market：解析分页龙虎榜并保留 canonical ticker', async () => {
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return response({ success: true, code: 0, result: { pages: 2, count: 71, data: [{
      TRADE_DATE: '2026-09-23 00:00:00', SECURITY_CODE: '000993', SECUCODE: '000993.SZ', MARKET: 'SZ', SECURITY_NAME_ABBR: '闽东电力',
      CLOSE_PRICE: 18.82, CHANGE_RATE: -9.9952, TURNOVERRATE: 8.8655, BILLBOARD_BUY_AMT: 168342406, BILLBOARD_SELL_AMT: 104856058,
      BILLBOARD_NET_AMT: 63486348, BILLBOARD_DEAL_AMT: 273198464, DEAL_AMOUNT_RATIO: 35.75, DEAL_NET_RATIO: 8.3, ACCUM_AMOUNT: 764107467,
      FREE_MARKET_CAP: 8618646383.1, EXPLANATION: '日跌幅偏离值达到7%的前5只证券', TRADE_MARKET: '深交所主板', TRADE_ID: 100417427,
    }] } })
  }
  try {
    const source = sourceMap().eastmoney_top_buy_sell_market
    const result = await source.execute({ capability: source.schema.capability, params: { start_date: '2026-09-23', end_date: '2026-09-23', page: 1, size: 5 }, session }, signal)
    assert.equal(requested.searchParams.get('reportName'), 'RPT_DAILYBILLBOARD_DETAILS')
    assert.match(requested.searchParams.get('filter'), /TRADE_DATE<='2026-09-23'/)
    assert.equal(result.data.item[0].thscode, '000993.SZ')
    assert.equal(result.data.item[0].ticker, '000993')
    assert.equal(result.data.pagination.total, 71)
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_top_buy_sell_market：MARKET 为自由文本/空时护栏不误杀（SECUCODE 已带市场）', async () => {
  // 真实龙虎榜的 `MARKET` 不是 SH/SZ 白名单口径（如 `深交所主板`、空值）。把它喂进硬校验
  // 会让整页判错（§10.2 护栏误杀族）；SECUCODE 自带市场后缀时以它为准，`market` 列仍存原文。
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => response({ success: true, code: 0, result: { pages: 1, count: 2, data: [
    { TRADE_DATE: '2026-09-23 00:00:00', SECURITY_CODE: '000993', SECUCODE: '000993.SZ', MARKET: '深交所主板', SECURITY_NAME_ABBR: '闽东电力' },
    { TRADE_DATE: '2026-09-23 00:00:00', SECURITY_CODE: '600519', SECUCODE: '600519.SH', MARKET: null, SECURITY_NAME_ABBR: '贵州茅台' },
  ] } })
  try {
    const source = sourceMap().eastmoney_top_buy_sell_market
    const result = await source.execute({ capability: source.schema.capability, params: { start_date: '2026-09-23', end_date: '2026-09-23', page: 1, size: 5 }, session }, signal)
    assert.equal(result.data.item[0].thscode, '000993.SZ')
    assert.equal(result.data.item[0].market, '深交所主板')
    assert.equal(result.data.item[1].thscode, '600519.SH')
    assert.equal(result.data.item[1].market, 'SH', 'MARKET 为空时回落身份市场')
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_top_buy_sell_ticker：严格生成单票过滤器', async () => {
  const originalFetch = globalThis.fetch
  let filter
  globalThis.fetch = async (url) => {
    filter = new URL(url).searchParams.get('filter')
    return response({ success: true, code: 0, result: { pages: 1, count: 1, data: [{ TRADE_DATE: '2025-12-31 00:00:00', SECURITY_CODE: '000430', SECUCODE: '000430.SZ', MARKET: 'SZ', SECURITY_NAME_ABBR: '张家界', BILLBOARD_NET_AMT: 1, EXPLANATION: '测试' }] } })
  }
  try {
    const source = sourceMap().eastmoney_top_buy_sell_ticker
    const result = await source.execute({ capability: source.schema.capability, params: { ticker: '000430.SZ', start_date: '2025-12-31', end_date: '2025-12-31' }, session }, signal)
    assert.equal(filter, `(TRADE_DATE<='2025-12-31')(TRADE_DATE>='2025-12-31')(SECURITY_CODE="000430")`)
    assert.equal(result.data.item.length, 1)
  } finally { globalThis.fetch = originalFetch }
})


test('eastmoney_top_buy_sell_ticker：9201 区分真实代码无记录与非法代码', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const parsed = new URL(url)
    if (parsed.hostname === 'push2.eastmoney.com') {
      const code = parsed.searchParams.get('secid')?.split('.')[1]
      return response(code === '600519'
        ? { rc: 0, data: { f57: '600519', f58: '贵州茅台', f107: 1 } }
        : { rc: 100, data: null })
    }
    return response({ success: false, code: 9201, message: '返回数据为空' })
  }
  try {
    const source = sourceMap().eastmoney_top_buy_sell_ticker
    const request = (ticker) => source.execute({ capability: source.schema.capability, params: { ticker, start_date: '2026-08-24', end_date: '2026-09-24' }, session }, signal)
    await assert.rejects(request('600519.SH'), (error) => error?.code === 'eastmoney_no_billboard_data')
    await assert.rejects(request('999999.SH'), (error) => error?.code === 'eastmoney_invalid_ticker')
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_lockup_expiry：兼容真实裸 SECURITY_CODE 并保留原始数量字段', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => response({ success: true, code: 0, result: { pages: 58, count: 115, data: [{
    SECURITY_CODE: '001388', SECURITY_NAME_ABBR: '信通电子', FREE_DATE: '2026-01-05 00:00:00', FREE_SHARES_TYPE: '首发机构配售股份', FREE_SHARES: 3120, TOTAL_RATIO: 0.004021224359, NON_FREE_SHARES: 12480, ABLE_FREE_SHARES: 62.7311,
  }] } })
  try {
    const source = sourceMap().eastmoney_lockup_expiry
    const result = await source.execute({ capability: source.schema.capability, params: { start_date: '2026-01-01', end_date: '2026-01-31' }, session }, signal)
    assert.equal(result.data.item[0].thscode, '001388.SZ')
    assert.equal(result.data.item[0].free_shares_raw, 3120)
    assert.equal(result.data.item[0].total_ratio, 0.004021224359)
  } finally { globalThis.fetch = originalFetch }
})

test('eastmoney_sector_rotation 与 cashflow：解析板块代码和资金层字段', async () => {
  const originalFetch = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(new URL(url))
    return response({ rc: 0, data: { total: 1, diff: [{ f12: 'BK0481', f14: '汽车零部件', f2: 43329.33, f3: -0.32, f4: -1, f5: 10, f6: 20, f7: 1.2, f8: 3.4, f9: 12, f10: 2, f62: 845342016, f184: 2.83, f66: 553180224, f69: 1.85, f72: 292161792, f75: 0.98, f78: -193591552, f81: -0.65, f84: -669137408, f87: -2.24, f124: 1790221449 }] } })
  }
  try {
    const sources = sourceMap()
    const rotation = await sources.eastmoney_sector_rotation.execute({ capability: 'eastmoney_sector_rotation', params: { board_type: 'industry', sort_field: 'change_pct', size: 1 }, session }, signal)
    const cashflow = await sources.eastmoney_cashflow_rotation.execute({ capability: 'eastmoney_cashflow_rotation', params: { board_type: 'industry', size: 1 }, session }, signal)
    assert.equal(urls[0].searchParams.get('fid'), 'f3')
    assert.equal(urls[1].searchParams.get('fid'), 'f62')
    assert.equal(rotation.data.item[0].board_code, 'BK0481')
    assert.equal(cashflow.data.item[0].main_net_inflow, 845342016)
    assert.equal(cashflow.data.item[0].small_net_inflow_pct, -2.24)
  } finally { globalThis.fetch = originalFetch }
})

test('Eastmoney source：success=false 不得静默返回空数组', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => response({ success: false, code: 9501, message: '报表配置不存在' })
  try {
    const source = sourceMap().eastmoney_lockup_expiry
    await assert.rejects(() => source.execute({ capability: source.schema.capability, params: { start_date: '2026-01-01', end_date: '2026-01-31' }, session }, signal), /报表配置不存在/)
  } finally { globalThis.fetch = originalFetch }
})
