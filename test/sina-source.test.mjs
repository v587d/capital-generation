import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSinaSources } from '../lib/sources/sina-http.js'
import { outputSchemaViolations } from './output-contract.mjs'

const session = { id: 'sina-source-test', header: { cwd: '/workspace/project' } }
const signal = new AbortController().signal

// Real hq.sinajs.cn GBK bytes captured 2026-11-22 (Friday close snapshot). Keeping the raw bytes is
// the only way to prove the TextDecoder('gbk') path: a UTF-8 mock would mojibake the Chinese names.
const CON_OP_GBK = Uint8Array.from(Buffer.from(
  'dmFyIGhxX3N0cl9DT05fT1BfMTAwMTI2Mzk9IjEsMC4xOTIyLDAuMTk2MCwwLjE5NjAsMSw1MjQ3LC0xNS44OCwyLjY1MDAsMC4yMDgzLDAuMTg5MiwwLjUyMTMsMC4wMDAxLDAuMTk3NywxLDAuMTk3MCwxLDAuMTk2OSwyLDAuMTk2MywxLDAuMTk2MCwxLDAuMTkyMiwxLDAuMTkxNSwxLDAuMTkxMSwxLDAuMTkwMiwxLDAuMTg4NywxLDIwMjYtMTEtMjAgMDA6MDA6MDAsMCxFIDAwLEVCUyw1MTAwNTAsNTBFVEa5ujEy1MIyNjUwLDI3LjY1LDAuMjEyOCwwLjE1NTIsMzM5MCw2MDk3ODAxLjAwLE0sMC4yMzMwLEMsMjAyNi0xMi0yMywzMywyLDAuMjUsLTAuMDU0IjsKdmFyIGhxX3N0cl9DT05fT1BfMTAwMTI2NDA9Ijc5LDAuMDA3MCwwLjAwNzAsMC4wMDcyLDEsMjEzNDYsNDUuODMsMi42NTAwLDAuMDA0OCwwLjAwNjcsMC4yNDY1LDAuMDAwMSwwLjAwNzgsMSwwLjAwNzYsNywwLjAwNzQsMSwwLjAwNzMsMywwLjAwNzIsMSwwLjAwNzAsNzksMC4wMDY2LDcsMC4wMDYzLDIsMC4wMDYyLDEzLDAuMDA2MSwxNSwyMDI2LTExLTIwIDAwOjAwOjAwLDAsRSAwMCxFQlMsNTEwMDUwLDUwRVRGucExMtTCMjY1MCwxNTQuMTcsMC4wMTMyLDAuMDA1OCwyNzEzOCwyNjg1MTc2LjAwLE0sMC4wMDQ4LFAsMjAyNi0xMi0yMywzMywxLDAsMC4wMDciOwp2YXIgaHFfc3RyX0NPTl9PUF85OTk5OTk5OT0iIjsK',
  'base64',
))
const CON_SO_GBK = Uint8Array.from(Buffer.from(
  'dmFyIGhxX3N0cl9DT05fU09fMTAwMTI2Mzk9IjUwRVRGuboxMtTCMjY1MCwsLCwzMzkwLDAuOTk5NSwwLjAyMjMsLTAuMTA2NCwwLjAwMTYsMC4wMDA3LDAuMjEyOCwwLjE1NTIsNTEwMDUwQzI2MTJNMDI2NTAsMi42NTAwLDAuMTk2MCwwLjI1OTYsTSI7CnZhciBocV9zdHJfQ09OX1NPXzEwMDEyNjQwPSI1MEVURrnBMTLUwjI2NTAsLCwsMjcxMzgsLTAuMDAwNSwwLjAyMjMsLTAuMDAwOCwwLjAwMTYsMC4yMjQ0LDAuMDEzMiwwLjAwNTgsNTEwMDUwUDI2MTJNMDI2NTAsMi42NTAwLDAuMDA3MCwwLE0iOwo=',
  'base64',
))
const A50_GBK = Uint8Array.from(Buffer.from(
  'dmFyIGhxX3N0cl9oZl9DSEE1MENGRD0iMTI1MTUuMzAwLCwxMjUxNS4wMDAsMTI1MTguMDAwLDEyNjY5LjAwMCwxMjUwMC4wMDAsMDU6MTQ6NTksMTI2MjMuMDAwLDEyNjIzLjAwMCwxMDE5NjkwLDEsMSwyMDI2LTExLTIxLLi7yrHW0Ln6QTUwxtq79SwxNDE3MzAiOwo=',
  'base64',
))

