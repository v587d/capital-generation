import { registerTimeTool } from './time/tools.js';
import { capitalDatasetStore } from './runtime.js';
export const name = 'capital-time-tools';
export const inject = ['tools'];
export function apply(ctx) {
    registerTimeTool(ctx, capitalDatasetStore(ctx));
}
