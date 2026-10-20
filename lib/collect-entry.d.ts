/**
 * `tools/collect` row: request_data / list_capabilities / describe_capability /
 * dc_status backed by hub + 128 sources. The preset isolates hub/store to this row;
 * time tools live in `tools/time`.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "capital-collect-tools";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
