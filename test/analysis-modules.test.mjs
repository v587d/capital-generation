import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { analysisModuleById, listAnalysisModules } from '../lib/analysis/registry.js'
import { analysisRuntimeFrom, resetAnalysisRuntimeState, runModuleOnSnapshot } from '../lib/analysis/runtime.js'
import { createSnapshot } from '../lib/analysis/snapshot.js'
import { AnalysisError } from '../lib/analysis/types.js'
import { DatasetStoreError } from '../lib/data-collector/store.js'
import { PythonRuntimeError } from '../lib/python-runtime/errors.js'
import { PythonRuntimeManager } from '../lib/python-runtime/manager.js'
import { readManifest } from '../lib/python-runtime/manifest.js'
import { detectPlatform } from '../lib/python-runtime/platform.js'
import { resolveDshHome } from '../lib/python-runtime/paths.js'

/**
 * The reviewed module and its fixtures are the Phase 2 sample: one real end-to-end module proving
 * the protocol, the worker, the validation and the audit trail. Goldens are hand-computed from the
 * fixture inputs (see fixtures/README.md), not recorded from module output.
 */
const FIXTURES = fileURLToPath(new URL('../python/analysis/modules/financial_quality/fixtures/', import.meta.url))
const MODULE = 'financial_quality'
const SESSION = { id: 'session-analysis-modules', header: { cwd: '/workspace' } }

const SNAPSHOT_INPUT = {
  task_id: 'task_financial_quality',
  question: '这家公司的财务质量如何：利润率、ROE、现金转换与偿债能力',
  purpose: 'research',
  depth: 'standard',
  as_of: '2025-06-30',
  dataset_refs: [],
  profile_refs: [],
  evidence: [],
  prior_analysis_refs: [],
  constraints: {},
}

function manager() {
  return new PythonRuntimeManager({
    manifest: readManifest(fileURLToPath(new URL('../runtime/manifest.json', import.meta.url))),
    dshHome: resolveDshHome(),
    workerPath: fileURLToPath(new URL('../python/worker.py', import.meta.url)),
    target: detectPlatform(),
  })
}

const runtimeFrom = () => analysisRuntimeFrom({ get: (name) => (name === 'pythonRuntime' ? manager() : undefined) })

async function runtimeReady() {
  try {
    return (await manager().status()).base?.state === 'ready'
  } catch {
    return false
  }
}

/** Store double: fixtures on disk, workspace files under a temp dir, so the interpreter gets real paths. */
function fixtureStore(root, caseDir) {
  const datasets = join(FIXTURES, caseDir, 'datasets')
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
      const raw = JSON.parse(await readFile(join(datasets, `${dataset_id}.json`), 'utf8'))
      // Mirrors the real store: a document Dataset has no rows to stage (docs/dev/data-roles.md §1.5).
      if (raw.kind === 'document') {
        throw new DatasetStoreError('dataset_format_unsupported', 'a document Dataset has no rows to present; profile it instead')
      }
      return {
        ref: {
          dataset_id,
          captured_at: 1_700_000_000_000,
          params_digest: 'digest',
          retention_until: Date.now() + 86_400_000,
          time_coverage: raw.time_coverage,
        },
        rows: raw.rows,
        ...(raw.envelope === undefined ? {} : { envelope: raw.envelope }),
      }
    },
    async readProfile() {
      throw new Error('financial_quality 不读 profile：fixture 不应触发这条路径')
    },
  }
}

async function setup(caseDir, input = {}) {
  const root = await mkdtemp(join(tmpdir(), `cg-${caseDir}-`))
  const store = fixtureStore(root, caseDir)
  const datasetIds = (await readdir(join(FIXTURES, caseDir, 'datasets'))).map((file) => file.replace(/\.json$/u, ''))
  const { record, ref } = await createSnapshot({
    reader: store,
    writer: store,
    session: SESSION,
    input: { ...SNAPSHOT_INPUT, dataset_refs: datasetIds.map((dataset_id) => ({ dataset_id })), ...input },
  })
  return { root, store, record, ref }
}

