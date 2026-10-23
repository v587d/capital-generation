/**
 * Removes redundant `subagent-settled` notices at the closing frame; otherwise the host loop opens
 * another step after a complete answer and folds it. Only children with an admitted relay are
 * dropped — a silent child may carry its only outcome in the notice.
 * Rationale: docs/dev/chart-delivery-events.md §6.3.
 */
import type { SessionLike } from '../data-collector/store.js';
export interface WakeMessageLike {
    readonly id?: string;
    readonly source?: {
        readonly kind?: string;
        readonly senderSessionId?: string;
    };
}
interface InboxLike {
    readonly nextTurn?: readonly unknown[];
    readonly nextStep?: readonly unknown[];
    remove?(messageId: string): boolean;
}
export interface WakeAgentLike {
    readonly session?: SessionLike;
    readonly inbox?: InboxLike;
}
export interface SettledWakeGuard {
    /** `user/message` events: human resets the exchange, an admitted child relay marks that child. */
    acceptUserMessage(session: SessionLike, source: {
        kind?: string;
        senderSessionId?: string;
    }): void;
    /** Terminal assistant-stream frame: the closing answer is being written. */
    acceptClosing(agent: WakeAgentLike | undefined): void;
    /** A notice inserted after the closing frame must not wake a new step. */
    acceptInboxInserted(agent: WakeAgentLike | undefined, message: WakeMessageLike | undefined): void;
    /** A fresh activation invalidates the previous exchange's relay marker. */
    acceptSubagentStart(info: {
        id?: string;
    }): void;
    /** Diagnostics/tests. */
    closing(): boolean;
    admitted(): readonly string[];
}
export declare function createSettledWakeGuard(): SettledWakeGuard;
export {};
