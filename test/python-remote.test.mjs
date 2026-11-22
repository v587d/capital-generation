import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createPythonSources, MAX_BASIC_CODES, MAX_SOCIAL_FINANCING_MONTHS } from '../lib/sources/python-remote.js'
import { PythonRuntimeError } from '../lib/python-runtime/errors.js'

const signal = new AbortController().signal

function harness(rowsByScript = {}) {
  const calls = []
  const runner = async (request) => {
    calls.push(request)
    const value = rowsByScript[request.script]
    if (value instanceof Error) throw value
    if (typeof value === 'function') return await value(request)
    return { rows: value ?? [] }
  }
  const sources = createPythonSources(runner)
  const byCapability = (capability) => {
    const source = sources.find((item) => item.schema.capability === capability)
    assert.ok(source, `missing source ${capability}`)
    return source
  }
  return { sources, byCapability, calls }
}

async function execute(source, params) {
  return await source.execute({ capability: source.schema.capability, params, session: { id: 'test' } }, signal)
}

function valuationRow(overrides = {}) {
  return {
    date: '2026-11-20',
    code: 'sh.600519',
    close: 1485.75,
    pe_ttm: 22.605792,
    pb_mrq: 6.848364,
    ps_ttm: 10.647634,
    pcf_ncf_ttm: 50.901011,
    turnover_rate_pct: 0.5378,
    trade_status: 1,
    is_st: 0,
    ...overrides,
  }
}

function basicRow(overrides = {}) {
  return { code: 'sh.600519', name: '贵州茅台', ipo_date: '2001-08-27', out_date: null, type: 1, status: 1, ...overrides }
}

function socialRow(overrides = {}) {
  return {
    month: '2026-10',
    afre_total: 11429,
    rmb_loans: -5846,
    fx_loans: 95,
    entrusted_loans: 1862,
    trust_loans: -415,
    undiscounted_bankers_acceptance: -1687,
    corporate_bonds: 3446,
    government_bonds: 11835,
    equity_financing: 347,
    abs_by_depository: -8,
    loans_written_off: 630,
    ...overrides,
  }
}

test('python-remote: 三个能力的元数据、行形状与 output_schema 自洽', () => {
  const { sources } = harness()
  assert.deepEqual(sources.map((source) => source.schema.capability), [
    'baostock_valuation_history',
    'baostock_stock_basic',
    'pbc_social_financing',
  ])
  for (const source of sources) {
    const { schema } = source
    assert.equal(schema.data_key, `python.script.${schema.capability}`)
    assert.equal(schema.source_label, 'python')
    assert.equal(schema.source, `python:script.${schema.capability}`)
    assert.deepEqual(schema.rowShape, { rootArray: true })
    assert.equal(schema.paginated, false)
    assert.ok(Number.isSafeInteger(schema.cacheMaxAgeMs) && schema.cacheMaxAgeMs > 0)
    assert.match(schema.description, /分析环境/u)
    assert.ok(schema.description.includes('插件设置'), `${schema.capability} 描述必须写清运行时安装位置`)
    assert.equal(schema.output_schema.type, 'array')
    const { properties, required } = schema.output_schema.items
    assert.deepEqual([...required].sort(), Object.keys(properties).sort(), 'required 必须覆盖全部输出字段')
    assert.equal(schema.input_schema.type, 'object')
    assert.equal(schema.input_schema.additionalProperties, false)
    assert.equal(source.validateOutput?.([]), true, '空数组是合法空结果')
  }
  const outputFieldSets = sources.map((source) => Object.keys(source.schema.output_schema.items.properties))
  assert.deepEqual(outputFieldSets[0], [
    'date', 'code', 'close', 'pe_ttm', 'pb_mrq', 'ps_ttm', 'pcf_ncf_ttm', 'turnover_rate_pct', 'trade_status', 'is_st',
  ])
  assert.deepEqual(outputFieldSets[1], ['code', 'name', 'ipo_date', 'out_date', 'type', 'status'])
  assert.equal(outputFieldSets[2].length, 12, '社融是 12 列：month + 合计 + 10 个分项')
})

