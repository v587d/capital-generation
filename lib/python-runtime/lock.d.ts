export interface InstallLockOptions {
    timeoutMs?: number;
    staleMs?: number;
    heartbeatMs?: number;
}
/**
 * Cross-process install lock for one pack target. The directory itself is the lock; the
 * heartbeat keeps a long download from looking stale, and a crashed owner expires by mtime.
 */
export declare function withInstallLock<T>(lockPath: string, fn: () => Promise<T>, options?: InstallLockOptions): Promise<T>;
export declare function readLockOwner(lockPath: string): Promise<string | undefined>;
