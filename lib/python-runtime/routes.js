import { PythonRuntimeError, isPythonRuntimeError, messageOf } from './errors.js';
import { normalizePackNames } from './manifest.js';
const ROUTE = '/python-runtime';
const MAX_BODY = 16 * 1024;
function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.end(text);
}
function sendError(res, error) {
    if (!isPythonRuntimeError(error)) {
        sendJson(res, 500, { error: { code: 'unknown', message: messageOf(error) } });
        return;
    }
    const status = error.code === 'invalid-request' ? 400
        : error.code === 'unsupported-platform' || error.code === 'runtime-not-ready' || error.code === 'busy' || error.code === 'runtime-locked' ? 409
            : error.code === 'network' || error.code === 'not-found' ? 502
                : error.code === 'disk-space' ? 507
                    : 500;
    sendJson(res, status, { error: { code: error.code, message: error.message } });
}
async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_BODY)
            throw new PythonRuntimeError('invalid-request', '请求体超过 16 KB。');
        chunks.push(buffer);
    }
    if (chunks.length === 0)
        return {};
    let value;
    try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        throw new PythonRuntimeError('invalid-request', '请求体不是合法 JSON。');
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new PythonRuntimeError('invalid-request', '请求体必须是 JSON 对象。');
    }
    return value;
}
function packBody(value) {
    if (value !== 'base' && value !== 'parquet')
        throw new PythonRuntimeError('invalid-request', 'pack 必须是 base 或 parquet。');
    return value;
}
/** HTTP surface for the settings card and CLI-like clients. */
export function createPythonRuntimeHandler(manager, authorize) {
    return async (req, res) => {
        try {
            let rejection;
            try {
                rejection = authorize?.(req);
            }
            catch {
                rejection = 401;
            }
            if (rejection !== undefined && rejection !== null) {
                res.statusCode = rejection;
                res.setHeader('content-type', 'text/plain; charset=utf-8');
                res.setHeader('cache-control', 'no-store');
                res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
                return;
            }
            const url = new URL(req.url ?? '/', 'http://localhost');
            const pathname = url.pathname;
            if (pathname !== ROUTE && !pathname.startsWith(`${ROUTE}/`)) {
                sendJson(res, 404, { error: { code: 'not-found', message: 'not found' } });
                return;
            }
            const suffix = pathname.slice(ROUTE.length);
            const method = req.method ?? 'GET';
            if (suffix === '/status') {
                if (method !== 'GET') {
                    sendJson(res, 405, { error: { code: 'method-not-allowed', message: 'GET only' } });
                    return;
                }
                sendJson(res, 200, await manager.status());
                return;
            }
            if (suffix === '/prepare') {
                if (method !== 'POST') {
                    sendJson(res, 405, { error: { code: 'method-not-allowed', message: 'POST only' } });
                    return;
                }
                const body = await readJson(req);
                const packs = normalizePackNames(body.packs);
                sendJson(res, 202, { job: manager.prepare(packs) });
                return;
            }
            if (suffix.startsWith('/jobs/')) {
                if (method !== 'GET') {
                    sendJson(res, 405, { error: { code: 'method-not-allowed', message: 'GET only' } });
                    return;
                }
                const id = suffix.slice('/jobs/'.length);
                if (id === '' || id.includes('/'))
                    throw new PythonRuntimeError('invalid-request', 'job id 不合法。');
                const job = manager.getJob(id);
                if (job === undefined) {
                    sendJson(res, 404, { error: { code: 'not-found', message: 'job not found' } });
                    return;
                }
                sendJson(res, 200, { job });
                return;
            }
            if (suffix === '/cancel') {
                if (method !== 'POST') {
                    sendJson(res, 405, { error: { code: 'method-not-allowed', message: 'POST only' } });
                    return;
                }
                const body = await readJson(req);
                if (typeof body.jobId !== 'string' || body.jobId === '')
                    throw new PythonRuntimeError('invalid-request', 'jobId 必须是非空字符串。');
                sendJson(res, 200, { cancelled: manager.cancel(body.jobId) });
                return;
            }
            if (suffix === '/remove') {
                if (method !== 'POST') {
                    sendJson(res, 405, { error: { code: 'method-not-allowed', message: 'POST only' } });
                    return;
                }
                const body = await readJson(req);
                if (body.confirm !== true)
                    throw new PythonRuntimeError('invalid-request', '移除运行时必须显式 confirm: true。');
                const pack = packBody(body.pack);
                await manager.remove(pack);
                sendJson(res, 200, { removed: pack });
                return;
            }
            if (suffix === '/verify') {
                if (method !== 'POST') {
                    sendJson(res, 405, { error: { code: 'method-not-allowed', message: 'POST only' } });
                    return;
                }
                sendJson(res, 200, { probe: await manager.verify() });
                return;
            }
            sendJson(res, 404, { error: { code: 'not-found', message: 'not found' } });
        }
        catch (error) {
            sendError(res, error);
        }
    };
}
