import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWindSources } from '../lib/sources/wind-mcp.js'
import { DataCollectorHub, buildDataKey } from '../lib/data-collector/hub.js'
import { probeTimeAxis } from '../lib/data-collector/time-axis.js'
import { getDataTimeContract, resolveDataTimeRange } from '../lib/time/tools.js'

/**
 * Wind MCP 数据源的契约回归（§6.7 改口后的 P1 三条）。
 *
 * ⛔ 这里的每份正文都是**真报文**，不是按文档编的形状（`docs/dev/tool-schema.md` §10.2：
 * 护栏拒绝真报文就是真实取数事故）。来源是 `scripts/spike-wind.mjs` 与 2026-09-18 那轮
 * 探针落盘的响应正文（`.review/wind-probe/probe3-results.json`，本地暂存、不入库），
 * 逐行原样抄在这里，只在行数上截断并标注。**截断的是行数，不是形状**。
 */

const ASHARE_DAILY = {
  // 600519.SH，begin_date 2026-08-01 / end_date 2026-08-15，period '1d'（2296ms 回执，取前 2 行）
  data: {
    columns: [
      { name: 'TIME', type: 'string' }, { name: 'OPEN', type: 'string' }, { name: 'MATCH', type: 'string' },
      { name: 'HIGH', type: 'string' }, { name: 'LOW', type: 'string' }, { name: 'TURNOVER', type: 'string' },
      { name: 'VOLUME', type: 'string' }, { name: 'CHANGEHANDRATE', type: 'string' }, { name: 'AVPRICE', type: 'string' },
    ],
    rows: [
      ['2026-08-03T00:00:00.000+08:00', '1350.60', '1358.98', '1363.35', '1346.00', '4898665275', '3614686', '0.2892', '1355.21'],
      ['2026-08-04T00:00:00.000+08:00', '1350.06', '1328.36', '1350.94', '1328.36', '5004070406', '3745031', '0.2996', '1336.19'],
    ],
    unit: { 'HIGH 单位：': '元', 'LOW 单位：': '元', 'MATCH 单位：': '元', 'OPEN 单位：': '元', 'TURNOVER 单位：': '元', 'VOLUME 单位：': '股' },
  },
  error: null,
}

const US_MINUTE = {
  // AAPL.US，get_stock_quote begin/end 2026-08-10（同一套列，美股 unit 是**美元**）；取前 2 行
  data: {
    columns: [
      { name: 'TIME', type: 'string' }, { name: 'OPEN', type: 'string' }, { name: 'MATCH', type: 'string' },
      { name: 'HIGH', type: 'string' }, { name: 'LOW', type: 'string' }, { name: 'TURNOVER', type: 'string' },
      { name: 'VOLUME', type: 'string' }, { name: 'CHANGEHANDRATE', type: 'string' }, { name: 'AVPRICE', type: 'string' },
    ],
    rows: [
      ['2026-08-10T09:30:00.000-04:00', '313.060', '306.995', '313.330', '306.120', '355851789', '4448354', '0.00', '309.876'],
      ['2026-08-10T09:31:00.000-04:00', '306.995', '305.430', '307.310', '305.140', '108188728', '546091', '0.00', '306.219'],
    ],
    unit: { 'HIGH 单位：': '美元', 'LOW 单位：': '美元', 'MATCH 单位：': '美元', 'OPEN 单位：': '美元', 'TURNOVER 单位：': '美元', 'VOLUME 单位：': '股' },
  },
  error: null,
}

const US_DAILY = {
  // AAPL.O，begin_date 2026-08-10 / end_date 2026-08-15，period '1d'；取前 2 行
  data: {
    ...US_MINUTE.data,
    rows: [
      ['2026-08-10T00:00:00.000-04:00', '306.830', '308.260', '308.260', '304.610', '13769035908', '44812503', '0.307', '307.259'],
      ['2026-08-11T00:00:00.000-04:00', '307.750', '304.910', '309.970', '302.790', '11455163178', '37476746', '0.257', '305.661'],
    ],
  },
  error: null,
}

