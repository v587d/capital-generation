import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTencentSources } from '../lib/sources/tencent-http.js'
import { parseSecurityCode, normalizeSecurityCodes } from '../lib/sources/security-code.js'

const session = { id: 'smoke-test', header: { cwd: '/workspace/project' } }
const signal = new AbortController().signal

function response(text) {
  const bytes = new TextEncoder().encode(text)
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer }
}

function quoteText(symbol, values = {}) {
  const fields = Array.from({ length: 53 }, () => '')
  fields[1] = values.name ?? 'TEST'
  fields[3] = String(values.price ?? 10)
  fields[4] = String(values.lastClose ?? 9)
  fields[5] = String(values.open ?? 9.5)
  fields[30] = values.timestamp ?? '20260924100000'
  fields[31] = String(values.changeAmt ?? 1)
  fields[32] = String(values.changePct ?? 11.11)
  fields[33] = String(values.high ?? 10.5)
  fields[34] = String(values.low ?? 9.4)
  fields[35] = `10/1/${values.amount ?? 100}`
  fields[37] = String(values.amountWan ?? 100)
  fields[38] = '1.2'
  fields[39] = '12.3'
  fields[43] = '2.1'
  fields[44] = '100'
  fields[45] = '120'
  fields[46] = '1.1'
  fields[47] = '11'
  fields[48] = '8'
  fields[49] = '1.5'
  fields[52] = '13.1'
  return `v_${symbol}="${fields.join('~')}";`
}

function sourceMap() {
  return Object.fromEntries(createTencentSources().map((source) => [source.schema.capability, source]))
}

async function execute(source, params) {
  const normalized = source.normalizeParams(params)
  return source.execute({ capability: source.schema.capability, params: normalized, session }, signal)
}

test('security code normalization preserves exchange and rejects ambiguous bare 000xxx', () => {
  assert.deepEqual(parseSecurityCode('600519.SH'), {
    digits: '600519', market: 'SH', canonical: '600519.SH', tencentSymbol: 'sh600519', isIndex: false,
  })
  assert.equal(parseSecurityCode('000001.SH').isIndex, true)
  assert.equal(parseSecurityCode('000001.SZ').isIndex, false)
  assert.equal(parseSecurityCode('600519.XSHG').canonical, '600519.SH')
  assert.throws(() => parseSecurityCode('000001'), /explicit exchange/)
  assert.throws(() => parseSecurityCode('SZ600519'), /exchange conflicts/)
  assert.deepEqual(normalizeSecurityCodes(['600519.SH', '600519.XSHG', '000001.SZ']).map((code) => code.canonical), ['600519.SH', '000001.SZ'])
})

test('Tencent source registry uses nine non-conflicting capabilities and source label', () => {
  const sources = createTencentSources()
  assert.deepEqual(sources.map((source) => source.schema.capability), [
    'tencent_quote', 'tencent_kline', 'tencent_ticks',
    'tencent_hk_quote', 'tencent_us_quote',
    'tencent_hk_index_quote', 'tencent_us_index_quote',
    'tencent_hk_kline', 'tencent_us_kline',
  ])
  assert.deepEqual(new Set(sources.map((source) => source.schema.source_label)), new Set(['tencent']))
  assert.equal(new Set(sources.map((source) => source.schema.data_key)).size, 9)
  for (const source of sources) {
    assert.ok(source.schema.input_schema)
    assert.ok(source.schema.output_schema)
    assert.match(source.schema.description, /腾讯/)
  }
  // 港美股是**独立能力**，不是把 A 股的 quote/kline 换个参数：各表的字段位序互不通用。
  // 六条 = 港个股快照 / 美个股快照 / 港指数点位 / 美指数点位 / 港 K 线 / 美 K 线。
  assert.equal(sources.filter((source) => /_(hk|us)_/.test(source.schema.capability)).length, 6)
})

/**
 * 港股快照 78 位（列位来自 live 实测；名称用 ASCII，GBK 解码由真机冒烟覆盖）。
 * 派生列（振幅 / 换手 / 均价 / 市值）按**上游自己的算术关系**算出来：手填一组好看的数字
 * 只会让断言变成"解析器读到了我编的数"，核不出列位错。
 */