async function runFixture(caseDir, params) {
  const workspace = await setup(caseDir)
  const outcome = await runModuleOnSnapshot({
    writer: workspace.store,
    runtime: runtimeFrom(),
    session: SESSION,
    snapshot: workspace.record,
    module: analysisModuleById(MODULE),
    params: params ?? JSON.parse(await readFile(join(FIXTURES, caseDir, 'params.json'), 'utf8')),
  })
  return { ...workspace, outcome }
}

async function expectedOf(caseDir) {
  return JSON.parse(await readFile(join(FIXTURES, caseDir, 'expected.json'), 'utf8'))
}

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))

async function moduleRunDir(root, record) {
  const index = await readJson(join(root, record.paths.dir, 'run.json'))
  const latest = index.runs.at(-1)
  return { index, id: latest.module_run_id, dir: join(root, record.paths.dir, 'modules', latest.module_run_id) }
}

// ── manifest / registry contract ───────────────────────────────────────────────────────────────

test('financial_quality 登记在静态 registry，manifest 声明可复算与来源', async () => {
  const ids = listAnalysisModules().map((entry) => entry.manifest.id)
  assert.deepEqual(ids, ['hello', 'financial_quality', 'returns_risk', 'scenario_sensitivity',
    'statement_integrity', 'kline_quality', 'valuation_sensitivity',
    'comps_valuation', 'earnings_bridge',
    'technical_indicators', 'simple_backtest', 'portfolio_stress'], 'registry 是静态白名单，按登记顺序列出')

  const entry = analysisModuleById(MODULE)
  assert.equal(entry.manifest.version, '1.0.0')
  assert.deepEqual([...entry.manifest.roles], ['senior_analyst'])
  assert.deepEqual([...entry.manifest.capabilities], ['dataset.read'], '模块只读 Dataset；不声明未使用的能力')
  assert.equal(entry.manifest.input_schema.additionalProperties, false, '参数未知字段必须被拒')
  assert.ok(entry.manifest.assumptions.length >= 3, 'manifest 必须显式列出假设')
  assert.ok(entry.manifest.applicability.length >= 2, 'manifest 必须写明适用条件')
  assert.equal(entry.manifest.provenance.source_type, 'adapted')
  assert.equal(entry.manifest.provenance.repository, 'GAJETOso/financeskills')
  assert.match(entry.manifest.provenance.commit, /^[a-f0-9]{40}$/u)
  assert.equal(entry.manifest.provenance.license, 'MIT')

  const license = await readFile(join(FIXTURES, '..', 'LICENSE'), 'utf8')
  assert.match(license, /MIT License/u)
  assert.match(license, /KOMVIA/u, 'LICENSE 必须保留上游版权行')
  assert.match(license, /b0c6239/u, 'LICENSE 必须写明所适配的上游 commit')
})

// ── golden cases ───────────────────────────────────────────────────────────────────────────────

