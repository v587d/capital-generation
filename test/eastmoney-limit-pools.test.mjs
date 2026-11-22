import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEastmoneySources } from '../lib/sources/eastmoney-http.js'
import { outputSchemaViolations } from './output-contract.mjs'

const signal = new AbortController().signal
const session = { id: 'session-1', header: { cwd: '/workspace/proj' } }
const sources = Object.fromEntries(createEastmoneySources().map((source) => [source.schema.capability, source]))

const NEW_CAPABILITIES = [
  'eastmoney_limit_up_pool',
  'eastmoney_limit_break_pool',
  'eastmoney_limit_down_pool',
  'eastmoney_yesterday_limit_up_pool',
  'eastmoney_price_anomaly_list',
  'eastmoney_price_anomaly_count',
  'eastmoney_stock_hot_concepts',
]

function response(payload, status = 200) {
  return { status, json: async () => payload }
}

async function withFetch(handler, run) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = handler
  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

/** §9.5/§9.6：宿主逐次校验 output.schema 与无损 JSON；直调 execute 绕过宿主，所以这里补同款断言。 */
function assertLosslessJson(value) {
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value, '返回值必须是无损 JSON：undefined/NaN/空洞会被宿主整次拒绝')
}

async function execute(capability, params) {
  const result = await sources[capability].execute({ capability, params, session }, signal)
  assertLosslessJson(result.data)
  const violations = outputSchemaViolations(sources[capability].schema.output_schema, result.data)
  assert.deepEqual(violations, [], `${capability} 返回值不满足自己声明的 output.schema：\n${violations.join('\n')}`)
  return result
}

function normalized(capability, params) {
  return sources[capability].normalizeParams(params)
}

// ---------- 注册与归一化 ----------

test('七个东财 push2ex / dycalchis / emappdata 能力已注册，身份与描述齐全', () => {
  for (const capability of NEW_CAPABILITIES) {
    const source = sources[capability]
    assert.ok(source, `${capability} 必须已注册`)
    assert.match(source.schema.name, /^get_eastmoney_/)
    assert.equal(source.schema.source_label, 'eastmoney')
    assert.match(source.schema.data_key, /^eastmoney\.http\./)
    assert.ok(source.schema.description.length > 300, `${capability} 的 description 要写清口径与坑`)
    assert.ok(source.schema.output_schema)
    assert.ok(source.schema.input_schema)
  }
  // 与 Fuyao/同花顺口径必须写清不可混
  for (const capability of NEW_CAPABILITIES.slice(0, 4)) {
    assert.match(sources[capability].schema.description, /Fuyao/)
    assert.match(sources[capability].schema.description, /不可混|不可比|不可拼接/)
  }
  assert.match(sources.eastmoney_price_anomaly_list.schema.description, /t 是浮点|t 是\*\*窗口内异动次数|t=异动次数|t 是\*\*窗口内异动次数/)
  assert.match(sources.eastmoney_price_anomaly_count.schema.description, /异动次数/)
  assert.match(sources.eastmoney_stock_hot_concepts.schema.description, /index_membership_by_stock/)
  assert.match(sources.eastmoney_limit_down_pool.schema.description, /fba|board_amount/)
})

test('参数归一化幂等（第二遍输入就是第一遍输出，键名不改）（§10.7）', () => {
  const cases = {
    eastmoney_limit_up_pool: { trade_date: '2026-11-20' },
    eastmoney_limit_break_pool: { trade_date: '2026-11-20' },
    eastmoney_limit_down_pool: { trade_date: '2026-11-20' },
    eastmoney_yesterday_limit_up_pool: { trade_date: '2026-11-20' },
    eastmoney_price_anomaly_list: { page_size: 20, page_no: 2, date: '2026-11-20' },
    eastmoney_price_anomaly_count: { page_size: 20, page_no: 2, sort_key: 'times', sort_dir: 'asc' },
    eastmoney_stock_hot_concepts: { ticker: '600519' },
  }
  for (const [capability, params] of Object.entries(cases)) {
    const once = normalized(capability, params)
    const twice = normalized(capability, once)
    assert.deepEqual(twice, once, `${capability} 第二遍归一化必须幂等`)
    assert.deepEqual(Object.keys(once).sort(), Object.keys(twice).sort(), `${capability} 键名不许改`)
  }
  assert.equal(normalized('eastmoney_stock_hot_concepts', { ticker: '600519' }).ticker, '600519.SH')
  assert.equal(normalized('eastmoney_stock_hot_concepts', { ticker: 'SH600519' }).ticker, '600519.SH')
  assert.equal(normalized('eastmoney_stock_hot_concepts', { ticker: '920575' }).ticker, '920575.BJ')
  assert.equal(normalized('eastmoney_price_anomaly_list', {}).page_size, 200)
  assert.equal(normalized('eastmoney_price_anomaly_count', {}).page_size, 50)
})

