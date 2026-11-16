import type { Context } from '@deepseek-ai/cordis';
import { PythonRuntimeManager } from './python-runtime/manager.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Plugin-owned Python runtime manager, provided once by the host-plane row. */
        pythonRuntime: PythonRuntimeManager;
    }
}
export declare const name = "python-runtime";
export declare function apply(ctx: Context): void;
