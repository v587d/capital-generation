/**
 * csindex_index_valuation 验收：normalize 双跑幂等、上游行映射、空 vs 失败、主键去重，
 * 以及「上游按 startDate 补行」这条实测怪癖不被带进输出。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCsindexSources } from '../lib/sources/csindex-http.js'
import { outputSchemaViolations } from './output-contract.mjs'

const session = { id: 'csindex-smoke', header: { cwd: '/workspace/project' } }
const signal = new AbortController().signal

function source() {
  return createCsindexSources()[0]
}

function ok(payload) {
  return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
}

function httpError(status) {
  return { ok: false, status, text: async () => 'upstream error' }
}

/** Stub the single upstream call; returns the URLs the source built. */
async function executeWith(fetchResult, params) {
  const urls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url) => { urls.push(String(url)); return fetchResult }
  try {
    const definition = source()
    const result = await definition.execute({ capability: definition.schema.capability, params, session }, signal)
    return { result, urls }
  } finally {
    globalThis.fetch = original
  }
}

const row = (tradeDate, peg, indexName = '沪深300') => ({ tradeDate, indexName, indexNameEn: 'CSI 300', peg })

test('csindex_index_valuation：注册形状、行键 ASCII snake_case、描述点明不提供 PB/股息率', () => {
  const sources = createCsindexSources()
  assert.equal(sources.length, 1)
  const definition = sources[0]
  assert.equal(definition.schema.capability, 'csindex_index_valuation')
  assert.equal(definition.schema.name, 'get_csindex_index_valuation')
  assert.equal(definition.schema.source, 'http:csindex.csindex_index_valuation')
  assert.equal(definition.schema.data_key, 'csindex.http.csindex_index_valuation')
  assert.equal(definition.schema.source_label, 'csindex')
  assert.equal(definition.schema.paginated, false)
  assert.deepEqual(definition.schema.rowShape, { rootArray: true })
  assert.equal(definition.schema.cacheMaxAgeMs, 3_600_000)
  assert.ok(definition.schema.description.length > 200)

  // ⛔ 没有的列不许承诺：JSON 只有 pe_ttm。
  assert.match(definition.schema.description, /不提供 PB/)
  assert.match(definition.schema.description, /不提供静态市盈率/)
  assert.match(definition.schema.description, /不提供股息率/)

  const properties = definition.schema.input_schema.properties
  assert.deepEqual(Object.keys(properties).sort(), ['count', 'end_date', 'index_code', 'start_date'])
  assert.deepEqual(definition.schema.input_schema.required, ['index_code', 'start_date', 'end_date'])
  assert.equal(definition.schema.input_schema.type, 'object')

  const rowSchema = definition.schema.output_schema.items
  assert.deepEqual(Object.keys(rowSchema.properties).sort(), ['date', 'index_code', 'index_name', 'pe_ttm'])
  assert.deepEqual(rowSchema.required.sort(), ['date', 'index_code', 'index_name', 'pe_ttm'])
  assert.equal(rowSchema.additionalProperties, false)
  for (const key of Object.keys(rowSchema.properties)) assert.match(key, /^[a-z][a-z0-9_]*$/)
  assert.deepEqual(outputSchemaViolations(definition.schema.output_schema, [
    { index_code: '000300', index_name: '沪深300', date: '2026-11-20', pe_ttm: 13.09 },
  ]), [])
})

