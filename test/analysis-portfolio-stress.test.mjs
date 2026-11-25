import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { analysisModuleById, listAnalysisModules } from '../lib/analysis/registry.js'
import { resetAnalysisRuntimeState, runModuleOnSnapshot } from '../lib/analysis/runtime.js'
import { AnalysisError } from '../lib/analysis/types.js'
import {
  expectedOf, moduleRunDir, readJson, runCase, runtimeFrom, runtimeReady, setupCase,
} from './analysis-fixture-harness.mjs'

/**
 * `portfolio_stress` is the "portfolio across historical windows" input shape: one price-series
 * Dataset per position plus static weights, replayed over the caller's already-happened windows.
 * Goldens are hand-computed from `fixtures/` inputs, never recorded from module output; the README
 * next to the fixtures lists each case and the arithmetic. Missing coverage is a gap — the module
 * never borrows a date, never renormalizes weights, and never forecasts.
 */
const FIXTURES = fileURLToPath(new URL('../python/analysis/modules/portfolio_stress/fixtures/', import.meta.url))
const MODULE = 'portfolio_stress'
const caseDir = (name) => join(FIXTURES, name)
const SESSION = { id: 'session-analysis-portfolio-stress', header: { cwd: '/workspace' } }

/** One rejected run: the fixture's own params are used so the golden inputs stay in one place. */
async function invalidRun(name) {
  const workspace = await setupCase({ caseDir: caseDir(name), moduleId: MODULE })
  const params = await readJson(join(caseDir(name), 'params.json'))
  return await runModuleOnSnapshot({
    writer: workspace.store,
    runtime: runtimeFrom(),
    session: SESSION,
    snapshot: workspace.record,
    module: analysisModuleById(MODULE),
    params,
  })
}

test('portfolio_stress 登记在静态 registry，manifest 声明回放口径与来源', async () => {
  const ids = listAnalysisModules().map((entry) => entry.manifest.id)
  assert.ok(ids.includes('portfolio_stress'), 'registry 是静态白名单：新增模块必须登记')

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

test('normal：3 个持仓 × 2 个窗口的手算 golden 逐项对上，Σ贡献 = 组合收益', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('normal'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('normal'), moduleId: MODULE })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics, '指标必须与手算 golden 完全一致（含 6 位小数舍入）')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /历史窗口回放（不是假设情景、不预测未来）/u)
  assert.match(outcome.summary, /权重最大 50\.00%/u, '权重写成 50.00% 时锚点 0.50')
  assert.match(outcome.summary, /HHI 0\.3800/u)
  assert.match(outcome.summary, /第一周 3\.25%/u)
  assert.match(outcome.summary, /第二周 4\.60%/u)
  assert.match(outcome.summary, /最差窗口 3\.25%、最好窗口 4\.60%/u)
  assert.deepEqual([...outcome.assumptions], [...analysisModuleById(MODULE).manifest.assumptions],
    '结果里的假设必须与 manifest 承诺的一致，否则 describe 与 run 会互相矛盾')

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'portfolio_stress.json'))
  assert.equal(payload.module_id, MODULE)
  assert.deepEqual(payload.parameters, { price_column: null, time_column: null, timezone: null })
  assert.deepEqual(payload.positions.map((item) => item.dataset_id), ['ds_equity', 'ds_bond', 'ds_gold'])
  assert.equal(payload.positions[0].coverage.first_date, '2024-01-02')
  assert.equal(payload.positions[0].coverage.last_date, '2024-01-10')
  assert.equal(payload.positions[0].coverage.first_price, 100)
  assert.equal(payload.positions[0].coverage.last_price, 121)
  assert.match(payload.method.portfolio_return, /不按剩余权重重归一化/u, '审计文件必须写明组合收益的口径')
  assert.equal(payload.windows.length, 2)
  assert.equal(payload.concentration.hhi, 0.38)
  assert.equal(payload.concentration.max_weight, 0.5)
  for (const window of payload.windows) {
    const contributions = window.positions.reduce((total, item) => total + item.contribution, 0)
    assert.ok(Math.abs(contributions - window.portfolio_return) < 1e-9,
      `Σ贡献 必须等于组合收益（${window.name}）`)
    assert.equal(window.contribution_sum, window.portfolio_return)
  }
  const bond = payload.windows[0].positions[1]
  assert.equal(bond.first_date, '2024-01-02')
  assert.equal(bond.first_price, 100)
  assert.equal(bond.last_date, '2024-01-05')
  assert.equal(bond.last_price, 101.5)
  assert.equal(bond.return, 0.015, 'bond 第一周 101.5/100-1')
  assert.equal(payload.windows[1].positions[2].return, -0.05, 'gold 第二周 190/200-1')
})

test('ms_timezone：epoch 毫秒按 timezone 标日历日，time_coverage 列被采用', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('ms_timezone'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('ms_timezone'), moduleId: MODULE })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics, '上海零点换算后窗口才落在 2024-01-02..05')
  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'portfolio_stress.json'))
  assert.equal(payload.parameters.timezone, 'Asia/Shanghai')
  assert.equal(payload.positions[0].time_column, 'trade_date_ms', 'time_coverage 指明的列优先于名字猜测')
  assert.equal(payload.positions[0].coverage.first_date, '2024-01-02', '当地日期，不是 UTC 前一天')
  assert.equal(payload.positions[0].coverage.last_date, '2024-01-05')
  assert.equal(payload.windows[0].portfolio_return, 0.05)
})