/** 非交易日（2026-10-01..03）实测快回：ok=true、rows=[]、unit=null，columns 仍给全（§6.2）。 */
const EMPTY_TRADING_TABLE = {
  data: { columns: ASHARE_DAILY.data.columns.map((column) => ({ ...column })), rows: [], unit: null },
  error: null,
}

const EDB_SEARCH = {
  // search_economic_indicator question='中国GDP相关指标'：扁平 meta 数组，键是 camelCase
  metrics: [
    { code: 'M5567876', name: '中国:GDP:现价:当季值', unit: '亿元', source: '国家统计局', magnitude: '亿', currency: '人民币', updateDate: '20260720', beginDate: '19920331', endDate: '20260630', freq: '季' },
    { code: 'M5567879', name: '中国:GDP:现价:第三产业:当季值', unit: '亿元', source: '国家统计局', magnitude: '亿', currency: '人民币', updateDate: '20260720', beginDate: '19920331', endDate: '20260630', freq: '季' },
  ],
}

/** 2026-10-06 实测：汇率这一族的键集**没有** unit/magnitude/currency（正文未落盘，按键集重录）。 */
const EDB_SEARCH_NO_UNIT = {
  metrics: [
    { code: 'G0002329', name: '美元兑人民币', source: '美联储', updateDate: '20261006', beginDate: '19810102', endDate: '20261002', freq: '日' },
    { code: 'G0122164', name: '美元兑人民币', source: '台湾统计局', updateDate: '20261001', beginDate: '19600131', endDate: '20260930', freq: '月' },
  ],
}

const EDB_QUERY = {
  // query_economic_indicator_data question='M5567876' beginDate 2025-01-01 endDate 2025-12-31
  metrics: [{
    meta: { code: 'M5567876', name: '中国:GDP:现价:当季值', unit: '亿元', source: '国家统计局', magnitude: '亿', currency: '人民币', updateDate: '20260720', beginDate: '19920331', endDate: '20260630', freq: '季' },
    date: ['20250331', '20250630', '20250930', '20251231'],
    value: [318466.4, 341395.3, 354106.2, 387911.3],
  }],
}

/** 上游把参数性抱怨写成**纯文本**（不是 JSON）：wind-client 会原样透传 content。 */
const EDB_MISSING_WINDOW = 'observation或者[beginDate、endDate]必须填一个'

const signal = new AbortController().signal
const session = { id: 'wind-source-test', header: { cwd: '/workspace/project' } }

function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url: String(url), method: body.method, params: body.params })
    return { ok: true, status: 200, text: async () => handler(body, calls.length) }
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

const rpc = (result) => JSON.stringify({ jsonrpc: '2.0', id: 1, result })
const initResult = () => rpc({ protocolVersion: '2025-03-26', serverInfo: { name: 'wind-mcp-streamable-http-stateless', version: '1.25.0' } })
const tableResult = (payload) => rpc({ content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }], isError: false })

function sourcesByKey(resolveApiKey = async () => 'secret') {
  return Object.fromEntries(createWindSources(resolveApiKey).map((source) => [source.schema.capability, source]))
}

async function run(capability, params, payload, resolveApiKey) {
  const source = sourcesByKey(resolveApiKey)[capability]
  const stub = stubFetch((body) => (body.method === 'initialize' ? initResult() : tableResult(payload)))
  try {
    const result = await source.execute({ capability, params, session }, signal)
    return { result, calls: stub.calls }
  } finally {
    stub.restore()
  }
}

async function failure(capability, params, payload, resolveApiKey = async () => 'secret') {
  try {
    await run(capability, params, payload, resolveApiKey)
  } catch (error) {
    return error
  }
  assert.fail(`${capability} 本应响亮失败，却安静地成功了`)
}

// ── 装配：三条都注册得上，且注册面不看 Key ─────────────────────────────────

