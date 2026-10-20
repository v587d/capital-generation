import { type QuerySpec } from './query.js';
import type { SessionLike, TimeAxisSnapshot } from './store.js';
/**
 * Query-time normalization: the single implementation shared by query_dataset and
 * describe_dataset.queries. Every entry point executing a QuerySpec must call it; an entry that
 * skips it gives date strings a different meaning in the same turn.
 */
/**
 * Translate date-like filter values into this Dataset's time-axis bounds and add `*_iso` result
 * columns. Date strings against a numeric time column fail loudly; a skipped filter would look
 * like a successful full-table result.
 */
export declare function normalizeQueryDates(input: {
    store: TimeAxisProbe;
    session: SessionLike;
    dataset_id: string;
    query: QuerySpec;
    time_column?: string;
    signal?: AbortSignal;
}): Promise<{
    query: QuerySpec;
    axis?: {
        column: string;
        time_zone?: string;
    };
}>;
export interface TimeAxisProbe {
    describeTimeAxis(input: {
        session: unknown;
        dataset_id: string;
        time_column?: string;
        signal?: AbortSignal;
    }): Promise<TimeAxisSnapshot | undefined>;
}
/** Add `*_iso` columns without replacing originals; skip an existing column to avoid collisions. */
export declare function withIsoTimeColumns(result: Record<string, unknown>, axis: {
    column: string;
    time_zone?: string;
}): void;
