import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { analysisModuleById, listAnalysisModules } from '../lib/analysis/registry.js'
import { resetAnalysisRuntimeState } from '../lib/analysis/runtime.js'
import { AnalysisError } from '../lib/analysis/types.js'
import {
  expectedOf, moduleRunDir, readJson, runCase, runtimeReady, setupCase,
} from './analysis-fixture-harness.mjs'
import { runModuleOnSnapshot } from '../lib/analysis/runtime.js'
import { runtimeFrom } from './analysis-fixture-harness.mjs'

/**
 * `returns_risk` is the "series" input shape of the module protocol: one time-ordered price
 * column + an optional benchmark. Goldens are hand-computed from `fixtures/` inputs, not recorded
 * from module output; the README next to the fixtures lists each case.
 */
const FIXTURES = fileURLToPath(new URL('../python/analysis/modules/returns_risk/fixtures/', import.meta.url))
const MODULE = 'returns_risk'
const caseDir = (name) => join(FIXTURES, name)
const SESSION = { id: 'session-analysis-returns-risk', header: { cwd: '/workspace' } }

test('returns_risk 登记在静态 registry，manifest 声明序列口径与来源', async () => {
  const ids = listAnalysisModules().map((entry) => entry.manifest.id)
  assert.deepEqual(ids, ['hello', 'financial_quality', 'returns_risk', 'scenario_sensitivity'], 'registry 是静态白名单，按登记顺序列出')

  const entry = analysisModuleById(MODULE)
  assert.equal(entry.manifest.version, '1.0.0')
  assert.deepEqual([...entry.manifest.roles], ['senior_analyst'])
  assert.deepEqual([...entry.manifest.capabilities], ['dataset.read'], '模块只读 Dataset；不声明未使用的能力')
  assert.equal(entry.manifest.input_schema.additionalProperties, false, '参数未知字段必须被拒')
  assert.ok(entry.manifest.assumptions.length >= 3, 'manifest 必须显式列出假设')
  assert.ok(entry.manifest.applicability.length >= 2, 'manifest 必须写明适用条件')
  assert.equal(entry.manifest.provenance.source_type, 'original')
  assert.equal(entry.manifest.provenance.license, 'MIT')

  const license = await readFile(join(FIXTURES, '..', 'LICENSE'), 'utf8')
  assert.match(license, /MIT License/u)
  assert.match(license, /v587d/u)
})

test('normal：价格 + 基准序列的 golden 逐项对上，摘要与审计文件可核对', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('normal'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('normal'), moduleId: MODULE })

  assert.equal(outcome.status, expected.status)
  assert.deepEqual(outcome.metrics, expected.metrics, '指标必须与手算 golden 完全一致（含 6 位小数舍入）')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /区间收益 11\.00%/u)
  assert.match(outcome.summary, /年化波动 30\.52%/u)
  assert.match(outcome.summary, /最大回撤 -0\.98%/u)
  assert.match(outcome.summary, /夏普 26\.0482（rf=0\.00%）/u)
  assert.match(outcome.summary, /VaR95 0\.97%/u)
  assert.match(outcome.summary, /beta 1\.9518、相关 0\.9999（重叠 12 个日收益）/u)
  assert.deepEqual([...outcome.assumptions], [...analysisModuleById(MODULE).manifest.assumptions],
    '结果里的假设必须与 manifest 承诺的一致，否则 describe 与 run 会互相矛盾')

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'risk_metrics.json'))
  assert.equal(payload.price_dataset_id, 'ds_price')
  assert.equal(payload.time_column, 'date')
  assert.equal(payload.price_column, 'close')
  assert.equal(payload.benchmark.dataset_id, 'ds_benchmark')
  assert.equal(payload.benchmark.beta, 1.951821, '基准收益是 200→211 的序列，beta 不是 1')
  assert.equal(payload.window.start, '2024-01-02')
  assert.equal(payload.window.end, '2024-01-18')
  assert.equal(payload.series.length, 13)
  assert.equal(payload.series[1].return, 0.02, '第二个观测的收益 = 102/100-1')
  assert.equal(payload.series[12].return, -0.008929, '最后一个收益 = 111/112-1（6 位舍入）')
  assert.deepEqual(payload.parameters, { periods_per_year: 252, risk_free_rate: 0, confidence: 0.95 })
})

test('no_benchmark：单序列 completed，beta/相关缺席并在限制里披露', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('no_benchmark'))
  const { outcome } = await runCase({ caseDir: caseDir('no_benchmark'), moduleId: MODULE })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.equal('beta' in outcome.metrics, false)
  assert.equal('correlation' in outcome.metrics, false)
  assert.ok(outcome.limitations.some((line) => line.includes('未提供基准 Dataset')), '没给基准要披露，而不是静默省略')
  assert.doesNotMatch(outcome.summary, /beta/u)
})

test('bad_rows：坏价格与坏日期跳过并点名，partial 不填 0', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('bad_rows'))
  const { outcome } = await runCase({ caseDir: caseDir('bad_rows'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics, '跳过坏行后只算剩下的有效观测')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /有缺口/u)
})

test('duplicate：同一日期多行是输入错误，不静默取一行', async () => {
  resetAnalysisRuntimeState()
  const workspace = await setupCase({ caseDir: caseDir('duplicate'), moduleId: MODULE })
  await assert.rejects(
    () => runModuleOnSnapshot({
      writer: workspace.store,
      runtime: runtimeFrom(),
      session: SESSION,
      snapshot: workspace.record,
      module: analysisModuleById(MODULE),
      params: {},
    }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /2024-01-03/u.test(error.message)
      && /出现多行/u.test(error.message),
    '重复日期必须响亮失败并点名日期',
  )
})

test('ms_timezone：epoch 毫秒 + timezone 参数换算出正确日历日；time_coverage 列被采用', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('ms_timezone'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('ms_timezone'), moduleId: MODULE })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics)
  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'risk_metrics.json'))
  assert.equal(payload.time_column, 'trade_date_ms', 'time_coverage 指明的列优先于名字猜测')
  assert.equal(payload.window.start, '2024-01-02', 'Asia/Shanghai 零点换算后是当地日期，不是 UTC 前一天')
  assert.equal(payload.window.end, '2024-01-04')
})

test('too_short：有效观测不足 3 个 → blocked，不产出 outputs', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('too_short'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('too_short'), moduleId: MODULE })

  assert.equal(outcome.status, 'blocked')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  const { dir } = await moduleRunDir(root, record)
  assert.equal((await import('node:fs')).existsSync(join(dir, 'outputs')), false, 'blocked 结果不写 outputs：没有东西可复算')
})

test('参数越界：periods_per_year=0 在启动 Python 之前被拒', async () => {
  const workspace = await setupCase({ caseDir: caseDir('normal'), moduleId: MODULE })
  await assert.rejects(
    () => runModuleOnSnapshot({
      writer: workspace.store,
      runtime: runtimeFrom(),
      session: SESSION,
      snapshot: workspace.record,
      module: analysisModuleById(MODULE),
      params: { periods_per_year: 0 },
    }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /periods_per_year/u.test(error.message),
  )
})