test('createWindSources：三条能力注册齐全，data_key 与来源标注都是内部字段', () => {
  const sources = createWindSources(async () => undefined)
  assert.deepEqual(sources.map((source) => source.schema.capability), ['wind_edb_search', 'wind_edb_query', 'wind_stock_kline'])
  for (const source of sources) {
    assert.equal(source.schema.source_label, 'wind')
    assert.match(source.schema.data_key, /^wind\.mcp\.[a-z_]+\.[a-z_]+$/)
    assert.equal(source.schema.data_key, buildDataKey('wind', 'mcp', source.schema.data_key.slice('wind.mcp.'.length)))
    assert.equal(source.schema.paginated, false)
    assert.deepEqual(source.schema.rowShape, { rootArray: true })
    assert.ok(source.schema.summary.length < 60, '摘要进能力目录，必须短')
  }
  // 缺 Key 也要注册得上（§9.7⑤）：上面的 resolveApiKey 返回 undefined，三条照样在。
  assert.equal(sources.length, 3)
})

test('时间契约：EDB 不设 maxDays（宏观要能翻到几十年前），K 线分钟档靠 warning 说清楚', () => {
  assert.deepEqual(getDataTimeContract('wind_edb_query'), { kind: 'date_range', fields: ['start_date', 'end_date'] })
  assert.equal(getDataTimeContract('wind_stock_kline').maxDays, 3660)
  assert.match(getDataTimeContract('wind_stock_kline').warning, /分钟档/)
  // query_hint 只给检索类：带真实日期参数的 wind_* 不能再吃到那句"X 至 Y"。
  const resolved = resolveDataTimeRange({ capability: 'wind_stock_kline', period: 'last_3_months' }, Date.parse('2026-10-06T00:00:00Z'))
  assert.deepEqual(resolved.params, { start_date: '2026-07-06', end_date: '2026-10-06' })
  assert.equal(resolved.query_hint, undefined, '取数能力不该收到检索用的时间提示语')
  const docs = resolveDataTimeRange({ capability: 'wind_docs_news', period: 'last_3_months' }, Date.parse('2026-10-06T00:00:00Z'))
  assert.equal(docs.query_hint, '2026-07-06 至 2026-10-06')
})

// ── K 线：真报文转置、单位、逐行偏移 ───────────────────────────────────────

test('wind_stock_kline：标量数组按 columns[].name 转置，MATCH 就是 close', async () => {
  const { result, calls } = await run('wind_stock_kline', { code: '600519.SH', start_date: '2026-08-01', end_date: '2026-08-15' }, ASHARE_DAILY)
  const call = calls.find((item) => item.method === 'tools/call')
  assert.equal(call.params.name, 'get_stock_kline')
  assert.deepEqual(call.params.arguments, { windcode: '600519.SH', begin_date: '2026-08-01', end_date: '2026-08-15', period: '10', aftype: '0', afdate: call.params.arguments.afdate })
  assert.deepEqual(result.data.map((row) => row.close), [1358.98, 1328.36])
  const [first] = result.data
  assert.equal(first.open, 1350.6)
  assert.equal(first.high, 1363.35)
  assert.equal(first.low, 1346)
  assert.equal(first.volume, 3614686)
  assert.equal(first.turnover, 4898665275)
  assert.equal(first.turnover_rate_pct, 0.2892)
  assert.equal(first.avg_price, 1355.21)
  assert.equal(first.code, '600519.SH')
  assert.equal(first.period, 'day')
  assert.equal(first.adjust, 'qfq')
  // unit 的键是 "HIGH 单位："（空格 + 全角冒号），逐列原文摘进行里，不翻译。
  assert.equal(first.price_unit, '元')
  assert.equal(first.amount_unit, '元')
  assert.equal(first.volume_unit, '股')
})

