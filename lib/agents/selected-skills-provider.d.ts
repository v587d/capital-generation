import type { Context } from '@deepseek-ai/cordis';
import type { SkillProviderControl } from '@deepseek-ai/dsh-skill';
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem';
import { type PolicyContext } from './root-tool-policy.js';
export type SelectedSkillStatus = 'experimental' | 'watchlist';
export type SelectedSkillCatalogEntry = {
    key: string;
    name: string;
    status: SelectedSkillStatus;
    tags: readonly string[];
};
export declare const SELECTED_SKILL_CATALOG: readonly SelectedSkillCatalogEntry[];
export type SelectedSkillKey = typeof SELECTED_SKILL_CATALOG[number]['key'];
export type SelectedSkillSelection = Partial<Record<SelectedSkillKey, boolean>>;
export type SelectedSkillSelectionSource = SelectedSkillSelection | (() => SelectedSkillSelection);
type FileSystemSkillConfig = {
    providerName: string;
    includeDefaultRoots: false;
    customSkillDirs: string[];
    watch: true;
};
type FileSystemSkillSource = Pick<FileSystemSkillProvider, 'list' | 'get' | 'dispose'>;
type FileSystemSkillFactory = (ctx: Context, control: SkillProviderControl, config: FileSystemSkillConfig) => FileSystemSkillSource;
/** Register explicitly selected community experiments on the Capital root Agent only. */
export declare function registerRootSelectedSkills(ctx: PolicyContext, selection: SelectedSkillSelectionSource, createFilesystemProvider?: FileSystemSkillFactory): void;
export {};
