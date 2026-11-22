import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEastmoneySources } from '../lib/sources/eastmoney-http.js'
import { outputSchemaViolations } from './output-contract.mjs'

const signal = new AbortController().signal
const session = { id: 'eastmoney-events', header: { cwd: '/workspace/proj' } }

const ADDED = [
  'eastmoney_security_profile', 'eastmoney_st_stock_list',
  'eastmoney_institution_research', 'eastmoney_holder_change', 'eastmoney_buyback',
  'eastmoney_pledge', 'eastmoney_new_stock',
]

function sourceMap() {
  return Object.fromEntries(createEastmoneySources().map((source) => [source.schema.capability, source]))
}

/** Transport double: the shared eastmoney client only needs `status` + `json()`. */
function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload }
}

/** Host rule mirror: undefined / NaN / -0 / array holes make the whole result vanish (§9.5). */
function assertLosslessJson(value, path = '$') {
  if (value === null) return
  const type = typeof value
  if (type === 'string' || type === 'boolean') return
  if (type === 'number') {
    assert.ok(Number.isFinite(value), `${path} 必须是有限数字`)
    assert.ok(!Object.is(value, -0), `${path} 不能是 -0`)
    return
  }
  assert.notEqual(type, 'undefined', `${path} 是 undefined`)
  assert.equal(type, 'object', `${path} 的类型 ${type} 不可 JSON 序列化`)
  if (Array.isArray(value)) {
    assert.equal(Object.getPrototypeOf(value), Array.prototype, `${path} 必须是普通数组`)
    value.forEach((entry, index) => assertLosslessJson(entry, `${path}[${index}]`))
    return
  }
  assert.equal(Object.getPrototypeOf(value), Object.prototype, `${path} 必须是 plain 对象`)
  for (const [key, entry] of Object.entries(value)) assertLosslessJson(entry, `${path}.${key}`)
}

/** Execute one capability against a stubbed transport and assert its own output contract. */
async function run(capability, params, handler) {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url))
    requests.push(parsed)
    return response(handler(parsed, requests.length))
  }
  try {
    const source = sourceMap()[capability]
    assert.ok(source, `${capability} 必须已注册`)
    const output = await source.execute({ capability, params, session }, signal)
    const schema = output.schema ?? source.schema.output_schema
    assert.deepEqual(outputSchemaViolations(schema, output.data), [], `${capability} 的返回值必须满足 output.schema`)
    assertLosslessJson(output.data)
    return { data: output.data, requests, source }
  } finally {
    globalThis.fetch = originalFetch
  }
}

const dc = (rows, extra = {}) => ({ success: true, code: 0, result: { pages: 1, count: rows.length, data: rows, ...extra } })
const dcEmpty = { success: false, code: 9201, message: '返回数据为空' }
const clist = (rows) => ({ rc: 0, data: { total: rows.length, diff: rows } })

const PROFILE_FIELDS = { f57: '600519', f58: '贵州茅台', f84: 1250081601, f85: 1250081601, f116: 1857308738685.75, f117: 1857308738685.75, f127: '白酒Ⅱ', f162: 21.61, f167: 6.85, f189: 20010827 }

const SURVEY_ROW = {
  SECUCODE: '688062.SH', SECURITY_CODE: '688062', SECURITY_NAME_ABBR: '迈威生物',
  NOTICE_DATE: '2026-11-02 00:00:00', RECEIVE_START_DATE: '2026-10-09 00:00:00', RECEIVE_END_DATE: '2026-10-29 00:00:00',
  RECEIVE_OBJECT: '广发证券', RECEIVE_WAY_EXPLAIN: '特定对象调研,路演活动', RECEIVE_PLACE: '公司会议室、线上等',
  RECEPTIONIST: '高级副总裁 胡会国', SUM: 11, NUMBERNEW: '1', IS_SOURCE: '1', UPSTREAM_EXTRA: '未映射的上游列必须丢弃',
}

