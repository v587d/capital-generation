import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { analysisModuleById, listAnalysisModules } from '../lib/analysis/registry.js'
import { resetAnalysisRuntimeState, runModuleOnSnapshot } from '../lib/analysis/runtime.js'
import { AnalysisError } from '../lib/analysis/types.js'
import {
  expectedOf, moduleRunDir, readJson, runCase, runtimeFrom, runtimeReady, setupCase,
} from './analysis-fixture-harness.mjs'

/**
 * `technical_indicators` reviews one price series: SMA/EMA/RSI/MACD/BOLL/ATR latest values plus
 * latest-bar cross states. Goldens are hand-computed from `fixtures/` inputs (see fixtures/README.md),
 * never recorded from module output; a window that is not complete must stay a gap, never a shorter
 * window or a default value.
 */
const FIXTURES = fileURLToPath(new URL('../python/analysis/modules/technical_indicators/fixtures/', import.meta.url))
const MODULE = 'technical_indicators'
const caseDir = (name) => join(FIXTURES, name)
const SESSION = { id: 'session-analysis-technical-indicators', header: { cwd: '/workspace' } }
const AUDIT_FILE = join('outputs', 'technical_indicators.json')
const REVIEW_CONDITION = '指标是复盘条件，不是买卖信号或方向预测'

function runDirect(workspace, params) {
  return runModuleOnSnapshot({
    writer: workspace.store,
    runtime: runtimeFrom(),
    session: SESSION,
    snapshot: workspace.record,
    module: analysisModuleById(MODULE),
    params,
  })
}

function rejectsWith(expected, pattern) {
  return (error) => error instanceof AnalysisError
    && error.code === expected.error.code
    && expected.error.message_contains.every((fragment) => error.message.includes(fragment))
    && (pattern === undefined || pattern.test(error.message))
}

/** Every decimal number in the summary is written at 2-4 decimals, so a claim anchor can hit it. */
function assertSummaryAnchors(summary) {
  const lengths = [...summary.matchAll(/\d+\.(\d+)/gu)].map((match) => match[1].length)
  assert.ok(lengths.length > 0, '摘要必须给出可锚定的指标数值')
  for (const length of lengths) {
    assert.ok(length >= 2 && length <= 4, `摘要数字必须是 2–4 位小数，实际 ${length} 位：${summary}`)
  }
}

function assertSixDecimals(value, label) {
  assert.equal(value, Number(value.toFixed(6)), `${label} 必须保留 6 位小数`)
}

test('technical_indicators 登记在静态 registry，manifest 声明指标口径与来源', async () => {
  const ids = listAnalysisModules().map((entry) => entry.manifest.id)
  assert.ok(ids.includes('technical_indicators'), 'technical_indicators 必须在静态 registry 的 id 白名单里（不扫目录）')
  assert.equal(analysisModuleById(MODULE)?.manifest.id, MODULE)

  const entry = analysisModuleById(MODULE)
  assert.equal(entry.manifest.version, '1.0.0')
  assert.deepEqual([...entry.manifest.roles], ['senior_analyst'])
  assert.deepEqual([...entry.manifest.capabilities], ['dataset.read'], '模块只读 Dataset；不声明未使用的能力')
  assert.equal(entry.manifest.input_schema.additionalProperties, false, '参数未知字段必须被拒')
  const properties = entry.manifest.input_schema.properties
  assert.equal(properties.macd_fast.minimum, 2)
  assert.equal(properties.boll_multiplier.minimum, 0)
  assert.match(properties.macd_fast.description, /默认 12/u, '参数描述要与「任一 macd_* 触发、缺省补齐」的实现一致')
  assert.match(properties.boll_period.description, /默认 20/u)
  assert.ok(entry.manifest.assumptions.length >= 5, 'manifest 必须显式列出假设')
  assert.ok(entry.manifest.applicability.length >= 3, 'manifest 必须写明适用条件')
  assert.equal(entry.manifest.provenance.source_type, 'original')
  assert.equal(entry.manifest.provenance.license, 'MIT')

  const license = await readFile(join(FIXTURES, '..', 'LICENSE'), 'utf8')
  assert.match(license, /MIT License/u)
  assert.match(license, /v587d/u)
})

