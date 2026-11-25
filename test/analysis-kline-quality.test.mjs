import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { analysisModuleById, listAnalysisModules } from '../lib/analysis/registry.js'
import { resetAnalysisRuntimeState, runModuleOnSnapshot } from '../lib/analysis/runtime.js'
import { AnalysisError } from '../lib/analysis/types.js'
import {
  expectedOf, moduleRunDir, readJson, runCase, runtimeFrom, runtimeReady, setupCase,
} from './analysis-fixture-harness.mjs'

/**
 * `kline_quality` is the "OHLC series" input shape: one bar per trading day, hard rules reject a row
 * with a stable reason, soft flags only mark it. Goldens are hand-computed from `fixtures/` inputs
 * (see fixtures/README.md), never recorded from module output.
 */
const FIXTURES = fileURLToPath(new URL('../python/analysis/modules/kline_quality/fixtures/', import.meta.url))
const MODULE = 'kline_quality'
const caseDir = (name) => join(FIXTURES, name)
const SESSION = { id: 'session-analysis-kline-quality', header: { cwd: '/workspace' } }

function runDirect(workspace, params = {}) {
  return runModuleOnSnapshot({
    writer: workspace.store,
    runtime: runtimeFrom(),
    session: SESSION,
    snapshot: workspace.record,
    module: analysisModuleById(MODULE),
    params,
  })
}

function rejectsWith(expected, codePattern) {
  return (error) => error instanceof AnalysisError
    && error.code === expected.code
    && expected.message_contains.every((fragment) => error.message.includes(fragment))
    && codePattern.test(error.message)
}

test('kline_quality 登记在静态 registry，manifest 声明 OHLC 清洗口径与来源', async () => {
  const ids = listAnalysisModules().map((entry) => entry.manifest.id)
  assert.ok(ids.includes(MODULE), 'kline_quality 必须在静态 registry 的 id 白名单里（不扫目录）')
  assert.equal(analysisModuleById(MODULE)?.manifest.id, MODULE)

  const entry = analysisModuleById(MODULE)
  assert.equal(entry.manifest.version, '1.0.0')
  assert.deepEqual([...entry.manifest.roles], ['senior_analyst'])
  assert.deepEqual([...entry.manifest.capabilities], ['dataset.read'], '只读 Dataset；不声明未使用的能力')
  assert.equal(entry.manifest.input_schema.additionalProperties, false, '参数未知字段必须被拒')
  assert.equal(entry.manifest.input_schema.properties.jump_threshold.minimum, 0, '阈值下限由宿主 schema 先拒')
  assert.ok(entry.manifest.assumptions.length >= 5, 'manifest 必须显式列出假设')
  assert.ok(entry.manifest.applicability.length >= 3, 'manifest 必须写明适用条件')
  assert.equal(entry.manifest.provenance.source_type, 'original')
  assert.equal(entry.manifest.provenance.license, 'MIT')

  const license = await readFile(join(FIXTURES, '..', 'LICENSE'), 'utf8')
  assert.match(license, /MIT License/u)
  assert.match(license, /v587d/u)
})