const HOLDER_ROW = {
  SECURITY_CODE: '000915', SECURITY_NAME_ABBR: '华特达因', NOTICE_DATE: '2026-11-21 00:00:00',
  HOLDER_NAME: '山东华特控股集团有限公司', DIRECTION: '增持', CHANGE_NUM: 213.04, CHANGE_NUM_SYMBOL: 213.04,
  AFTER_CHANGE_RATE: 0.909139461136, CHANGE_FREE_RATIO: 0.91, AFTER_HOLDER_NUM: 5664.1741,
  HOLD_RATIO: 24.17, FREE_SHARES: 5664.1741, FREE_SHARES_RATIO: 24.19,
  TRADE_AVERAGE_PRICE: null, MARKET: '二级市场', START_DATE: '2026-11-13 00:00:00', END_DATE: '2026-11-20 00:00:00',
  TRADE_DATE: '2026-11-20 00:00:00', CHANGE_RATE: -4.3769,
}

const BUYBACK_ROW = {
  SECUCODE: '600519.SH', DIM_SCODE: '600519', SECURITYSHORTNAME: '贵州茅台', REPURCODE: '15239',
  REPURPROGRESS: '006', UPD: '2026-05-28 00:00:00', UPDATEDATE: '2026-05-28 00:00:00', NOTICEDATE: '2026-05-28 00:00:00',
  FINISHDATE: '2026-05-27 00:00:00', REPURSTARTDATE: '2025-11-28 00:00:00', REPURENDDATE: '2026-05-28 00:00:00',
  REPURPRICECAP: 1863.67, REPURNUMLOWER: 804864, REPURNUMCAP: 1609727, REPURAMOUNTLOWER: 1500000000,
  REPURAMOUNTLIMIT: 3000000000, ZSZXX: 0.064272390284, ZSZSX: 0.128544700714, REPURNUM: 2188614,
  REPURAMOUNT: 2999933749.57, REPURPRICELOWER1: 1252.63, REPURPRICECAP1: 1499.74,
  REPUROBJECTIVE: '用于注销并减少公司注册资本', REPURPRICELOWER: null,
}

const PLEDGE_ROW = {
  SECUCODE: '301015.SZ', SECURITY_CODE: '301015', SECURITY_NAME_ABBR: '百洋制药', TRADE_DATE: '2026-11-20 00:00:00',
  PLEDGE_RATIO: 35.24, REPURCHASE_BALANCE: 18522.06, PLEDGE_DEAL_NUM: 14,
  REPURCHASE_UNLIMITED_BALANCE: 18522.06, REPURCHASE_LIMITED_BALANCE: 0,
  PLEDGE_MARKET_CAP: 411374.9526, INDUSTRY: '医药商业', Y1_CLOSE_ADJCHRATE: 0.487,
}

const IPO_ROW = {
  SECUCODE: '920067.BJ', SECURITY_CODE: '920067', SECURITY_NAME: '雅图高新', APPLY_CODE: '920067',
  TRADE_MARKET: '北京证券交易所', MARKET: null, MARKET_TYPE_NEW: '北交所',
  APPLY_DATE: '2026-11-14 00:00:00', BALLOT_NUM_DATE: '2026-11-18 00:00:00', BALLOT_PAY_DATE: '2026-11-19 00:00:00',
  LISTING_DATE: '2026-11-23 00:00:00', ISSUE_PRICE: 23.52, AFTER_ISSUE_PE: 18.3, INDUSTRY_PE: 26.7,
  ISSUE_NUM: 1666.6667, ONLINE_ISSUE_NUM: 14166667, ONLINE_APPLY_UPPER: 708300, TOP_APPLY_MARKETCAP: 1665.9216,
  ONLINE_ISSUE_LWR: 0.0289, CLOSE_PRICE: null, LD_CLOSE_CHANGE: null, PREDICT_ISSUE_PRICE: 0,
}

