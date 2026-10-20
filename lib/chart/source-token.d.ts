import type { Context } from '@deepseek-ai/cordis';
import { type SessionLike, WorkspaceDatasetStore } from '../data-collector/store.js';
/** Host-only; never serialized into agent output. Keep the live Session: sandbox policies call
 * session.snapshotEvents() to resolve workspace permissions. */
export interface ChartSourceTokenRef {
    chart_source_ref: string;
    dataset_id: string;
    task_id: string;
    expires_at: number;
}
interface ChartSourceTokenRecord extends ChartSourceTokenRef {
    /** The direct data-agent session that can already read the Dataset scope. */
    sourceSession: SessionLike;
    issued_at: number;
}
export interface ChartSourceTokenStoreOptions {
    now?: () => number;
    ttlMs?: number;
    newToken?: () => string;
}
/** Short-lived capability tokens for nested visualization children. Possession is the capability;
 * the token never becomes a filesystem path or raw rows. */
export declare class ChartSourceTokenStore {
    private readonly tokens;
    private readonly now;
    private readonly ttlMs;
    private readonly newToken;
    constructor(options?: ChartSourceTokenStoreOptions);
    private purgeExpired;
    issue(input: {
        store: WorkspaceDatasetStore;
        session: SessionLike;
        dataset_id: string;
        task_id?: string;
        signal?: AbortSignal;
    }): Promise<ChartSourceTokenRef>;
    resolve(input: {
        chart_source_ref: string;
        task_id?: string;
        session?: SessionLike;
        now?: number;
    }): ChartSourceTokenRecord;
    revoke(chartSourceRef: string): boolean;
    size(): number;
}
/** Preset-based authorization; see authorizedChartSession. */
export declare function registerChartSourceTool(ctx: Context, options: {
    store: WorkspaceDatasetStore;
    tokens: ChartSourceTokenStore;
}): void;
export declare function chartSourceTokenForRender(tokens: ChartSourceTokenStore | undefined, args: Record<string, unknown>, session?: SessionLike): {
    dataset_id: string;
    task_id: string;
    sourceSession: SessionLike;
} | undefined;
export {};