test('normal：干净日 K 全部通过，volume=0 只标 volume_missing，审计文件可核对', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('normal'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('normal'), moduleId: MODULE })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics, '指标必须与手算 golden 完全一致（含 6 位小数舍入）')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /共 6 行、清洗后 6 根 bar（6 个交易日）/u)
  assert.match(outcome.summary, /无硬校验拒绝/u)
  assert.match(outcome.summary, /无超过 50\.00% 的相邻跳变/u)
  assert.match(outcome.summary, /成交量缺失或为 0 的 bar 1 行（不当 0 参与统计）/u)
  assert.match(outcome.summary, /区间收盘 101\.\.105/u)
  assert.match(outcome.summary, /清洗序列只代表通过硬校验，不是数据完整或交易建议/u)
  assert.deepEqual([...outcome.assumptions], [...analysisModuleById(MODULE).manifest.assumptions],
    '结果里的假设必须与 manifest 承诺的一致，否则 describe 与 run 会互相矛盾')

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'kline_quality.json'))
  assert.equal(payload.price_dataset_id, 'ds_kline')
  assert.deepEqual(payload.columns, {
    time: 'date', open: 'open', high: 'high', low: 'low', close: 'close', volume: 'volume',
  })
  assert.deepEqual(payload.time_axis, { column: 'date', format: 'iso_date', timezone: 'UTC' })
  assert.deepEqual(payload.parameters, { jump_threshold: 0.5, timezone: 'UTC' })
  assert.deepEqual(payload.window, { rows_total: 6, rows_cleaned: 6, start: '2024-01-02', end: '2024-01-09' })
  assert.deepEqual(payload.statistics, expected.metrics, '审计文件的统计必须与结果 metrics 同源')
  assert.deepEqual(payload.rejected, [])
  assert.deepEqual(payload.suspects, [])
  assert.deepEqual(payload.volume_missing, [{ index: 2, date: '2024-01-04', volume: 0 }])
  assert.equal(payload.series.length, 6)
  assert.deepEqual(payload.series[2], { date: '2024-01-04', open: 102, high: 103, low: 101, close: 101.5 },
    'volume=0 的 bar 保留价格，但 volume 不进清洗序列（不当 0 参与统计）')
  assert.equal(payload.series[0].volume, 1000)

  const result = await readJson(join(dir, 'result.json'))
  assert.ok(result.result.methodology_log.some((line) => line.includes('时间列 date')),
    '方法日志必须写明实际用的时间列，否则结果无法复算')
  assert.ok(result.result.methodology_log.some((line) => line.includes('硬校验拒绝 0 行')))
  assert.ok(result.result.limitations.some((line) => line.includes('复权')),
    '限制必须披露价格口径未做复权调整')
})

test('noisy：坏行逐条拒绝并点名原因，清洗后仍有可用 bar', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('noisy'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('noisy'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics, '跳过坏行后只统计剩下的 bar')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /共 10 行、清洗后 4 根 bar（4 个交易日）/u)
  assert.match(outcome.summary, /拒绝 6 行（time_unparseable 1、price_invalid 1、high_below_max 2、low_above_min 1、duplicate_date 1）/u)
  assert.match(outcome.summary, /无超过 50\.00% 的相邻跳变/u)
  assert.match(outcome.summary, /成交量缺失或为 0 的 bar 1 行/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'kline_quality.json'))
  assert.deepEqual(payload.rejected.map((entry) => [entry.index, entry.reason, entry.date]), [
    [2, 'high_below_max', '2024-01-04'],
    [3, 'high_below_max', '2024-01-05'],
    [4, 'low_above_min', '2024-01-08'],
    [5, 'price_invalid', '2024-01-09'],
    [7, 'duplicate_date', '2024-01-10'],
    [8, 'time_unparseable', undefined],
  ], '拒绝行按输入序，保留原始行索引、日期与稳定原因')
  assert.deepEqual(payload.rejected[0].values, { date: '2024-01-04', open: 102, high: 101, low: 100, close: 101, volume: 900 })
  assert.equal(payload.rejected[3].values.close, 0, '原始 close=0 留痕，不写默认值')
  assert.deepEqual(payload.rejected[5].values.date, '2024/01/11', '解析不了的时间也留原值')
  assert.deepEqual(payload.series.map((bar) => bar.date), ['2024-01-02', '2024-01-03', '2024-01-10', '2024-01-12'])
  assert.equal('volume' in payload.series[1], false, '缺 volume 的 bar 不写 0')
  assert.deepEqual(payload.volume_missing, [{ index: 1, date: '2024-01-03' }])
})

test('jump：相邻涨幅超过阈值只标 suspect_jump，保留在清洗序列', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('jump'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('jump'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /可疑跳变 1 行（阈值 50\.00%，最大相邻涨跌幅 60\.00%）/u)
  assert.match(outcome.summary, /区间收盘 100\.\.158/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'kline_quality.json'))
  assert.deepEqual(payload.suspects, [
    { index: 2, date: '2024-01-04', previous_close: 102, close: 163.2, change: 0.6 },
  ])
  assert.equal(payload.series.length, 5, '软标记不删除 bar')
  assert.equal(payload.series[2].close, 163.2)
})

test('jump_threshold：阈值是显式参数，同一份数据调宽后不标可疑', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('jump_threshold'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('jump_threshold'), moduleId: MODULE })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /无超过 70\.00% 的相邻跳变/u)
  assert.equal(outcome.metrics.jump_threshold, 0.7, '阈值原样写进结果，不伪装成固定结论')

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'kline_quality.json'))
  assert.deepEqual(payload.parameters, { jump_threshold: 0.7, timezone: 'UTC' })
  assert.deepEqual(payload.suspects, [])
  assert.equal(payload.series[2].close, 163.2)
})

