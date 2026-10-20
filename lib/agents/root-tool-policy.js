/**
 * Root Agent tool convergence on the root's own scope: preset-level deny would also hit
 * children. Listeners must live on `ctx.root`; tagged standing-scope listeners miss agent/created.
 */
import { CAPITAL_PRESET_IDS, ROOT_PRESET_ID } from '../preset-ids.js';
import { readPresetClaim } from '../preset-claim.js';
/** Outbound tools (search 2 + wind 2 + named sources 9); `ocr` is excluded because only its url form is restricted. */
export const RETRIEVAL_DENIED_TOOLS = [
    'anysearch_search', 'web_retriever_fetch',
    'wind_docs_announcements', 'wind_docs_news',
    'cls_telegraph', 'wscn_lives', 'cninfo_irm', 'sseinfo_qa',
    'eastmoney_724', 'eastmoney_stock_news', 'eastmoney_reports', 'sina_reports', 'ths_eps_forecast',
];
export const OCR_TOOL_NAME = 'ocr';
/** Name-level deny cannot express the form distinction; this is a call-level guard. */
export const OCR_ROOT_URL_DENIED = 'ocr 的 url 形态只对被委派的 web_retriever 开放：外部 PDF 链接请委派 subagent_web_retriever 解析。'
    + '工作目录里的本地文档（file）与已解析产物（doc_id + pages/query）可以直接调用。';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function ocrUrlFormRequested(exec) {
    if (exec?.name !== OCR_TOOL_NAME)
        return false;
    const args = isRecord(exec.arguments) ? exec.arguments : undefined;
    return args !== undefined && typeof args.url === 'string' && args.url.length > 0;
}
/** Read per call because a created-time gate misses manually opened modes; fail open unless a confirmed Capital root. */
export function ocrFormGuardReasonFor(ctx) {
    return (exec) => {
        if (!ocrUrlFormRequested(exec))
            return undefined;
        const claim = readPresetClaim(ctx, exec?.agent);
        // Global guard sees every process call; only a confirmed Capital root is blocked.
        if (claim.registryMissing || claim.failed || claim.claim !== CAPITAL_PRESET_ID)
            return undefined;
        return OCR_ROOT_URL_DENIED;
    };
}
/** Mounted as a platform pair; recognize both everywhere or the other platform's gate is dead. */
export const SHELL_TOOL_NAMES = ['bash', 'pwsh'];
export const ROOT_AGENT_DENIED_TOOLS = [
    /** Charts only flow through junior -> visualization_specialist. */
    'render_chart',
    'prepare_chart_source',
    ...RETRIEVAL_DENIED_TOOLS,
    /** Not a boundary (the host global layer registers them); the call-level fs guard is the real block. */
    'write',
    'edit',
];
export const CAPITAL_PRESET_ID = ROOT_PRESET_ID;
export function isRootAgent(agent) {
    if (agent?.session === undefined)
        return false;
    const parent = agent.session.header?.parentSession;
    return typeof parent !== 'string' || parent.length === 0;
}
export function agentSessionId(agent) {
    const id = agent?.session?.id;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
}
export function isCapitalAgent(ctx, agent) {
    const claim = readPresetClaim(ctx, agent);
    // Registry missing: conservative claim, because per-name restrict rejects unknown names harmlessly.
    if (claim.registryMissing)
        return true;
    return claim.claim === CAPITAL_PRESET_ID;
}
/** Allows any Capital preset; guards for role children must use this, not the root id. */
export function isCapitalPresetAgent(ctx, agent) {
    const claim = readPresetClaim(ctx, agent);
    if (claim.registryMissing)
        return true;
    return claim.claim !== undefined && CAPITAL_PRESET_IDS.includes(claim.claim);
}
const probes = [];
const MAX_PROBES = 8;
const installedPolicyRoots = new WeakSet();
const installedFsGuardRoots = new WeakSet();
const installedOcrGuardRoots = new WeakSet();
/** Shares the convergence channel so opened-mode and call-level failures line up. */
export function recordGuardDecision(ctx, exec, toolName) {
    const agent = exec?.agent;
    probes.push({
        agentId: agentSessionId(agent),
        root: isRootAgent(agent),
        presetId: presetIdOf(ctx, agent),
        outcome: 'guard-denied',
        denied: [toolName],
        failed: [],
    });
    if (probes.length > MAX_PROBES)
        probes.shift();
}
export function rootPolicyProbes() {
    return probes.map((probe) => ({ ...probe, denied: [...probe.denied], failed: [...probe.failed] }));
}
export function resetRootPolicyProbes() {
    probes.length = 0;
}
function presetIdOf(ctx, agent) {
    const claim = readPresetClaim(ctx, agent);
    if (claim.registryMissing)
        return 'no-registry';
    if (claim.failed)
        return 'error';
    return claim.claim ?? 'undefined';
}
/** Per-name deny on the root only; name-not-visible throws become harmless skips. Never throws: called on agent creation. */
export function restrictRootAgentTools(agent, record) {
    if (!isRootAgent(agent))
        return 'skipped';
    let tools;
    try {
        tools = agent?.ctx?.tools;
    }
    catch {
        return 'unavailable';
    }
    if (tools === undefined || typeof tools.restrict !== 'function')
        return 'unavailable';
    for (const name of ROOT_AGENT_DENIED_TOOLS) {
        try {
            tools.restrict({ deny: [name] });
            record?.denied.push(name);
        }
        catch {
            record?.failed.push(name);
        }
    }
    return 'restricted';
}
/** Install globally once; created-time identity misses manually opened modes. */
export function registerRootOcrGuard(ctx) {
    const ref = ctx.root ?? ctx;
    if (installedOcrGuardRoots.has(ref))
        return;
    installedOcrGuardRoots.add(ref);
    const reason = ocrFormGuardReasonFor(ctx);
    const install = () => {
        let tools;
        try {
            // `get` before property access: property access throws on fibers without inject.
            tools = (ctx.get?.('tools') ?? ctx.tools);
        }
        catch {
            return undefined;
        }
        if (tools === undefined || typeof tools.guard !== 'function') {
            ctx.logger?.warn('capital-generation: `ocr` 的 url 形态闸门没装上（guard 面不可用）：主模式人设仍可自己抓外部 PDF');
            return undefined;
        }
        try {
            const dispose = tools.guard((execution) => {
                const denied = reason(execution);
                if (denied !== undefined)
                    recordGuardDecision(ctx, execution, OCR_TOOL_NAME);
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
                    installedOcrGuardRoots.delete(ref);
                }
            };
        }, 'capital-generation.ocr-form-guard()');
        return;
    }
    install();
}
export const FS_WRITE_TOOL_NAMES = ['write', 'edit'];
const fsWriteNames = new Set(FS_WRITE_TOOL_NAMES);
/** Points at the allowed paths (read, tool returns) instead of leaving the caller stuck. */
export const FS_WRITE_READ_ONLY = 'write / edit 不开放（主 Agent 与子会话都不直接写文件）：读文件用 read；'
    + '数据与产物走工具回传（DatasetRef / chart_ref / send_message），需要落盘的由工具实现完成。'
    + '若你判断确需写文件，用 send_message 把 data_gap 与已有证据发回主 Agent 协调。';
