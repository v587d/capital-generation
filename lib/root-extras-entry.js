import { registerRootSelectedSkills } from './agents/selected-skills-provider.js';
import { userCustomizationSection } from './user-customization.js';
import { readCapitalConfig } from './capital-settings.js';
export const name = 'capital-root-extras';
export const inject = ['systemPrompt'];
/** Re-read per turn so a settings save applies to the same session on the next step. */
export function readRootExtrasConfig(ctx) {
    const config = readCapitalConfig(ctx);
    return { customPersona: config.customPersona, selectedSkills: config.selectedSkills };
}
export function apply(ctx) {
    registerRootSelectedSkills(ctx, () => readRootExtrasConfig(ctx).selectedSkills ?? {});
    let lastPersonaError;
    const section = userCustomizationSection(() => readRootExtrasConfig(ctx).customPersona, (error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message === lastPersonaError)
            return;
        lastPersonaError = message;
        ctx.logger?.warn?.(`capital-generation: customPersona 未加载（${message}）`);
    });
    ctx.effect(() => {
        const dispose = ctx.systemPrompt.section(section);
        return typeof dispose === 'function' ? dispose : () => { };
    }, 'capital-generation.user-customization()');
}