function hkQuoteText(symbol, values = {}) {
  const price = values.price ?? 423
  const lastClose = values.lastClose ?? 421.2
  const high = values.high ?? 423.6
  const low = values.low ?? 416.4
  const volume = values.volume ?? 8709438
  const amount = values.amount ?? 3667028820.9
  const totalShares = values.totalShares ?? 9092605595
  const round = (value, digits) => Number(value.toFixed(digits))
  const fields = Array.from({ length: 78 }, () => '')
  fields[1] = values.name ?? 'TESTHK'
  fields[2] = values.code ?? '00700'
  fields[3] = String(price)
  fields[4] = String(lastClose)
  fields[5] = String(values.open ?? 420)
  fields[6] = String(volume)
  fields[30] = values.timestamp ?? '2026-10-05 16:08:09'
  fields[31] = String(values.changeAmt ?? round(price - lastClose, 3))
  fields[32] = String(values.changePct ?? round(((price - lastClose) / lastClose) * 100, 2))
  fields[33] = String(high)
  fields[34] = String(low)
  fields[37] = String(amount)
  fields[43] = String(values.amplitude ?? round(((high - low) / lastClose) * 100, 2))
  fields[45] = String(values.marketCapYi ?? round((totalShares * price) / 1e8, 4))
  fields[46] = values.english ?? 'TENCENT'
  fields[59] = String(values.turnover ?? round((volume / totalShares) * 100, 2))
  fields[60] = String(values.boardLot ?? 100)
  fields[69] = String(totalShares)
  fields[73] = String(values.avgPrice ?? round(amount / volume, 3))
  fields[75] = values.currency ?? 'HKD'
  return `v_${symbol}="${fields.join('~')}";`
}

/** 美股快照 73 位：币种在第 35 位（港股在 75），流通与总两列市值实测真的不相等，同样按算术派生。 */
function usQuoteText(symbol, values = {}) {
  const price = values.price ?? 333.69
  const lastClose = values.lastClose ?? 330.32
  const high = values.high ?? 334.54
  const low = values.low ?? 330.61
  const volume = values.volume ?? 33278552
  const amount = values.amount ?? 11087245013
  const totalShares = values.totalShares ?? 14594180000
  const floatShares = values.floatShares ?? 14585108878
  const round = (value, digits) => Number(value.toFixed(digits))
  const fields = Array.from({ length: 73 }, () => '')
  fields[1] = values.name ?? 'TESTUS'
  fields[2] = values.code ?? 'AAPL.OQ'
  fields[3] = String(price)
  fields[4] = String(lastClose)
  fields[5] = String(values.open ?? 333.26)
  fields[6] = String(volume)
  fields[30] = values.timestamp ?? '2026-10-02 16:00:01'
  fields[31] = String(values.changeAmt ?? round(price - lastClose, 2))
  fields[32] = String(values.changePct ?? round(((price - lastClose) / lastClose) * 100, 2))
  fields[33] = String(high)
  fields[34] = String(low)
  fields[35] = values.currency ?? 'USD'
  fields[37] = String(amount)
  fields[38] = String(values.turnover ?? round((volume / totalShares) * 100, 2))
  fields[43] = String(values.amplitude ?? round(((high - low) / lastClose) * 100, 2))
  fields[44] = String(values.floatMarketCapYi ?? round((floatShares * price) / 1e8, 5))
  fields[45] = String(values.marketCapYi ?? round((totalShares * price) / 1e8, 5))
  fields[46] = values.english ?? 'Apple Inc.'
  fields[62] = String(totalShares)
  fields[63] = String(floatShares)
  fields[67] = String(values.avgPrice ?? round(amount / volume, 2))
  return `v_${symbol}="${fields.join('~')}";`
}

