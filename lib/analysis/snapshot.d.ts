import { type DatasetRef, type ProfilePayload, type ProfileRef, type SessionLike } from '../data-collector/store.js';
import { type AnalysisFileWriter } from './storage.js';
import { type AnalysisSnapshot, type DatasetRefLike, type EvidenceItem, type ProfileRefLike } from './types.js';
/** Narrow seam over the Dataset store: staging only needs these two host-internal reads. */
export interface AnalysisInputReader {
    readPresentationRows(input: {
        session: SessionLike;
        dataset_id: string;
        signal?: AbortSignal;
        maxRows?: number;
    }): Promise<{
        ref: DatasetRef;
        rows: unknown[];
        envelope?: Record<string, unknown>;
    }>;
    readProfile(input: {
        session: SessionLike;
        profile_id: string;
        signal?: AbortSignal;
    }): Promise<{
        ref: ProfileRef;
        profile: ProfilePayload;
    }>;
}
export interface CreateSnapshotInput {
    readonly task_id: string;
    readonly question: string;
    readonly instrument?: string;
    readonly purpose: AnalysisSnapshot['purpose'];
    readonly horizon?: string;
    readonly depth: AnalysisSnapshot['depth'];
    readonly as_of: string;
    readonly data_cutoff?: string;
    readonly dataset_refs: readonly DatasetRefLike[];
    readonly profile_refs: readonly ProfileRefLike[];
    readonly evidence: readonly EvidenceItem[];
    readonly prior_analysis_refs: readonly string[];
    readonly constraints: Readonly<Record<string, unknown>>;
}
export interface SnapshotRecord extends AnalysisSnapshot {
    /** Host-only absolute paths handed to the worker; never returned to the model. */
    readonly paths: {
        readonly dir: string;
        readonly inputs_dir: string;
    };
    readonly datasets: readonly StagedDataset[];
    readonly profiles: readonly {
        readonly ref: ProfileRef;
    }[];
}
/** What the worker sees through `context.read_dataset` (docs/dev/senior-analysis.md §1.9). */
export interface StagedDataset {
    readonly shape: 'rows' | 'document';
    readonly columns: ReadonlyArray<{
        readonly name: string;
        readonly type: string;
        readonly nullable: boolean;
    }>;
    readonly row_count: number;
    readonly rows: readonly unknown[];
    readonly envelope: Readonly<Record<string, unknown>> | null;
    readonly time_axis: {
        readonly column: string;
        readonly unit: string;
        readonly tz: string;
    } | null;
    readonly truncated: boolean;
    readonly source: {
        readonly dataset_id: string;
        readonly captured_at: number;
        readonly params_digest: string;
    };
}
/** Deterministic JSON: key order must not change a fingerprint. */
export declare function stableStringify(value: unknown): string;
/**
 * Create the snapshot and stage its inputs.
 *
 * Any ref that cannot be read fails the whole call and names the object: a snapshot that silently
 * drops an input is worse than no snapshot, because every downstream number looks sourced.
 */
export declare function createSnapshot(options: {
    reader: AnalysisInputReader;
    writer: AnalysisFileWriter;
    session: SessionLike;
    input: CreateSnapshotInput;
    signal?: AbortSignal;
    now?: number;
}): Promise<{
    record: SnapshotRecord;
    ref: string;
}>;
/** Load a snapshot by ref and fail loudly when it is missing or expired. */
export declare function loadSnapshot(options: {
    reader: AnalysisFileWriter;
    session: SessionLike;
    analysisId: string;
    signal?: AbortSignal;
    now?: number;
}): Promise<SnapshotRecord>;
/** Coverage summary returned to the model: counts and ranges only, never rows. */
export declare function snapshotCoverage(record: SnapshotRecord): Record<string, unknown>;