/** Global call-level fs guard: the host global layer registers write/edit, so per-name restrict
 * only shrinks children. Fail open unless a Capital preset is confirmed. */
export function fsWriteGuardReasonFor(ctx) {
    return (execution) => {
        const name = execution?.name;
        if (typeof name !== 'string' || !fsWriteNames.has(name))
            return undefined;
        const claim = readPresetClaim(ctx, execution.agent);
        // One wrong denial would remove another preset's write access for the whole process.
        if (claim.registryMissing || claim.failed || claim.claim === undefined)
            return undefined;
        if (!CAPITAL_PRESET_IDS.includes(claim.claim))
            return undefined;
        return FS_WRITE_READ_ONLY;
    };
}
export function registerFsWriteGuard(ctx) {
    const ref = ctx.root ?? ctx;
    if (installedFsGuardRoots.has(ref))
        return;
    installedFsGuardRoots.add(ref);
    const reason = fsWriteGuardReasonFor(ctx);
    const install = () => {
        let tools;
        try {
            const viaGet = typeof ctx.get === 'function' ? ctx.get('tools') : undefined;
            const candidate = viaGet !== undefined ? viaGet : ctx.tools;
            tools = candidate;
        }
        catch {
            return undefined;
        }
        if (tools === undefined || typeof tools.guard !== 'function') {
            ctx.logger?.warn('capital-generation: fs 写口闸门没装上（guard 面不可用）：`write` / `edit` 只剩 `tool-fs` 那行的行级开关在拦');
            return undefined;
        }
        try {
            const dispose = tools.guard((execution) => {
                const denied = reason(execution);
                // Desktop persists no host logs; a guard block otherwise looks like "no write tool".
                if (denied !== undefined && typeof execution?.name === 'string' && fsWriteNames.has(execution.name)) {
                    recordGuardDecision(ctx, execution, execution.name);
                }
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
                    installedFsGuardRoots.delete(ref);
                }
            };
        }, 'capital-generation.fs-write-guard()');
        return;
    }
    install();
}
export function registerRootToolPolicy(ctx, options = {}) {
    const listenCtx = ctx.root ?? ctx;
    if (typeof listenCtx.on !== 'function')
        return;
    if (installedPolicyRoots.has(listenCtx))
        return;
    installedPolicyRoots.add(listenCtx);
    const install = () => {
        const stopCreated = listenCtx.on?.('agent/created', (payload) => {
            try {
                const agent = payload?.agent;
                const isRoot = isRootAgent(agent);
                // Root only: children always have a parentSession and would crowd the 8-entry window.
                const probe = isRoot
                    ? { agentId: agentSessionId(agent), root: true, presetId: presetIdOf(ctx, agent), outcome: 'pending', denied: [], failed: [] }
                    : undefined;
                if (probe !== undefined) {
                    probes.push(probe);
                    if (probes.length > MAX_PROBES)
                        probes.shift();
                }
                if (!isCapitalAgent(ctx, agent)) {
                    if (probe !== undefined)
                        probe.outcome = 'not-capital';
                    return;
                }
                if (options.deny === false) {
                    // Composition already removed data/web/chart; per-name deny would only add `failed` noise.
                    if (probe !== undefined)
                        probe.outcome = 'skipped';
                }
                else {
                    const outcome = restrictRootAgentTools(agent, probe);
                    if (probe !== undefined)
                        probe.outcome = outcome;
                    if (outcome === 'unavailable') {
                        ctx.logger?.warn(`capital-generation: 根 Agent 工具收敛未生效（${outcome}）：主 Agent 仍会看到 ${ROOT_AGENT_DENIED_TOOLS.join(' / ')}`);
                    }
                }
            }
            catch (error) {
                ctx.logger?.warn(`capital-generation: 根 Agent 工具收敛异常：${error instanceof Error ? error.message : String(error)}`);
            }
        });
        return () => {
            try {
                if (typeof stopCreated === 'function')
                    stopCreated();
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
                    installedPolicyRoots.delete(listenCtx);
                }
            };
        }, 'capital-generation.root-tool-policy()');
        return;
    }
    install();
}
