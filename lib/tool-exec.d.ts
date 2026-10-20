import { type SessionLike } from './data-collector/store.js';
/**
 * The single source of truth for caller identity and tool authorization.
 *
 * Only the framework shape `exec.agent.session` is accepted; no `exec.session` fallback,
 * so tests cannot bypass the real shape again.
 *
 * Authorization is by preset, not by session topology: a root session manually opened with
 * a role preset must be allowed, while the main Agent (`capital-generation`) stays denied.
 * Raw rows are protected by tool return shapes, not by this gate.
 *
 * When identity cannot be confirmed (registry unavailable or no preset), fall back to the
 * legacy parentSession check. That fallback must never be wider than the old behavior.
 */
export interface AgentExecutionLike {
    agent?: {
        session?: {
            id?: string;
            header?: {
                cwd?: string;
                parentSession?: string;
            };
        };
        ctx?: unknown;
    };
    signal: AbortSignal;
}
/** Return the caller session; fail loudly when the framework shape is missing. */
export declare function callerSession(exec: AgentExecutionLike): SessionLike;
/** Result of {@link authorizeToolSession}; never throws so each domain keeps its own error. */
export interface ToolSessionDecision {
    readonly session: SessionLike;
    readonly allowed: boolean;
    /** `preset` = resolved identity; `topology` = legacy fallback when the registry is unavailable. */
    readonly via: 'preset' | 'topology';
    /** Matched preset id; undefined when `via === 'topology'`. */
    readonly presetId?: string;
}
/**
 * Decide whether this session may use a preset-restricted tool.
 *
 * Does not throw: callers own their error codes and messages. The only side effect is
 * recording the decision in a bounded ring buffer for diagnostics.
 */
export declare function authorizeToolSession(pluginCtx: unknown, exec: AgentExecutionLike, toolName: string, allowedPresetIds: readonly string[]): ToolSessionDecision;
/**
 * Data-side gate: decide and throw `dataset_session_mismatch` when denied.
 *
 * Messages are model guidance: name the current preset on preset mismatch, or tell a role
 * agent to ask its caller instead of switching tools.
 */
export declare function authorizedSession(pluginCtx: unknown, exec: AgentExecutionLike, toolName: string, allowedPresetIds: readonly string[]): SessionLike;
/** Bounded recent authorization decisions, exposed through `dc_status.session_identity`. */
export interface SessionAuthRecord {
    readonly tool: string;
    readonly via: 'preset' | 'topology';
    readonly presetId: string | null;
    readonly allowed: boolean;
}
/** Recent decisions as a shallow copy (JSON-safe for model output). */
export declare function sessionIdentityDecisions(): SessionAuthRecord[];
/** Test-only: clear records between cases. */
export declare function resetSessionIdentityDecisions(): void;