test('非法参数在发请求之前拒绝（不落盘、不出网）', async () => {
  let called = false
  await withFetch(async () => { called = true; return response({}) }, async () => {
    const rejects = [
      ['eastmoney_limit_up_pool', {}, /trade_date must be YYYY-MM-DD/],
      ['eastmoney_limit_up_pool', { trade_date: '20261120' }, /trade_date must be YYYY-MM-DD/],
      ['eastmoney_limit_up_pool', { trade_date: '2026-11-20', page: 1 }, /unsupported parameter: page/],
      ['eastmoney_limit_up_pool', { trade_date: '2999-01-01' }, /in the future/],
      ['eastmoney_price_anomaly_list', { page_size: 501 }, /page_size must be an integer/],
      ['eastmoney_price_anomaly_list', { date: '2999-01-01' }, /in the future/],
      ['eastmoney_price_anomaly_list', { sort_key: 'times' }, /unsupported parameter/],
      ['eastmoney_price_anomaly_count', { sort_key: 'bogus' }, /sort_key must be one of/],
      ['eastmoney_price_anomaly_count', { sort_dir: 'sideways' }, /sort_dir must be desc or asc/],
      ['eastmoney_stock_hot_concepts', { ticker: '60051' }, /six-digit A-share code/],
      ['eastmoney_stock_hot_concepts', { ticker: '000001.SH' }, /conflicts with the A-share code prefix/],
    ]
    for (const [capability, params, pattern] of rejects) {
      await assert.rejects(() => execute(capability, params), pattern, `${capability} ${JSON.stringify(params)}`)
    }
    assert.equal(called, false, '非法参数属于本地错误：不发请求')
  })
})

// ---------- A. push2ex 四池 ----------

const ztRaw = (over = {}) => ({
  c: '603324', m: 1, n: '盛剑科技', p: 27710, zdp: 10.0039701461792, amount: 673088896,
  ltsz: 4042291018.2, tshare: 4183747797.2, hs: 17.143342971801758, lbc: 4,
  fbt: 92501, lbt: 140749, fund: 43397739, zbc: 4, hybk: '环保设备', zttj: { days: 4, ct: 4 },
  ...over,
})
const poolPayload = (pool, over = {}) => ({ rc: 0, data: { tc: pool.length, qdate: 20261120, pool, ...over } })

test('eastmoney_limit_up_pool：÷1000 价、HHMMSS 封板时间、zttj 与连板数分开，单次取满不翻页', async () => {
  let requested
  let headers
  await withFetch(async (url, init) => {
    requested = new URL(url)
    headers = init?.headers
    return response(poolPayload([ztRaw(), ztRaw({ c: '002771', m: 0, n: '真视通', p: 15820, fbt: 93021, lbt: 93021, fund: 159198083, zbc: 0, lbc: 1, zttj: { days: 1, ct: 1 }, hybk: 'IT服务Ⅱ' })]))
  }, async () => {
    const { data, schema } = await execute('eastmoney_limit_up_pool', { trade_date: '2026-11-20' })
    assert.equal(requested.origin + requested.pathname, 'https://push2ex.eastmoney.com/getTopicZTPool')
    assert.equal(requested.searchParams.get('ut'), '7eea3edcaed734bea9cbfc24409ed989')
    assert.equal(requested.searchParams.get('dpt'), 'wz.ztzt')
    assert.equal(requested.searchParams.get('Pageindex'), '0')
    assert.equal(requested.searchParams.get('pagesize'), '10000', '一次 pagesize=10000 取满，不翻页')
    assert.equal(requested.searchParams.get('sort'), 'fbt:asc')
    assert.equal(requested.searchParams.get('date'), '20261120', 'trade_date 由本层转 YYYYMMDD')
    assert.equal(headers.referer, 'https://quote.eastmoney.com/')

    assert.equal(data.trade_date, '2026-11-20')
    assert.equal(data.server_latest_trade_date, '2026-11-20')
    assert.equal(data.requested_date_clamped, false)
    assert.equal(data.available, true)
    assert.equal(data.row_count, 2)
    assert.equal(data.upstream_total, 2)

    const [row] = data.item
    assert.equal(row.thscode, '603324.SH')
    assert.equal(row.code, '603324')
    assert.equal(row.market, 'SH')
    assert.equal(row.price, 27.71, '上游 ×1000 整数必须 ÷1000')
    assert.equal(row.change_pct, 10.0039701461792, '百分数原值，不四舍五入')
    assert.equal(row.turnover_rate_pct, 17.143342971801758)
    assert.equal(row.limit_days, 4, 'lbc 是连板数')
    assert.equal(row.first_seal, '09:25:01', 'fbt 是 HHMMSS 整数不是 Unix 秒')
    assert.equal(row.last_seal, '14:07:49')
    assert.equal(row.seal_fund, 43397739, '封板资金（元）')
    assert.equal(row.break_times, 4)
    assert.equal(row.industry, '环保设备')
    assert.equal(row.zt_stat, '4天4板')
    assert.equal(row.zt_stat_days, 4)
    assert.equal(row.zt_stat_boards, 4)
    assert.equal(data.item[1].market, 'SZ', 'm=0 时市场由代码号段决定')
    assert.equal(data.item[1].first_seal, '09:30:21')
    // 行键是整个 output_schema 的 properties 集合，不许多也不许少（§9.6）
    const rowProperties = Object.keys(schema.properties.item.items.properties).sort()
    assert.deepEqual(Object.keys(row).sort(), rowProperties)
    assert.ok(!('c' in row) && !('p' in row) && !('zdp' in row) && !('zttj' in row), '上游缩写不许原样透传')
  })
})

