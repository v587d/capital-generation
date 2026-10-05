import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEastmoneySources } from '../lib/sources/eastmoney-http.js'
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
const SNAKE_CASE_CAPABILITIES = [...MACRO_CAPABILITIES, 'eastmoney_mutual_flow', 'eastmoney_mutual_quota']

test('Eastmoney source：注册十六个 capability 与内部身份', () => {
  const sources = createEastmoneySources()
  assert.deepEqual(sources.map((source) => source.schema.capability), [
    'eastmoney_top_buy_sell_market', 'eastmoney_top_buy_sell_ticker', 'eastmoney_lockup_expiry',
    'eastmoney_sector_rotation', 'eastmoney_cashflow_rotation', ...MACRO_CAPABILITIES,
    'eastmoney_mutual_flow', 'eastmoney_mutual_quota',
  ])
  assert.equal(new Set(sources.map((source) => source.schema.data_key)).size, 16)
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