test('normal：六组指标 latest 值与手算 golden 逐项对上，摘要与审计文件可核对', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('normal'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('normal'), moduleId: MODULE })

  assert.equal(outcome.status, expected.status)
  assert.deepEqual(outcome.metrics, expected.metrics, '指标必须与手算 golden 完全一致（含 6 位小数舍入）')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  for (const [key, value] of Object.entries(outcome.metrics)) {
    if (typeof value === 'number') assertSixDecimals(value, key)
  }

  assert.match(outcome.summary, /2024-01-02\.\.2024-01-15/u)
  assert.match(outcome.summary, /10 个观测/u)
  assert.match(outcome.summary, /最新收盘 15\.0000/u)
  assert.match(outcome.summary, /SMA2 15\.5000/u)
  assert.match(outcome.summary, /SMA3 15\.3333/u)
  assert.match(outcome.summary, /EMA3 15\.0000/u)
  assert.match(outcome.summary, /RSI3 61\.2965/u)
  assert.match(outcome.summary, /MACD 0\.1539（signal 0\.2428、hist -0\.0889）/u)
  assert.match(outcome.summary, /BOLL 上 16\.2761 \/ 中 15\.3333 \/ 下 14\.3905/u)
  assert.match(outcome.summary, /ATR3 1\.7440/u)
  assert.ok(outcome.summary.includes(REVIEW_CONDITION), '摘要必须写明指标是复盘条件，不是买卖信号或方向预测')
  assert.doesNotMatch(outcome.summary, /评级|目标价|买入|卖出|看涨|看跌|收益承诺/u, '摘要不许出现评级/目标价/方向结论')
  assertSummaryAnchors(outcome.summary)
  assert.deepEqual([...outcome.assumptions], [...analysisModuleById(MODULE).manifest.assumptions],
    '结果里的假设必须与 manifest 承诺的一致，否则 describe 与 run 会互相矛盾')

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, AUDIT_FILE))
  assert.equal(payload.price_dataset_id, 'ds_price', '只有一份像价格序列的 Dataset 时可省略 price_dataset_id')
  assert.equal(payload.time_column, 'date')
  assert.equal(payload.price_column, 'close')
  assert.deepEqual(payload.parameters, {
    sma_windows: [2, 3],
    ema_windows: [3],
    rsi_period: 3,
    macd_fast: 2,
    macd_slow: 3,
    macd_signal: 2,
    boll_period: 3,
    boll_multiplier: 2,
    atr_period: 3,
  })
  assert.deepEqual(payload.window, { start: '2024-01-02', end: '2024-01-15', observations: 10 })
  assert.equal(payload.series.length, 10)
  assert.equal(payload.series_total, 10)
  assert.equal(payload.series_truncated, false)
  assert.equal(payload.skipped_rows, 0)
  assert.deepEqual(payload.data_gaps, [])
  assert.equal(payload.series[0].date, '2024-01-02')
  assert.equal(payload.series[0].close, 10)
  const windowKeys = Object.keys(payload.series[0]).filter((key) => key !== 'date' && key !== 'close')
  assert.equal(windowKeys.length, 11, '审计文件的逐 bar 序列要带全部 11 项请求指标')
  for (const key of windowKeys) {
    assert.equal(payload.series[0][key], null, `${key} 在窗口不完整时必须是 null，不能补默认值`)
  }
  assert.equal(payload.series[1].sma_2, 10.5)
  assert.equal(payload.series[2].sma_3, 11, '第 3 根才有 SMA3')
  assert.equal(payload.series[2].ema_3, 11, 'EMA 首值用前 n 个收盘价均值作种子')
  assert.equal(payload.series[2].macd, 0.5)
  assert.equal(payload.series[3].rsi_3, 66.666667)
  assert.equal(payload.series[3].macd_signal, 0.333333, 'signal 首值取前 2 个 MACD 的均值')
  assert.equal(payload.series[3].atr_3, 1.6, 'ATR 首值取第 2..n+1 根 TR 的均值')
  assert.equal(payload.series[9].close, 15)
  assert.equal(payload.series[9].atr_3, 1.744033)

  const metadata = new Map(payload.indicators.map((item) => [item.id, item]))
  assert.equal(metadata.size, 11)
  assert.equal(metadata.get('sma_2').required_observations, 2)
  assert.equal(metadata.get('ema_3').required_observations, 3)
  assert.equal(metadata.get('rsi_3').required_observations, 4, 'RSI 需要周期 + 1 根')
  assert.equal(metadata.get('macd').required_observations, 5, 'MACD 需要 slow + signal 根')
  assert.equal(metadata.get('boll_upper').required_observations, 3)
  assert.equal(metadata.get('atr_3').required_observations, 4, 'ATR 需要周期 + 1 根')
  assert.match(metadata.get('sma_2').formula, /算术平均/u)
  assert.match(metadata.get('boll_upper').formula, /总体标准差/u)
  assert.match(metadata.get('atr_3').formula, /真实波幅/u)
  assert.match(metadata.get('rsi_3').formula, /Wilder/u)
})

