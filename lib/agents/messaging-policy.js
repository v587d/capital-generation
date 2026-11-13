import { recordGuardDecision } from './root-tool-policy.js';
import { readPresetClaim } from '../preset-claim.js';
import { CAPITAL_PRESET_IDS, ROLE_PRESET_IDS, ROOT_PRESET_ID } from '../preset-ids.js';
export const MESSAGE_TOOL_NAME = 'send_message';
export const ROOT_MESSAGE_DENIED = 'send_message 只能发给你的直系子 Agent：目标名不能是 `lead`，也不能含 `/`（孙 Agent 走 data_junior 中继）。'
    + '重新调用 list_agents() 取直系 name 后再发。';
export const LEAF_MESSAGE_DENIED = 'send_message 只能发给 `lead`：叶子角色不直接找兄弟或孙 Agent，材料与请求都经主 Agent 中继。';
export const SPECIALIST_MESSAGE_DENIED = 'visualization_specialist 不直接发消息：把图表结果作为最终答复返回 data_junior，由它汇总。';
/** Allowed targets per role preset. Empty means no messaging at all. Extend junior when the analyst link ships. */
export const ROLE_MESSAGE_TARGETS = {
    [ROLE_PRESET_IDS.collector]: ['lead'],
    [ROLE_PRESET_IDS.junior]: ['lead'],
    [ROLE_PRESET_IDS.retriever]: ['lead'],
    [ROLE_PRESET_IDS.specialist]: [],
    [ROLE_PRESET_IDS.analyst]: ['lead'],
};
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** The host owns the required-field error; the guard only judges a target it can actually read. */
export function sendMessageTargetOf(exec) {
    if (exec?.name !== MESSAGE_TOOL_NAME)
        return undefined;
    const args = isRecord(exec.arguments) ? exec.arguments : undefined;
    const target = args?.agent;
    return typeof target === 'string' && target.length > 0 ? target : undefined;
}
/** Root may address a direct child only: no tree path, and never itself. */
export function isDirectChildName(name) {
    return name !== 'lead' && !name.includes('/');
}
/** Read identity per call because a created-time gate misses manually opened modes; fail open otherwise. */
export function sendMessageGuardReasonFor(ctx) {
    return (exec) => {
        const target = sendMessageTargetOf(exec);
        if (target === undefined)
            return undefined;
        const claim = readPresetClaim(ctx, exec?.agent);
        if (claim.registryMissing || claim.failed || claim.claim === undefined)
            return undefined;
        if (!CAPITAL_PRESET_IDS.includes(claim.claim))
            return undefined;
        if (claim.claim === ROOT_PRESET_ID) {
            return isDirectChildName(target) ? undefined : ROOT_MESSAGE_DENIED;
        }
        const allowed = ROLE_MESSAGE_TARGETS[claim.claim] ?? [];
        if (allowed.length === 0)
            return SPECIALIST_MESSAGE_DENIED;
        return allowed.includes(target) ? undefined : LEAF_MESSAGE_DENIED;
    };
}
const installedGuardRoots = new WeakSet();
/** Installs once per root; the same probe channel makes denials visible through dc_status. */
export function registerSendMessageGuard(ctx) {
    const ref = ctx.root ?? ctx;
    if (installedGuardRoots.has(ref))
        return;
    installedGuardRoots.add(ref);
    const reason = sendMessageGuardReasonFor(ctx);
    const install = () => {
        let tools;
        try {
            tools = (ctx.get?.('tools') ?? ctx.tools);
        }
        catch {
            return undefined;
        }
        if (tools === undefined || typeof tools.guard !== 'function') {
            ctx.logger?.warn('capital-generation: send_message 的目标闸门没装上（guard 面不可用）：子 Agent 仍可跨层发消息');
            return undefined;
        }
        try {
            const dispose = tools.guard((execution) => {
                const denied = reason(execution);
                if (denied !== undefined)
                    recordGuardDecision(ctx, execution, MESSAGE_TOOL_NAME);
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
        }, 'capital-generation.send-message-guard()');
        return;
    }
    install();
}
