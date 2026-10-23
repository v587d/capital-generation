/**
 * Chart delivery at the closing answer.
 *
 * DSH's deliverable card only replays `deliverables/presented` events whose seq is before the
 * turn's closing assistant message, and a turn is final only after the fact. The one place that is
 * provably before the closing message is the assistant stream's terminal `finish` chunk: the loop
 * appends the message after the stream ends. So delivery is deferred to that chunk, gated on the
 * root session being idle (no actionable inbox input, no running direct children), which is exactly
 * the shape of a closing turn. Waiting/aborted/tool-call responses never flush.
 *
 * `subagent-settled` notices are not actionable input: they can arrive while the closing answer is
 * already streaming. Counting them as pending would strand a card that the model has just selected,
 * because the follow-up step often has nothing new to say.
 */
import type { ChartArtifactRegistry } from './artifact-ref.js';
import type { ChartTurnEventInput } from './events.js';
import type { SessionLike } from '../data-collector/store.js';
/** Structural subset of `@deepseek-ai/dsh-llm` AssistantStreamFrame. */
export interface AssistantStreamFrameLike {
    readonly type?: string;
    readonly attemptId?: string;
    readonly turn?: number;
    readonly chunk?: {
        readonly type?: string;
        readonly reason?: {
            readonly kind?: string;
        };
        readonly blockType?: string;
        readonly block?: {
            readonly type?: string;
        };
    };
}
interface InboxStateLike {
    'next-turn'?: readonly unknown[];
    'next-step'?: readonly unknown[];
}
export interface ChartDeliveryOptions {
    artifacts: ChartArtifactRegistry;
    /** Writes one first-party deliverables/presented batch; must be synchronous (pre-message seq). */
    publish: (sessionId: string, inputs: ChartTurnEventInput[]) => boolean;
    /** Durable pending input; synchronous projection read. Absent means "cannot tell" → proceed. */
    inboxOf?: (session: SessionLike) => InboxStateLike | undefined;
    /** Bounded batch; the card collapses past four files and expands on demand. */
    maxCharts?: number;
}
export interface ChartDelivery {
    /** `present_charts` selection; merged across calls because models often retry in batches. */
    request(session: SessionLike, inputs: ChartTurnEventInput[]): void;
    acceptStream(session: SessionLike | undefined, frame: AssistantStreamFrameLike): void;
    /** A new human message starts a new exchange: old charts must not ride into it. */
    acceptUserMessage(sessionId: string, time: number): void;
    acceptSubagentStart(info: {
        id?: string;
    }): void;
    acceptSubagentEnd(info: {
        id?: string;
    }): void;
    /** False until any stream frame was observed: callers fall back to immediate delivery. */
    streaming(): boolean;
    /** Diagnostics/tests: explicitly selected inputs for the current exchange. */
    pending(sessionId?: string): number;
}
export declare const DEFAULT_MAX_DELIVERED_CHARTS = 32;
export declare function createChartDelivery(options: ChartDeliveryOptions): ChartDelivery;
export {};
