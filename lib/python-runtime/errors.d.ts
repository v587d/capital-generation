export type PythonRuntimeErrorCode = 'unsupported-platform' | 'manifest-invalid' | 'runtime-not-ready' | 'data-runtime-not-ready' | 'runtime-locked' | 'pnpm-missing' | 'network' | 'not-found' | 'disk-space' | 'permission' | 'probe-failed' | 'script-failed' | 'timeout' | 'cancelled' | 'pack-invalid' | 'busy' | 'invalid-request' | 'unknown';
export declare class PythonRuntimeError extends Error {
    readonly code: PythonRuntimeErrorCode;
    readonly diagnostics?: string;
    constructor(code: PythonRuntimeErrorCode, message?: string, diagnostics?: string);
}
export declare function isPythonRuntimeError(value: unknown): value is PythonRuntimeError;
export declare function messageOf(value: unknown): string;
