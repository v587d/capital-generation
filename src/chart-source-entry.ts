/**
 * `tools/chart-source` row: prepare_chart_source. The token store must be the same
 * instance used by `tools/chart-render`; separate stores make `render_chart` always
 * report `chart_source_expired` without throwing. Prefer the host-plane runtime, fall
 * back to the root-keyed module cache.
 */
import type { Context } from '@deepseek-ai/cordis'

import { registerChartSourceTool } from './chart/source-token.js'
import { capitalDatasetStore, capitalSharedRuntime, type CapitalShared, type RuntimeContext } from './runtime.js'

export const name = 'capital-chart-source-tools'
export const inject = ['tools']

export function apply(ctx: Context): void {
  const shared = capitalSharedRuntimeOf(ctx)
  registerChartSourceTool(ctx, { store: capitalDatasetStore(ctx as unknown as RuntimeContext), tokens: shared.sourceTokens })
}

/** Host row first, root-keyed module cache as fallback (monolith carriers). */
export function capitalSharedRuntimeOf(ctx: Context): CapitalShared {
  try {
    const hostShared = ctx.get('capitalChartRuntime') as CapitalShared | undefined
    if (hostShared !== undefined) return hostShared
  } catch {
    // Monolith carrier without the host row.
  }
  return capitalSharedRuntime(ctx as unknown as RuntimeContext)
}
