import { test } from 'node:test'
import assert from 'node:assert/strict'

import { analysisModuleById } from '../lib/analysis/registry.js'
import { losslessIssues, numberTokens, validateArtifact, validateModuleResult } from '../lib/analysis/validation.js'

/**
 * Unit tests for the two host-side gates of the artifact contract
 * (`docs/dev/senior-analysis.md` §1.9): the module result must be lossless and match its schema,
 * and the submitted artifact must be traceable — three tiers, only Tier 1 rejects.
 */
const SNAPSHOT = {
  dataset_refs: [{ dataset_id: 'ds_income' }, { dataset_id: 'ds_balance' }],
  profile_refs: [{ profile_id: 'p_1' }],
  evidence: [{ source_id: 'ev_1' }],
}

const ANCHOR = { value: 0.18, unit: 'ratio', source: { kind: 'dataset', ref: 'ds_income' } }

function claim(overrides = {}) {
  return {
    claim_id: 'claim_1',
    type: 'observation',
    statement: '毛利率 18%',
    evidence_refs: [],
    number_anchors: [ANCHOR],
    confidence: 'medium',
    confidence_basis: '由报表数值直接计算',
    ...overrides,
  }
}

function artifact(overrides = {}) {
  return {
    analysis_id: 'analysis_test01',
    task_id: 'task_1',
    snapshot_id: 'analysis_test01',
    status: 'completed',
    evidence_level: 'limited',
    headline: '',
    thesis: '',
    support_claims: [claim()],
    counter_claims: [],
    alternative_explanations: ['收入确认时点变化也能解释毛利率抬升'],
    contradictions: [],
    calculations: [],
    scenarios: [],
    invalidation_conditions: ['若下一期毛利率回落至本期以下，claim_1 不再成立'],
    unresolved_gaps: [],
    limitations: ['只有两期报表，未做同业对比'],
    methods_used: [{ module_id: 'financial_quality', module_version: '1.0.0' }],
    peer_exchanges: [],
    ...overrides,
  }
}

const codes = (issues) => issues.map((issue) => issue.code)
const fields = (issues) => issues.map((issue) => issue.field)

// ── Tier 1: hard reject ───────────────────────────────────────────────────────────────────────

test('Tier 1：结论字段里的数字没有锚点 → number_without_anchor，且点名是哪一段', () => {
  const result = validateArtifact(artifact({ headline: '毛利率 31.4%，明显低于同行' }), SNAPSHOT)
  assert.deepEqual(codes(result.tier1), ['number_without_anchor'])
  assert.equal(result.tier1[0].field, 'headline')
  assert.match(result.tier1[0].detail, /31\.4/u)
})

test('Tier 1：锚点能按精度、百分比互写与计算值三种方式命中', () => {
  const anchored = validateArtifact(artifact({
    headline: '毛利率 18.00%',
    thesis: '毛利率 0.18，现金转换 1.50 倍',
    support_claims: [claim({
      statement: '毛利率 18%',
      number_anchors: [ANCHOR, { value: 1.5, unit: 'ratio', source: { kind: 'computation', ref: 'calc_1' } }],
    })],
    calculations: [{ calculation_id: 'calc_1', module_id: 'financial_quality', module_version: '1.0.0', metric: 'cash_conversion', value: 1.5, unit: 'ratio' }],
  }), SNAPSHOT)
  assert.deepEqual(resultCodes(anchored), [], '锚点、百分比互写与计算值都应被接受')

  // 0.181 vs anchor 0.18 at the default precision (4) is outside tolerance.
  const off = validateArtifact(artifact({ headline: '毛利率 18.10%' }), SNAPSHOT)
  assert.deepEqual(codes(off.tier1), ['number_without_anchor'])
})

function resultCodes(validation) {
  return [...codes(validation.tier1), ...codes(validation.tier2)]
}

