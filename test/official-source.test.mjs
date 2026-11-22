import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOfficialSources } from '../lib/sources/official-http.js'
import { outputSchemaViolations } from './output-contract.mjs'

const session = { id: 'official-source-test', header: { cwd: '/workspace/project' } }
const signal = new AbortController().signal
const sources = createOfficialSources()
const sourceMap = () => new Map(sources.map((source) => [source.schema.capability, source]))
const source = (capability) => {
  const found = sourceMap().get(capability)
  assert.ok(found, `missing capability ${capability}`)
  return found
}

/** Minimal Response double: the produce code only reads ok / status / text(). */
function response(body, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { ok: status < 400, status, text: async () => text }
}

async function withFetch(handler, run) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => handler(String(url), init)
  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

const execute = (capability, params) => source(capability).execute({ capability, params, session }, signal)

// Host lossless-JSON rule (mirrors test/describe-dataset.test.mjs): JSON.stringify cannot stand in,
// because it drops undefined properties silently.
function assertLosslessJson(value, path = '$') {
  if (value === null) return
  const type = typeof value
  if (type === 'string' || type === 'boolean') return
  if (type === 'number') {
    assert.ok(Number.isFinite(value), `${path} 必须是有限数字（宿主拒绝 NaN/Infinity）`)
    assert.ok(!Object.is(value, -0), `${path} 不能是 -0`)
    return
  }
  assert.notEqual(type, 'undefined', `${path} 是 undefined —— 宿主会判 value is not lossless JSON`)
  assert.equal(type, 'object', `${path} 的类型 ${type} 不可 JSON 序列化`)
  if (Array.isArray(value)) {
    assert.equal(Object.getPrototypeOf(value), Array.prototype, `${path} 必须是普通数组`)
    for (let index = 0; index < value.length; index += 1) {
      assert.ok(Object.prototype.hasOwnProperty.call(value, index), `${path}[${index}] 是数组空洞`)
      assertLosslessJson(value[index], `${path}[${index}]`)
    }
    return
  }
  assert.equal(Object.getPrototypeOf(value), Object.prototype, `${path} 必须是 plain 对象`)
  for (const [key, entry] of Object.entries(value)) assertLosslessJson(entry, `${path}.${key}`)
}

function assertDeclaredOutput(capability, data) {
  const violations = outputSchemaViolations(source(capability).schema.output_schema, data)
  assert.deepEqual(violations, [], `${capability} 返回值违反自己声明的 output_schema`)
  assert.ok(source(capability).validateOutput(data), `${capability} validateOutput 拒绝了自己的返回值`)
  assertLosslessJson(data)
}

// ---- fixtures ----

const ssePage = (rows, total = rows.length) => ({ pageHelp: { total, data: rows, pageSize: 2000, pageCount: 1 }, result: rows })

const sseRow = (code, name, vol, extra = {}) => ({ STAT_DATE: '2026-11-20', ETF_TYPE: '单市', SEC_CODE: code, SEC_NAME: name, NUM: '1', TOT_VOL: vol, ...extra })

const szseTable = ({ subname = '2026-11-20', pagecount = 1, recordcount = 1, pageno = 1, error = null, rows }) => ([
  { metadata: { catalogid: '1000_lf', tabkey: 'tab1', subname, pagecount, recordcount, pageno, pagesize: 20 }, data: rows, error },
  { metadata: { tabkey: 'tab2', subname: '', pagecount: 0, recordcount: 0 }, data: [], error: null },
])

const szseRow = (code, name, scale, extra = {}) => ({
  sys_key: `<a href='http://fund.szse.cn/marketdata/trade/index.html?code=${code}' target='_blank'><u>${code}</u></a>`,
  jjjcurl: `<a href='http://fund.szse.cn/disclosurelist/index.html?stock=${code}&name=${name}' target='_blank'><u>${name}</u></a>`,
  jjlb: 'ETF',
  tzlb: '股票基金',
  ssrq: '2006-04-24',
  dqgm: `<a href='javascript:void(0);' a-param='x'>${scale}</a>`,
  glrmc: '测试基金管理有限公司',
  zxjjjz: `<a href='javascript:void(0);'>查看</a>`,
  ...extra,
})

const FRR_CSV = '\r\n2026-11-20,,,,,,1.37,1.4,1.42\r\n2025-11-20,,,,,,1.5,1.6,1.7\r\n'
const FDR_CSV = '\r\n2026-11-20,,,,,,1.26,1.37,1.34\r\n'

const cfetsHandler = ({ frr = FRR_CSV, fdr = FDR_CSV } = {}) => (url) => response(url.includes('frr-chrt') ? frr : fdr)