test('tencent_hk_quote：代码左补零、时间戳两种分隔符都吃，量纲要能被算术核对', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    // 斜杠与横杠并存是实测形状（同一份响应里两行不同写法），只认一种就会把行情时间判成畸形。
    return response(
      hkQuoteText('hk00700', { timestamp: '2026/10/05 16:08:09' })
      + hkQuoteText('hk00005', { code: '00005', name: 'HSBC', price: 149.9, lastClose: 149.5, open: 150, volume: 11889096, amount: 1767921135.3, changeAmt: 0.4, changePct: 0.27, high: 150.3, low: 147.6, amplitude: 1.81, marketCapYi: 25695.7715, english: 'HSBC HOLDINGS', turnover: 0.07, boardLot: 400, totalShares: 17141942291, avgPrice: 148.701 }),
    )
  }
  try {
    // 700 与 00700 是同一只（上游只认补零形态），99999 会被上游静默丢弃。
    const result = await execute(sources.tencent_hk_quote, { codes: ['00700', '700', 'hk00005', '99999'] })
    assert.equal(requested.pathname.replace('/q=', ''), 'hk00700,hk00005,hk99999', '写法补齐去重；99999 形状合法照样请求出去，由上游决定有没有这只')
    assert.deepEqual(result.data.map((row) => row.code), ['00700', '00005'], '不存在的代码不编造行')
    const [tencent] = result.data
    assert.deepEqual([tencent.name, tencent.english_name, tencent.currency], ['TESTHK', 'TENCENT', 'HKD'])
    assert.equal(tencent.quote_time, '2026-10-05 16:08:09', '分隔符归一，但时间本身是交易所当地时间')
    assert.equal(tencent.volume_shares, 8709438)
    assert.equal(tencent.amount_hkd, 3667028820.9)
    assert.equal(tencent.board_lot_shares, 100)
    // 契约里承诺的量纲，必须在 fixture 上真的算得平（对不上就是描述说谎）。
    assert.ok(Math.abs(tencent.market_cap_yi_hkd - (tencent.total_shares * tencent.price) / 1e8) < 0.01)
    assert.ok(Math.abs(tencent.avg_price - tencent.amount_hkd / tencent.volume_shares) < 0.01)
    assert.ok(Math.abs(tencent.turnover_pct - (tencent.volume_shares / tencent.total_shares) * 100) < 0.01)
    assert.ok(Math.abs(tencent.amplitude_pct - ((tencent.high - tencent.low) / tencent.last_close) * 100) < 0.02)
    assert.equal('week52_high' in tencent, false, '52 周高低与日线序列对不上，不收录')
    assert.equal(result.data[1].board_lot_shares, 400, '每手股数按行给，腾讯 100 / 汇丰 400')
    assert.equal(tencent.is_stale, false)
    assert.equal(sources.tencent_hk_quote.validateOutput(result.data), true)
  } finally { globalThis.fetch = originalFetch }
})

test('tencent_hk_quote：休市行保留 is_stale，指数与畸形快照一律拒绝', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => response(hkQuoteText('hk00700', { amount: 0, price: 421.2, lastClose: 421.2 }))
  try {
    const [row] = (await execute(sources.tencent_hk_quote, { codes: ['00700'] })).data
    assert.equal(row.is_stale, true)
    assert.equal(row.stale_reason, 'zero turnover and price equals previous close')
    assert.equal(row.amount_hkd, 0, '0 是上游原值，不改写成 null')
  } finally { globalThis.fetch = originalFetch }

  for (const bad of [['HSI'], ['hk00700.HKX'], [''], ['007000'], ['999999']]) {
    await assert.rejects(() => execute(sources.tencent_hk_quote, { codes: bad }), /five-digit Hong Kong stock code/, '指数与畸形代码必须在出网前拒绝')
  }
  for (const broken of [
    `v_hk00700="${Array.from({ length: 40 }, () => '1').join('~')}";`,
    hkQuoteText('hk00700', { timestamp: '2026年10月5日' }),
    hkQuoteText('hk00700', { code: '700' }),
    hkQuoteText('hkHSI', { code: 'HSI' }),
  ]) {
    globalThis.fetch = async () => response(broken)
    await assert.rejects(
      () => execute(sources.tencent_hk_quote, { codes: ['00700'] }),
      (error) => ['tencent_invalid_response', 'tencent_empty_response'].includes(error?.code),
      '短串、畸形时间与指数形状都要响亮失败',
    )
  }
})