const enc = (text) => new TextEncoder().encode(text)
const bytesResponse = (bytes) => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer })
const textResponse = (text) => bytesResponse(enc(text))
const jsonResponse = (value) => textResponse(JSON.stringify(value))
const hq = (variable, body) => textResponse(`var hq_str_${variable}="${body}";\n`)

function stockNameResponse(months, { stockId = '510050', code = 0, msg = 'ok' } = {}) {
  return jsonResponse({ result: { status: { code, msg }, data: { cateList: [], contractMonth: months, stockId, cateId: `${stockId}C2612` } } })
}

async function withFetch(handler, fn) {
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    const response = await handler(String(url))
    if (response === undefined) throw new Error(`unexpected fetch ${url}`)
    return response
  }
  try {
    return await fn()
  } finally {
    globalThis.fetch = original
  }
}

const byCapability = () => Object.fromEntries(createSinaSources().map((source) => [source.schema.capability, source]))

async function execute(capability, params) {
  const source = byCapability()[capability]
  return (await source.execute({ capability, params, session }, signal)).data
}

async function rejects(promise, code, pattern) {
  await assert.rejects(promise, (error) => {
    if (code !== undefined) assert.equal(error.code, code, `报错码应为 ${code}，实际 ${error.code}：${error.message}`)
    if (pattern !== undefined) assert.match(error.message, pattern)
    return true
  })
}

