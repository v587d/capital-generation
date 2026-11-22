/**
 * Python-only data sources (private runtime + repo-vendored packages).
 *
 * Every capability is fixed to one reviewed script under `python/scripts/`; the runner is injected at
 * assembly time and only touches the runtime when a capability is called (§9.7: external state stays
 * call-time, failures are not memoized). Rows coming back from Python are re-validated and mapped
 * field by field here — raw dicts never reach a Dataset as-is.
 */
import type { DataSource } from '../data-collector/hub.js';
export type PythonDataScript = 'baostock_valuation_history' | 'baostock_stock_basic' | 'pbc_social_financing';
export interface PythonScriptRunRequest {
    script: PythonDataScript;
    params: Record<string, unknown>;
    signal?: AbortSignal;
}
export interface PythonScriptRunResult {
    rows: unknown[];
    pythonVersion?: string;
    durationMs?: number;
}
/** Injected by the host: `PythonRuntimeManager.runDataScript` fits this shape. */
export type PythonScriptRunner = (request: PythonScriptRunRequest) => Promise<PythonScriptRunResult>;
export declare const MAX_BASIC_CODES = 50;
export declare const MAX_SOCIAL_FINANCING_MONTHS = 120;
export declare function createPythonSources(runner: PythonScriptRunner): DataSource[];
