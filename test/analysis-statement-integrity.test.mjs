import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { analysisModuleById, listAnalysisModules } from '../lib/analysis/registry.js'
import { resetAnalysisRuntimeState, runModuleOnSnapshot } from '../lib/analysis/runtime.js'
import { runtimeFrom } from './analysis-fixture-harness.mjs'
import { AnalysisError } from '../lib/analysis/types.js'
import {
  expectedOf, moduleRunDir, readJson, runCase, runtimeReady,
} from './analysis-fixture-harness.mjs'

/**
 * `statement_integrity` checks the three identities that tie the statements together. Goldens are
 * hand-computed from `fixtures/` inputs (see fixtures/README.md), not recorded from module output.
 */
const FIXTURES = fileURLToPath(new URL('../python/analysis/modules/statement_integrity/fixtures/', import.meta.url))
const MODULE = 'statement_integrity'
const caseDir = (name) => join(FIXTURES, name)

test('statement_integrity 登记在静态 registry，manifest 声明三表勾稽口径与来源', async () => {
  const ids = listAnalysisModules().map((entry) => entry.manifest.id)
  assert.deepEqual(ids, [
    'hello', 'financial_quality', 'returns_risk', 'scenario_sensitivity',
    'statement_integrity', 'kline_quality', 'valuation_sensitivity',
    'comps_valuation', 'earnings_bridge',
    'technical_indicators', 'simple_backtest', 'portfolio_stress',
  ], 'registry 是静态白名单，按登记顺序列出')

  const entry = analysisModuleById(MODULE)
  assert.equal(entry.manifest.version, '1.0.0')
  assert.deepEqual([...entry.manifest.roles], ['senior_analyst'])
  assert.deepEqual([...entry.manifest.capabilities], ['dataset.read'], '只读 Dataset；不声明未使用的能力')
  assert.equal(entry.manifest.input_schema.additionalProperties, false, '参数未知字段必须被拒')
  assert.ok(entry.manifest.assumptions.length >= 4, 'manifest 必须显式列出假设')
  assert.ok(entry.manifest.applicability.length >= 3, 'manifest 必须写明适用条件')
  assert.equal(entry.manifest.provenance.source_type, 'original')
  assert.equal(entry.manifest.provenance.license, 'MIT')

  const license = await readFile(join(FIXTURES, '..', 'LICENSE'), 'utf8')
  assert.match(license, /MIT License/u)
  assert.match(license, /v587d/u)
})

test('normal：三表勾稽全部对平，审计文件逐条可复算', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('normal'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('normal'), moduleId: MODULE })

  assert.equal(outcome.status, expected.status)
  assert.deepEqual(outcome.metrics, expected.metrics, '指标必须与手算 golden 完全一致')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /2024-12-31 三表勾稽/u)
  assert.match(outcome.summary, /资产负债恒等式差异 0（容差 0\.10%，通过）/u)
  assert.match(outcome.summary, /现金流对账差异 0（容差 0\.10%，通过）/u)
  assert.match(outcome.summary, /留存收益滚动差异 0（容差 0\.10%，通过）/u)
  assert.match(outcome.summary, /共 3 项校验，0 项未通过/u)
  assert.deepEqual([...outcome.assumptions], [...analysisModuleById(MODULE).manifest.assumptions],
    '结果里的假设必须与 manifest 承诺的一致，否则 describe 与 run 会互相矛盾')

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'integrity_checks.json'))
  assert.equal(payload.period, '2024-12-31')
  assert.equal(payload.period_key, 'period_end_ms')
  assert.deepEqual(payload.statements, { balance: 'ds_balance', cashflow: 'ds_cashflow', income: 'ds_income' })
  assert.deepEqual(payload.parameters, { tolerance_ratio: 0.001, tolerance_abs: 0 })
  assert.deepEqual(payload.checks.map((check) => [check.check, check.status]), [
    ['balance', 'pass'], ['cash', 'pass'], ['retained_earnings', 'pass'],
  ])
  assert.equal(payload.checks[0].residual, 0)
  assert.equal(payload.checks[0].inputs.assets_total, 300_000_000_000)
  assert.equal(payload.checks[1].inputs.act_cash_flow_net, 60_000_000_000)
  assert.equal(payload.checks[1].inputs.cash_equivalents_net_addition, 25_000_000_000)
  assert.equal(payload.checks[2].previous_period, '2023-12-31')
  assert.equal(payload.checks[2].dividends_source, 'cashflow.dividends_paid')
  assert.deepEqual(payload.findings, [])
})