/** §9.5 host mirror: own-property undefined, NaN/Infinity/-0, holes and non-plain objects all fail. */
function assertLosslessJson(value, path = '$') {
  if (value === null) return
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path} 不是有限数值：${String(value)}`)
    assert.ok(!Object.is(value, -0), `${path} 是 -0，宿主会拒`)
    return
  }
  if (typeof value === 'string' || typeof value === 'boolean') return
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assert.notEqual(entry, undefined, `${path}[${index}] 是空洞`)
      assertLosslessJson(entry, `${path}[${index}]`)
    })
    return
  }
  assert.equal(typeof value, 'object', `${path} 不是 JSON 值`)
  const proto = Object.getPrototypeOf(value)
  assert.ok(proto === Object.prototype || proto === null, `${path} 不是 plain object`)
  for (const [key, entry] of Object.entries(value)) {
    assert.notEqual(entry, undefined, `${path}.${key} 是 undefined 自有属性`)
    assertLosslessJson(entry, `${path}.${key}`)
  }
}

function declaredRowKeys(source) {
  const output = source.schema.output_schema
  assert.equal(output.type, 'array')
  return Object.keys(output.items.properties).sort()
}

// ───────────────────────── 能力契约 ─────────────────────────

test('四条新浪能力：name/data_key/source_label/rowShape/cache 与契约一致，time_contract 未注册即为 undefined', () => {
  const sources = byCapability()
  assert.deepEqual(Object.keys(sources).sort(), [
    'sina_a50_futures', 'sina_etf_option_contracts', 'sina_etf_option_greeks', 'sina_etf_option_tquote',
  ])
  const expected = {
    sina_etf_option_contracts: { name: 'get_sina_etf_option_contracts', cache: 300_000, keys: ['contract_code', 'contract_symbol', 'month', 'side', 'underlying'] },
    sina_etf_option_tquote: { name: 'get_sina_etf_option_tquote', cache: 30_000, keys: ['amount', 'amplitude', 'ask', 'ask_vol', 'bid', 'bid_vol', 'high', 'last', 'limit_down', 'limit_up', 'low', 'name', 'open', 'open_interest', 'pct', 'prev_close', 'prev_settle', 'strike', 'volume'] },
    sina_etf_option_greeks: { name: 'get_sina_etf_option_greeks', cache: 30_000, keys: ['delta', 'gamma', 'high', 'iv', 'last', 'low', 'name', 'strike', 'theory', 'theta', 'trade_code', 'vega', 'volume'] },
    sina_a50_futures: { name: 'get_sina_a50_futures', cache: 30_000, keys: ['ask', 'bid', 'change', 'change_pct', 'datetime', 'high', 'last', 'low', 'name', 'open', 'prev_settle'] },
  }
  for (const [capability, want] of Object.entries(expected)) {
    const schema = sources[capability].schema
    assert.equal(schema.name, want.name)
    assert.equal(schema.source, `http:sina.${capability}`)
    assert.equal(schema.data_key, `sina.http.${capability}`)
    assert.equal(schema.source_label, 'sina')
    assert.equal(schema.paginated, false)
    assert.equal(schema.cacheMaxAgeMs, want.cache)
    assert.deepEqual(schema.rowShape, { rootArray: true })
    assert.equal(schema.time_contract, undefined, '未在 DATA_TIME_CONTRACTS 注册的时间契约必须是 undefined，不许编造')
    assert.ok(schema.summary.length > 0 && schema.summary.length <= 50, `${capability} summary 必须短于 50 字`)
    assert.ok(schema.description.includes('⛔'), `${capability} description 必须留下上游坑的硬约束`)
    assert.deepEqual(Object.keys(schema.output_schema.items.properties).sort(), want.keys, `${capability} 输出字段与契约不一致`)
  }
  assert.deepEqual(byCapability().sina_etf_option_contracts.schema.output_schema.items.properties.underlying.enum, ['510050', '510300', '588000', '510500'])
  assert.deepEqual(byCapability().sina_etf_option_contracts.schema.output_schema.items.properties.side.enum, ['call', 'put'])
})

test('参数归一化：两遍幂等、键名不变、不发明未声明的键', () => {
  const samples = {
    sina_etf_option_contracts: { underlying: '510050', side: 'call' },
    sina_etf_option_tquote: { codes: ['10012639'] },
    sina_etf_option_greeks: { codes: ['10012639'] },
    sina_a50_futures: {},
  }
  for (const source of Object.values(byCapability())) {
    const capability = source.schema.capability
    const declared = Object.keys(source.schema.input_schema.properties ?? {}).sort()
    const once = source.normalizeParams(samples[capability])
    for (const key of Object.keys(once)) assert.ok(declared.includes(key), `${capability} 归一化发明了未声明键 ${key}`)
    assert.deepEqual(source.normalizeParams(once), once, `${capability} normalizeParams 必须幂等`)
  }
  // codes: CON_OP_ 前缀剥掉、纯数字原样、重复去重、大小写前缀都认
  const tquote = byCapability().sina_etf_option_tquote
  assert.deepEqual(tquote.normalizeParams({ codes: ['CON_OP_10012639', '10012639', 'con_op_10012640', ' 10012641 '] }), { codes: ['10012639', '10012640', '10012641'] })
  const greeks = byCapability().sina_etf_option_greeks
  assert.deepEqual(greeks.normalizeParams(greeks.normalizeParams({ codes: ['CON_OP_10012639'] })), { codes: ['10012639'] })
  assert.deepEqual(byCapability().sina_etf_option_contracts.normalizeParams({ underlying: '510300', side: 'PUT' }), { underlying: '510300', side: 'put' })
  assert.deepEqual(byCapability().sina_a50_futures.normalizeParams({}), {})
})

test('非法参数在归一化层拒绝（不把错误推到上游）', () => {
  const sources = byCapability()
  const rejects = [
    ['sina_etf_option_contracts', { underlying: '510050', side: 'both' }, /side must be call or put/],
    ['sina_etf_option_contracts', { underlying: '159919', side: 'call' }, /underlying must be one of/],
    ['sina_etf_option_contracts', { underlying: '510050' }, /side must be call or put/],
    ['sina_etf_option_contracts', { underlying: '510050', side: 'call', month: '2612' }, /unsupported parameter: month/],
    ['sina_etf_option_tquote', { codes: [] }, /non-empty array/],
    ['sina_etf_option_tquote', { codes: '10012639' }, /non-empty array/],
    ['sina_etf_option_tquote', { codes: ['510050'] }, /6-digit ETF codes/],
    ['sina_etf_option_tquote', { codes: ['CON_SO_10012639'] }, /unreadable option contract code/],
    ['sina_etf_option_tquote', { codes: Array.from({ length: 21 }, (_, index) => String(10012639 + index)) }, /at most 20/],
    ['sina_etf_option_tquote', { codes: [10012639] }, /must contain strings/],
    ['sina_etf_option_greeks', { codes: ['10012639'], page: 2 }, /unsupported parameter: page/],
    ['sina_a50_futures', { symbol: 'hf_GC' }, /unsupported parameter: symbol/],
  ]
  for (const [capability, params, pattern] of rejects) {
    assert.throws(() => sources[capability].normalizeParams(params), pattern, `${capability} ${JSON.stringify(params)}`)
  }
})

// ───────────────────────── 合约清单 ─────────────────────────

test('合约清单：contractMonth 去重后近月在前，某月空列表是合法空，OP_DOWN_ 用于认沽', async () => {
  const seen = []
  const data = await withFetch((url) => {
    if (url.includes('StockOptionService.getStockName')) {
      assert.match(url, /cate=50ETF/)
      // 上游把最近挂牌月重复一次（2026-11 出现两遍），且顺序可能乱；去重 + 升序才是契约
      return stockNameResponse(['2026-12', '2026-11', '2026-11', '2027-03'])
    }
    if (url.includes('hq.sinajs.cn')) {
      seen.push(url)
      if (url.includes('OP_DOWN_5100502611')) return hq('OP_DOWN_5100502611', 'CON_OP_10000003,')
      if (url.includes('OP_DOWN_5100502612')) return hq('OP_DOWN_5100502612', '') // 该月无挂牌合约：合法空
      if (url.includes('OP_DOWN_5100502703')) return hq('OP_DOWN_5100502703', 'CON_OP_10000004,CON_OP_10000005,')
    }
    return undefined
  }, () => execute('sina_etf_option_contracts', { underlying: '510050', side: 'put' }))
  assert.deepEqual(data, [
    { underlying: '510050', side: 'put', month: '2611', contract_code: '10000003', contract_symbol: 'OP_DOWN_5100502611' },
    { underlying: '510050', side: 'put', month: '2703', contract_code: '10000004', contract_symbol: 'OP_DOWN_5100502703' },
    { underlying: '510050', side: 'put', month: '2703', contract_code: '10000005', contract_symbol: 'OP_DOWN_5100502703' },
  ])
  assert.equal(seen.length, 3, '三个月各一次串行 hq 请求，空的 2612 也不跳过请求（先取才知道是空）')
  assert.ok(seen.every((url) => url.includes('OP_DOWN_')), '认沽必须走 OP_DOWN_ 列表名')
})

test('合约清单：列表非空但 token 变了、hq 缺变量、月份不可读、标的漂移都响亮失败', async () => {
  const contracts = () => execute('sina_etf_option_contracts', { underlying: '510050', side: 'call' })
  await rejects(withFetch((url) => {
    if (url.includes('getStockName')) return stockNameResponse(['2026-12'])
    return hq('OP_UP_5100502612', 'OP_51005010012639,')
  }, contracts), 'sina_invalid_response', /unexpected contract token/)
  await rejects(withFetch((url) => {
    if (url.includes('getStockName')) return stockNameResponse(['2026-12'])
    return hq('SOMETHING_ELSE', 'CON_OP_10012639,')
  }, contracts), 'sina_invalid_response', /no variable for OP_UP_5100502612/)
  await rejects(withFetch(() => stockNameResponse(['2026-13']), contracts), 'sina_invalid_response', /unreadable contract month/)
  await rejects(withFetch(() => stockNameResponse(['2026-12'], { stockId: '510300' }), contracts), 'sina_invalid_response', /resolved to 510300/)
  await rejects(withFetch(() => stockNameResponse([], { stockId: '510050' }), contracts), 'sina_invalid_response', /no contract month/)
  await rejects(withFetch(() => stockNameResponse(['2026-12'], { code: 11, msg: 'Service not found' }), contracts), 'sina_upstream_error', /Service not found/)
  await rejects(withFetch(() => ({ ok: true, status: 200, arrayBuffer: async () => enc('<html>').buffer }), contracts), 'sina_invalid_response', /non-JSON/)
})

// ───────────────────────── T 型报价 ─────────────────────────

test('T 型报价（真实 GBK 报文）：51 列字段位、单位、百分数口径全部对上', async () => {
  const data = await withFetch((url) => {
    if (url.includes('hq.sinajs.cn')) {
      assert.match(url, /list=CON_OP_10012639,CON_OP_10012640,CON_OP_99999999/)
      return bytesResponse(CON_OP_GBK)
    }
    return undefined
  }, () => execute('sina_etf_option_tquote', { codes: ['10012639', '10012640', '99999999'] }).catch((error) => error))
  // 99999999 是上游空内容 → 整批响亮失败，不能只返回两行
  assert.equal(data.code, 'sina_empty_quote')
  assert.match(data.message, /CON_OP_99999999/)

  const rows = await withFetch(() => bytesResponse(CON_OP_GBK), () => execute('sina_etf_option_tquote', { codes: ['CON_OP_10012639', '10012640'] }))
  assert.equal(rows.length, 2, '行顺序 = 请求 codes 顺序')
  assert.deepEqual(rows[0], {
    name: '50ETF购12月2650',
    bid_vol: 1,
    bid: 0.1922,
    last: 0.196,
    ask: 0.196,
    ask_vol: 1,
    open_interest: 5247,
    pct: -15.88,
    strike: 2.65,
    prev_close: 0.2083,
    open: 0.1892,
    limit_up: 0.5213,
    limit_down: 0.0001,
    prev_settle: 0.233,
    amplitude: 27.65,
    high: 0.2128,
    low: 0.1552,
    volume: 3390,
    amount: 6097801,
  })
  // ⛔ pct 的基准是昨结算（下标 44），不是 prev_close（下标 8）：两者复算差 10 个百分点以上
  const pctOnSettle = ((rows[0].last - rows[0].prev_settle) / rows[0].prev_settle) * 100
  const pctOnClose = ((rows[0].last - rows[0].prev_close) / rows[0].prev_close) * 100
  assert.ok(Math.abs(pctOnSettle - rows[0].pct) <= 0.1, `pct 应等于对昨结算复算的 ${pctOnSettle.toFixed(2)}`)
  assert.ok(Math.abs(pctOnClose - rows[0].pct) > 5, '若 pct 用 prev_close 复算也成立，这个用例就抓不出基准错误')
  // ⛔ amplitude 的基准是 prev_close
  assert.ok(Math.abs(rows[0].amplitude - ((rows[0].high - rows[0].low) / rows[0].prev_close) * 100) <= 0.02)
  // amount/(volume×10000) 落在当日高低价之间 → volume 单位张、amount 单位元
  const averagePremium = rows[0].amount / (rows[0].volume * 10000)
  assert.ok(averagePremium >= rows[0].low && averagePremium <= rows[0].high, `成交均价 ${averagePremium} 应落在 [${rows[0].low}, ${rows[0].high}]`)
  // 认沽行：0 是真实值，不能变成 null
  assert.equal(rows[1].name, '50ETF沽12月2650')
  assert.equal(rows[1].open_interest, 21346)
  assert.equal(rows[1].prev_settle, 0.0048)
  assert.equal(rows[1].last, 0.007)
  assert.equal(rows[1].pct, 45.83)
})

test('T 型报价 guard：长度不足、name 空、pct 与昨结算矛盾都按 sina_invalid_response 失败', async () => {
  const short = Array.from({ length: 42 }, (_, index) => (index === 37 ? 'X' : '0')).join(',')
  await rejects(withFetch(() => hq('CON_OP_10012639', short), () => execute('sina_etf_option_tquote', { codes: ['10012639'] })), 'sina_invalid_response', /42 columns, expected at least 45/)
  const long = Array.from({ length: 51 }, (_, index) => (index === 37 ? '' : '0')).join(',')
  await rejects(withFetch(() => hq('CON_OP_10012639', long), () => execute('sina_etf_option_tquote', { codes: ['10012639'] })), 'sina_invalid_response', /empty contract name/)
  const fields = Array.from({ length: 51 }, () => '0')
  fields[2] = '1.00'
  fields[6] = '-50.00' // 与 昨收/昨结 都矛盾
  fields[8] = '1.05'
  fields[37] = 'X'
  fields[44] = '1.05'
  await rejects(withFetch(() => hq('CON_OP_10012639', fields.join(',')), () => execute('sina_etf_option_tquote', { codes: ['10012639'] })), 'sina_invalid_response', /column layout changed/)
})

// ───────────────────────── 希腊字母 ─────────────────────────

test('希腊字母（真实 GBK 报文）：raw[1..3] 三个空串必须跳过，iv 是小数', async () => {
  const rows = await withFetch((url) => {
    if (url.includes('hq.sinajs.cn')) {
      assert.match(url, /list=CON_SO_10012639,CON_SO_10012640/)
      return bytesResponse(CON_SO_GBK)
    }
    return undefined
  }, () => execute('sina_etf_option_greeks', { codes: ['10012639', '10012640'] }))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    name: '50ETF购12月2650',
    volume: 3390,
    delta: 0.9995,
    gamma: 0.0223,
    theta: -0.1064,
    vega: 0.0016,
    iv: 0.0007,
    high: 0.2128,
    low: 0.1552,
    trade_code: '510050C2612M02650',
    strike: 2.65,
    last: 0.196,
    theory: 0.2596,
  })
  // 不跳过空串时 volume 会落到 '' → null，delta 会拿到 '3390'；这里两列都必须是错位后的正确值
  assert.equal(rows[0].volume, 3390)
  assert.equal(rows[0].delta, 0.9995)
  assert.equal(rows[0].iv, 0.0007)
  assert.ok(rows[0].iv < 1, 'iv 是小数（0.0007 = 0.07%），不是百分数')
  assert.equal(rows[1].name, '50ETF沽12月2650')
  assert.equal(rows[1].iv, 0.2244)
  assert.equal(rows[1].trade_code, '510050P2612M02650')
  assert.equal(rows[1].theory, 0, '真实 0 必须保留，不能变成 null')
  assert.equal(rows[1].theta, -0.0008)
})

test('希腊字母 guard：列数不足、raw[1..3] 不再是空串都响亮失败（上游改版的唯一信号）', async () => {
  const short = Array.from({ length: 15 }, () => '0')
  short[0] = 'X'
  await rejects(withFetch(() => hq('CON_SO_10012639', short.join(',')), () => execute('sina_etf_option_greeks', { codes: ['10012639'] })), 'sina_invalid_response', /15 columns, expected at least 16/)
  const moved = Array.from({ length: 17 }, () => '0')
  moved[0] = 'X'
  moved[1] = '实值' // 一旦上游开始下发价值状态，[raw[0]] + raw[4:] 就会整列错位
  moved[9] = '510050C2612M02650'
  await rejects(withFetch(() => hq('CON_SO_10012639', moved.join(',')), () => execute('sina_etf_option_greeks', { codes: ['10012639'] })), 'sina_invalid_response', /no longer blank/)
})

// ───────────────────────── A50 ─────────────────────────

test('A50（真实 GBK 报文）：单行、北京时间墙钟、change_pct 是百分数、昨结为百分比基准', async () => {
  const data = await withFetch((url) => {
    assert.match(url, /list=hf_CHA50CFD/)
    return bytesResponse(A50_GBK)
  }, () => execute('sina_a50_futures', {}))
  assert.equal(data.length, 1)
  assert.deepEqual(data[0], {
    name: '富时中国A50期货',
    datetime: '2026-11-21 05:14:59',
    last: 12515.3,
    bid: 12515,
    ask: 12518,
    high: 12669,
    low: 12500,
    open: 12623,
    prev_settle: 12623,
    change: -107.7,
    change_pct: -0.8532,
  })
  // datetime 是北京时间墙钟：2026-11-21 05:14:59 是周六凌晨，属于周五夜盘，不是交易所当地日盘
  assert.match(data[0].datetime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  assert.equal(data[0].datetime.slice(0, 10), '2026-11-21')
  assert.ok(Math.abs(data[0].change_pct) < 100, 'change_pct 是百分数（-0.8532 = -0.85%），不是比例')
})

test('A50 guard：列数不足、日期/时间不可读、last 空、空变量都明亮失败', async () => {
  const run = () => execute('sina_a50_futures', {})
  const fields = Array.from({ length: 15 }, (_, index) => String(index))
  fields[0] = '12515.300'
  fields[6] = '05:14:59'
  fields[12] = '2026-11-21'
  fields[13] = 'X'
  await rejects(withFetch(() => hq('hf_CHA50CFD', fields.slice(0, 13).join(',')), run), 'sina_invalid_response', /13 columns, expected at least 14/)
  const badDate = [...fields]
  badDate[12] = '2026/11/21'
  await rejects(withFetch(() => hq('hf_CHA50CFD', badDate.join(',')), run), 'sina_invalid_response', /unreadable date/)
  const badTime = [...fields]
  badTime[6] = '051459'
  await rejects(withFetch(() => hq('hf_CHA50CFD', badTime.join(',')), run), 'sina_invalid_response', /unreadable time/)
  const emptyLast = [...fields]
  emptyLast[0] = ''
  await rejects(withFetch(() => hq('hf_CHA50CFD', emptyLast.join(',')), run), 'sina_invalid_response', /last price is empty/)
  await rejects(withFetch(() => hq('hf_CHA50CFD', ''), run), 'sina_empty_quote', /quote is empty/)
})

// ───────────────────────── 输出契约 ─────────────────────────

test('真实报文返回值：无损 JSON、满足 output_schema、无未声明字段、0 不变成 null', async () => {
  const cases = [
    {
      capability: 'sina_etf_option_tquote',
      handler: () => bytesResponse(CON_OP_GBK),
      params: { codes: ['10012639', '10012640'] },
    },
    {
      capability: 'sina_etf_option_greeks',
      handler: () => bytesResponse(CON_SO_GBK),
      params: { codes: ['10012639', '10012640'] },
    },
    {
      capability: 'sina_a50_futures',
      handler: () => bytesResponse(A50_GBK),
      params: {},
    },
    {
      capability: 'sina_etf_option_contracts',
      handler: (url) => (url.includes('getStockName')
        ? stockNameResponse(['2026-11', '2026-11', '2026-12'])
        : hq(url.slice(url.lastIndexOf('/list=') + 6), 'CON_OP_10000001,')),
      params: { underlying: '510050', side: 'call' },
    },
  ]
  for (const { capability, handler, params } of cases) {
    const source = byCapability()[capability]
    const data = await withFetch(handler, async () => (await source.execute({ capability, params, session }, signal)).data)
    assertLosslessJson(data)
    assert.deepEqual(JSON.parse(JSON.stringify(data)), data, `${capability} 必须能无损往返 JSON`)
    assert.deepEqual(outputSchemaViolations(source.schema.output_schema, data), [], `${capability} 必须满足自己的 output_schema`)
    assert.ok(source.validateOutput(data), `${capability} validateOutput 必须接受真实返回值`)
    for (const row of data) assert.deepEqual(Object.keys(row).sort(), declaredRowKeys(source), `${capability} 行不得多带未声明字段`)
  }
})

test('validateOutput 是硬 guard：多余字段、NaN、非数组、该非空却空、A50 多行都拒', async () => {
  const sources = byCapability()
  const tquote = sources.sina_etf_option_tquote
  assert.equal(tquote.validateOutput(undefined), false)
  assert.equal(tquote.validateOutput({}), false)
  assert.equal(tquote.validateOutput([]), false, '报价能力至少一行：空数组是失败而不是合法空')
  assert.equal(tquote.validateOutput([{ name: 'X' }]), false)
  assert.equal(sources.sina_etf_option_contracts.validateOutput([]), true, '合约清单允许合法的空数组')
  const row = { name: 'X', bid_vol: 1, bid: 1, last: 1, ask: 1, ask_vol: 1, open_interest: 1, pct: 0, strike: 1, prev_close: 1, open: 1, limit_up: 1, limit_down: 0, prev_settle: 1, amplitude: 0, high: 1, low: 1, volume: 1, amount: 1 }
  assert.equal(tquote.validateOutput([row]), true)
  assert.equal(tquote.validateOutput([{ ...row, contract_code: '10012639' }]), false, '未声明字段直接拒')
  assert.equal(tquote.validateOutput([{ ...row, last: Number.NaN }]), false, 'NaN 直接拒')
  assert.equal(tquote.validateOutput([{ ...row, last: undefined }]), false, 'undefined 直接拒')
  const a50 = sources.sina_a50_futures
  assert.equal(a50.validateOutput([
    { name: 'A', datetime: '2026-11-21 05:14:59', last: 1, bid: 1, ask: 1, high: 1, low: 1, open: 1, prev_settle: 1, change: 0, change_pct: 0 },
    { name: 'A', datetime: '2026-11-21 05:14:59', last: 1, bid: 1, ask: 1, high: 1, low: 1, open: 1, prev_settle: 1, change: 0, change_pct: 0 },
  ]), false, 'A50 契约是单行')
})

test('execute 内再次归一化：直连调用与 Hub 两遍归一化得到同一结果', async () => {
  const source = byCapability().sina_etf_option_tquote
  const handler = () => bytesResponse(CON_OP_GBK)
  const direct = await withFetch(handler, () => source.execute({ capability: 'sina_etf_option_tquote', params: { codes: ['CON_OP_10012639'] }, session }, signal))
  const viaHub = await withFetch(handler, () => source.execute({ capability: 'sina_etf_option_tquote', params: source.normalizeParams({ codes: ['CON_OP_10012639'] }), session }, signal))
  assert.deepEqual(direct, viaHub)
})
