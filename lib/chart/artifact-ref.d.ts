import type { SessionLike } from '../data-collector/store.js';
/** Dataset/profile 的一跳 scope 规则；token 让 nested child 复用这个 owner scope。 */
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
 * In-process registry for chart_ref capabilities.
 *
 * The chart files live in the workspace, while this registry keeps the
 * session/task binding that makes a chart safe to present to its own session
 * (and to derive the `deliverables/presented` owner scope).
 * Process restart invalidates chart_ref capabilities; chart.html remains the
 * explicit offline fallback.
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
    size(): number;
    private publicRecord;
}