test('insufficient：窗口不足只点名缺口，不缩短窗口也不影响其它指标', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('insufficient'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('insufficient'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.equal('sma_5' in outcome.metrics, false, '窗口不足的指标不能出现在 metrics 里')
  assert.ok(outcome.data_gaps[0].includes('SMA(5)') && outcome.data_gaps[0].includes('实际 3 根'),
    '缺口必须点名窗口与所需/实际根数')
  assert.match(outcome.summary, /SMA2 11\.5000/u)
  assert.match(outcome.summary, /EMA3 11\.0000/u)
  assert.match(outcome.summary, /有缺口未计算/u)
  assert.ok(outcome.summary.includes(REVIEW_CONDITION))
  assertSummaryAnchors(outcome.summary)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, AUDIT_FILE))
  assert.deepEqual(payload.series.map((row) => row.sma_5), [null, null, null], '缺口指标的逐 bar 序列全是 null')
  assert.deepEqual(payload.series.map((row) => row.sma_2), [null, 10.5, 11.5])
  assert.equal(payload.series[2].ema_3, 11)
  assert.equal('sma_5' in payload.series[2], true, '请求过的指标即使在 series 里也要留键')
})

test('all_insufficient：所有窗口都不完整 → blocked，逐组点名且不写 outputs', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('all_insufficient'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('all_insufficient'), moduleId: MODULE })

  assert.equal(outcome.status, 'blocked')
  assert.deepEqual(outcome.metrics, expected.metrics, 'blocked 时只留 series 级事实，不编造指标值')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.equal(outcome.data_gaps.length, 6)
  assert.match(outcome.summary, /请求的指标都未能计算/u)
  assert.ok(outcome.summary.includes(REVIEW_CONDITION))
  const { dir } = await moduleRunDir(root, record)
  assert.equal(existsSync(join(dir, 'outputs')), false, 'blocked 不写 outputs：没有可复算的指标')
})

test('bad_rows：坏价格与坏日期跳过并逐行点名，partial 不把坏行当 0', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('bad_rows'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('bad_rows'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics, '跳过坏行后只算剩下的有效观测')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.data_gaps[0], /3 行/u)
  assert.match(outcome.data_gaps[0], /2024-13-40/u)
  assert.match(outcome.data_gaps[0], /close=-3/u)
  assert.match(outcome.summary, /跳过 3 条坏行/u)
  assert.match(outcome.summary, /有缺口未计算/u)
  assertSummaryAnchors(outcome.summary)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, AUDIT_FILE))
  assert.equal(payload.skipped_rows, 3)
  assert.equal(payload.series.length, 8)
  assert.equal(payload.series[0].date, '2024-01-02')
  assert.equal(payload.series[0].close, 10)
  assert.deepEqual(payload.series.map((row) => row.date),
    ['2024-01-02', '2024-01-04', '2024-01-08', '2024-01-10', '2024-01-11', '2024-01-12', '2024-01-15', '2024-01-16'])
  assert.equal(payload.series[7].atr_3, 1.737037)
})

test('missing_ohlc：ATR 缺口点名缺列，其它指标照常计算', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('missing_ohlc'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('missing_ohlc'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.equal('atr_3' in outcome.metrics, false)
  assert.match(outcome.data_gaps[0], /ATR\(3\)/u)
  assert.match(outcome.data_gaps[0], /high \/ low \/ close/u)
  assert.match(outcome.data_gaps[0], /缺 high、low/u)
  assert.equal(outcome.metrics.sma_2, 13.5, '缺 high/low 只影响 ATR，不影响 SMA')
  assert.match(outcome.summary, /有缺口未计算/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, AUDIT_FILE))
  assert.deepEqual(payload.series.map((row) => row.atr_3), [null, null, null, null, null])
  assert.deepEqual(payload.series.map((row) => row.sma_2), [null, 10.5, 11.5, 12.5, 13.5])
  assert.ok(payload.indicators.some((item) => item.id === 'atr_3'), '未算成的指标也要在元数据里说明公式与所需根数')
})