test('normal：golden case 逐项对上、缺口为空、审计三件套齐全', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf('normal')
  const { root, store, record, outcome } = await runFixture('normal')

  assert.equal(outcome.status, expected.status)
  assert.deepEqual(outcome.metrics, expected.metrics, '指标必须与手算 golden 完全一致（含 6 位小数舍入）')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.equal(outcome.reused, false)
  assert.match(outcome.summary, /毛利率 18\.00%/u)
  assert.match(outcome.summary, /ROE 4\.44%/u)
  assert.deepEqual([...outcome.assumptions], [...analysisModuleById(MODULE).manifest.assumptions],
    '结果里的假设必须与 manifest 承诺的一致，否则 describe 与 run 会互相矛盾')

  // Audit pair: snapshot.json + run.json + the module run directory.
  assert.ok(existsSync(join(root, record.paths.dir, 'snapshot.json')))
  assert.ok(existsSync(join(root, record.paths.dir, 'inputs', 'datasets', 'ds_income.json')), '宿主授权的输入副本必须已落盘')
  const { index, dir } = await moduleRunDir(root, record)
  assert.equal(index.runs.length, 1)
  assert.equal(index.runs[0].module_id, MODULE)
  assert.equal(index.runs[0].module_version, '1.0.0')
  assert.equal(index.runs[0].status, 'completed')
  assert.match(index.runs[0].run_fingerprint, /^[a-f0-9]{64}$/u)
  assert.match(index.runs[0].params_digest, /^[a-f0-9]{64}$/u)

  const request = await readJson(join(dir, 'request.json'))
  assert.equal(request.protocol, 'capital.analysis/v1')
  assert.deepEqual(request.inputs.datasets.map((item) => item.dataset_id).sort(), ['ds_balance', 'ds_cashflow', 'ds_income'])
  assert.equal(request.as_of, SNAPSHOT_INPUT.as_of)

  const executed = await readJson(join(dir, 'result.json'))
  assert.equal(executed.ok, true)
  assert.match(executed.python, /^3\./u, 'result.json 必须记录真实 Python 版本，供审计复算')
  assert.ok(executed.duration_ms > 0)
  assert.equal(executed.result.status, 'completed')
  assert.ok(executed.result.methodology_log.length >= 3, '方法日志不能为空：缺它就不可复算')

  // outputs/ratios.json is the recomputation trail: every ratio carries its inputs and formula.
  const ratios = await readJson(join(dir, 'outputs', 'ratios.json'))
  assert.equal(ratios.period, expected.period)
  assert.equal(ratios.previous_period, expected.previous_period)
  assert.deepEqual(ratios.statements, { balance: 'ds_balance', cashflow: 'ds_cashflow', income: 'ds_income' })
  assert.equal(ratios.period_key, 'period_end_ms')
  assert.equal(ratios.trend.length, 5)
  const byMetric = Object.fromEntries(ratios.ratios.map((item) => [item.metric, item]))
  for (const metric of ['gross_margin', 'roe', 'interest_coverage', 'cash_conversion', 'debt_ratio']) {
    assert.ok(byMetric[metric] !== undefined, `outputs 必须记录 ${metric} 的输入值`)
    assert.equal(typeof byMetric[metric].formula, 'string')
  }
  const recompute = (metric, fn) => {
    const row = byMetric[metric]
    assert.ok(Math.abs(fn(row.inputs) - row.value) <= 1e-6, `${metric} 必须能用 outputs 里的输入值复算出来`)
  }
  recompute('gross_margin', (i) => (i.operating_income - i.operating_costs) / i.operating_income)
  recompute('roe', (i) => i.net_profit / i.holder_equity_total)
  recompute('interest_coverage', (i) => (i.profit_total + i.interest_expenses) / i.interest_expenses)
  recompute('receivable_days', (i) => (i.accounts_receivable / i.operating_income) * 365)

  // Same snapshot + same params + same module version must reuse the recorded run.
  const again = await runModuleOnSnapshot({
    writer: store,
    runtime: runtimeFrom(),
    session: SESSION,
    snapshot: record,
    module: analysisModuleById(MODULE),
    params: {},
  })
  assert.equal(again.reused, true)
  assert.equal((await readJson(join(root, record.paths.dir, 'run.json'))).runs.length, 1, '复用不得追加 run 记录')
})

test('缺列（a_share_series）：partial + 缺口点名缺的列，其余指标不动', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf('a_share_series')
  const { outcome } = await runFixture('a_share_series')

  assert.equal(outcome.status, 'partial', '有缺口就不能声称 completed')
  assert.deepEqual(outcome.metrics, expected.metrics, '缺列只应拿掉依赖该列的指标，其他指标必须照常算出')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps, '缺口必须点名缺的是哪一列，而不是静默省略')
  assert.equal('current_ratio' in outcome.metrics, false)
  assert.equal('quick_ratio' in outcome.metrics, false)
})

