import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { registerAnalysisTools } from '../lib/analysis/tools.js'
import { ARTIFACT_MAX_CHARS } from '../lib/analysis/schemas.js'
import { DatasetStoreError } from '../lib/data-collector/store.js'
import { ANALYSIS_PRESET_IDS, ROLE_PRESET_IDS } from '../lib/preset-ids.js'
import { PythonRuntimeManager } from '../lib/python-runtime/manager.js'
import { readManifest } from '../lib/python-runtime/manifest.js'
import { detectPlatform } from '../lib/python-runtime/platform.js'
import { resolveDshHome } from '../lib/python-runtime/paths.js'

/** Minimal tool runtime: capture the definitions so each execute can be called directly. */
function harness({ claim } = {}) {
  const definitions = new Map()
  const ctx = {
    get(name) {
      if (name === 'tools') {
        return {
          register(definition) {
            definitions.set(definition.name, definition)
            return () => {}
          },
        }
      }
      if (name === 'agentPresets' && claim !== undefined) {
        return { composedPreset: () => claim }
      }
      return undefined
    },
    effect(callback) {
      const dispose = callback()
      return () => { if (typeof dispose === 'function') dispose() }
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  }
  const store = {
    async writeWorkspaceFiles() { throw new Error('unused') },
    async readWorkspaceJson() { throw new Error('unused') },
    async readPresentationRows() { throw new Error('unused') },
    async readProfile() { throw new Error('unused') },
  }
  registerAnalysisTools({ ctx, store })
  return { definitions }
}

const execFor = (header = {}) => ({
  agent: { session: { id: 'session-analysis-tools', header: { cwd: '/workspace', ...header } } },
  signal: new AbortController().signal,
})

const TOOL_NAMES = [
  'create_analysis_snapshot', 'read_profile', 'list_analysis_modules',
  'describe_analysis_module', 'run_analysis', 'submit_analysis',
]

test('分析族注册六颗工具，参数根都是 object（供应商契约）', () => {
  const { definitions } = harness()
  assert.deepEqual([...definitions.keys()].sort(), [...TOOL_NAMES].sort())
  for (const [name, definition] of definitions) {
    assert.equal(definition.parameters.type, 'object', `${name} 的 parameters 根必须是 object`)
    assert.ok(definition.output?.schema?.type === 'object', `${name} 的 output.schema 根必须是 object`)
    assert.equal(typeof definition.execute, 'function')
  }
})

test('工具 schema 只用宿主支持的 JSON Schema 子集：anyOf / maxItems 会让整族行在 boot 期失效', () => {
  // dsh-tools enforces type / oneOf / properties / required / additionalProperties / items / enum /
  // const + annotations. A definition outside it makes the family row unsupported, which silently
  // leaves the role preset broken (2026-11-24: enabling the senior preset surfaced exactly this).
  const ALLOWED = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items',
    'enum', 'const', 'description', 'title', 'default', 'examples'])
  const violations = []
  const walk = (node, path) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    for (const [key, value] of Object.entries(node)) {
      if (!ALLOWED.has(key)) {
        violations.push(`${path}.${key}`)
        continue
      }
      if (key === 'properties') {
        for (const [name, child] of Object.entries(value)) walk(child, `${path}.properties.${name}`)
      } else if (key === 'items' || key === 'oneOf') {
        walk(value, `${path}.${key}`)
      }
    }
  }
  const { definitions } = harness()
  for (const [name, definition] of definitions) {
    walk(definition.parameters, `${name}.parameters`)
    walk(definition.output.schema, `${name}.output`)
  }
  assert.deepEqual(violations, [], `以下 schema 关键字不在宿主子集内（注册期会被拒）：${violations.join(', ')}`)
})

