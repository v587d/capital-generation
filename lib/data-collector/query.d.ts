export declare const MAX_QUERY_FILTERS = 32;
export declare const MAX_QUERY_GROUP_BY = 16;
export declare const MAX_QUERY_AGGREGATES = 16;
export declare const MAX_QUERY_SELECT = 32;
export declare const MAX_QUERY_ORDER_BY = 16;
export declare const MAX_QUERY_LIMIT = 200;
export declare const DEFAULT_QUERY_LIMIT = 100;
export declare const MAX_QUERY_GROUPS = 1000;
export declare const MAX_QUERY_OUTPUT_BYTES: number;
export declare const MAX_QUERY_SPEC_BYTES: number;
export type QueryErrorPolicy = 'strict' | 'skip_with_warning';
export type QueryOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'is_null' | 'not_null';
export type QueryAggregateFunction = 'count' | 'min' | 'max' | 'avg' | 'sum';
export type QueryOrderDirection = 'asc' | 'desc';
export interface QueryFilter {
    column: string;
    operator: QueryOperator;
    value?: unknown;
}
export interface QueryAggregate {
    function: QueryAggregateFunction;
    column?: string;
    as: string;
}
export interface QueryOrderBy {
    column: string;
    direction: QueryOrderDirection;
}
export interface QuerySpec {
    dataset_id: string;
    select?: string[];
    filters?: QueryFilter[];
    group_by?: string[];
    aggregates?: QueryAggregate[];
    order_by?: QueryOrderBy[];
    limit?: number;
    error_policy?: QueryErrorPolicy;
}
export interface QueryResult {
    dataset_id: string;
    columns: string[];
    rows: Array<Record<string, unknown>>;
    matched_row_count: number;
    group_count: number;
    returned_count: number;
    limit: number;
    warnings: string[];
}
export type QueryErrorCode = 'query_spec_invalid' | 'query_column_not_found' | 'query_type_conflict' | 'query_group_limit_exceeded' | 'query_result_too_large' | 'query_rows_invalid';
export declare class DatasetQueryError extends Error {
    readonly code: QueryErrorCode;
    constructor(code: QueryErrorCode, detail: string);
}
export declare class JsonRowsQueryEngine {
    execute(rows: unknown[], schema: unknown, input: unknown): QueryResult;
}
export declare function executeJsonRowsQuery(rows: unknown[], schema: unknown, query: unknown): QueryResult;
