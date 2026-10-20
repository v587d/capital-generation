/**
 * Hide delegation-only role presets from the host's new-session roster.
 *
 * The registry has no hidden flag. `remoteExportList()` is what the remote `agentPresets/list`
 * endpoint invokes, so wrapping it changes the selector without touching `list()`, `resolve()`,
 * delegation or settings management. Fail open: unknown shapes and missing methods leave the
 * roster untouched, and fiber cleanup restores the original property descriptor.
 */
import type { Context } from '@deepseek-ai/cordis'
import { isInternalRolePresetId } from '../preset-ids.js'

type RosterMethod = 'remoteExportList' | 'list'
type RosterService = Record<string, unknown>
type EffectContext = {
  effect?: (execute: () => () => void, label?: string) => unknown
}

// A future host may serve `agentPresets/list` straight from `list`; prefer the dedicated export.
const METHODS: readonly RosterMethod[] = ['remoteExportList', 'list']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isInternalRow(row: unknown): boolean {
  return isRecord(row) && isInternalRolePresetId(row.id)
}

/** Drop internal rows without mutating the caller's array; unknown shapes pass through. */
export function filterPresetRoster(value: unknown): unknown {
  try {
    if (Array.isArray(value)) return value.filter((row) => !isInternalRow(row))
    if (!isRecord(value) || !Array.isArray(value.presets)) return value
    return { ...value, presets: value.presets.filter((row) => !isInternalRow(row)) }
  } catch {
    return value
  }
}

function pickMethod(service: RosterService): RosterMethod | undefined {
  return METHODS.find((method) => typeof service[method] === 'function')
}

/**
 * Install on one registry instance. Returns false when the host exposes no roster method or the
 * property cannot be shadowed; callers then behave exactly as if this filter did not exist.
 */
export function installPresetRosterFilter(service: unknown, ctx: EffectContext): boolean {
  if (!isRecord(service)) return false
  const method = pickMethod(service)
  if (method === undefined) return false
  const original = service[method]
  if (typeof original !== 'function') return false
  const previous = Object.getOwnPropertyDescriptor(service, method)
  const wrapper = (...args: unknown[]): unknown => {
    const result = original.call(service, ...args)
    try {
      if (isRecord(result) && typeof result.then === 'function') {
        return (result as unknown as PromiseLike<unknown>).then((value) => filterPresetRoster(value))
      }
      return filterPresetRoster(result)
    } catch {
      return result
    }
  }
  try {
    Object.defineProperty(service, method, {
      configurable: true,
      enumerable: previous?.enumerable ?? false,
      writable: true,
      value: wrapper,
    })
  } catch {
    return false
  }
  const restore = () => {
    if (service[method] !== wrapper) return
    try {
      if (previous === undefined) delete service[method]
      else Object.defineProperty(service, method, previous)
    } catch {
    }
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => restore, 'capital-preset-roster')
  return true
}

/** Wait for the registry service, then filter its remote roster. */
export function registerPresetRosterFilter(ctx: Context): void {
  const host = ctx as unknown as {
    inject?: (deps: string[], callback: (injected: EffectContext & { agentPresets?: unknown }) => void) => unknown
  }
  if (typeof host.inject !== 'function') return
  host.inject(['agentPresets'], (injected) => {
    installPresetRosterFilter(injected.agentPresets, injected)
  })
}
