export interface PythonEnvOptions {
    pythonDir: string;
    homeDir: string;
    tempDir: string;
    baseEnv?: Record<string, string | undefined>;
}
/**
 * Minimal environment for the private interpreter. `-I` already ignores PYTHON* variables; this
 * also removes native-loader variables and keeps the child from reading the user's home/config.
 */
export declare function pythonChildEnv(options: PythonEnvOptions): Record<string, string>;