test('wind_stock_kline：epoch 逐行按该行自带偏移换算，美股不许当 +08:00', async () => {
  const { result } = await run('wind_stock_kline', { code: 'AAPL.O', start_date: '2026-08-10', end_date: '2026-08-15', adjust: 'none' }, US_DAILY)
  const [row] = result.data
  assert.equal(row.datetime, '2026-08-10T00:00:00.000-04:00')
  assert.equal(row.time_ms, Date.parse('2026-08-10T00:00:00.000-04:00'))
  assert.equal(row.price_unit, '美元')
  // A 股那根的偏移不同：同一个 Dataset 里绝不共用一个 time_zone（§6.4）。
  const ashare = (await run('wind_stock_kline', { code: '600519.SH', start_date: '2026-08-01', end_date: '2026-08-15' }, ASHARE_DAILY)).result.data
  assert.notEqual(ashare[0].time_ms, row.time_ms)
  assert.equal(probeTimeAxis('time_ms', ashare.map((item) => item.time_ms)).time_zone, 'Asia/Shanghai')
  const usAxis = probeTimeAxis('time_ms', result.data.map((item) => item.time_ms))
  assert.equal(usAxis.utc_offset, '-04:00')
})

test('wind_stock_kline：分钟档同一条能力走 period，不另立入口（§6.7）', async () => {
  const { result, calls } = await run('wind_stock_kline', { code: 'AAPL.O', start_date: '2026-08-10', end_date: '2026-08-10', period: 'm1' }, US_MINUTE)
  assert.equal(calls.find((item) => item.method === 'tools/call').params.arguments.period, '1')
  assert.equal(result.data.length, 2)
  assert.equal(result.data[0].period, 'm1')
  assert.equal(result.data[0].adjust, 'none')
  assert.equal(result.data[0].time_ms, Date.parse('2026-08-10T09:30:00.000-04:00'))
})

test('wind_stock_kline：非交易日快回 0 行是合法成功，不是取数失败（§3.3/§6.2）', async () => {
  const source = sourcesByKey().wind_stock_kline
  const { result } = await run('wind_stock_kline', { code: '600519.SH', start_date: '2026-10-01', end_date: '2026-10-03' }, EMPTY_TRADING_TABLE)
  assert.deepEqual(result.data, [])
  assert.equal(source.validateOutput(result.data), true, 'validateOutput 不许把 0 行判成失败')
})

test('wind_stock_kline：薄表、缺偏移、high<low、数值不可解析一律响亮失败', async () => {
  const thin = { data: { columns: [{ name: 'Wind代码', type: 'string' }, { name: '最新交易日', type: 'string' }], rows: [['999999.SZ', '20261005']], unit: null }, error: null }
  assert.match((await failure('wind_stock_kline', { code: '999999.SZ', start_date: '2026-10-01', end_date: '2026-10-05' }, thin)).message, /no TIME column/)
  const noOffset = { data: { ...ASHARE_DAILY.data, rows: [['2026-08-03T00:00:00.000', '1', '1', '1', '1', '1', '1', '1', '1']] }, error: null }
  assert.match((await failure('wind_stock_kline', { code: '600519.SH', start_date: '2026-08-01', end_date: '2026-08-15' }, noOffset)).message, /without an explicit UTC offset/)
  const crossed = { data: { ...ASHARE_DAILY.data, rows: [['2026-08-03T00:00:00.000+08:00', '10', '10', '9', '11', '1', '1', '1', '1']] }, error: null }
  assert.match((await failure('wind_stock_kline', { code: '600519.SH', start_date: '2026-08-01', end_date: '2026-08-15' }, crossed)).message, /high < low/)
  const junk = { data: { ...ASHARE_DAILY.data, rows: [['2026-08-03T00:00:00.000+08:00', '十三50', '1', '1', '1', '1', '1', '1', '1']] }, error: null }
  assert.match((await failure('wind_stock_kline', { code: '600519.SH', start_date: '2026-08-01', end_date: '2026-08-15' }, junk)).message, /unparseable OPEN/)
  const nested = { data: { ...ASHARE_DAILY.data, rows: [['2026-08-03T00:00:00.000+08:00', ['1'], '1', '1', '1', '1', '1', '1', '1']] }, error: null }
  assert.match((await failure('wind_stock_kline', { code: '600519.SH', start_date: '2026-08-01', end_date: '2026-08-15' }, nested)).message, /returned object for OPEN/)
})