test('东财事件包：新增 7 个能力已注册，元数据与输出形状自洽', () => {
  const map = sourceMap()
  for (const capability of ADDED) {
    const source = map[capability]
    assert.ok(source, `${capability} 必须已注册`)
    assert.equal(source.schema.source_label, 'eastmoney')
    assert.match(source.schema.data_key, /^eastmoney\.http\./)
    assert.match(source.schema.name, /^get_/)
    assert.ok(source.schema.summary.length > 0 && source.schema.summary.length <= 50, `${capability} summary 必须在 50 字以内`)
    assert.ok(source.schema.description.length > 200, `${capability} description 要写清口径`)
    assert.ok(source.schema.description.includes('⛔'), `${capability} description 必须带 ⛔ 约束`)
    assert.deepEqual(source.schema.rowShape, { rowKey: 'item' })
    assert.equal(source.schema.input_schema.type, 'object')
    for (const key of source.schema.input_schema.required ?? []) {
      assert.ok(Object.hasOwn(source.schema.input_schema.properties, key), `${capability} 的 required 里出现了未声明参数 ${key}`)
    }
    assert.equal(source.schema.output_schema.type, 'object')
  }
  assert.equal(map.eastmoney_security_profile.schema.paginated, false, '单票基本面不翻页')
  assert.equal(map.eastmoney_st_stock_list.schema.paginated, false, 'ST 名单是当日全量快照')
  for (const capability of ['eastmoney_institution_research', 'eastmoney_holder_change', 'eastmoney_buyback', 'eastmoney_pledge', 'eastmoney_new_stock']) {
    assert.equal(map[capability].schema.paginated, true, `${capability} 是 datacenter 分页能力`)
  }
  assert.equal(map.eastmoney_security_profile.schema.cacheMaxAgeMs, 60_000)
  assert.equal(map.eastmoney_pledge.schema.cacheMaxAgeMs, 3_600_000, '质押是中国结算周度数据')
})

test('参数归一化幂等且不改键名（§10.7：Hub 与 execute 各跑一遍）', () => {
  const cases = [
    ['eastmoney_security_profile', { ticker: 'sh600519' }, { ticker: '600519.SH' }],
    ['eastmoney_st_stock_list', { market: 'SH' }, { market: 'sh' }],
    ['eastmoney_st_stock_list', {}, { market: 'all' }],
    ['eastmoney_institution_research', { ticker: '688062', start_date: '2026-11-01', end_date: '2026-11-21', page: 2, size: 5 }, { ticker: '688062.SH', start_date: '2026-11-01', end_date: '2026-11-21', page: 2, size: 5 }],
    ['eastmoney_holder_change', { ticker: '000915.SZ', direction: 'DECREASE', page: 1, size: 5 }, { ticker: '000915.SZ', direction: 'decrease', page: 1, size: 5 }],
    ['eastmoney_buyback', { ticker: '600519', progress: '实施中', page: 1, size: 5 }, { ticker: '600519.SH', progress: '实施中', page: 1, size: 5 }],
    ['eastmoney_pledge', { ticker: '301015', start_date: '2026-11-06', end_date: '2026-11-20', page: 1, size: 5 }, { ticker: '301015.SZ', start_date: '2026-11-06', end_date: '2026-11-20', page: 1, size: 5 }],
    ['eastmoney_new_stock', { ticker: '920067', start_date: '2026-11-01', end_date: '2026-12-31', page: 1, size: 5 }, { ticker: '920067.BJ', start_date: '2026-11-01', end_date: '2026-12-31', page: 1, size: 5 }],
  ]
  for (const [capability, params, expected] of cases) {
    const source = sourceMap()[capability]
    const once = source.normalizeParams(params)
    const twice = source.normalizeParams(once)
    assert.deepEqual(twice, once, `${capability} 的 normalizeParams 必须幂等`)
    assert.deepEqual(once, expected, `${capability} 的归一化结果不符合预期`)
    const declared = Object.keys(source.schema.input_schema.properties)
    for (const key of Object.keys(once)) assert.ok(declared.includes(key), `${capability} 归一化后出现了未声明的键 ${key}`)
  }
})

test('eastmoney_security_profile：secid 规则（5x/588x/900x 算沪、92x 算北）与字段映射', async () => {
  const { data, requests } = await run('eastmoney_security_profile', { ticker: '600519' }, () => ({ rc: 0, data: PROFILE_FIELDS }))
  assert.equal(requests[0].searchParams.get('secid'), '1.600519')
  assert.equal(requests[0].searchParams.get('fltt'), '2')
  assert.match(String(requests[0].searchParams.get('fields')), /f84/)
  assert.equal(data.item.length, 1)
  const [row] = data.item
  assert.equal(row.thscode, '600519.SH')
  assert.equal(row.ticker, '600519')
  assert.equal(row.name, '贵州茅台')
  assert.equal(row.market, 'SH')
  assert.equal(row.eastmoney_secid, '1.600519')
  assert.equal(row.industry, '白酒Ⅱ')
  assert.equal(row.total_shares, 1250081601)
  assert.equal(row.float_shares, 1250081601)
  assert.equal(row.total_market_cap, 1857308738685.75)
  assert.equal(row.float_market_cap, 1857308738685.75)
  assert.equal(row.list_date, '2001-08-27')
  assert.equal(row.list_date_ms, Date.parse('2001-08-27T00:00:00+08:00'))
  assert.equal(row.pe_dynamic, 21.61)
  assert.equal(row.pb, 6.85)
  assert.deepEqual(data.pagination, { page: 1, size: 1, pages: 1, total: 1 })
})

