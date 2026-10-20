/**
 * `tools/dataset-read` row: describe / inspect / profile / query_dataset + write_profile.
 * Each row builds its own store (no shared memory state; a shared hub would collide).
 * Raw rows never leave these tools — only summaries, structure and controlled aggregates.
 */
import type { Context } from '@deepseek-ai/cordis'

import { registerDatasetTools } from './data-collector/dataset-tools.js'
import { capitalDatasetStore, type RuntimeContext } from './runtime.js'

export const name = 'capital-dataset-read-tools'
export const inject = ['tools']

export function apply(ctx: Context): void {
  registerDatasetTools(ctx, capitalDatasetStore(ctx as unknown as RuntimeContext))
}
