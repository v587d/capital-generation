import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { analysisModuleById, listAnalysisModules } from '../lib/analysis/registry.js'
import { AnalysisError } from '../lib/analysis/types.js'
import {
  expectedOf, moduleRunDir, readJson, runCase, runtimeReady, setupCase,
} from './analysis-fixture-harness.mjs'
import { resetAnalysisRuntimeState, runModuleOnSnapshot } from '../lib/analysis/runtime.js'
import { runtimeFrom } from './analysis-fixture-harness.mjs'

/**
 * `valuation_sensitivity` is the "explicit valuation assumptions" shape: params only, no Dataset.
 * Goldens are hand-computed from the fixtures (see fixtures/README.md); the module must never
 * present the DCF output as a price target, and a grid cell with wacc ≤ g must stay null.
 */
const FIXTURES = fileURLToPath(new URL('../python/analysis/modules/valuation_sensitivity/fixtures/', import.meta.url))
const MODULE = 'valuation_sensitivity'
const caseDir = (name) => join(FIXTURES, name)
const SESSION = { id: 'session-analysis-valuation-sensitivity', header: { cwd: '/workspace' } }

const cellOf = (payload, wacc, terminalGrowth) => payload.sensitivity.cells
  .find((cell) => cell.wacc === wacc && cell.terminal_growth === terminalGrowth)

function assertGridCells(payload, expected) {
  for (const [key, value] of Object.entries(expected.grid_cells)) {
    const [wacc, terminalGrowth] = key.split(',').map(Number)
    const cell = cellOf(payload, wacc, terminalGrowth)
    assert.ok(cell, `审计表缺少格点 ${key}`)
    assert.equal(cell.value_per_share, value, `格点 ${key} 的每股模型值必须与手算一致`)
  }
}

async function storedResult(dir) {
  const stored = await readJson(join(dir, 'result.json'))
  assert.equal(stored.ok, true, 'result.json 必须是成功结果')
  return stored.result
}

test('valuation_sensitivity 登记在静态 registry，manifest 声明参数型 DCF 口径', async () => {
  const ids = listAnalysisModules().map((entry) => entry.manifest.id)
  assert.deepEqual(ids, ['hello', 'financial_quality', 'returns_risk', 'scenario_sensitivity',
    'statement_integrity', 'kline_quality', 'valuation_sensitivity',
    'comps_valuation', 'earnings_bridge',
    'technical_indicators', 'simple_backtest', 'portfolio_stress'], 'registry 是静态白名单，按登记顺序列出')

  const entry = analysisModuleById(MODULE)
  assert.equal(entry.manifest.version, '1.0.0')
  assert.deepEqual([...entry.manifest.roles], ['senior_analyst'])
  assert.deepEqual([...entry.manifest.capabilities], [], '参数型模块不读 Dataset / profile / evidence')
  assert.equal(entry.manifest.input_schema.additionalProperties, false, '参数未知字段必须被拒')
  assert.ok(entry.manifest.assumptions.length >= 4, 'manifest 必须显式列出假设')
  assert.ok(entry.manifest.applicability.length >= 3, 'manifest 必须写明适用条件')
  assert.equal(entry.manifest.provenance.source_type, 'original')
  assert.equal(entry.manifest.provenance.license, 'MIT')

  const license = await readFile(join(FIXTURES, '..', 'LICENSE'), 'utf8')
  assert.match(license, /MIT License/u)
  assert.match(license, /v587d/u)
})

