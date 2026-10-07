/**
 * 港美股**指数快照**那两颗能力的验收（设计文档 §3.9 / docs/dev/tool-schema.md §10.2）。
 *
 * 这一族只有一件事值得测：**我们不声明、也不映射自己证明不了的列**。
 * 2026-10-07 实测的三份指数回包（恒生系 + 纳斯达克 / 标普 / 道琼斯）里，指数的量纲列是不可读的：
 * 港 `hkHSI` 第 6 / 36 / 37 位两列相等且量级像万元，美 `usIXIC` 第 37 位是 2.1e14、
 * 第 38 / 44 / 45 / 62 / 63 位为空。所以断言的方向是"这些列**不许**出现在行里"，
 * 而不是"某列等于我编的那个数"。夹具与自选股面板共用一份（`test/tencent-fixtures.mjs`）。
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

/**
 * ⛔ 这一层必须自己挡网络：能力侧的 `execute` 走的是真 `fetch`，不 stub 就是拿单测去打上游，
 * 断言到的数会变成"此刻的行价"（第一次跑就红了：期望 24163.05、拿到实时的 24140.08）。
 */
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

/**
 * 把夹具某一行的第 `index` 位换成别的写法（畸形时刻、另一种日期分隔符都由它造）。
 * 不走整串 `replace`：搜索串错一个字符就**静默原样返回**，改没改上看不出来 ——
 * 时刻畸形那条就是这么红的（夹具今天第 30 位给横杠，搜索串却是斜杠版本，等于什么都没换）。
 */
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
    // 那两坨不可读的数（港 6390582.185 万元级、美 2.1e14）不许以**任何**键进表：不是"改个名字就能收"。
    const values = Object.values(row).filter((value) => typeof value === 'number')
    assert.equal(values.includes(6390582.185), false, '指数行的第 37 位与第 6 位实测相等且量级像万元，不许被当成成交额')
    assert.equal(values.includes(211380260921089), false, '美指数第 37 位给的是 2.1e14，任何带单位的列名都是话说错')
  }
})

test('⛔ P19：猜写法拿指数会回一只真 ETF，形状守卫必须把它拒在门外而不是静默收下', async () => {
  // `usSSPX` 上游**回行**（Janus Henderson 一只 ETF，价 31.47），但第 2 位是 `SSPX.AM`（点在中间的
  // 个股形状），不是美指数的 `.SSPX`（前导点）。所以守卫不是"有没有回行"，是回行长什么样。
  const text = tencentSnapshotText(['usSSPX'])
  assert.throws(
    () => parseOffshoreIndexRows(text, new Set(['ussspx']), 'us'),
    (error) => error.code === 'tencent_invalid_response' && /not an index code/u.test(error.message),
    '个股形状混进指数批：整份回包判为读不懂，一行都不许落价',
  )
  await assert.rejects(() => run('tencent_us_index_quote', ['SSPX']), /not an index code/u)
  // 港股那一侧同一条判据反过来也成立：五位数是个股，不是指数。
  assert.throws(() => normalizeOffshoreIndexCode('00700', 'codes', 'hk'), /five-digit codes belong to tencent_hk_quote/u)
  assert.throws(() => parseOffshoreIndexRows(tencentSnapshotText(['hk00700']), new Set(['hk00700']), 'hk'), /not an index code/u)
})

test('指数写法可逆：面板的 `IXIC.US` / 上游的 `.IXIC` / 请求的 `usIXIC` 是同一只', () => {
  for (const spelling of ['IXIC', 'ixic', 'usIXIC', '.IXIC', 'IXIC.US', 'us.IXIC']) {
    assert.equal(normalizeOffshoreIndexCode(spelling, 'codes', 'us'), 'IXIC', `${spelling} 都归到裸码 IXIC`)
  }
  assert.equal(normalizeOffshoreIndexCode('HSI', 'codes', 'hk'), 'HSI')
  assert.equal(normalizeOffshoreIndexCode('hkHSTECH', 'codes', 'hk'), 'HSTECH')
  // ⛔ 猜的那些不收：实测腾讯不认 usSPX / usNDQ / usSOX / usRUT，而 `SSPX` 认——但它回的是 ETF。
  // 参数层收不下"猜"这个动作，只收字母码本身，所以判据留给上面的回包形状核对。
  assert.equal(normalizeOffshoreIndexCode('SPX', 'codes', 'us'), 'SPX')
  assert.throws(() => normalizeOffshoreIndexCode('123456', 'codes', 'us'), /letters only/u)
  // 参数层不判"这是个股还是指数"（`AAPL.OQ` 也是纯字母加点，字面上分不开）——真正的闸是回包形状：
  // 猜出来的写法要么不回行（`tencent_empty_response`），要么回一个**个股形状**的第 2 位被判读不懂（上一条用例）。
  assert.equal(normalizeOffshoreIndexCode('AAPL.OQ', 'codes', 'us'), 'AAPL.OQ')
})

test('quote_time 两种分隔符都吃：今天实测全是 `-`，`/` 那一族由合成行补上', async () => {
  const hk = await run('tencent_hk_index_quote', ['HSI'])
  const us = await run('tencent_us_index_quote', ['IXIC'])
  assert.equal(hk[0].quote_time, '2026-10-07 14:06:21')
  assert.equal(us[0].quote_time, '2026-10-06 18:34:12')
  // 2026-10-07 这一批 13 行（港 6 / 美 7）第 30 位**都用 `-`**。内核两种都吃，依据是 2026-10-05
  // 那批里同一份响应两种分隔符并存（`offshoreQuoteTime` 的注释记的就是它）；只测今天这一半会把
  // "归一"这件事假绿掉，所以另一种写法用合成行补一条。
  const slashed = withField('hkHSI', 30, '2026/10/07 14:06:21')
  assert.equal(parseOffshoreIndexRows(slashed, new Set(['hkhsi']), 'hk')[0].quote_time, '2026-10-07 14:06:21',
    '斜杠写法归一成 `-`：内核输出与面板 tooltip 只有一种日期形状')
  // 同一批里三个美指数各自的时间不同（18:34 / 16:42 / 16:40）：那是指数口径（每个交易所有自己的
  // 收盘时刻），不是数据缺失，所以逐行原样存、不取最大值也不取最小值。
  const times = (await run('tencent_us_index_quote', ['IXIC', 'DJI', 'INX'])).map((row) => row.quote_time)
  assert.deepEqual(times, ['2026-10-06 18:34:12', '2026-10-06 16:42:37', '2026-10-06 16:40:07'])
  assert.deepEqual((await run('tencent_hk_index_quote', ['HSI', 'HSTECH', 'HSCEI', 'VHSI'])).map((row) => row.change_pct), [-0.48, -0.79, -0.64, -2.51],
    '涨跌是上游原值，一个指数没有涨跌都不自动补 0')
})

test('畸形指数行响亮失败：列数不足或时刻读不出都不补 0', () => {
  const short = `v_hkHSI="${Array.from({ length: 77 }, (_, index) => (index === 2 ? 'HSI' : '1')).join('~')}"`
  assert.throws(() => parseOffshoreIndexRows(short, new Set(['hkhsi']), 'hk'), /expected at least 78/u)
  // 时刻这一位读不出就整批失败，不猜也不补 0：面板把 quote_time 当"交易所时间"直接显示，
  // 猜一个时刻比缺一行更糟 —— 它会伪装成一条可信的报价。
  const badTime = withField('hkHSI', 30, '正在交易')
  assert.throws(() => parseOffshoreIndexRows(badTime, new Set(['hkhsi']), 'hk'), /unreadable timestamp/u)
})