// ---- schema descriptors ----

test('官方源 schema：capability 全注册，data_key / source_label / rowShape / 缓存齐备', () => {
  assert.deepEqual(sources.map((entry) => entry.schema.capability).sort(), ['chinamoney_repo_fixing', 'sse_etf_shares', 'szse_etf_shares'])
  for (const entry of sources) {
    const { schema } = entry
    assert.match(schema.name, /^get_[a-z0-9_]+$/)
    assert.equal(schema.data_key, `official.http.${schema.capability}`)
    assert.equal(schema.source, `http:official.${schema.capability}`)
    assert.equal(schema.source_label, 'official')
    assert.equal(schema.paginated, false)
    assert.deepEqual(schema.rowShape, { rootArray: true })
    assert.ok(Number.isSafeInteger(schema.cacheMaxAgeMs) && schema.cacheMaxAgeMs > 0, '缺 cacheMaxAgeMs')
    assert.ok(schema.summary.length > 0 && schema.summary.length <= 50, `summary 超 50 字：${schema.summary.length}`)
    assert.ok(schema.description.includes('⛔'), 'description 要写清约束与坑')
    assert.equal(schema.input_schema.type, 'object')
    assert.deepEqual(schema.input_schema.required, [])
    assert.equal(schema.input_schema.additionalProperties, false)
    assert.equal(schema.output_schema.type, 'array')
  }
})

test('normalizeParams 幂等：第二遍原样返回，且键名仍是模型声明过的那个（§10.7）', () => {
  const samples = {
    sse_etf_shares: [{}, { trade_date: '2026-11-20' }],
    szse_etf_shares: [{}, { trade_date: '2026-11-20' }],
    chinamoney_repo_fixing: [{}, { start_date: '2026-11-01', end_date: '2026-11-20' }, { end_date: '2026-11-20' }],
  }
  for (const [capability, paramsList] of Object.entries(samples)) {
    for (const params of paramsList) {
      const once = source(capability).normalizeParams(params)
      const twice = source(capability).normalizeParams(once)
      assert.deepEqual(twice, once, `${capability} 归一化不幂等：${JSON.stringify(params)}`)
      for (const key of Object.keys(once)) assert.ok(Object.hasOwn(params, key), `${capability} 归一化改了键名：${key}`)
    }
  }
})

test('normalizeParams 拒绝非法日期：13 月、非补零、2 月 30 日、非字符串', () => {
  for (const bad of ['2026-13-01', '2026-1-3', '2026-02-30', '20261120', '', 20261120, null]) {
    assert.throws(() => source('sse_etf_shares').normalizeParams({ trade_date: bad }), /trade_date/, `sse 接受了 ${JSON.stringify(bad)}`)
    assert.throws(() => source('szse_etf_shares').normalizeParams({ trade_date: bad }), /trade_date/, `szse 接受了 ${JSON.stringify(bad)}`)
  }
  assert.throws(() => source('chinamoney_repo_fixing').normalizeParams({ start_date: '2026-13-01' }), /start_date/)
  assert.throws(() => source('chinamoney_repo_fixing').normalizeParams({ end_date: '2026-02-30' }), /end_date/)
})

test('normalizeParams 拒绝未声明参数，且 terms 由宽表列承担（不提供 term/kind 过滤）', () => {
  assert.throws(() => source('sse_etf_shares').normalizeParams({ term: 'fr007' }), /unsupported parameter: term/)
  assert.throws(() => source('szse_etf_shares').normalizeParams({ exchange: 'SH' }), /unsupported parameter: exchange/)
  assert.throws(() => source('chinamoney_repo_fixing').normalizeParams({ kind: 'FR' }), /unsupported parameter: kind/)
  assert.throws(() => source('chinamoney_repo_fixing').normalizeParams({ start_date: '2026-11-20', end_date: '2026-11-01' }), /must not be later/)
})

// ---- sse_etf_shares ----

test('sse_etf_shares：行键名显式映射，上游 SEC_CODE/SEC_NAME/TOT_VOL/NUM 不透传（§10.6）', async () => {
  const data = await withFetch(
    () => response(ssePage([sseRow('510300', '沪深300ETF', '5518488.77', { ETF_TYPE: '跨市' })])),
    () => execute('sse_etf_shares', { trade_date: '2026-11-20' }),
  ).then((result) => result.data)
  assert.deepEqual(Object.keys(data[0]).sort(), ['etf_type', 'fund_code', 'fund_name', 'shares', 'trade_date'])
  assert.equal(data[0].trade_date, '2026-11-20')
  assert.equal(data[0].fund_code, '510300')
  assert.equal(data[0].fund_name, '沪深300ETF')
  assert.equal(data[0].etf_type, '跨市')
  for (const upstream of ['SEC_CODE', 'SEC_NAME', 'TOT_VOL', 'NUM', 'STAT_DATE', 'ETF_TYPE']) {
    assert.ok(!Object.hasOwn(data[0], upstream), `上游键名 ${upstream} 漏进了行`)
  }
  assertDeclaredOutput('sse_etf_shares', data)
})

