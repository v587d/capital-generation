/**
 * `/capital-automation/*` route. Authentication is the first statement: a rejected request
 * never reads the body, a task id, or storage. Bodies are strict JSON and capped before parsing.
 */
import { MAX_REQUEST_BODY_BYTES } from './defaults.js'
import { AutomationError } from './service.js'
import { SchemaError } from './schema.js'
import { sanitizeMessage } from './redact.js'

export const ROUTE_PREFIX = '/capital-automation'
const ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/

function send(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value)
  res.end(body)
}

function plain(res, status, text) {
  res.statusCode = status
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

function requestIdOf() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

const MAX_QUERY_KEYS = 4
const MAX_QUERY_VALUE_CHARS = 512
const MAX_REQUEST_URL_CHARS = 16 * 1024

function invalidJson() {
  return new AutomationError('invalid_json', '请求体不是合法 JSON。', 400)
}

function bodyTextOf(value) {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8')
  let text
  try {
    text = JSON.stringify(value)
  } catch {
    throw invalidJson()
  }
  if (typeof text !== 'string') throw invalidJson()
  return text
}

function contentLengthOf(req) {
  const headers = req?.headers
  const raw = headers?.['content-length'] ?? headers?.['Content-Length']
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) throw invalidJson()
  return value
}

async function readBody(req) {
  const declaredLength = contentLengthOf(req)
  if (declaredLength !== undefined && declaredLength > MAX_REQUEST_BODY_BYTES) {
    throw new AutomationError('body_too_large', '请求体过大。', 413)
  }
  if (req.body !== undefined) {
    const text = bodyTextOf(req.body)
    if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BODY_BYTES) {
      throw new AutomationError('body_too_large', '请求体过大。', 413)
    }
    if (text.trim().length === 0) return undefined
    try {
      return JSON.parse(text)
    } catch {
      throw invalidJson()
    }
  }
  if (typeof req[Symbol.asyncIterator] !== 'function') return undefined
  const chunks = []
  let bytes = 0
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : typeof chunk === 'string' || chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : undefined
      if (buffer === undefined) throw invalidJson()
      bytes += buffer.byteLength
      if (bytes > MAX_REQUEST_BODY_BYTES) {
        throw new AutomationError('body_too_large', '请求体过大。', 413)
      }
      chunks.push(buffer)
    }
  } catch (error) {
    if (error instanceof AutomationError) throw error
    throw invalidJson()
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw invalidJson()
  }
}

function decodeId(raw) {
  let id
  try {
    id = decodeURIComponent(raw)
  } catch {
    throw new AutomationError('invalid_id', '任务或运行 id 无效。', 400)
  }
  if (!ID_PATTERN.test(id)) throw new AutomationError('invalid_id', '任务或运行 id 无效。', 400)
  return id
}

function queryOf(url, allowedKeys) {
  const result = {}
  let count = 0
  for (const [key, value] of url.searchParams.entries()) {
    count += 1
    if (count > MAX_QUERY_KEYS || !allowedKeys.has(key) || Object.prototype.hasOwnProperty.call(result, key)) {
      throw new AutomationError('invalid_query', '查询参数无效。', 400)
    }
    if (value.length > MAX_QUERY_VALUE_CHARS) {
      throw new AutomationError('invalid_query', '查询参数过长。', 400)
    }
    result[key] = value
  }
  return result
}