test('eastmoney_security_profile：裸代码按 A 股解析，指数写法被拒，无股本不回一行 null', async () => {
  for (const [ticker, secid] of [['588000', '1.588000'], ['900901', '1.900901'], ['920982', '0.920982']]) {
    const digits = ticker.slice(0, 6)
    const { requests } = await run('eastmoney_security_profile', { ticker }, () => ({ rc: 0, data: { ...PROFILE_FIELDS, f57: digits, f58: `${digits} 示例证券`, f84: 1000000, f85: 1000000 } }))
    assert.equal(requests[0].searchParams.get('secid'), secid, `${ticker} 的 secid 必须按 em_secid 规则（沪=1，深/北=0）`)
  }
  const map = sourceMap()
  assert.throws(() => map.eastmoney_security_profile.normalizeParams({ ticker: '000001.SH' }), /conflicts with the A-share code prefix/)
  await assert.rejects(
    run('eastmoney_security_profile', { ticker: '999999' }, () => ({ rc: 0, data: null })),
    /returned no data/,
  )
  await assert.rejects(
    run('eastmoney_security_profile', { ticker: '399001' }, () => ({ rc: 0, data: { f57: '399001', f58: '深证成指' } })),
    /no share capital/,
  )
})

const ST_HANDLER = (url) => {
  const fs = url.searchParams.get('fs')
  if (fs === 'm:1+f:4') {
    return clist([
      { f12: '688622', f13: 1, f14: '*ST禾信', f2: 100.5, f3: -0.38, f4: -0.38, f5: 4293, f6: 42265776, f7: 5.13, f8: 0.61 },
      { f12: '900915', f13: 1, f14: 'ST中路B', f2: 0.197, f3: -2.48, f4: -0.005, f5: 939, f6: 18347, f7: 3.47, f8: 0.11 },
    ])
  }
  if (fs === 'm:0+f:4') {
    return clist([
      { f12: '000567', f13: 0, f14: 'ST海德', f2: 3.83, f3: -3.1, f4: -0.13, f5: 26621, f6: 10971534, f7: 3.33, f8: 1.21 },
      { f12: '000411', f13: 0, f14: '*ST英特', f2: '-', f3: '-', f4: '-', f5: '-', f6: '-', f7: '-', f8: '-' },
      { f12: '920575', f13: 0, f14: '*ST康乐', f2: 3.83, f3: -26.2, f4: -1.36, f5: 118145, f6: 50908628, f7: 19.08, f8: 6.29 },
      { f12: '873841', f13: 0, f14: 'ST祥盛', f2: '-', f3: '-', f4: '-', f5: '-', f6: '-', f7: '-', f8: '-' },
    ])
  }
  if (fs === 'm:0+t:81+s:2048') {
    return clist([
      { f12: '920575', f13: 0, f14: '*ST康乐', f2: 3.83, f3: -26.2, f4: -1.36, f5: 118145, f6: 50908628, f7: 19.08, f8: 6.29 },
      { f12: '920992', f13: 0, f14: '中科美菱', f2: 8.91, f3: -6.31, f4: -0.6, f5: 13305, f6: 12084168, f7: 5.89, f8: 2.71 },
    ])
  }
  throw new Error(`unexpected fs ${fs}`)
}

