import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPresetClaim } from '../preset-claim.js';
import { ROLE_PRESET_IDS, ROOT_PRESET_ID } from '../preset-ids.js';
import { agentSessionId, isRootAgent } from './root-tool-policy.js';
import { clearSelectedSkillUsage, recordSelectedSkillUsage, resetSelectedSkillUsage, skillUsageNamesForSession, skillUsageRows, trackSelectedSkillUsage, } from './skill-usage.js';
// Catalog/routing are package data outside the TS root; runtime imports keep lib resolving beside pinned snapshots.
// @ts-expect-error catalog.js is intentionally maintained as package data.
import { SELECTED_SKILL_CATALOG as CATALOG, SELECTED_SKILL_SKILL_DIRS } from '../../selected-skills/catalog.js';
// @ts-expect-error routing.js is intentionally maintained as package data.
import { SELECTED_SKILL_ROLES, SELECTED_SKILL_ROUTING as ROUTING, selectedSkillNamesForRole as routingNamesForRole, selectedSkillRoleKey, selectedSkillUseWhen } from '../../selected-skills/routing.js';
export const SELECTED_SKILL_CATALOG = CATALOG;
/** Roles a preset row may declare. data_collector / visualization have no method set. */
export const SELECTED_SKILL_ENTRY_ROLES = [
    'main', 'data_junior', 'web_retriever', 'data_analyst', 'data_collector', 'visualization_specialist',
];
const ROUTING_BY_NAME = ROUTING;
const PROVIDER_NAME = 'capital-selected-skills';
const BRIEF_HEADING = '# 外部精选方法（用户已启用）';
const AUTO_BRIEF_HEADING = '# 外部精选方法（自动模式：本角色全部方法）';
/** The role prompt is a router, not the 68-skill catalog; the full list stays in the host catalog. */
const BRIEF_MAX = 12;
/** Derive roots from the catalog: a hardcoded list silently hides checked boxes (upstream layouts differ). */
const SKILL_ROOTS = Object.entries(SELECTED_SKILL_SKILL_DIRS).map(([repository, skillsDir]) => fileURLToPath(new URL(`../../selected-skills/${repository}/${skillsDir}`, import.meta.url)));
const ROLE_PRESET = {
    main: ROOT_PRESET_ID,
    data_junior: ROLE_PRESET_IDS.junior,
    web_retriever: ROLE_PRESET_IDS.retriever,
    data_analyst: ROLE_PRESET_IDS.analyst,
    data_collector: ROLE_PRESET_IDS.collector,
    visualization_specialist: ROLE_PRESET_IDS.specialist,
};
const ENTRY_BY_KEY = new Map(SELECTED_SKILL_CATALOG.map((entry) => [entry.key, entry]));
const ROLE_LABELS = SELECTED_SKILL_ROLES;
const CATALOG_NAMES = new Set(SELECTED_SKILL_CATALOG.map(({ name }) => name));
const shortSession = (id) => id.replace(/^session-/, '').slice(0, 8);
const roleLabel = (role) => ROLE_LABELS[role]?.zh ?? role;
/** Names this role may load, independent of the user's switches. One filter lives in routing.js. */
export function selectedSkillNamesForRole(role) {
    return new Set(routingNamesForRole(role, SELECTED_SKILL_CATALOG));
}
/** Enabled names for one role, read at call time (settings are a live preference). */
export function enabledSelectedSkillNames(role, selection) {
    const allowed = selectedSkillNamesForRole(role);
    const names = new Set();
    for (const [key, enabled] of Object.entries(selection)) {
        if (enabled !== true)
            continue;
        const entry = ENTRY_BY_KEY.get(key);
        if (entry !== undefined && allowed.has(entry.name))
            names.add(entry.name);
    }
    return names;
}
export function readSelectedSkillSelection(source) {
    return typeof source === 'function' ? source() : source;
}
function isAccess(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && 'selection' in value;
}
export function readSelectedSkillsMode(access) {
    if (!isAccess(access))
        return 'manual';
    const mode = typeof access.mode === 'function' ? access.mode() : access.mode;
    return mode === 'auto' ? 'auto' : 'manual';
}
/** Names the role may load right now: auto = the whole role set; manual = switches only. */
export function availableSelectedSkillNames(role, access) {
    return readSelectedSkillsMode(access) === 'auto'
        ? selectedSkillNamesForRole(role)
        : enabledSelectedSkillNames(role, readSelectedSkillSelection(isAccess(access) ? access.selection : access));
}
/** Fingerprint only the catalog key set: refresh the cache only when the selection changes. */
function selectionFingerprint(selection) {
    return SELECTED_SKILL_CATALOG.map(({ key }) => (selection[key] === true ? '1' : '0')).join('');
}
/** Fingerprint the mode separately: switches cannot change an auto catalog. */
function accessFingerprint(access) {
    if (readSelectedSkillsMode(access) === 'auto')
        return 'auto';
    return `manual:${selectionFingerprint(readSelectedSkillSelection(isAccess(access) ? access.selection : access))}`;
}
// `agent/pre-step` belongs to dsh-agent; attach via the injected Agent context so scope filtering admits it.
function onPreStepEvent(ctx, listener) {
    const events = ctx;
    return events.on?.('agent/pre-step', listener);
}
function createFilesystemSkillProvider(ctx, control, config) {
    return new FileSystemSkillProvider(ctx, control, config);
}
function catalogPath(entry) {
    const dir = SELECTED_SKILL_SKILL_DIRS[entry.repository];
    if (dir === undefined)
        return '';
    return fileURLToPath(new URL(`../../selected-skills/${entry.repository}/${dir}/${entry.name}/SKILL.md`, import.meta.url));
}
/** Read-time router for one role: only cards whose snapshot actually exists are promised to the model. */
export function selectedSkillEntriesForRole(role, access) {
    const available = availableSelectedSkillNames(role, access);
    const rank = (name) => {
        const routing = ROUTING_BY_NAME[name];
        const canonical = (routing?.canonicalFor.length ?? 0) > 0 ? 0 : 2;
        const primary = routing?.primaryRole === selectedSkillRoleKey(role) ? 0 : 1;
        return canonical + primary;
    };
    return SELECTED_SKILL_CATALOG
        .filter((entry) => available.has(entry.name) && existsSync(catalogPath(entry)))
        // Canonical, primary-role methods first: the 12-line prompt is a router, not a catalog order sample.
        .sort((left, right) => rank(left.name) - rank(right.name));
}
/** Usage is read from the tool-result ledger, never from the model's own claim. */
function usageSection(role, agent) {
    if (agent === undefined)
        return [];
    const sessionId = agentSessionId(agent);
    if (sessionId === undefined)
        return [];
    if (selectedSkillRoleKey(role) === 'main') {
        const rows = skillUsageRows(sessionId);
        if (rows.length === 0)
            return [];
        return [
            '## 本次已实际加载的精选方法（程序记录）',
            '以下名单来自成功返回正文的加载记录（工具结果或 `/name` 注入），包含子 Agent 实际加载的方法；不依赖模型自报。',
            ...rows.map((row) => {
                const who = row.role === 'main' ? roleLabel(row.role) : `${roleLabel(row.role)}（${shortSession(row.sessionId)}）`;
                return `- ${who}：${row.names.map((name) => `\`${name}\``).join('、')}`;
            }),
            '最终答复必须有一节「使用的方法」，逐条点名以上每一个方法，并说明它支撑了哪个判断；'
                + '不得点名未加载的条目，也不得用「参考了相关方法」代替。本轮没有加载就不要写这一节。',
        ];
    }
    const names = skillUsageNamesForSession(sessionId);
    if (names.length === 0)
        return [];
    return [
        `本次你已实际加载：${names.map((name) => `\`${name}\``).join('、')}。`,
        `回传结论时在末尾附一行 \`skills_used: ${names.join(', ')}\`；主 Agent 以程序记录为准，这一行是给读者看的摘要。`,
    ];
}
/** Role prompt: a short, imperative router. No upstream prose and no variable interpolation. */
export function renderSelectedSkillsBrief(role, access, agent) {
    // The main row is mounted in the root preset; a generic child may inherit that composition.
    // Main methods stay on the root Agent, so its prompt must not promise them to a child either.
    if (role === 'main' && agent !== undefined && !isRootAgent(agent))
        return '';
    const mode = readSelectedSkillsMode(access);
    const entries = selectedSkillEntriesForRole(role, access);
    const usage = usageSection(role, agent);
    // A child may have loaded a method while this role has none enabled; the citation
    // feedback still has to reach the root, so usage alone is enough to render.
    if (entries.length === 0 && usage.length === 0)
        return '';
    const key = selectedSkillRoleKey(role);
    const roleRule = key === 'main'
        ? '需要计算、建模或统计时交给 data_junior；你的目录只含主角色可用的方法，只属于 data_junior / web_retriever 的方法不在其中，不代表不存在——用户点名时交给对应角色按名加载，不要判为不存在，也不要改用通用方法自己算。'
        : key === 'data_junior'
            ? '只执行方法中的计算、表格与统计；结论与最终写作留给主 Agent。'
            : '只做取证、文档深读与核验；不做投资判断。';
    const shown = entries.slice(0, BRIEF_MAX);
    const layerRule = '这些是方法层（金融分析框架），不是流程协议：内置 `capital-*` 协议负责流程、证据门、工具委派与输出形状，'
        + '方法层负责分析步骤、公式与检查清单。两者正交，任务同时命中时都要加载——先用协议定流程，再用方法定分析；'
        + '不得用协议替代方法，也不得用方法改写协议。';
    const lines = [mode === 'auto' ? AUTO_BRIEF_HEADING : BRIEF_HEADING, ''];
    if (entries.length > 0) {
        lines.push(mode === 'auto'
            ? '自动模式已按你的执行角色开放全部方法。进入分析或取证前，先按每条末尾的「何时使用」判断本任务需要哪几条；'
                + '匹配的用 `skill` 按名加载正文，再按它的步骤执行；只加载与本任务直接相关的 1–2 条，不要一次搬空目录。'
            : '以下条目是用户在设置里显式启用的方法。进入分析或取证前先逐条判断本任务是否需要这类方法；'
                + '匹配的先用 `skill` 按名加载正文，再按它的步骤执行；只加载与本任务直接相关的 1–2 条。', layerRule, '加载后不得把摘要当全文，也不得声称用过未加载的条目；真正用过的要在最终答复里点名并说明用途。'
            + '全都不匹配就不要提，也不要为了用而用。', roleRule, '', ...shown.map((entry) => `- \`${entry.name}\`（${entry.label.zh}）：${ROUTING_BY_NAME[entry.name]?.useWhen.zh ?? entry.name}`));
        if (entries.length > shown.length) {
            lines.push(mode === 'auto'
                ? `- 本角色共 ${entries.length} 颗可用，这里按常用度列前 ${shown.length} 颗；完整目录见本次会话的技能目录。`
                : `- 另有 ${entries.length - shown.length} 颗已启用，见本次会话的技能目录。`);
        }
        else if (mode === 'auto') {
            lines.push(`- 本角色共 ${entries.length} 颗可用，已全部列出。`);
        }
    }
    if (usage.length > 0)
        lines.push('', ...usage);
    return lines.join('\n');
}
/** Registers the role-scoped method catalog on the configured Capital preset Agent only. */
export function registerSelectedSkills(ctx, role, access, createFilesystemProvider = createFilesystemSkillProvider) {
    const presetId = ROLE_PRESET[role];
    const allowed = selectedSkillNamesForRole(role);
    // data_collector / visualization own no methods; an empty provider would only add noise.
    if (allowed.size === 0)
        return;
    // Static callers keep the all-off fast path; a live reader (the plugin) must register even when
    // every switch is off now, or a later enable/auto flip would never surface without a new Agent.
    const staticAccess = typeof access === 'function'
        ? undefined
        : isAccess(access)
            ? (typeof access.selection === 'function' || typeof access.mode === 'function' ? undefined : access)
            : access;
    if (staticAccess !== undefined && readSelectedSkillsMode(staticAccess) === 'manual'
        && availableSelectedSkillNames(role, staticAccess).size === 0)
        return;
    const listenCtx = ctx.root ?? ctx;
    if (typeof listenCtx.on !== 'function')
        return;
    // One registration per Agent: both event paths can observe the same Agent.
    const registered = new WeakSet();
    const registerFor = async (agent) => {
        if (!agent || registered.has(agent))
            return;
        // The row is mounted only in this role preset, but the root listener sees every Agent.
        const claim = readPresetClaim(ctx, agent);
        if (claim.claim !== presetId)
            return;
        // Main methods stay on the root Agent: a generic child may inherit the root preset claim.
        if (role === 'main' && !isRootAgent(agent))
            return;
        registered.add(agent);
        const usageRole = selectedSkillRoleKey(role);
        const rootAgent = role === 'main' && isRootAgent(agent);
        const sessionId = agentSessionId(agent);
        trackSelectedSkillUsage(agent, usageRole);
        try {
            const agentCtx = agent.ctx;
            if (!agentCtx || typeof agentCtx.inject !== 'function') {
                registered.delete(agent);
                ctx.logger?.warn?.('capital-generation: selected skills are unavailable (agent cannot inject skills)');
                return;
            }
            // agent/created is serial: DSH awaits listeners, so this inject lands before the first prompt.
            await agentCtx.inject(['skills'], (injectedCtx) => {
                const skills = injectedCtx.skills;
                if (typeof skills?.registerProvider !== 'function') {
                    ctx.logger?.warn?.('capital-generation: selected skills are unavailable (agent has no skills registry)');
                    return;
                }
                let filesystemProvider;
                let control;
                // Register even when all toggles are off; a later enable must surface without a new Agent.
                let served = accessFingerprint(access);
                injectedCtx.effect(() => {
                    const unregister = skills.registerProvider((registration) => {
                        control = registration;
                        filesystemProvider = createFilesystemProvider(injectedCtx, registration, {
                            providerName: PROVIDER_NAME,
                            includeDefaultRoots: false,
                            customSkillDirs: SKILL_ROOTS,
                            watch: true,
                        });
                        const provider = {
                            name: PROVIDER_NAME,
                            async list(options) {
                                // Read at call time: toggles are settings, not fixed at Agent creation.
                                const available = availableSelectedSkillNames(role, access);
                                if (available.size === 0)
                                    return [];
                                const result = await filesystemProvider.list(options);
                                const candidates = Array.isArray(result) ? result : result.candidates;
                                const selected = candidates
                                    .filter((candidate) => available.has(candidate.name))
                                    .map((candidate) => ({ ...candidate, description: selectedSkillUseWhen(candidate.name, 'zh') || candidate.description }));
                                return Array.isArray(result) ? selected : { ...result, candidates: selected };
                            },
                            get(candidate, options) {
                                // The catalog filter and the body read must use the same role/selection gate.
                                const available = availableSelectedSkillNames(role, access);
                                if (!available.has(candidate.name)) {
                                    throw new Error(`selected skill is not enabled for ${role}: ${candidate.name}`);
                                }
                                return filesystemProvider.get(candidate, options);
                            },
                        };
                        return provider;
                    });
                    // Invalidate before next() so this turn's snapshot sees the change regardless of listener order.
                    const stopPreStep = onPreStepEvent(injectedCtx, (_payload, next) => {
                        try {
                            const fingerprint = accessFingerprint(access);
                            if (fingerprint !== served) {
                                served = fingerprint;
                                control?.invalidate();
                            }
                        }
                        catch (error) {
                            ctx.logger?.warn?.(`capital-generation: selected skill settings unreadable (${String(error)})`);
                        }
                        return next();
                    });
                    // The ledger is the only source for `skills_used`: a name is recorded after the host
                    // returned the body, so a rejected or disabled name never gets cited.
                    const usageCtx = injectedCtx;
                    if (typeof usageCtx.on !== 'function') {
                        ctx.logger?.warn?.('capital-generation: selected skill usage cannot be recorded (agent context has no event API)');
                    }
                    const stopToolResult = usageCtx.on?.('tools/result', (exec, result) => {
                        if (exec?.name !== 'skill')
                            return;
                        const outcome = result;
                        if (outcome?.isError === true || outcome?.value?.provider !== PROVIDER_NAME)
                            return;
                        if (typeof outcome?.value?.name === 'string' && CATALOG_NAMES.has(outcome.value.name)) {
                            recordSelectedSkillUsage(agent, usageRole, outcome.value.name);
                        }
                    });
                    const stopSession = usageCtx.on?.('session/event', (session, event) => {
                        if (sessionId !== undefined && session?.id !== sessionId)
                            return;
                        const type = event?.type;
                        const data = event?.data;
                        if (type === 'user/message') {
                            const source = data?.source;
                            // A new user turn starts a new citation window; child settlements do not.
                            if (source?.kind === 'user' && rootAgent && sessionId !== undefined)
                                resetSelectedSkillUsage(sessionId);
                            if (source?.kind === 'skill-invocation' && typeof source.name === 'string' && CATALOG_NAMES.has(source.name)) {
                                recordSelectedSkillUsage(agent, usageRole, source.name);
                            }
                            return;
                        }
                        if (type !== 'tool/ptc-dispatch')
                            return;
                        if (data?.name !== 'skill' || data.isError === true)
                            return;
                        let args = data.arguments;
                        if (typeof args === 'string') {
                            try {
                                args = JSON.parse(args);
                            }
                            catch {
                                return;
                            }
                        }
                        const name = args?.name;
                        if (typeof name === 'string' && CATALOG_NAMES.has(name)) {
                            recordSelectedSkillUsage(agent, usageRole, name);
                        }
                    });
                    return () => {
                        if (typeof stopPreStep === 'function')
                            stopPreStep();
                        if (typeof stopToolResult === 'function')
                            stopToolResult();
                        if (typeof stopSession === 'function')
                            stopSession();
                        if (rootAgent && sessionId !== undefined)
                            clearSelectedSkillUsage(sessionId);
                        unregister();
                        void filesystemProvider?.dispose();
                        filesystemProvider = undefined;
                    };
                }, `capital-generation: selected skills for ${role} / ${agentSessionId(agent) ?? 'agent'}`);
            });
        }
        catch (error) {
            // Optional capability: degrade with a warning, never block Agent creation; clear so a later event can retry.
            registered.delete(agent);
            ctx.logger?.warn?.(`capital-generation: selected skills are unavailable (${String(error)})`);
        }
    };
    const stop = listenCtx.on('agent/created', ({ agent }) => registerFor(agent));
    // GUI creates with the default preset, then selects Capital. `agent/created` already fired and
    // apply() runs inside that remount, so `agent-preset/selected` arrives after mount.
    const onPresetEvent = listenCtx.on;
    const stopPreset = onPresetEvent?.('agent-preset/selected', (sessionId, agentPreset) => {
        if (agentPreset !== presetId)
            return;
        const agents = ctx.get?.('agents');
        const agent = agents?.get?.(String(sessionId));
        if (agent === undefined)
            return;
        // Emit-style event: the promise only lets tests await registration; errors are handled inside.
        return registerFor(agent);
    });
    ctx.effect?.(() => () => {
        if (typeof stop === 'function')
            stop();
        if (typeof stopPreset === 'function')
            stopPreset();
    }, 'capital-generation: selected skill role listeners');
}