test('sse_etf_shares：shares 由万份换算成份，字符串换算不吃浮点误差（5518488.77 → 55,184,887,700）', async () => {
  const data = await withFetch(
    () => response(ssePage([sseRow('510300', '沪深300ETF', '5518488.77'), sseRow('510010', '治理ETF', '12752.44'), sseRow('588000', '科创50', '10362866.82')])),
    () => execute('sse_etf_shares', {}),
  ).then((result) => result.data)
  assert.deepEqual(data.map((row) => row.shares), [55184887700, 127524400, 103628668200])
  for (const row of data) assert.ok(Number.isSafeInteger(row.shares), 'shares 必须是整数份')
  // 浮点乘法会把 5518488.77 判成 55184887699.99999，这条断言钉住「不许改回 * 1e4」
  assert.notEqual(5518488.77 * 1e4, data[0].shares)
})

test('sse_etf_shares：trade_date 省略时取上游标签日，不是本机今天（⛔ 不写死当日）', async () => {
  let requested = ''
  const data = await withFetch(
    (url) => { requested = url; return response(ssePage([sseRow('510300', '沪深300ETF', '100')])) },
    () => execute('sse_etf_shares', {}),
  ).then((result) => result.data)
  assert.equal(data[0].trade_date, '2026-11-20', 'trade_date 必须来自上游 STAT_DATE')
  assert.ok(!requested.includes('STAT_DATE'), `latest 模式不应传 STAT_DATE：${requested}`)
  assert.ok(requested.includes('isPagination=true'), '缺 isPagination=true 上游会回 total=0')
})

test('sse_etf_shares：非交易日/未来日回成功空数组，不伪装成失败也不是 0 行数', async () => {
  for (const day of ['2026-11-21', '2026-12-01', '2011-12-01']) {
    const data = await withFetch(() => response(ssePage([], 0)), () => execute('sse_etf_shares', { trade_date: day }))
    assert.deepEqual(data.data, [], `${day} 应回空数组`)
    assert.ok(source('sse_etf_shares').validateOutput(data.data), '空数组是合法结果')
    assertDeclaredOutput('sse_etf_shares', data.data)
  }
})

test('sse_etf_shares：latest 模式回 0 行是响亮失败（无日期查询本应解析到已发布日）', async () => {
  await withFetch(
    () => response(ssePage([], 0)),
    () => assert.rejects(() => execute('sse_etf_shares', {}), /latest-snapshot query returned 0 rows/),
  )
})

test('sse_etf_shares：行数 != pageHelp.total 时失败，不返回不完整快照', async () => {
  await withFetch(
    () => response(ssePage([sseRow('510300', '沪深300ETF', '100')], 927)),
    () => assert.rejects(() => execute('sse_etf_shares', { trade_date: '2026-11-20' }), /pageHelp\.total=927/),
  )
})

test('sse_etf_shares：同日代码重复失败，不把重复当完整快照', async () => {
  await withFetch(
    () => response(ssePage([sseRow('510300', 'A', '100'), sseRow('510300', 'A', '200')])),
    () => assert.rejects(() => execute('sse_etf_shares', { trade_date: '2026-11-20' }), /repeats 510300/),
  )
})

test('sse_etf_shares：返回日期与请求日期不一致失败（防上游改版换日）', async () => {
  await withFetch(
    () => response(ssePage([sseRow('510300', 'A', '100', { STAT_DATE: '2026-11-19' })])),
    () => assert.rejects(() => execute('sse_etf_shares', { trade_date: '2026-11-20' }), /returned 2026-11-19 for requested 2026-11-20/),
  )
})

test('sse_etf_shares：响应丢 pageHelp 或 TOT_VOL 非数字时失败', async () => {
  await withFetch(
    () => response({ result: null }),
    () => assert.rejects(() => execute('sse_etf_shares', {}), /lost pageHelp/),
  )
  await withFetch(
    () => response(ssePage([sseRow('510300', 'A', '—')])),
    () => assert.rejects(() => execute('sse_etf_shares', { trade_date: '2026-11-20' }), /not a non-negative 万份 value/),
  )
})

// ---- szse_etf_shares ----

