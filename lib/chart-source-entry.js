import { registerChartSourceTool } from './chart/source-token.js';
import { capitalDatasetStore, capitalSharedRuntime } from './runtime.js';
export const name = 'capital-chart-source-tools';
export const inject = ['tools'];
export function apply(ctx) {
    const shared = capitalSharedRuntimeOf(ctx);
    registerChartSourceTool(ctx, { store: capitalDatasetStore(ctx), tokens: shared.sourceTokens });
}
/** Host row first, root-keyed module cache as fallback (monolith carriers). */
export function capitalSharedRuntimeOf(ctx) {
    try {
        const hostShared = ctx.get('capitalChartRuntime');
        if (hostShared !== undefined)
            return hostShared;
    }
    catch {
        // Monolith carrier without the host row.
    }
    return capitalSharedRuntime(ctx);
}
