import { PythonRuntimeError } from './errors.js';
export interface PnpmInvocation {
    command: string;
    args: string[];
    env?: Record<string, string>;
}
export interface PnpmRunResult {
    code: number | null;
    output: string;
    timedOut: boolean;
    aborted: boolean;
}
export interface PnpmRunOptions {
    cwd: string;
    timeoutMs: number;
    signal?: AbortSignal;
    env?: Record<string, string>;
    maxOutputBytes?: number;
}
/** Run pnpm without a shell. The caller owns the exact package spec (never model input). */
export declare function runPnpm(invocation: PnpmInvocation, args: string[], options: PnpmRunOptions): Promise<PnpmRunResult>;
export declare function classifyPnpmFailure(result: PnpmRunResult): PythonRuntimeError;
export declare function writeInstallProject(payloadDir: string, packageName: string, spec: string, registry?: string): Promise<void>;
export declare function installArgs(payloadDir: string, storeDir: string, registry?: string): string[];
