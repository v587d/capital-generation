/**
 * `tools/time` row: get_local_datetime + resolve_data_time_range. Every mode that needs
 * time mounts it; date normalization has one implementation, and Dataset boundaries are
 * enforced by `tool-exec` identity checks, not by row composition.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "capital-time-tools";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