test('tencent_us_quote：交易所后缀由上游回答，换手率分母是总股本不是流通股本', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = new URL(url)
    return response(
      usQuoteText('usAAPL')
      // BRK.B 是关键样本：流通/总两个分母差一倍，只有总股本能对上上游给的 0.2。
      + usQuoteText('usBRK.B', { code: 'BRK.B.N', price: 502.28, lastClose: 500, open: 501, volume: 4193461, amount: 2106289770, totalShares: 2140709794, floatShares: 1247613213, high: 503, low: 500 })
      + usQuoteText('usBABA', { code: 'BABA.N', price: 105.85 }),
    )
  }
  try {
    const result = await execute(sources.tencent_us_quote, { codes: ['aapl', 'BRK.B', 'AAPL.OQ', 'BABA'] })
    assert.equal(requested.pathname.replace('/q=', ''), 'usAAPL,usBRK.B,usBABA', '两位后缀直接剥掉（AAPL 与 AAPL.OQ 是同一只），单字母尾段照原样问上游')
    const rows = Object.fromEntries(result.data.map((row) => [row.code, row]))
    assert.deepEqual(Object.keys(rows), ['AAPL.OQ', 'BRK.B.N', 'BABA.N'])
    assert.equal(rows['AAPL.OQ'].exchange_code, 'OQ')
    assert.equal(rows['BABA.N'].exchange_code, 'N', '单字母后缀是真实形状（NYSE），不是畸形')
    assert.equal(rows['AAPL.OQ'].tencent_symbol, 'usAAPL.OQ')
    assert.equal(rows['AAPL.OQ'].currency, 'USD')
    for (const row of result.data) {
      assert.ok(Math.abs(row.market_cap_yi_usd - (row.total_shares * row.price) / 1e8) < 0.01)
      assert.ok(Math.abs(row.float_market_cap_yi_usd - (row.float_shares * row.price) / 1e8) < 0.01)
      assert.ok(Math.abs(row.turnover_pct - (row.volume_shares / row.total_shares) * 100) < 0.01, `${row.code} 的分母必须是总股本`)
    }
    // 多级股票用流通股本会算错（0.2 对 0.34），这条断言钉住"为什么描述里写的是总股本"。
    const brk = rows['BRK.B.N']
    assert.ok(Math.abs(brk.turnover_pct - (brk.volume_shares / brk.float_shares) * 100) > 0.1)
  } finally { globalThis.fetch = originalFetch }

  globalThis.fetch = async () => response('v_pv_none_match="";')
  await assert.rejects(
    () => execute(sources.tencent_us_quote, { codes: ['ZZZZZZ'] }),
    (error) => error?.code === 'tencent_empty_response',
    '整批都不认识时要点名失败，不给空数组当成功',
  )
  for (const bad of [[''], ['12345'], ['A APL'], ['AAPL.'], ['GOOG,MSFT']]) {
    await assert.rejects(() => execute(sources.tencent_us_quote, { codes: bad }), /US equity ticker/)
  }
})

