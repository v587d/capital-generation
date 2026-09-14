import { type QueryResult, type QuerySpec } from './query.js';
/**
 * Phase 1/2 workspace-local Dataset store（设计约定见 AGENTS.md「数据布局」）。
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
export declare const MAX_PROFILE_BYTES: number;
/** 类别事实：最多跟踪多少个不同取值；超过则 distinct_count 记 null 并标记 truncated。 */
export declare const MAX_CATEGORY_DISTINCT = 2000;
/** `top_values` 只展示前 N 个高频取值，其余由 truncated 显式披露。 */
export declare const MAX_CATEGORY_TOP_VALUES = 5;
/** 结构摘要：路径条目上限与递归深度上限，保证 profile 体积有界。 */
export declare const MAX_STRUCTURE_ENTRIES = 24;
/**
 * 文档型 Dataset（顶层对象、没有行数组，如财务指标 / 回测结果）交给 data_junior 的
 * 内容预算（Unicode 码点数）。取值必须留在 preset 的工具结果剪枝阈值（8192）以内：
 * 超过就会被剪掉中间段，而不是被完整读到。长数组按下面的档位逐级截断，截断了什么
 * 一律写进 `omitted`，不做静默省略。
 */
export declare const MAX_DOCUMENT_CHARS = 6000;
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
        /** true = 宿主可读取并产出事实（rows 可 query，document 只能 profile）。 */
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
 * Profile 的职责：把「原始行」翻译成模型可以安全引用的事实。
 *
 * 除了逐列的类型与缺失统计（Phase 1），Phase 2 起补齐四类事实，它们对应
 * Fuyao 数据里最常见的四类问题：
 * - `statistics` 加 `count` / `sum`：回答「合计多少、覆盖多少条」；
 * - `categories`：字符串列的 distinct 与高频取值，回答「有哪些类别、分布如何」；
 * - `time_facts`：时间列的覆盖范围 + 首行/末行的数值，回答「最新值、区间涨跌」——
 *   只报 min/max 会被模型讲成「先涨到最高再回落」，这是实测过的失真来源；
 * - `structure`：单元格里的数组/对象展开成有界路径摘要，回答「里面有几层、
 *   多少个叶子」，避免只报一句「这一格是 object」。
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
    /** 精确去重数；超过枚举上限时为 null（此时 truncated=true）。 */
    distinct_count: number | null;
    top_values: ProfileCategoryValue[];
    /** true = 还有未展示的取值，`top_values` 不是全部。 */
    truncated: boolean;
}
export interface ProfileTimeFacts {
    time_column: string;
    /** 文件顺序是否随时间递增；null = 时间列有缺失，无法判断。 */
    ordered_ascending: boolean | null;
    /** 时间列的最小/最大值（覆盖范围），原值不改写。 */
    covered_from: unknown;
    covered_to: unknown;
    /** 首行与末行的「时间列 + 数值列」取值（文件顺序），用于首末值与区间变化。 */
    first: Record<string, unknown>;
    last: Record<string, unknown>;
}
export interface ProfileStructureField {
    name: string;
    type: string;
}
export interface ProfileStructure {
    type: 'array' | 'object';
    /** 该路径在数据中出现的次数（行内多次出现会累加）。 */
    occurrences: number;
    /** 未抽样时，所有出现位置的元素总数；对象路径不返回该字段。 */
    total_elements?: number;
    /** 该路径受上限影响时，实际检查到的元素/对象数量；存在时不代表完整数量。 */
    sampled_elements?: number;
    /** 数组：空数组的出现次数与长度极值。 */
    empty_count: number;
    min_length: number;
    max_length: number;
    /** 对象：直接字段名与观察到的类型（有界）。 */
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
export type DatasetStoreErrorCode = 'workspace_not_writable' | 'session_unavailable' | 'session_cwd_unavailable' | 'sandbox_policy_unavailable' | 'filesystem_unavailable' | 'dataset_write_failed' | 'dataset_id_invalid' | 'dataset_not_found' | 'dataset_expired' | 'dataset_session_mismatch' | 'dataset_manifest_invalid' | 'dataset_format_unsupported' | 'dataset_not_row_readable' | 'dataset_too_large' | 'profile_invalid' | 'profile_too_large' | 'profile_dataset_mismatch';
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
export interface QueryDatasetInput {
    session: SessionLike;
    dataset_id: string;
    query: QuerySpec;
    signal?: AbortSignal;
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
    /** 仅文档型 Dataset：有界内容，不随 profile 持久化。 */
    document?: ProfileDocument;
}
export interface ProfileDocument {
    /** 有界后的文档内容；连最小档位都放不下时为 null。 */
    content: unknown;
    truncated: boolean;
    /** 被截断的数组路径与省略条数，逐个披露，不做静默省略。 */
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
    /** Host-only row array key for envelope-shaped json_rows data. */
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
    writeProfile(input: WriteProfileInput): Promise<ProfileRef>;
    private requireRef;
    private requireStoredRef;
    /**
     * 读取原始 Dataset。返回两种形状之一：
     * - `rows`：顶层数组或 manifest 声明的行数组键，可 profile、可 query；
     * - `document`：顶层对象且没有行数组（财务指标、回测结果这类），可 profile
     *   （宿主算结构摘要 + 有界内容），不可 query。
     * 判定放在读取时而不是复用 manifest 的 `format`：`format` 只记录写入时的粗略
     * 形状，真正的形状以文件内容为准。
     */
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
