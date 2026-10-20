/**
 * Lenient parameter parsing at the Dataset tool boundary: models often send stringified JSON.
 * Shared by query_dataset and describe_dataset so both accept exactly the same shapes.
 */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function parseJsonContainer(value: unknown): unknown;
/** Accept a real array, a JSON array string, or a single column name. */
export declare function coerceNameList(value: unknown): unknown;
export declare function coerceObjectList(value: unknown): unknown;
export declare function coerceLimit(value: unknown): unknown;
export declare const QUERY_NAME_LIST_FIELDS: readonly ["select", "group_by"];
export declare const QUERY_OBJECT_LIST_FIELDS: readonly ["filters", "aggregates", "order_by"];
/** Coerce QuerySpec array/object fields and limit to engine types; leave other fields untouched. */
export declare function coerceQueryShape(input: Record<string, unknown>): Record<string, unknown>;
/** Reject an invalid dataset_id at the tool boundary; never pass it to the store. */
export declare function readDatasetId(value: unknown): string;
export declare function readOptionalTaskId(value: unknown): string | undefined;
export declare function readOptionalString(value: unknown): string | undefined;
/** columns_of_interest: accept array/JSON/single name; a wrong shape fails loudly rather than silently widening results. */
export declare function readOptionalColumnList(value: unknown): string[] | undefined;
