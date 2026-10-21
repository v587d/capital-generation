/**
 * present_charts: the root Agent's final-turn delivery step.
 *
 * render_chart only mints a chart_ref (the specialist row no longer auto-delivers). DSH's
 * deliverable card replays only declarations recorded before the closing assistant message, so
 * the card has to be written by the turn that carries the final answer: the root Agent presents
 * its collected refs/deliverables here immediately before writing that answer. Never a custom
 * event type — the session-event vocabulary is closed (see events.ts).
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ChartArtifactRegistry } from './artifact-ref.js';
import { type ChartEventPublisher } from './events.js';
export interface PresentChartsInput {
    artifacts: ChartArtifactRegistry;
    /** Lazy: the host projection may mount after this row; an absent publisher fails the call loudly. */
    chartEvents: () => ChartEventPublisher | undefined;
}
export interface PresentChartsReceipt {
    presented: Array<{
        chart_ref: string;
        title: string;
    }>;
    failed: Array<{
        chart_ref: string;
        reason: string;
    }>;
}
export declare function registerPresentChartsTool(ctx: Context, input: PresentChartsInput): void;
