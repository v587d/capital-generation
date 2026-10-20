/**
 * HK/US index snapshot acceptance (§3.9/§10.2): emit only columns whose meaning is provable.
 * Amount-like index columns are ambiguous in real responses, so assertions forbid their presence.
 * Fixtures are shared with the watchlist panel.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTencentSources } from '../lib/sources/tencent-http.js'
import { normalizeOffshoreIndexCode, parseOffshoreIndexRows } from '../lib/sources/tencent-public-core.js'
import { tencentSnapshotText } from './tencent-fixtures.mjs'

const session = { id: 'smoke-index', header: { cwd: '/workspace/project' } }
const signal = new AbortController().signal

function response(text) {
  const bytes = new TextEncoder().encode(text)
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer }
}

function sourceMap() {
  return Object.fromEntries(createTencentSources().map((source) => [source.schema.capability, source]))
}

/** ⛔ Stub fetch here; live execute would turn assertions into current market prices. */
async function run(capability, codes) {
  const source = sourceMap()[capability]
  const normalized = source.normalizeParams({ codes })
  const original = globalThis.fetch
  globalThis.fetch = async (url) => response(tencentSnapshotText((/q=([^&]*)/u.exec(String(url))?.[1] ?? '').split(',').filter(Boolean)))
  try {
    const result = await source.execute({ capability: source.schema.capability, params: normalized, session }, signal)
    return result.data
  } finally {
    globalThis.fetch = original
  }
}

/** Mutate one fixture field positionally; string replace can silently leave data unchanged. */
function withField(symbol, index, value) {
  const match = /^(v_[^=]+=")([^"]*)"/u.exec(tencentSnapshotText([symbol]))
  const fields = match[2].split('~')
  fields[index] = value
  return `${match[1]}${fields.join('~')}"`
}

test('P18 的六种写法各一条真报文：点位、昨收、涨跌、时刻都读得出来', async () => {
  const hk = await run('tencent_hk_index_quote', ['HSI', 'HSTECH', 'HSCEI', 'VHSI'])
  assert.deepEqual(hk.map((row) => row.code), ['HSI', 'HSTECH', 'HSCEI', 'VHSI'])
  assert.deepEqual(hk.map((row) => Number(row.price.toFixed(2))), [24163.05, 4189.85, 8076.79, 17.9])
  assert.deepEqual(hk.map((row) => row.name), ['HANG SENG INDEX', 'HANG SENG TECH INDEX', 'HANG SENG CHINA ENTERPRISES', 'HSI VOLATILITY INDEX'])
  const us = await run('tencent_us_index_quote', ['IXIC', 'DJI', 'INX'])
  assert.deepEqual(us.map((row) => row.code), ['.IXIC', '.DJI', '.INX'].map((code) => code.slice(1)))
  assert.deepEqual(us.map((row) => Number(row.price.toFixed(2))), [27599.89, 51521.28, 7818.93])
  assert.deepEqual(us.map((row) => row.change_pct), [0.45, 0.49, 0.58])
})

test('⛔ 指数行里没有成交量 / 成交额 / 换手率 / 市值 / 币种 / is_stale 任何一格', async () => {
  const rows = [...await run('tencent_hk_index_quote', ['HSI']), ...await run('tencent_us_index_quote', ['IXIC'])]
  for (const row of rows) {
    for (const forbidden of ['volume_shares', 'amount_hkd', 'amount_usd', 'turnover_pct', 'market_cap_yi_hkd', 'market_cap_yi_usd', 'total_shares', 'float_shares', 'currency', 'is_stale', 'stale_reason']) {
      assert.equal(Object.hasOwn(row, forbidden), false, `${row.code} 不许带 ${forbidden}：这一列在指数行上的口径没有被证明过`)
    }
    // Ambiguous amount columns are rejected under any key; renaming does not make them trustworthy.
    const values = Object.values(row).filter((value) => typeof value === 'number')
    assert.equal(values.includes(6390582.185), false, '指数行的第 37 位与第 6 位实测相等且量级像万元，不许被当成成交额')
    assert.equal(values.includes(211380260921089), false, '美指数第 37 位给的是 2.1e14，任何带单位的列名都是话说错')
  }
})