test('python-remote: 装配期不碰运行时，runner 只在 execute 时调用', async () => {
  let called = 0
  const { byCapability } = (() => {
    const sources = createPythonSources(async () => {
      called += 1
      return { rows: [] }
    })
    return { byCapability: (capability) => sources.find((item) => item.schema.capability === capability) }
  })()
  assert.equal(called, 0)
  await execute(byCapability('pbc_social_financing'), {})
  assert.equal(called, 1)
})

test('python-remote: normalize 幂等，三种代码写法归一为 BaoStock 形态', () => {
  const { byCapability } = harness()
  const valuation = byCapability('baostock_valuation_history')
  const cases = [
    ['600519', 'sh.600519'],
    ['600519.SH', 'sh.600519'],
    ['sh.600519', 'sh.600519'],
    [' 600519.sh ', 'sh.600519'],
    ['000001', 'sz.000001'],
    ['000001.SZ', 'sz.000001'],
    ['300750.sz', 'sz.300750'],
    ['688981', 'sh.688981'],
  ]
  for (const [input, expected] of cases) {
    const normalized = valuation.normalizeParams({ code: input, start_date: '2026-01-01', end_date: '2026-02-01' })
    assert.equal(normalized.code, expected, `${input} → ${expected}`)
    assert.deepEqual(valuation.normalizeParams(normalized), normalized, 'normalize 必须幂等')
  }
  assert.deepEqual(
    valuation.normalizeParams({ code: '600519', start_date: '2026-01-01', end_date: '2026-01-01' }),
    { code: 'sh.600519', start_date: '2026-01-01', end_date: '2026-01-01' },
  )

  const basic = byCapability('baostock_stock_basic')
  const normalizedBasic = basic.normalizeParams({ codes: ['600519.SH', '600519', 'sh.600519', '000001.SZ'] })
  assert.deepEqual(normalizedBasic, { codes: ['sh.600519', 'sz.000001'] })
  assert.deepEqual(basic.normalizeParams(normalizedBasic), normalizedBasic)

  const social = byCapability('pbc_social_financing')
  assert.deepEqual(social.normalizeParams({}), {})
  assert.deepEqual(social.normalizeParams({ months: 12 }), { months: 12 })
  assert.deepEqual(social.normalizeParams({ months: 12 }), social.normalizeParams(social.normalizeParams({ months: 12 })))
})

test('python-remote: 北交所/非法代码/日期区间/参数都响亮拒绝', () => {
  const { byCapability } = harness()
  const valuation = byCapability('baostock_valuation_history')
  const basic = byCapability('baostock_stock_basic')
  const social = byCapability('pbc_social_financing')
  const range = { start_date: '2026-01-01', end_date: '2026-02-01' }

  for (const code of ['430047', '830799', '920001', '430047.BJ', 'bj.430047', 'BJ.920001']) {
    assert.throws(() => valuation.normalizeParams({ code, ...range }), /北交所/u, `${code} 必须按北交所拒绝`)
    assert.throws(() => basic.normalizeParams({ codes: [code] }), /北交所/u)
  }
  for (const code of ['900901', '200002', '900901.SH']) {
    assert.throws(() => valuation.normalizeParams({ code, ...range }), /B-share/u)
  }
  assert.throws(() => valuation.normalizeParams({ code: '600519.SZ', ...range }), /is a SH code/u)
  assert.throws(() => valuation.normalizeParams({ code: '123456', ...range }), /not a Shanghai\/Shenzhen A-share/u)
  assert.throws(() => valuation.normalizeParams({ code: '60051', ...range }), /must be an A-share code/u)
  assert.throws(() => valuation.normalizeParams({ code: '600519', start_date: '2026-11-21', end_date: '2026-11-01' }), /must not be later/u)
  assert.throws(() => valuation.normalizeParams({ code: '600519', start_date: '2026-02-30', end_date: '2026-03-01' }), /not a real calendar date/u)
  assert.throws(() => valuation.normalizeParams({ code: '600519', start_date: '2026/01/01', end_date: '2026-02-01' }), /YYYY-MM-DD/u)
  assert.throws(() => valuation.normalizeParams({ code: '600519', start_date: '2026-01-01', end_date: '2026-02-01', adjust: 'qfq' }), /unknown parameter adjust/u)
  assert.throws(() => valuation.normalizeParams({ start_date: '2026-01-01', end_date: '2026-02-01' }), /code must be a string/u)
  assert.throws(() => valuation.normalizeParams({ code: '600519', start_date: '2026-01-01' }), /end_date/u)

  assert.throws(() => basic.normalizeParams({ codes: [] }), /at least one code/u)
  assert.throws(() => basic.normalizeParams({ codes: Array.from({ length: MAX_BASIC_CODES + 1 }, (_, index) => String(600000 + index)) }), /at most 50/u)
  assert.throws(() => basic.normalizeParams({ codes: '600519' }), /must be an array/u)

  assert.throws(() => social.normalizeParams({ months: 0 }), /between 1 and 120/u)
  assert.throws(() => social.normalizeParams({ months: MAX_SOCIAL_FINANCING_MONTHS + 1 }), /between 1 and 120/u)
  assert.throws(() => social.normalizeParams({ months: 1.5 }), /must be an integer/u)
  assert.throws(() => social.normalizeParams({ months: '12' }), /must be an integer/u)
  assert.throws(() => social.normalizeParams({ year: 2026 }), /unknown parameter year/u)
})