test('wind_stock_kline：INVALID 与空串按 null 处理，绝不落成 0（§1.4）', async () => {
  const withInvalid = {
    data: {
      ...ASHARE_DAILY.data,
      rows: [['2026-08-03T00:00:00.000+08:00', '1350.60', '1358.98', '1363.35', '1346.00', 'INVALID', '', 'INVALID', '1355.21']],
    },
    error: null,
  }
  const { result } = await run('wind_stock_kline', { code: '600519.SH', start_date: '2026-08-01', end_date: '2026-08-15' }, withInvalid)
  assert.equal(result.data[0].turnover, null)
  assert.equal(result.data[0].volume, null)
  assert.equal(result.data[0].turnover_rate_pct, null)
})

// ── K 线参数面：每一档都要有真报文，未验证的组合一律拒 ─────────────────────

test('wind_stock_kline：period 只放实测七档，60 分钟与未验证写法一律拒', () => {
  const source = sourcesByKey().wind_stock_kline
  const enumValues = source.schema.input_schema.properties.period.enum
  assert.deepEqual(enumValues, ['day', 'week', 'month', 'm1', 'm5', 'm15', 'm30'])
  assert.throws(() => source.normalizeParams({ code: '600519.SH', start_date: '2026-08-01', end_date: '2026-08-15', period: '60min' }), /60 分钟/)
  assert.throws(() => source.normalizeParams({ code: '600519.SH', start_date: '2026-08-01', end_date: '2026-08-15', period: '7' }), /period must be one of/)
  // 上游"未识别的 period 不报错、直接挂满 60 秒"（§6.5）——所以这里是**参数层**闸门，不是兜底。
  assert.equal(source.normalizeParams({ code: '600519.SH', start_date: '2026-08-01', end_date: '2026-08-15', period: 'DAY' }).period, 'day')
})

test('wind_stock_kline：hfq 拒绝并写明锚点理由；分钟档只允许 none；qfq 不接受未来区间', () => {
  const source = sourcesByKey().wind_stock_kline
  const base = { code: '600519.SH', start_date: '2026-08-01', end_date: '2026-08-15' }
  const minute = { code: '600519.SH', start_date: '2026-08-03', end_date: '2026-08-05' }
  assert.throws(() => source.normalizeParams({ ...base, adjust: 'hfq' }), /afdate/)
  assert.equal(source.normalizeParams(base).adjust, 'qfq')
  assert.equal(source.normalizeParams({ ...base, period: 'week' }).period, 'week')
  assert.throws(() => source.normalizeParams({ ...minute, period: 'm1', adjust: 'qfq' }), /adjust must be none for minute/)
  assert.equal(source.normalizeParams({ ...minute, period: 'm1' }).adjust, 'none')
  assert.throws(() => source.normalizeParams({ code: '600519.SH', start_date: '2099-01-01', end_date: '2099-01-05' }), /not be later than today/)
  assert.throws(() => source.normalizeParams({ ...base, count: 5 }), /parameter count is not supported/)
  assert.throws(() => source.normalizeParams({ code: '600519', start_date: '2026-08-01', end_date: '2026-08-15' }), /exchange suffix/)
  assert.throws(() => source.normalizeParams({ code: '00700.HK', start_date: '2026-08-15', end_date: '2026-08-01' }), /not be later/)
  assert.throws(() => source.normalizeParams({ ...base, bogus: 1 }), /unsupported parameter/)
  // 分钟档的区间闸门：不暴露 count，所以体积只能靠区间上限管住。
  assert.throws(() => source.normalizeParams({ code: '600519.SH', start_date: '2026-08-01', end_date: '2026-09-15', period: 'm5' }), /at most 10 days/)
})

