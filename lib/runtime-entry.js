import { detectDshVersion, unverifiedHostWarning } from './host-version.js';
import { capitalSharedRuntime } from './runtime.js';
export const name = 'capital-runtime';
export function apply(ctx) {
    // `engines.dsh` already keeps an out-of-window host from importing this package; reaching here on
    // an unverified version means "same minor, untested patch" and users need one line to paste into an
    // issue. `ctx.logger` is buffered into boot diagnostics only (no terminal exporter), so this goes
    // to stderr directly.
    const hostWarning = unverifiedHostWarning(detectDshVersion());
    if (hostWarning !== undefined)
        console.warn(hostWarning);
    ctx.provide('capitalChartRuntime', capitalSharedRuntime(ctx));
}
