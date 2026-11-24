/**
 * Analysis execution: build the module request, run it under the private interpreter, validate the
 * result and persist it.
 *
 * Two gates are enforced here rather than in the worker, because they are the host's facts:
 *  - concurrency: at most two analysis processes globally, and one module run at a time per snapshot
 *    (two runs on one snapshot would race the run index);
 *  - result contract: the worker's output must satisfy the manifest schema and be lossless JSON.
 */
import type { Context } from '@deepseek-ai/cordis'

import type { SessionLike } from '../data-collector/store.js'

import type { AnalysisModuleEntry } from './registry.js'
import { MODULE_DEFAULT_LIMITS } from './schemas.js'
import type { SnapshotRecord } from './snapshot.js'
import {
  REQUEST_FILE,
  RESULT_FILE,
  RUN_FILE,
  analysisDir,
  moduleRunDir,
  newModuleRunId,
  readJsonFile,
  runRef,
  writeFiles,
  type AnalysisFileWriter,
} from './storage.js'
import { ANALYSIS_ERROR_CODES, ANALYSIS_PROTOCOL, AnalysisError, type AnalysisErrorCode, type ModuleResult } from './types.js'
import { validateAgainstSchema, validateModuleResult } from './validation.js'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { stableStringify } from './snapshot.js'

/** The slice of `pythonRuntime` the analysis family uses. Resolved per call, never memoized. */
export interface AnalysisRuntimeLike {
  runAnalysisModule(options: {
    moduleDir: string
    entrypoint: string
    runDir: string
    inputsDir: string
    capabilities: readonly string[]
    limits: { max_input_rows: number; max_output_bytes: number; max_log_bytes: number }
    timeoutMs: number
    signal?: AbortSignal
  }): Promise<{ result: unknown; pythonVersion: string; durationMs: number }>
}

interface AnalysisRuntimeService extends AnalysisRuntimeLike {
  runAnalysisModule: AnalysisRuntimeLike['runAnalysisModule']
}

/**
 * Resolve the runtime service at call time: the row is opt-in and the pack may be missing, so a
 * boot-time lookup would either hide the tools or fail the plugin. Missing runtime is reported with
 * the same install hint as the data capabilities.
 */
export function analysisRuntimeFrom(ctx: Context): AnalysisRuntimeLike {
  return {
    async runAnalysisModule(options) {
      const manager = ctx.get('pythonRuntime') as AnalysisRuntimeService | undefined
      if (manager === undefined || typeof manager.runAnalysisModule !== 'function') {
        throw new AnalysisError(
          'analysis_runtime_not_ready',
          '私有 Python 运行时未加载（python-runtime 行未启用或尚未装配）；请在插件设置 → 分析环境里安装 base pack',
        )
      }
      return await manager.runAnalysisModule(options)
    },
  }
}

/** Global cap: the private interpreter is heavy and the machine is shared with the DSH host. */
const MAX_CONCURRENT_ANALYSES = 2
let activeAnalyses = 0
const waiting: Array<() => void> = []

async function withAnalysisSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeAnalyses >= MAX_CONCURRENT_ANALYSES) {
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  activeAnalyses += 1
  try {
    return await run()
  } finally {
    activeAnalyses -= 1
    waiting.shift()?.()
  }
}

/** One run per snapshot at a time; the tail is kept so later runs queue instead of interleaving. */
const snapshotTails = new Map<string, Promise<unknown>>()

async function serializeBySnapshot<T>(analysisId: string, run: () => Promise<T>): Promise<T> {
  const previous = snapshotTails.get(analysisId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(run)
  snapshotTails.set(analysisId, next)
  try {
    return await next
  } finally {
    if (snapshotTails.get(analysisId) === next) snapshotTails.delete(analysisId)
  }
}

/** Test-only: reset the concurrency counters between cases. */
export function resetAnalysisRuntimeState(): void {
  activeAnalyses = 0
  waiting.length = 0
  snapshotTails.clear()
}

export interface AnalysisRunRecord {
  readonly module_run_id: string
  readonly module_id: string
  readonly module_version: string
  readonly params_digest: string
  readonly run_fingerprint: string
  readonly status: ModuleResult['status']
  readonly created_at: number
  readonly reused_from?: string
}

export interface AnalysisRunIndex {
  readonly analysis_id: string
  readonly input_fingerprint: string
  readonly runs: readonly AnalysisRunRecord[]
}

export interface RunModuleOptions {
  writer: AnalysisFileWriter
  runtime: AnalysisRuntimeLike
  session: SessionLike
  snapshot: SnapshotRecord
  module: AnalysisModuleEntry
  params: Readonly<Record<string, unknown>>
  signal?: AbortSignal
  now?: number
}

export interface RunModuleOutcome {
  readonly analysis_run_ref: string
  readonly module_id: string
  readonly module_version: string
  readonly status: ModuleResult['status']
  readonly summary: string
  readonly metrics: Record<string, unknown>
  readonly assumptions: readonly string[]
  readonly limitations: readonly string[]
  readonly data_gaps: readonly string[]
  readonly validation: { readonly status: 'pass' | 'warning'; readonly issues: readonly unknown[] }
  readonly reused: boolean
}

function digest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex')
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AnalysisError('analysis_snapshot_invalid', `快照缺少 ${field}（快照文件被改动过？）`)
  }
  return value
}