test('wind_stock_kline：代码原样大写透传，不补也不猜交易所后缀（§6.6）', () => {
  const source = sourcesByKey().wind_stock_kline
  const normalize = (code) => source.normalizeParams({ code, start_date: '2026-08-01', end_date: '2026-08-15' }).code
  assert.equal(normalize('600519.sh'), '600519.SH')
  assert.equal(normalize(' 00700.HK '), '00700.HK')
  assert.equal(normalize('AAPL.O'), 'AAPL.O')
  assert.equal(normalize('BRK.B.N'), 'BRK.B.N')
  assert.throws(() => normalize('AAPL'), /exchange suffix/)
  // 只要求"带一个后缀"，不校验后缀词表：上游的后缀集合我们没逐个字过（实测 .O 与 .N 回同一标的），
  // 维护一份猜出来的词表只会把真写法挡在门外。
  assert.equal(normalize('600519.S'), '600519.S')
  assert.throws(() => normalize('600519.SHHE'), /exchange suffix/)
  assert.throws(() => normalize('..SH'), /exchange suffix/)
})

// ── EDB ────────────────────────────────────────────────────────────────────

test('wind_edb_search：camelCase 元信息 → snake_case 行键，缺 unit 不猜单位（§10.6）', async () => {
  const { result, calls } = await run('wind_edb_search', { question: '中国GDP相关指标' }, EDB_SEARCH)
  assert.equal(calls.find((item) => item.method === 'tools/call').params.name, 'search_economic_indicator')
  assert.deepEqual(result.data[0], {
    code: 'M5567876',
    name: '中国:GDP:现价:当季值',
    unit: '亿元',
    freq: '季',
    source: '国家统计局',
    report_date: null,
    report_date_ms: null,
    value: null,
    update_date: '2026-07-20',
    series_begin_date: '1992-03-31',
    series_end_date: '2026-06-30',
    magnitude: '亿',
    currency: '人民币',
  })
  const noUnit = (await run('wind_edb_search', { question: '人民币兑美元汇率 指标' }, EDB_SEARCH_NO_UNIT)).result.data
  assert.deepEqual(noUnit.map((row) => [row.code, row.unit, row.currency, row.freq]), [['G0002329', null, null, '日'], ['G0122164', null, null, '月']])
})

test('wind_edb_query：并行数组转置成一行一期，meta 逐行拼接', async () => {
  const { result, calls } = await run('wind_edb_query', { indicator: 'M5567876', start_date: '2025-01-01', end_date: '2025-12-31' }, EDB_QUERY)
  const call = calls.find((item) => item.method === 'tools/call')
  assert.equal(call.params.name, 'query_economic_indicator_data')
  assert.deepEqual(call.params.arguments, { question: 'M5567876', beginDate: '2025-01-01', endDate: '2025-12-31' })
  assert.equal(result.data.length, 4)
  assert.deepEqual(result.data[0], {
    code: 'M5567876',
    name: '中国:GDP:现价:当季值',
    unit: '亿元',
    freq: '季',
    source: '国家统计局',
    report_date: '2025-03-31',
    report_date_ms: Date.parse('2025-03-31T00:00:00+08:00'),
    value: 318466.4,
    update_date: '2026-07-20',
    series_begin_date: '1992-03-31',
    series_end_date: '2026-06-30',
    magnitude: '亿',
    currency: '人民币',
  })
  // 时间轴必须落在 report_date 上：meta 那三列日期若被 profile 认成轴就是话说错。
  const columns = Object.keys(result.data[0])
  assert.ok(columns.indexOf('report_date') < columns.indexOf('update_date'), 'report_date 要在 meta 日期列之前，否则 pickTimeColumn 会挑错轴')
})

test('wind_edb_query：date 与 value 长度不等、非表正文、坏期间一律响亮失败', async () => {
  const skew = { metrics: [{ meta: EDB_QUERY.metrics[0].meta, date: ['20250331', '20250630'], value: [1] }] }
  assert.match((await failure('wind_edb_query', { indicator: 'M5567876', start_date: '2025-01-01', end_date: '2025-12-31' }, skew)).message, /2 dates beside 1 values/)
  assert.match((await failure('wind_edb_query', { indicator: 'M5567876', start_date: '2025-01-01', end_date: '2025-12-31' }, EDB_MISSING_WINDOW)).message, /observation/)
  const badPeriod = { metrics: [{ meta: EDB_QUERY.metrics[0].meta, date: ['20251345'], value: [1] }] }
  assert.match((await failure('wind_edb_query', { indicator: 'M5567876', start_date: '2025-01-01', end_date: '2025-12-31' }, badPeriod)).message, /impossible date/)
  const noCode = { metrics: [{ name: '没有代码' }] }
  assert.match((await failure('wind_edb_query', { indicator: 'M5567876', start_date: '2025-01-01', end_date: '2025-12-31' }, noCode)).message, /without a code/)
})