test('eastmoney_limit_up_pool：zttj 的「N天M板」与 lbc 连板数不等价（实测 002548 lbc=1 而 zttj={6,3}）', async () => {
  await withFetch(async () => response(poolPayload([ztRaw({ c: '002548', m: 0, n: '金新农', p: 4500, lbc: 1, zttj: { days: 6, ct: 3 } })])), async () => {
    const { data } = await execute('eastmoney_limit_up_pool', { trade_date: '2026-11-20' })
    assert.equal(data.item[0].limit_days, 1)
    assert.equal(data.item[0].zt_stat, '6天3板')
    assert.equal(data.item[0].zt_stat_days, 6)
    assert.equal(data.item[0].zt_stat_boards, 3)
  })
})

test('eastmoney_limit_up_pool：非交易日/超保留窗口的空池是合法空，不是失败', async () => {
  await withFetch(async () => response({ rc: 0, data: { tc: 0, qdate: 20261120, pool: [] } }), async () => {
    const { data } = await execute('eastmoney_limit_up_pool', { trade_date: '2026-11-14' })
    assert.deepEqual(data.item, [])
    assert.equal(data.available, false)
    assert.equal(data.row_count, 0)
    assert.equal(data.upstream_total, 0)
    assert.match(data.note, /空池不是取数失败/)
    assert.match(data.note, /保留窗口/)
  })
})

test('eastmoney_limit_up_pool：rc!=0 是上游拒绝，空/坏形状不许装成空结果', async () => {
  await withFetch(async () => response({ rc: 102, data: null }), async () => {
    await assert.rejects(() => execute('eastmoney_limit_up_pool', { trade_date: '2026-11-20' }), /rc=102/)
  })
  await withFetch(async () => response({ rc: 0, data: null }), async () => {
    await assert.rejects(() => execute('eastmoney_limit_up_pool', { trade_date: '2026-11-20' }), /without a data object/)
  })
})

test('eastmoney_limit_up_pool：行数 < tc、重复代码、m 与代码号段矛盾都响亮失败', async () => {
  await withFetch(async () => response(poolPayload([ztRaw()], { tc: 3 })), async () => {
    await assert.rejects(() => execute('eastmoney_limit_up_pool', { trade_date: '2026-11-20' }), /returned 1 of 3 rows/)
  })
  await withFetch(async () => response(poolPayload([ztRaw(), ztRaw()])), async () => {
    await assert.rejects(() => execute('eastmoney_limit_up_pool', { trade_date: '2026-11-20' }), /duplicate code 603324/)
  })
  await withFetch(async () => response(poolPayload([ztRaw({ m: 0 })])), async () => {
    await assert.rejects(() => execute('eastmoney_limit_up_pool', { trade_date: '2026-11-20' }), /market code 0 .* code range is SH/)
  })
  await withFetch(async () => response(poolPayload([ztRaw({ p: 27710.5 })])), async () => {
    await assert.rejects(() => execute('eastmoney_limit_up_pool', { trade_date: '2026-11-20' }), /non-integer p/)
  })
})

test('eastmoney_limit_up_pool：请求日晚于最近交易日时上游夹日期，用 clamped + latest 标出真实归属日', async () => {
  await withFetch(async () => response(poolPayload([ztRaw()])), async () => {
    const { data } = await execute('eastmoney_limit_up_pool', { trade_date: '2026-11-22' })
    assert.equal(data.requested_date_clamped, true)
    assert.equal(data.server_latest_trade_date, '2026-11-20')
    assert.equal(data.trade_date, '2026-11-22', '参数值照存，真实归属日另给')
    assert.match(data.note, /本批行属于 2026-11-20/)
  })
})

