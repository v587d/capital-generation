import { type DatasetInspection, type ProfileDatasetResult, type SessionLike, type WorkspaceDatasetStore } from './store.js';
import { type QueryResult, type QuerySpec } from './query.js';
/**
 * `describe_dataset`: inspect + profile + optional query in one call per Dataset. A single size gate
 * (SAFE_RESULT_CHARS) returns a small retryable receipt instead of letting the pruner truncate.
 */
/** Cap below the preset's 8192 prune threshold: overflow is loud and retryable instead of silently clipped. */
export declare const SAFE_RESULT_CHARS = 7000;
/** Request-size cap, not a result-size cap. */
export declare const MAX_DESCRIBE_QUERIES = 8;
export interface DescribeRequest {
    dataset_id: string;
    task_id?: string;
    time_column?: string;
    primary_key?: string;
    /** Restrict statistics/categories/schema to these columns; omitted means all. */
    columns_of_interest?: string[];
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
    /** Size attribution: codepoints of facts vs queries, so the hint can name the bigger side. */
    facts_bytes: number;
    queries_bytes: number;
    hint: string;
}
export type DescribeOutput = DescribeResult | DescribeTooLarge;
/** Lenient boundary parsing, sharing primitives with query_dataset so both tools accept the same shapes. */
export declare function normalizeDescribeArgs(args: Record<string, unknown>): DescribeRequest;
export interface DescribeDatasetInput {
    store: WorkspaceDatasetStore;
    session: SessionLike;
    request: DescribeRequest;
    signal?: AbortSignal;
}
/** Fail loudly on any error: a single-dataset call has no partial success. */
export declare function describeDataset(input: DescribeDatasetInput): Promise<DescribeOutput>;
