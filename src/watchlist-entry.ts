/**
 * `tools/watchlist` row: get_watchlist. User assets live in host storage-domain and only
 * the main Agent mounts this row. Resolve the domain per call: memoizing an unready
 * `storageDomain` as `store_unavailable` disables it for the whole process.
 */
import type { Context } from '@deepseek-ai/cordis'

import { registerWatchlistTool } from './watchlist/tools.js'

export const name = 'capital-watchlist-tools'
export const inject = ['tools']

export function apply(ctx: Context): void {
  registerWatchlistTool(ctx)
}
