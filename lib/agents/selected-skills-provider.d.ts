import type { Context } from '@deepseek-ai/cordis';
import type { SkillProviderControl } from '@deepseek-ai/dsh-skill';
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem';
import { type AgentLike, type PolicyContext } from './root-tool-policy.js';
export type SelectedSkillStatus = 'experimental' | 'watchlist';
export type SelectedSkillCatalogEntry = {
    key: string;
    name: string;
    label: {
        zh: string;
        en: string;
    };
    repository: string;
    status: SelectedSkillStatus;
    tags: readonly string[];
};
export declare const SELECTED_SKILL_CATALOG: readonly SelectedSkillCatalogEntry[];
/** Roles a preset row may declare. data_collector / visualization have no method set. */
export declare const SELECTED_SKILL_ENTRY_ROLES: readonly ["main", "data_junior", "web_retriever", "data_analyst", "data_collector", "visualization_specialist"];
export type SelectedSkillRole = typeof SELECTED_SKILL_ENTRY_ROLES[number];
export type SelectedSkillSelection = Partial<Record<string, boolean>>;
export type SelectedSkillSelectionSource = SelectedSkillSelection | (() => SelectedSkillSelection);
export type SelectedSkillsMode = 'auto' | 'manual';
/** Mode + manual switches. `auto` exposes every method the role owns and ignores the switches. */
export type SelectedSkillAccess = SelectedSkillSelectionSource | {
    selection: SelectedSkillSelectionSource;
    mode: SelectedSkillsMode | (() => SelectedSkillsMode);
};
/** Names this role may load, independent of the user's switches. One filter lives in routing.js. */
export declare function selectedSkillNamesForRole(role: SelectedSkillRole): Set<string>;
/** Enabled names for one role, read at call time (settings are a live preference). */
export declare function enabledSelectedSkillNames(role: SelectedSkillRole, selection: SelectedSkillSelection): Set<string>;
export declare function readSelectedSkillSelection(source: SelectedSkillSelectionSource): SelectedSkillSelection;
export declare function readSelectedSkillsMode(access: SelectedSkillAccess): SelectedSkillsMode;
/** Names the role may load right now: auto = the whole role set; manual = switches only. */
export declare function availableSelectedSkillNames(role: SelectedSkillRole, access: SelectedSkillAccess): Set<string>;
type FileSystemSkillConfig = {
    providerName: string;
    includeDefaultRoots: false;
    customSkillDirs: string[];
    watch: true;
};
type FileSystemSkillSource = Pick<FileSystemSkillProvider, 'list' | 'get' | 'dispose'>;
type FileSystemSkillFactory = (ctx: Context, control: SkillProviderControl, config: FileSystemSkillConfig) => FileSystemSkillSource;
/** Read-time router for one role: only cards whose snapshot actually exists are promised to the model. */
export declare function selectedSkillEntriesForRole(role: SelectedSkillRole, access: SelectedSkillAccess): SelectedSkillCatalogEntry[];
/** Role prompt: a short, imperative router. No upstream prose and no variable interpolation. */
export declare function renderSelectedSkillsBrief(role: SelectedSkillRole, access: SelectedSkillAccess, agent?: AgentLike): string;
/** Registers the role-scoped method catalog on the configured Capital preset Agent only. */
export declare function registerSelectedSkills(ctx: PolicyContext, role: SelectedSkillRole, access: SelectedSkillAccess, createFilesystemProvider?: FileSystemSkillFactory): void;
export {};