test('normalize：日期/代码归一，非法参数在参数层拒绝，双跑幂等且键名不变', () => {
  const definition = source()
  const once = definition.normalizeParams({ index_code: ' 000300 ', start_date: '2026-10-01', end_date: '2026-11-20', count: 5 })
  assert.deepEqual(once, { index_code: '000300', start_date: '2026-10-01', end_date: '2026-11-20', count: 5 })
  // 上游 indexCode 区分大小写（小写回空数组），本层先转大写。
  assert.equal(definition.normalizeParams({ index_code: 'h30374', start_date: '2026-11-01', end_date: '2026-11-20' }).index_code, 'H30374')
  // 第二遍输入是第一遍输出：键名必须是模型声明过的那些，且值已被归一。
  assert.deepEqual(definition.normalizeParams(once), once)
  assert.deepEqual(Object.keys(definition.normalizeParams({ index_code: '000905', start_date: '2026-11-01', end_date: '2026-11-20' })).sort(), ['end_date', 'index_code', 'start_date'])

  assert.throws(() => definition.normalizeParams({ start_date: '2026-11-01', end_date: '2026-11-20' }), /index_code/)
  assert.throws(() => definition.normalizeParams({ index_code: '399006.SZ', start_date: '2026-11-01', end_date: '2026-11-20' }), /6-character CSI index code/)
  assert.throws(() => definition.normalizeParams({ index_code: '000300', start_date: '2026-11-01' }), /end_date must be a valid YYYY-MM-DD/)
  assert.throws(() => definition.normalizeParams({ index_code: '000300', start_date: '2026-02-30', end_date: '2026-11-20' }), /start_date must be a valid YYYY-MM-DD/)
  assert.throws(() => definition.normalizeParams({ index_code: '000300', start_date: '2026-11-20', end_date: '2026-11-01' }), /must not be later/)
  assert.throws(() => definition.normalizeParams({ index_code: '000300', start_date: '2026-11-01', end_date: '2026-11-20', count: 0 }), /count must be an integer/)
  assert.throws(() => definition.normalizeParams({ index_code: '000300', start_date: '2026-11-01', end_date: '2026-11-20', foo: 1 }), /unsupported parameter: foo/)
})

test('行映射：升序输出、日期 YYYYMMDD→YYYY-MM-DD、只留声明字段；请求起点前移 7 天避开上游补行', async () => {
  const { result, urls } = await executeWith(ok({
    code: '200', msg: 'Success', success: true,
    data: [row('20261120', 13.09), row('20261118', 13.09), row('20261119', 13.09)],
  }), { index_code: '000300', start_date: '2026-11-17', end_date: '2026-11-20' })

  assert.deepEqual(result.data, [
    { index_code: '000300', index_name: '沪深300', date: '2026-11-18', pe_ttm: 13.09 },
    { index_code: '000300', index_name: '沪深300', date: '2026-11-19', pe_ttm: 13.09 },
    { index_code: '000300', index_name: '沪深300', date: '2026-11-20', pe_ttm: 13.09 },
  ])
  assert.equal(Object.keys(result.data[0]).length, 4, '行上不许出现上游 indexNameEn 一类未声明键')
  assert.deepEqual(outputSchemaViolations(source().schema.output_schema, result.data), [])
  assert.equal(urls.length, 1)
  const url = new URL(urls[0])
  assert.equal(url.pathname, '/csindex-home/perf/indexCsiDsPe')
  assert.equal(url.searchParams.get('indexCode'), '000300')
  assert.equal(url.searchParams.get('startDate'), '20261110', 'start_date 2026-11-17 前移 7 天')
  assert.equal(url.searchParams.get('endDate'), '20261120')
})

test('上游补行怪癖：起点不是发布日时上游补的那一行不进结果，窗口外的真实行也不进', async () => {
  // 实测 2026-11-14（周六）请求会被补出 20261114；请求起点前移后这类行落在窗口外。
  const { result } = await executeWith(ok({
    code: '200', msg: 'Success', success: true,
    data: [
      row('20261107', 13.17), // 上游按「前移后的请求起点」补出来的行：窗口外，必须丢弃
      row('20261109', 13.17), // 前移窗口里的真实行：窗口外，必须丢弃
      row('20261116', 13.05),
      row('20261117', 13.05),
    ],
  }), { index_code: '000300', start_date: '2026-11-14', end_date: '2026-11-20' })
  assert.deepEqual(result.data.map((entry) => entry.date), ['2026-11-16', '2026-11-17'])
})

test('主键去重：(date, index_code) 重复同值只留一行，重复不同值判上游结构异常', async () => {
  const duplicated = ok({
    code: '200', msg: 'Success', success: true,
    data: [row('20261120', 13.09), row('20261120', 13.09), row('20261119', 13.09)],
  })
  const first = await executeWith(duplicated, { index_code: '000300', start_date: '2026-11-19', end_date: '2026-11-20' })
  assert.deepEqual(first.result.data.map((entry) => entry.date), ['2026-11-19', '2026-11-20'])

  await assert.rejects(
    () => executeWith(ok({ code: '200', msg: 'Success', success: true, data: [row('20261120', 13.09), row('20261120', 13.1)] }), { index_code: '000300', start_date: '2026-11-20', end_date: '2026-11-20' }),
    (error) => error.code === 'csindex_invalid_response' && /conflicting peg/.test(error.message),
  )
})