test('tencent_hk_kline：成交额是万港元，不复权少两列，上游拒参数不拉黑其他入口', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  const urls = []
  let payload = null
  globalThis.fetch = async (url) => {
    urls.push(new URL(url))
    return response(JSON.stringify(payload))
  }
  try {
    payload = { code: 0, data: { hk00700: { qfqday: [['2026-10-02', '439', '439.8', '447', '438.6', '15335550.000', {}, '0.170', '677406.336'], ['2026-10-05', '420', '423', '423.6', '416.4', '8709438.000', {}, '0.100', '366702.882']] } } }
    const qfq = await execute(sources.tencent_hk_kline, { code: '00700', period: 'day', count: 2 })
    assert.match(urls[0].pathname, /\/appstock\/app\/hkfqkline\/get$/)
    assert.equal(decodeURIComponent(urls[0].searchParams.get('param')), 'hk00700,day,,,2,qfq')
    assert.deepEqual(qfq.data.map((row) => [row.date, row.close, row.volume]), [['2026-10-02', 439.8, 15335550], ['2026-10-05', 423, 8709438]])
    assert.equal(qfq.data[1].amount_wan_hkd, 366702.882)
    assert.equal(qfq.data[1].turnover_pct, 0.1)
    assert.equal(qfq.data[0].adjust, 'qfq')
    assert.equal(qfq.data[0].period, 'day')

    payload = { code: 0, data: { hk00700: { day: [['2026-10-05', '420', '423', '423.6', '416.4', '8709438.000', {}]] } } }
    urls.length = 0
    const raw = await execute(sources.tencent_hk_kline, { code: '00700', period: 'day', adjust: 'none', count: 1 })
    assert.match(urls[0].pathname, /\/appstock\/app\/kline\/kline$/, 'none 走不带复权的入口：实测 hkfqkline 空 adjust 回 bad params')
    assert.equal(decodeURIComponent(urls[0].searchParams.get('param')), 'hk00700,day,,,1,')
    assert.deepEqual([raw.data[0].turnover_pct, raw.data[0].amount_wan_hkd], [null, null], '七列序列没有这两项，给 null 而不是 0')

    // 上游把不合法的 param 判成 code:1 / bad params：那是我们这边写错了，不能算成机房故障。
    urls.length = 0
    payload = { code: 1, msg: 'bad params', data: [] }
    await assert.rejects(
      () => execute(sources.tencent_hk_kline, { code: '00700', period: 'day', adjust: 'hfq', count: 1 }),
      (error) => error?.code === 'tencent_invalid_param',
    )
    assert.equal(urls.length, 1, '参数性失败必须一次即停，不轮换主机、不把它们全部拉黑 120 秒')
  } finally { globalThis.fetch = originalFetch }

  for (const bad of [
    { code: 'HSI' }, { code: '00700', period: 'm5' }, { code: '00700', count: 0 }, { code: '00700', count: 641 },
    { code: '00700', start: '2024-01-01', end: '2024-03-01' }, { code: '00700', adjust: 'none2' }, { code: '00700', period: 'quarter' },
  ]) {
    await assert.rejects(() => execute(sources.tencent_hk_kline, bad), /./, `${JSON.stringify(bad)} 应当被拒绝`)
  }
  await assert.rejects(() => execute(sources.tencent_hk_kline, { code: '00700', start: '2024-01-01' }), /start\/end are not supported/, '静默忽略日期是最坏的一种失败')

  const shapes = [
    { code: 0, data: { hk00700: { day: [['2026-13-99', '1', '2', '3', '0.5', '10']] } } },
    { code: 0, data: { hk00700: { day: [['2026-10-05', '1', '2', '1.5', '3', '10']] } } },
    { code: 0, data: { hk00700: { day: [['2026-10-05', '0', '2', '3', '1', '10']] } } },
    { code: 0, data: { hk00700: { day: [['2026-10-05', '1', '2', '3']] } } },
  ]
  for (const payload2 of shapes) {
    globalThis.fetch = async () => response(JSON.stringify(payload2))
    await assert.rejects(
      () => execute(sources.tencent_hk_kline, { code: '00700', period: 'day', adjust: 'none', count: 5 }),
      (error) => ['tencent_invalid_response', 'tencent_empty_response', 'tencent_kline_unavailable'].includes(error?.code),
      '形状变了就失败：' + JSON.stringify(payload2).slice(0, 80),
    )
  }
})

test('tencent_us_kline：交易所后缀先由快照解析，hfq 一律拒绝（实测它回的是不复权价）', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url) => {
    const parsed = new URL(url)
    urls.push(parsed)
    // 裸 usAAPL 会回一列 2011 年的陌生序列、错后缀静默回 0 行——所以身份必须由上游回答。
    if (parsed.pathname === '/q=usAAPL' || url.includes('qt.gtimg.cn')) return response(usQuoteText('usAAPL', { code: 'AAPL.OQ' }))
    return response(JSON.stringify({ code: 0, data: { 'usAAPL.OQ': { qfqday: [['2026-10-02', '333.26', '333.69', '334.54', '330.61', '33278552.00']] } } }))
  }
  try {
    const result = await execute(sources.tencent_us_kline, { code: 'aapl', period: 'day', count: 1 })
    assert.ok(String(urls[0].pathname + urls[0].search).includes('usAAPL'), '第一发是快照解析')
    assert.equal(urls.length, 2, '裸 ticker 一次解析一次取数，不该有多余轮次')
    assert.match(urls[1].pathname, /\/appstock\/app\/usfqkline\/get$/)
    assert.equal(decodeURIComponent(urls[1].searchParams.get('param')), 'usAAPL.OQ,day,,,1,qfq', 'K 线用解析出来的带后缀身份')
    assert.deepEqual([result.data[0].code, result.data[0].tencent_symbol], ['AAPL.OQ', 'usAAPL.OQ'])
    assert.equal('amount_usd' in result.data[0], false, '美股 K 线实测只有六列，不声明恒为 null 的成交额')
    assert.equal('turnover_pct' in result.data[0], false)
    assert.equal(sources.tencent_us_kline.validateOutput(result.data), true)

    urls.length = 0
    globalThis.fetch = async (url) => {
      urls.push(new URL(url))
      return response('v_pv_none_match="";')
    }
    await assert.rejects(() => execute(sources.tencent_us_kline, { code: 'ZZZZZZ' }), /does not recognize US ticker ZZZZZZ/)
    assert.equal(urls.length, 1, '解析不出来就不打 K 线')
  } finally { globalThis.fetch = originalFetch }

  await assert.rejects(() => execute(sources.tencent_us_kline, { code: 'AAPL', adjust: 'hfq' }), /adjust must be qfq or none for US/)
  await assert.rejects(() => execute(sources.tencent_us_kline, { code: 'AAPL', period: 'm1' }), /day, week or month/)
  await assert.rejects(() => execute(sources.tencent_us_kline, { code: 'AAPL', start: '2026-01-01' }), /start\/end are not supported/)
})

