/**
 * `tools/ocr` row: PaddleOCR job -> markdown -> disk. The `url` vs `file` / `doc_id`
 * split is a call-level guard in `root-tool-policy` (name-level deny cannot express it).
 * Client construction is per mount; credentials resolve per call.
 */
import type { Context } from '@deepseek-ai/cordis'

import { registerOcrTool } from './web-retriever/tools.js'
import { createRetrieverRuntime } from './retriever-runtime.js'
import { capitalDatasetStore, type RuntimeContext } from './runtime.js'
import { readRetrieverConfig } from './capital-settings.js'

export const name = 'capital-ocr-tools'
export const inject = ['tools']

export function apply(ctx: Context): void {
  const runtime = createRetrieverRuntime(ctx, readRetrieverConfig(ctx))
  registerOcrTool(ctx, { store: capitalDatasetStore(ctx as unknown as RuntimeContext), client: runtime.ocrClient })
}
