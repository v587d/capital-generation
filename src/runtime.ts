import { WorkspaceDatasetStore, type FsLike, type SandboxPolicyLike } from './data-collector/store.js'
import { ChartArtifactRegistry } from './chart/artifact-ref.js'
import { ChartSourceTokenStore } from './chart/source-token.js'

/** Structural type so tests can pass a fake ctx. */
export interface RuntimeContext {
  get(name: string): unknown
  root?: unknown
}

export interface CapitalShared {
  sourceTokens: ChartSourceTokenStore
  artifacts: ChartArtifactRegistry
}

/**
 * One Dataset store per mount, deliberately not a singleton: the hub registers source
 * capabilities once per isolate realm, so a shared hub throws `data source capability
 * already registered`. Stores only touch workspace via host fs, no state to synchronize.
 */
export function capitalDatasetStore(ctx: RuntimeContext): WorkspaceDatasetStore {
  return new WorkspaceDatasetStore({
    fs: ctx.get('fs') as FsLike | undefined,
    sandboxPolicy: ctx.get('sandboxPolicy') as SandboxPolicyLike | undefined,
  })
}

/**
 * Process-wide state shared by every mounted preset; `apply()` runs once per role preset.
 * Per-role token stores would make `render_chart` silently report `chart_source_expired`.
 * Key by `ctx.root` (stable) because mount points differ per application.
 */
const cached = new Map<unknown, CapitalShared>()

export function capitalSharedRuntime(ctx: RuntimeContext): CapitalShared {
  const ref = ctx.root ?? ctx
  const existing = cached.get(ref)
  if (existing !== undefined) return existing
  const shared = { sourceTokens: new ChartSourceTokenStore(), artifacts: new ChartArtifactRegistry() }
  cached.set(ref, shared)
  return shared
}

/** Test-only: drop the singleton cache. */
export function resetCapitalRuntime(): void {
  cached.clear()
}
