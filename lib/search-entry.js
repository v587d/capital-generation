import { createRetrieverRuntime } from './retriever-runtime.js';
import { registerSearchTools } from './web-retriever/tools.js';
import { readRetrieverConfig } from './capital-settings.js';
export const name = 'capital-retrieve-search-tools';
export const inject = ['tools'];
export function apply(ctx) {
    const runtime = createRetrieverRuntime(ctx, readRetrieverConfig(ctx));
    registerSearchTools(ctx, runtime.retriever, runtime.windClient);
}