test('边界（boundary）：负净资产与零利息不填默认值，指标跳过并写缺口', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf('boundary')
  const { outcome } = await runFixture('boundary')

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  for (const skipped of ['roe', 'equity_multiplier', 'cash_conversion', 'debt_to_equity', 'interest_coverage']) {
    assert.equal(skipped in outcome.metrics, false, `${skipped} 在分母无经济含义时必须缺席，不能写 0`)
  }
  assert.match(outcome.data_gaps.join('\n'), /期末净资产 ≤ 0/u)
  assert.match(outcome.data_gaps.join('\n'), /利息费用 ≤ 0/u)
})

test('缺整张报表（missing_income）：blocked，不产出 outputs，也不猜指标', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf('missing_income')
  const { root, record, outcome } = await runFixture('missing_income')

  assert.equal(outcome.status, 'blocked')
  assert.deepEqual(outcome.metrics, expected.metrics, '缺利润表时一个指标都不许给')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  const { dir } = await moduleRunDir(root, record)
  assert.equal(existsSync(join(dir, 'outputs')), false, 'blocked 结果不写 outputs：没有东西可复算')
})

test('period 参数选中较早一期：没有更早数据时趋势记缺口', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const { outcome } = await runFixture('normal', { period: '2023-4' })

  assert.equal(outcome.status, 'partial', '2023-4 没有上一期，趋势是缺口')
  assert.equal(outcome.metrics.gross_margin, 0.166667)
  assert.equal(outcome.metrics.roe, 0.038788)
  assert.equal(outcome.metrics.cash_conversion, 1.40625)
  assert.equal('gross_margin_delta' in outcome.metrics, false)
  assert.ok(outcome.data_gaps.some((gap) => gap.includes('没有早于 2023-4 的报告期')), '缺口必须点名缺哪一期')
})

test('真实数据形状（a_share_annual）：period 文本是常量 annual，报告期标签订正日期、period 参数认 fiscal_year', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  // Real fuyao A-share statements put `annual` in every row of the `period` column; the report date
  // lives in `period_end_ms`. Treating the text as the label made every period look identical
  // (2026-11-24 实测：senior 连试 11 个 period 写法全被拒，最后只能放弃指定报告期).
  const expected = await expectedOf('a_share_annual')
  const { outcome } = await runFixture('a_share_annual', { period: '2023' })
  assert.equal(outcome.status, expected.status)
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /2023-12-30/u, '摘要必须用报告期日期，不能写数据源那列常量 annual')
  assert.doesNotMatch(outcome.summary, /^annual /u)

  const byFiscalYear = await runFixture('a_share_annual', { period: '2024-FY' })
  assert.equal(byFiscalYear.outcome.metrics.gross_margin, 0.92, 'fiscal_year + fiscal_period 的写法要能选中报告期')
  const byDate = await runFixture('a_share_annual', { period: '2024-12-30' })
  assert.deepEqual(byDate.outcome.metrics, byFiscalYear.outcome.metrics, '日期写法与 2024-FY 必须指向同一期')

  // The constant text is not a selector: it matches nothing and the error lists real dates.
  const workspace = await setup('a_share_annual')
  await assert.rejects(
    () => runModuleOnSnapshot({
      writer: workspace.store,
      runtime: runtimeFrom(),
      session: SESSION,
      snapshot: workspace.record,
      module: analysisModuleById(MODULE),
      params: { period: 'annual' },
    }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /2024-12-30/u.test(error.message)
      && !/annual、annual/u.test(error.message),
    '常量 period 不当选择键：报错要列真实报告期，不能再列一串 annual',
  )
})

