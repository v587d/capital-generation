/**
 * Role tool surfaces by mounted role preset. Family rows define scoped tools; host-global tools
 * are intersected with an explicit allow-list so a new dsh-base tool cannot leak into a leaf.
 * Identity is the preset id, not root/child. Listeners live on `ctx.root`.
 */
import { isRootAgent, OCR_TOOL_NAME, recordGuardDecision, RETRIEVAL_DENIED_TOOLS, TEAM_DENIED_TOOLS } from './root-tool-policy.js';
import { readPresetClaim } from '../preset-claim.js';
import { ROLE_PRESET_ID_LIST, ROLE_PRESET_IDS } from '../preset-ids.js';
export { ROLE_PRESET_IDS, ROLE_PRESET_ID_LIST } from '../preset-ids.js';
/** Registered together with `send_message` by `tool-subagent-control`; no host switch, so leaf roles deny these by name.
 * 0.2.2 moved `list_agents` into the same main entry, so the welded set grew from one to two names. */
export const SIBLING_DENIED_TOOLS = ['interrupt_agent', 'list_agents'];
/** Shared leaf capabilities that are host-global in rc.2, not preset-scoped. */
const ROLE_MESSAGING_TOOLS = ['send_message', 'skill'];
const ROLE_TIME_TOOLS = ['get_local_datetime', 'resolve_data_time_range'];
/** Full intended surface; only names that resolve as host-global are enforced by the allow-list.
 * Scoped family-row tools stay visible regardless; they must remain in this list for review. */
export const COLLECTOR_ROLE_TOOLS = [
    ...ROLE_MESSAGING_TOOLS, ...ROLE_TIME_TOOLS,
    'request_data', 'list_capabilities', 'describe_capability', 'dc_status',
];
export const RETRIEVER_ROLE_TOOLS = [
    ...ROLE_MESSAGING_TOOLS, ...ROLE_TIME_TOOLS, ...RETRIEVAL_DENIED_TOOLS,
    OCR_TOOL_NAME, 'anysearch_batch_search', 'anysearch_capabilities',
];
export const SPECIALIST_ROLE_TOOLS = [
    ...ROLE_TIME_TOOLS, 'skill', 'render_chart',
];
/** Every role denies Team tools. Only control-row roles also deny the welded sibling names. */
const DENY_TEAM = { denyTeam: TEAM_DENIED_TOOLS };
/** Leaf roles need `send_message`, so they inherit the welded `interrupt_agent` / `list_agents`.
 * Junior runs only through PTC (run_code is reserved and cannot be named by restrict), so its
 * surface is already narrowed by the executor and no allow-list is applied. */