test('eastmoney_st_stock_list：沪/深风险警示板 + 北交所全表名称筛，僵尸老号段不进结果', async () => {
  const { data, requests } = await run('eastmoney_st_stock_list', {}, ST_HANDLER)
  assert.deepEqual(requests.map((url) => url.searchParams.get('fs')), ['m:1+f:4', 'm:0+f:4', 'm:0+t:81+s:2048'])
  for (const url of requests) {
    assert.equal(url.searchParams.get('pn'), '1')
    assert.equal(url.searchParams.get('pz'), '100')
    assert.equal(url.searchParams.get('fid'), 'f12')
    assert.ok(url.searchParams.get('ut'), 'clist 必须带 ut')
  }
  assert.deepEqual(data.markets, ['sh', 'sz', 'bj'])
  assert.equal(data.total, 5)
  assert.deepEqual(data.by_market, { sh: 2, sz: 2, bj: 1 })
  assert.deepEqual(data.item.map((row) => row.code), ['688622', '900915', '000411', '000567', '920575'], '行按 sh→sz→bj、代码升序，且剔除北交所僵尸老号段')
  const [star, shb, , sz, bj] = data.item
  assert.equal(star.market, 'sh')
  assert.equal(star.share_type, 'a_share')
  assert.equal(star.st_type, '*ST')
  assert.equal(star.price, 100.5)
  assert.equal(star.volume, 4293)
  assert.equal(shb.share_type, 'b_share', '900xxx 是沪 B 股，价格与金额币种不同')
  assert.equal(sz.price, 3.83)
  assert.equal(bj.market, 'bj')
  assert.equal(bj.st_type, '*ST')
  const bjb = data.item.find((row) => row.code === '920575')
  assert.ok(bjb, '北交所 ST 来自全表名称筛')
})

test('eastmoney_st_stock_list：停牌「-」出 null、市场过滤、空板与重复代码是失败而不是空名单', async () => {
  const { data, requests } = await run('eastmoney_st_stock_list', { market: 'sz' }, ST_HANDLER)
  assert.deepEqual(requests.map((url) => url.searchParams.get('fs')), ['m:0+f:4'])
  assert.deepEqual(data.markets, ['sz'])
  assert.deepEqual(data.by_market, { sh: 0, sz: 2, bj: 0 })
  const suspended = data.item.find((row) => row.code === '000411')
  assert.equal(suspended.price, null)
  assert.equal(suspended.change_pct, null)
  assert.equal(suspended.volume, null)
  assert.equal(suspended.turnover_pct, null)

  const map = sourceMap()
  assert.throws(() => map.eastmoney_st_stock_list.normalizeParams({ market: 'hk' }), /market must be one of/)
  await assert.rejects(run('eastmoney_st_stock_list', { market: 'sh' }, () => clist([])), /risk-warning board returned no rows/)
  await assert.rejects(run('eastmoney_st_stock_list', { market: 'bj' }, () => clist([])), /BSE full list is empty/)
  await assert.rejects(
    run('eastmoney_st_stock_list', { market: 'sh' }, () => clist([
      { f12: '600001', f13: 1, f14: 'ST甲', f2: 1, f3: 1, f4: 1, f5: 1, f6: 1, f7: 1, f8: 1 },
      { f12: '600001', f13: 1, f14: 'ST甲', f2: 1, f3: 1, f4: 1, f5: 1, f6: 1, f7: 1, f8: 1 },
    ])),
    /duplicate code/,
  )
})

test('eastmoney_institution_research：汇总行映射、公告日过滤与分页参数', async () => {
  const { data, requests } = await run('eastmoney_institution_research', { ticker: '688062', start_date: '2026-11-01', end_date: '2026-11-21', page: 2, size: 5 }, () => dc([SURVEY_ROW], { pages: 4, count: 18 }))
  const url = requests[0]
  assert.equal(url.searchParams.get('reportName'), 'RPT_ORG_SURVEYNEW')
  assert.equal(url.searchParams.get('sortColumns'), 'NOTICE_DATE,SECURITY_CODE,RECEIVE_START_DATE')
  assert.equal(url.searchParams.get('sortTypes'), '-1,1,-1')
  assert.equal(url.searchParams.get('pageNumber'), '2')
  assert.equal(url.searchParams.get('pageSize'), '5')
  assert.equal(url.searchParams.get('filter'), '(IS_SOURCE="1")(NUMBERNEW="1")(SECURITY_CODE="688062")(NOTICE_DATE>=\'2026-11-01\')(NOTICE_DATE<=\'2026-11-21\')')
  assert.deepEqual(data.pagination, { page: 2, size: 5, pages: 4, total: 18 })
  const [row] = data.item
  assert.equal(row.thscode, '688062.SH')
  assert.equal(row.name, '迈威生物')
  assert.equal(row.notice_date, '2026-11-02')
  assert.equal(row.notice_date_ms, Date.parse('2026-11-02T00:00:00+08:00'))
  assert.equal(row.survey_start_date, '2026-10-09')
  assert.equal(row.survey_end_date, '2026-10-29')
  assert.equal(row.org_count, 11)
  assert.equal(row.survey_way, '特定对象调研,路演活动')
  assert.equal(row.reception_place, '公司会议室、线上等')
  assert.equal(row.receptionist, '高级副总裁 胡会国')
  assert.ok(!('SUM' in row) && !('UPSTREAM_EXTRA' in row), '映射表之外的上游键必须丢弃')
})

