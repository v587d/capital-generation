import { registerSelectedSkills, renderSelectedSkillsBrief, SELECTED_SKILL_ENTRY_ROLES, } from './agents/selected-skills-provider.js';
import { readCapitalConfig } from './capital-settings.js';
import { dataContractSection } from './data-contract.js';
export const name = 'capital-selected-skills';
export const inject = ['systemPrompt'];
const SECTION_NAME = 'capital:selected-skills';
/** After the persona, before the user-customization section (order 100). */
const SECTION_ORDER = 60;
const accessOf = (ctx) => ({
    selection: () => readCapitalConfig(ctx).selectedSkills ?? {},
    mode: () => (readCapitalConfig(ctx).selectedSkillsMode === 'auto' ? 'auto' : 'manual'),
});
export function apply(ctx, config = {}) {
    const role = config.role ?? 'main';
    if (!SELECTED_SKILL_ENTRY_ROLES.includes(role)) {
        throw new Error(`capital-selected-skills: unknown role "${String(role)}"`);
    }
    registerSelectedSkills(ctx, role, accessOf(ctx));
    let lastRenderError;
    ctx.effect(() => {
        // Every role that can load a skill also needs the boundary that says where its data comes from.
        const disposeContract = ctx.systemPrompt.section(dataContractSection());
        const dispose = ctx.systemPrompt.section({
            name: SECTION_NAME,
            order: SECTION_ORDER,
            // Upstream-derived prose can contain `{{...}}`; this section is literal.
            interpolate: false,
            text: (context) => {
                try {
                    // dsh-agent passes its Agent as the assembly scope; the usage ledger is keyed by session.
                    const agent = context?.agent;
                    return renderSelectedSkillsBrief(role, accessOf(ctx), agent);
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    if (message !== lastRenderError) {
                        lastRenderError = message;
                        ctx.logger?.warn?.(`capital-generation: selected skill prompt unreadable (${message})`);
                    }
                    return '';
                }
            },
        });
        return () => {
            if (typeof dispose === 'function')
                dispose();
            if (typeof disposeContract === 'function')
                disposeContract();
        };
    }, 'capital-generation.selected-skills()');
}