export function createAutomationRouteHandler(service, options = {}) {
  const authorize = options.authorize
  const logger = options.logger
  return async function handler(req, res) {
    const requestId = requestIdOf()
    res.setHeader('x-request-id', requestId)
    if (typeof authorize !== 'function') {
      plain(res, 401, 'unauthorized')
      return
    }
    let rejection
    try {
      rejection = authorize(req)
    } catch {
      rejection = 401
    }
    if (rejection !== undefined && rejection !== null) {
      plain(res, rejection, rejection === 401 ? 'unauthorized' : 'forbidden')
      return
    }
    let url
    const rawUrl = req.url ?? '/'
    if (typeof rawUrl !== 'string') {
      send(res, 400, { ok: false, code: 'bad_request', message: '请求地址无效。', requestId })
      return
    }
    if (rawUrl.length > MAX_REQUEST_URL_CHARS) {
      send(res, 414, { ok: false, code: 'url_too_long', message: '请求地址过长。', requestId })
      return
    }
    try {
      url = new URL(rawUrl, 'http://localhost')
    } catch {
      send(res, 400, { ok: false, code: 'bad_request', message: '请求地址无效。', requestId })
      return
    }
    const pathname = url.pathname
    if (pathname !== ROUTE_PREFIX && !pathname.startsWith(`${ROUTE_PREFIX}/`)) {
      send(res, 404, { ok: false, code: 'not_found', message: '路径不存在。', requestId })
      return
    }
    const suffix = pathname.slice(ROUTE_PREFIX.length) || '/'
    const method = String(req.method ?? 'GET').toUpperCase()
    try {
      const payload = await dispatch({ req, method, suffix, url, service, requestId })
      send(res, payload.status ?? 200, { ok: true, ...payload.body }, payload.headers)
    } catch (error) {
      const known = error instanceof AutomationError
      const schema = error instanceof SchemaError
      const storage = error?.code === 'storage_unavailable'
      const status = known ? error.status : schema ? 400 : storage ? 503 : 500
      const code = known ? error.code : schema ? 'invalid_request' : storage ? 'storage_unavailable' : 'internal_error'
      const message = known || schema ? error.message : storage ? '投研自动化存储暂时不可用。' : '服务暂时不可用。'
      if (!known && !schema && !storage) {
        logger?.warn?.(`capital-automation: ${requestId} ${method} ${pathname} 失败：${String(error)}`)
      }
      send(res, status, {
        ok: false,
        code,
        message: sanitizeMessage(message),
        requestId,
        ...(known ? error.extra : {}),
      })
    }
  }
}

async function dispatch({ req, method, suffix, url, service, requestId }) {
  if (suffix === '/meta') {
    if (method !== 'GET') throw new AutomationError('method_not_allowed', '只支持 GET。', 405)
    return { body: await service.meta() }
  }
  if (suffix === '/tasks' && method === 'GET') return { body: { tasks: await service.listTasks() } }
  if (suffix === '/tasks' && method === 'POST') return { body: { task: await service.createTask(await readBody(req)) }, status: 201 }
  const taskAction = /^\/tasks\/([^/]+)\/(activate|pause|hibernate|copy|run)$/.exec(suffix)
  if (taskAction !== null && method === 'POST') {
    const id = decodeId(taskAction[1])
    const action = taskAction[2]
    if (action === 'copy') return { body: { task: await service.copyTask(id) }, status: 201 }
    if (action === 'run') return { body: { run: await service.runTask(id) }, status: 202 }
    return { body: { task: await service.changeState(id, action) } }
  }
  const taskDetail = /^\/tasks\/([^/]+)$/.exec(suffix)
  if (taskDetail !== null) {
    const id = decodeId(taskDetail[1])
    if (method === 'GET') return { body: await service.taskDetail(id) }
    if (method === 'PATCH') return { body: { task: await service.patchTask(id, await readBody(req)) } }
    if (method === 'DELETE') return { body: await service.deleteTask(id) }
    throw new AutomationError('method_not_allowed', '只支持 GET / PATCH / DELETE。', 405)
  }
  if (suffix === '/runs' && method === 'GET') {
    return { body: await service.listRuns(queryOf(url, new Set(['limit', 'before']))) }
  }
  if (suffix === '/notifications' && method === 'GET') {
    return { body: await service.listNotifications(queryOf(url, new Set(['unread']))) }
  }
  if (suffix === '/notifications/read' && method === 'POST') return { body: await service.markNotificationsRead(await readBody(req)) }
  const runAction = /^\/runs\/([^/]+)\/cancel$/.exec(suffix)
  if (runAction !== null && method === 'POST') return { body: await service.cancelRun(decodeId(runAction[1])), status: 202 }
  const runDetail = /^\/runs\/([^/]+)$/.exec(suffix)
  if (runDetail !== null && method === 'GET') return { body: { run: await service.getRun(decodeId(runDetail[1])) } }
  throw new AutomationError('not_found', '路径不存在。', 404, { requestId })
}
