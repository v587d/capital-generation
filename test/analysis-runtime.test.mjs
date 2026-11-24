import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { analysisModuleById } from '../lib/analysis/registry.js'
import { analysisRuntimeFrom, resetAnalysisRuntimeState, runModuleOnSnapshot } from '../lib/analysis/runtime.js'
import { createSnapshot, loadSnapshot } from '../lib/analysis/snapshot.js'
import { AnalysisError } from '../lib/analysis/types.js'
import { DatasetStoreError } from '../lib/data-collector/store.js'
import { PythonRuntimeManager } from '../lib/python-runtime/manager.js'
import { readManifest } from '../lib/python-runtime/manifest.js'
import { detectPlatform } from '../lib/python-runtime/platform.js'
import { resolveDshHome } from '../lib/python-runtime/paths.js'

const SESSION = { id: 'session-analysis-test', header: { cwd: '/workspace' } }

/** Store double: real files under a temp dir, so the private interpreter gets real paths. */
function diskStore(root) {
  const absolute = (rel) => join(root, rel)
  return {
    async writeWorkspaceFiles({ dir, files }) {
      await mkdir(absolute(dir), { recursive: true })
      const written = []
      for (const file of files) {
        const path = absolute(`${dir}/${file.name}`)
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
      return {
        ref: { dataset_id, captured_at: 1_700_000_000_000, params_digest: 'digest', retention_until: Date.now() + 86_400_000, time_coverage: { column: 'trade_date', from: '2026-01-01', to: '2026-11-20', format: 'date_string' } },
        rows: [
          { trade_date: '2026-11-19', close: 10.5, volume: 1_000 },
          { trade_date: '2026-11-20', close: 10.8, volume: 1_200 },
        ],
        envelope: { trade_date: '2026-11-20' },
      }
    },
    async readProfile({ profile_id }) {
      return {
        ref: { profile_id, dataset_id: 'ds_1', created_at: 1_700_000_000_000, retention_until: Date.now() + 86_400_000, artifact_ref: `workspace:capital-data/profiles/${profile_id}` },
        profile: { row_count: 2, columns: ['trade_date', 'close', 'volume'], quality: { missing_values: 0, duplicate_rows: 0, time_ordered: true }, warnings: [] },
      }
    },
  }
}

const SNAPSHOT_INPUT = {
  task_id: 'task_analysis_1',
  question: '这家公司的毛利率是否可持续',
  purpose: 'research',
  depth: 'standard',
  as_of: '2026-11-24',
  dataset_refs: [{ dataset_id: 'ds_1' }],
  profile_refs: [{ profile_id: 'p_1' }],
  evidence: [{ source_id: 'ev_1', kind: 'filing', title: '年报', verification: 'verified_official' }],
  prior_analysis_refs: [],
  constraints: { must_show_method: true },
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'cg-analysis-'))
  return { root, store: diskStore(root) }
}

function manager() {
  return new PythonRuntimeManager({
    manifest: readManifest(fileURLToPath(new URL('../runtime/manifest.json', import.meta.url))),
    dshHome: resolveDshHome(),
    workerPath: fileURLToPath(new URL('../python/worker.py', import.meta.url)),
    target: detectPlatform(),
  })
}

async function runtimeReady() {
  try {
    const status = await manager().status()
    return status.base?.state === 'ready'
  } catch {
    return false
  }
}

const runtimeFrom = (managerInstance) => analysisRuntimeFrom({ get: (name) => (name === 'pythonRuntime' ? managerInstance : undefined) })

test('无 runtime：分析工具响亮失败为 analysis_runtime_not_ready（不 memoize 装配期结果）', async () => {
  const runtime = analysisRuntimeFrom({ get: () => undefined })
  await assert.rejects(
    () => runtime.runAnalysisModule({ moduleDir: '/x', entrypoint: 'module.py', runDir: '/x', inputsDir: '/x', capabilities: [], limits: { max_input_rows: 1, max_output_bytes: 1, max_log_bytes: 1 }, timeoutMs: 1000 }),
    (error) => error instanceof AnalysisError && error.code === 'analysis_runtime_not_ready',
  )
})

test('快照：staging 落盘、指纹稳定、过期与缺失都响亮失败', async () => {
  const { store } = await workspace()
  const { record, ref } = await createSnapshot({ reader: store, writer: store, session: SESSION, input: SNAPSHOT_INPUT })
  assert.match(ref, /^analysis:analysis_/u)
  assert.equal(record.datasets.length, 1)
  assert.equal(record.datasets[0].row_count, 2)
  assert.deepEqual(record.datasets[0].columns.map((column) => column.name), ['trade_date', 'close', 'volume'])
  assert.equal(record.datasets[0].time_axis?.column, 'trade_date')
  assert.equal(record.paths.inputs_dir.endsWith(join('inputs', 'datasets')), false, 'inputs_dir 是 inputs/ 本身')
  assert.ok(existsSync(join(record.paths.inputs_dir, 'datasets', 'ds_1.json')), '数据集副本必须已落盘')
  assert.ok(existsSync(join(record.paths.inputs_dir, 'profiles', 'p_1.json')), 'profile 副本必须已落盘')
  assert.ok(existsSync(join(record.paths.inputs_dir, 'evidence', 'ev_1.json')), '证据副本必须已落盘')

  const loaded = await loadSnapshot({ reader: store, session: SESSION, analysisId: record.analysis_id })
  assert.equal(loaded.input_fingerprint, record.input_fingerprint, '同一输入必须得到同一指纹')

  const again = await createSnapshot({ reader: store, writer: store, session: SESSION, input: SNAPSHOT_INPUT })
  assert.equal(again.record.input_fingerprint, record.input_fingerprint, '指纹只取决于输入，与 id / 时间无关')

  const changed = await createSnapshot({
    reader: store,
    writer: store,
    session: SESSION,
    input: { ...SNAPSHOT_INPUT, constraints: { must_show_method: false } },
  })
  assert.notEqual(changed.record.input_fingerprint, record.input_fingerprint, '约束变了指纹必须变')

  await assert.rejects(
    () => loadSnapshot({ reader: store, session: SESSION, analysisId: record.analysis_id, now: record.expires_at + 1 }),
    (error) => error instanceof AnalysisError && error.code === 'analysis_snapshot_expired',
  )
  await assert.rejects(
    () => loadSnapshot({ reader: store, session: SESSION, analysisId: 'analysis_missing0' }),
    (error) => error instanceof AnalysisError && error.code === 'analysis_snapshot_invalid',
  )
})