test('授权走 tool-exec 的唯一判据：非分析角色被拒，分析角色放行', async () => {
  // No preset registry + no parentSession = identity unconfirmed: the legacy fallback stays closed.
  const { definitions } = harness()
  await assert.rejects(
    () => definitions.get('list_analysis_modules').execute({}, execFor()),
    (error) => error instanceof DatasetStoreError && error.code === 'dataset_session_mismatch',
  )

  // Confirmed analyst preset: the gate lets it through (the call then fails on its own inputs).
  const analyst = harness({ claim: ROLE_PRESET_IDS.analyst })
  await assert.rejects(
    () => analyst.definitions.get('run_analysis').execute({ analysis_snapshot_ref: 'analysis:nope', module_id: 'hello' }, execFor()),
    (error) => !(error instanceof DatasetStoreError && error.code === 'dataset_session_mismatch'),
    '分析角色不应被授权闸门挡住',
  )

  // A different role preset is denied by the same gate, with the allowed set named.
  const junior = harness({ claim: ROLE_PRESET_IDS.junior })
  await assert.rejects(
    () => junior.definitions.get('list_analysis_modules').execute({}, execFor()),
    (error) => error instanceof DatasetStoreError && error.code === 'dataset_session_mismatch',
  )
})

test('授权集合只含 senior 的 preset id，且它不再出现在 Dataset 读面', async () => {
  const { DATASET_READING_PRESET_IDS } = await import('../lib/preset-ids.js')
  assert.deepEqual([...ANALYSIS_PRESET_IDS], [ROLE_PRESET_IDS.analyst])
  assert.equal(DATASET_READING_PRESET_IDS.includes(ROLE_PRESET_IDS.analyst), false, 'senior 不读原始 rows')
})

// ── 全链路：snapshot → run → submit → artifact 落盘 ───────────────────────────────────────────

const FIXTURES = fileURLToPath(new URL('../python/analysis/modules/financial_quality/fixtures/normal/datasets', import.meta.url))
const SESSION_ID = 'session-analysis-chain'
const EXEC = { agent: { session: { id: SESSION_ID, header: { cwd: '/workspace' } } }, signal: new AbortController().signal }

function diskStore(root) {
  const absolute = (rel) => join(root, rel)
  return {
    async writeWorkspaceFiles({ dir, files }) {
      await mkdir(absolute(dir), { recursive: true })
      const written = []
      for (const file of files) {
        const path = absolute(`${dir}/${file.name}`)
        await mkdir(join(path, '..'), { recursive: true })
        await writeFile(path, file.content, 'utf8')
        written.push({ name: file.name, path: `${dir}/${file.name}`, absolutePath: path })
      }
      return written
    },
    async readWorkspaceJson({ path }) {
      try {
        return JSON.parse(await readFile(absolute(path), 'utf8'))
      } catch {
        throw new DatasetStoreError('dataset_not_found', `${path} was not found`)
      }
    },
    async readPresentationRows({ dataset_id }) {
      const raw = JSON.parse(await readFile(join(FIXTURES, `${dataset_id}.json`), 'utf8'))
      return {
        ref: { dataset_id, captured_at: 1_700_000_000_000, params_digest: 'digest', retention_until: Date.now() + 86_400_000, time_coverage: raw.time_coverage },
        rows: raw.rows,
        ...(raw.envelope === undefined ? {} : { envelope: raw.envelope }),
      }
    },
    async readProfile() { throw new Error('unused') },
  }
}

/** Tool harness with a real store and a real private interpreter: the chain must be end to end. */
function chainHarness(root) {
  const definitions = new Map()
  const manager = new PythonRuntimeManager({
    manifest: readManifest(fileURLToPath(new URL('../runtime/manifest.json', import.meta.url))),
    dshHome: resolveDshHome(),
    workerPath: fileURLToPath(new URL('../python/worker.py', import.meta.url)),
    target: detectPlatform(),
  })
  const ctx = {
    get(name) {
      if (name === 'tools') return { register(definition) { definitions.set(definition.name, definition); return () => {} } }
      if (name === 'agentPresets') return { composedPreset: () => ROLE_PRESET_IDS.analyst }
      if (name === 'pythonRuntime') return manager
      return undefined
    },
    effect(callback) { const dispose = callback(); return () => { if (typeof dispose === 'function') dispose() } },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  }
  const store = diskStore(root)
  registerAnalysisTools({ ctx, store })
  return { definitions, execute: (name, args) => definitions.get(name).execute(args, EXEC) }
}

const CALL = {
  task_id: 'task_chain',
  question: '这家公司的财务质量如何',
  purpose: 'research',
  depth: 'standard',
  as_of: '2025-06-30',
  dataset_refs: [{ dataset_id: 'ds_income' }, { dataset_id: 'ds_balance' }, { dataset_id: 'ds_cashflow' }],
  evidence: [{ source_id: 'ev_annual_report', kind: 'filing', title: '2024 年年度报告', verification: 'verified_official' }],
}

