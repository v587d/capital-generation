import { DatasetStoreError } from './data-collector/store.js';
import { readPresetClaim } from './preset-claim.js';
import { ROOT_PRESET_ID } from './preset-ids.js';
/** Return the caller session; fail loudly when the framework shape is missing. */
export function callerSession(exec) {
    const session = exec.agent?.session;
    if (!session || typeof session.id !== 'string') {
        throw new DatasetStoreError('session_unavailable', 'the calling agent session was not provided');
    }
    return session;
}
function hasParentSession(session) {
    const parent = session.header?.parentSession;
    return typeof parent === 'string' && parent.length > 0;
}
/**
 * Decide whether this session may use a preset-restricted tool.
 *
 * Does not throw: callers own their error codes and messages. The only side effect is
 * recording the decision in a bounded ring buffer for diagnostics.
 */
export function authorizeToolSession(pluginCtx, exec, toolName, allowedPresetIds) {
    const session = callerSession(exec);
    const claim = readPresetClaim(pluginCtx, exec.agent);
    const decision = (!claim.registryMissing && !claim.failed && typeof claim.claim === 'string' && claim.claim.length > 0)
        // Confirmed identity: the main Agent is not in any allow-list and stays denied.
        ? { session, allowed: allowedPresetIds.includes(claim.claim), via: 'preset', presetId: claim.claim }
        // Unconfirmed identity: legacy topology check, never wider than before.
        : { session, allowed: hasParentSession(session), via: 'topology' };
    recordSessionAuth(toolName, decision);
    return decision;
}
/**
 * Data-side gate: decide and throw `dataset_session_mismatch` when denied.
 *
 * Messages are model guidance: name the current preset on preset mismatch, or tell a role
 * agent to ask its caller instead of switching tools.
 */
export function authorizedSession(pluginCtx, exec, toolName, allowedPresetIds) {
    const decision = authorizeToolSession(pluginCtx, exec, toolName, allowedPresetIds);
    if (decision.allowed)
        return decision.session;
    if (decision.via === 'preset') {
        // "Delegate" is only correct for the main Agent; a role agent that hits this gate is
        // already delegated and must report back instead of switching tools.
        throw new DatasetStoreError('dataset_session_mismatch', `${toolName} 不对人设 ${decision.presetId} 开放；它只属于 ${allowedPresetIds.join(' / ')}。`
            + (decision.presetId === ROOT_PRESET_ID ? '主 Agent 请委派相应角色。' : '你是角色越界：回告调用方改用相应模式，不要自己换工具硬做。'));
    }
    throw new DatasetStoreError('dataset_session_mismatch', `${toolName} is restricted to delegated data agents; the main Agent must delegate this request`);
}
const MAX_SESSION_AUTH_RECORDS = 16;
const sessionAuthRecords = [];
function recordSessionAuth(toolName, decision) {
    sessionAuthRecords.push({
        tool: toolName,
        via: decision.via,
        presetId: decision.presetId ?? null,
        allowed: decision.allowed,
    });
    if (sessionAuthRecords.length > MAX_SESSION_AUTH_RECORDS)
        sessionAuthRecords.shift();
}
/** Recent decisions as a shallow copy (JSON-safe for model output). */
export function sessionIdentityDecisions() {
    return sessionAuthRecords.map((record) => ({ ...record }));
}
/** Test-only: clear records between cases. */
export function resetSessionIdentityDecisions() {
    sessionAuthRecords.length = 0;
}