test('港美股与 A 股快照不共用字段表：同一位序在两个市场是不同含义', () => {
  const sources = sourceMap()
  const declared = (capability) => Object.keys(sources[capability].schema.output_schema.items.properties)
  // A 股快照第 44/45 位是流通/总市值，港股两列实测恒等、美股才真的不相等；
  // 换手率在 A 股是第 38 位、港股第 59 位、美股第 38 位——所以只能各写一张表。
  assert.ok(declared('tencent_hk_quote').includes('board_lot_shares'))
  assert.equal(declared('tencent_hk_quote').includes('limit_up'), false, '港股没有涨跌停')
  assert.equal(declared('tencent_us_quote').includes('limit_up'), false, '美股没有涨跌停')
  assert.ok(declared('tencent_us_quote').includes('float_shares'))
  assert.equal(declared('tencent_hk_quote').includes('float_shares'), false, '港股上游只给一个股本数')
  assert.deepEqual(declared('tencent_us_kline'), ['code', 'tencent_symbol', 'adjust', 'period', 'date', 'open', 'high', 'low', 'close', 'volume'])
  assert.ok(declared('tencent_hk_kline').includes('amount_wan_hkd'), '成交额列名带单位，避免与美股/ A 股跨表相加')
  assert.equal(declared('tencent_hk_kline').includes('amount_usd'), false)
  // 指数表只声明点位那一族：实测指数行的量纲列不可读（港第 6/36/37 位两列相等且万元级、
  // 美第 37 位给了 2.1e14、第 38/44/45/62/63 位为空），声明一列没把握的东西比少给一列更糟。
  for (const capability of ['tencent_hk_index_quote', 'tencent_us_index_quote']) {
    const columns = declared(capability)
    for (const forbidden of ['volume_shares', 'amount_hkd', 'amount_usd', 'turnover_pct', 'market_cap_yi_hkd', 'market_cap_yi_usd', 'float_shares', 'is_stale', 'currency']) {
      assert.equal(columns.includes(forbidden), false, `${capability} 不许声明 ${forbidden}：指数行上这一列的口径没有被证明过`)
    }
    for (const required of ['price', 'last_close', 'change_pct', 'quote_time']) {
      assert.ok(columns.includes(required), `${capability} 必须给出 ${required}`)
    }
  }
  assert.equal(
    JSON.stringify(declared('tencent_hk_index_quote')) === JSON.stringify(declared('tencent_hk_quote')),
    false, '指数表不得与原样照抄个股表',
  )
})

