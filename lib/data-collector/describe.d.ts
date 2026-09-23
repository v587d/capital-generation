import { type DatasetInspection, type ProfileDatasetResult, type SessionLike, type WorkspaceDatasetStore } from './store.js';
import { type QueryResult, type QuerySpec } from './query.js';
/**
 * `describe_dataset`：把「inspect_dataset → profile_dataset →（可选）query_dataset」三次调用
 * 合成**一次**（每份 Dataset 一次），供 data_junior 使用。
 *
 * 设计要点（完整理由见 docs/design/describe-dataset-design.md）：
 *
 * 1. **一次调用只处理一个 dataset**。多个 dataset 由模型在**同一条 assistant 消息**里发多个
 *    调用完成——工具声明了 `isConcurrencySafe`，框架会把它们放进并发池，N 份结果在同一个
 *    下一步一起返回。因此**不需要**把 N 份结果合并成一个超长载荷，也就不需要任何
 *    digest / 公平份额 / 裁剪阶梯：单份结果的体积与今天"inspect + profile 两次结果之和"同量级。
 * 2. **形状分支由宿主做**：document 型 Dataset 直接跳过 queries，不再依赖模型先 inspect 再判断。
 * 3. **唯一的体积闸门** {@link SAFE_RESULT_CHARS}：序列化后超过它就不返回超长载荷，改返回
 *    一个小回执（含全部列名与 profile_ref），让模型用 `columns_of_interest` 收窄后重发。
 *    把"剪枝器静默截断"变成"响亮且可操作的重试"，而不是在宿主里做内容改写。
 * 4. **不碰读权限**：一切仍走 store 的受控方法，原始 rows 不进任何 Agent 上下文。
 */
/**
 * 单份结果的码点上限。preset 的工具结果剪枝阈值是 8192（head 4096 + tail 1024，按码点），
 * 这里取 7000 留出余量：超过 8192 会被剪掉中间段，而"被剪"与"被本闸门拦下"的区别是
 * **后者会让模型知道发生了什么并给出重试办法**。
 */
export declare const SAFE_RESULT_CHARS = 7000;
/** 单次调用的 queries 条数上限：防的是请求体积，不是结果体积（结果另有闸门）。 */
export declare const MAX_DESCRIBE_QUERIES = 8;
export interface DescribeRequest {
    dataset_id: string;
    task_id?: string;
    time_column?: string;
    primary_key?: string;
    /** 只对这些列返回 statistics / categories / schema；省略即全量。 */
    columns_of_interest?: string[];
    /** 受控 QuerySpec 列表；`dataset_id` 由管线补成当前 dataset。 */
    queries: QuerySpec[];
}
export interface DescribeQueryOutcome {
    index: number;
    result?: QueryResult;
    error?: {
        code: string;
        detail: string;
    };
}
export interface DescribeResult {
    status: 'ok';
    dataset_id: string;
    task_id: string | null;
    session_id: string;
    artifact_ref: string;
    format: string;
    capability: string;
    source_label: string;
    row_count: number;
    captured_at: number;
    retention_until: number;
    params_digest: string;
    query_access: DatasetInspection['query_access'];
    profile_id: string;
    profile_ref: string;
    columns: string[];
    quality: ProfileDatasetResult['quality'];
    statistics?: ProfileDatasetResult['statistics'];
    categories?: ProfileDatasetResult['categories'];
    time_facts?: ProfileDatasetResult['time_facts'];
    structure?: ProfileDatasetResult['structure'];
    document?: ProfileDatasetResult['document'];
    schema?: ProfileDatasetResult['schema'];
    validation?: ProfileDatasetResult['validation'];
    warnings: string[];
    queries: DescribeQueryOutcome[];
}
export interface DescribeTooLarge {
    status: 'too_large';
    dataset_id: string;
    profile_ref: string;
    shape: DatasetInspection['query_access']['shape'];
    columns: string[];
    bytes: number;
    hint: string;
}
export type DescribeOutput = DescribeResult | DescribeTooLarge;
/**
 * 工具边界归一化：宽容解析（字符串化的 JSON 数组/对象、单个对象、envelope 形态），
 * 引擎侧保持严格。与 `query_dataset` 的 `normalizeQueryArgs` 共用同一套解析原语
 * （src/data-collector/args.ts），避免两个工具的宽容度漂移。
 */
export declare function normalizeDescribeArgs(args: Record<string, unknown>): DescribeRequest;
export interface DescribeDatasetInput {
    store: WorkspaceDatasetStore;
    session: SessionLike;
    request: DescribeRequest;
    signal?: AbortSignal;
}
/**
 * 单份 Dataset 的完整管线。失败一律抛错（`isError`）：单 dataset 调用里没有"部分成功"，
 * 把失败做成成功信封会让会话日志无法区分（见 docs/design/tool-result-error-signal.md）。
 */
export declare function describeDataset(input: DescribeDatasetInput): Promise<DescribeOutput>;
