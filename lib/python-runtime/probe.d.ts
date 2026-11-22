import type { ProbeReport } from './types.js';
export interface ProbeOptions {
    python: string;
    workerPath: string;
    sitePackages: string[];
    homeDir: string;
    tempDir: string;
    timeoutMs: number;
    signal?: AbortSignal;
    env?: Record<string, string | undefined>;
}
export interface WorkerProcessOptions {
    python: string;
    /** Full argv after the interpreter path: worker script, subcommand and its flags. */
    args: string[];
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
    signal?: AbortSignal;
}
export interface WorkerProcessResult {
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    aborted: boolean;
    /** Set when the child could not be started at all; no exit code exists in that case. */
    spawnError?: string;
}
export type WorkerProcessRunner = (options: WorkerProcessOptions) => Promise<WorkerProcessResult>;
/**
 * Spawn the private interpreter once. Timeout kills the whole child tree, abort behaves the same
 * without becoming an error here: callers map the flags to their own `timeout` / `cancelled` codes.
 */
export declare function runWorkerProcess(options: WorkerProcessOptions): Promise<WorkerProcessResult>;
/** Run the private interpreter once and require its self-check JSON. */
export declare function probePython(options: ProbeOptions): Promise<ProbeReport>;