/** Run one registered module against a loaded snapshot, with reuse keyed by `run_fingerprint`. */
export async function runModuleOnSnapshot(options: RunModuleOptions): Promise<RunModuleOutcome> {
  const { writer, runtime, session, snapshot, module } = options
  const now = options.now ?? Date.now()
  const manifest = module.manifest

  if (!manifest.roles.includes('senior_analyst')) {
    throw new AnalysisError('analysis_module_not_applicable', `模块 ${manifest.id} 未声明 senior_analyst 角色`)
  }
  const params = options.params ?? {}
  const paramIssues = validateAgainstSchema(params, manifest.input_schema as Record<string, unknown>, 'params')
  if (paramIssues.length > 0) {
    throw new AnalysisError('analysis_input_invalid', `参数不符合 ${manifest.id} 的输入契约：${paramIssues.slice(0, 4).join('；')}`)
  }

  const analysisId = requireString(snapshot.analysis_id, 'analysis_id')
  const paramsDigest = digest(params)
  const runFingerprint = digest({
    input_fingerprint: snapshot.input_fingerprint,
    module_id: manifest.id,
    module_version: manifest.version,
    params_digest: paramsDigest,
  })

  return await serializeBySnapshot(analysisId, async () => {
    const index = await readRunIndex(writer, session, analysisId, options.signal)
    const reusable = index.runs.find((record) => record.run_fingerprint === runFingerprint && record.status !== 'failed')
    if (reusable !== undefined) {
      const stored = await readJsonFile<{ result?: ModuleResult }>(
        writer,
        session,
        `${moduleRunDir(analysisId, reusable.module_run_id)}/${RESULT_FILE}`,
        options.signal,
      )
      if (stored?.result !== undefined) return toOutcome(analysisId, reusable.module_run_id, manifest.id, manifest.version, stored.result, true)
    }

    const moduleRunId = newModuleRunId()
    const dir = moduleRunDir(analysisId, moduleRunId)
    const request = {
      protocol: ANALYSIS_PROTOCOL,
      task_id: requireString(snapshot.task_id, 'task_id'),
      analysis_id: analysisId,
      module_run_id: moduleRunId,
      snapshot_id: analysisId,
      as_of: requireString(snapshot.as_of, 'as_of'),
      inputs: {
        datasets: snapshot.dataset_refs.map((item) => ({ dataset_id: item.dataset_id })),
        profiles: snapshot.profile_refs.map((item) => ({ profile_id: item.profile_id })),
        evidence: snapshot.evidence,
      },
      params,
    }
    const [requestFile] = await writeFiles(writer, session, dir, [{ name: REQUEST_FILE, content: JSON.stringify(request) }], {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      what: '写入模块请求失败',
    })
    const runDirAbsolute = dirname(requestFile.absolutePath)

    const limits = { ...MODULE_DEFAULT_LIMITS, ...manifest.limits }
    let executed: Awaited<ReturnType<AnalysisRuntimeLike['runAnalysisModule']>>
    try {
      executed = await withAnalysisSlot(() => runtime.runAnalysisModule({
        moduleDir: module.dir,
        entrypoint: module.entrypoint,
        runDir: runDirAbsolute,
        inputsDir: snapshot.paths.inputs_dir,
        capabilities: manifest.capabilities,
        limits: {
          max_input_rows: limits.max_input_rows,
          max_output_bytes: limits.max_output_bytes,
          max_log_bytes: limits.max_log_bytes,
        },
        timeoutMs: limits.timeout_ms,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }))
    } catch (error) {
      throw asRuntimeError(error, manifest.id)
    }

    const validated = validateModuleResult(executed.result, manifest)
    const result = validated.result
    if (result === undefined || !validated.ok) {
      await writeFiles(writer, session, dir, [{
        name: RESULT_FILE,
        content: JSON.stringify({ ok: false, issues: validated.issues, raw: executed.result ?? null }),
      }], { ...(options.signal === undefined ? {} : { signal: options.signal }), overwrite: true, what: '写入失败结果失败' })
      throw new AnalysisError('analysis_output_invalid', `模块 ${manifest.id} 的结果不满足契约：${validated.issues.slice(0, 4).map((issue) => issue.detail).join('；')}`)
    }

    const moduleResult = result as unknown as ModuleResult
    await writeFiles(writer, session, dir, [{
      name: RESULT_FILE,
      content: JSON.stringify({
        ok: true,
        python: executed.pythonVersion,
        duration_ms: executed.durationMs,
        result: moduleResult,
      }),
    }], { ...(options.signal === undefined ? {} : { signal: options.signal }), overwrite: true, what: '写入模块结果失败' })

    const record: AnalysisRunRecord = {
      module_run_id: moduleRunId,
      module_id: manifest.id,
      module_version: manifest.version,
      params_digest: paramsDigest,
      run_fingerprint: runFingerprint,
      status: moduleResult.status,
      created_at: now,
    }
    const nextIndex: AnalysisRunIndex = {
      analysis_id: analysisId,
      input_fingerprint: snapshot.input_fingerprint,
      runs: [...index.runs, record],
    }
    await writeFiles(writer, session, analysisDir(analysisId), [{ name: RUN_FILE, content: JSON.stringify(nextIndex) }], {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      overwrite: true,
      what: '写入 run.json 失败',
    })
    return toOutcome(analysisId, moduleRunId, manifest.id, manifest.version, moduleResult, false)
  })
}

