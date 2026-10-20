import type { Context } from '@deepseek-ai/cordis';
import type { DataTimeContract } from '../time/tools.js';
import type { DatasetRef, SaveDatasetInput, SessionLike } from './store.js';
/** Normalize an internal data_key token; data_key is host-only and never model-visible. */
export declare function normalizeKeyToken(value: string): string;
export declare function buildDataKey(provider: string, kind: string, resource: string): string;
/** capability is the model-visible unique key; session is injected by the tool layer, not supplied by the model. */
export interface DataRequest {
    capability: string;
    params: Record<string, unknown>;
    /** force_refresh bypasses manifest reuse and creates a new immutable Dataset. */
    force_refresh?: boolean;
    task_id?: string;
    session: SessionLike;
}
/** capability is the unique registration key; name/source/data_key stay host-internal (logs, routing, audit). */
export interface SchemaDescriptor {
    capability: string;
    name: string;
    source: string;
    data_key: string;
    source_label?: string;
    paginated?: boolean;
    /** Longest reusable Dataset age; defaults to the retention window. Host-only. */
    cacheMaxAgeMs?: number;
    /** Where the row array lives; without it, envelopes such as `stock_items` look unreadable. */
    rowShape?: RowShapeHint;
    /** One-line catalog summary (~50 chars max). */
    summary?: string;
    /** Full detail for describe_capability only (units, null semantics, time/pagination rules). */
    description?: string;
    input_schema: object;
    /** Machine-readable time-parameter contract shared with the time tools. */
    time_contract?: DataTimeContract;
    output_schema?: object;
}
/** Catalog entry: just enough to pick a capability. */
export interface CapabilitySummary {
    capability: string;
    summary: string;
    paginated: boolean;
}
/** Full contract for one capability; must be read before calling. */
export interface CapabilityDetail extends CapabilitySummary {
    description: string;
    input_schema: object;
    output_fields: string | null;
}
export interface DataSource {
    schema: SchemaDescriptor;
    execute(request: DataRequest, signal: AbortSignal): Promise<{
        data: unknown;
        schema?: object | null;
    }>;
    /** Optional source guard; false rejects the result before persistence. */
    validateOutput?: (data: unknown) => boolean;
    /**
     * Optional canonicalization; the Hub calls it before merge key and params_digest, so equivalent
     * requests share one Dataset. Must be idempotent (execute calls it again) and may throw.
     */
    normalizeParams?: (params: Record<string, unknown>) => Record<string, unknown>;
}
export interface DatasetStoreLike {
    save(input: SaveDatasetInput): Promise<DatasetRef>;
    findLatest?(input: {
        session: SessionLike;
        capability: string;
        params_digest: string;
        signal?: AbortSignal;
    }): Promise<DatasetRef | undefined>;
}
export interface RowShapeHint {
    /** Top-level key holding rows (default `item`). */
    rowKey?: string;
    /** Multiple row paths; `[]` expands and merges them into one row set. */
    rowKeys?: string[];
    /** The top level is itself the row array. */
    rootArray?: boolean;
}
export interface DataCollectorHubOptions {
    /** Required Dataset store; request fails without it. */
    store: DatasetStoreLike;
    /** Queue length (default 50). */
    maxQueueLength?: number;
    /** Transport timeout only (30s default), not data lifetime. */
    requestTimeoutMs?: number;
    now?: () => number;
}
/**
 * FIFO executor: success is persisted immediately as an immutable Dataset and only a DatasetRef is
 * returned. In-flight queue is the only in-memory raw data; reuse comes from workspace manifests.
 */
export declare class DataCollectorHub {
    private readonly queue;
    private active;
    private readonly sources;
    private readonly cacheLookups;
    private readonly store;
    private running;
    private readonly maxQueueLength;
    private readonly requestTimeoutMs;
    private readonly now;
    constructor(options: DataCollectorHubOptions);
    registerSource(source: DataSource): () => void;
    /**
     * Enqueue and wait: reuse a valid manifest unless force_refresh; identical in-flight requests share
     * one execution. Params are normalized before merge key and digest.
     */
    request(request: DataRequest, options?: {
        signal?: AbortSignal;
    }): Promise<DatasetRef>;
    private normalizeRequest;
    private awaitSettlement;
    private settleWaiter;
    /** Catalog: capability, one-line summary, paginated only. Full schemas would be pruned; details come from describeCapability. */
    listCapabilities(): CapabilitySummary[];
    capabilityNames(): string[];
    /** Model-visible catalog: one `capability|summary|paginated` line each; JSON costs about twice the tokens. */
    capabilityDirectory(): string;
    /** Single capability contract; undefined for unknown names (the tool layer classifies it). */
    describeCapability(capability: string): CapabilityDetail | undefined;
    private processNext;
}
export declare function provideDataCollectorHub(ctx: Context, options: DataCollectorHubOptions): DataCollectorHub;
declare module '@deepseek-ai/cordis' {
    interface Context {
        dataCollectorHub: DataCollectorHub;
    }
}
