import { createRetrieverRuntime } from './retriever-runtime.js';
import { registerSourceTools } from './web-retriever/tools.js';
import { readRetrieverConfig } from './capital-settings.js';
export const name = 'capital-retrieve-sources-tools';
export const inject = ['tools'];
export function apply(ctx) {
    const runtime = createRetrieverRuntime(ctx, readRetrieverConfig(ctx));
    registerSourceTools(ctx, { ...runtime.localFetchConfig });
}
