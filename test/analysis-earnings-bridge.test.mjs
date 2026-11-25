import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { analysisModuleById, listAnalysisModules } from '../lib/analysis/registry.js'
import { resetAnalysisRuntimeState } from '../lib/analysis/runtime.js'
import { AnalysisError } from '../lib/analysis/types.js'
import {
  expectedOf, moduleRunDir, readJson, runCase, runtimeReady,
} from './analysis-fixture-harness.mjs'

/**
 * `earnings_bridge` explains the net-profit change between two periods with two exact identities.
 * Goldens are hand-computed from `fixtures/` (see fixtures/README.md), not recorded from output.
 */
const FIXTURES = fileURLToPath(new URL('../python/analysis/modules/earnings_bridge/fixtures/', import.meta.url))
const MODULE = 'earnings_bridge'
const caseDir = (name) => join(FIXTURES, name)

test('earnings_bridge 登记在静态 registry，manifest 声明两条恒等式与来源', async () => {
  const ids = listAnalysisModules().map((entry) => entry.manifest.id)
  assert.ok(ids.includes(MODULE), `registry 里必须有 ${MODULE}；当前：${ids.join(', ')}`)
  assert.equal(ids.indexOf(MODULE), ids.lastIndexOf(MODULE), 'registry 不能重复登记')

  const entry = analysisModuleById(MODULE)
  assert.equal(entry.manifest.version, '1.0.0')
  assert.deepEqual([...entry.manifest.roles], ['senior_analyst'])
  assert.deepEqual([...entry.manifest.capabilities], ['dataset.read'])
  assert.equal(entry.manifest.input_schema.additionalProperties, false, '参数未知字段必须被拒')
  assert.ok(entry.manifest.assumptions.length >= 4)
  assert.ok(entry.manifest.applicability.length >= 3)
  assert.equal(entry.manifest.provenance.source_type, 'original')
  assert.match(entry.manifest.assumptions[0], /交互项/u, 'manifest 必须把交互项写进假设')

  const license = await readFile(join(FIXTURES, '..', 'LICENSE'), 'utf8')
  assert.match(license, /MIT License/u)
})

test('normal：两条归因的三项效应都回到净利润差额', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('normal'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('normal'), moduleId: MODULE })

  assert.equal(outcome.status, expected.status)
  assert.deepEqual(outcome.metrics, expected.metrics, '指标必须与手算 golden 完全一致')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /2024-12-31 较 2023-12-31/u)
  assert.match(outcome.summary, /收入效应 \+2000000000、净利率效应 \+5000000000、交互 \+1000000000（合计校验 0）/u)
  assert.match(outcome.summary, /税前效应 \+6000000000、税率效应 \+1250000000、交互 \+750000000（合计校验 0）/u)
  assert.deepEqual([...outcome.assumptions], [...analysisModuleById(MODULE).manifest.assumptions])

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'earnings_bridge.json'))
  assert.equal(payload.period, '2024-12-31')
  assert.equal(payload.previous_period, '2023-12-31')
  assert.equal(payload.income_dataset_id, 'ds_income')
  assert.equal(payload.revenue_bridge.revenue_effect, 2_000_000_000)
  assert.equal(payload.revenue_bridge.bridge_residual, 0)
  assert.equal(payload.tax_bridge.tax_rate_effect, 1_250_000_000)
  assert.equal(payload.tax_bridge.tax_bridge_residual, 0)
  assert.deepEqual(payload.data_gaps, [])
})

test('negative_pretax：上期利润总额为负时只跳过税前分解，收入分解照常', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('negative_pretax'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('negative_pretax'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.equal('tax_rate_previous' in outcome.metrics, false)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'earnings_bridge.json'))
  assert.equal(payload.revenue_bridge.bridge_residual, 0)
  assert.equal(payload.tax_bridge, null, '不可计算的分解必须留 null，不能填 0')
})

test('single_period：只有一期时 blocked，不编造上一期', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('single_period'))
  const { outcome } = await runCase({ caseDir: caseDir('single_period'), moduleId: MODULE })

  assert.equal(outcome.status, 'blocked')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /只有一期利润表/u)
})

test('zero_revenue：上期营收为 0 时收入分解写缺口，税前分解照常', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('zero_revenue'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('zero_revenue'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.equal('revenue_effect' in outcome.metrics, false)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'earnings_bridge.json'))
  assert.equal(payload.revenue_bridge, null)
  assert.equal(payload.tax_bridge.tax_bridge_residual, 0)
})

test('duplicate_period：同一报告期两行在运行前失败', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  await assert.rejects(
    () => runCase({ caseDir: caseDir('duplicate_period'), moduleId: MODULE }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /出现多行/u.test(error.message),
  )
})

test('unrelated：不是利润表时运行前失败，不把价格表当利润表', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  await assert.rejects(
    () => runCase({ caseDir: caseDir('unrelated'), moduleId: MODULE }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /operating_income/u.test(error.message),
  )
})
