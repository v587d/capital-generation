/**
 * Analysis execution: build the module request, run it under the private interpreter, validate the
 * result and persist it.
 *
 * Two gates are enforced here rather than in the worker, because they are the host's facts:
 *  - concurrency: at most two analysis processes globally, and one module run at a time per snapshot
 *    (two runs on one snapshot would race the run index);
 *  - result contract: the worker's output must satisfy the manifest schema and be lossless JSON.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionLike } from '../data-collector/store.js';
import type { AnalysisModuleEntry } from './registry.js';
import type { SnapshotRecord } from './snapshot.js';
import { type AnalysisFileWriter } from './storage.js';
import { type ModuleResult } from './types.js';
/** The slice of `pythonRuntime` the analysis family uses. Resolved per call, never memoized. */
export interface AnalysisRuntimeLike {
    runAnalysisModule(options: {
        moduleDir: string;
        entrypoint: string;
        runDir: string;
        inputsDir: string;
        capabilities: readonly string[];
        limits: {
            max_input_rows: number;
            max_output_bytes: number;
            max_log_bytes: number;
        };
        timeoutMs: number;
        signal?: AbortSignal;
    }): Promise<{
        result: unknown;
        pythonVersion: string;
        durationMs: number;
    }>;
}
/**
 * Resolve the runtime service at call time: the row is opt-in and the pack may be missing, so a
 * boot-time lookup would either hide the tools or fail the plugin. Missing runtime is reported with
 * the same install hint as the data capabilities.
 */
export declare function analysisRuntimeFrom(ctx: Context): AnalysisRuntimeLike;
/** Test-only: reset the concurrency counters between cases. */
export declare function resetAnalysisRuntimeState(): void;
export interface AnalysisRunRecord {
    readonly module_run_id: string;
    readonly module_id: string;
    readonly module_version: string;
    readonly params_digest: string;
    readonly run_fingerprint: string;
    readonly status: ModuleResult['status'];
    readonly created_at: number;
    readonly reused_from?: string;
}
export interface AnalysisRunIndex {
    readonly analysis_id: string;
    readonly input_fingerprint: string;
    readonly runs: readonly AnalysisRunRecord[];
}
export interface RunModuleOptions {
    writer: AnalysisFileWriter;
    runtime: AnalysisRuntimeLike;
    session: SessionLike;
    snapshot: SnapshotRecord;
    module: AnalysisModuleEntry;
    params: Readonly<Record<string, unknown>>;
    signal?: AbortSignal;
    now?: number;
}
export interface RunModuleOutcome {
    readonly analysis_run_ref: string;
    readonly module_id: string;
    readonly module_version: string;
    readonly status: ModuleResult['status'];
    readonly summary: string;
    readonly metrics: Record<string, unknown>;
    readonly assumptions: readonly string[];
    readonly limitations: readonly string[];
    readonly data_gaps: readonly string[];
    readonly validation: {
        readonly status: 'pass' | 'warning';
        readonly issues: readonly unknown[];
    };
    readonly reused: boolean;
}
/** Run one registered module against a loaded snapshot, with reuse keyed by `run_fingerprint`. */
export declare function runModuleOnSnapshot(options: RunModuleOptions): Promise<RunModuleOutcome>;
