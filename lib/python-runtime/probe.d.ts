import type { ProbeReport } from './types.js';
export interface ProbeOptions {
    python: string;
    workerPath: string;
    sitePackages: string[];
    homeDir: string;
    tempDir: string;
    timeoutMs: number;
    signal?: AbortSignal;
    env?: Record<string, string | undefined>;
}
/** Run the private interpreter once and require its self-check JSON. */
export declare function probePython(options: ProbeOptions): Promise<ProbeReport>;
