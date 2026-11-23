/**
 * ths_hot_list / ths_limit_up_detail 验收：注册形状、显式字段映射（tag 两层、Unix 秒→HH:MM:SS、
 * seal_rate 小数）、空 vs 失败、参数层拒绝与输出护栏。fixtures 是按 2026-11-22 实测报文裁出来的。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createThsSources } from '../lib/sources/ths-http.js'
import { outputSchemaViolations } from './output-contract.mjs'

const session = { id: 'ths-source-test', header: { cwd: '/workspace/project' } }
const signal = new AbortController().signal

const HOT_LIST_URL = 'https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock'
const LIMIT_UP_URL = 'https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool'
const FIELD_IDS = '199112,10,9001,330323,330324,330325,9002,330329,133971,133970,1968584,3475914,9003,9004'

function sourceOf(capability) {
  return createThsSources().find((source) => source.schema.capability === capability)
}
const hot = () => sourceOf('ths_hot_list')
const limitUp = () => sourceOf('ths_limit_up_detail')

function jsonResponse(value) {
  return { ok: true, status: 200, text: async () => JSON.stringify(value) }
}
function textResponse(text, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => text }
}
function httpError(status) {
  return { ok: false, status, text: async () => 'upstream error' }
}

async function withFetch(result, fn) {
  const requests = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init })
    assert.equal(requests.length, 1, `unexpected extra fetch: ${url}`)
    return result
  }
  try {
    return await fn(requests)
  } finally {
    globalThis.fetch = original
  }
}

async function execute(capability, params, result = jsonResponse({})) {
  const definition = sourceOf(capability)
  return withFetch(result, async (requests) => {
    const output = await definition.execute({ capability, params, session }, signal)
    return { ...output, requests }
  })
}

async function rejects(capability, params, result, code, pattern) {
  await assert.rejects(execute(capability, params, result), (error) => {
    assert.equal(error.code, code, `报错码应为 ${code}，实际 ${error.code}：${error.message}`)
    assert.match(error.message, pattern)
    return true
  })
}

/** §9.5 host mirror: undefined / NaN / Infinity / -0 / holes / non-plain objects all fail. */
function assertLosslessJson(value, path = '$') {
  if (value === null) return
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path} 不是有限数值：${String(value)}`)
    assert.ok(!Object.is(value, -0), `${path} 是 -0`)
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
    assert.notEqual(entry, undefined, `${path}.${key} 是 undefined`)
    assertLosslessJson(entry, `${path}.${key}`)
  }
}

// ---------------------------------------------------------------- live-shaped fixtures
// Verbatim subset of the 2026-11-22 17:1x payload: rate is a string, tag carries two layers,
// tag.popularity_tag is missing on some rows, rise_and_fall is a percent number.
const HOT_PAYLOAD = {
  status_code: 0,
  status_msg: 'success',
  data: {
    stock_list: [
      { market: 33, code: '002242', rate: '5007268', rise_and_fall: -7.2092, name: '九阳股份', hot_rank_chg: 0, topic: null, tag: { concept_tag: ['净水概念', '绿色电力'], popularity_tag: '持续上榜' }, order: 1, analyse: '', analyse_title: '' },
      { market: 17, code: '600722', rate: '14563.0', rise_and_fall: 2.5763, name: '金牛化工', hot_rank_chg: -2, topic: null, tag: { concept_tag: ['煤化工概念'] }, order: 2 },
      { market: 33, code: '000656', rate: '215825.0', rise_and_fall: 1.9608, name: '金科股份', hot_rank_chg: 3, topic: null, tag: {}, order: 3 },
    ],
  },
}

// First row is verbatim 2026-11-20 大东方; second row drops the optional columns seen as null
// upstream (limit_up_suc_rate null, open_num null, reason_type null) to pin that null != 0.
const LIMIT_PAYLOAD = {
  status_code: 0,
  status_msg: 'success',
  data: {
    page: { limit: 200, total: 2, count: 1, page: 1 },
    info: [
      { open_num: 3, first_limit_up_time: '1795144339', last_limit_up_time: '1795157359', code: '600327', limit_up_type: '换手板', order_volume: 3243000, is_new: 0, limit_up_suc_rate: 0.8, currency_value: 4273485100, market_id: 17, is_again_limit: 1, change_rate: 10.0228, turnover_rate: 27.7729, reason_type: '百货零售+医疗服务+“东方系”', order_amount: 15663690, high_days: '首板', name: '大东方', high_days_value: 65537, change_tag: 'LIMIT_BACK', market_type: 'HS', latest: 4.83, time_preview: [0, 1] },
      { open_num: null, first_limit_up_time: '1795137900', last_limit_up_time: '1795137900', code: '688433', limit_up_type: '一字板', order_volume: 37130, is_new: 0, limit_up_suc_rate: null, currency_value: 16047083000, market_id: 17, is_again_limit: 0, change_rate: 19.994, turnover_rate: 5.0992, reason_type: null, order_amount: 2948122, high_days: '首板', name: '华曙高科', high_days_value: 65537, change_tag: 'FIRST_LIMIT', market_type: 'STAR', latest: 79.4 },
    ],
    date: '20261120',
    msg: null,
    trade_status: { id: 'non_trading_day', name: '非交易日', start_time: '00:00', end_time: '23:59:59.999' },
    limit_up_count: { today: { num: 28, history_num: 35, rate: 0.8, open_num: 7 }, yesterday: { num: 23, history_num: 47, rate: 0.48936170212765956, open_num: 24 } },
    limit_down_count: { today: { num: 0, history_num: 0, rate: null, open_num: 0 }, yesterday: { num: 58, history_num: 80, rate: 0.725, open_num: 22 } },
  },
}

const HOT_ROW = {
  rank: 1,
  code: '002242',
  name: '九阳股份',
  rank_change: 0,
  heat: '5007268',
  change_pct: -7.2092,
  concepts: ['净水概念', '绿色电力'],
  popularity_tag: '持续上榜',
}

const LIMIT_ROW = {
  trade_date: '2026-11-20',
  code: '600327',
  name: '大东方',
  price: 4.83,
  change_pct: 10.0228,
  reason: '百货零售+医疗服务+“东方系”',
  board_type: '换手板',
  seal_rate: 0.8,
  break_times: 3,
  seal_amount: 15663690,
  seal_volume: 3243000,
  high_days: '首板',
  first_seal: '11:12:19',
  last_seal: '14:49:19',
  is_again: 1,
  turnover_rate_pct: 27.7729,
}

// ---------------------------------------------------------------- registration shape
test('注册形状：两能力、get_ 前缀、source/data_key/source_label、分页、缓存与时间轴注册', () => {
  const sources = createThsSources()
  assert.deepEqual(sources.map((source) => source.schema.capability).sort(), ['ths_hot_list', 'ths_limit_up_detail'])
  for (const definition of sources) {
    const { schema } = definition
    assert.match(schema.name, /^get_ths_/)
    assert.equal(schema.source, `http:ths.${schema.capability}`)
    assert.equal(schema.data_key, `ths.http.${schema.capability}`)
    assert.equal(schema.source_label, 'ths')
    assert.deepEqual(schema.rowShape, { rootArray: true })
    assert.ok(schema.summary.length <= 50, `summary 超过 50 字：${schema.summary}`)
    assert.ok(schema.cacheMaxAgeMs >= 30_000 && schema.cacheMaxAgeMs <= 300_000)
    assert.equal(schema.input_schema.type, 'object', '§9.1 根只能是 object')
    assert.equal(schema.input_schema.additionalProperties, false)
    assert.equal(Object.hasOwn(schema.input_schema, 'oneOf'), false)
    assert.equal(Object.hasOwn(schema.input_schema, 'anyOf'), false)
    assert.deepEqual(schema.input_schema.required, [])
    assert.equal(schema.output_schema.type, 'array')
    assert.equal(schema.output_schema.items.additionalProperties, false)
    for (const key of Object.keys(schema.output_schema.items.properties)) assert.match(key, /^[a-z][a-z0-9_]*$/)
  }
  // 时间轴住在 src/time/tools.ts：热榜是查询时点快照没有 date 参数；涨停揭秘的 date 有契约。
  assert.equal(hot().schema.time_contract, undefined)
  assert.deepEqual(limitUp().schema.time_contract?.fields, ['date'])
  assert.equal(limitUp().schema.time_contract?.kind, 'date')
  assert.equal(hot().schema.paginated, false)
  assert.equal(limitUp().schema.paginated, true)
  assert.equal(hot().schema.cacheMaxAgeMs, 30_000)
  assert.equal(limitUp().schema.cacheMaxAgeMs, 60_000)
  assert.ok(hot().schema.description.length > 500)
  assert.ok(limitUp().schema.description.length > 500)
})

test('description 点明与 Fuyao 的分工、北交所/ST 缺口、快照无历史与反爬失败语义', () => {
  const hotDescription = hot().schema.description
  assert.match(hotDescription, /Fuyao `hot_stock_list`/)
  assert.match(hotDescription, /没有概念标签 \/ 人气标签/)
  assert.match(hotDescription, /逐行一致/)
  assert.match(hotDescription, /禁止混用/)
  assert.match(hotDescription, /无分页/)
  assert.match(hotDescription, /hot_stock_history/)
  const limitDescription = limitUp().schema.description
  assert.match(limitDescription, /Fuyao `limit_up_pool`/)
  assert.match(limitDescription, /没有板型 \/ 封板成功率 \/ 是否回封/)
  assert.match(limitDescription, /不含北交所/)
  assert.match(limitDescription, /不含 ST 涨停/)
  assert.match(limitDescription, /Unix 秒/)
  assert.match(limitDescription, /不是东财四池的 HHMMSS 整数/)
  assert.match(limitDescription, /null 不是 0/)
  assert.match(limitDescription, /回落到最后一页/)
  assert.match(limitDescription, /行内 `trade_date` 就是上游 data.date/, '行内交易日要写进 description，消费方才知道能自证业务日')
  assert.match(limitDescription, /trade_status 是\*\*查询时刻\*\*/)
})

// ---------------------------------------------------------------- normalize
test('normalizeParams：默认值落盘、日期 YYYYMMDD→YYYY-MM-DD、双跑幂等且键名不变', () => {
  const hotDefinition = hot()
  assert.deepEqual(hotDefinition.normalizeParams({}), { type: 'day' })
  assert.deepEqual(hotDefinition.normalizeParams({ type: ' HOUR ' }), { type: 'hour' })
  const hotOnce = hotDefinition.normalizeParams({ type: 'hour' })
  assert.deepEqual(hotDefinition.normalizeParams(hotOnce), hotOnce)

  const limitDefinition = limitUp()
  assert.deepEqual(limitDefinition.normalizeParams({}), { page: 1, size: 200 })
  const limitOnce = limitDefinition.normalizeParams({ date: '20261120', page: 2, size: 50 })
  assert.deepEqual(limitOnce, { page: 2, size: 50, date: '2026-11-20' })
  assert.deepEqual(limitDefinition.normalizeParams(limitOnce), limitOnce, '第二遍输入是第一遍输出')
  // 只允许声明过的键：把 date 改名成 data.date 那类内部叫法会在第二遍被拒。
  for (const key of Object.keys(limitOnce)) assert.ok(Object.hasOwn(limitDefinition.schema.input_schema.properties, key))
  assert.deepEqual(Object.keys(limitDefinition.normalizeParams({ date: '2026-11-20' })).sort(), ['date', 'page', 'size'])
})

test('normalizeParams：非法参数在参数层拒绝（不发请求）', () => {
  assert.throws(() => hot().normalizeParams({ type: 'week' }), /type must be one of day, hour/)
  assert.throws(() => hot().normalizeParams({ foo: 1 }), /unsupported parameter: foo/)
  assert.throws(() => hot().normalizeParams(null), /params must be an object/)
  assert.throws(() => limitUp().normalizeParams({ size: 201 }), /size must be an integer from 1 to 200/)
  assert.throws(() => limitUp().normalizeParams({ size: 0 }), /size must be an integer from 1 to 200/)
  assert.throws(() => limitUp().normalizeParams({ size: 1.5 }), /size must be an integer/)
  assert.throws(() => limitUp().normalizeParams({ page: 0 }), /page must be an integer >= 1/)
  assert.throws(() => limitUp().normalizeParams({ page: 'x' }), /page must be an integer/)
  assert.throws(() => limitUp().normalizeParams({ date: '2026/11/20' }), /parameter date/)
  assert.throws(() => limitUp().normalizeParams({ date: '2026112' }), /parameter date/)
  assert.throws(() => limitUp().normalizeParams({ date: '2026-02-30' }), /parameter date/)
  assert.throws(() => limitUp().normalizeParams({ date: 20261120 }), /parameter date/)
  assert.throws(() => limitUp().normalizeParams({ foo: 1 }), /unsupported parameter: foo/)
})

// ---------------------------------------------------------------- hot list mapping
test('热榜：URL/UA 正确，tag 两层显式映射，heat 保留原字符串，无标签为空数组、pop 缺失为 null', async () => {
  const { data, requests } = await execute('ths_hot_list', { type: 'hour' }, jsonResponse(HOT_PAYLOAD))
  const url = new URL(requests[0].url)
  assert.equal(url.origin + url.pathname, HOT_LIST_URL)
  assert.equal(url.searchParams.get('stock_type'), 'a')
  assert.equal(url.searchParams.get('type'), 'hour')
  assert.equal(url.searchParams.get('list_type'), 'normal')
  assert.equal(requests[0].init.headers['User-Agent'], 'Mozilla/5.0')
  assert.deepEqual(data, [
    { rank: 1, code: '002242', name: '九阳股份', rank_change: 0, heat: '5007268', change_pct: -7.2092, concepts: ['净水概念', '绿色电力'], popularity_tag: '持续上榜' },
    { rank: 2, code: '600722', name: '金牛化工', rank_change: -2, heat: '14563.0', change_pct: 2.5763, concepts: ['煤化工概念'], popularity_tag: null },
    { rank: 3, code: '000656', name: '金科股份', rank_change: 3, heat: '215825.0', change_pct: 1.9608, concepts: [], popularity_tag: null },
  ])
  // 上游的 market / topic / analyse / analyse_title 不进行；行上不许多一个键。
  assert.equal(Object.keys(data[0]).length, 8)
  assert.deepEqual(outputSchemaViolations(hot().schema.output_schema, data), [])
  assert.equal(hot().validateOutput(data), true)
  assertLosslessJson(data)
})

test('热榜：省略 type 默认 day；升序行序保持上游顺序（不重排）', async () => {
  const payload = structuredClone(HOT_PAYLOAD)
  payload.data.stock_list = [payload.data.stock_list[1], payload.data.stock_list[0]]
  const { data, requests } = await execute('ths_hot_list', {}, jsonResponse(payload))
  const url = new URL(requests[0].url)
  assert.equal(url.searchParams.get('type'), 'day')
  assert.deepEqual(data.map((row) => row.code), ['600722', '002242'])
  assert.deepEqual(data.map((row) => row.rank), [2, 1])
})

test('热榜：stock_list 为空是合法空结果，不抛错且护栏放行', async () => {
  const { data } = await execute('ths_hot_list', { type: 'day' }, jsonResponse({ status_code: 0, status_msg: 'success', data: { stock_list: [] } }))
  assert.deepEqual(data, [])
  assert.equal(hot().validateOutput(data), true)
})

test('热榜失败语义：status_code 非 0 / {code,msg} / HTTP 401 / 非 JSON / 缺 stock_list 都响亮失败', async () => {
  await rejects('ths_hot_list', {}, jsonResponse({ status_code: -1, status_msg: 'Param Error.', data: null }), 'ths_upstream_error', /Param Error/)
  await rejects('ths_hot_list', {}, jsonResponse({ code: -1, msg: 'Param Error.' }), 'ths_upstream_error', /Param Error/)
  await rejects('ths_hot_list', {}, httpError(401), 'ths_http_error', /HTTP 401.*anti-crawl/)
  await rejects('ths_hot_list', {}, httpError(429), 'ths_rate_limit', /HTTP 429/)
  await rejects('ths_hot_list', {}, textResponse('<html>challenge</html>'), 'ths_invalid_response', /non-JSON/)
  await rejects('ths_hot_list', {}, jsonResponse({ status_code: 0, data: {} }), 'ths_invalid_response', /stock_list/)
  await rejects('ths_hot_list', {}, jsonResponse({ status_code: 0, data: { stock_list: [{ order: 1, code: '002242' }] } }), 'ths_invalid_response', /empty name/)
  await rejects('ths_hot_list', {}, jsonResponse({ status_code: 0, data: { stock_list: [{ order: 1, code: '002242', name: 'x', rate: 5007268, hot_rank_chg: 0, rise_and_fall: 1, tag: {} }] } }), 'ths_invalid_response', /unreadable rate/)
})

// ---------------------------------------------------------------- limit-up mapping
test('涨停揭秘：URL 固定 14 个字段 ID/filter/order 与分页参数，Unix 秒→北京时间 HH:MM:SS', async () => {
  const { data, requests } = await execute('ths_limit_up_detail', { date: '20261120' }, jsonResponse(LIMIT_PAYLOAD))
  const url = new URL(requests[0].url)
  assert.equal(url.origin + url.pathname, LIMIT_UP_URL)
  assert.equal(url.searchParams.get('field'), FIELD_IDS)
  assert.equal(url.searchParams.get('filter'), 'HS,GEM2STAR')
  assert.equal(url.searchParams.get('order_field'), '330324')
  assert.equal(url.searchParams.get('order_type'), '0')
  assert.equal(url.searchParams.get('page'), '1')
  assert.equal(url.searchParams.get('limit'), '200')
  assert.equal(url.searchParams.get('date'), '20261120')
  assert.equal(requests[0].init.headers['User-Agent'], 'Mozilla/5.0')
  assert.deepEqual(data, [
    LIMIT_ROW,
    {
      trade_date: '2026-11-20',
      code: '688433',
      name: '华曙高科',
      price: 79.4,
      change_pct: 19.994,
      reason: null,
      board_type: '一字板',
      seal_rate: null,
      break_times: null,
      seal_amount: 2948122,
      seal_volume: 37130,
      high_days: '首板',
      first_seal: '09:25:00',
      last_seal: '09:25:00',
      is_again: 0,
      turnover_rate_pct: 5.0992,
    },
  ])
  assert.deepEqual(outputSchemaViolations(limitUp().schema.output_schema, data), [])
  assert.equal(limitUp().validateOutput(data), true)
  assertLosslessJson(data)
})

test('涨停揭秘：省略 date 不下发 date 参数；显式 YYYY-MM-DD 与 YYYYMMDD 等价', async () => {
  const omitted = await execute('ths_limit_up_detail', {}, jsonResponse(LIMIT_PAYLOAD))
  assert.equal(new URL(omitted.requests[0].url).searchParams.get('date'), null)
  assert.deepEqual([...new Set(omitted.data.map((row) => row.trade_date))], ['2026-11-20'], '省略 date 时行内 trade_date 仍是上游最近交易日')
  const compact = await execute('ths_limit_up_detail', { date: '20261120', page: 1, size: 200 }, jsonResponse(LIMIT_PAYLOAD))
  assert.deepEqual(compact.data, omitted.data)
  const dashed = await execute('ths_limit_up_detail', { date: '2026-11-20' }, jsonResponse(LIMIT_PAYLOAD))
  assert.equal(new URL(dashed.requests[0].url).searchParams.get('date'), '20261120')
})

test('涨停揭秘：15:00:00 收盘封板与跨日校验（时间戳日期必须等于 data.date）', async () => {
  const payload = structuredClone(LIMIT_PAYLOAD)
  payload.data.page.total = 1
  payload.data.info = [{ ...LIMIT_PAYLOAD.data.info[1], first_limit_up_time: '1767596400', last_limit_up_time: '1767596400' }]
  payload.data.date = '20260105'
  const { data } = await execute('ths_limit_up_detail', { date: '2026-01-05' }, jsonResponse(payload))
  assert.equal(data[0].first_seal, '15:00:00', 'Unix 1767596400 -> 2026-01-05 15:00:00 北京')

  // 时间戳落在别的日期（上游忽略了 date）必须是结构异常，不能只输出 HH:MM:SS 丢掉日期。
  const mismatched = structuredClone(payload)
  mismatched.data.date = '20260106'
  await rejects('ths_limit_up_detail', { date: '2026-01-06' }, jsonResponse(mismatched), 'ths_invalid_response', /falls on 2026-01-05/)
})

test('涨停揭秘：合法空（非交易日 total=0/info=[]，page 回显 0）返回 []，与失败分开', async () => {
  const empty = {
    status_code: 0,
    status_msg: 'success',
    data: {
      page: { limit: 200, total: 0, count: 0, page: 0 },
      info: [],
      date: '20261121',
      msg: null,
      trade_status: { id: 'non_trading_day', name: '非交易日', start_time: '00:00', end_time: '23:59:59.999' },
      limit_up_count: { today: { num: 0, history_num: 0, rate: null, open_num: 0 }, yesterday: { num: 28, history_num: 35, rate: 0.8, open_num: 7 } },
      limit_down_count: { today: { num: 0, history_num: 0, rate: null, open_num: 0 }, yesterday: { num: 58, history_num: 80, rate: 0.725, open_num: 22 } },
    },
  }
  const { data } = await execute('ths_limit_up_detail', { date: '2026-11-21' }, jsonResponse(empty))
  assert.deepEqual(data, [])
  assert.equal(limitUp().validateOutput(data), true)
})

test('涨停揭秘失败语义：status_code=-1 / HTTP 5xx / 非 JSON / 结构缺失都响亮失败', async () => {
  await rejects('ths_limit_up_detail', { date: '2025-01-02' }, jsonResponse({ status_code: -1, status_msg: 'date参数不合法' }), 'ths_upstream_error', /date参数不合法/)
  await rejects('ths_limit_up_detail', {}, jsonResponse({ status_code: -1, status_msg: 'limitmust be less than or equal to 200' }), 'ths_upstream_error', /limitmust/)
  await rejects('ths_limit_up_detail', {}, httpError(502), 'ths_http_error', /HTTP 502/)
  await rejects('ths_limit_up_detail', {}, httpError(403), 'ths_http_error', /anti-crawl/)
  await rejects('ths_limit_up_detail', {}, textResponse('not json'), 'ths_invalid_response', /non-JSON/)
  await rejects('ths_limit_up_detail', {}, jsonResponse({ status_code: 0 }), 'ths_invalid_response', /no data object/)
  await rejects('ths_limit_up_detail', {}, jsonResponse({ status_code: 0, data: { ...LIMIT_PAYLOAD.data, page: undefined } }), 'ths_invalid_response', /data.page/)
  await rejects('ths_limit_up_detail', {}, jsonResponse({ status_code: 0, data: { ...LIMIT_PAYLOAD.data, info: undefined } }), 'ths_invalid_response', /data.info/)
  await rejects('ths_limit_up_detail', {}, jsonResponse({ status_code: 0, data: { ...LIMIT_PAYLOAD.data, date: '2026-11-20' } }), 'ths_invalid_response', /unreadable data.date/)
})

test('涨停揭秘防改版：date 回显、page 回显、limit 回显、seal_rate 越界、字段缺失都失败', async () => {
  // 上游忽略 date（回的是别的交易日）
  const ignoredDate = structuredClone(LIMIT_PAYLOAD)
  ignoredDate.data.date = '20261119'
  await rejects('ths_limit_up_detail', { date: '2026-11-20' }, jsonResponse(ignoredDate), 'ths_invalid_response', /ignored date/)

  // 超界 page 上游回落到最后一页：不能静默把第一页当第 9 页交出去
  const clamped = structuredClone(LIMIT_PAYLOAD)
  clamped.data.page.page = 1
  await rejects('ths_limit_up_detail', { date: '2026-11-20', page: 9, size: 200 }, jsonResponse(clamped), 'ths_page_out_of_range', /asked for page 9/)

  // size 被上游改写
  const resized = structuredClone(LIMIT_PAYLOAD)
  resized.data.page.limit = 100
  await rejects('ths_limit_up_detail', { date: '2026-11-20', size: 200 }, jsonResponse(resized), 'ths_invalid_response', /asked for size 200/)

  // seal_rate 只能是 0~1 小数；80 是百分数写法，拒绝
  const badRate = structuredClone(LIMIT_PAYLOAD)
  badRate.data.info[0].limit_up_suc_rate = 80
  await rejects('ths_limit_up_detail', { date: '2026-11-20' }, jsonResponse(badRate), 'ths_invalid_response', /outside 0\.\.1/)

  // 核心价格列缺失
  const noPrice = structuredClone(LIMIT_PAYLOAD)
  delete noPrice.data.info[0].latest
  await rejects('ths_limit_up_detail', { date: '2026-11-20' }, jsonResponse(noPrice), 'ths_invalid_response', /missing latest/)

  // total>0 但 info=[] 是结构矛盾，不是合法空
  const contradiction = structuredClone(LIMIT_PAYLOAD)
  contradiction.data.info = []
  await rejects('ths_limit_up_detail', { date: '2026-11-20' }, jsonResponse(contradiction), 'ths_invalid_response', /returned 0 rows/)

  // 反向矛盾：total=0 却带行，同样不能当合法空吞掉
  const reverseContradiction = structuredClone(LIMIT_PAYLOAD)
  reverseContradiction.data.page.total = 0
  await rejects('ths_limit_up_detail', { date: '2026-11-20' }, jsonResponse(reverseContradiction), 'ths_invalid_response', /says total=0 but returned 2 rows/)
})

// ---------------------------------------------------------------- output guard
test('validateOutput：拒绝多一个键、错类型、百分数写法与非法时间形状，空数组放行', () => {
  assert.equal(hot().validateOutput([HOT_ROW]), true)
  assert.equal(hot().validateOutput([{ ...HOT_ROW, extra: 1 }]), false)
  assert.equal(hot().validateOutput([{ ...HOT_ROW, heat: 5007268 }]), false)
  assert.equal(hot().validateOutput([{ ...HOT_ROW, concepts: '净水概念' }]), false)
  assert.equal(hot().validateOutput([{ ...HOT_ROW, rank: 0 }]), false)
  assert.equal(hot().validateOutput([{ ...HOT_ROW, popularity_tag: '' }]), false)
  assert.equal(hot().validateOutput([{ ...HOT_ROW, change_pct: Number.NaN }]), false)

  assert.equal(limitUp().validateOutput([LIMIT_ROW]), true)
  assert.equal(limitUp().validateOutput([{ ...LIMIT_ROW, extra: null }]), false)
  assert.equal(limitUp().validateOutput([{ ...LIMIT_ROW, seal_rate: 80 }]), false)
  assert.equal(limitUp().validateOutput([{ ...LIMIT_ROW, first_seal: '111219' }]), false)
  assert.equal(limitUp().validateOutput([{ ...LIMIT_ROW, trade_date: '2026/11/20' }]), false, 'trade_date 必须是 YYYY-MM-DD')
  assert.equal(limitUp().validateOutput([{ ...LIMIT_ROW, trade_date: '2026-02-30' }]), false, 'trade_date 必须是日历日')
  assert.equal(limitUp().validateOutput([{ ...LIMIT_ROW, last_seal: '24:00:00' }]), false)
  assert.equal(limitUp().validateOutput([{ ...LIMIT_ROW, is_again: 2 }]), false)
  assert.equal(limitUp().validateOutput([{ ...LIMIT_ROW, break_times: -1 }]), false)
  assert.equal(limitUp().validateOutput([{ ...LIMIT_ROW, seal_volume: 1.5 }]), false)
  assert.equal(limitUp().validateOutput([{ ...LIMIT_ROW, high_days: '' }]), false)

  assert.equal(hot().validateOutput([]), true)
  assert.equal(limitUp().validateOutput([]), true)
  assert.equal(hot().validateOutput([null]), false)
  assert.equal(hot().validateOutput('rows'), false)
})

test('outputSchema 与真实映射逐形态一致（声明 required 全在行上，行上无未声明键）', () => {
  for (const [definition, row] of [[hot(), HOT_ROW], [limitUp(), LIMIT_ROW]]) {
    const item = definition.schema.output_schema.items
    assert.deepEqual(Object.keys(item.properties).sort(), Object.keys(row).sort())
    assert.deepEqual([...item.required].sort(), Object.keys(row).sort())
    assert.deepEqual(outputSchemaViolations(definition.schema.output_schema, [row]), [])
    assert.deepEqual(outputSchemaViolations(definition.schema.output_schema, []), [])
  }
})