test('eastmoney_holder_change：AFTER_CHANGE_RATE 是本次变动占比，不是变动后持股比例', async () => {
  const { data, requests } = await run('eastmoney_holder_change', { ticker: '000915', direction: 'increase', start_date: '2026-09-01', end_date: '2026-11-21', page: 1, size: 5 }, () => dc([HOLDER_ROW]))
  assert.equal(requests[0].searchParams.get('reportName'), 'RPT_SHARE_HOLDER_INCREASE')
  assert.equal(requests[0].searchParams.get('filter'), '(DIRECTION="增持")(SECURITY_CODE="000915")(NOTICE_DATE>=\'2026-09-01\')(NOTICE_DATE<=\'2026-11-21\')')
  const [row] = data.item
  assert.equal(row.thscode, '000915.SZ')
  assert.equal(row.direction, 'increase')
  assert.equal(row.holder_name, '山东华特控股集团有限公司')
  assert.equal(row.change_shares_10k, 213.04)
  assert.equal(row.change_pct_total, 0.909139461136, 'AFTER_CHANGE_RATE 是本次变动占总股本比例')
  assert.equal(row.after_pct_total, 24.17, 'HOLD_RATIO 才是变动后持股占比')
  assert.equal(row.change_pct_float, 0.91)
  assert.equal(row.after_hold_shares_10k, 5664.1741)
  assert.equal(row.after_pct_float, 24.19)
  assert.equal(row.avg_price, null, '未披露成交均价是 null，不是 0')
  assert.equal(row.channel, '二级市场')
  assert.equal(row.start_date, '2026-11-13')
  assert.equal(row.end_date, '2026-11-20')
  assert.ok(!('CHANGE_RATE' in row), '口径未核验的 CHANGE_RATE 不收录')
})

test('eastmoney_holder_change：方向与带符号股数矛盾时响亮失败，未知方向同样拒绝', async () => {
  await assert.rejects(
    run('eastmoney_holder_change', {}, () => dc([{ ...HOLDER_ROW, DIRECTION: '减持' }])),
    /flips the signed share count against DIRECTION/,
  )
  await assert.rejects(run('eastmoney_holder_change', {}, () => dc([{ ...HOLDER_ROW, DIRECTION: '' }])), /unknown DIRECTION/)
  const map = sourceMap()
  assert.throws(() => map.eastmoney_holder_change.normalizeParams({ direction: 'hold' }), /direction must be one of/)
})

test('eastmoney_buyback：进度码映射、007/008 无名称、日期口径是 UPD', async () => {
  const { data, requests } = await run('eastmoney_buyback', { ticker: '600519', progress: '实施中', start_date: '2026-01-01', end_date: '2026-11-21', page: 1, size: 5 }, () => dc([BUYBACK_ROW]))
  const url = requests[0]
  assert.equal(url.searchParams.get('reportName'), 'RPTA_WEB_GETHGLIST_NEW')
  assert.equal(url.searchParams.get('sortColumns'), 'UPD,DIM_SCODE,REPURCODE')
  assert.equal(url.searchParams.get('sortTypes'), '-1,1,1')
  assert.equal(url.searchParams.get('filter'), '(REPURPROGRESS="004")(DIM_SCODE="600519")(UPD>=\'2026-01-01\')(UPD<=\'2026-11-21\')')
  const [row] = data.item
  assert.equal(row.thscode, '600519.SH')
  assert.equal(row.progress, '完成实施', '进度码 006 = 完成实施')
  assert.equal(row.progress_code, '006')
  assert.equal(row.update_date, '2026-05-28')
  assert.equal(row.update_date_ms, Date.parse('2026-05-28T00:00:00+08:00'))
  assert.equal(row.plan_notice_date, '2026-05-28')
  assert.equal(row.latest_notice_date, '2026-05-28')
  assert.equal(row.finish_date, '2026-05-27')
  assert.equal(row.price_cap, 1863.67)
  assert.equal(row.plan_shares_lower, 804864)
  assert.equal(row.plan_shares_upper, 1609727)
  assert.equal(row.plan_amount_lower, 1500000000)
  assert.equal(row.plan_amount_upper, 3000000000)
  assert.equal(row.plan_pct_total_lower, 0.064272390284)
  assert.equal(row.done_shares, 2188614)
  assert.equal(row.done_amount, 2999933749.57)
  assert.equal(row.objective, '用于注销并减少公司注册资本')

  const unnamed = await run('eastmoney_buyback', {}, () => dc([{ ...BUYBACK_ROW, REPURPROGRESS: '007' }]))
  assert.equal(unnamed.data.item[0].progress, null, '上游 007/008 没有名字，progress 为 null 而不是瞎猜')
  assert.equal(unnamed.data.item[0].progress_code, '007')
  const map = sourceMap()
  assert.throws(() => map.eastmoney_buyback.normalizeParams({ progress: '007' }), /progress must be one of/)
})