test('python-remote: execute 只保留声明字段，null 原样保留并传归一后的参数', async () => {
  const { byCapability, calls } = harness({
    baostock_valuation_history: [
      valuationRow({ pe_ttm: null, trade_status: null, is_st: 1, junk: 'drop-me' }),
      valuationRow({ date: '2026-11-19', close: null }),
    ],
  })
  const valuation = byCapability('baostock_valuation_history')
  const output = await execute(valuation, { code: '600519.SH', start_date: '2026-11-01', end_date: '2026-11-21' })
  assert.equal(output.data.length, 2)
  assert.deepEqual(output.data[0], {
    date: '2026-11-20',
    code: 'sh.600519',
    close: 1485.75,
    pe_ttm: null,
    pb_mrq: 6.848364,
    ps_ttm: 10.647634,
    pcf_ncf_ttm: 50.901011,
    turnover_rate_pct: 0.5378,
    trade_status: null,
    is_st: 1,
  })
  assert.equal(output.data[0].junk, undefined, 'Python 行的未知键不得透传')
  assert.equal(output.data[1].close, null)
  assert.deepEqual(calls[0].params, { code: 'sh.600519', start_date: '2026-11-01', end_date: '2026-11-21' })
  assert.equal(valuation.validateOutput(output.data), true)
})

test('python-remote: stock_basic 映射退市日 null，缺行或多余行整批失败', async () => {
  const rows = [basicRow(), basicRow({ code: 'sh.600001', name: '邯郸钢铁', out_date: '2009-12-29', status: 0 })]
  const { byCapability } = harness({ baostock_stock_basic: rows })
  const basic = byCapability('baostock_stock_basic')
  const output = await execute(basic, { codes: ['600519', '600001'] })
  assert.deepEqual(output.data, [
    { code: 'sh.600519', name: '贵州茅台', ipo_date: '2001-08-27', out_date: null, type: 1, status: 1 },
    { code: 'sh.600001', name: '邯郸钢铁', ipo_date: '2001-08-27', out_date: '2009-12-29', type: 1, status: 0 },
  ])

  const missing = harness({ baostock_stock_basic: [basicRow()] }).byCapability('baostock_stock_basic')
  await assert.rejects(() => execute(missing, { codes: ['600519', '605999'] }), /没有返回这些代码：sh\.605999/u)

  const extra = harness({ baostock_stock_basic: [...rows, basicRow({ code: 'sz.000001' })] }).byCapability('baostock_stock_basic')
  await assert.rejects(() => execute(extra, { codes: ['600519', '600001'] }), /与请求代码数 2 不一致/u)
})