test('wind_edb_query：observation 拒绝并给出实测理由；逗号多码在参数层就拦下', () => {
  const source = sourcesByKey().wind_edb_query
  const base = { indicator: 'M5567876', start_date: '2025-01-01', end_date: '2025-12-31' }
  assert.throws(() => source.normalizeParams({ ...base, observation: 3 }), /observation is not supported/)
  assert.throws(() => source.normalizeParams({ ...base, indicator: 'M5567876,M5567879' }), /exactly one/)
  assert.throws(() => source.normalizeParams({ ...base, indicator: '' }), /indicator is required/)
  assert.throws(() => source.normalizeParams({ ...base, start_date: '2025-13-01' }), /valid YYYY-MM-DD/)
  assert.deepEqual(source.normalizeParams(base), base)
})

// ── 错误分类：积分计费，不伪装成网络故障（§3.3/§6.6）───────────────────────

test('错误分类：五种上游失败各有稳定 code，计费类一律不自动重试', async () => {
  const cases = [
    { label: 'AUTH', respond: () => ({ ok: false, status: 401, text: async () => '' }), expect: 'wind_api_key_missing' },
    { label: 'RATE_LIMIT', respond: () => ({ ok: false, status: 429, text: async () => '' }), expect: 'wind_rate_limit' },
    { label: 'NETWORK', respond: () => ({ ok: false, status: 503, text: async () => '' }), expect: 'wind_upstream_timeout' },
    { label: 'BACKEND', respond: () => ({ ok: true, status: 200, text: async () => tableResult({ mcp_tool_error_code: 500, mcp_tool_error_msg: '后端炸了' }) }), expect: 'wind_backend_error' },
    { label: 'INVALID', respond: () => ({ ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1 }) }), expect: 'wind_invalid_response' },
  ]
  const original = globalThis.fetch
  const source = createWindSources(async () => 'secret').find((candidate) => candidate.schema.capability === 'wind_edb_query')
  try {
    for (const item of cases) {
      let call = 0
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(init.body)
        if (body.method === 'initialize') return { ok: true, status: 200, text: async () => initResult() }
        call += 1
        return item.respond()
      }
      await assert.rejects(
        () => source.execute({ capability: 'wind_edb_query', params: { indicator: 'M0000612', start_date: '2025-01-01', end_date: '2025-12-31' }, session }, signal),
        (error) => {
          assert.equal(error.code, item.expect, `${item.label} 没落到预期的 code：${error.message}`)
          assert.match(error.message, /Wind query_economic_indicator_data failed \(/, '上游分类要带上打的是哪个工具')
          return true
        },
      )
      assert.equal(call, 1, `${item.label} 之后不得再打第二次——积分按次计费（§1.4）`)
    }
    // NETWORK 的措辞不许诱导用户重试同一区间：缺数与故障在线上不可区分（§6.6）。
    globalThis.fetch = async (_url, init) => (JSON.parse(init.body).method === 'initialize'
      ? { ok: true, status: 200, text: async () => initResult() }
      : ({ ok: false, status: 504, text: async () => '' }))
    const timeout = await source.execute({ capability: 'wind_edb_query', params: { indicator: 'M0000612', start_date: '2025-01-01', end_date: '2025-12-31' }, session }, signal)
      .catch((error) => error)
    assert.match(timeout.message, /不要盲目重试同一区间/)
  } finally {
    globalThis.fetch = original
  }
})