export const ROLE_TOOL_SURFACES = {
    [ROLE_PRESET_IDS.collector]: { allowTools: COLLECTOR_ROLE_TOOLS, denySiblings: SIBLING_DENIED_TOOLS, ...DENY_TEAM },
    [ROLE_PRESET_IDS.junior]: { denySiblings: SIBLING_DENIED_TOOLS, ...DENY_TEAM },
    [ROLE_PRESET_IDS.retriever]: { allowTools: RETRIEVER_ROLE_TOOLS, denySiblings: SIBLING_DENIED_TOOLS, ...DENY_TEAM },
    [ROLE_PRESET_IDS.specialist]: { allowTools: SPECIALIST_ROLE_TOOLS, ...DENY_TEAM },
    [ROLE_PRESET_IDS.analyst]: { denySiblings: SIBLING_DENIED_TOOLS, ...DENY_TEAM },
};
/** Role preset id only, undefined for root and other presets; failure means "do not converge". */
export function rolePresetIdOf(ctx, agent) {
    const claim = readPresetClaim(ctx, agent).claim;
    return claim !== undefined && ROLE_PRESET_ID_LIST.includes(claim) ? claim : undefined;
}
const probes = [];
const MAX_PROBES = 12;
/** Session ids already converged: `apply()` runs once per mounted role preset. */
const handled = new Set();
/** One listener set when both host policy and this plugin mount. */
const installedRoots = new WeakSet();
/** Call-level guard installs independently of the listener. */
const installedGuardRoots = new WeakSet();
export function rolePolicyProbes() {
    return probes.map((probe) => ({
        ...probe,
        denied: [...probe.denied],
        failed: [...probe.failed],
        ...(probe.allowedGlobals === undefined ? {} : { allowedGlobals: [...probe.allowedGlobals] }),
        ...(probe.removedGlobals === undefined ? {} : { removedGlobals: [...probe.removedGlobals] }),
    }));
}
/** Test-only: clears records and the dedupe table. */
export function resetRolePolicyProbes() {
    probes.length = 0;
    handled.clear();
}
/** Tolerant deny plus host-global allow-list: invisible names are recorded, never thrown. */
export function restrictRoleAgentTools(agent, surface) {
    const denied = [];
    const failed = [];
    let tools;
    try {
        tools = agent?.ctx?.tools;
    }
    catch {
        return { outcome: 'unavailable', denied, failed };
    }
    if (tools === undefined || typeof tools.restrict !== 'function') {
        return { outcome: 'unavailable', denied, failed };
    }
    let allowedGlobals;
    let removedGlobals;
    let allowFailed = false;
    if (surface.allowTools !== undefined) {
        try {
            const restrictable = tools.view?.(agent)?.restrictableNames;
            if (restrictable === undefined) {
                // Without the pre-restriction view we cannot tell inherited tools from the role's own
                // scoped rows; an allow-list built from the global view would hide send_message.
                allowFailed = true;
            }
            else {
                const names = new Set(restrictable);
                allowedGlobals = [...new Set(surface.allowTools)].filter((name) => names.has(name)).sort();
                removedGlobals = [...names].filter((name) => !allowedGlobals.includes(name)).sort();
                if (names.size > 0)
                    tools.restrict({ allow: allowedGlobals });
            }
        }
        catch {
            allowFailed = true;
        }
    }
    for (const name of [...(surface.denySiblings ?? []), ...(surface.denyTeam ?? [])]) {
        try {
            tools.restrict({ deny: [name] });
            denied.push(name);
        }
        catch {
            failed.push(name);
        }
    }
    return {
        outcome: 'restricted',
        denied,
        failed,
        ...(allowedGlobals === undefined ? {} : { allowedGlobals }),
        ...(removedGlobals === undefined ? {} : { removedGlobals }),
        ...(allowFailed ? { allowFailed } : {}),
    };
}
/** Call-level residual guard: created-time restrict misses manually opened role modes, so
 * read identity per call. Fail open unless a role preset is confirmed. */
