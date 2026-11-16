import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import os from 'node:os';
import { PythonRuntimeError } from './errors.js';
function normalizeArch(arch) {
    if (arch === 'amd64')
        return 'x64';
    return arch;
}
function windowsBuild(release) {
    const parts = release.split('.');
    const build = Number(parts[2]);
    return Number.isFinite(build) ? build : undefined;
}
function macosMajor(release) {
    const major = Number(release.split('.')[0]);
    return Number.isFinite(major) ? major : undefined;
}
function glibcAtLeast(version, requiredMajor, requiredMinor) {
    const [major, minor] = version.split('.').map(Number);
    if (!Number.isFinite(major) || !Number.isFinite(minor))
        return false;
    return major > requiredMajor || (major === requiredMajor && minor >= requiredMinor);
}
/** The only place that turns process.platform/arch into a supported target. */
export function detectPlatform(input = {}) {
    const platform = input.platform ?? process.platform;
    const arch = normalizeArch(input.arch ?? process.arch);
    const release = input.release ?? os.release();
    const glibc = input.glibc ?? process.report?.getReport()?.header?.glibcVersionRuntime;
    if (platform === 'win32') {
        if (arch !== 'x64') {
            return { platform, arch, target: null, supported: false, reason: 'Windows 暂只支持 x64；ARM64 运行时包尚未提供。' };
        }
        const build = windowsBuild(release);
        if (build !== undefined && build < 17763) {
            return { platform, arch, target: null, supported: false, reason: '需要 Windows 10 1809（build 17763）或更高版本。' };
        }
        return { platform, arch, target: 'win32-x64', supported: true };
    }
    if (platform === 'darwin') {
        if (arch !== 'arm64' && arch !== 'x64') {
            return { platform, arch, target: null, supported: false, reason: 'macOS 只支持 arm64 或 x64。' };
        }
        // Darwin 21 == macOS 12 (Monterey). pyarrow 25 wheels start at macOS 12.
        if ((macosMajor(release) ?? 0) < 21) {
            return { platform, arch, target: null, supported: false, reason: '需要 macOS 12（Monterey）或更高版本。' };
        }
        return { platform, arch, target: arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64', supported: true };
    }
    if (platform === 'linux') {
        if (arch !== 'x64') {
            return { platform, arch, target: null, supported: false, reason: 'Linux 首期只支持 x64；ARM64 运行时包尚未提供。' };
        }
        if (glibc === undefined || !glibcAtLeast(glibc, 2, 28)) {
            return {
                platform,
                arch,
                target: null,
                supported: false,
                reason: `需要 glibc 2.28+（当前 ${glibc ?? '未知，可能是 musl/Alpine'}）。`,
            };
        }
        return { platform, arch, target: 'linux-x64', supported: true };
    }
    return { platform, arch, target: null, supported: false, reason: `不支持的操作系统：${platform}。` };
}
/** PATH directories. Always split on node:path delimiter; ':' breaks Windows paths. */
export function pathDirs(env = process.env) {
    return (env.PATH ?? '').split(delimiter).filter((dir) => dir.length > 0);
}
function realpath(file) {
    try {
        return realpathSync(file);
    }
    catch {
        return undefined;
    }
}
function isPnpmCli(file) {
    const name = basename(file);
    return name === 'pnpm.cjs' || name === 'pnpm.mjs';
}
/** Resolve pnpm to `node <pnpm.cjs>`; bare pnpm.cmd cannot be spawned without a shell. */
export function findPnpmCli(env = process.env) {
    const override = env.CG_PNPM_CLI;
    if (override !== undefined && override !== '') {
        if (!existsSync(override))
            throw new PythonRuntimeError('pnpm-missing', `CG_PNPM_CLI 指向的文件不存在：${override}`);
        return { command: process.execPath, args: [override] };
    }
    const candidates = [];
    for (const dir of pathDirs(env)) {
        candidates.push(join(dir, 'pnpm'));
        candidates.push(join(dir, 'pnpm.cjs'));
        candidates.push(join(dir, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'));
        candidates.push(resolve(dir, '..', 'lib', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'));
        candidates.push(resolve(dir, '..', 'pnpm', 'bin', 'pnpm.cjs'));
    }
    const nodeDir = dirname(process.execPath);
    candidates.push(join(nodeDir, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'));
    for (const candidate of candidates) {
        const real = realpath(candidate);
        if (real !== undefined && isPnpmCli(real))
            return { command: process.execPath, args: [real] };
    }
    throw new PythonRuntimeError('pnpm-missing', '找不到 pnpm CLI。请确认 DSH 的插件管理器可用，或通过 CG_PNPM_CLI 指定 pnpm.cjs 的绝对路径。');
}
export function minimalSystemPath(env = process.env) {
    if ((env.SystemRoot ?? '') !== '') {
        return [join(env.SystemRoot, 'System32'), env.SystemRoot].join(delimiter);
    }
    return ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter);
}
export const pythonFlags = Object.freeze(['-I', '-B', '-u']);
export const detachedChild = process.platform !== 'win32';
/** Kill a child's process tree. POSIX children are spawned detached (own process group). */
export function killTree(pid, child, signal = 'SIGTERM') {
    if (pid === undefined) {
        child?.kill(signal);
        return Promise.resolve();
    }
    if (process.platform !== 'win32') {
        try {
            process.kill(-pid, signal);
        }
        catch {
            // ESRCH means it already exited; fall back to the direct child handle.
            try {
                child?.kill(signal);
            }
            catch { /* already gone */ }
        }
        return Promise.resolve();
    }
    return new Promise((resolvePromise) => {
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => { try {
            child?.kill(signal);
        }
        catch { /* already gone */ } resolvePromise(); });
        killer.once('close', () => resolvePromise());
    });
}
