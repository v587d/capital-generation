/**
 * `tools/present` row: present_charts only. The root Agent's final-turn delivery step — the
 * auto-mode chart pipeline returns refs upward and the main Agent redeems them here right before
 * writing the closing answer (rationale: docs/dev/chart-delivery-events.md §6.3).
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "capital-present-tools";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
