/**
 * `tools/orchestration` row: the root-only `wait_for_agents` tool.
 *
 * Leaves don't mount this row: a child has no delegated tree to wait for and must use send_message
 * to report upward. The tool also rejects the subagent origin at call time, so a mis-mounted row
 * cannot turn into a child-side polling loop.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "capital-orchestration-tools";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
