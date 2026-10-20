import { capitalSharedRuntime } from './runtime.js';
export const name = 'capital-runtime';
export function apply(ctx) {
    ctx.provide('capitalChartRuntime', capitalSharedRuntime(ctx));
}
