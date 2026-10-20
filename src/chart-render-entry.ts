/**
 * `tools/chart-render` row: render_chart only. Row-level expression of "only the
 * visualization specialist holds the chart pipeline"; shares token/artifact state with
 * `tools/chart-source`.
 */
import type { Context } from '@deepseek-ai/cordis'

import { createChartEventPublisher } from './chart/events.js'
import { chartEventContextOf } from './chart/event-context.js'
import { registerChartTool, type ChartPublisher } from './chart/tool.js'
import { capitalDatasetStore, type RuntimeContext } from './runtime.js'
import { capitalSharedRuntimeOf } from './chart-source-entry.js'

export const name = 'capital-chart-render-tools'
export const inject = ['tools']

export function apply(ctx: Context): void {
  const shared = capitalSharedRuntimeOf(ctx)
  registerChartTool(ctx, {
    store: capitalDatasetStore(ctx as unknown as RuntimeContext),
    sourceTokens: shared.sourceTokens,
    artifacts: shared.artifacts,
    charts: () => ctx.get('capitalCharts') as ChartPublisher | undefined,
    chartEvents: () => createChartEventPublisher(chartEventContextOf(ctx)),
  })
}
