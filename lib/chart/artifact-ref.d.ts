import type { SessionLike } from '../data-collector/store.js';
/**
 * Subagent children carry `origin: 'subagent'`; a user fork/branch root also has `parentSession`
 * (seed lineage) and must stay its own scope. One hop: the token lets a nested child reuse its owner.
 */
export declare function chartSessionScopeId(session: SessionLike): string;
export interface ChartArtifactRef {
    chart_ref: string;
    chart_id: string;
    task_id: string | null;
    dataset_id: string | null;
    source_label: string | null;
    captured_at: number | null;
    kind: string;
    axis: 'time' | 'index';
    title: string;
    chart_url: string | null;
    spec_path: string;
    series_path: string;
    html_path: string;
    created_at: number;
    expires_at: number;
}
export interface ChartArtifactRegistryOptions {
    now?: () => number;
    retentionMs?: number;
    newRef?: () => string;
}
/**
 * In-process chart_ref capabilities: session/task/workspace binding and the deliverable owner
 * scope. Process restart invalidates them; chart.html remains the offline fallback.
 */
export declare class ChartArtifactRegistry {
    private readonly records;
    private readonly now;
    private readonly retentionMs;
    private readonly newRef;
    constructor(options?: ChartArtifactRegistryOptions);
    private purgeExpired;
    issue(input: {
        session: SessionLike;
        chart_id: string;
        task_id?: string | null;
        dataset_id?: string | null;
        source_label?: string | null;
        captured_at?: number | null;
        kind: string;
        axis: 'time' | 'index';
        title: string;
        chart_url: string | null;
        spec_path: string;
        series_path: string;
        html_path: string;
        created_at?: number;
        expires_at?: number;
    }): ChartArtifactRef;
    resolve(input: {
        session: SessionLike;
        chart_ref: string;
        task_id?: string | null;
    }): ChartArtifactRef;
    revoke(chartRef: string): boolean;
    /** Charts of one session scope, for the model's final-turn delivery step; newest last. */
    list(input: {
        session: SessionLike;
        task_id?: string | null;
    }): ChartArtifactRef[];
    size(): number;
    private publicRecord;
}
