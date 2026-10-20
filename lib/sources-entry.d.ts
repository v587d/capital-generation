/**
 * `tools/retrieve-sources` row: the nine named-source tools, gated by
 * `localFetch.enabled`. When disabled they stay registered and fail loudly per call;
 * unregistering at boot would freeze one config read for the process lifetime.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "capital-retrieve-sources-tools";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