const zbRaw = (over = {}) => ({
  c: '003007', m: 0, n: '直真科技', p: 32260, ztp: 35860, zdp: -1.0429447889328003,
  amount: 299671008, ltsz: 2914436113.74, tshare: 3857471498.92, hs: 9.71584701538086,
  fbt: 93454, zbc: 1, zf: 13.865031242370605, zs: 0, zttj: { days: 0, ct: 0 }, hybk: '软件开发',
  ...over,
})

test('eastmoney_limit_break_pool：涨停价 ÷1000、振幅/涨速为百分数原值、zttj 允许 0天0板', async () => {
  let requested
  await withFetch(async (url) => {
    requested = new URL(url)
    return response(poolPayload([zbRaw()]))
  }, async () => {
    const { data, schema } = await execute('eastmoney_limit_break_pool', { trade_date: '2026-11-20' })
    assert.equal(requested.origin + requested.pathname, 'https://push2ex.eastmoney.com/getTopicZBPool')
    assert.equal(requested.searchParams.get('sort'), 'fbt:asc')
    assert.equal(requested.searchParams.get('date'), '20261120')
    const [row] = data.item
    assert.equal(row.price, 32.26)
    assert.equal(row.limit_price, 35.86, 'ztp 涨停价同样 ×1000 必须 ÷1000')
    assert.equal(row.change_pct, -1.0429447889328003)
    assert.equal(row.amplitude_pct, 13.865031242370605)
    assert.equal(row.speed_pct, 0, '收盘后 zs 实测恒为 0，原值保留')
    assert.equal(row.first_seal, '09:34:54')
    assert.equal(row.break_times, 1)
    assert.equal(row.zt_stat, '0天0板')
    assert.equal(row.industry, '软件开发')
    assert.deepEqual(Object.keys(row).sort(), Object.keys(schema.properties.item.items.properties).sort())
  })
})

const dtRaw = (over = {}) => ({
  c: '605255', m: 1, n: '天普股份', p: 59800, zdp: -9.993979454040527, amount: 8443760,
  ltsz: 8017984000, tshare: 8017984000, pe: -377.4160461425781, hs: 0.10531026124954224,
  fund: 90100660, lbt: 92500, fba: 249814500, days: 2, oc: 0, hybk: '汽车零部',
  ...over,
})

test('eastmoney_limit_down_pool：fund=封单资金、days=连续跌停、oc=开板次数、lbt=末次封板', async () => {
  let requested
  await withFetch(async (url) => {
    requested = new URL(url)
    return response(poolPayload([dtRaw(), dtRaw({ c: '603037', n: '凯众股份', p: 9560, amount: 194071914, fund: 157309, fba: 4827799, days: 2, oc: 2, lbt: 150000, pe: 52.58, hybk: '汽车零部' })]))
  }, async () => {
    const { data, schema } = await execute('eastmoney_limit_down_pool', { trade_date: '2026-11-20' })
    assert.equal(requested.origin + requested.pathname, 'https://push2ex.eastmoney.com/getTopicDTPool')
    assert.equal(requested.searchParams.get('sort'), 'fund:asc')
    const [row] = data.item
    assert.equal(row.seal_fund, 90100660, 'fund 是封单资金（元）')
    assert.equal(row.limit_down_days, 2, 'days 是连续跌停天数')
    assert.equal(row.open_times, 0, 'oc 是开板次数')
    assert.equal(row.last_seal, '09:25:00', 'lbt 是末次封板 HHMMSS')
    assert.equal(row.pe, -377.4160461425781, '动态市盈率可为负')
    assert.equal(row.board_amount, 249814500, 'fba 收录但口径不可靠：原值输出，描述里禁止当成交额用')
    assert.ok(row.board_amount > row.amount, '实测存在 fba > amount 的行，必须原值通过而不是静默改数')
    assert.equal(data.item[1].last_seal, '15:00:00')
    assert.deepEqual(Object.keys(row).sort(), Object.keys(schema.properties.item.items.properties).sort())
    assert.ok(!('zt_stat' in row), '跌停池没有 zttj，不许给空 mock 字段')
  })
})

const yzRaw = (over = {}) => ({
  c: '000656', m: 0, n: '金科股份', p: 1040, ztp: 1120, zdp: 1.9607844352722168,
  amount: 832661024, ltsz: 9760777683.28, tshare: 11012280913.92, hs: 8.330974578857422,
  zf: 8.823529243469238, zs: 0, yfbt: 131351, ylbc: 1, hybk: '房地产开', zttj: { days: 2, ct: 1 },
  ...over,
})

