import { type PlatformFacts } from './platform.js';
import { runPnpm, type PnpmInvocation } from './pnpm.js';
import { probePython, type WorkerProcessRunner } from './probe.js';
import type { PackName, PrepareJob, ProbeReport, RuntimeHandle, RuntimeManifest, RuntimeStatus } from './types.js';
interface LoggerLike {
    info?(message: string): void;
    warn?(message: string): void;
    error?(message: string): void;
}
export interface PythonRuntimeManagerOptions {
    manifest: RuntimeManifest;
    dshHome?: string;
    workerPath: string;
    target: PlatformFacts;
    profileDir?: string;
    packageManager?: PnpmInvocation;
    packSources?: Partial<Record<PackName, string>>;
    registry?: string;
    logger?: LoggerLike;
    now?: () => Date;
    runPnpm?: typeof runPnpm;
    probePython?: typeof probePython;
    runWorkerProcess?: WorkerProcessRunner;
}
export interface RunDataScriptOptions {
    /** Script id: the file name without `.py` under `python/scripts/`. */
    script: string;
    /** Written to the run directory as `input.json`; scripts validate it themselves. */
    params?: Record<string, unknown>;
    timeoutMs?: number;
    signal?: AbortSignal;
}
export interface DataScriptResult {
    rows: unknown[];
    pythonVersion: string;
    durationMs: number;
}
export interface RunAnalysisModuleOptions {
    /** Absolute directory of the reviewed module inside the package. */
    moduleDir: string;
    entrypoint: string;
    /** Absolute run directory the worker reads `request.json` from and writes `result.json` into. */
    runDir: string;
    /** Absolute `inputs/` directory of the snapshot (staged dataset/profile/evidence copies). */
    inputsDir: string;
    capabilities: readonly string[];
    limits: {
        max_input_rows: number;
        max_output_bytes: number;
        max_log_bytes: number;
    };
    timeoutMs: number;
    signal?: AbortSignal;
}
export interface AnalysisModuleRunResult {
    result: unknown;
    pythonVersion: string;
    durationMs: number;
}
export declare class PythonRuntimeManager {
    readonly manifest: RuntimeManifest;
    readonly dshHome: string;
    readonly cacheRoot: string;
    readonly workerPath: string;
    readonly target: PlatformFacts;
    private readonly profileDir?;
    private readonly packageManager?;
    private readonly packSources;
    private readonly registry?;
    private readonly logger?;
    private readonly now;
    private readonly runPnpm;
    private readonly probePython;
    private readonly runWorker;
    private readonly jobs;
    private activeJobId?;
    private pnpmInvocation?;
    constructor(options: PythonRuntimeManagerOptions);
    private targetId;
    private readReady;
    private packStatus;
    status(): Promise<RuntimeStatus>;
    prepare(packs?: unknown): PrepareJob;
    getJob(id: string): PrepareJob | undefined;
    waitForJob(id: string): Promise<PrepareJob>;
    cancel(id: string): boolean;
    private runJob;
    private getPnpm;
    private ensurePack;
    private readPackMetadata;
    private validateProbe;
    /** Re-run the self-check against the installed packs; `parquet` also verifies pyarrow. */
    verify(packs?: unknown): Promise<ProbeReport>;
    /** Base pack must be installed and intact; a missing runtime is a call-time failure, never a boot gate. */
    private resolveDataRuntime;
    /** Quote a JSON value for a script's `input.json`: no `undefined`, no non-finite numbers. */
    private static serializeParams;
    /**
     * Run one fixed repo data script in an isolated run directory and return the rows it wrote.
     *
     * The child only ever sees a copied repo script and `input.json`; its whole working set lives under
     * `<cacheRoot>/data-runs/<script>-<uuid>/` and is removed afterwards. `python/vendor` rides along as
     * an extra `--site-packages` entry so no pip/venv/pack is involved.
     */
    runDataScript(options: RunDataScriptOptions): Promise<DataScriptResult>;
    /**
     * Run one reviewed analysis module and return the object it wrote.
     *
     * The child gets a run directory inside the workspace: `request.json` is already there (the store
     * wrote it), and the module's `outputs/` and `logs/` land beside it. The run directory is not
     * deleted here — it is the audit trail; retention is the analysis layer's decision.
     */
    runAnalysisModule(options: RunAnalysisModuleOptions): Promise<AnalysisModuleRunResult>;
    resolve(packs?: unknown): Promise<RuntimeHandle>;
    remove(pack: PackName): Promise<void>;
    dispose(): Promise<void>;
}
export {};
