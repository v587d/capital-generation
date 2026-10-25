/**
 * `tools/root-extras` row: the `customPersona` system-prompt section. Root-only; this row
 * registers no tools. Selected skills moved to the role-scoped `tools/selected-skills` row.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "capital-root-extras";
export declare const inject: string[];
interface RootExtrasConfig {
    customPersona?: string;
}
/** Re-read per turn so a settings save applies to the same session on the next step. */
export declare function readRootExtrasConfig(ctx: Context): RootExtrasConfig;
export declare function apply(ctx: Context): void;
export {};