test('duplicate：同一日期多行是输入错误，不静默取一行', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('duplicate'))
  await assert.rejects(
    () => runCase({ caseDir: caseDir('duplicate'), moduleId: MODULE }),
    rejectsWith(expected, /ds_price/u),
    '重复日期必须响亮失败并点名日期',
  )
})

test('document：文档型 Dataset 在模块内按输入错误拒绝，不把文档当表格', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('document'))
  const workspace = await setupCase({ caseDir: caseDir('document'), moduleId: MODULE })
  // The real host rejects document datasets when the snapshot is created; stage the document view
  // by hand so the module's defensive branch stays covered if that ever stops being true.
  const stagedPath = join(workspace.record.paths.inputs_dir, 'datasets', 'ds_doc.json')
  const view = await readJson(stagedPath)
  await writeFile(stagedPath, JSON.stringify({ ...view, shape: 'document', rows: [], columns: [], row_count: 0 }))
  const params = await readJson(join(caseDir('document'), 'params.json'))

  await assert.rejects(
    () => runDirect(workspace, params),
    rejectsWith(expected, /只吃表格/u),
    '文档型输入必须响亮失败并说明只吃表格价格序列',
  )
})

test('unrelated：没有价格列的行不是序列，运行前 analysis_input_invalid', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('unrelated'))
  await assert.rejects(
    () => runCase({ caseDir: caseDir('unrelated'), moduleId: MODULE }),
    rejectsWith(expected),
    '没有价格列时必须点名自动识别失败，不能拿 revenue 当价格',
  )
})

test('no_params：一个指标参数都不给 → 运行前 analysis_input_invalid', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('no_params'))
  await assert.rejects(
    () => runCase({ caseDir: caseDir('no_params'), moduleId: MODULE }),
    rejectsWith(expected, /sma_windows/u),
    '没有可算的指标就不启动计算，并列出可给的参数',
  )
})

test('参数越界与未知字段：在启动 Python 之前被宿主 schema 拒绝', async () => {
  const workspace = await setupCase({ caseDir: caseDir('normal'), moduleId: MODULE })
  await assert.rejects(
    () => runDirect(workspace, { sma_windows: [1] }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /sma_windows/u.test(error.message),
    '窗口下限由宿主 schema 先拒（minimum 2）',
  )
  await assert.rejects(
    () => runDirect(workspace, { bogus_indicator: true }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /bogus_indicator/u.test(error.message),
    'unknown 参数必须被拒（additionalProperties: false）',
  )
})

test('参数组合：macd_fast 必须小于 macd_slow，否则在计算前拒绝', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const workspace = await setupCase({ caseDir: caseDir('normal'), moduleId: MODULE })
  await assert.rejects(
    () => runDirect(workspace, { macd_fast: 5, macd_slow: 3 }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /macd_fast=5/u.test(error.message)
      && /小于/u.test(error.message),
  )
})

test('默认值：MACD 只给一个周期时按 12/26/9 补齐，BOLL 只给倍数时按 20 根', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const macd = await runCase({
    caseDir: caseDir('normal'), moduleId: MODULE, params: { sma_windows: [2], macd_slow: 26 },
  })
  assert.equal(macd.outcome.status, 'partial')
  assert.ok(macd.outcome.data_gaps.some((line) => line.includes('MACD(12/26/9)') && line.includes('需要 35 根')),
    '只给 macd_slow 时 fast=12、signal=9 由标准值补齐')

  const boll = await runCase({ caseDir: caseDir('normal'), moduleId: MODULE, params: { sma_windows: [2], boll_multiplier: 2 } })
  assert.equal(boll.outcome.status, 'partial')
  assert.ok(boll.outcome.data_gaps.some((line) => line.includes('BOLL(20)') && line.includes('实际 10 根')),
    '只给 boll_multiplier 时按默认周期 20 计算，10 根不够就报缺口')
})

test('默认倍数：只给 boll_period 时按 2 倍总体标准差，与手算 golden 一致', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('normal'))
  const { outcome } = await runCase({
    caseDir: caseDir('normal'), moduleId: MODULE, params: { sma_windows: [2, 3], boll_period: 3 },
  })
  assert.equal(outcome.status, 'completed')
  assert.equal(outcome.metrics.boll_upper, expected.metrics.boll_upper)
  assert.equal(outcome.metrics.boll_middle, expected.metrics.boll_middle)
  assert.equal(outcome.metrics.boll_lower, expected.metrics.boll_lower)
})
