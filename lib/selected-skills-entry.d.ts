/**
 * `tools/selected-skills` row: role-scoped selected-skill catalog plus its role prompt section.
 * The row is mounted once per Capital preset (`config.role`) and registers into that Agent's
 * own scope only; it never writes to the preset standing scope or the host scope.
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
