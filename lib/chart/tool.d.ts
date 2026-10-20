/** render_chart: render data into workspace artifacts and return only a small receipt.
 * Series costs zero model tokens and rows stay host-side; numeric conclusions still go through
 * data_junior. */
import type { Context } from '@deepseek-ai/cordis';
import { WorkspaceDatasetStore } from '../data-collector/store.js';
import { type ChartSourceTokenStore } from './source-token.js';
import { ChartArtifactRegistry } from './artifact-ref.js';
import { type ChartEventPublisher } from './events.js';
type AgentExecutionLike = {
    session?: {
        id?: string;
        header?: {
            cwd?: string;
            parentSession?: string;
        };
    };
};
type ToolExecLike = {
    agent?: AgentExecutionLike;
    signal: AbortSignal;
};
export declare const CHART_ARTIFACT_DIR = "capital-analysis/charts";
/** Receipt is small metadata only; series never appears here. */
export interface ChartReceipt {
    chart_ref: string;
    chart_id: string;
    kind: string;
    axis: 'time' | 'index';
    title: string;
    points: number;
    original_points: number;
    downsampled: boolean;
    series_labels: string[];
    has_volume: boolean;
    markers: number;
    dataset_id: string | null;
    source_label: string | null;
    captured_at: number | null;
    chart_url: string | null;
    spec_path: string;
    series_path: string;
    html_path: string;
    warnings: string[];
}
export interface ChartPublisher {
    publish(input: {
        chartId: string;
        filePath: string;
    }): string | null;
}
export interface RenderChartInput {
    store: WorkspaceDatasetStore;
    sourceTokens?: ChartSourceTokenStore;
    artifacts?: ChartArtifactRegistry;
    /** Resolve per render, not at apply: host rows may mount later; absence degrades to chart_url=null. */
    charts?: () => ChartPublisher | undefined;
    /** Same lazy rule: an absent publisher skips only the deliverable row. */
    chartEvents?: () => ChartEventPublisher | undefined;
    now?: () => number;
}
export declare function renderChart(input: RenderChartInput, args: Record<string, unknown>, exec: ToolExecLike): Promise<ChartReceipt>;
export declare function registerChartTool(ctx: Context, options: RenderChartInput): void;
export {};