test('参数不合契约：运行前就拒，不启动 Python', async () => {
  const { store } = await workspace()
  const { record } = await createSnapshot({ reader: store, writer: store, session: SESSION, input: SNAPSHOT_INPUT })
  const hello = analysisModuleById('hello')
  await assert.rejects(
    () => runModuleOnSnapshot({
      writer: store,
      runtime: analysisRuntimeFrom({ get: () => undefined }),
      session: SESSION,
      snapshot: record,
      module: hello,
      params: { bogus: 1 },
    }),
    (error) => error instanceof AnalysisError && error.code === 'analysis_input_invalid',
  )
})

test('hello 模块端到端：跑通、结果合 schema、同指纹复用、run.json 记录在案', async (t) => {
  if (!(await runtimeReady())) {
    t.skip('私有 Python runtime 未准备：跳过真实执行用例（插件设置 → 分析环境安装 base pack 后重跑）')
    return
  }
  resetAnalysisRuntimeState()
  const { root, store } = await workspace()
  const { record } = await createSnapshot({ reader: store, writer: store, session: SESSION, input: SNAPSHOT_INPUT })
  const hello = analysisModuleById('hello')
  const runtime = runtimeFrom(manager())

  const outcome = await runModuleOnSnapshot({ writer: store, runtime, session: SESSION, snapshot: record, module: hello, params: { note: 'smoke' } })
  assert.equal(outcome.status, 'completed', `hello 模块应 completed：${JSON.stringify(outcome)}`)
  assert.equal(outcome.reused, false)
  assert.equal(outcome.metrics.dataset_count, 1)
  assert.equal(outcome.metrics.profile_count, 1)
  assert.equal(outcome.metrics.dataset_rows, 2)
  assert.equal(outcome.validation.status, 'pass')

  const again = await runModuleOnSnapshot({ writer: store, runtime, session: SESSION, snapshot: record, module: hello, params: { note: 'smoke' } })
  assert.equal(again.reused, true, '同一快照 + 同一参数 + 同一模块版本必须复用，不重复执行')
  assert.equal(again.analysis_run_ref, outcome.analysis_run_ref)

  const runIndex = JSON.parse(await readFile(join(root, record.paths.dir, 'run.json'), 'utf8'))
  assert.equal(runIndex.runs.length, 1, '复用不应追加新的 run 记录')
  assert.equal(runIndex.runs[0].module_id, 'hello')
  assert.match(runIndex.runs[0].run_fingerprint, /^[a-f0-9]{64}$/u)
})

test('模块结果不合契约：NaN 与未声明能力都被宿主拒绝', async (t) => {
  if (!(await runtimeReady())) {
    t.skip('私有 Python runtime 未准备：跳过真实执行用例')
    return
  }
  resetAnalysisRuntimeState()
  const { root, store } = await workspace()
  const { record } = await createSnapshot({ reader: store, writer: store, session: SESSION, input: SNAPSHOT_INPUT })
  const runtime = runtimeFrom(manager())

  const nanDir = join(root, 'module-nan')
  await mkdir(nanDir, { recursive: true })
  await writeFile(join(nanDir, 'module.py'), [
    'def analyze(request, context):',
    '    return {"status": "completed", "summary": "x", "metrics": {"bad": float("nan")},',
    '            "claims": [], "assumptions": [], "methodology_log": [], "sensitivity": {},',
    '            "limitations": [], "data_gaps": [], "outputs": []}',
    '',
  ].join('\n'))
  await assert.rejects(
    () => runModuleOnSnapshot({
      writer: store,
      runtime,
      session: SESSION,
      snapshot: record,
      module: { manifest: { ...analysisModuleById('hello').manifest, id: 'nan', output_schema: {} }, dir: nanDir, entrypoint: 'module.py' },
      params: {},
    }),
    (error) => error instanceof AnalysisError && error.code === 'analysis_output_invalid',
  )

  const noCapability = { ...analysisModuleById('hello').manifest, capabilities: [] }
  await assert.rejects(
    () => runModuleOnSnapshot({
      writer: store,
      runtime,
      session: SESSION,
      snapshot: record,
      module: { ...analysisModuleById('hello'), manifest: noCapability },
      params: {},
    }),
    (error) => error instanceof AnalysisError && error.code === 'analysis_output_invalid',
  )
})
