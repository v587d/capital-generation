import { registerChartTool } from './chart/tool.js';
import { capitalDatasetStore } from './runtime.js';
import { capitalSharedRuntimeOf } from './chart-source-entry.js';
export const name = 'capital-chart-render-tools';
export const inject = ['tools'];
export function apply(ctx) {
    const shared = capitalSharedRuntimeOf(ctx);
    registerChartTool(ctx, {
        store: capitalDatasetStore(ctx),
        sourceTokens: shared.sourceTokens,
        artifacts: shared.artifacts,
        charts: () => ctx.get('capitalCharts'),
    });
}