test('tencent_quote parses GBK-text-compatible snapshot fields and preserves stale signal', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => response(
    quoteText('sh600519', { amountWan: 0, price: 10, lastClose: 10 }) + quoteText('sz000001', { amountWan: 100, name: 'TEST2' }),
  )
  try {
    const result = await execute(sources.tencent_quote, { codes: ['600519.SH', '000001.SZ'] })
    assert.equal(result.data.length, 2)
    assert.equal(result.data[0].code, '600519.SH')
    assert.equal(result.data[0].is_stale, true)
    assert.equal(result.data[1].name, 'TEST2')
    assert.equal(sources.tencent_quote.validateOutput(result.data), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tencent_kline rotates empty host and parses raw daily rows', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (url) => {
    calls += 1
    if (calls === 1) return response(JSON.stringify({ code: 0, data: {} }))
    return response(JSON.stringify({
      code: 0,
      data: { sh600519: { day: [['2026-09-22', '10', '10.5', '10.8', '9.9', '123'], ['2026-09-23', '10.5', '10.6', '10.9', '10.2', '456']] } },
    }))
  }
  try {
    const result = await execute(sources.tencent_kline, { code: '600519.SH', period: 'day', adjust: 'none', count: 2 })
    assert.equal(calls, 2)
    assert.deepEqual(result.data.map((row) => row.date), ['2026-09-22', '2026-09-23'])
    assert.equal(result.data[0].volume, 123)
    assert.equal(result.data[0].adjust, 'none')
    assert.equal(sources.tencent_kline.validateOutput(result.data), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tencent_kline 取消原样抛出：不拉黑任何入口、不降级成 tencent_kline_unavailable（§4.2）', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  const aborted = new Error('This operation was aborted')
  aborted.name = 'AbortError'
  globalThis.fetch = async () => { throw aborted }
  try {
    await assert.rejects(
      execute(sources.tencent_kline, { code: '600519.SH', period: 'day', adjust: 'none', count: 2 }),
      (error) => error.name === 'AbortError',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
  // 取消不得把入口写进 hostDownUntil：紧随其后的正常调用一次命中。
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return response(JSON.stringify({ code: 0, data: { sh600519: { day: [['2026-09-22', '10', '10.5', '10.8', '9.9', '123']] } } }))
  }
  try {
    const result = await execute(sources.tencent_kline, { code: '600519.SH', period: 'day', adjust: 'none', count: 1 })
    assert.equal(calls, 1, '取消不该造成连带拉黑后的换机或整表不可用')
    assert.deepEqual(result.data.map((row) => row.date), ['2026-09-22'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('腾讯出口只有一条节流链：并发调用被串开，不重叠打到上游', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  let inFlight = 0
  let maxConcurrent = 0
  const startedAt = []
  globalThis.fetch = async () => {
    inFlight += 1
    maxConcurrent = Math.max(maxConcurrent, inFlight)
    startedAt.push(Date.now())
    await new Promise((resolve) => setTimeout(resolve, 5))
    inFlight -= 1
    return response(quoteText('sh600519'))
  }
  try {
    // 模型在一条消息里发多个调用时框架会并发执行——各自 sleep 仍会同时到达上游。
    await Promise.all([
      execute(sources.tencent_quote, { codes: ['600519.SH'] }),
      execute(sources.tencent_quote, { codes: ['600519.SH'] }),
      execute(sources.tencent_quote, { codes: ['600519.SH'] }),
    ])
    assert.equal(maxConcurrent, 1, '腾讯出口必须串行：同一时刻只允许一个请求在飞')
    assert.equal(startedAt.length, 3)
    for (const gap of [startedAt[1] - startedAt[0], startedAt[2] - startedAt[1]]) {
      assert.ok(gap >= 110, `相邻两次请求之间必须留出一个最小间隔，实测 ${gap}ms`)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('腾讯出口：信号已取消时不排队，直接原样抛 AbortError（§4.2）', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return response(quoteText('sh600519')) }
  const controller = new AbortController()
  controller.abort()
  try {
    await assert.rejects(
      sources.tencent_quote.execute(
        { capability: 'tencent_quote', params: { codes: ['600519.SH'] }, session },
        controller.signal,
      ),
      (error) => error.name === 'AbortError',
    )
    assert.equal(calls, 0, '已取消的调用不得排进节流链（队首挂住时会把这次取消吞掉）')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tencent_ticks parses paged rows and verifies continuous-session amount', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const text = String(url)
    if (text.includes('qt.gtimg.cn')) return response(quoteText('sz000001', { timestamp: '20260924100000', amount: 100, amountWan: 100 }))
    if (text.includes('p=0')) return response('v_detail_data_sz000001=[0,"0/09:30:00/10/0/1/100/M"];')
    return response('v_detail_data_sz000001=[1,""];')
  }
  try {
    const result = await execute(sources.tencent_ticks, { code: '000001.SZ' })
    assert.equal(result.data.date, '2026-09-24')
    assert.equal(result.data.rows.length, 1)
    assert.equal(result.data.rows[0].side, 'M')
    assert.deepEqual(result.data.missing_seq, [])
    assert.equal(sources.tencent_ticks.validateOutput(result.data), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