test('eastmoney_yesterday_limit_up_pool：y_ 前缀字段不能与涨停池复用解析（无 fbt/lbt/lbc 也必须成功）', async () => {
  let requested
  await withFetch(async (url) => {
    requested = new URL(url)
    // 故意只给 y_ 前缀列：若复用涨停池 parser，first_seal/last_seal 会是 null 且 y 列被丢弃
    return response(poolPayload([yzRaw()]))
  }, async () => {
    const { data, schema } = await execute('eastmoney_yesterday_limit_up_pool', { trade_date: '2026-11-20' })
    assert.equal(requested.origin + requested.pathname, 'https://push2ex.eastmoney.com/getYesterdayZTPool')
    assert.equal(requested.searchParams.get('sort'), 'zs:desc')
    const [row] = data.item
    assert.equal(row.yesterday_first_seal, '13:13:51', 'yfbt 是昨日最后封板时间')
    assert.equal(row.yesterday_limit_days, 1, 'ylbc 是昨日连板数')
    assert.equal(row.limit_price, 1.12, 'ztp 是今日涨停价')
    assert.equal(row.change_pct, 1.9607844352722168, 'zdp 是今日涨跌幅')
    assert.equal(row.amplitude_pct, 8.823529243469238)
    assert.equal(row.speed_pct, 0)
    assert.equal(row.zt_stat, '2天1板')
    assert.ok(!('first_seal' in row) && !('last_seal' in row) && !('limit_days' in row), '本池不输出今日封板字段，y_ 列映射到独立字段')
    assert.deepEqual(Object.keys(row).sort(), Object.keys(schema.properties.item.items.properties).sort())
  })
})

test('eastmoney_limit_up_pool：解析器不读 y_ 前缀列（跨池串行防护）', async () => {
  await withFetch(async () => response(poolPayload([ztRaw({ fbt: undefined, lbt: undefined, yfbt: 131351, ylbc: 9 })])), async () => {
    const { data } = await execute('eastmoney_limit_up_pool', { trade_date: '2026-11-20' })
    assert.equal(data.item[0].first_seal, null, 'yfbt 不许被涨停池当成 fbt')
    assert.equal(data.item[0].last_seal, null)
    assert.ok(!('yesterday_first_seal' in data.item[0]))
  })
})

// ---------- B. dycalchis 异动 ----------

const anomalyListPayload = (rows, over = {}) => ({ result: 0, msg: '', pages: 1, date: 20261120, open: 0, count: rows.length, data: rows, ...over })
const listRaw = (over = {}) => ({ m: 1, c: '688033', n: '*ST天宜', s: 5, e: 5, x: -42.82, d: 9, t: -13.02, a: -7.21, o: 2, ...over })

test('eastmoney_price_anomaly_list：H5 固定参数、规则码/累计偏离/统计窗口映射、空 vs 失败', async () => {
  let requested
  await withFetch(async (url) => {
    requested = new URL(url)
    return response(anomalyListPayload([listRaw(), listRaw({ m: 0, c: '301391', n: '卡莱特', s: 4, e: 4, x: 66.76, d: 4, t: 11.13, a: -8.11, o: 0 })]))
  }, async () => {
    const { data, schema } = await execute('eastmoney_price_anomaly_list', {})
    assert.equal(requested.origin + requested.pathname, 'https://dycalchis.eastmoney.com/price-anomaly/list')
    for (const [key, value] of Object.entries({ team: 'h5', product: 'EastMoney', client: 'WAP', version: '9001', name: 'WAP', user: '123' })) {
      assert.equal(requested.searchParams.get(key), value, `固定 H5 参数 ${key} 缺失会被上游回 1001 unknow team`)
    }
    assert.equal(requested.searchParams.get('pageSize'), '200')
    assert.equal(requested.searchParams.get('pageNo'), '1')
    assert.equal(requested.searchParams.get('date'), null, '不传 date 时不要伪造参数')

    assert.equal(data.data_date, '2026-11-20', '响应 date 是业务所属日，不是请求日')
    assert.equal(data.available, true)
    assert.equal(data.row_count, 2)
    assert.deepEqual(data.pagination, { page: 1, size: 200, pages: 1 })

    const [first, second] = data.item
    assert.equal(first.thscode, '688033.SH')
    assert.equal(first.market, 'SH', 'm=1 → SH')
    assert.equal(first.board_code, 5, '板块码 s 原值：实测 5=科创板')
    assert.equal(first.rule_code, 5)
    assert.match(first.rule, /偏离值累计达到-50%/, '12 条规则中文名能对上就收')
    assert.equal(first.change_pct, -7.21, 'a 是当日涨跌幅')
    assert.equal(first.change_target_pct, -13.02, 'list 的 t 是浮点「涨跌幅目标值」')
    assert.equal(first.deviation_pct, -42.82, 'x 是累计偏离 %')
    assert.equal(first.window_days, 9, 'd 是统计窗口天数')
    assert.equal(first.is_today, false, 'o=2 记为非今日')
    assert.equal(first.status_code, 2)
    assert.ok(!('anomaly_times' in first), 'list 行不许出现 count 的异动次数字段')

    assert.equal(second.thscode, '301391.SZ')
    assert.equal(second.market, 'SZ', 'm=0 同时代表深市与北交所：市场只能按代码号段判')
    assert.equal(second.rule_code, 4)
    assert.equal(second.is_today, true)
    assert.deepEqual(Object.keys(first).sort(), Object.keys(schema.properties.item.items.properties).sort())
  })
})