test('eastmoney_pledge：最近统计日默认、万股/万元口径与无限售+限售=合计断言', async () => {
  const { data, requests } = await run('eastmoney_pledge', {}, (_url, count) => (count === 1 ? dc([PLEDGE_ROW]) : dc([PLEDGE_ROW], { pages: 5, count: 2265 })))
  assert.equal(requests[0].searchParams.get('pageSize'), '1', '无过滤时先查最新统计日')
  assert.equal(requests[0].searchParams.get('filter'), null)
  assert.equal(requests[1].searchParams.get('filter'), "(TRADE_DATE='2026-11-20')")
  assert.equal(requests[1].searchParams.get('pageSize'), '100')
  assert.equal(requests[1].searchParams.get('sortColumns'), 'TRADE_DATE,PLEDGE_RATIO,SECURITY_CODE')
  assert.equal(requests[1].searchParams.get('sortTypes'), '-1,-1,1')
  assert.deepEqual(data.pagination, { page: 1, size: 100, pages: 5, total: 2265 })
  const [row] = data.item
  assert.equal(row.thscode, '301015.SZ')
  assert.equal(row.stats_date, '2026-11-20')
  assert.equal(row.stats_date_ms, Date.parse('2026-11-20T00:00:00+08:00'))
  assert.equal(row.industry, '医药商业')
  assert.equal(row.pledge_ratio_pct, 35.24)
  assert.equal(row.pledged_shares_10k, 18522.06)
  assert.equal(row.pledged_market_cap_10k, 411374.9526)
  assert.equal(row.pledge_deal_num, 14)
  assert.equal(row.unrestricted_pledged_10k, 18522.06)
  assert.equal(row.restricted_pledged_10k, 0)
  assert.ok(!('Y1_CLOSE_ADJCHRATE' in row), '未核验口径的列不收录')

  const map = sourceMap()
  assert.throws(() => map.eastmoney_pledge.normalizeParams({ ticker: '920982.BJ' }), /北交所/, '北交所没有质押统计，参数层直接拒绝')
  const ranged = await run('eastmoney_pledge', { start_date: '2026-11-06', end_date: '2026-11-20', page: 1, size: 3 }, () => dc([PLEDGE_ROW]))
  assert.equal(ranged.requests.length, 1, '带日期时不需要额外的最近统计日查询')
  assert.equal(ranged.requests[0].searchParams.get('filter'), "(TRADE_DATE>='2026-11-06')(TRADE_DATE<='2026-11-20')")
  await assert.rejects(
    run('eastmoney_pledge', { start_date: '2026-11-06', end_date: '2026-11-20' }, () => dc([{ ...PLEDGE_ROW, REPURCHASE_LIMITED_BALANCE: 999 }])),
    /unrestricted \+ restricted != total/,
  )
})