test('锚点放宽：显示精度四舍五入、证券代码、结构性计数都算命中，真正的无锚点数字仍拒', () => {
  const relaxed = validateArtifact(artifact({
    headline: '毛利率 18.2%，现金转换 1.23 倍',
    thesis: 'ROE 4.44%，整数百分比 18% 也落在同一锚点上',
    support_claims: [claim({
      statement: '毛利率 18.23%，现金转换 1.2345 倍',
      number_anchors: [
        { value: 0.1823, unit: 'ratio', source: { kind: 'dataset', ref: 'ds_income' }, precision: 4 },
        { value: 1.2345, unit: 'ratio', source: { kind: 'computation', ref: 'calc_1' }, precision: 4 },
        { value: 0.044444, unit: 'ratio', source: { kind: 'dataset', ref: 'ds_balance' }, precision: 4 },
      ],
    })],
    calculations: [{ calculation_id: 'calc_1', module_id: 'financial_quality', module_version: '1.0.0', metric: 'cash_conversion', value: 1.2345, unit: 'ratio' }],
  }), SNAPSHOT)
  assert.deepEqual(codes(relaxed.tier1), [], '按写出的小数位四舍五入、或整数百分比，都应命中')

  const identifiers = validateArtifact(artifact({
    headline: '证券 600519、000858 的毛利率 18%',
    support_claims: [claim({ statement: '3 个情景下 0 次回购，5 条待验证结论' })],
  }), SNAPSHOT)
  assert.deepEqual(codes(identifiers.tier1), [], '六位证券代码与结构性计数不是被测量的量')

  const strict = validateArtifact(artifact({ headline: '毛利率 18.7%，营收 12.345 亿元' }), SNAPSHOT)
  assert.deepEqual(codes(strict.tier1), ['number_without_anchor'])
  assert.match(strict.tier1[0].detail, /18\.7/u)

  // 同一字段里同一个未命中数字只报一次，避免错误信息被重复值淹没。
  const repeated = validateArtifact(artifact({ headline: '未知数字 12.345、12.345' }), SNAPSHOT)
  assert.deepEqual(codes(repeated.tier1), ['number_without_anchor'])
  assert.match(repeated.tier1[0].detail, /：12\.345$/u)
})

test('数字 token：千分位是一个数字；指数简称里的 300 不算量', () => {
  // 2026-11-25 真实会话：senior 把 30,000,515,859.60 写成千分位，旧 tokenizer 拆成
  // 30/000/515/859.60 五个 token，逐条报"没有来源锚点"，产物被拒两次。
  const grouped = validateArtifact(artifact({
    headline: '分红合计 30,000,515,859.60 元',
    support_claims: [claim({
      statement: '分红合计 30000515859.60 元',
      number_anchors: [{ value: 30000515859.6, unit: 'CNY', source: { kind: 'dataset', ref: 'ds_income' }, precision: 2 }],
    })],
  }), SNAPSHOT)
  assert.deepEqual(codes(grouped.tier1), [], '千分位与无分隔写法必须命中同一个锚点')

  const indexName = validateArtifact(artifact({
    headline: '沪深300 指数 beta 0.97（基准 000300.SH）',
    support_claims: [claim({
      statement: '沪深300 指数 beta 0.9703',
      number_anchors: [{ value: 0.9703, unit: 'ratio', source: { kind: 'dataset', ref: 'ds_income' }, precision: 4 }],
    })],
  }), SNAPSHOT)
  assert.deepEqual(codes(indexName.tier1), [], '指数简称里的数字是专名，不是待溯源的量')
})

test('数字豁免集：年份、第 N 期、单位常数与标识符里的数字不算结论数字', () => {
  const result = validateArtifact(artifact({
    thesis: '2025 年第二期毛利率与 FY2024 同期相比变化 100000000 以内（口径见 claim_1）',
    support_claims: [claim({ statement: '2025 年第二期毛利率 18%' })],
  }), SNAPSHOT)
  assert.deepEqual(codes(result.tier1), [], '年份 / 期数 / 单位常数 / 标识符数字不该被当成需要溯源的量')
})

