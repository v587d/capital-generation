import { WorkspaceDatasetStore } from './data-collector/store.js';
import { ChartArtifactRegistry } from './chart/artifact-ref.js';
import { ChartSourceTokenStore } from './chart/source-token.js';
/** Structural type so tests can pass a fake ctx. */
export interface RuntimeContext {
    get(name: string): unknown;
    root?: unknown;
}
export interface CapitalShared {
    sourceTokens: ChartSourceTokenStore;
    artifacts: ChartArtifactRegistry;
}
/**
 * One Dataset store per mount, deliberately not a singleton: the hub registers source
 * capabilities once per isolate realm, so a shared hub throws `data source capability
 * already registered`. Stores only touch workspace via host fs, no state to synchronize.
 */
export declare function capitalDatasetStore(ctx: RuntimeContext): WorkspaceDatasetStore;
export declare function capitalSharedRuntime(ctx: RuntimeContext): CapitalShared;
/** Test-only: drop the per-root cache. */
export declare function resetCapitalRuntime(): void;
