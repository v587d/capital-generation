/**
 * `tools/dataset-read` row: describe / inspect / profile / query_dataset.
 * Each row builds its own store (no shared memory state; a shared hub would collide).
 * Raw rows never leave these tools — only summaries, structure and controlled aggregates.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "capital-dataset-read-tools";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
