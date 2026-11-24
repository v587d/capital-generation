/**
 * `tools/analysis` row: the senior analyst's analysis family (snapshot / module run / submit).
 *
 * A family row, not a host row — the role preset mounts it and `src/tool-exec.ts` authorizes the
 * caller by preset identity. The store is built per mount (same rule as the dataset-read row).
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "capital-analysis-tools";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