function artifactFrom(snapshot) {
  return {
    analysis_id: snapshot.analysis_id,
    task_id: CALL.task_id,
    snapshot_id: snapshot.analysis_id,
    status: 'completed',
    evidence_level: 'limited',
    headline: '毛利率 18%、ROE 4.4444%、现金转换 1.5 倍',
    thesis: '收入增长带动利润，现金转换说明利润有现金支撑；但净资产回报偏低，需要看下一期趋势。',
    support_claims: [{
      claim_id: 'claim_fq_quality',
      type: 'observation',
      statement: '毛利率 18.00%，较上期提升',
      evidence_refs: [],
      number_anchors: [
        { value: 0.18, unit: 'ratio', period: '2024-4', source: { kind: 'dataset', ref: 'ds_income' }, precision: 6 },
        { value: 0.044444, unit: 'ratio', period: '2024-4', source: { kind: 'dataset', ref: 'ds_balance' }, precision: 6 },
        { value: 1.5, unit: 'ratio', period: '2024-4', source: { kind: 'dataset', ref: 'ds_cashflow' }, precision: 6 },
      ],
      confidence: 'medium',
      confidence_basis: '由三张报表直接计算，并经宿主复算',
    }],
    counter_claims: [{
      claim_id: 'claim_fq_caveat',
      type: 'observation',
      statement: '现金转换 1.5 倍中含营运资本变动，需核对',
      evidence_refs: [],
      number_anchors: [{ value: 1.5, unit: 'ratio', period: '2024-4', source: { kind: 'dataset', ref: 'ds_cashflow' }, precision: 6 }],
      confidence: 'low',
      confidence_basis: '只看到报表口径，未拆营运资本明细',
    }],
    alternative_explanations: ['收入确认时点变化也可能抬高毛利率'],
    contradictions: [],
    calculations: [{ calculation_id: 'calc_fq_roe', module_id: 'financial_quality', module_version: '1.0.0', metric: 'roe', value: 0.044444, unit: 'ratio' }],
    scenarios: [],
    invalidation_conditions: ['若下一期毛利率回落至本期以下且现金转换低于一倍，claim_fq_quality 与 calc_fq_roe 不再成立'],
    unresolved_gaps: [],
    limitations: ['只有两期报表，未做行业对比'],
    methods_used: [{ module_id: 'financial_quality', module_version: '1.0.0' }],
    peer_exchanges: [],
  }
}

