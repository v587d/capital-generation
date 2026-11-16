import { mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PythonRuntimeError } from './errors.js';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Cross-process install lock for one pack target. The directory itself is the lock; the
 * heartbeat keeps a long download from looking stale, and a crashed owner expires by mtime.
 */
export async function withInstallLock(lockPath, fn, options = {}) {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const staleMs = options.staleMs ?? 120_000;
    const heartbeatMs = options.heartbeatMs ?? 20_000;
    const started = Date.now();
    for (;;) {
        try {
            await mkdir(lockPath, { recursive: false });
            break;
        }
        catch (error) {
            const code = error.code;
            if (code !== 'EEXIST')
                throw new PythonRuntimeError('permission', `无法创建运行时安装锁：${lockPath}`, String(error));
            try {
                const info = await stat(lockPath);
                if (Date.now() - info.mtimeMs > staleMs) {
                    await rm(lockPath, { recursive: true, force: true });
                    continue;
                }
            }
            catch {
                // The owner released it between the mkdir failure and stat; retry immediately.
                continue;
            }
            if (Date.now() - started > timeoutMs) {
                throw new PythonRuntimeError('runtime-locked', `等待运行时安装锁超时：${lockPath}`);
            }
            await sleep(250);
        }
    }
    const ownerPath = join(lockPath, 'owner.json');
    try {
        await writeFile(ownerPath, JSON.stringify({ pid: process.pid, id: randomUUID(), at: new Date().toISOString() }), 'utf8');
    }
    catch {
        // The directory lock is authoritative; owner metadata is diagnostic only.
    }
    const heartbeat = setInterval(() => {
        const now = new Date();
        void utimes(lockPath, now, now).catch(() => undefined);
    }, heartbeatMs);
    heartbeat.unref?.();
    try {
        return await fn();
    }
    finally {
        clearInterval(heartbeat);
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
    }
}
export async function readLockOwner(lockPath) {
    try {
        return await readFile(join(lockPath, 'owner.json'), 'utf8');
    }
    catch {
        return undefined;
    }
}
