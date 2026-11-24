/**
 * The `tools/analysis` family: six model-facing tools of the senior analyst.
 *
 * Every tool authorizes the caller through `src/tool-exec.ts` (preset identity, one implementation)
 * and returns refs plus bounded summaries. Raw rows never cross this boundary: they are staged into
 * the snapshot's `inputs/` and read only by the reviewed module inside the private interpreter.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { WorkspaceDatasetStore } from '../data-collector/store.js';
import { ANALYSIS_TOOL_NAMES } from './types.js';
export interface AnalysisToolDeps {
    readonly ctx: Context;
    readonly store: WorkspaceDatasetStore;
    readonly now?: () => number;
}
export declare function registerAnalysisTools(deps: AnalysisToolDeps): void;
export { ANALYSIS_TOOL_NAMES };
