import { type QueryResult, type QuerySpec } from './query.js';
/**
 * Workspace-local Dataset/profile store: immutable artifacts, host-written only. Agents receive
 * dataset_id / opaque artifact_ref, never real paths; raw rows never enter agent messages.
 */
export declare const WORKSPACE_DATA_DIR = "capital-data";
export declare const DATASETS_SUBDIR = "capital-data/datasets";
export declare const PROFILES_SUBDIR = "capital-data/profiles";
export declare const RAW_FILE = "raw.json";
export declare const MANIFEST_FILE = "manifest.json";
export declare const PROFILE_FILE = "profile.json";
export declare const DEFAULT_RETENTION_MS: number;
export declare const MAX_RAW_READ_BYTES: number;
export declare const MAX_PROFILE_BYTES: number;
/** Max distinct category values tracked; beyond this distinct_count is null and truncated is set. */
export declare const MAX_CATEGORY_DISTINCT = 2000;
export declare const MAX_CATEGORY_TOP_VALUES = 5;
/** Structure-digest caps that keep profile.json bounded. */
export declare const MAX_STRUCTURE_ENTRIES = 24;
/**
 * Document content budget in code points; must stay under the preset's 8192 prune threshold.
 * Truncated arrays are reported in `omitted`, never silently dropped.
 */