test('szse_etf_shares：内嵌 HTML 三列解析 + 千分位份额换算（2,156,781.66 万份 → 21,567,816,600 份）', async () => {
  const data = await withFetch(
    () => response(szseTable({ recordcount: 1, rows: [szseRow('159919', '沪深300ETF嘉实', '2,156,781.66')] })),
    () => execute('szse_etf_shares', {}),
  ).then((result) => result.data)
  assert.equal(data.length, 1)
  assert.deepEqual(Object.keys(data[0]).sort(), ['fund_category', 'fund_code', 'fund_name', 'listing_date', 'manager', 'shares', 'trade_date'])
  assert.equal(data[0].trade_date, '2026-11-20', 'trade_date 取 metadata.subname')
  assert.equal(data[0].fund_code, '159919')
  assert.equal(data[0].fund_name, '沪深300ETF嘉实')
  assert.equal(data[0].shares, 21567816600)
  assert.equal(data[0].listing_date, '2006-04-24')
  assert.ok(!Object.hasOwn(data[0], 'sys_key'), 'HTML 原列不许透传')
  assertDeclaredOutput('szse_etf_shares', data)
})

test('szse_etf_shares：trade_date 与快照日期不一致时响亮失败（⛔ 深市无历史）', async () => {
  await withFetch(
    () => response(szseTable({ rows: [szseRow('159919', 'A', '1,000.00')] })),
    () => assert.rejects(() => execute('szse_etf_shares', { trade_date: '2023-01-03' }), /only the latest snapshot \(2026-11-20\), not 2023-01-03/),
  )
  const same = await withFetch(
    () => response(szseTable({ rows: [szseRow('159919', 'A', '1,000.00')] })),
    () => execute('szse_etf_shares', { trade_date: '2026-11-20' }),
  )
  assert.equal(same.data.length, 1)
})

test('szse_etf_shares：翻页取满并核对 recordcount（上游每页固定 20 条）', async () => {
  const pageOne = Array.from({ length: 2 }, (_, index) => szseRow(String(159001 + index), `F${index}`, '1,000.00'))
  const pageTwo = [szseRow('159003', 'F2', '2,000.00')]
  const requestedPages = []
  const data = await withFetch(
    (url) => {
      const pageNo = Number(new URL(url).searchParams.get('PAGENO'))
      requestedPages.push(pageNo)
      return response(szseTable({ pagecount: 2, recordcount: 3, pageno: pageNo, rows: pageNo === 1 ? pageOne : pageTwo }))
    },
    () => execute('szse_etf_shares', {}),
  ).then((result) => result.data)
  assert.deepEqual(requestedPages, [1, 2])
  assert.equal(data.length, 3)
  assert.deepEqual(data.map((row) => row.shares), [10000000, 10000000, 20000000])
})

test('szse_etf_shares：翻页途中快照日期/总数变化、页为空、行数不符都失败', async () => {
  await withFetch(
    (url) => {
      const pageNo = Number(new URL(url).searchParams.get('PAGENO'))
      const subname = pageNo === 1 ? '2026-11-20' : '2026-11-19'
      return response(szseTable({ subname, pagecount: 2, recordcount: 2, pageno: pageNo, rows: [szseRow(pageNo === 1 ? '159001' : '159002', 'A', '1,000.00')] }))
    },
    () => assert.rejects(() => execute('szse_etf_shares', {}), /snapshot changed while paging/),
  )
  await withFetch(
    (url) => {
      const pageNo = Number(new URL(url).searchParams.get('PAGENO'))
      return response(szseTable({ pagecount: 2, recordcount: 2, pageno: pageNo, rows: pageNo === 1 ? [szseRow('159001', 'A', '1,000.00')] : [] }))
    },
    () => assert.rejects(() => execute('szse_etf_shares', {}), /page 2\/2 is empty/),
  )
  await withFetch(
    () => response(szseTable({ pagecount: 1, recordcount: 5, rows: [szseRow('159001', 'A', '1,000.00')] })),
    () => assert.rejects(() => execute('szse_etf_shares', {}), /1 rows but recordcount=5/),
  )
})

test('szse_etf_shares：ETF 过滤失效（jjlb 变 LOF）与表格级 error 都失败，不静默混入别的基金', async () => {
  await withFetch(
    () => response(szseTable({ rows: [szseRow('159001', 'A', '1,000.00', { jjlb: 'LOF' })] })),
    () => assert.rejects(() => execute('szse_etf_shares', {}), /jjlb="LOF".*ETF filter is no longer applied/),
  )
  // 实测形态：未知 CATALOGID 回一张 metadata.tabkey=null 的表，error 在表格上而不是 metadata 里
  await withFetch(
    () => response([{ metadata: { catalogid: null, tabkey: null, subname: null, pagesize: null, pageno: 0, pagecount: 0, recordcount: 0 }, data: [], error: 'noalert@显示报表数据失败' }]),
    () => assert.rejects(() => execute('szse_etf_shares', {}), /reported "noalert@显示报表数据失败"/),
  )
})