test('缺 Key：每次调用现解析，报 wind_api_key_missing 而不是静默空结果', async () => {
  const error = await failure('wind_edb_search', { question: '中国 GDP' }, EDB_SEARCH, async () => undefined)
  assert.equal(error.code, 'wind_api_key_missing')
  assert.match(error.message, /WIND_API_KEY|Key 未配置/)
})

// ── 走 Hub 的真实入口（§9.7：单测只调 execute 会放过真缺陷）────────────────

test('Hub 路径：三条能力都能落 Dataset，行数组位置与 format 由 rowShape 决定', async () => {
  const saved = []
  const hub = new DataCollectorHub({
    store: {
      async save(input) { saved.push(input); return { dataset_id: 'd1', captured_at: 1, retention_until: 2 } },
      async findLatest() { return undefined },
    },
  })
  for (const source of createWindSources(async () => 'secret')) hub.registerSource(source)
  const requests = [
    ['wind_edb_search', { question: '中国GDP相关指标' }],
    ['wind_edb_query', { indicator: 'M5567876', start_date: '2025-01-01', end_date: '2025-12-31' }],
    ['wind_stock_kline', { code: '600519.SH', start_date: '2026-08-01', end_date: '2026-08-15' }],
  ]
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    if (body.method === 'initialize') return { ok: true, status: 200, text: async () => initResult() }
    const payload = {
      search_economic_indicator: EDB_SEARCH,
      query_economic_indicator_data: EDB_QUERY,
      get_stock_kline: ASHARE_DAILY,
    }[body.params.name]
    if (payload === undefined) throw new Error(`unexpected Wind tool called: ${body.params.name}`)
    return { ok: true, status: 200, text: async () => tableResult(payload) }
  }
  try {
    for (const [capability, params] of requests) {
      const ref = await hub.request({ capability, params, session }, { signal })
      assert.equal(ref.dataset_id, 'd1')
    }
  } finally {
    globalThis.fetch = original
  }
  assert.equal(saved.length, 3)
  assert.deepEqual(saved.map((input) => [input.capability, input.format, input.row_count, input.source_label]), [
    ['wind_edb_search', 'json_rows', 2, 'wind'],
    ['wind_edb_query', 'json_rows', 4, 'wind'],
    ['wind_stock_kline', 'json_rows', 2, 'wind'],
  ])
  // 空结果经 Hub 也是成功：0 行、json_rows，不是一条错误。
  const emptySaved = []
  const emptyHub = new DataCollectorHub({ store: { async save(input) { emptySaved.push(input); return { dataset_id: 'd0', captured_at: 1, retention_until: 2 } }, async findLatest() { return undefined } } })
  for (const source of createWindSources(async () => 'secret')) emptyHub.registerSource(source)
  const stub = stubFetch((body) => (body.method === 'initialize' ? initResult() : tableResult(EMPTY_TRADING_TABLE)))
  try {
    await emptyHub.request({ capability: 'wind_stock_kline', params: { code: '600519.SH', start_date: '2026-10-01', end_date: '2026-10-03' }, session }, { signal })
  } finally {
    stub.restore()
  }
  assert.deepEqual([emptySaved[0].row_count, emptySaved[0].format], [0, 'json_rows'])
})

test('Hub 双跑归一化：三条都不发明未声明的键，且幂等（§10.7）', () => {
  const samples = {
    wind_edb_search: { question: '  中国GDP相关指标  ' },
    wind_edb_query: { indicator: ' M5567876 ', start_date: '2025-01-01', end_date: '2025-12-31' },
    wind_stock_kline: { code: '600519.sh', start_date: '2026-08-01', end_date: '2026-08-15', period: 'Week', adjust: 'NONE' },
  }
  for (const source of createWindSources(async () => 'secret')) {
    const declared = Object.keys(source.schema.input_schema.properties).sort()
    const once = source.normalizeParams(samples[source.schema.capability])
    assert.deepEqual(Object.keys(once).filter((key) => !declared.includes(key)), [], `${source.schema.capability} 归一化发明了模型没声明的键`)
    assert.deepEqual(source.normalizeParams(once), once, `${source.schema.capability} normalizeParams 必须幂等`)
  }
})