export declare const MAX_DOCUMENT_CHARS = 6000;
/** Presentation rows are capped: charts are bounded rendering, not a general analysis channel. */
export declare const MAX_PRESENTATION_ROWS = 200000;
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
export type DatasetShape = 'array' | 'envelope_item' | 'document' | 'none';
export interface DatasetInspection extends DatasetRef {
    query_access: {
        /** true = host can read it and produce facts (rows queryable; documents profile-only). */
        readable: boolean;
        shape: DatasetShape;
        reason?: string;
    };
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
export type ProfileObservedType = 'missing' | 'null' | 'boolean' | 'integer' | 'number' | 'string' | 'object' | 'array' | 'mixed';
export type ProfileContractType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'json';
export interface ProfileColumn {
    contract_type: ProfileContractType | null;
    inferred_type: ProfileObservedType;
    observed_types: Partial<Record<ProfileObservedType, number>>;
    missing_count: number;
    null_count: number;
    non_null_count: number;
    invalid_count: number;
    nullable: boolean;
    contract_nullable?: boolean;
    required?: boolean;
    allow_numeric_string?: boolean;
    numeric_string_count?: number;
}
export interface ProfileValidationViolation {
    column: string;
    rule: 'required' | 'nullable' | 'type';
    expected: string | boolean;
    observed: string;
    invalid_count: number;
    severity: 'error' | 'warning';
}
export interface ProfileValidation {
    status: 'pass' | 'fail';
    violations: ProfileValidationViolation[];
}
/**
 * Profile turns raw rows into facts the model can safely cite: per-column type/missing counts,
 * statistics, category values, time facts and bounded structure digests. Time facts carry
 * first/last row values because min/max alone get narrated as a trend.
 */
export interface ProfileStatistic {
    count?: number;
    sum?: number | null;
    min?: number | null;
    max?: number | null;
    mean?: number | null;
    p25?: number | null;
    p50?: number | null;
    p75?: number | null;
}
export interface ProfileCategoryValue {
    value: string;
    count: number;
}
export interface ProfileCategory {
    distinct_count: number | null;
    top_values: ProfileCategoryValue[];
    truncated: boolean;
}
/**
 * Time-axis semantics: value format plus the offset observed in the column itself. Never guessed;
 * an undecidable axis is reported as `unknown`.
 */
export interface ProfileTimeAxis {
    column: string;
    value_format: 'epoch_ms' | 'date_string' | 'unknown';
    time_zone?: string;
    utc_offset?: string;
    aligned_to?: 'local_midnight' | 'calendar_day' | 'unknown';
}
/** A ready-to-use window: calendar range plus the real query bounds for this column. */
export interface ProfileTimeWindow {
    name: string;
    start_date: string;
    end_date: string;
    value_ge: number | string;
    value_le: number | string;
    /** Real first/last date present in the Dataset; a non-trading start moves to the next session. */
    data_from: string | null;
    data_to: string | null;
}
export interface ProfileTimeFacts {
    time_column: string;
    ordered_ascending: boolean | null;
    covered_from: unknown;
    covered_to: unknown;
    covered_from_iso?: string;
    covered_to_iso?: string;
    axis: ProfileTimeAxis;
    windows?: ProfileTimeWindow[];
    first: Record<string, unknown>;
    last: Record<string, unknown>;
}
export interface ProfileStructureField {
    name: string;
    type: string;
}
export interface ProfileStructure {
    type: 'array' | 'object';
    occurrences: number;
    total_elements?: number;
    /** Present only when sampling capped the scan; it is not the complete count. */
    sampled_elements?: number;
    empty_count: number;
    min_length: number;
    max_length: number;
    fields: ProfileStructureField[];
}
export interface ProfilePayload {
    row_count: number;
    columns: string[];
    quality: {
        missing_values: number;
        duplicate_rows: number;
        time_ordered: boolean | null;
    };
    statistics?: Record<string, ProfileStatistic>;
    categories?: Record<string, ProfileCategory>;
    time_facts?: ProfileTimeFacts;
    structure?: Record<string, ProfileStructure>;
    schema?: Record<string, ProfileColumn>;
    validation?: ProfileValidation;
    warnings: string[];
}
export type DatasetStoreErrorCode = 'workspace_not_writable' | 'session_unavailable' | 'session_cwd_unavailable' | 'sandbox_policy_unavailable' | 'filesystem_unavailable' | 'dataset_write_failed' | 'dataset_id_invalid' | 'dataset_not_found' | 'dataset_expired' | 'dataset_session_mismatch' | 'dataset_manifest_invalid' | 'dataset_format_unsupported' | 'dataset_not_row_readable' | 'dataset_too_large' | 'profile_invalid' | 'profile_too_large' | 'profile_dataset_mismatch' | 'workspace_path_invalid' | 'workspace_file_invalid';
export declare class DatasetStoreError extends Error {
    readonly code: DatasetStoreErrorCode;
    constructor(code: DatasetStoreErrorCode, detail: string);
}
export interface SessionLike {
    readonly id: string;
    readonly header?: {
        readonly cwd?: string;
        readonly parentSession?: string;
        readonly origin?: 'subagent';
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
    /**
     * Raw bytes for external parsers (local PDF/images). The host enforces maxBytes on this seam:
     * overflow throws FS_TOO_LARGE and never returns truncated content.
     */
    readBytes?(target: FsTargetLike, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
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
export interface QueryDatasetInput {
    session: SessionLike;
    dataset_id: string;
    query: QuerySpec;
    signal?: AbortSignal;
}
/** Time-axis probe shared by date normalization, dataset time windows and error hints. */
export interface TimeAxisSnapshot {
    dataset_id: string;
    columns: string[];
    axis: ProfileTimeAxis;
    /** Probe dates (ascending, deduplicated); used to clamp windows to real trading days. */
    dates: string[];
}
export interface ProfileDatasetResult extends ProfileRef {
    row_count: number;
    columns: string[];
    quality: ProfilePayload['quality'];
    statistics?: ProfilePayload['statistics'];
    categories?: ProfilePayload['categories'];
    time_facts?: ProfilePayload['time_facts'];
    structure?: ProfilePayload['structure'];
    schema?: ProfilePayload['schema'];
    validation?: ProfilePayload['validation'];
    warnings: string[];
    /** Document Datasets only: bounded content, never persisted with the profile. */
    document?: ProfileDocument;
}
export interface ProfileDocument {
    content: unknown;
    truncated: boolean;
    /** Every truncation is disclosed here; no silent omission. */
    omitted: Array<{
        path: string;
        kept: number;
        omitted: number;
    }>;
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
    /** Host-only row key for envelope-shaped json_rows data. */
    row_key?: string;
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
/**
 * Validate a workspace-relative path shape. Containment is proven separately by resolveContained;
 * both checks are required, and this one only makes errors readable.
 */
export declare function normalizeWorkspaceRelativePath(value: string): string;
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
    profileDataset(input: ProfileDatasetInput): Promise<ProfileDatasetResult>;
    queryDataset(input: QueryDatasetInput): Promise<QueryResult>;
    /**
     * Read-only time-axis probe shared by the date normalizer and dataset time-window mode.
     * Samples at most MAX_AXIS_PROBE_ROWS rows, so it is cheap enough to call per query.
     */
    describeTimeAxis(input: {
        session: SessionLike;
        dataset_id: string;
        time_column?: string;
        signal?: AbortSignal;
    }): Promise<TimeAxisSnapshot | undefined>;
    writeProfile(input: WriteProfileInput): Promise<ProfileRef>;
    /**
     * Host-internal presentation read (charts). The returned rows must never enter any agent message,
     * tool result or model context; this is the only path that hands raw rows outside the store.
     * Session scope follows the parent session, so the main agent can present a child's Datasets.
     */
    readPresentationRows(input: {
        session: SessionLike;
        dataset_id: string;
        signal?: AbortSignal;
        maxRows?: number;
    }): Promise<{
        ref: DatasetRef;
        rows: unknown[];
    }>;
    /**
     * Host-internal workspace text read; with readWorkspaceBytes it shares containment and size
     * gates via workspaceFileTarget.
     */
    readWorkspaceText(input: {
        session: SessionLike;
        path: string;
        signal?: AbortSignal;
        maxBytes?: number;
    }): Promise<string>;
    /**
     * Host-internal raw-byte read (local PDF/images). maxBytes is mandatory and fails loudly; never
     * fall back to readText, which would corrupt binary data.
     */
    readWorkspaceBytes(input: {
        session: SessionLike;
        path: string;
        signal?: AbortSignal;
        maxBytes: number;
    }): Promise<Uint8Array>;
    private workspaceFileTarget;
    readWorkspaceJson(input: {
        session: SessionLike;
        path: string;
        signal?: AbortSignal;
    }): Promise<unknown>;
    /**
     * Host-internal artifact write (charts, OCR): same sandbox and containment checks as Datasets,
     * createIfAbsent by default. `overwrite` exists only for content-addressed reruns.
     * Returns a relative path (agent-visible) and an absolute one (host-only).
     */
    writeWorkspaceFiles(input: {
        session: SessionLike;
        dir: string;
        files: Array<{
            name: string;
            content: string;
        }>;
        signal?: AbortSignal;
        overwrite?: boolean;
    }): Promise<Array<{
        name: string;
        path: string;
        absolutePath: string;
    }>>;
    private requireRef;
    private requireStoredRef;
    /** Read raw Dataset: rows (array/envelope) are queryable, documents are profile-only. Shape is
     * decided from file content, not the manifest's coarse `format`. */
    private readRaw;
    private resolveContained;
    private assertContained;
    private writeContext;
    private readRoot;
    private mapWriteError;
}
/** present=false distinguishes a missing column from an explicit null. */
export interface ProfileCell {
    present: boolean;
    value: unknown;
}
export declare function provideWorkspaceDatasetStore(ctx: import('@deepseek-ai/cordis').Context, options?: WorkspaceDatasetStoreOptions): WorkspaceDatasetStore;
declare module '@deepseek-ai/cordis' {
    interface Context {
        datasetStore: WorkspaceDatasetStore;
    }
}
