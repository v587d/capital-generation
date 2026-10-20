/**
 * `tools/retrieve-search` row: anysearch_search / web_retriever_fetch / wind_docs_*.
 * Split from source and OCR rows; all share `retriever-runtime.ts` and resolve
 * credentials per call.
 */
import type { Context } from '@deepseek-ai/cordis'

import { createRetrieverRuntime } from './retriever-runtime.js'
import { registerSearchTools } from './web-retriever/tools.js'
import { readRetrieverConfig } from './capital-settings.js'

export const name = 'capital-retrieve-search-tools'
export const inject = ['tools']

export function apply(ctx: Context): void {
  const runtime = createRetrieverRuntime(ctx, readRetrieverConfig(ctx))
  registerSearchTools(ctx, runtime.retriever, runtime.windClient)
}
