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
 * `scenario_sensitivity` is the "assumption grid" input shape: params only, no Dataset. Goldens are
 * hand-computed from the fixtures; the identity being evaluated is always the caller's, and the
 * module must never present the grid as a probability distribution.
 */
const FIXTURES = fileURLToPath(new URL('../python/analysis/modules/scenario_sensitivity/fixtures/', import.meta.url))
const MODULE = 'scenario_sensitivity'
const caseDir = (name) => join(FIXTURES, name)
const SESSION = { id: 'session-analysis-scenario-sensitivity', header: { cwd: '/workspace' } }

test('scenario_sensitivity 登记在静态 registry，manifest 声明参数形状与来源', async () => {
  const ids = listAnalysisModules().map((entry) => entry.manifest.id)
  assert.deepEqual(ids, ['hello', 'financial_quality', 'returns_risk', 'scenario_sensitivity'])

  const entry = analysisModuleById(MODULE)
  assert.equal(entry.manifest.version, '1.0.0')
  assert.deepEqual([...entry.manifest.roles], ['senior_analyst'])
  assert.deepEqual([...entry.manifest.capabilities], [], '参数型模块不读 Dataset / profile / evidence')
  assert.equal(entry.manifest.input_schema.additionalProperties, false)
  assert.ok(entry.manifest.assumptions.length >= 3)
  assert.ok(entry.manifest.applicability.length >= 2)
  assert.equal(entry.manifest.provenance.source_type, 'original')
  assert.equal(entry.manifest.provenance.license, 'MIT')

  const license = await readFile(join(FIXTURES, '..', 'LICENSE'), 'utf8')
  assert.match(license, /MIT License/u)
  assert.match(license, /v587d/u)
})

test('normal_grid：乘积恒等式 + full 网格 + 具名情景，golden 与审计文件逐项对上', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('normal_grid'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('normal_grid'), moduleId: MODULE })

  assert.equal(outcome.status, expected.status)
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /net_profit 基准 200CNY/u)
  assert.match(outcome.summary, /情景 3 个，目标区间 162–242CNY/u)
  assert.match(outcome.summary, /网格 9 格（full），目标区间 162–242CNY/u)
  assert.match(outcome.summary, /不是预测/u, '摘要必须点明这是恒等式取值，不是预测')
  assert.deepEqual([...outcome.assumptions], [...analysisModuleById(MODULE).manifest.assumptions])

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'scenarios.json'))
  assert.equal(payload.target.name, 'net_profit')
  assert.equal(payload.target.model, 'product')
  assert.equal(payload.target.expression, 'revenue × net_margin')
  assert.equal(payload.base_target, 200)
  assert.deepEqual(payload.scenarios.map((row) => row.target), [162, 200, 242])
  assert.deepEqual(payload.scenarios[1].inherited, ['revenue', 'net_margin'], '基准情景没有显式值，两个因子都继承')
  assert.equal(payload.grid.mode, 'full')
  assert.equal(payload.grid.cells, 9)
  const cell = payload.grid.rows.find((row) => row.values.revenue === 900 && row.values.net_margin === 0.18)
  assert.equal(cell.target, 162)
  const top = payload.grid.rows.find((row) => row.values.revenue === 1100 && row.values.net_margin === 0.22)
  assert.equal(top.target, 242)
})

test('oat_division：负指数（除权益）与单因子扫描，表达式中可见 ^-1', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('oat_division'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('oat_division'), moduleId: MODULE })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.match(outcome.summary, /roe 基准 0\.2ratio/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'scenarios.json'))
  assert.equal(payload.target.expression, 'net_profit × equity^-1')
  assert.equal(payload.grid.mode, 'oat')
  assert.deepEqual(payload.grid.rows.map((row) => row.value), [200, 250, 300])
  assert.deepEqual(payload.grid.rows.map((row) => row.target), [0.25, 0.2, 0.166667])
})

test('sum_weighted：加权和模型，表达式和权重口径可核对', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('sum_weighted'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('sum_weighted'), moduleId: MODULE })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics)
  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'scenarios.json'))
  assert.equal(payload.target.model, 'sum')
  assert.equal(payload.target.expression, 'revenue - cost')
  assert.deepEqual(payload.grid.rows.map((row) => row.target), [450, 400, 350])
})

test('zero_base：基准为 0 时变化率无定义 → partial + 缺口，不写 0 冒充百分比', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('zero_base'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('zero_base'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'scenarios.json'))
  assert.equal(payload.scenarios[0].delta_pct, null, '基准为 0 时变化率是 null，不是 0')
  assert.equal(payload.scenarios[0].target, 100)
})

test('invalid_negative：负基准配小数指数在启动计算前响亮拒绝', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const workspace = await setupCase({ caseDir: caseDir('invalid_negative'), moduleId: MODULE })
  const params = JSON.parse(await readFile(join(caseDir('invalid_negative'), 'params.json'), 'utf8'))
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
      && /只允许整数指数/u.test(error.message),
  )
})

test('invalid_scenario：情景里出现未声明因子被拒，不悄悄忽略', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const workspace = await setupCase({ caseDir: caseDir('invalid_scenario'), moduleId: MODULE })
  const params = JSON.parse(await readFile(join(caseDir('invalid_scenario'), 'params.json'), 'utf8'))
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
      && /不是已声明的因子/u.test(error.message),
  )
})

test('没有 grid 也没有 scenarios：只有基准值 → 输入错误，不产出空结果', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const workspace = await setupCase({ caseDir: caseDir('normal_grid'), moduleId: MODULE })
  await assert.rejects(
    () => runModuleOnSnapshot({
      writer: workspace.store,
      runtime: runtimeFrom(),
      session: SESSION,
      snapshot: workspace.record,
      module: analysisModuleById(MODULE),
      params: {
        target_name: 'net_profit',
        factors: [{ name: 'revenue', base: 1000 }, { name: 'net_margin', base: 0.2 }],
      },
    }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /至少给出 grid 或 scenarios/u.test(error.message),
  )
})
