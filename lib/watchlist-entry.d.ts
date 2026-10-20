/**
 * `tools/watchlist` row: get_watchlist. User assets live in host storage-domain and only
 * the main Agent mounts this row. Resolve the domain per call: memoizing an unready
 * `storageDomain` as `store_unavailable` disables it for the whole process.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "capital-watchlist-tools";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