test('eastmoney_price_anomaly_list：s==6 且 e∈{4,5,6,7} 时按 e*10 取更严阈值那档', async () => {
  await withFetch(async () => response(anomalyListPayload([
    listRaw({ s: 6, e: 5 }),
    listRaw({ c: '688981', n: '中芯国际', s: 6, e: 7 }),
    listRaw({ c: '300949', n: '奥雅股份', m: 0, s: 4, e: 6 }),
  ])), async () => {
    const { data } = await execute('eastmoney_price_anomaly_list', {})
    assert.equal(data.item[0].board_code, 6)
    assert.equal(data.item[0].rule_code, 50, 's=6/e=5 → 50（更严档）')
    assert.match(data.item[0].rule, /-60%/)
    assert.equal(data.item[1].rule_code, 70)
    assert.match(data.item[1].rule, /-75%/)
    assert.equal(data.item[2].rule_code, 6, 's!=6 不做 e*10 换算')
  })
})

test('eastmoney_price_anomaly_list：result!=0 正向抛错，绝不当成「今天没异动」', async () => {
  await withFetch(async () => response({ result: 1001, msg: 'unknow team', date: 0, count: 0, data: [] }), async () => {
    await assert.rejects(() => execute('eastmoney_price_anomaly_list', {}), /result=1001 .*unknow team/)
  })
  await withFetch(async () => response(anomalyListPayload([listRaw()], { count: 5 })), async () => {
    await assert.rejects(() => execute('eastmoney_price_anomaly_list', {}), /reports count=5 but returned 1 rows/)
  })
})

test('eastmoney_price_anomaly_list：空 data 合法空；date 断言——早于业务日响亮失败、晚于用 clamped 标出', async () => {
  await withFetch(async () => response({ result: 0, msg: '', pages: 1, date: 20261120, open: 0, count: 0, data: [] }), async () => {
    const { data } = await execute('eastmoney_price_anomaly_list', {})
    assert.deepEqual(data.item, [])
    assert.equal(data.available, false)
    assert.match(data.note, /合法空/)
  })
  await withFetch(async () => response(anomalyListPayload([listRaw()])), async () => {
    await assert.rejects(
      () => execute('eastmoney_price_anomaly_list', { date: '2026-11-18' }),
      (error) => {
        assert.equal(error.code, 'eastmoney_no_anomaly_data', '上游拿不到历史：数据缺口要响亮失败')
        return /only serves the latest business day/.test(error.message)
      },
    )
    const same = await execute('eastmoney_price_anomaly_list', { date: '2026-11-20' })
    assert.equal(same.data.requested_date_clamped, false)
    assert.equal(same.data.requested_date, '2026-11-20')
    const later = await execute('eastmoney_price_anomaly_list', { date: '2026-11-22' })
    assert.equal(later.data.requested_date_clamped, true)
    assert.equal(later.data.data_date, '2026-11-20')
    assert.match(later.data.note, /上游忽略 date/)
  })
})

const countRaw = (over = {}) => ({ m: 1, c: '603324', n: '盛剑科技', s: 1, p: 27.71, a: 10, t: 2, x: 48.29, d: 4, ...over })
const anomalyCountPayload = (rows, over = {}) => ({ result: 0, msg: '', pages: 1, date: 20261120, open: 0, count: rows.length, data: rows, ...over })

