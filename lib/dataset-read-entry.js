import { registerDatasetTools } from './data-collector/dataset-tools.js';
import { capitalDatasetStore } from './runtime.js';
export const name = 'capital-dataset-read-tools';
export const inject = ['tools'];
export function apply(ctx) {
    registerDatasetTools(ctx, capitalDatasetStore(ctx));
}
