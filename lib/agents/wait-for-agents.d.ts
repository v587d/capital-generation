/**
 * Root-only `wait_for_agents`: hold one turn across child relays; returns on the first relay, on
 * the tree settling, or after 30s. `waitForChildren` has no abort parameter; the slice races it.
 * Host contract: docs/reference/dsh-surface-ledger.md L36.
 */
import type { Context } from '@deepseek-ai/cordis';
export interface WaitInboxLike {
    readonly nextTurn?: readonly unknown[];
    readonly nextStep?: readonly unknown[];
}
export interface WaitAgentLike {
    readonly session?: {
        readonly id?: string;
        readonly header?: {
            readonly parentSession?: string;
            readonly origin?: 'subagent';
        };
    };
    readonly inbox?: WaitInboxLike;
    readonly status?: 'idle' | 'running';
}
export interface WaitDescendantLike {
    readonly kind?: string;
    readonly id?: string;
    readonly label?: string;
    readonly activity?: string;
}
export interface WaitSubagentsLike {
    waitForChildren(parent: WaitAgentLike): Promise<boolean>;
    listDescendants?(rootSessionId: string, signal?: AbortSignal): Promise<readonly WaitDescendantLike[]>;
}
interface AgentsLike {
    get?(id: string): {
        readonly status?: 'idle' | 'running';
    } | undefined;
}
interface EventContextLike {
    on?(event: string, listener: (...args: unknown[]) => void): unknown;
}
export interface WaitForAgentsOptions {
    /** Bounded slice; the model cannot extend it. */
    readonly waitSliceMs?: number;
    readonly now?: () => number;
}
export interface WaitForAgentsDeps extends WaitForAgentsOptions {
    subagents: () => WaitSubagentsLike | undefined;
    events?: EventContextLike;
    agents?: () => AgentsLike | undefined;
}
export type WaitForAgentsStatus = 'all_settled' | 'message' | 'user_input' | 'timeout';
export interface WaitForAgentsReceipt {
    readonly status: WaitForAgentsStatus;
    readonly waited_ms: number;
    readonly pending_messages: number;
    readonly running: Array<{
        readonly id: string;
        readonly label?: string;
    }>;
    readonly hint: string;
}
declare function render(_args: unknown, value: unknown): Array<{
    type: 'text';
    text: string;
}>;
export declare function waitForAgentsToolDefinition(deps: WaitForAgentsDeps): {
    name: string;
    description: string;
    parameters: object;
    output: {
        schema: object;
        render: typeof render;
    };
    execute(_args: Record<string, unknown>, exec: {
        signal: AbortSignal;
        agent?: WaitAgentLike;
    }): Promise<WaitForAgentsReceipt>;
};
export declare function registerWaitForAgentsTool(ctx: Context, options?: WaitForAgentsOptions): void;
export {};