test('Tier 1：缺失效条件、证据引用不存在、锚点引用不存在都被拒', () => {
  assert.deepEqual(codes(validateArtifact(artifact({ invalidation_conditions: [] }), SNAPSHOT).tier1), ['invalidation_missing'])

  const missingEvidence = validateArtifact(artifact({
    support_claims: [claim({ evidence_refs: ['ev_missing'] })],
  }), SNAPSHOT)
  assert.deepEqual(codes(missingEvidence.tier1), ['evidence_ref_missing'])

  const missingAnchor = validateArtifact(artifact({
    support_claims: [claim({ number_anchors: [{ value: 0.18, unit: 'ratio', source: { kind: 'dataset', ref: 'ds_unknown' } }] })],
  }), SNAPSHOT)
  assert.deepEqual(codes(missingAnchor.tier1), ['anchor_ref_missing'])

  const calcAnchor = validateArtifact(artifact({
    support_claims: [claim({
      number_anchors: [ANCHOR, { value: 1.5, unit: 'ratio', source: { kind: 'computation', ref: 'calc_1' } }],
    })],
    calculations: [{ calculation_id: 'calc_1', module_id: 'financial_quality', module_version: '1.0.0', metric: 'cash_conversion', value: 1.5, unit: 'ratio' }],
  }), SNAPSHOT)
  assert.deepEqual(codes(calcAnchor.tier1), [], 'computation 锚点必须能在本次 calculations 里找到')
})

test('Tier 1：证据充分度与状态冲突、completed 缺 limitations、未回执 peer 写 completed 都被拒', () => {
  assert.deepEqual(codes(validateArtifact(artifact({ evidence_level: 'insufficient' }), SNAPSHOT).tier1), ['evidence_level_conflict'])

  const noLimitations = artifact({ limitations: undefined })
  assert.deepEqual(codes(validateArtifact(noLimitations, SNAPSHOT).tier1), ['limitations_missing'])

  const unanswered = artifact({ peer_exchanges: [{ peer: 'data-junior', type: 'recalc', request_id: 'peer_1', answered: false }] })
  assert.deepEqual(codes(validateArtifact(unanswered, SNAPSHOT).tier1), ['peer_unanswered_completed'])
})

test('Tier 1：超长结论字段与超多条论据按体积拒', () => {
  const longHeadline = validateArtifact(artifact({ headline: '毛'.repeat(301) }), SNAPSHOT)
  assert.deepEqual(codes(longHeadline.tier1), ['analysis_result_too_large'])
  assert.equal(longHeadline.tier1[0].field, 'headline')

  // 每侧 20 条与场景 8 条是代码检查（工具 schema 里不能写 maxItems：宿主的 JSON Schema 子集没有它）。
  const manyClaims = validateArtifact(artifact({
    support_claims: Array.from({ length: 21 }, (_item, index) => claim({ claim_id: `claim_${index}` })),
    counter_claims: Array.from({ length: 20 }, (_item, index) => claim({ claim_id: `counter_${index}` })),
  }), SNAPSHOT)
  assert.ok(manyClaims.tier1.every((issue) => issue.code === 'analysis_result_too_large'))
  assert.ok(manyClaims.tier1.some((issue) => issue.field === 'support_claims' && /超过 20 条上限/u.test(issue.detail)))
  const manyScenarios = validateArtifact(artifact({
    scenarios: Array.from({ length: 9 }, (_item, index) => ({ name: `s${index}`, assumptions: ['假设'] })),
  }), SNAPSHOT)
  assert.ok(manyScenarios.tier1.some((issue) => issue.field === 'scenarios' && /超过 8 条上限/u.test(issue.detail)))
})

test('Tier 1：peer 往返超过 3 次预算按 §5.6-2 硬拒，3 次以内放行', () => {
  const exchange = (index) => ({
    peer: 'data-junior', type: 'analysis_calculation_request', request_id: `peer_${index}`, answered: true,
  })
  const within = validateArtifact(artifact({ peer_exchanges: [1, 2, 3].map(exchange) }), SNAPSHOT)
  assert.deepEqual(codes(within.tier1), [], '3 次往返是预算上限，不是违规')
  const over = validateArtifact(artifact({ peer_exchanges: [1, 2, 3, 4].map(exchange) }), SNAPSHOT)
  assert.deepEqual(codes(over.tier1), ['peer_budget_exhausted'])
  assert.match(over.tier1[0].detail, /4 条.*超过 3 次预算/u)
})

// ── Tier 2: warning, lands but downgrades ────────────────────────────────────────────────────

