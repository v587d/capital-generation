/**
 * Adapt a cordis ctx into ChartEventContext.
 * Never spread ctx (`{ ...ctx }`): get/on/effect live on the prototype, so spreading drops them
 * and delivery silently disappears. Forward each method with the original ctx as receiver.
 * One assembly path serves both the monolith plugin and the tools/chart entry.
 */
import type { ChartEventContext } from './events.js'

interface RawChartContext {
  get: (name: string) => unknown
  on?: (event: string, listener: (...args: unknown[]) => unknown) => unknown
  root?: unknown
  effect?: unknown
}

export function chartEventContextOf(ctx: unknown): ChartEventContext {
  const raw = ctx as RawChartContext
  const context: ChartEventContext = {
    get: (name: string) => raw.get(name),
    // Failed registration returns undefined so events.ts can fall back to turn/start.
    on: (event: string, listener: (...args: unknown[]) => void) => {
      if (typeof raw.on !== 'function') return undefined
      return raw.on.call(ctx, event, (...args: unknown[]) => { listener(...args) })
    },
    onTurnStopping: (listener) => {
      if (typeof raw.on !== 'function') return undefined
      try {
        return raw.on.call(ctx, 'agent/turn-stopping', (...args: unknown[]) => { listener(...args) })
      } catch {
        return undefined
      }
    },
  }
  // root/effect are cordis getters: forward only when present.
  try {
    if (raw.root !== undefined) {
      Object.defineProperty(context, 'root', { get: () => raw.root as ChartEventContext, enumerable: true })
    }
  } catch { /* root unavailable: events.ts falls back to self */ }
  try {
    if (typeof raw.effect === 'function') {
      Object.defineProperty(context, 'effect', {
        value: (callback: () => unknown, label?: string) => (raw.effect as (cb: () => unknown, l?: string) => unknown).call(ctx, callback, label),
        enumerable: true,
      })
    }
  } catch { /* no disposer support */ }
  return context
}
