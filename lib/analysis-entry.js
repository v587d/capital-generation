import { registerAnalysisTools } from './analysis/tools.js';
import { capitalDatasetStore } from './runtime.js';
export const name = 'capital-analysis-tools';
export const inject = ['tools'];
export function apply(ctx) {
    registerAnalysisTools({ ctx, store: capitalDatasetStore(ctx) });
}