test('imbalance：差异超过容差只报未通过，不改写数据也不判造假', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('imbalance'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('imbalance'), moduleId: MODULE })

  assert.equal(outcome.status, expected.status)
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps, '差异是发现，不是缺口')
  assert.match(outcome.summary, /资产负债恒等式差异 600000000（占基准 0\.20%，容差 0\.10%，未通过）/u)
  assert.match(outcome.summary, /共 3 项校验，1 项未通过/u)
  assert.match(outcome.summary, /现金流对账差异 0（容差 0\.10%，通过）/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'integrity_checks.json'))
  assert.equal(payload.checks[0].status, 'fail')
  assert.equal(payload.checks[0].residual, 600_000_000)
  assert.equal(payload.checks[0].residual_ratio, 0.002)
  assert.match(payload.findings[0], /资产负债恒等式差异 600000000/u)
})

test('imbalance：容差是显式参数，调宽后同一份数据判通过', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const { root, record, outcome } = await runCase({
    caseDir: caseDir('imbalance'), moduleId: MODULE, params: { tolerance_ratio: 0.01 },
  })

  assert.equal(outcome.status, 'completed')
  assert.equal(outcome.metrics.checks_failed, 0)
  assert.equal(outcome.metrics.balance_within_tolerance, true)
  assert.equal(outcome.metrics.tolerance_ratio, 0.01)
  assert.match(outcome.summary, /容差 1\.00%/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'integrity_checks.json'))
  assert.deepEqual(payload.parameters, { tolerance_ratio: 0.01, tolerance_abs: 0 })
})

test('real_a_share：fuyao 形状缺留存收益列，两项校验仍完成并点名缺口', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('real_a_share'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('real_a_share'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /共 2 项校验，0 项未通过；另有 1 项缺口/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'integrity_checks.json'))
  assert.equal(payload.checks[2].status, 'skipped')
  assert.match(payload.checks[2].reason, /retained_earnings/u)
  assert.equal(payload.checks[2].formula, 'retained_earnings(end) = retained_earnings(prev) + net_profit - dividends_paid - Δsurplus_reserve')
})

test('fx_reconciliation：汇率影响只在列存在时计入，对账才对平', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('fx_reconciliation'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('fx_reconciliation'), moduleId: MODULE })

  assert.equal(outcome.status, expected.status)
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.equal(outcome.metrics.cash_residual, 0)
  assert.equal(outcome.metrics.cash_within_tolerance, true)

  const { dir } = await moduleRunDir(root, record)
  const result = await readJson(join(dir, 'result.json'))
  assert.ok(result.result.methodology_log.some((line) => line.includes('effect_of_exchange_rate_changes')),
    '方法日志必须说明汇率影响已计入')
  const payload = await readJson(join(dir, 'outputs', 'integrity_checks.json'))
  assert.equal(payload.checks[1].foreign_exchange_included, true)
  assert.equal(payload.checks[1].inputs.effect_of_exchange_rate_changes, 1_500_000_000)
})

test('missing_balance：没有资产负债表时现金流照常对账，其余两项写缺口', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('missing_balance'))
  const { outcome } = await runCase({ caseDir: caseDir('missing_balance'), moduleId: MODULE })

  assert.equal(outcome.status, expected.status)
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.equal(outcome.metrics.balance_checked, false)
  assert.equal(outcome.metrics.retained_earnings_checked, false)
  assert.match(outcome.summary, /共 1 项校验，0 项未通过；另有 3 项缺口/u)
})

test('duplicate_period：同一报告期两行在运行前响亮失败', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  await assert.rejects(
    () => runCase({ caseDir: caseDir('duplicate_period'), moduleId: MODULE }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /出现多行/u.test(error.message),
  )
})

test('unrelated：没有三表 Dataset 时运行前失败，不猜列语义', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  await assert.rejects(
    () => runCase({ caseDir: caseDir('unrelated'), moduleId: MODULE }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /没有任何三张报表/u.test(error.message),
  )
})

test('statement_integrity 不支持的模块 id 不会被 registry 解析', () => {
  assert.equal(analysisModuleById('statement_integrity_v9'), undefined)
})