test('eastmoney_new_stock：未定价 0/null 都出 null，北交所 board 回退，首日涨跌幅原值', async () => {
  const { data, requests } = await run('eastmoney_new_stock', { start_date: '2026-11-01', end_date: '2026-12-31', page: 1, size: 10 }, () => dc([IPO_ROW]))
  const url = requests[0]
  assert.equal(url.searchParams.get('reportName'), 'RPTA_APP_IPOAPPLY')
  assert.equal(url.searchParams.get('sortColumns'), 'APPLY_DATE,SECURITY_CODE')
  assert.equal(url.searchParams.get('sortTypes'), '-1,-1')
  assert.equal(url.searchParams.get('filter'), "(APPLY_DATE>='2026-11-01')(APPLY_DATE<='2026-12-31')")
  const [row] = data.item
  assert.equal(row.thscode, '920067.BJ')
  assert.equal(row.name, '雅图高新')
  assert.equal(row.apply_code, '920067')
  assert.equal(row.exchange, '北京证券交易所')
  assert.equal(row.board, '北交所', 'MARKET 为 null 时回退 MARKET_TYPE_NEW')
  assert.equal(row.apply_date, '2026-11-14')
  assert.equal(row.apply_date_ms, Date.parse('2026-11-14T00:00:00+08:00'))
  assert.equal(row.ballot_date, '2026-11-18')
  assert.equal(row.pay_date, '2026-11-19')
  assert.equal(row.listing_date, '2026-11-23')
  assert.equal(row.issue_price, 23.52)
  assert.equal(row.issue_shares_10k, 1666.6667)
  assert.equal(row.online_shares, 14166667)
  assert.equal(row.apply_upper_shares, 708300)
  assert.equal(row.top_apply_mktcap_10k, 1665.9216)
  assert.equal(row.win_rate_pct, 0.0289)
  assert.equal(row.first_close_price, null)
  assert.equal(row.first_close_change_pct, null)

  const unpriced = await run('eastmoney_new_stock', {}, () => dc([{ ...IPO_ROW, ISSUE_PRICE: 0, LISTING_DATE: null }]))
  assert.equal(unpriced.data.item[0].issue_price, null, '定价前上游用 null 或 0 占位，都输出 null')
  const missing = await run('eastmoney_new_stock', {}, () => dc([{ ...IPO_ROW, ISSUE_PRICE: null }]))
  assert.equal(missing.data.item[0].issue_price, null)
})

test('空结果与失败分开：9201 是空表，success=false 就是错误', async () => {
  const empty = await run('eastmoney_institution_research', { start_date: '2019-01-01', end_date: '2019-01-02' }, () => dcEmpty)
  assert.deepEqual(empty.data.item, [], '上游 9201 是数据缺口，返回空 item')
  assert.deepEqual(empty.data.pagination, { page: 1, size: 100, pages: 0, total: 0 })
  await assert.rejects(
    run('eastmoney_institution_research', { start_date: '2026-11-01', end_date: '2026-11-21' }, () => ({ success: false, code: 9501, message: 'REPORT_DATE排序列不存在' })),
    /failed: REPORT_DATE排序列不存在/,
    'success=false 不能被当成空结果吞掉',
  )
  await assert.rejects(
    run('eastmoney_new_stock', {}, () => ({ success: true, code: 0, result: { data: 'not-an-array', pages: 1, count: 1 } })),
    /result shape changed/,
  )
})

test('非法参数在参数层拒绝（不发请求）', () => {
  const map = sourceMap()
  const reject = (capability, params, pattern) => assert.throws(() => map[capability].normalizeParams(params), pattern)
  reject('eastmoney_security_profile', { ticker: '60051' }, /six-digit/)
  reject('eastmoney_security_profile', { ticker: '600519', market: 'SH' }, /unsupported parameter/)
  reject('eastmoney_institution_research', { start_date: '2026-11-01' }, /together/)
  reject('eastmoney_institution_research', { start_date: '2026-11-21', end_date: '2026-11-01' }, /must not be later/)
  reject('eastmoney_institution_research', { start_date: '2026-02-30', end_date: '2026-03-01' }, /valid YYYY-MM-DD/)
  reject('eastmoney_institution_research', { size: 501 }, /size must be an integer/)
  reject('eastmoney_institution_research', { page: 0 }, /page must be an integer/)
  reject('eastmoney_holder_change', { ticker: '000001.SH' }, /conflicts with the A-share code prefix/)
  reject('eastmoney_pledge', { ticker: '920982' }, /北交所/)
  reject('eastmoney_new_stock', { code: '920067' }, /unsupported parameter/)
})
