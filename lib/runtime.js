import { WorkspaceDatasetStore } from './data-collector/store.js';
import { ChartArtifactRegistry } from './chart/artifact-ref.js';
import { ChartSourceTokenStore } from './chart/source-token.js';
/**
 * One Dataset store per mount, deliberately not a singleton: the hub registers source
 * capabilities once per isolate realm, so a shared hub throws `data source capability
 * already registered`. Stores only touch workspace via host fs, no state to synchronize.
 */
export function capitalDatasetStore(ctx) {
    return new WorkspaceDatasetStore({
        fs: ctx.get('fs'),
        sandboxPolicy: ctx.get('sandboxPolicy'),
    });
}
/**
 * Process-wide state shared by every mounted preset; `apply()` runs once per role preset.
 * Per-role token stores would make `render_chart` silently report `chart_source_expired`.
 * Key by `ctx.root` (stable) because mount points differ per application.
 */
const cached = new Map();
export function capitalSharedRuntime(ctx) {
    const ref = ctx.root ?? ctx;
    const existing = cached.get(ref);
    if (existing !== undefined)
        return existing;
    const shared = { sourceTokens: new ChartSourceTokenStore(), artifacts: new ChartArtifactRegistry() };
    cached.set(ref, shared);
    return shared;
}
/** Test-only: drop the singleton cache. */
export function resetCapitalRuntime() {
    cached.clear();
}
