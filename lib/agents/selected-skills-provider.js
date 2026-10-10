import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem';
import { fileURLToPath } from 'node:url';
import { agentSessionId, isRootAgent } from './root-tool-policy.js';
// The catalog is a shipped data file outside the TypeScript root; runtime keeps this
// import so the published lib resolves the same metadata beside the pinned snapshots.
// @ts-expect-error catalog.js is intentionally maintained as package data.
import { SELECTED_SKILL_CATALOG as CATALOG } from '../../selected-skills/catalog.js';
export const SELECTED_SKILL_CATALOG = CATALOG;
const PROVIDER_NAME = 'capital-selected-skills';
const SKILL_ROOTS = [
    fileURLToPath(new URL('../../selected-skills/investment-skills/skills', import.meta.url)),
    fileURLToPath(new URL('../../selected-skills/china-stock-research-skills/skills', import.meta.url)),
];
function createFilesystemSkillProvider(ctx, control, config) {
    return new FileSystemSkillProvider(ctx, control, config);
}
function selectedNames(selection) {
    return new Set(SELECTED_SKILL_CATALOG
        .filter(({ key }) => selection[key] === true)
        .map(({ name }) => name));
}
function readSelection(source) {
    return typeof source === 'function' ? source() : source;
}
function strictCapitalPreset(ctx, agent) {
    try {
        const presets = ctx.get?.('agentPresets');
        return typeof presets?.composedPreset === 'function'
            && presets.composedPreset(agent.ctx) === 'capital-generation';
    }
    catch {
        return false;
    }
}
/** Register explicitly selected community experiments on the Capital root Agent only. */
export function registerRootSelectedSkills(ctx, selection, createFilesystemProvider = createFilesystemSkillProvider) {
    // Static callers retain the cheap all-disabled fast path. The Capital plugin
    // passes a reader so a settings toggle is observed for the next root Agent.
    if (typeof selection !== 'function' && selectedNames(selection).size === 0)
        return;
    const listenCtx = ctx.root ?? ctx;
    if (typeof listenCtx.on !== 'function')
        return;
    const stop = listenCtx.on('agent/created', ({ agent }) => {
        if (!agent || !isRootAgent(agent) || !strictCapitalPreset(ctx, agent))
            return;
        const enabled = selectedNames(readSelection(selection));
        if (enabled.size === 0)
            return;
        const agentCtx = agent.ctx;
        if (!agentCtx || typeof agentCtx.inject !== 'function') {
            ctx.logger?.warn?.('capital-generation: selected skills are unavailable (root Agent cannot inject skills)');
            return;
        }
        agentCtx.inject(['skills'], (injectedCtx) => {
            const skills = injectedCtx.skills;
            if (typeof skills?.registerProvider !== 'function') {
                ctx.logger?.warn?.('capital-generation: selected skills are unavailable (root Agent has no skills registry)');
                return;
            }
            let filesystemProvider;
            injectedCtx.effect(() => {
                const unregister = skills.registerProvider((control) => {
                    filesystemProvider = createFilesystemProvider(injectedCtx, control, {
                        providerName: PROVIDER_NAME,
                        includeDefaultRoots: false,
                        customSkillDirs: SKILL_ROOTS,
                        watch: true,
                    });
                    const provider = {
                        name: PROVIDER_NAME,
                        async list(options) {
                            const result = await filesystemProvider.list(options);
                            if (Array.isArray(result))
                                return result.filter((candidate) => enabled.has(candidate.name));
                            return { ...result, candidates: result.candidates.filter((candidate) => enabled.has(candidate.name)) };
                        },
                        get(candidate, options) {
                            if (!enabled.has(candidate.name)) {
                                throw new Error(`selected skill is not enabled: ${candidate.name}`);
                            }
                            return filesystemProvider.get(candidate, options);
                        },
                    };
                    return provider;
                });
                return () => {
                    unregister();
                    void filesystemProvider?.dispose();
                    filesystemProvider = undefined;
                };
            }, `capital-generation: selected skills for ${agentSessionId(agent) ?? 'root'}`);
        });
    });
    ctx.effect?.(() => () => {
        if (typeof stop === 'function')
            stop();
    }, 'capital-generation: selected skill root listener');
}
