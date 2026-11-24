import type { ModuleManifest } from './types.js';
export interface AnalysisModuleEntry {
    readonly manifest: ModuleManifest;
    /** Absolute directory handed to the worker; always inside the package. */
    readonly dir: string;
    readonly entrypoint: string;
}
/** Registered modules, manifest-normalized. Throws when a registered module cannot be read. */
export declare function listAnalysisModules(): readonly AnalysisModuleEntry[];
export declare function analysisModuleById(moduleId: string): AnalysisModuleEntry | undefined;
/** Test-only: drop the manifest cache so a fixture rewrite is visible. */
export declare function resetAnalysisModuleCache(): void;
