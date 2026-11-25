import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { DatasetStoreError } from '../lib/data-collector/store.js'
import { analysisModuleById } from '../lib/analysis/registry.js'
import { analysisRuntimeFrom, runModuleOnSnapshot } from '../lib/analysis/runtime.js'
import { createSnapshot } from '../lib/analysis/snapshot.js'
import { PythonRuntimeManager } from '../lib/python-runtime/manager.js'
import { readManifest } from '../lib/python-runtime/manifest.js'
import { detectPlatform } from '../lib/python-runtime/platform.js'
import { resolveDshHome } from '../lib/python-runtime/paths.js'

/**
 * Shared harness for module golden tests (`analysis-modules.test.mjs` predates it and keeps its
 * own copy). Fixtures follow one layout: `<case>/datasets/<dataset_id>.json` (raw store shape),
 * `params.json`, `expected.json`. Goldens are hand-computed, never recorded from module output.
 */

const RUNTIME_MANIFEST = fileURLToPath(new URL('../runtime/manifest.json', import.meta.url))
const WORKER = fileURLToPath(new URL('../python/worker.py', import.meta.url))
const SESSION = { id: 'session-analysis-module-fixtures', header: { cwd: '/workspace' } }

export function manager() {
  return new PythonRuntimeManager({
    manifest: readManifest(RUNTIME_MANIFEST),
    dshHome: resolveDshHome(),
    workerPath: WORKER,
    target: detectPlatform(),
  })
}

export const runtimeFrom = () => analysisRuntimeFrom({ get: (name) => (name === 'pythonRuntime' ? manager() : undefined) })

export async function runtimeReady() {
  try {
    return (await manager().status()).base?.state === 'ready'
  } catch {
    return false
  }
}

/** Store double: fixture datasets on disk, workspace files under a temp dir (the interpreter needs real paths). */
export function fixtureStore(root, caseDir) {
  const datasets = join(caseDir, 'datasets')
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
      return {
        ref: {
          dataset_id,
          captured_at: 1_700_000_000_000,
          params_digest: 'digest',
          retention_until: Date.now() + 86_400_000,
          ...(raw.time_coverage === undefined ? {} : { time_coverage: raw.time_coverage }),
        },
        rows: raw.rows,
        ...(raw.envelope === undefined ? {} : { envelope: raw.envelope }),
      }
    },
    async readProfile() {
      throw new Error('this module does not read profiles: a fixture must not reach this path')
    },
  }
}

export async function setupCase({ caseDir, moduleId, snapshotInput = {}, input = {} }) {
  const root = await mkdtemp(join(tmpdir(), `cg-${moduleId}-`))
  const store = fixtureStore(root, caseDir)
  const datasetsDir = join(caseDir, 'datasets')
  let datasetIds = []
  try {
    datasetIds = (await readdir(datasetsDir)).map((file) => file.replace(/\.json$/u, ''))
  } catch {
    // Params-only modules (no dataset input) have no datasets directory.
  }
  const { record, ref } = await createSnapshot({
    reader: store,
    writer: store,
    session: SESSION,
    input: {
      task_id: `task_${moduleId}`,
      question: '模块 golden 测试',
      purpose: 'research',
      depth: 'standard',
      as_of: '2025-06-30',
      dataset_refs: datasetIds.map((dataset_id) => ({ dataset_id })),
      profile_refs: [],
      evidence: [],
      prior_analysis_refs: [],
      constraints: {},
      ...snapshotInput,
      ...input,
    },
  })
  return { root, store, record, ref }
}

export async function runCase({ caseDir, moduleId, params, input = {} }) {
  const workspace = await setupCase({ caseDir, moduleId, input })
  const parsedParams = params ?? JSON.parse(await readFile(join(caseDir, 'params.json'), 'utf8'))
  const outcome = await runModuleOnSnapshot({
    writer: workspace.store,
    runtime: runtimeFrom(),
    session: SESSION,
    snapshot: workspace.record,
    module: analysisModuleById(moduleId),
    params: parsedParams,
  })
  return { ...workspace, outcome }
}

export async function expectedOf(caseDir) {
  return JSON.parse(await readFile(join(caseDir, 'expected.json'), 'utf8'))
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function moduleRunDir(root, record) {
  const index = await readJson(join(root, record.paths.dir, 'run.json'))
  const latest = index.runs.at(-1)
  return { index, id: latest.module_run_id, dir: join(root, record.paths.dir, 'modules', latest.module_run_id) }
}