test('python-remote: 社融行校验 month/数值/严格升序，空月份窗口按行数校验', async () => {
  const { byCapability } = harness({
    pbc_social_financing: [socialRow({ month: '2026-09' }), socialRow({ month: '2026-10', afre_total: null })],
  })
  const social = byCapability('pbc_social_financing')
  const output = await execute(social, { months: 12 })
  assert.deepEqual(output.data.map((row) => row.month), ['2026-09', '2026-10'])
  assert.equal(output.data[1].afre_total, null, 'null 不是 0')

  const unsorted = harness({ pbc_social_financing: [socialRow({ month: '2026-10' }), socialRow({ month: '2026-09' })] }).byCapability('pbc_social_financing')
  await assert.rejects(() => execute(unsorted, {}), /不是严格升序/u)

  const tooMany = harness({ pbc_social_financing: [socialRow({ month: '2026-09' }), socialRow({ month: '2026-10' })] }).byCapability('pbc_social_financing')
  await assert.rejects(() => execute(tooMany, { months: 1 }), /超过请求的 1 个月/u)

  const badMonth = harness({ pbc_social_financing: [socialRow({ month: '2026.10' })] }).byCapability('pbc_social_financing')
  await assert.rejects(() => execute(badMonth, {}), /不是 YYYY-MM/u)
})

test('python-remote: 非法的 Python 行在 TS 侧被拒绝，validateOutput 同步为 false', async () => {
  const cases = [
    ['pe_ttm 字符串', valuationRow({ pe_ttm: '22.6' }), /不是有限数字/u],
    ['trade_status 越界', valuationRow({ trade_status: 2 }), /不是 0\/1/u],
    ['date 格式', valuationRow({ date: '2026/11/20' }), /不是 YYYY-MM-DD/u],
    ['code 形态', valuationRow({ code: '600519' }), /不是 BaoStock 代码形态/u],
    ['NaN 估值', valuationRow({ close: Number.NaN }), /不是有限数字/u],
  ]
  for (const [label, row, pattern] of cases) {
    const { byCapability } = harness({ baostock_valuation_history: [row] })
    const valuation = byCapability('baostock_valuation_history')
    await assert.rejects(() => execute(valuation, { code: '600519', start_date: '2026-11-01', end_date: '2026-11-21' }), pattern, label)
    assert.equal(valuation.validateOutput([row]), false, `${label}: validateOutput 必须拒绝`)
  }
  const broken = harness({ baostock_valuation_history: [valuationRow({ code: 'sh.000001' })] }).byCapability('baostock_valuation_history')
  await assert.rejects(() => execute(broken, { code: '600519', start_date: '2026-11-01', end_date: '2026-11-21' }), /返回了其他代码的行/u)
  const notArray = harness({ pbc_social_financing: { rows: [] } }).byCapability('pbc_social_financing')
  await assert.rejects(() => execute(notArray, {}), /没有返回 rows 数组/u)
})

test('python-remote: 运行时缺失在调用期失败，错误码保留且提示插件设置', async () => {
  const runtimeMissing = new PythonRuntimeError('data-runtime-not-ready', '分析环境（base pack）尚未安装')
  const { byCapability, calls } = harness({
    baostock_valuation_history: async () => { throw runtimeMissing },
    baostock_stock_basic: async () => { throw runtimeMissing },
    pbc_social_financing: async () => { throw runtimeMissing },
  })
  for (const capability of ['baostock_valuation_history', 'baostock_stock_basic', 'pbc_social_financing']) {
    const source = byCapability(capability)
    const params = capability === 'baostock_valuation_history'
      ? { code: '600519', start_date: '2026-11-01', end_date: '2026-11-21' }
      : capability === 'baostock_stock_basic' ? { codes: ['600519'] } : {}
    await assert.rejects(() => execute(source, params), (error) => {
      assert.equal(error.code, 'data-runtime-not-ready', '错误码必须保留给工具层分类')
      assert.match(error.message, /插件设置/u)
      assert.match(error.message, /分析环境/u)
      return true
    })
  }
  assert.equal(calls.length, 3, '运行时状态必须在每次调用期现取，不能装配期缓存')

  const scriptFailure = harness({ pbc_social_financing: async () => { throw new Error('analysis.py exited with 1') } }).byCapability('pbc_social_financing')
  await assert.rejects(() => execute(scriptFailure, {}), (error) => {
    assert.match(error.message, /pbc_social_financing 的固定 Python 脚本失败/u)
    assert.match(error.message, /analysis\.py exited with 1/u)
    assert.equal(error.code, undefined)
    return true
  })
})