test('ms_timezone：epoch 毫秒 + timezone 参数换算出正确日历日；time_coverage 列被采用', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('ms_timezone'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('ms_timezone'), moduleId: MODULE })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'kline_quality.json'))
  assert.deepEqual(payload.time_axis, { column: 'trade_date_ms', format: 'epoch_ms', timezone: 'Asia/Shanghai' })
  assert.deepEqual(payload.window, { rows_total: 3, rows_cleaned: 3, start: '2024-01-02', end: '2024-01-04' },
    'Asia/Shanghai 零点换算后是当地日期，不是 UTC 前一天')
  assert.deepEqual(payload.series.map((bar) => bar.date), ['2024-01-02', '2024-01-03', '2024-01-04'])
})

test('no_volume：volume 是可选列，缺整列时不做成交量体检而不是逐根标缺失', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('no_volume'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('no_volume'), moduleId: MODULE })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.ok(outcome.limitations.some((line) => line.includes('没有 volume 列')),
    '缺可选列必须在限制里披露，而不是静默当成每根 bar 都缺量')

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'kline_quality.json'))
  assert.equal('volume' in payload.columns, false)
  assert.deepEqual(payload.volume_missing, [])
  assert.equal('volume' in payload.series[0], false)
})

test('all_rejected：清洗后没有合法 bar → blocked，审计文件仍写出全部拒绝行', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('all_rejected'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('all_rejected'), moduleId: MODULE })

  assert.equal(outcome.status, 'blocked')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /清洗后没有合法 bar：拒绝 3 行/u)
  assert.match(outcome.summary, /清洗序列只代表通过硬校验，不是数据完整或交易建议/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'kline_quality.json'))
  assert.equal(payload.rejected.length, 3)
  assert.deepEqual(payload.series, [])
  assert.deepEqual(payload.window, { rows_total: 3, rows_cleaned: 0 }, '没有合法 bar 时不编造窗口')
})

test('document：文档型 Dataset 在模块内按输入错误拒绝，不把文档当表格', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('document'))
  const workspace = await setupCase({ caseDir: caseDir('document'), moduleId: MODULE })
  // The real host rejects document datasets when the snapshot is created; stage the document view
  // by hand so the module's defensive branch stays covered if that ever stops being true.
  const stagedPath = join(workspace.record.paths.inputs_dir, 'datasets', 'ds_kline.json')
  const view = await readJson(stagedPath)
  await writeFile(stagedPath, JSON.stringify({ ...view, shape: 'document', rows: [], columns: [], row_count: 0 }))

  await assert.rejects(
    () => runDirect(workspace),
    rejectsWith(expected.error, /document/u),
    '文档型输入必须响亮失败并说明只吃表格数据',
  )
})

test('missing_columns：没有 OHLC 列时运行前拒绝，并点名缺的是哪几列', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('missing_columns'))
  const workspace = await setupCase({ caseDir: caseDir('missing_columns'), moduleId: MODULE })

  await assert.rejects(
    () => runDirect(workspace),
    (error) => error instanceof AnalysisError
      && error.code === expected.error.code
      && /没有可识别的日 K Dataset/u.test(error.message)
      && /open\/high\/low\/close/u.test(error.message),
    '自动识别失败时必须说明需要哪四列',
  )
  await assert.rejects(
    () => runDirect(workspace, { price_dataset_id: 'ds_kline' }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /缺少 OHLC 列/u.test(error.message)
      && /open/u.test(error.message),
    '显式指名时要点名缺列，而不是静默跳过',
  )
  const modulesDir = join(workspace.root, workspace.record.paths.dir, 'modules')
  if (existsSync(modulesDir)) {
    for (const runId of await readdir(modulesDir)) {
      assert.equal(existsSync(join(modulesDir, runId, 'outputs')), false, '输入错误不写 outputs：没有可复算的序列')
    }
  }
})

test('参数越界：jump_threshold=-0.5 在启动 Python 之前被拒', async () => {
  const workspace = await setupCase({ caseDir: caseDir('normal'), moduleId: MODULE })
  await assert.rejects(
    () => runDirect(workspace, { jump_threshold: -0.5 }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /jump_threshold/u.test(error.message),
  )
})

test('kline_quality 不支持的模块 id 不会被 registry 解析', () => {
  assert.equal(analysisModuleById('kline_quality_v9'), undefined)
})
