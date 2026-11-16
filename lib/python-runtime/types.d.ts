/** Public, JSON-serializable shapes of the plugin-owned Python runtime. */
export declare const PACK_NAMES: readonly ["base", "parquet"];
export type PackName = (typeof PACK_NAMES)[number];
export declare const TARGET_IDS: readonly ["win32-x64", "darwin-arm64", "darwin-x64", "linux-x64"];
export type TargetId = (typeof TARGET_IDS)[number];
export interface PackTarget {
    package: string;
    version: string;
    bytes: number;
    sha256?: string;
}
export interface PackManifest {
    kind: 'base' | 'lib';
    packages: Record<string, string>;
    requires?: Partial<Record<PackName, string>>;
    targets: Partial<Record<TargetId, PackTarget>>;
}
export interface RuntimeManifest {
    schemaVersion: 1;
    python: string;
    cacheRoot: string;
    packs: Record<PackName, PackManifest>;
    limits: {
        minFreeBytes: number;
        installTimeoutMs: number;
        probeTimeoutMs: number;
    };
}
export type PackState = 'not-installed' | 'installing' | 'ready' | 'broken';
export interface PackStatus {
    name: PackName;
    state: PackState;
    kind: 'base' | 'lib';
    version: string;
    package: string;
    target: TargetId | null;
    pythonVersion: string;
    packages: Record<string, string>;
    installedAt?: string;
    bytes: number;
    path: string;
    error?: string;
}
export interface RuntimeStatus {
    supported: boolean;
    reason?: string;
    target: TargetId | null;
    platform: string;
    arch: string;
    python: string;
    cacheRoot: string;
    base: PackStatus;
    parquet: PackStatus;
    ready: boolean;
    activeJob?: PrepareJob;
}
export type PrepareState = 'running' | 'done' | 'failed' | 'cancelled';
export type PrepareStage = 'checking' | 'installing' | 'verifying' | 'done';
export interface PrepareJobError {
    code: string;
    message: string;
}
export interface PrepareJob {
    id: string;
    packs: PackName[];
    state: PrepareState;
    stage: PrepareStage;
    current?: PackName;
    message: string;
    startedAt: string;
    endedAt?: string;
    error?: PrepareJobError;
}
export interface RuntimeHandle {
    python: string;
    pythonVersion: string;
    sitePackages: string[];
    packages: Record<string, string>;
    packs: Partial<Record<PackName, string>>;
}
export interface ProbeReport {
    pythonVersion: string;
    executable: string;
    platform: string;
    arch: string;
    sitePackages: string[];
    packages: Record<string, string>;
}
export interface ReadyFile {
    schemaVersion: 1;
    pack: PackName;
    packVersion: string;
    target: TargetId;
    package: string;
    pythonVersion: string;
    packages: Record<string, string>;
    python: string | null;
    sitePackages: string[];
    installedAt: string;
    probe: {
        ok: boolean;
        at: string;
    };
    bytes?: number;
}
