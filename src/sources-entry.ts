/**
 * `tools/retrieve-sources` row: the nine named-source tools, gated by
 * `localFetch.enabled`. When disabled they stay registered and fail loudly per call;
 * unregistering at boot would freeze one config read for the process lifetime.
 */
import type { Context } from '@deepseek-ai/cordis'

import { createRetrieverRuntime } from './retriever-runtime.js'
import { registerSourceTools } from './web-retriever/tools.js'
import { readRetrieverConfig } from './capital-settings.js'

export const name = 'capital-retrieve-sources-tools'
export const inject = ['tools']

export function apply(ctx: Context): void {
  const runtime = createRetrieverRuntime(ctx, readRetrieverConfig(ctx))
  registerSourceTools(ctx, { ...runtime.localFetchConfig })
}
