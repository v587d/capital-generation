import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { PythonRuntimeError } from './errors.js';
import { pythonChildEnv } from './child-env.js';
import { detachedChild, killTree, pythonFlags } from './platform.js';
/** Tail kept per stream; probes and scripts only ever surface the end of a traceback. */
const OUTPUT_LIMIT = 64 * 1024;
/**
 * Spawn the private interpreter once. Timeout kills the whole child tree, abort behaves the same
 * without becoming an error here: callers map the flags to their own `timeout` / `cancelled` codes.
 */
export async function runWorkerProcess(options) {
    return await new Promise((resolvePromise) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;
        const child = spawn(options.python, options.args, {
            cwd: options.cwd,
            env: options.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            detached: detachedChild,
        });
        const timer = setTimeout(() => {
            timedOut = true;
            void killTree(child.pid, child, 'SIGTERM');
            setTimeout(() => { void killTree(child.pid, child, 'SIGKILL'); }, 2_000).unref?.();
        }, options.timeoutMs);
        timer.unref?.();
        const abort = () => { void killTree(child.pid, child, 'SIGTERM'); };
        options.signal?.addEventListener('abort', abort, { once: true });
        const finish = (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
            resolvePromise({ code, stdout, stderr, timedOut, aborted: options.signal?.aborted === true });
        };
        child.stdout?.on('data', (chunk) => { stdout = (stdout + chunk.toString('utf8')).slice(-OUTPUT_LIMIT); });
        child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-OUTPUT_LIMIT); });
        child.once('error', (error) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
            resolvePromise({ code: null, stdout, stderr, timedOut, aborted: options.signal?.aborted === true, spawnError: String(error) });
        });
        child.once('close', (code) => finish(code));
    });
}
function parseReport(output) {
    const line = output.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean).at(-1);
    if (line === undefined)
        throw new PythonRuntimeError('probe-failed', 'Python probe 没有输出。');
    let value;
    try {
        value = JSON.parse(line);
    }
    catch {
        throw new PythonRuntimeError('probe-failed', 'Python probe 输出不是 JSON。', output);
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new PythonRuntimeError('probe-failed', 'Python probe 输出不是对象。', output);
    }
    const raw = value;
    if (typeof raw.pythonVersion !== 'string'
        || typeof raw.executable !== 'string'
        || typeof raw.platform !== 'string'
        || typeof raw.arch !== 'string'
        || !Array.isArray(raw.sitePackages)
        || raw.sitePackages.some((item) => typeof item !== 'string')
        || raw.packages === null
        || typeof raw.packages !== 'object'
        || Array.isArray(raw.packages)) {
        throw new PythonRuntimeError('probe-failed', 'Python probe 字段不完整。', output);
    }
    return raw;
}
/** Run the private interpreter once and require its self-check JSON. */
export async function probePython(options) {
    await mkdir(options.homeDir, { recursive: true });
    await mkdir(options.tempDir, { recursive: true });
    const env = pythonChildEnv({
        pythonDir: options.python.replace(/[\\/][^\\/]+$/u, ''),
        homeDir: options.homeDir,
        tempDir: options.tempDir,
        baseEnv: options.env ?? process.env,
    });
    const args = [
        ...pythonFlags,
        options.workerPath,
        'probe',
        ...options.sitePackages.flatMap((path) => ['--site-packages', path]),
    ];
    const result = await runWorkerProcess({
        python: options.python,
        args,
        cwd: options.tempDir,
        env,
        timeoutMs: options.timeoutMs,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (result.spawnError !== undefined) {
        throw new PythonRuntimeError('probe-failed', `启动 Python 失败：${result.spawnError}`);
    }
    if (result.timedOut)
        throw new PythonRuntimeError('timeout', 'Python probe 超时。', result.stderr);
    if (result.aborted)
        throw new PythonRuntimeError('cancelled', undefined, result.stderr);
    if (result.code !== 0) {
        throw new PythonRuntimeError('probe-failed', `Python probe 退出码 ${String(result.code)}。`, result.stderr || result.stdout);
    }
    return parseReport(result.stdout);
}
