/**
 * Role tool surfaces by mounted role preset. `toolFilter` was removed upstream, so tools come
 * from family rows (composition) and there is no allow-list here. Restricting the agent scope
 * filters preset contributions; identity is the preset id, not root/child. Listeners on `ctx.root`.
 */
import type { AgentLike, GuardedExecution, PolicyContext } from './root-tool-policy.js';
import { type RolePresetId } from '../preset-ids.js';
export { ROLE_PRESET_IDS, ROLE_PRESET_ID_LIST, type RolePresetId } from '../preset-ids.js';
/** Welded to `send_message` by `tool-subagent-control`; no host switch, so leaf roles deny it by name. */
export declare const SIBLING_DENIED_TOOLS: readonly ["interrupt_agent"];
/** Residual surface; no allow list: family rows define the tool surface. */
export interface RoleSurface {
    /** Sibling names welded into a needed row that this persona must not have. */
    readonly denySiblings?: readonly string[];
}
/** Leaf roles need `send_message`, so they inherit the welded `interrupt_agent`; specialist
 * and analyst mount no control row. Tolerant per-name deny records misses without failing open. */
export declare const ROLE_TOOL_SURFACES: Record<RolePresetId, RoleSurface>;
/** Role preset id only, undefined for root and other presets; failure means "do not converge". */
export declare function rolePresetIdOf(ctx: PolicyContext, agent: AgentLike | undefined): RolePresetId | undefined;
export interface RolePolicyProbe extends Omit<RolePolicyResult, 'outcome'> {
    agentId: string | undefined;
    presetId: string;
    /** True = manually opened root with a role preset, false = delegated child; the paths converge differently. */
    root: boolean;
    /** Created-time restrict result, or a call-level guard denial. */
    outcome: 'restricted' | 'unavailable' | 'guard-denied';
}
export interface RolePolicyResult {
    outcome: 'restricted' | 'unavailable';
    denied: string[];
    /** Names invisible here and skipped harmlessly (their row is not mounted). */
    failed: string[];
}
export declare function rolePolicyProbes(): RolePolicyProbe[];
/** Test-only: clears records and the dedupe table. */
export declare function resetRolePolicyProbes(): void;
/** Tolerant per-name deny: invisible names are recorded, never thrown; called on agent creation. */
export declare function restrictRoleAgentTools(agent: AgentLike | undefined, surface: RoleSurface): RolePolicyResult;
/** Call-level residual guard: created-time restrict misses manually opened role modes, so
 * read identity per call. Fail open unless a role preset is confirmed. */
export declare function roleSiblingGuardReasonFor(ctx: PolicyContext): (exec: GuardedExecution | undefined) => string | undefined;
/** Installs the sibling guard globally once. */
export declare function registerRoleSiblingGuard(ctx: PolicyContext): void;
/** Dedupes by session id: `apply()` runs once per mounted role preset and duplicate probes would flood the readout. */
export declare function registerRoleToolPolicy(ctx: PolicyContext): void;