test('Tier 2：缺 confidence 依据、limitations 为空、计算无锚点、未回执 peer、情景缺假设都只警告', () => {
  const missingBasis = validateArtifact(artifact({ support_claims: [claim({ confidence_basis: '' })] }), SNAPSHOT)
  assert.deepEqual(codes(missingBasis.tier1), [])
  assert.ok(codes(missingBasis.tier2).includes('confidence_basis_missing'))

  const emptyLimitations = validateArtifact(artifact({ limitations: [] }), SNAPSHOT)
  assert.deepEqual(codes(emptyLimitations.tier1), [])
  assert.ok(codes(emptyLimitations.tier2).includes('limitations_empty'))

  const calculation = validateArtifact(artifact({
    support_claims: [claim({ statement: '毛利率 18%' })],
    calculations: [{ calculation_id: 'calc_2', module_id: 'financial_quality', module_version: '1.0.0', metric: 'fcf_margin', value: 0.06, unit: 'ratio' }],
  }), SNAPSHOT)
  assert.deepEqual(codes(calculation.tier1), [])
  assert.ok(codes(calculation.tier2).includes('calculation_without_anchor'))

  const peer = validateArtifact(artifact({
    status: 'partial',
    peer_exchanges: [{ peer: 'data-junior', type: 'recalc', request_id: 'peer_1', answered: false }],
  }), SNAPSHOT)
  assert.ok(codes(peer.tier2).includes('peer_unanswered'), '未回执的 peer 请求最多 partial')

  const scenario = validateArtifact(artifact({ scenarios: [{ name: '悲观', assumptions: [] }] }), SNAPSHOT)
  assert.ok(codes(scenario.tier2).includes('scenario_assumptions_missing'))
})

test('Tier 2：失效条件不引用 claim / calculation 时只警告，不拒', () => {
  const result = validateArtifact(artifact({ invalidation_conditions: ['若毛利率回落则失效'] }), SNAPSHOT)
  assert.deepEqual(codes(result.tier1), [])
  assert.ok(codes(result.tier2).includes('invalidation_unreferenced'))
})

// ── Tier 3: notice only ──────────────────────────────────────────────────────────────────────

test('Tier 3：没有替代解释只记提示，不影响状态', () => {
  const result = validateArtifact(artifact({ alternative_explanations: [] }), SNAPSHOT)
  assert.deepEqual(codes(result.tier1), [])
  assert.deepEqual(codes(result.tier2), [])
  assert.deepEqual(codes(result.tier3), ['no_alternative_explanation'])
})

// ── module result gate ───────────────────────────────────────────────────────────────────────

test('模块结果：未知字段、NaN、空假设与空方法日志都被拒', () => {
  const manifest = analysisModuleById('financial_quality').manifest
  const valid = {
    status: 'completed',
    summary: 'ok',
    metrics: { gross_margin: 0.18 },
    claims: [],
    assumptions: ['假设'],
    methodology_log: ['步骤'],
    sensitivity: {},
    limitations: ['限制'],
    data_gaps: [],
    outputs: [],
  }
  assert.equal(validateModuleResult(valid, manifest).ok, true)

  assert.deepEqual(
    validateModuleResult({ ...valid, extra: 1 }, manifest).issues.map((issue) => issue.code),
    ['analysis_output_invalid'],
    '未声明的字段同样致命（output.schema 是 additionalProperties: false）',
  )
  assert.equal(validateModuleResult({ ...valid, metrics: { bad: Number.NaN } }, manifest).ok, false)
  assert.equal(validateModuleResult({ ...valid, assumptions: [] }, manifest).ok, false)
  assert.equal(validateModuleResult({ ...valid, methodology_log: [''] }, manifest).ok, false)
  assert.equal(validateModuleResult({ ...valid, summary: undefined }, manifest).ok, false)
})

test('无损 JSON：undefined / NaN / 数组空洞都被点名', () => {
  assert.deepEqual(losslessIssues({ a: undefined }), ['$.a 是 undefined'])
  assert.deepEqual(losslessIssues({ a: Number.POSITIVE_INFINITY }), ['$.a 是 Infinity（非有限数）'])
  const holey = []
  holey[1] = 1
  assert.match(losslessIssues(holey)[0], /数组空洞/u)
  assert.deepEqual(losslessIssues({ a: [1, 'x', null] }), [])
})

test('数字 token 提取：百分号与普通数字分开，避免把比率当成年份', () => {
  const tokens = numberTokens('毛利率 18.2%，2025 年')
  assert.deepEqual(tokens.map((token) => [token.value, token.percent]), [[18.2, true], [2025, false]])
})
