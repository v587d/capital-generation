import { fileURLToPath } from 'node:url';
import { PythonRuntimeManager } from './python-runtime/manager.js';
import { readManifest } from './python-runtime/manifest.js';
import { detectPlatform } from './python-runtime/platform.js';
import { createPythonRuntimeHandler } from './python-runtime/routes.js';
import { resolveDshHome } from './python-runtime/paths.js';
export const name = 'python-runtime';
export function apply(ctx) {
    if (ctx.get('pythonRuntime') !== undefined) {
        ctx.logger?.error?.('python-runtime: 服务已存在，拒绝重复 provide。');
        return;
    }
    const profile = ctx.get('profileContext');
    const manifestPath = fileURLToPath(new URL('../runtime/manifest.json', import.meta.url));
    const target = detectPlatform();
    let manifest;
    try {
        manifest = readManifest(manifestPath);
    }
    catch (error) {
        ctx.logger?.error?.(`python-runtime: ${String(error)}`);
        return;
    }
    const manager = new PythonRuntimeManager({
        manifest,
        dshHome: resolveDshHome(profile?.home),
        workerPath: fileURLToPath(new URL('../python/worker.py', import.meta.url)),
        target,
        ...(profile?.dir === undefined ? {} : { profileDir: profile.dir }),
        ...(profile?.packageManager === undefined ? {} : { packageManager: profile.packageManager }),
        ...(process.env.CG_PYTHON_REGISTRY === undefined ? {} : { registry: process.env.CG_PYTHON_REGISTRY }),
        logger: ctx.logger,
    });
    ctx.provide('pythonRuntime', manager);
    ctx.effect(() => () => { void manager.dispose(); }, 'python-runtime: dispose');
    ctx.inject(['webServer'], (webCtx) => {
        const web = webCtx;
        const authorize = (req) => {
            let connection;
            try {
                connection = ctx.get('connection');
            }
            catch {
                return 401;
            }
            if (connection === undefined || connection === null)
                return undefined;
            if (typeof connection.requestRejection !== 'function')
                return undefined;
            return connection.requestRejection(req);
        };
        const handler = createPythonRuntimeHandler(manager, authorize);
        web.effect(() => web.webServer.register({
            kind: 'prefix',
            path: '/python-runtime',
            handler: handler,
        }), 'python-runtime: HTTP routes');
    });
    ctx.logger?.info?.(`python-runtime: active (${target.target ?? 'unsupported'})`);
}
