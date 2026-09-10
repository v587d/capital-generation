/**
 * Phase 1/2 workspace-local Dataset store（依据 DATA_PIPELINE_REDESIGN.md 第 5/6/7 节）。
 *
 * 原始 Dataset 只由宿主写入，Dataset/Profile 都通过 createIfAbsent 发布。
 * Agent 只能使用 dataset_id 和 opaque artifact_ref，不能传入真实路径。
 */
export declare const WORKSPACE_DATA_DIR = "capital-data";
export declare const DATASETS_SUBDIR = "capital-data/datasets";
export declare const PROFILES_SUBDIR = "capital-data/profiles";
export declare const RAW_FILE = "raw.json";
export declare const MANIFEST_FILE = "manifest.json";
export declare const PROFILE_FILE = "profile.json";
export declare const DEFAULT_RETENTION_MS: number;
export declare const MAX_RAW_READ_BYTES: number;
export declare const MAX_SLICE_ROWS = 200;
export declare const DEFAULT_SLICE_ROWS = 100;
export declare const MAX_SLICE_OUTPUT_BYTES: number;
export declare const MAX_PROFILE_BYTES: number;
export declare const ARTIFACT_SCHEME = "workspace://";
export interface DatasetRef {
    dataset_id: string;
    task_id: string | null;
    session_id: string;
    artifact_ref: string;
    format: 'json' | 'json_rows';
    capability: string;
    source_label: string;
    schema: object | null;
    row_count: number | null;
    captured_at: number;
    retention_until: number;
    params_digest: string;
}
export type DatasetShape = 'array' | 'envelope_item' | 'none';
export interface DatasetInspection extends DatasetRef {
    row_access: {
        readable: boolean;
        shape: DatasetShape;
        max_slice_rows: number;
        reason?: string;
    };
}
export interface DatasetSlice {
    dataset_id: string;
    offset: number;
    limit: number;
    returned_count: number;
    total_count: number;
    has_more: boolean;
    rows: unknown[];
}
export interface ProfileRef {
    profile_id: string;
    dataset_id: string;
    task_id: string | null;
    session_id: string;
    artifact_ref: string;
    created_at: number;
    retention_until: number;
}
export interface ProfilePayload {
    row_count: number;
    columns: string[];
    quality: {
        missing_values: number;
        duplicate_rows: number;
        time_ordered: boolean | null;
    };
    statistics?: Record<string, {
        min?: number | null;
        max?: number | null;
        mean?: number | null;
        p25?: number | null;
        p50?: number | null;
        p75?: number | null;
    }>;
    warnings: string[];
}
export type DatasetStoreErrorCode = 'workspace_not_writable' | 'session_unavailable' | 'session_cwd_unavailable' | 'sandbox_policy_unavailable' | 'filesystem_unavailable' | 'dataset_write_failed' | 'dataset_id_invalid' | 'dataset_not_found' | 'dataset_expired' | 'dataset_session_mismatch' | 'dataset_manifest_invalid' | 'dataset_format_unsupported' | 'dataset_not_row_readable' | 'dataset_column_not_found' | 'dataset_too_large_for_slice' | 'dataset_slice_out_of_range' | 'profile_invalid' | 'profile_too_large' | 'profile_dataset_mismatch';
export declare class DatasetStoreError extends Error {
    readonly code: DatasetStoreErrorCode;
    constructor(code: DatasetStoreErrorCode, detail: string);
}
export interface SessionLike {
    readonly id: string;
    readonly header?: {
        readonly cwd?: string;
        readonly parentSession?: string;
    };
}
export interface SandboxPolicyResultLike {
    readonly mode?: string;
    readonly workspaceRoot?: string;
    readonly sessionId?: string;
}
export interface SandboxPolicyLike {
    resolve?(request: {
        session?: SessionLike;
    }): SandboxPolicyResultLike;
}
export interface FsTargetLike {
    readonly targetKey: unknown;
    readonly displayPath: string;
}
export interface FsLike {
    resolve(path: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<FsTargetLike>;
    contains?(parent: FsTargetLike, child: FsTargetLike): boolean;
    stat?(target: FsTargetLike, signal?: AbortSignal): Promise<{
        type: 'file' | 'directory' | 'other';
        size?: number;
    } | undefined>;
    writeText(target: FsTargetLike, content: string, expected?: {
        kind: 'createIfAbsent';
    } | {
        kind: 'replaceIfVersion';
        version: unknown;
    }, signal?: AbortSignal, sandboxPolicy?: SandboxPolicyResultLike): Promise<unknown>;
    readText(target: FsTargetLike, signal?: AbortSignal): Promise<string>;
    listDir(target: FsTargetLike, signal?: AbortSignal): Promise<Array<{
        name: string;
        type: 'file' | 'directory' | 'other';
        target: FsTargetLike;
    }>>;
}
export interface ProfileDatasetInput {
    session: SessionLike;
    dataset_id: string;
    task_id?: string;
    time_column?: string;
    primary_key?: string;
    signal?: AbortSignal;
}
export interface ProfileDatasetResult extends ProfileRef {
    row_count: number;
    columns: string[];
    quality: ProfilePayload['quality'];
    statistics?: ProfilePayload['statistics'];
    warnings: string[];
}
export interface FindDatasetInput {
    session: SessionLike;
    capability: string;
    params_digest: string;
    signal?: AbortSignal;
}
export interface SaveDatasetInput {
    session: SessionLike;
    capability: string;
    task_id?: string;
    params_digest: string;
    source_label: string;
    format: 'json' | 'json_rows';
    schema: object | null;
    row_count: number | null;
    data: unknown;
    signal?: AbortSignal;
}
export interface WriteProfileInput {
    session: SessionLike;
    dataset_id: string;
    task_id?: string;
    profile: unknown;
    signal?: AbortSignal;
}
export interface WorkspaceDatasetStoreOptions {
    fs?: FsLike;
    sandboxPolicy?: SandboxPolicyLike;
    retentionMs?: number;
    now?: () => number;
    newId?: (prefix: string) => string;
}
export declare const DATASET_ID_PATTERN: RegExp;
export declare class WorkspaceDatasetStore {
    private readonly fs;
    private readonly sandboxPolicy;
    private readonly retentionMs;
    private readonly now;
    private readonly newId;
    constructor(options?: WorkspaceDatasetStoreOptions);
    save(input: SaveDatasetInput): Promise<DatasetRef>;
    readRef(datasetId: string, session: SessionLike, signal?: AbortSignal): Promise<DatasetRef | undefined>;
    listRefs(session: SessionLike, signal?: AbortSignal): Promise<DatasetRef[]>;
    findLatest(input: FindDatasetInput): Promise<DatasetRef | undefined>;
    inspectDataset(datasetId: string, session: SessionLike, signal?: AbortSignal): Promise<DatasetInspection>;
    readDatasetSlice(datasetId: string, session: SessionLike, input?: {
        offset?: number;
        limit?: number;
        columns?: string[];
    }, signal?: AbortSignal): Promise<DatasetSlice>;
    profileDataset(input: ProfileDatasetInput): Promise<ProfileDatasetResult>;
    writeProfile(input: WriteProfileInput): Promise<ProfileRef>;
    private requireRef;
    private readRaw;
    private resolveContained;
    private assertContained;
    private writeContext;
    private readRoot;
    private mapWriteError;
}
export declare function provideWorkspaceDatasetStore(ctx: import('@deepseek-ai/cordis').Context, options?: WorkspaceDatasetStoreOptions): WorkspaceDatasetStore;
declare module '@deepseek-ai/cordis' {
    interface Context {
        datasetStore: WorkspaceDatasetStore;
    }
}
