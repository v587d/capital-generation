/**
 * `tools/present` row: present_charts + the closing-answer delivery listener.
 *
 * The model only records which charts belong to the answer. The actual first-party
 * `deliverables/presented` append happens in the terminal assistant-stream chunk, before the closing
 * message commits, gated on an idle root (no actionable inbox input, no running direct children). That is the only
 * point where "the final answer" is knowable, so early/no `present_charts` calls cannot strand the
 * card in a folded process turn (rationale: docs/dev/chart-delivery-events.md §6.3).
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionLike } from './data-collector/store.js';
export declare const name = "capital-present-tools";
export declare const inject: string[];
/**
 * Fallback only: when the stream listener never fires, immediate delivery still has to avoid a
 * pending turn. The normal path defers to the closing stream chunk and does not consult this.
 */
export declare function chartDeliveryBlocker(ctx: Context, session: SessionLike): Promise<string | undefined>;
export declare function apply(ctx: Context): void;
