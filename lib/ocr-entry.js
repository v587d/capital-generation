import { registerOcrTool } from './web-retriever/tools.js';
import { createRetrieverRuntime } from './retriever-runtime.js';
import { capitalDatasetStore } from './runtime.js';
import { readRetrieverConfig } from './capital-settings.js';
export const name = 'capital-ocr-tools';
export const inject = ['tools'];
export function apply(ctx) {
    const runtime = createRetrieverRuntime(ctx, readRetrieverConfig(ctx));
    registerOcrTool(ctx, { store: capitalDatasetStore(ctx), client: runtime.ocrClient });
}
