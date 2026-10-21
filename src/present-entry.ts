/**
 * `tools/present` row: present_charts only. The root Agent's final-turn delivery step — the
 * auto-mode chart pipeline returns refs upward and the main Agent redeems them here right before
 * writing the closing answer (rationale: docs/dev/chart-delivery-events.md §6.3).
 */
import type { Context } from '@deepseek-ai/cordis'

import { createChartEventPublisher } from './chart/events.js'
import { chartEventContextOf } from './chart/event-context.js'
import { registerPresentChartsTool } from './chart/present-tool.js'
import { capitalSharedRuntimeOf } from './chart-source-entry.js'

export const name = 'capital-present-tools'
export const inject = ['tools']

export function apply(ctx: Context): void {
  const shared = capitalSharedRuntimeOf(ctx)
  registerPresentChartsTool(ctx, {
    artifacts: shared.artifacts,
    chartEvents: () => createChartEventPublisher(chartEventContextOf(ctx)),
  })
}
