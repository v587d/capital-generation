import { agentSessionId, recordGuardDecision } from './root-tool-policy.js';
import { readPresetClaim } from '../preset-claim.js';
import { CAPITAL_PRESET_IDS, ROLE_PRESET_IDS, ROOT_PRESET_ID } from '../preset-ids.js';
export const MESSAGE_TOOL_NAME = 'send_message';
const LEAD_NAME = 'lead';
/** Fixed tree names from the delegation prompt; peer edges match these strings, never session ids. */
export const ROLE_TREE_NAMES = {
    collector: 'data-collector',
    junior: 'data-junior',
    retriever: 'web-retriever',
    specialist: 'visualization-specialist',
    analyst: 'senior-analyst',
    lead: LEAD_NAME,
};
export const ROOT_MESSAGE_DENIED = 'send_message 只能发给你的直系子 Agent：目标名不能是 `lead`，也不能含 `/`（孙 Agent 走 data_junior 中继）。'
    + '重新调用 list_agents() 取直系 name 后再发。';
export const LEAF_MESSAGE_DENIED = 'send_message 只能发给 `lead`：叶子角色不直接找兄弟或孙 Agent，材料与请求都经主 Agent 中继。';
export const SPECIALIST_MESSAGE_DENIED = 'visualization_specialist 不直接发消息：把图表结果作为最终答复返回 data_junior，由它汇总。';
/** Allowed send edges per role preset. Empty means no messaging at all. Extending one is a product decision. */
export const ROLE_MESSAGE_TARGETS = {
    [ROLE_PRESET_IDS.collector]: [ROLE_TREE_NAMES.junior, ROLE_TREE_NAMES.analyst, LEAD_NAME],
    [ROLE_PRESET_IDS.junior]: [ROLE_TREE_NAMES.analyst, LEAD_NAME],
    [ROLE_PRESET_IDS.retriever]: [ROLE_TREE_NAMES.analyst, LEAD_NAME],
    [ROLE_PRESET_IDS.specialist]: [],
    [ROLE_PRESET_IDS.analyst]: [ROLE_TREE_NAMES.junior, LEAD_NAME],
};
/** Per-role denial copy; the range gate (new data via lead) belongs in the message, not only in docs. */
const ROLE_MESSAGE_DENIED = {
    [ROLE_PRESET_IDS.collector]: 'send_message 只能发给 lead、data-junior 或 senior-analyst：DatasetRef 可直达材料消费者，'
        + '新数据请求仍经 lead。',
    [ROLE_PRESET_IDS.junior]: 'send_message 只能发给 lead 或 senior-analyst：补计算结果可直发 senior，其他兄弟与孙 Agent 经 lead。',
    [ROLE_PRESET_IDS.retriever]: 'send_message 只能发给 lead 或 senior-analyst：带来源的证据可直发 senior，其他目标经 lead。',
    [ROLE_PRESET_IDS.analyst]: 'send_message 只能发给 lead 或 data-junior：新数据/新检索经 lead，'
        + '只有"用已有 Dataset/profile 补计算"可直连 data-junior。',
};
/** §5.6-2 budget: one analysis task may ask its peer at most three times. */
export const PEER_ROUND_TRIP_BUDGET = 3;
export const PEER_BUDGET_DENIED = `补计算往返已达 ${PEER_ROUND_TRIP_BUDGET} 次上限：不要再向同行发请求，`
    + '改用 analysis_blocked + peer_budget_exhausted 把未决缺口回给 lead 裁决。';
const PEER_SEND_BUDGET = {
    [ROLE_PRESET_IDS.analyst]: PEER_ROUND_TRIP_BUDGET,
};
/** Outgoing peer sends per sender session. One senior session carries one analysis task. */
const peerSends = new Map();
/** Bounded bookkeeping: leak-free enough without a session lifecycle hook. */
const PEER_SEND_TRACK_MAX = 256;
export function peerSendCount(sessionId) {
    return peerSends.get(sessionId) ?? 0;
}
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
    return name !== LEAD_NAME && !name.includes('/');
}
/** Counts the send once it passes the edge check; the artifact check is the authoritative record. */
function peerBudgetReason(role, target, exec) {
    const budget = PEER_SEND_BUDGET[role];
    if (budget === undefined || target === LEAD_NAME)
        return undefined;
    const sessionId = agentSessionId(exec?.agent);
    // No session pull (old host shape / unit call): leave counting to the artifact check.
    if (sessionId === undefined)
        return undefined;
    const used = peerSends.get(sessionId) ?? 0;
    if (used >= budget)
        return PEER_BUDGET_DENIED;
    peerSends.set(sessionId, used + 1);
    if (peerSends.size > PEER_SEND_TRACK_MAX) {
        const oldest = peerSends.keys().next().value;
        if (typeof oldest === 'string')
            peerSends.delete(oldest);
    }
    return undefined;
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
        if (!allowed.includes(target))
            return ROLE_MESSAGE_DENIED[claim.claim] ?? LEAF_MESSAGE_DENIED;
        return peerBudgetReason(claim.claim, target, exec);
    };
}
const installedGuardRoots = new WeakSet();
/** Install globally once; a created-time gate misses manually opened modes. */
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
