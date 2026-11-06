/**
 * Chart delivery at the closing answer.
 *
 * DSH's deliverable card replays `deliverables/presented` from the closing turn (0.2.2 dropped the
 * `file.seq < owner.seq` filter, so late declarations are no longer lost). A turn is still final
 * only after the fact, and the one place where that is knowable before the turn closes is the
 * assistant stream's terminal `finish` chunk: the loop appends the message after the stream ends.
 * So delivery is deferred to that chunk, gated on the root session being idle (no actionable inbox
 * input, no running direct children), which is exactly the shape of a closing turn.
 * Waiting/aborted/tool-call responses never flush.
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
/** Live root Agent passed to the closing hook so it can cancel inbox notices before the loop claims them. */
export interface DeliveryAgentLike {
    readonly session?: SessionLike;
    readonly inbox?: {
        readonly nextTurn?: readonly unknown[];
        readonly nextStep?: readonly unknown[];
        remove?(messageId: string): boolean;
    };
}
interface InboxStateLike {
    'next-turn'?: readonly unknown[];
    'next-step'?: readonly unknown[];
}
export interface ChartDeliveryOptions {
    artifacts: ChartArtifactRegistry;
    /** Writes one first-party deliverables/presented batch; must be synchronous (listener runs before the message commits). */
    publish: (sessionId: string, inputs: ChartTurnEventInput[]) => boolean;
    /** Durable pending input; synchronous projection read. Absent means "cannot tell" → proceed. */
    inboxOf?: (session: SessionLike) => InboxStateLike | undefined;
    /**
     * Runs on every closing finish, including exchanges with no chart. The wake guard removes
     * redundant settlement notices here; it must never be allowed to block delivery.
     */
    onClosing?: (session: SessionLike, agent: DeliveryAgentLike | undefined, turn: number | undefined) => void;
    /** Bounded batch; the card collapses past four files and expands on demand. */
    maxCharts?: number;
}
export interface ChartDelivery {
    /** `present_charts` selection; merged across calls because models often retry in batches. */
    request(session: SessionLike, inputs: ChartTurnEventInput[]): void;
    acceptStream(session: SessionLike | undefined, frame: AssistantStreamFrameLike, agent?: DeliveryAgentLike): void;
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
