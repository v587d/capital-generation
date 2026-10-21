/**
 * `tools/chart-render` row: render_chart only. Row-level expression of "only the
 * visualization specialist holds the chart pipeline"; shares token/artifact state with
 * `tools/chart-source`. No chartEvents here: delivery is the root Agent's final-turn
 * `present_charts` step, so the card never lands in a folded process turn.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "capital-chart-render-tools";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
