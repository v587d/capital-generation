import type { TargetId } from './types.js';
export interface PlatformFacts {
    platform: string;
    arch: string;
    target: TargetId | null;
    supported: boolean;
    reason?: string;
}
export interface PlatformProbeInput {
    platform?: string;
    arch?: string;
    release?: string;
    glibc?: string;
}
type EnvLike = Record<string, string | undefined>;
/** The only place that turns process.platform/arch into a supported target. */
export declare function detectPlatform(input?: PlatformProbeInput): PlatformFacts;
/** PATH directories. Always split on node:path delimiter; ':' breaks Windows paths. */
export declare function pathDirs(env?: EnvLike): string[];
/** Resolve pnpm to `node <pnpm.cjs>`; bare pnpm.cmd cannot be spawned without a shell. */
export declare function findPnpmCli(env?: EnvLike): {
    command: string;
    args: string[];
};
export declare function minimalSystemPath(env?: EnvLike): string;
export declare const pythonFlags: readonly string[];
export declare const detachedChild: boolean;
/** Kill a child's process tree. POSIX children are spawned detached (own process group). */
export declare function killTree(pid: number | undefined, child: {
    kill(signal?: NodeJS.Signals): boolean;
} | undefined, signal?: NodeJS.Signals): Promise<void>;
export {};
