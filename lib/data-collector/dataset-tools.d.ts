import type { Context } from '@deepseek-ai/cordis';
import { WorkspaceDatasetStore } from './store.js';
/**
 * Dataset read family. writeProfile is off by default: profiles are host-computed, and the tool is
 * absent from every family row; the monolithic entry opts in explicitly.
 */
export declare function registerDatasetTools(ctx: Context, store: WorkspaceDatasetStore, options?: {
    writeProfile?: boolean;
}): void;