test('⛔ P19：猜写法拿指数会回一只真 ETF，形状守卫必须把它拒在门外而不是静默收下', async () => {
  // `usSSPX` returns a row, but its second field has an individual-security shape (`SSPX.AM`),
  // so response shape—not row presence—decides whether it is an index.
  const text = tencentSnapshotText(['usSSPX'])
  assert.throws(
    () => parseOffshoreIndexRows(text, new Set(['ussspx']), 'us'),
    (error) => error.code === 'tencent_invalid_response' && /not an index code/u.test(error.message),
    '个股形状混进指数批：整份回包判为读不懂，一行都不许落价',
  )
  await assert.rejects(() => run('tencent_us_index_quote', ['SSPX']), /not an index code/u)
  // The HK inverse also holds: a five-digit code is a stock, not an index.
  assert.throws(() => normalizeOffshoreIndexCode('00700', 'codes', 'hk'), /five-digit codes belong to tencent_hk_quote/u)
  assert.throws(() => parseOffshoreIndexRows(tencentSnapshotText(['hk00700']), new Set(['hk00700']), 'hk'), /not an index code/u)
})

test('指数写法可逆：面板的 `IXIC.US` / 上游的 `.IXIC` / 请求的 `usIXIC` 是同一只', () => {
  for (const spelling of ['IXIC', 'ixic', 'usIXIC', '.IXIC', 'IXIC.US', 'us.IXIC']) {
    assert.equal(normalizeOffshoreIndexCode(spelling, 'codes', 'us'), 'IXIC', `${spelling} 都归到裸码 IXIC`)
  }
  assert.equal(normalizeOffshoreIndexCode('HSI', 'codes', 'hk'), 'HSI')
  assert.equal(normalizeOffshoreIndexCode('hkHSTECH', 'codes', 'hk'), 'HSTECH')
  // ⛔ Do not whitelist guessed variants; the response-shape checks above are the authority.
  assert.equal(normalizeOffshoreIndexCode('SPX', 'codes', 'us'), 'SPX')
  assert.throws(() => normalizeOffshoreIndexCode('123456', 'codes', 'us'), /letters only/u)
  // Parameter text cannot distinguish stocks from indices; an empty or differently shaped row fails.
  assert.equal(normalizeOffshoreIndexCode('AAPL.OQ', 'codes', 'us'), 'AAPL.OQ')
})

test('quote_time 两种分隔符都吃：今天实测全是 `-`，`/` 那一族由合成行补上', async () => {
  const hk = await run('tencent_hk_index_quote', ['HSI'])
  const us = await run('tencent_us_index_quote', ['IXIC'])
  assert.equal(hk[0].quote_time, '2026-10-07 14:06:21')
  assert.equal(us[0].quote_time, '2026-10-06 18:34:12')
  // Current responses use `-`; a synthetic `/` row tests normalization as well.
  const slashed = withField('hkHSI', 30, '2026/10/07 14:06:21')
  assert.equal(parseOffshoreIndexRows(slashed, new Set(['hkhsi']), 'hk')[0].quote_time, '2026-10-07 14:06:21',
    '斜杠写法归一成 `-`：内核输出与面板 tooltip 只有一种日期形状')
  // Different index times reflect exchange close conventions, not missing data; store rows unchanged.
  const times = (await run('tencent_us_index_quote', ['IXIC', 'DJI', 'INX'])).map((row) => row.quote_time)
  assert.deepEqual(times, ['2026-10-06 18:34:12', '2026-10-06 16:42:37', '2026-10-06 16:40:07'])
  assert.deepEqual((await run('tencent_hk_index_quote', ['HSI', 'HSTECH', 'HSCEI', 'VHSI'])).map((row) => row.change_pct), [-0.48, -0.79, -0.64, -2.51],
    '涨跌是上游原值，一个指数没有涨跌都不自动补 0')
})

test('畸形指数行响亮失败：列数不足或时刻读不出都不补 0', () => {
  const short = `v_hkHSI="${Array.from({ length: 77 }, (_, index) => (index === 2 ? 'HSI' : '1')).join('~')}"`
  assert.throws(() => parseOffshoreIndexRows(short, new Set(['hkhsi']), 'hk'), /expected at least 78/u)
  // Unreadable time fails the batch; guessing it would fabricate a trustworthy-looking quote.
  const badTime = withField('hkHSI', 30, '正在交易')
  assert.throws(() => parseOffshoreIndexRows(badTime, new Set(['hkhsi']), 'hk'), /unreadable timestamp/u)
})
