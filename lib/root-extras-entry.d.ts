/**
 * `tools/root-extras` row: root-only selected-skills provider and the `customPersona`
 * system-prompt section. This row registers no tools; both pieces re-read settings
 * every turn so saved changes apply on the next step.
 */
import type { Context } from '@deepseek-ai/cordis';
import { type SelectedSkillSelection } from './agents/selected-skills-provider.js';
export declare const name = "capital-root-extras";
export declare const inject: string[];
interface RootExtrasConfig {
    customPersona?: string;
    selectedSkills?: SelectedSkillSelection;
}
/** Re-read per turn so a settings save applies to the same session on the next step. */
export declare function readRootExtrasConfig(ctx: Context): RootExtrasConfig;
export declare function apply(ctx: Context): void;
export {};