test('eastmoney_price_anomaly_count：t 是整数异动次数（与 list 的浮点 t 不同义），本地排序生效', async () => {
  let requested
  await withFetch(async (url) => {
    requested = new URL(url)
    return response(anomalyCountPayload([countRaw(), countRaw({ m: 0, c: '002148', n: '北纬科技', p: 10.06, a: 8.17, t: 3, x: 82.65, d: 9 })]))
  }, async () => {
    const { data, schema } = await execute('eastmoney_price_anomaly_count', {})
    assert.equal(requested.origin + requested.pathname, 'https://dycalchis.eastmoney.com/price-anomaly/count')
    assert.equal(requested.searchParams.get('pageSize'), '50', 'count 端点默认 50')
    assert.equal(data.data_date, '2026-11-20')
    assert.deepEqual(data.pagination, { page: 1, size: 50, pages: 1 })
    const [row] = data.item
    assert.equal(row.anomaly_times, 2, 'count 的 t 是整数异动次数')
    assert.equal(row.price, 27.71)
    assert.equal(row.change_pct, 10)
    assert.equal(row.deviation_pct, 48.29)
    assert.equal(row.window_days, 4)
    assert.ok(!('change_target_pct' in row), 'count 行不许出现 list 的涨跌幅目标字段')
    assert.deepEqual(Object.keys(row).sort(), Object.keys(schema.properties.item.items.properties).sort())

    const asc = await execute('eastmoney_price_anomaly_count', { sort_key: 'deviation_pct', sort_dir: 'asc', page_size: 10, page_no: 2 })
    assert.deepEqual(asc.data.item.map((item) => item.deviation_pct), [48.29, 82.65], '本地按 deviation_pct 升序')
    assert.deepEqual(asc.data.pagination, { page: 2, size: 10, pages: 1 })
    assert.equal(requested.searchParams.get('sortKey'), 'x', 'sort_key 映射成上游字母列名')
    assert.equal(requested.searchParams.get('sortDir'), 'asc')
    assert.match(asc.data.note, /本地对本页执行/)
  })
  // 排序参数照样会传给上游（无害），但顺序由本地保证
  await withFetch(async (url) => {
    requested = new URL(url)
    return response(anomalyCountPayload([countRaw(), countRaw({ m: 0, c: '002148', n: '北纬科技', p: 10.06, a: 8.17, t: 3, x: 82.65, d: 9 })]))
  }, async () => {
    const desc = await execute('eastmoney_price_anomaly_count', { sort_key: 'deviation_pct', sort_dir: 'desc' })
    assert.deepEqual(desc.data.item.map((row) => row.deviation_pct), [82.65, 48.29])
    assert.equal(requested.searchParams.get('sortKey'), 'x')
    assert.equal(requested.searchParams.get('sortDir'), 'desc')
  })
})

test('eastmoney_price_anomaly_count：t 非整数响亮失败（两函数同名字母不许复用解析）', async () => {
  await withFetch(async () => response(anomalyCountPayload([countRaw({ t: 2.5 })])), async () => {
    await assert.rejects(() => execute('eastmoney_price_anomaly_count', {}), /non-integer t/)
  })
})

// ---------- C. emappdata 概念命中 ----------

test('eastmoney_stock_hot_concepts：POST 大写前缀 srcSecurityCode、hitCount 降序、calcTime 时间轴', async () => {
  let requested
  let init
  await withFetch(async (url, request) => {
    requested = new URL(url)
    init = request
    return response({
      globalId: '786e4c21-70dc-435a-93bb-38', message: 'OK', status: 0, code: 0, stack: null,
      data: [
        { calcTime: '2026-11-22 17:00:00', srcSecurityCode: 'SH600519', conceptName: '茅指数', conceptId: 'BK0999', hitCount: 107, flag: 0 },
        { calcTime: '2026-11-22 17:00:00', srcSecurityCode: 'SH600519', conceptName: '白酒', conceptId: 'BK0896', hitCount: 6176, flag: 0 },
      ],
    })
  }, async () => {
    const { data, schema } = await execute('eastmoney_stock_hot_concepts', { ticker: '600519' })
    assert.equal(requested.origin + requested.pathname, 'https://emappdata.eastmoney.com/stockrank/getHotStockRankList')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers['content-type'], 'application/json')
    const body = JSON.parse(init.body)
    assert.deepEqual(body, { appId: 'appId01', globalId: '786e4c21-70dc-435a-93bb-38', srcSecurityCode: 'SH600519' }, '大写 SH/SZ/BJ 前缀 + 6 位代码，必须是请求票本身')
    assert.equal(data.thscode, '600519.SH')
    assert.equal(data.src_security_code, 'SH600519')
    assert.equal(data.available, true)
    assert.equal(data.calculated_at, '2026-11-22 17:00:00')
    assert.equal(data.calculated_at_ms, Date.parse('2026-11-22T17:00:00+08:00'))
    assert.deepEqual(data.item, [
      { concept_name: '白酒', concept_code: 'BK0896', hit_count: 6176 },
      { concept_name: '茅指数', concept_code: 'BK0999', hit_count: 107 },
    ], '本地再按热度降序，不依赖上游顺序')
    assert.deepEqual(Object.keys(data.item[0]).sort(), Object.keys(schema.properties.item.items.properties).sort())
  })
})

