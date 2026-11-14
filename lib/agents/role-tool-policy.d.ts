/**
 * Role tool surfaces by mounted role preset. Family rows define scoped tools; host-global tools
 * are intersected with an explicit allow-list so a new dsh-base tool cannot leak into a leaf.
 * Identity is the preset id, not root/child. Listeners live on `ctx.root`.
 */
import type { AgentLike, GuardedExecution, PolicyContext } from './root-tool-policy.js';
import { type RolePresetId } from '../preset-ids.js';
export { ROLE_PRESET_IDS, ROLE_PRESET_ID_LIST, type RolePresetId } from '../preset-ids.js';
/** Registered together with `send_message` by `tool-subagent-control`; no host switch, so leaf roles deny these by name.
 * 0.2.2 moved `list_agents` into the same main entry, so the welded set grew from one to two names. */
export declare const SIBLING_DENIED_TOOLS: readonly ["interrupt_agent", "list_agents"];
/** Full intended surface; only names that resolve as host-global are enforced by the allow-list.
 * Scoped family-row tools stay visible regardless; they must remain in this list for review. */
export declare const COLLECTOR_ROLE_TOOLS: readonly ["send_message", "skill", "get_local_datetime", "resolve_data_time_range", "request_data", "list_capabilities", "describe_capability", "dc_status"];
export declare const RETRIEVER_ROLE_TOOLS: readonly ["send_message", "skill", "get_local_datetime", "resolve_data_time_range", "anysearch_search", "web_retriever_fetch", "wind_docs_announcements", "wind_docs_news", "cls_telegraph", "wscn_lives", "cninfo_irm", "cninfo_announcements", "sseinfo_qa", "eastmoney_724", "eastmoney_stock_news", "eastmoney_reports", "eastmoney_announcements", "eastmoney_announcement_body", "sina_reports", "ths_eps_forecast", "ocr", "anysearch_batch_search", "anysearch_capabilities"];
export declare const SPECIALIST_ROLE_TOOLS: readonly ["get_local_datetime", "resolve_data_time_range", "skill", "render_chart"];
/** Host-global allow-list plus residual per-name denies. */
export interface RoleSurface {
    /** Intended tools; the host-global subset is enforced as `restrict({ allow })`. */
    readonly allowTools?: readonly string[];
    /** Sibling names welded into a needed row that this persona must not have. */
    readonly denySiblings?: readonly string[];
    /** Host-global Team tools; denied on every Capital role because the rows stay mounted. */
    readonly denyTeam?: readonly string[];
}
/** Leaf roles need `send_message`, so they inherit the welded `interrupt_agent` / `list_agents`.
 * Junior runs only through PTC (run_code is reserved and cannot be named by restrict), so its
 * surface is already narrowed by the executor and no allow-list is applied. */
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
    /** Global tools kept by the allow-list; omitted when the surface has no allow-list. */
    allowedGlobals?: string[];
    /** Global tools hidden by the allow-list; omitted when the surface has no allow-list. */
    removedGlobals?: string[];
    /** True when the allow-list could not be applied (no definitions view or restrict rejected it). */
    allowFailed?: boolean;
}
export declare function rolePolicyProbes(): RolePolicyProbe[];
/** Test-only: clears records and the dedupe table. */
export declare function resetRolePolicyProbes(): void;
/** Tolerant deny plus host-global allow-list: invisible names are recorded, never thrown. */
export declare function restrictRoleAgentTools(agent: AgentLike | undefined, surface: RoleSurface): RolePolicyResult;
/** Call-level residual guard: created-time restrict misses manually opened role modes, so
 * read identity per call. Fail open unless a role preset is confirmed. */
export declare function roleSiblingGuardReasonFor(ctx: PolicyContext): (exec: GuardedExecution | undefined) => string | undefined;
/** Installs the sibling guard globally once. */
export declare function registerRoleSiblingGuard(ctx: PolicyContext): void;
/** Dedupes by session id: `apply()` runs once per mounted role preset and duplicate probes would flood the readout. */
export declare function registerRoleToolPolicy(ctx: PolicyContext): void;
