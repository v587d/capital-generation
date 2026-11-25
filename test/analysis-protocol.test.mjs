import { test } from 'node:test'
import assert from 'node:assert/strict'
import { basename, join } from 'node:path'

import { analysisModuleById, listAnalysisModules } from '../lib/analysis/registry.js'
import { stableStringify } from '../lib/analysis/snapshot.js'
import { MODULE_DEFAULT_LIMITS } from '../lib/analysis/schemas.js'
import { parseArtifactRef, parseSnapshotRef, snapshotRef, artifactRef } from '../lib/analysis/storage.js'
import { AnalysisError } from '../lib/analysis/types.js'
import { losslessIssues, numberTokens, validateAgainstSchema, validateArtifact, validateModuleResult } from '../lib/analysis/validation.js'

const SNAPSHOT = {
  analysis_id: 'analysis_test0001',
  task_id: 'task_1',
  question: '测试问题',
  purpose: 'research',
  depth: 'standard',
  as_of: '2026-11-24',
  dataset_refs: [{ dataset_id: 'ds_1' }],
  profile_refs: [{ profile_id: 'p_1' }],
  evidence: [{ source_id: 'ev_1', kind: 'filing', title: '年报', verification: 'verified_official' }],
  prior_analysis_refs: [],
  constraints: {},
  input_fingerprint: 'f'.repeat(64),
  created_at: 1,
  expires_at: Date.now() + 86_400_000,
  limitations: [],
}

const anchor = (value, ref = 'ds_1', kind = 'dataset') => ({
  value,
  unit: 'ratio',
  source: { kind, ref },
  precision: 4,
})

function claim(overrides = {}) {
  return {
    claim_id: 'claim_1',
    type: 'observation',
    statement: '毛利率 18.23%，高于去年同期',
    evidence_refs: ['ev_1'],
    number_anchors: [anchor(0.1823), anchor(0.15)],
    confidence: 'medium',
    confidence_basis: '基于年报口径',
    falsifier: '若下季度毛利率跌破 15%',
    limitations: [],
    ...overrides,
  }
}

function artifact(overrides = {}) {
  return {
    analysis_id: SNAPSHOT.analysis_id,
    task_id: SNAPSHOT.task_id,
    snapshot_id: SNAPSHOT.analysis_id,
    status: 'partial',
    evidence_level: 'limited',
    headline: '毛利率 18.23%',
    thesis: '结论：毛利率 18.23%，趋势向上',
    support_claims: [claim()],
    counter_claims: [],
    alternative_explanations: ['行业整体提价'],
    contradictions: [],
    calculations: [],
    scenarios: [],
    invalidation_conditions: ['若 claim_1 的毛利率跌破 15% 则判断失效'],
    unresolved_gaps: [],
    limitations: ['仅覆盖一个报告期'],
    methods_used: [],
    peer_exchanges: [],
    ...overrides,
  }
}

test('模块 registry：hello 与 financial_quality 显式登记，manifest 字段齐全且声明 senior_analyst', () => {
  const modules = listAnalysisModules()
  assert.deepEqual(modules.map((entry) => entry.manifest.id), ['hello', 'financial_quality', 'returns_risk', 'scenario_sensitivity'], 'registry 是静态白名单：新增模块必须改这里')
  for (const entry of modules) {
    // `roles` uses the semantic key, never the preset id.
    assert.equal(entry.manifest.roles.includes('senior_analyst'), true, `${entry.manifest.id} 的 roles 必须是语义键`)
    assert.equal(entry.manifest.entrypoint, 'module.py')
    assert.equal(entry.entrypoint, 'module.py')
    assert.equal(basename(entry.dir), entry.manifest.id, `模块目录必须指向包内的 ${entry.manifest.id}：${entry.dir}`)
    assert.deepEqual(entry.manifest.limits, { ...MODULE_DEFAULT_LIMITS, ...entry.manifest.limits })
  }
  assert.equal(analysisModuleById('nope'), undefined, '未登记的 id 必须返回 undefined，不能扫目录')
})

test('refs：快照与产物的 opaque 引用能往返，非法引用一律 analysis_snapshot_invalid', () => {
  const id = 'analysis_abc123'
  assert.equal(parseSnapshotRef(snapshotRef(id)), id)
  assert.equal(parseArtifactRef(artifactRef(id)), id)
  for (const bad of ['', 'analysis:', 'analysis:../etc', 'analysis:analysis_ABC', null, 42, 'capital-analysis/runs/x']) {
    assert.throws(() => parseSnapshotRef(bad), (error) => error instanceof AnalysisError && error.code === 'analysis_snapshot_invalid')
  }
})

test('stableStringify：键序不影响指纹，undefined 字段不参与', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }))
  assert.equal(stableStringify({ a: 1, b: undefined }), stableStringify({ a: 1 }))
  assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }))
})

test('schema 子集：类型/必填/未声明字段/枚举/上限都拦得住', () => {
  const schema = {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['ok', 'bad'] },
      count: { type: 'integer' },
      items: { type: 'array', maxItems: 2, items: { type: 'string' } },
      nested: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'], additionalProperties: false },
    },
    required: ['status', 'count'],
    additionalProperties: false,
  }
  assert.deepEqual(validateAgainstSchema({ status: 'ok', count: 1 }, schema), [])
  assert.match(validateAgainstSchema({ status: 'nope', count: 1 }, schema).join(), /status/)
  assert.match(validateAgainstSchema({ status: 'ok' }, schema).join(), /count/)
  assert.match(validateAgainstSchema({ status: 'ok', count: 1, extra: true }, schema).join(), /未声明/)
  assert.match(validateAgainstSchema({ status: 'ok', count: 1.5 }, schema).join(), /integer/)
  assert.match(validateAgainstSchema({ status: 'ok', count: 1, items: ['a', 'b', 'c'] }, schema).join(), /条目过多/)
  assert.match(validateAgainstSchema({ status: 'ok', count: 1, nested: { x: 1, y: 2 } }, schema).join(), /未声明/)
})

