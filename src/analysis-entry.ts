/**
 * `tools/analysis` row: the senior analyst's analysis family (snapshot / module run / submit).
 *
 * A family row, not a host row — the role preset mounts it and `src/tool-exec.ts` authorizes the
 * caller by preset identity. The store is built per mount (same rule as the dataset-read row).
 */
import type { Context } from '@deepseek-ai/cordis'

import { registerAnalysisTools } from './analysis/tools.js'
import { capitalDatasetStore, type RuntimeContext } from './runtime.js'

export const name = 'capital-analysis-tools'
export const inject = ['tools']

export function apply(ctx: Context): void {
  registerAnalysisTools({ ctx, store: capitalDatasetStore(ctx as unknown as RuntimeContext) })
}
