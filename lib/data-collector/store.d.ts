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
/**
 * 呈现层（图表）一次性读取行集的上限。超过就拒绝，而不是把几百 MB 拉进宿主内存：
 * 图表是**有界呈现**，不是通用分析通道。
 */
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
/**
 * 时间轴的**语义**（形态 + 该列自身观测到的时区偏移）。
 *
 * 存在的理由：`date_ms` 这类列的取值是 epoch 毫秒，模型既无法直接读出"这是哪一天"，
 * 也无法把"近 1 个月"翻译回毫秒；没有这一块事实，它只能自己推算——实测单步
 * 41,961 字符的思考里绝大部分是时间戳算术（真机会话 1e44050e）。
 * 块内只放**观测到的**事实，不做猜测：推断不出就报 `unknown`。
 */
export interface ProfileTimeAxis {
    column: string;
    value_format: 'epoch_ms' | 'date_string' | 'unknown';
    /** 该列的取值按哪个时区解释（epoch_ms 且能推断时才有）。 */
    time_zone?: string;
    /** 上面的时区的 `+08:00` 形态；`time_zone` 已是 `UTC+08:00` 时不重复（避免同一事实写两遍）。 */
    utc_offset?: string;
    /** 取值对齐到当地午夜、日历日，还是无法判断。 */
    aligned_to?: 'local_midnight' | 'calendar_day' | 'unknown';
}
/** 一个可直接使用的分析窗口：日历区间 + 该列里真正的查询边界。 */
export interface ProfileTimeWindow {
    name: string;
    start_date: string;
    end_date: string;
    /** `>= value_ge` 即"从这个窗口的第一天开始"（epoch 轴为当地午夜）。 */
    value_ge: number | string;
    /** `<= value_le` 即"到这个窗口的最后一天结束"。 */
    value_le: number | string;
    /** 该窗口在 Dataset 里**真实存在**的首末日期；起点落在非交易日时这里是下一个交易日。 */
    data_from: string | null;
    data_to: string | null;
}
export interface ProfileTimeFacts {
    time_column: string;
    /** 文件顺序是否随时间递增；null = 时间列有缺失，无法判断。 */
    ordered_ascending: boolean | null;
    /** 时间列的最小/最大值（覆盖范围），原值不改写。 */
    covered_from: unknown;
    covered_to: unknown;
    /** 覆盖范围的人类可读日期；只对 epoch_ms 轴出现（date_string 轴本身可读）。 */
    covered_from_iso?: string;
    covered_to_iso?: string;
    /** 时间轴语义：形态与时区偏移。 */
    axis: ProfileTimeAxis;
    /** 常用窗口（近 1 月 / 近 3 月 / 近 1 年 / 年初至今）的现成边界。 */
    windows?: ProfileTimeWindow[];
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
/**
 * 时间轴探针结果：形态 + 已出现的日期 + 列清单。
 *
 * 三条消费路径共用同一份事实，避免"谁猜时间列"出现第二套判据：
 * ① `query_dataset` 的日期筛选归一；② `resolve_data_time_range` 的数据集模式；
 * ③ 报错信息里列出可选列。
 */
export interface TimeAxisSnapshot {
    dataset_id: string;
    columns: string[];
    axis: ProfileTimeAxis;
    /** 探针看到的日期（升序、去重）；用于把窗口夹到真实存在的交易日。 */
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
/**
 * 规范化并校验 workspace **相对**路径。
 *
 * 拒绝：空串、绝对路径（含 Windows 盘符）、任何 `..` 段、反斜杠（本仓统一 `/`）。
 * 这里只做形态校验；真正的沙箱归属由 `resolveContained` 证明。两道关卡都要过——
 * 形态校验是为了给出可读错误，归属校验才是安全边界。
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
     * 时间轴只读探针（`query_dataset` 的日期归一边界与 `resolve_data_time_range` 的数据集模式共用）。
     *
     * 只读前 {@link MAX_AXIS_PROBE_ROWS} 行推断形态与偏移：时间列一定在每行都出现，日线数据
     * 的有序性也让前若干行足以定出粒度；这样这个探针**可以随查询逐次调用**，
     * 代价与"读一份 16MB raw.json 只为一个问题"不同量级。
     */
    describeTimeAxis(input: {
        session: SessionLike;
        dataset_id: string;
        time_column?: string;
        signal?: AbortSignal;
    }): Promise<TimeAxisSnapshot | undefined>;
    writeProfile(input: WriteProfileInput): Promise<ProfileRef>;
    /**
     * 宿主内部**呈现层**读取有界行集（图表用）。
     *
     * 契约（不可违反）：
     *  - 返回值**不得**进入任何 Agent 消息、工具结果或模型上下文；调用方只能在宿主进程内
     *    把它变成有界可视化载荷（见 src/chart/series.ts）。
     *  - 这是唯一一处把原始 rows 交给 store 之外代码的入口，因此命名、文档与调用点都必须是
     *    "呈现"语义。需要数值结论一律走 profile_dataset / query_dataset。
     *  - session 作用域与 profile/query 同源（`sessionScopeFor` 取父会话），所以主 Agent
     *    用自己会话即可读到自己子 Agent 采到的 Dataset。
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
     * 宿主内部呈现层读取 workspace 内的 JSON 文件（用户本地数据直接可视化的入口）。
     *
     * 只接受 workspace **相对**路径：绝对路径、`..` 段与反斜杠一律拒绝，随后仍走
     * `resolveContained` 做沙箱归属校验——两道关卡都要过。
     */
    readWorkspaceJson(input: {
        session: SessionLike;
        path: string;
        signal?: AbortSignal;
    }): Promise<unknown>;
    /**
     * 宿主内部**产物层**把一组文本文件写进 workspace 的一个子目录（图表产物用）。
     *
     * 走与 Dataset 落盘完全相同的沙箱策略与归属校验；`createIfAbsent` 保证不会静默覆盖
     * 已有产物（图表 id 唯一，重复即 bug，应当响亮失败）。
     *
     * 返回值同时给出**相对路径**（可以进 Agent 消息、可以 present 给用户）与**绝对路径**
     * （只供宿主内部使用，例如登记给 host 平面的取数路由）。这个区分是本仓的数据纪律：
     * 绝对路径不出宿主进程。
     */
    writeWorkspaceFiles(input: {
        session: SessionLike;
        dir: string;
        files: Array<{
            name: string;
            content: string;
        }>;
        signal?: AbortSignal;
    }): Promise<Array<{
        name: string;
        path: string;
        absolutePath: string;
    }>>;
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
/** 行内取列值：`present=false` 表示该列在这行不存在（缺失），与显式 null 区分开。 */
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
