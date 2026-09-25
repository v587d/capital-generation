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

test('Eastmoney source：注册五个 capability 与内部身份', () => {
  const sources = createEastmoneySources()
  assert.deepEqual(sources.map((source) => source.schema.capability), [
    'eastmoney_top_buy_sell_market', 'eastmoney_top_buy_sell_ticker', 'eastmoney_lockup_expiry',
    'eastmoney_sector_rotation', 'eastmoney_cashflow_rotation',
  ])
  assert.equal(new Set(sources.map((source) => source.schema.data_key)).size, 5)
  for (const source of sources) {
    assert.equal(source.schema.source_label, 'eastmoney')
    assert.match(source.schema.data_key, /^eastmoney\.http\./)
    assert.ok(source.schema.description.length > 20)
    assert.ok(source.schema.output_schema)
  }
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
  // 会让整页判错（§10 第 2 条护栏误杀族）；SECUCODE 自带市场后缀时以它为准，`market` 列仍存原文。
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