function toOutcome(
  analysisId: string,
  moduleRunId: string,
  moduleId: string,
  moduleVersion: string,
  result: ModuleResult,
  reused: boolean,
): RunModuleOutcome {
  const issues = result.status === 'failed' ? [{ code: 'analysis_module_failed', detail: result.summary }] : []
  return {
    analysis_run_ref: runRef(analysisId, moduleRunId),
    module_id: moduleId,
    module_version: moduleVersion,
    status: result.status,
    summary: typeof result.summary === 'string' ? result.summary : '',
    metrics: (result.metrics ?? {}) as Record<string, unknown>,
    assumptions: result.assumptions ?? [],
    limitations: result.limitations ?? [],
    data_gaps: result.data_gaps ?? [],
    validation: { status: issues.length === 0 ? 'pass' : 'warning', issues },
    reused,
  }
}

function asRuntimeError(error: unknown, moduleId: string): AnalysisError {
  if (error instanceof AnalysisError) return error
  const code = (error as { code?: unknown })?.code
  const message = error instanceof Error ? error.message : String(error)
  // A module-declared code (`AnalysisInputError`) becomes the protocol code; only known codes pass,
  // so a module cannot invent one or impersonate a host-side failure.
  const declared = (error as { analysisCode?: unknown })?.analysisCode
  if (typeof declared === 'string' && (ANALYSIS_ERROR_CODES as readonly string[]).includes(declared)) {
    return new AnalysisError(declared as AnalysisErrorCode, `模块 ${moduleId} 拒绝本次输入：${message}`)
  }
  if (code === 'timeout') return new AnalysisError('analysis_timeout', `模块 ${moduleId} 超时：${message}`)
  if (code === 'cancelled') return new AnalysisError('analysis_cancelled', `模块 ${moduleId} 被取消`)
  // `resolveDataRuntime` reports a missing base pack as `data-runtime-not-ready`; without this the
  // documented `analysis_runtime_not_ready` degraded into `analysis_output_invalid` (2026-11-24 实测).
  if (code === 'runtime-not-ready' || code === 'data-runtime-not-ready') {
    return new AnalysisError('analysis_runtime_not_ready', message)
  }
  return new AnalysisError('analysis_output_invalid', `模块 ${moduleId} 执行失败：${message}`)
}

async function readRunIndex(
  writer: AnalysisFileWriter,
  session: SessionLike,
  analysisId: string,
  signal?: AbortSignal,
): Promise<AnalysisRunIndex> {
  const stored = await readJsonFile<AnalysisRunIndex>(writer, session, `${analysisDir(analysisId)}/${RUN_FILE}`, signal)
  if (stored === undefined) return { analysis_id: analysisId, input_fingerprint: '', runs: [] }
  return { analysis_id: analysisId, input_fingerprint: stored.input_fingerprint ?? '', runs: Array.isArray(stored.runs) ? stored.runs : [] }
}