test('normal：3 期 FCF + 显式 3×3 网格，metrics 与手算 golden 全等且审计文件逐格可复算', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('normal'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('normal'), moduleId: MODULE })

  assert.equal(outcome.status, expected.status)
  assert.deepEqual(outcome.metrics, expected.metrics, '指标必须与手算 golden 完全一致（含 6 位小数舍入）')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /3 期预测、wacc 10\.00%、终值增长 2\.00%/u)
  assert.match(outcome.summary, /EV 1431\.818182、股权价值 1231\.818182、每股模型值 12\.318182/u)
  assert.match(outcome.summary, /终值现值占 EV 80\.95%/u)
  assert.match(outcome.summary, /WACC \+1pp 每股模型值差分 -1\.612684、g \+1pp 1\.785714/u)
  assert.match(outcome.summary, /不是目标价/u, '摘要必须点明不是目标价')
  assert.match(outcome.summary, /不是预测/u, '摘要必须点明不是预测')
  assert.deepEqual([...outcome.assumptions], [...analysisModuleById(MODULE).manifest.assumptions],
    '结果里的假设必须与 manifest 承诺的逐字一致')

  const { dir } = await moduleRunDir(root, record)
  const result = await storedResult(dir)
  assert.deepEqual(result.sensitivity, expected.sensitivity, '敏感性摘要（中心格 / 相邻格 / 差分）必须与手算一致')
  assert.equal(result.sensitivity.center.value_per_share, 12.318182)
  assert.equal(result.sensitivity.wacc_1pp_value_per_share, -1.612684)
  assert.equal(result.sensitivity.growth_1pp_value_per_share, 1.785714)

  const payload = await readJson(join(dir, 'outputs', 'dcf_sensitivity.json'))
  assert.equal(payload.module_id, MODULE)
  assert.equal(payload.parameters.wacc, 0.1)
  assert.equal(payload.parameters.wacc_source, 'param')
  assert.equal(payload.parameters.mid_year, false)
  assert.deepEqual(payload.parameters.wacc_grid, [0.09, 0.1, 0.11])
  assert.deepEqual(payload.parameters.terminal_growth_grid, [0.01, 0.02, 0.03])
  assert.equal(payload.parameters.wacc_grid_source, 'explicit')
  assert.equal(payload.parameters.terminal_growth_grid_source, 'explicit')
  assert.equal(payload.capm, null, '显式 wacc 路径不写 CAPM 分量')
  assert.equal(payload.discounting.exponent_rule, 't')
  assert.equal(payload.discounting.terminal_value_exponent, 3)
  assert.deepEqual(payload.projections.map((row) => row.fcf), [100, 110, 121])
  assert.deepEqual(payload.projections.map((row) => row.present_value), [90.909091, 90.909091, 90.909091])
  assert.equal(payload.terminal_value.value, 1542.75)
  assert.equal(payload.terminal_value.present_value, 1159.090909)
  assert.equal(payload.enterprise_value, 1431.818182)
  assert.equal(payload.bridge.net_debt, 200)
  assert.equal(payload.bridge.equity_value, 1231.818182)
  assert.equal(payload.bridge.value_per_share, 12.318182)
  assert.equal(payload.sensitivity.null_cells, 0)
  assert.equal(cellOf(payload, 0.1, 0.02).value_per_share, 12.318182, '中心格')
  assert.equal(cellOf(payload, 0.09, 0.03).value_per_share, 16.817159, '角格（wacc 9%、g 3%）')
  assert.equal(cellOf(payload, 0.11, 0.01).value_per_share, 9.614317)
  assertGridCells(payload, expected)
  assert.deepEqual(payload.assumptions, [...analysisModuleById(MODULE).manifest.assumptions])
})

test('capm：CAPM 六参数推导 WACC 7.425%，默认网格写进结果', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('capm'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('capm'), moduleId: MODULE })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics, 'WACC 必须由 CAPM 推导后参与 DCF')
  assert.equal(outcome.metrics.wacc, 0.07425, 'Ke = 3% + 1.2×5% = 9%；WACC = 0.7×9% + 0.3×5%×0.75 = 7.425%')
  assert.match(outcome.summary, /wacc 7\.42%（CAPM 推导）/u)
  assert.match(outcome.summary, /每股模型值 19\.211543/u)

  const { dir } = await moduleRunDir(root, record)
  const result = await storedResult(dir)
  assert.deepEqual(result.sensitivity, expected.sensitivity)
  assert.ok(result.methodology_log.some((line) => /CAPM 推 WACC/u.test(line)),
    '方法日志必须写出 Ke / WACC 的推导口径')
  assert.ok(result.methodology_log.some((line) => /Ke = risk_free_rate \+ beta × equity_risk_premium = 0\.09/u.test(line)))

  const payload = await readJson(join(dir, 'outputs', 'dcf_sensitivity.json'))
  assert.equal(payload.parameters.wacc, 0.07425)
  assert.equal(payload.parameters.wacc_source, 'capm')
  assert.deepEqual(payload.capm, {
    cost_of_equity: 0.09,
    wacc: 0.07425,
    risk_free_rate: 0.03,
    beta: 1.2,
    equity_risk_premium: 0.05,
    cost_of_debt: 0.05,
    tax_rate: 0.25,
    debt_weight: 0.3,
  })
  assert.deepEqual(payload.parameters.wacc_grid, [0.06425, 0.07425, 0.08425], '省略 wacc_grid 时取 wacc ±1pp')
  assert.deepEqual(payload.parameters.terminal_growth_grid, [0.01, 0.02, 0.03], '省略 g 网格时取 g ±1pp')
  assert.equal(payload.parameters.wacc_grid_source, 'default')
  assert.equal(payload.parameters.terminal_growth_grid_source, 'default')
  assert.ok(result.methodology_log.some((line) => /默认标准点/u.test(line)),
    '默认网格必须写进方法日志，且不叫置信区间')
  assertGridCells(payload, expected)
})