test('空 vs 失败：空 data 是合法空结果；上游 code 非 200 / HTTP 非 200 / 非 JSON 才失败', async () => {
  const empty = await executeWith(ok({ code: '200', msg: 'Success', success: true, data: [] }), { index_code: '399006', start_date: '2026-11-01', end_date: '2026-11-20' })
  assert.deepEqual(empty.result.data, [])
  assert.equal(source().validateOutput([]), true, '空结果不能被 validateOutput 判失败')

  await assert.rejects(
    () => executeWith(ok({ code: '500', msg: '服务器异常,请联系管理员', data: null, success: false }), { index_code: '000300', start_date: '2026-11-01', end_date: '2026-11-20' }),
    (error) => error.code === 'csindex_upstream_error' && /服务器异常/.test(error.message),
  )
  await assert.rejects(
    () => executeWith(httpError(503), { index_code: '000300', start_date: '2026-11-01', end_date: '2026-11-20' }),
    (error) => error.code === 'csindex_http_error' && /HTTP 503/.test(error.message),
  )
  await assert.rejects(
    () => executeWith({ ok: true, status: 200, text: async () => '<html>not json</html>' }, { index_code: '000300', start_date: '2026-11-01', end_date: '2026-11-20' }),
    (error) => error.code === 'csindex_invalid_response' && /non-JSON/.test(error.message),
  )
  await assert.rejects(
    () => executeWith(ok({ code: '200', msg: 'Success', success: true, data: [row('20261201', 13.09)] }), { index_code: '000300', start_date: '2026-11-01', end_date: '2026-11-20' }),
    (error) => error.code === 'csindex_invalid_response' && /outside the requested/.test(error.message),
  )
})

test('行丢失数值/指数名/混合指数：响亮失败，不静默造行', async () => {
  const cases = [
    [row('20261120', null), /non-numeric peg/],
    [row('20261120', 13.09, ''), /empty indexName/],
    [{ tradeDate: '2026112', indexName: '沪深300', peg: 13.09 }, /not a YYYYMMDD date/],
  ]
  for (const [badRow, pattern] of cases) {
    await assert.rejects(
      () => executeWith(ok({ code: '200', msg: 'Success', success: true, data: [badRow] }), { index_code: '000300', start_date: '2026-11-20', end_date: '2026-11-20' }),
      (error) => error.code === 'csindex_invalid_response' && pattern.test(error.message),
    )
  }
  await assert.rejects(
    () => executeWith(ok({ code: '200', msg: 'Success', success: true, data: [row('20261119', 13.09, '沪深300'), row('20261120', 20.32, '中证500')] }), { index_code: '000300', start_date: '2026-11-19', end_date: '2026-11-20' }),
    (error) => error.code === 'csindex_invalid_response' && /mixed index names/.test(error.message),
  )
})

test('count 只保留区间内最近 N 行（本地截断）', async () => {
  const { result } = await executeWith(ok({
    code: '200', msg: 'Success', success: true,
    data: [row('20261116', 13.05), row('20261117', 13.05), row('20261118', 13.09), row('20261119', 13.09), row('20261120', 13.09)],
  }), { index_code: '000300', start_date: '2026-11-16', end_date: '2026-11-20', count: 2 })
  assert.deepEqual(result.data.map((entry) => entry.date), ['2026-11-19', '2026-11-20'])
})

test('validateOutput：结构不符的行被拒（回执落库前只有这一道自检）', () => {
  const definition = source()
  assert.equal(definition.validateOutput([
    { index_code: '000300', index_name: '沪深300', date: '2026-11-20', pe_ttm: 13.09 },
  ]), true)
  assert.equal(definition.validateOutput([{ index_code: '000300', index_name: '沪深300', date: '2026-11-20', pe_ttm: Number.NaN }]), false)
  assert.equal(definition.validateOutput([{ index_code: '300', index_name: '沪深300', date: '2026-11-20', pe_ttm: 13.09 }]), false)
  assert.equal(definition.validateOutput({ item: [] }), false)
})