test('运行时缺 base pack：data-runtime-not-ready 映射为 analysis_runtime_not_ready（不降级成 output_invalid）', async () => {
  const { store, record } = await setup('normal')
  await assert.rejects(
    () => runModuleOnSnapshot({
      writer: store,
      runtime: {
        async runAnalysisModule() {
          throw new PythonRuntimeError('data-runtime-not-ready', '分析环境（base pack）尚未安装')
        },
      },
      session: SESSION,
      snapshot: record,
      module: analysisModuleById(MODULE),
      params: {},
    }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_runtime_not_ready'
      && /base pack/u.test(error.message),
  )
})

// ── failure paths ─────────────────────────────────────────────────────────────────────────────

test('文档型 Dataset：建快照时就拒（analysis_input_invalid），不进入执行面', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cg-document-'))
  const store = fixtureStore(root, 'document')
  await assert.rejects(
    () => createSnapshot({
      reader: store,
      writer: store,
      session: SESSION,
      input: { ...SNAPSHOT_INPUT, dataset_refs: [{ dataset_id: 'ds_document' }] },
    }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /ds_document/u.test(error.message)
      && /无法作为分析输入/u.test(error.message),
    'document 当表格用必须响亮失败并点名数据集',
  )
})

async function tempModule(root, name, source) {
  const dir = join(root, `module-${name}`)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'module.py'), `${source.join('\n')}\n`, 'utf8')
  return dir
}

function manifestFor(name, limits = {}) {
  const hello = analysisModuleById('hello').manifest
  // Keep hello's output schema: it is the protocol shape with `additionalProperties: false`, which
  // is what makes an undeclared field a rejection rather than dead weight.
  return {
    ...hello,
    id: name,
    capabilities: ['dataset.read'],
    limits: { ...hello.limits, ...limits },
  }
}

const RESULT_TAIL = [
  '    "claims": [], "assumptions": ["测试模块的假设"], "methodology_log": ["测试步骤"],',
  '    "sensitivity": {}, "limitations": ["测试"], "data_gaps": [], "outputs": []}',
]

async function runTemp(root, store, snapshot, name, source, limits) {
  const dir = await tempModule(root, name, source)
  return await runModuleOnSnapshot({
    writer: store,
    runtime: runtimeFrom(),
    session: SESSION,
    snapshot,
    module: { manifest: manifestFor(name, limits), dir, entrypoint: 'module.py' },
    params: {},
  })
}

test('模块在异常上声明 analysis_input_invalid：宿主映射成同名稳定码，不降级成 output_invalid', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const { root, store, record } = await setup('normal')
  await assert.rejects(
    () => runTemp(root, store, record, 'declared-input', [
      'class AnalysisInputError(Exception):',
      '    analysis_code = "analysis_input_invalid"',
      '',
      'def analyze(request, context):',
      '    raise AnalysisInputError("这份输入不能做表计算")',
    ]),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /这份输入不能做表计算/u.test(error.message),
  )
})

test('模块超时：analysis_timeout，且进程被收敛', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const { root, store, record } = await setup('normal')
  const started = Date.now()
  await assert.rejects(
    () => runTemp(root, store, record, 'sleepy', [
      'import time',
      '',
      'def analyze(request, context):',
      '    time.sleep(10)',
      '    return {"status": "completed", "summary": "never"}',
    ], { timeout_ms: 500 }),
    (error) => error instanceof AnalysisError && error.code === 'analysis_timeout',
  )
  assert.ok(Date.now() - started < 15_000, '超时必须按 timeout_ms 收敛，不能让测试等满 sleep 时长')
})

test('输出体积超限与 schema 不符：都被宿主拒绝为 analysis_output_invalid', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const { root, store, record } = await setup('normal')

  await assert.rejects(
    () => runTemp(root, store, record, 'huge-output', [
      'def analyze(request, context):',
      '    context.write_output("big", {"blob": "x" * 4096})',
      '    return {"status": "completed", "summary": "x",',
      ...RESULT_TAIL,
    ], { max_output_bytes: 1024 }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_output_invalid'
      && /max_output_bytes/u.test(error.message),
  )

  await assert.rejects(
    () => runTemp(root, store, record, 'extra-field', [
      'def analyze(request, context):',
      '    return {"status": "completed", "summary": "x", "extra": 1,',
      ...RESULT_TAIL,
    ]),
    (error) => error instanceof AnalysisError && error.code === 'analysis_output_invalid',
  )
})