test('mid_year：指数换成 t−0.5（终值 n−0.5），结果与年末口径不同', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('mid_year'))
  const normal = await expectedOf(caseDir('normal'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('mid_year'), moduleId: MODULE })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.notEqual(outcome.metrics.value_per_share, normal.metrics.value_per_share,
    '年中折现必须改变每股模型值，否则指数没有生效')
  assert.match(outcome.summary, /年中折现/u)
  assert.match(outcome.summary, /每股模型值 13\.017036/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'dcf_sensitivity.json'))
  assert.deepEqual(payload.projections.map((row) => row.exponent), [0.5, 1.5, 2.5])
  assert.equal(payload.discounting.exponent_rule, 't - 0.5')
  assert.equal(payload.discounting.terminal_value_exponent, 2.5, '终值按 n−0.5 折现，与最后一期同口径')
  assert.equal(payload.terminal_value.present_value, 1215.664801)
  assert.equal(cellOf(payload, 0.1, 0.02).value_per_share, 13.017036)
  assertGridCells(payload, expected)
})

test('net_cash：net_debt 为负（净现金）时股权桥方向正确，minority_interest 从 EV 扣除', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('net_cash'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('net_cash'), moduleId: MODULE })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.ok(outcome.metrics.equity_value > outcome.metrics.enterprise_value, '净现金状态股权价值高于 EV')

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'dcf_sensitivity.json'))
  assert.equal(payload.bridge.net_debt, -150, '负号表示净现金，桥上加回而不是扣除')
  assert.equal(payload.bridge.minority_interest, 25)
  assert.equal(payload.bridge.equity_value, 1627.759508, '股权 = EV 1502.759508 + 150 − 25')
  assert.equal(payload.parameters.wacc_grid_source, 'default')
  assert.deepEqual(payload.parameters.wacc_grid, [0.08, 0.09, 0.1])
  assertGridCells(payload, expected)
})

test('grid_null：wacc ≤ g 的格点写 null 并点名缺口，状态 partial，不写 0 冒充', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('grid_null'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('grid_null'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.equal(outcome.status, expected.status)
  assert.deepEqual(outcome.metrics, expected.metrics, '格点无定义不影响基准 DCF 指标')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps, '缺口必须点名具体格点的 wacc / g')
  assert.match(outcome.summary, /有缺口未计算/u)
  assert.match(outcome.summary, /不是目标价/u)

  const { dir } = await moduleRunDir(root, record)
  const result = await storedResult(dir)
  assert.deepEqual(result.sensitivity, expected.sensitivity)
  assert.equal(result.sensitivity.null_cells, 1)
  assert.equal(result.sensitivity.center.value_per_share, 12.318182, '中心格仍可算，摘要不因一个 null 格失效')

  const payload = await readJson(join(dir, 'outputs', 'dcf_sensitivity.json'))
  assert.equal(payload.sensitivity.null_cells, 1)
  assert.equal(cellOf(payload, 0.03, 0.03).value_per_share, null, 'wacc ≤ g 的格点必须是 null，不是 0')
  assert.equal(cellOf(payload, 0.03, 0.01).value_per_share, 57.034782)
  assert.equal(cellOf(payload, 0.1, 0.02).value_per_share, 12.318182)
  assert.equal(cellOf(payload, 0.11, 0.03).value_per_share, 12.069475)
  assertGridCells(payload, expected)
})

test('invalid_growth：wacc ≤ terminal_growth 在起算前被拒，点名两者', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const workspace = await setupCase({ caseDir: caseDir('invalid_growth'), moduleId: MODULE })
  const params = JSON.parse(await readFile(join(caseDir('invalid_growth'), 'params.json'), 'utf8'))
  await assert.rejects(
    () => runModuleOnSnapshot({
      writer: workspace.store,
      runtime: runtimeFrom(),
      session: SESSION,
      snapshot: workspace.record,
      module: analysisModuleById(MODULE),
      params,
    }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /wacc/u.test(error.message)
      && /terminal_growth/u.test(error.message)
      && /Gordon/u.test(error.message),
    'wacc ≤ g 必须直接拒绝，不能算出负分母',
  )
})

