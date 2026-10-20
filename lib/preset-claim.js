/**
 * Single reader for an Agent's preset claim. Callers differ only in the fail direction:
 * root convergence assumes a claim, role surfaces skip convergence, tool authorization
 * falls back to the old topology check (which is never broader). Any exception is folded
 * into flags, never thrown, because callers sit on the Agent creation path.
 */
export function readPresetClaim(ctx, agent) {
    let presets;
    try {
        presets = ctx?.get?.('agentPresets');
    }
    catch {
        return { claim: undefined, registryMissing: true, failed: false };
    }
    if (presets === undefined || typeof presets.composedPreset !== 'function') {
        return { claim: undefined, registryMissing: true, failed: false };
    }
    try {
        return { claim: presets.composedPreset(agent?.ctx), registryMissing: false, failed: false };
    }
    catch {
        return { claim: undefined, registryMissing: false, failed: true };
    }
}