test('weights_not_one：权重合计 0.9 在价格计算前被拒（analysis_input_invalid）', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  await assert.rejects(
    () => invalidRun('weights_not_one'),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /权重合计必须为 1/u.test(error.message)
      && /0\.900000/u.test(error.message),
    '权重合计不为 1 必须响亮失败并给出实际值',
  )
})

test('missing_window：窗口越出某持仓覆盖 → 该窗口 null + 缺口，不重归一化', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('missing_window'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('missing_window'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics, '算不出的窗口不写 window_1_return，其余窗口照常')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /1 个窗口没有可回放的区间收益/u)
  assert.match(outcome.summary, /缺口/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'portfolio_stress.json'))
  const missing = payload.windows[0]
  assert.equal(missing.portfolio_return, null, '任一持仓算不出，组合收益就是 null')
  assert.equal(missing.contribution_sum, null)
  assert.equal(missing.positions[0].contribution, 0.014, '已算出的持仓贡献仍留在审计文件里，但不参与组合收益')
  assert.equal(missing.positions[1].status, 'missing')
  assert.equal(missing.positions[1].first_price, null)
  assert.equal(payload.windows[1].portfolio_return, 0.066902)
})

test('too_short_window：窗口内只有 1 个可用价格 → partial 并点名窗口与数据集', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('too_short_window'))
  const { outcome } = await runCase({ caseDir: caseDir('too_short_window'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.data_gaps[0], /只有单点/u, '缺口必须点名窗口')
  assert.match(outcome.data_gaps[0], /ds_equity/u, '缺口必须点名数据集')
  assert.match(outcome.data_gaps[0], /只有 1 个可用价格/u)
  assert.doesNotMatch(outcome.summary, /只有单点 [-\d]/u, '算不出的窗口不写收益进摘要')
})

test('bad_rows：非正/缺价行跳过并点名，partial 不填 0', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('bad_rows'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('bad_rows'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics, '跳过坏行后只算剩下的有效价格')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.data_gaps[0], /跳过 3 行/u)
  assert.match(outcome.data_gaps[0], /ds_equity/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'portfolio_stress.json'))
  assert.equal(payload.positions[0].skipped_rows, 3)
  assert.equal(payload.positions[0].observations, 3)
  assert.equal(payload.windows[0].portfolio_return, 0.04, '窗口用 100→104 的有效价格算，而不是把坏行当 0')
})

test('duplicate_position：同一 dataset_id 出现两次是输入错误，不静默合并', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  await assert.rejects(
    () => invalidRun('duplicate_position'),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /ds_equity/u.test(error.message)
      && /出现了多次/u.test(error.message),
    '重复持仓必须响亮失败并点名数据集',
  )
})

test('unrelated：没有价格列的行不是价格序列，输入错误并点名数据集', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  await assert.rejects(
    () => invalidRun('unrelated'),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /ds_fundamentals/u.test(error.message)
      && /找不到价格列/u.test(error.message),
    '非价格序列必须响亮失败，而不是按空序列下结论',
  )
})

test('blocked：所有窗口都算不成 → blocked，不写 outputs', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('blocked'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('blocked'), moduleId: MODULE })

  assert.equal(outcome.status, 'blocked')
  assert.deepEqual(outcome.metrics, expected.metrics, '窗口全不可算时只留计数与集中度')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.equal('window_1_return' in outcome.metrics, false)
  assert.equal('worst_window_return' in outcome.metrics, false)
  assert.match(outcome.summary, /所有窗口都没有可回放的区间收益/u)

  const { dir } = await moduleRunDir(root, record)
  assert.equal(existsSync(join(dir, 'outputs')), false, 'blocked 结果不写 outputs：没有可复算的区间收益')
})

test('windows 的 start 必须早于 end：否则运行前 analysis_input_invalid', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const workspace = await setupCase({ caseDir: caseDir('normal'), moduleId: MODULE })
  await assert.rejects(
    () => runModuleOnSnapshot({
      writer: workspace.store,
      runtime: runtimeFrom(),
      session: SESSION,
      snapshot: workspace.record,
      module: analysisModuleById(MODULE),
      params: {
        positions: [{ dataset_id: 'ds_equity', weight: 1 }],
        windows: [{ name: '倒序窗口', start: '2024-01-05', end: '2024-01-02' }],
      },
    }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /start（2024-01-05）必须早于 end（2024-01-02）/u.test(error.message),
  )
})

test('positions 超过 30 个在宿主输入契约处被拒，不启动 Python', async () => {
  resetAnalysisRuntimeState()
  const workspace = await setupCase({ caseDir: caseDir('normal'), moduleId: MODULE })
  const positions = Array.from({ length: 31 }, (_, index) => ({ dataset_id: `ds_${index}`, weight: 1 / 31 }))
  await assert.rejects(
    () => runModuleOnSnapshot({
      writer: workspace.store,
      runtime: runtimeFrom(),
      session: SESSION,
      snapshot: workspace.record,
      module: analysisModuleById(MODULE),
      params: {
        positions,
        windows: [{ name: '越界持仓数', start: '2024-01-02', end: '2024-01-05' }],
      },
    }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /positions/u.test(error.message)
      && /条目过多/u.test(error.message),
    '宿主按 manifest maxItems 拒绝 31 个持仓',
  )
})
