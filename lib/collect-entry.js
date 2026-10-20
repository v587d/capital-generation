import { createCollectorRuntime } from './collector-runtime.js';
import { registerDataCollectorTools } from './data-collector/tools.js';
import { readCollectorConfig } from './capital-settings.js';
export const name = 'capital-collect-tools';
export const inject = ['tools'];
export function apply(ctx) {
    const config = readCollectorConfig(ctx);
    const { hub, diagnostics } = createCollectorRuntime(ctx, config);
    registerDataCollectorTools(ctx, hub, diagnostics);
}
