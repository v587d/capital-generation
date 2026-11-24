/**
 * Host-side validation for the analysis protocol.
 *
 * Two jobs, deliberately separate:
 *  - `validateModuleResult`: the worker's output must match the manifest's `output_schema` and be
 *    lossless JSON. A module that returns `NaN` would poison every downstream number.
 *  - `validateArtifact`: the submitted artifact must be traceable — conclusion numbers need anchors,
 *    refs must exist, and the hard rules of the artifact contract must hold.
 *
 * Number traceability only covers numbers it can extract. It does NOT prove the prose is unembellished;
 * do not describe it as such.
 */
import type { AnalysisArtifact, AnalysisSnapshot, ModuleManifest, ValidationIssue } from './types.js';
type Json = Record<string, unknown>;
/** Subset of JSON Schema used by the protocol: types, properties, required, items, enum, bounds. */
export declare function validateAgainstSchema(value: unknown, schema: Json | undefined, path?: string): string[];
/** Lossless JSON: `undefined`, `NaN`, `Infinity` and array holes must not cross the boundary. */
export declare function losslessIssues(value: unknown, path?: string): string[];
export interface ModuleResultValidation {
    readonly ok: boolean;
    readonly issues: readonly ValidationIssue[];
    readonly result: Record<string, unknown> | undefined;
}
/** Validate the worker's result object: lossless, then the manifest's declared output schema. */
export declare function validateModuleResult(value: unknown, manifest: ModuleManifest): ModuleResultValidation;
export interface ArtifactValidation {
    readonly tier1: readonly ValidationIssue[];
    readonly tier2: readonly ValidationIssue[];
    readonly tier3: readonly ValidationIssue[];
}
interface NumberToken {
    readonly text: string;
    readonly value: number;
    readonly percent: boolean;
    readonly start: number;
}
/** Numeric tokens with just enough context to honour the exemption set. */
export declare function numberTokens(text: string): NumberToken[];
/**
 * Artifact validation in the three tiers of the design (Tier 1 rejects, Tier 2 downgrades to
 * `partial`, Tier 3 is advisory). Returns issues; persistence is the caller's decision.
 */
export declare function validateArtifact(artifact: AnalysisArtifact, snapshot: AnalysisSnapshot): ArtifactValidation;
export {};
