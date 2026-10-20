/**
 * Hide delegation-only role presets from the host's new-session roster.
 *
 * The registry has no hidden flag. `remoteExportList()` is what the remote `agentPresets/list`
 * endpoint invokes, so wrapping it changes the selector without touching `list()`, `resolve()`,
 * delegation or settings management. Fail open: unknown shapes and missing methods leave the
 * roster untouched, and fiber cleanup restores the original property descriptor.
 */
import type { Context } from '@deepseek-ai/cordis';
type EffectContext = {
    effect?: (execute: () => () => void, label?: string) => unknown;
};
/** Drop internal rows without mutating the caller's array; unknown shapes pass through. */
export declare function filterPresetRoster(value: unknown): unknown;
/**
 * Install on one registry instance. Returns false when the host exposes no roster method or the
 * property cannot be shadowed; callers then behave exactly as if this filter did not exist.
 */
export declare function installPresetRosterFilter(service: unknown, ctx: EffectContext): boolean;
/** Wait for the registry service, then filter its remote roster. */
export declare function registerPresetRosterFilter(ctx: Context): void;
export {};