test('invalid_capm：没给 wacc 且 CAPM 不全时点名缺失参数，不猜默认值', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const workspace = await setupCase({ caseDir: caseDir('invalid_capm'), moduleId: MODULE })
  const params = JSON.parse(await readFile(join(caseDir('invalid_capm'), 'params.json'), 'utf8'))
  await assert.rejects(
    () => runModuleOnSnapshot({
      writer: workspace.store,
      runtime: runtimeFrom(),
      session: SESSION,
      snapshot: workspace.record,
      module: analysisModuleById(MODULE),
      params,
    }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /CAPM/u.test(error.message)
      && /cost_of_debt/u.test(error.message)
      && /tax_rate/u.test(error.message)
      && /debt_weight/u.test(error.message),
    '缺哪几个 CAPM 参数就点名哪几个',
  )
})

test('wacc 与 CAPM 同时给出时以 wacc 为准，并在方法日志说明', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('normal'))
  const params = JSON.parse(await readFile(join(caseDir('normal'), 'params.json'), 'utf8'))
  Object.assign(params, {
    risk_free_rate: 0.03, beta: 1.2, equity_risk_premium: 0.05,
    cost_of_debt: 0.05, tax_rate: 0.25, debt_weight: 0.3,
  })
  const { root, record, outcome } = await runCase({ caseDir: caseDir('normal'), moduleId: MODULE, params })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics, '同时给 CAPM 时仍用显式 wacc（10%），不是 CAPM 的 7.425%')
  const { dir } = await moduleRunDir(root, record)
  const result = await storedResult(dir)
  assert.ok(result.methodology_log.some((line) => /以显式 wacc 为准/u.test(line)))
  const payload = await readJson(join(dir, 'outputs', 'dcf_sensitivity.json'))
  assert.equal(payload.parameters.wacc_source, 'param')
  assert.equal(payload.capm, null)
})

test('可选输入缺失：net_debt / shares_outstanding 缺失时只算能算的部分 → partial + 缺口，不按 0 处理', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const base = JSON.parse(await readFile(join(caseDir('normal'), 'params.json'), 'utf8'))

  const noNetDebt = { ...base }
  delete noNetDebt.net_debt
  const first = await runCase({ caseDir: caseDir('normal'), moduleId: MODULE, params: noNetDebt })
  assert.equal(first.outcome.status, 'partial')
  assert.equal(first.outcome.metrics.enterprise_value, 1431.818182, 'EV 不依赖 net_debt，仍可复算')
  assert.equal(first.outcome.metrics.equity_value, null, '缺 net_debt 时不把股权价值当 EV')
  assert.equal(first.outcome.metrics.value_per_share, null)
  assert.ok(first.outcome.data_gaps.some((line) => /net_debt 缺失/u.test(line)), '缺 net_debt 要写缺口并点名')
  const firstDir = await moduleRunDir(first.root, first.record)
  const firstPayload = await readJson(join(firstDir.dir, 'outputs', 'dcf_sensitivity.json'))
  assert.equal(firstPayload.bridge.equity_value, null)
  assert.equal(firstPayload.bridge.net_debt, null)
  assert.ok(firstPayload.sensitivity.cells.every((cell) => cell.value_per_share === null),
    '没有股权桥就没有每股模型值，网格不写 0')

  const noShares = { ...base }
  delete noShares.shares_outstanding
  const second = await runCase({ caseDir: caseDir('normal'), moduleId: MODULE, params: noShares })
  assert.equal(second.outcome.status, 'partial')
  assert.equal(second.outcome.metrics.equity_value, 1231.818182, '股权价值不依赖股本')
  assert.equal(second.outcome.metrics.value_per_share, null)
  assert.ok(second.outcome.data_gaps.some((line) => /shares_outstanding 缺失/u.test(line)))
  const secondDir = await moduleRunDir(second.root, second.record)
  const secondPayload = await readJson(join(secondDir.dir, 'outputs', 'dcf_sensitivity.json'))
  assert.equal(secondPayload.bridge.equity_value, 1231.818182)
  assert.equal(secondPayload.bridge.shares_outstanding, null)
})

test('projections 为空：起算前 analysis_input_invalid，不产出空结果', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const workspace = await setupCase({ caseDir: caseDir('normal'), moduleId: MODULE })
  const params = JSON.parse(await readFile(join(caseDir('normal'), 'params.json'), 'utf8'))
  params.projections = []
  await assert.rejects(
    () => runModuleOnSnapshot({
      writer: workspace.store,
      runtime: runtimeFrom(),
      session: SESSION,
      snapshot: workspace.record,
      module: analysisModuleById(MODULE),
      params,
    }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /projections/u.test(error.message),
  )
})
