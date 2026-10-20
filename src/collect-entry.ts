/**
 * `tools/collect` row: request_data / list_capabilities / describe_capability /
 * dc_status backed by hub + 128 sources. The preset isolates hub/store to this row;
 * time tools live in `tools/time`.
 */
import type { Context } from '@deepseek-ai/cordis'

import { createCollectorRuntime } from './collector-runtime.js'
import { registerDataCollectorTools } from './data-collector/tools.js'
import { readCollectorConfig } from './capital-settings.js'

export const name = 'capital-collect-tools'
export const inject = ['tools']

export function apply(ctx: Context): void {
  const config = readCollectorConfig(ctx)
  const { hub, diagnostics } = createCollectorRuntime(ctx, config)
  registerDataCollectorTools(ctx, hub, diagnostics)
}
