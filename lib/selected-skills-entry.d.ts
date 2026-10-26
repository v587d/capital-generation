/**
 * `tools/selected-skills` row: role-scoped selected-skill catalog, the `capital:data-contract`
 * section every skill-loading role needs, and the selected-skill brief. Mounted once per Capital
 * preset (`config.role`) and registers into that Agent's own scope only.
 */
import type { Context } from '@deepseek-ai/cordis';
import { type SelectedSkillRole } from './agents/selected-skills-provider.js';
export declare const name = "capital-selected-skills";
export declare const inject: string[];
interface Config {
    role?: SelectedSkillRole;
}
export declare function apply(ctx: Context, config?: Config): void;
export {};
