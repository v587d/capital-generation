/**
 * Host-plane Capital runtime row. Chart source tokens are issued by data_junior and
 * redeemed by the specialist, so both presets must see one registry; provide it here
 * instead of per preset. The module-level cache still keys by root for older call sites.
 */
import type { Context } from '@deepseek-ai/cordis'

import { detectDshVersion, unverifiedHostWarning } from './host-version.js'
import { capitalSharedRuntime, type CapitalShared } from './runtime.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Shared by the Capital root, junior and specialist presets. */
    capitalChartRuntime: CapitalShared
  }
}

export const name = 'capital-runtime'

export function apply(ctx: Context): void {
  // `engines.dsh` already keeps an out-of-window host from importing this package; reaching here on
  // an unverified version means "same minor, untested patch" and users need one line to paste into an
  // issue. `ctx.logger` is buffered into boot diagnostics only (no terminal exporter), so this goes
  // to stderr directly.
  const hostWarning = unverifiedHostWarning(detectDshVersion())
  if (hostWarning !== undefined) console.warn(hostWarning)
  ctx.provide('capitalChartRuntime', capitalSharedRuntime(ctx))
}
