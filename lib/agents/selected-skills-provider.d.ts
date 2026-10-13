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
type RuntimeSummary = {
    name: string;
    description: string;
};
/**
 * 索引块正文。**唯一实现**：条目集合来自 catalog 的 `selectedSkillsForTask`（与目录、闸门同源），
 * 描述用**运行时那一份**（上游 frontmatter，也就是会话目录里模型看到的那句话），不是设置卡片里
 * 策展过的中文摘要——同一个 skill 在同一段上下文里出现两种描述，只会让模型两处对照。
 */
export declare function renderTaskSkillIndex(taskId: string, summaries: readonly RuntimeSummary[]): string | undefined;
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
