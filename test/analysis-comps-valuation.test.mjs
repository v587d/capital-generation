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
 * `comps_valuation` is the cross-section multiple table: one row per peer, medians over the valid
 * samples, and an optional subject comparison. Goldens are hand-computed from `fixtures/`.
 */
const FIXTURES = fileURLToPath(new URL('../python/analysis/modules/comps_valuation/fixtures/', import.meta.url))
const MODULE = 'comps_valuation'
const caseDir = (name) => join(FIXTURES, name)

test('comps_valuation 登记在静态 registry，manifest 声明倍数口径与来源', async () => {
  const ids = listAnalysisModules().map((entry) => entry.manifest.id)
  assert.ok(ids.includes(MODULE), `registry 里必须有 ${MODULE}；当前：${ids.join(', ')}`)
  assert.equal(ids.indexOf(MODULE), ids.lastIndexOf(MODULE), 'registry 不能重复登记')

  const entry = analysisModuleById(MODULE)
  assert.equal(entry.manifest.version, '1.0.0')
  assert.deepEqual([...entry.manifest.roles], ['senior_analyst'])
  assert.deepEqual([...entry.manifest.capabilities], ['dataset.read'])
  assert.equal(entry.manifest.input_schema.additionalProperties, false, '参数未知字段必须被拒')
  assert.ok(entry.manifest.assumptions.length >= 5)
  assert.ok(entry.manifest.applicability.length >= 3)
  assert.equal(entry.manifest.provenance.source_type, 'original')
  assert.equal(entry.manifest.provenance.license, 'MIT')

  const license = await readFile(join(FIXTURES, '..', 'LICENSE'), 'utf8')
  assert.match(license, /MIT License/u)
  assert.match(license, /v587d/u)
})

test('normal：四个倍数的中位数与标的溢价逐项对上', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('normal'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('normal'), moduleId: MODULE })

  assert.equal(outcome.status, expected.status)
  assert.deepEqual(outcome.metrics, expected.metrics, '指标必须与手算 golden 完全一致')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /P\/E 中位数 20（5 家），标的 22（\+10\.00%）/u)
  assert.match(outcome.summary, /P\/S 中位数 1\.25（5 家），标的 2（\+60\.00%）/u)
  assert.deepEqual([...outcome.assumptions], [...analysisModuleById(MODULE).manifest.assumptions])

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'comps.json'))
  assert.equal(payload.peers.length, 5)
  assert.equal(payload.subject.ticker, 'T')
  assert.equal(payload.medians.pe.median, 20)
  assert.equal(payload.medians.ps.count, 5)
  assert.equal(payload.peers[4].multiples.ps, 1.333333, '1200/900 保留 6 位小数')
  assert.equal(payload.subject.multiples.pe, 22)
  assert.equal(payload.ticker_column, 'ticker')
})

test('negative_earnings：亏损公司的 P/E 退出样本，但仍在审计文件里', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('negative_earnings'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('negative_earnings'), moduleId: MODULE })

  assert.equal(outcome.status, expected.status)
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /P\/E 中位数 20（3 家）/u)
  assert.match(outcome.summary, /剔除 P\/E 1 家/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'comps.json'))
  assert.deepEqual(payload.excluded, { 'P/E': 1 })
  assert.deepEqual(payload.peers[1].multiples, { pb: 2, ps: 2, ev_ebitda: 11 }, '亏损行只有 P/E 缺席')
})

test('missing_optional：可选列缺失只影响对应倍数，逐项写缺口', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('missing_optional'))
  const { outcome } = await runCase({ caseDir: caseDir('missing_optional'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /P\/E 中位数 20（3 家）/u)
  assert.match(outcome.summary, /3 项缺口/u)
})

test('single_peer：只有一家时中位数等于它，并披露样本不足', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('single_peer'))
  const { outcome } = await runCase({ caseDir: caseDir('single_peer'), moduleId: MODULE })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.ok(outcome.limitations.some((line) => line.includes('只有 1 家')), '样本不足必须写进 limitations')
})

test('duplicate_ticker：同一公司两行在运行前失败', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  await assert.rejects(
    () => runCase({ caseDir: caseDir('duplicate_ticker'), moduleId: MODULE }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /出现多行/u.test(error.message),
  )
})

test('not_comps：不是 peers 表时运行前失败，不猜列语义', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  await assert.rejects(
    () => runCase({ caseDir: caseDir('not_comps'), moduleId: MODULE }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /peer/u.test(error.message),
  )
})

test('subject_multi_row：标的表多行时运行前失败', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  await assert.rejects(
    () => runCase({ caseDir: caseDir('subject_multi_row'), moduleId: MODULE }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /只有一行/u.test(error.message),
  )
})

test('ambiguous：多份同型表且没指名时运行前失败', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  await assert.rejects(
    () => runCase({ caseDir: caseDir('ambiguous'), moduleId: MODULE }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /peers_dataset_id/u.test(error.message),
  )
})
