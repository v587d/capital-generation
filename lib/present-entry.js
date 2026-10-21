import { createChartEventPublisher } from './chart/events.js';
import { chartEventContextOf } from './chart/event-context.js';
import { registerPresentChartsTool } from './chart/present-tool.js';
import { capitalSharedRuntimeOf } from './chart-source-entry.js';
export const name = 'capital-present-tools';
export const inject = ['tools'];
export function apply(ctx) {
    const shared = capitalSharedRuntimeOf(ctx);
    registerPresentChartsTool(ctx, {
        artifacts: shared.artifacts,
        chartEvents: () => createChartEventPublisher(chartEventContextOf(ctx)),
    });
}
