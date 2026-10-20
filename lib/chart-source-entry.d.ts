/**
 * `tools/chart-source` row: prepare_chart_source. The token store must be the same
 * instance used by `tools/chart-render`; separate stores make `render_chart` always
 * report `chart_source_expired` without throwing. Prefer the host-plane runtime, fall
 * back to the root-keyed module cache.
 */
import type { Context } from '@deepseek-ai/cordis';
import { type CapitalShared } from './runtime.js';
export declare const name = "capital-chart-source-tools";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
/** Host row first, root-keyed module cache as fallback (monolith carriers). */
export declare function capitalSharedRuntimeOf(ctx: Context): CapitalShared;