test('全链路：建快照 → 跑模块 → 提交产物，artifact 与 run 两件套都落盘', async (t) => {
  let ready = false
  try {
    ready = (await chainHarness(await mkdtemp(join(tmpdir(), 'cg-chain-probe-'))).definitions.size > 0
      && (await new PythonRuntimeManager({
        manifest: readManifest(fileURLToPath(new URL('../runtime/manifest.json', import.meta.url))),
        dshHome: resolveDshHome(),
        workerPath: fileURLToPath(new URL('../python/worker.py', import.meta.url)),
        target: detectPlatform(),
      }).status()).base?.state === 'ready')
  } catch { ready = false }
  if (!ready) return t.skip('私有 Python runtime 未准备')

  const root = await mkdtemp(join(tmpdir(), 'cg-chain-'))
  const { execute } = chainHarness(root)

  const listed = await execute('list_analysis_modules', {})
  assert.deepEqual(listed.modules.map((item) => item.id), ['hello', 'financial_quality'])
  const described = await execute('describe_analysis_module', { module_id: 'financial_quality' })
  assert.equal(described.version, '1.0.0')
  assert.ok(described.input_schema.properties.period, 'describe 必须给出真实输入契约')

  const snapshot = await execute('create_analysis_snapshot', CALL)
  assert.match(snapshot.analysis_snapshot_ref, /^analysis:analysis_/u)
  assert.equal(snapshot.coverage.datasets.length, 3)
  assert.equal(snapshot.coverage.evidence, 1)

  const run = await execute('run_analysis', { analysis_snapshot_ref: snapshot.analysis_snapshot_ref, module_id: 'financial_quality', params: {} })
  assert.equal(run.status, 'completed')
  assert.equal(run.metrics.gross_margin, 0.18)
  assert.equal(run.reused, false)

  const submitted = await execute('submit_analysis', artifactFrom(snapshot))
  assert.equal(submitted.status, 'accepted')
  assert.equal(submitted.validation.status, 'pass')

  const dir = join(root, 'capital-analysis', 'runs', snapshot.analysis_id)
  const persisted = JSON.parse(await readFile(join(dir, 'artifact.json'), 'utf8'))
  assert.equal(persisted.status, 'completed')
  assert.equal(persisted.validation.status, 'pass')
  assert.ok(existsSync(join(dir, 'snapshot.json')), '审计要能读到快照引用与指纹')
  assert.ok(existsSync(join(dir, 'run.json')), '审计要能读到 run 索引与两层指纹')
  assert.equal(JSON.parse(await readFile(join(dir, 'run.json'), 'utf8')).runs[0].module_id, 'financial_quality')

  // Tier 2 warning: lands, but the artifact may not claim `completed` any more.
  const downgraded = await execute('submit_analysis', artifactFrom(snapshot))
  assert.equal(downgraded.status, 'accepted')
  const warned = await execute('submit_analysis', {
    ...artifactFrom(snapshot),
    support_claims: [{ ...artifactFrom(snapshot).support_claims[0], confidence_basis: '' }],
  })
  assert.equal(warned.validation.status, 'warning')
  const downgradedArtifact = JSON.parse(await readFile(join(dir, 'artifact.json'), 'utf8'))
  assert.equal(downgradedArtifact.status, 'partial', '警告级问题让产物最多 partial')
  assert.equal(downgradedArtifact.validation.status, 'warning')

  // Tier 1: a conclusion number with no anchor is rejected and must not overwrite the last good artifact.
  await assert.rejects(
    () => execute('submit_analysis', { ...artifactFrom(snapshot), headline: '毛利率 31.4%' }),
    (error) => error.code === 'analysis_validation_failed' && /number_without_anchor/u.test(error.message),
  )
  assert.equal(JSON.parse(await readFile(join(dir, 'artifact.json'), 'utf8')).status, 'partial', '被拒的提交不得覆盖已落盘产物')

  // §5.6-2: peer 往返超预算用专用错误码拒（不是笼统的 validation_failed）。
  const peerExchange = (index) => ({
    peer: 'data-junior', type: 'analysis_calculation_request', request_id: `peer_${index}`, answered: true,
  })
  await assert.rejects(
    () => execute('submit_analysis', { ...artifactFrom(snapshot), peer_exchanges: [1, 2, 3, 4].map(peerExchange) }),
    (error) => error.code === 'analysis_peer_budget_exhausted' && /4 条.*超过 3 次预算/u.test(error.message),
  )

  // Artifact schema: an over-long claim list is a schema mismatch, not a silent truncation.
  const tooManyClaims = { ...artifactFrom(snapshot), support_claims: Array.from({ length: 21 }, (_item, index) => ({ ...artifactFrom(snapshot).support_claims[0], claim_id: `claim_${index}` })) }
  await assert.rejects(
    () => execute('submit_analysis', tooManyClaims),
    (error) => error.code === 'analysis_validation_failed' && /超过 20 条上限/u.test(error.message),
  )

  // 体积超限：超过上限即拒，错误里点名是哪一段（上限由 schemas 模块单一维护）。
  const longClaim = (index) => ({
    ...artifactFrom(snapshot).support_claims[0],
    claim_id: `claim_bulk_${index}`,
    statement: '毛'.repeat(600),
    number_anchors: [],
  })
  const oversized = {
    ...artifactFrom(snapshot),
    support_claims: Array.from({ length: 20 }, (_item, index) => longClaim(index)),
    counter_claims: Array.from({ length: 20 }, (_item, index) => longClaim(index)),
  }
  if (JSON.stringify(oversized).length <= ARTIFACT_MAX_CHARS) {
    oversized.unresolved_gaps = ['毛'.repeat(ARTIFACT_MAX_CHARS + 1)]
  }
  await assert.rejects(
    () => execute('submit_analysis', oversized),
    (error) => error.code === 'analysis_result_too_large' && error.message.includes(`超过 ${ARTIFACT_MAX_CHARS}`),
  )
})
