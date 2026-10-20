/**
 * Single reader for an Agent's preset claim. Callers differ only in the fail direction:
 * root convergence assumes a claim, role surfaces skip convergence, tool authorization
 * falls back to the old topology check (which is never broader). Any exception is folded
 * into flags, never thrown, because callers sit on the Agent creation path.
 */
/** Registry surface unavailable, or `composedPreset` threw (see `failed`). */
export interface PresetClaimResult {
    /** Raw `composedPreset` value; undefined means unbound Agent or a throw. */
    readonly claim: string | undefined;
    readonly registryMissing: boolean;
    /** `composedPreset` threw; distinct from "no preset bound". */
    readonly failed: boolean;
}
interface ReadableContext {
    get?(name: string): unknown;
    readonly [key: string]: unknown;
}
export declare function readPresetClaim(ctx: ReadableContext | undefined, agent: {
    ctx?: unknown;
} | undefined): PresetClaimResult;
export {};