test('szse_etf_shares：HTML 形状改变时失败，不静默丢行；validateOutput 拒绝空数组', async () => {
  await withFetch(
    () => response(szseTable({ rows: [szseRow('159001', 'A', '1,000.00', { dqgm: '1,000.00' })] })),
    () => assert.rejects(() => execute('szse_etf_shares', {}), /dqgm HTML shape changed/),
  )
  assert.equal(source('szse_etf_shares').validateOutput([]), false, '深市快照永远非空，空数组应被护栏拒绝')
})

// ---- chinamoney_repo_fixing ----

test('chinamoney_repo_fixing：宽表列序固定，date 升序，FDR 早于起点为 null 不是 0', async () => {
  const data = await withFetch(cfetsHandler(), () => execute('chinamoney_repo_fixing', {})).then((result) => result.data)
  assert.deepEqual(data.map((row) => row.date), ['2025-11-20', '2026-11-20'], '输出按日期升序（上游 CSV 是降序）')
  const older = data[0]
  assert.deepEqual(older, { date: '2025-11-20', fr001: 1.5, fr007: 1.6, fr014: 1.7, fdr001: null, fdr007: null, fdr014: null })
  const newest = data[1]
  assert.deepEqual(newest, { date: '2026-11-20', fr001: 1.37, fr007: 1.4, fr014: 1.42, fdr001: 1.26, fdr007: 1.37, fdr014: 1.34 })
  assert.equal(older.fdr001, null, '⛔ FDR 缺失是 null，不是 0')
  assertDeclaredOutput('chinamoney_repo_fixing', data)
})

test('chinamoney_repo_fixing：百分数原值不换算（1.37 就是 1.37%），start_date/end_date 是本地裁剪', async () => {
  const data = await withFetch(cfetsHandler(), () => execute('chinamoney_repo_fixing', { start_date: '2026-11-20', end_date: '2026-11-20' })).then((result) => result.data)
  assert.equal(data.length, 1)
  assert.equal(data[0].fr007, 1.4)
  assert.notEqual(data[0].fr007, 0.014, '⛔ 比例值口径在这里是错的')
})

test('chinamoney_repo_fixing：区间内没有交易日回成功空数组（合法空，不是失败）', async () => {
  const data = await withFetch(cfetsHandler(), () => execute('chinamoney_repo_fixing', { start_date: '2026-11-21', end_date: '2026-11-22' }))
  assert.deepEqual(data.data, [])
  assert.ok(source('chinamoney_repo_fixing').validateOutput([]), '空数组是合法结果')
})

test('chinamoney_repo_fixing：CSV 列数/中间列变化、空利率、重复日期、空文件都失败', async () => {
  await withFetch(
    cfetsHandler({ frr: '\r\n2026-11-20,,,,,,,1.4,1.42,1.5\r\n' }),
    () => assert.rejects(() => execute('chinamoney_repo_fixing', {}), /layout changed/),
  )
  await withFetch(
    cfetsHandler({ frr: '\r\n2026-11-20,,,,,x,1.4,1.5,1.6\r\n' }),
    () => assert.rejects(() => execute('chinamoney_repo_fixing', {}), /layout changed/),
  )
  await withFetch(
    cfetsHandler({ frr: '\r\n2026-11-20,,,,,,,1.4,1.42\r\n' }),
    () => assert.rejects(() => execute('chinamoney_repo_fixing', {}), /FR001 2026-11-20 is not a numeric percent value/),
  )
  await withFetch(
    cfetsHandler({ frr: '\r\n2026-11-20,,,,,,1.4,1.5,1.6\r\n2026-11-20,,,,,,1.4,1.5,1.6\r\n' }),
    () => assert.rejects(() => execute('chinamoney_repo_fixing', {}), /repeats 2026-11-20/),
  )
  await withFetch(
    cfetsHandler({ frr: '\r\n' }),
    () => assert.rejects(() => execute('chinamoney_repo_fixing', {}), /FR CSV returned no rows/),
  )
})

test('chinamoney_repo_fixing：上游 HTTP 失败响亮失败，不当空结果', async () => {
  await withFetch(
    () => response('not found', 404),
    () => assert.rejects(() => execute('chinamoney_repo_fixing', {}), /HTTP 404/),
  )
})