export function roleSiblingGuardReasonFor(ctx) {
    return (exec) => {
        const name = exec?.name;
        if (typeof name !== 'string' || !SIBLING_DENIED_TOOLS.includes(name))
            return undefined;
        const claim = readPresetClaim(ctx, exec?.agent);
        if (claim.registryMissing || claim.failed || claim.claim === undefined)
            return undefined;
        if (!ROLE_PRESET_ID_LIST.includes(claim.claim))
            return undefined;
        if (name === 'list_agents') {
            return `${name} 不对人设 ${claim.claim} 开放：叶子角色只回传自己的结果，子 Agent 名单与调度归主 Agent。`
                + '需要别的 Agent 配合，用 send_message 回告主 Agent；不要自己换工具硬做。';
        }
        return `${name} 不对人设 ${claim.claim} 开放：叶子角色只回传自己的结果，打断别的会话归主 Agent 决定。`
            + '需要别的 Agent 停下来，用 send_message 回告主 Agent；不要自己换工具硬做。';
    };
}
/** Installs the sibling guard globally once. */
export function registerRoleSiblingGuard(ctx) {
    const ref = ctx.root ?? ctx;
    if (installedGuardRoots.has(ref))
        return;
    installedGuardRoots.add(ref);
    const reason = roleSiblingGuardReasonFor(ctx);
    const install = () => {
        let tools;
        try {
            tools = (ctx.get?.('tools') ?? ctx.tools);
        }
        catch {
            return undefined;
        }
        if (tools === undefined || typeof tools.guard !== 'function') {
            ctx.logger?.warn('capital-generation: 角色兄弟名字的调用级闸门没装上（guard 面不可用）：手开角色会话仍可 interrupt 兄弟');
            return undefined;
        }
        try {
            // Same probe channel as restrict: one readout for both planes.
            const dispose = tools.guard((execution) => {
                const denied = reason(execution);
                if (denied !== undefined)
                    recordGuardDecision(ctx, execution, String(execution?.name));
                return denied;
            });
            return typeof dispose === 'function' ? dispose : undefined;
        }
        catch {
            return undefined;
        }
    };
    if (typeof ctx.effect === 'function') {
        ctx.effect(() => {
            const dispose = install() ?? (() => { });
            return () => {
                try {
                    dispose();
                }
                finally {
                    installedGuardRoots.delete(ref);
                }
            };
        }, 'capital-generation.role-sibling-guard()');
        return;
    }
    install();
}
/** Dedupes by session id: `apply()` runs once per mounted role preset and duplicate probes would flood the readout. */
export function registerRoleToolPolicy(ctx) {
    const listenCtx = ctx.root ?? ctx;
    if (typeof listenCtx.on !== 'function')
        return;
    // Host policy and the monolith may both call this; one listener set per root.
    if (installedRoots.has(listenCtx))
        return;
    installedRoots.add(listenCtx);
    const install = () => {
        const seenAgents = new Map();
        const converge = (agent, presetId) => {
            const id = typeof agent?.session?.id === 'string' ? agent.session.id : undefined;
            if (id !== undefined && handled.has(id))
                return;
            const surface = ROLE_TOOL_SURFACES[presetId];
            const result = restrictRoleAgentTools(agent, surface);
            if (id !== undefined)
                handled.add(id);
            probes.push({ agentId: id, root: isRootAgent(agent), presetId, ...result });
            if (probes.length > MAX_PROBES)
                probes.shift();
            if (result.outcome === 'unavailable') {
                ctx.logger?.warn(`capital-generation: 角色 ${presetId} 的工具收敛没装上（restrict 面不可用）：该 child 仍看得见 ${[...SIBLING_DENIED_TOOLS, ...TEAM_DENIED_TOOLS].join(' / ')}`);
            }
            else if (result.allowFailed) {
                ctx.logger?.warn(`capital-generation: 角色 ${presetId} 的宿主全局工具白名单没装上（definitions/allow 面不可用）：该 child 仍可能看到未授权的宿主工具`);
            }
        };
        const stopCreated = listenCtx.on?.('agent/created', (payload) => {
            try {
                const agent = payload?.agent;
                const id = typeof agent?.session?.id === 'string' ? agent.session.id : undefined;
                if (id !== undefined)
                    seenAgents.set(id, agent);
                const presetId = rolePresetIdOf(ctx, agent);
                if (presetId === undefined)
                    return;
                converge(agent, presetId);
            }
            catch (error) {
                ctx.logger?.warn(`capital-generation: 角色工具面收敛异常：${error instanceof Error ? error.message : String(error)}`);
            }
        });
        // Manually opened role presets are selected after agent/created; the preset event is the
        // only point where the agent exists and the role identity is known.
        const onAny = listenCtx.on;
        const stopPreset = onAny?.('agent-preset/selected', (sessionId, presetId) => {
            if (typeof sessionId !== 'string' || typeof presetId !== 'string')
                return;
            if (!ROLE_PRESET_ID_LIST.includes(presetId))
                return;
            try {
                const agents = ctx.get?.('agents');
                const agent = seenAgents.get(sessionId) ?? agents?.get?.(sessionId);
                if (agent !== undefined)
                    converge(agent, presetId);
            }
            catch (error) {
                ctx.logger?.warn(`capital-generation: 角色 preset 选择后收敛异常：${error instanceof Error ? error.message : String(error)}`);
            }
        });
        const stopDisposed = listenCtx.on?.('agent/disposed', (payload) => {
            const id = typeof payload?.agent?.session?.id === 'string' ? payload.agent.session.id : undefined;
            if (id !== undefined) {
                handled.delete(id);
                seenAgents.delete(id);
            }
        });
        return () => {
            try {
                if (typeof stopCreated === 'function')
                    stopCreated();
            }
            catch { /* ignore */ }
            try {
                if (typeof stopPreset === 'function')
                    stopPreset();
            }
            catch { /* ignore */ }
            try {
                if (typeof stopDisposed === 'function')
                    stopDisposed();
            }
            catch { /* ignore */ }
        };
    };
    if (typeof ctx.effect === 'function') {
        ctx.effect(() => {
            const dispose = install();
            return () => {
                try {
                    if (typeof dispose === 'function')
                        dispose();
                }
                finally {
                    installedRoots.delete(listenCtx);
                }
            };
        }, 'capital-generation.role-tool-policy()');
        return;
    }
    install();
}