test('无损 JSON：NaN / Infinity / undefined / 数组空洞都被点名', () => {
  assert.deepEqual(losslessIssues({ a: 1, b: 'x' }), [])
  assert.match(losslessIssues({ a: Number.NaN }).join(), /非有限数/)
  assert.match(losslessIssues({ a: Number.POSITIVE_INFINITY }).join(), /非有限数/)
  assert.match(losslessIssues({ a: undefined }).join(), /undefined/)
  const holey = []
  holey[1] = 2
  assert.match(losslessIssues(holey).join(), /数组空洞/)
})

test('模块结果：缺 status / 多一个未声明字段 / NaN 都判为无效', () => {
  const manifest = {
    id: 'm',
    output_schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        summary: { type: 'string' },
        limitations: { type: 'array' },
        data_gaps: { type: 'array' },
        metrics: { type: 'object' },
        assumptions: { type: 'array' },
        methodology_log: { type: 'array' },
      },
      additionalProperties: false,
    },
  }
  const base = { status: 'completed', summary: 's', limitations: [], data_gaps: [], assumptions: ['假设'], methodology_log: ['步骤'] }
  const ok = validateModuleResult(base, manifest)
  assert.equal(ok.ok, true)
  const extra = validateModuleResult({ ...base, extra: 1 }, manifest)
  assert.equal(extra.ok, false)
  assert.match(extra.issues.map((issue) => issue.detail).join(), /未声明/)
  const nan = validateModuleResult({ ...base, metrics: { x: Number.NaN } }, manifest)
  assert.equal(nan.ok, false)
  // §12.2: a result with no assumptions or method log is not reproducible and cannot be audited.
  assert.equal(validateModuleResult({ ...base, assumptions: [] }, manifest).ok, false)
  assert.equal(validateModuleResult({ ...base, methodology_log: [] }, manifest).ok, false)
})

test('数字溯源：比率与百分比互认，年份与「第 N 条」豁免，无锚点数字被拒', () => {
  const tokens = numberTokens('毛利率 18.23%，2025 年数据，第 3 条说明')
  assert.deepEqual(tokens.map((token) => token.text), ['18.23', '2025', '3'])
  assert.equal(tokens[0].percent, true)

  const clean = validateArtifact(artifact(), SNAPSHOT)
  assert.deepEqual(clean.tier1, [], `干净产物不该有硬拒项：${JSON.stringify(clean.tier1)}`)

  const unsourced = validateArtifact(artifact({ thesis: '营收 42.7 亿，毛利率 18.23%' }), SNAPSHOT)
  assert.equal(unsourced.tier1.some((issue) => issue.code === 'number_without_anchor'), true)
  assert.match(unsourced.tier1.map((issue) => issue.detail).join(), /42\.7/)
})

test('Tier 1：缺失效条件、引用不存在的证据、evidence_level 与 status 冲突都拒', () => {
  const noInvalidation = validateArtifact(artifact({ invalidation_conditions: [] }), SNAPSHOT)
  assert.equal(noInvalidation.tier1.some((issue) => issue.code === 'invalidation_missing'), true)

  const badRef = validateArtifact(artifact({ support_claims: [claim({ evidence_refs: ['ev_missing'] })] }), SNAPSHOT)
  assert.equal(badRef.tier1.some((issue) => issue.code === 'evidence_ref_missing'), true)

  const conflict = validateArtifact(artifact({ status: 'completed', evidence_level: 'insufficient' }), SNAPSHOT)
  assert.equal(conflict.tier1.some((issue) => issue.code === 'evidence_level_conflict'), true)

  const badAnchor = validateArtifact(artifact({ support_claims: [claim({ number_anchors: [anchor(0.1823, 'ds_missing')] })] }), SNAPSHOT)
  assert.equal(badAnchor.tier1.some((issue) => issue.code === 'anchor_ref_missing'), true)
})

test('Tier 2：confidence 缺依据、limitations 为空、peer 未回执、情景缺假设都降级', () => {
  const weak = validateArtifact(artifact({
    support_claims: [claim({ confidence_basis: '' })],
    limitations: [],
    scenarios: [{ name: '乐观' }],
    peer_exchanges: [{ peer: 'data-junior', type: 'analysis_calculation_request', request_id: 'r1', answered: false }],
  }), SNAPSHOT)
  const codes = weak.tier2.map((issue) => issue.code)
  for (const code of ['confidence_basis_missing', 'limitations_empty', 'scenario_assumptions_missing', 'peer_unanswered']) {
    assert.ok(codes.includes(code), `缺少 Tier 2 项 ${code}：${codes.join(', ')}`)
  }
  assert.deepEqual(weak.tier1, [])
})

test('completed + peer 未回执属于硬拒（直连收尾的确定性判据）', () => {
  const result = validateArtifact(artifact({
    status: 'completed',
    evidence_level: 'sufficient',
    peer_exchanges: [{ peer: 'data-junior', type: 'analysis_calculation_request', request_id: 'r1', answered: false }],
  }), SNAPSHOT)
  assert.equal(result.tier1.some((issue) => issue.code === 'peer_unanswered_completed'), true)
})