test('eastmoney_stock_hot_concepts：北交所号段→BJ 前缀，空 data 是合法空', async () => {
  let body
  await withFetch(async (url, init) => {
    body = JSON.parse(init.body)
    return response({ globalId: '786e4c21-70dc-435a-93bb-38', message: 'OK', status: 0, code: 0, data: [], stack: null })
  }, async () => {
    const { data } = await execute('eastmoney_stock_hot_concepts', { ticker: '920575' })
    assert.equal(body.srcSecurityCode, 'BJ920575', '4/8/92 号段→BJ，不许按首位猜沪深')
    assert.equal(data.market, 'BJ')
    assert.deepEqual(data.item, [])
    assert.equal(data.available, false)
    assert.match(data.note, /合法空/)
    assert.equal(data.calculated_at, null)
  })
})

test('eastmoney_stock_hot_concepts：code!=0 与 srcSecurityCode 不一致都响亮失败', async () => {
  await withFetch(async () => response({ globalId: null, message: 'srcSecurityCode 股票代码不能为空', status: -1, code: -1, data: null }), async () => {
    await assert.rejects(() => execute('eastmoney_stock_hot_concepts', { ticker: '600519' }), /code -1/)
  })
  await withFetch(async () => response({
    globalId: '786e4c21-70dc-435a-93bb-38', message: 'OK', status: 0, code: 0,
    data: [{ calcTime: '2026-11-22 17:00:00', srcSecurityCode: 'SZ000001', conceptName: '白酒', conceptId: 'BK0896', hitCount: 1, flag: 0 }],
  }), async () => {
    await assert.rejects(() => execute('eastmoney_stock_hot_concepts', { ticker: '600519' }), /returned SZ000001 for requested SH600519/)
  })
})

// ---------- guard ----------

test('validateOutput guard：七能力的分支与坏形状', () => {
  const poolEnvelope = (over = {}) => ({ item: [], trade_date: '2026-11-20', server_latest_trade_date: '2026-11-20', requested_date_clamped: false, available: false, row_count: 0, upstream_total: 0, note: null, ...over })
  for (const capability of NEW_CAPABILITIES.slice(0, 4)) {
    const guard = sources[capability].validateOutput
    assert.equal(guard(poolEnvelope()), true)
    assert.equal(guard(poolEnvelope({ row_count: 1 })), false, 'row_count 与行数不一致必须拦')
    assert.equal(guard(poolEnvelope({ item: 'nope' })), false)
    assert.equal(guard(null), false)
  }
  const anomaly = sources.eastmoney_price_anomaly_list.validateOutput
  assert.equal(anomaly({ item: [], data_date: '2026-11-20', requested_date: null, requested_date_clamped: false, available: false, row_count: 0, pagination: { page: 1, size: 200, pages: 1 }, note: null }), true)
  assert.equal(anomaly({ item: [] }), false)
  const concept = sources.eastmoney_stock_hot_concepts.validateOutput
  assert.equal(concept({ item: [], thscode: '600519.SH', ticker: '600519', market: 'SH', src_security_code: 'SH600519', calculated_at: null, calculated_at_ms: null, available: false, note: null }), true)
  assert.equal(concept({ item: null }), false)
  // 复刻事故形态（§9.6）：多返回一个未声明字段同样致命，闸门必须变红
  const withExtra = { ...poolEnvelope(), extra_undeclared: 1 }
  assert.notDeepEqual(outputSchemaViolations(sources.eastmoney_limit_up_pool.schema.output_schema, withExtra), [])
  const withRowExtra = { ...poolEnvelope(), item: [{ code: '603324', undeclared: true }] }
  assert.notDeepEqual(outputSchemaViolations(sources.eastmoney_limit_up_pool.schema.output_schema, withRowExtra), [])
})

test('输出行键一律 ASCII snake_case（§10.6 不原样透传上游缩写）', () => {
  for (const capability of NEW_CAPABILITIES) {
    const rowProperties = sources[capability].schema.output_schema.properties.item.items.properties
    for (const key of Object.keys(rowProperties)) {
      assert.match(key, /^[a-z][a-z0-9_]*$/, `${capability} 行键 ${key} 必须是 ASCII snake_case`)
    }
  }
})
