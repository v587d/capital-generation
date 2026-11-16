import { type PlatformFacts } from './platform.js';
import { runPnpm, type PnpmInvocation } from './pnpm.js';
import { probePython } from './probe.js';
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
    resolve(packs?: unknown): Promise<RuntimeHandle>;
    remove(pack: PackName): Promise<void>;
    dispose(): Promise<void>;
}
export {};
