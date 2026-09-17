/**
 * `@v587d/capital-charts` 的 host half。
 *
 * It owns only opaque chart registrations and their browser route. It never
 * reads Dataset files itself; render_chart supplies the resolved chart series
 * path, and the turn event published by the plugin carries the small metadata
 * the client renders.
 */

export const name = 'capital-charts'
export const ROUTE_PATH = '/capital-charts'

const CHART_ID_PATTERN = /^ch_[A-Za-z0-9._-]{1,80}$/
const MAX_ENTRIES = 500

function defaultReadFile(path) {
  const processLike = globalThis.process
  const fs = processLike?.getBuiltinModule?.('node:fs')
  if (!fs || typeof fs.readFileSync !== 'function') throw new Error('capital-charts: Node fs is unavailable')
  return fs.readFileSync(path, 'utf8')
}

export function createChartStore(options = {}) {
  const readFile = options.readFile ?? defaultReadFile
  let routeReady = options.routeReady ?? true
  const files = new Map()

  return {
    publish(input) {
      const chartId = input?.chartId
      const filePath = input?.filePath
      if (typeof chartId !== 'string' || !CHART_ID_PATTERN.test(chartId)) {
        throw new Error(`capital-charts: chart_id is invalid: ${String(chartId)}`)
      }
      if (typeof filePath !== 'string' || filePath.length === 0) {
        throw new Error('capital-charts: filePath is required')
      }
      files.delete(chartId)
      files.set(chartId, filePath)
      while (files.size > MAX_ENTRIES) files.delete(files.keys().next().value)
      return routeReady ? `${ROUTE_PATH}/${chartId}.json` : null
    },

    setRouteReady(value) {
      routeReady = value === true
    },

    filePathOf(chartId) {
      return files.get(chartId)
    },

    read(filePath) {
      return readFile(filePath)
    },

    get size() {
      return files.size
    },
  }
}

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function pathnameOf(req, res) {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname
  } catch {
    send(res, 400, { error: 'bad_request' })
    return undefined
  }
}

/**
 * Build the series route handler.
 *
 * @param store - the opaque chart registry.
 * @param options.authorize - optional `(req) => 401 | 403 | undefined`. When it
 *   returns a status the handler answers with that status and never touches the
 *   registry, so an unauthenticated caller learns nothing about `chart_id`.
 *   `apply()` passes `connection.requestRejection` here: that is the same
 *   trusted-Host fence + signed browser cookie every other session-scoped Web
 *   route runs behind (`/api`, the static index), and a route that skips it is
 *   readable by any local process or page that learns a `chart_id`
 *   (2026-09-17 review). A composition with no `connection` service (no browser
 *   auth plane at all) passes nothing and keeps the old behaviour.
 */
export function createRouteHandler(store, options = {}) {
  const authorize = options.authorize
  return async function handler(req, res) {
    if (typeof authorize === 'function') {
      let rejection
      try {
        rejection = authorize(req)
      } catch {
        // An authorizer that cannot answer must not fall through to the data:
        // fail closed on the same status the platform uses for a missing cookie.
        rejection = 401
      }
      if (rejection !== undefined && rejection !== null) {
        res.statusCode = rejection
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
    }
    if (req?.method !== 'GET') {
      send(res, 405, { error: 'method_not_allowed' })
      return
    }
    const pathname = pathnameOf(req, res)
    if (pathname === undefined) return
    if (pathname !== ROUTE_PATH && !pathname.startsWith(`${ROUTE_PATH}/`)) {
      send(res, 404, { error: 'not_found' })
      return
    }
    const match = /^\/([^/]+)\.json$/.exec(pathname.slice(ROUTE_PATH.length))
    if (!match) {
      send(res, 404, { error: 'not_found' })
      return
    }
    let chartId
    try {
      chartId = decodeURIComponent(match[1])
    } catch {
      send(res, 400, { error: 'bad_request' })
      return
    }
    if (!CHART_ID_PATTERN.test(chartId)) {
      send(res, 400, { error: 'invalid_chart_id' })
      return
    }
    const filePath = store.filePathOf(chartId)
    if (filePath === undefined) {
      send(res, 404, { error: 'chart_not_published', chart_id: chartId })
      return
    }
    let body
    try {
      body = await store.read(filePath)
    } catch {
      send(res, 404, { error: 'chart_file_unreadable', chart_id: chartId })
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(body)
  }
}

export function apply(ctx) {
  const store = createChartStore({ routeReady: false })
  ctx.provide('capitalCharts', {
    publish: (input) => store.publish(input),
  })

  /**
   * 认证围栏：优先解析 host 平面的 `connection`（web profile 由
   * `@deepseek-ai/dsh-client-connection` 提供），把它的 `requestRejection`
   * 原样接到本路由上——trusted-Host（403）+ 签名 cookie（401）。
   *
   * 惰性解析而不是 apply 时解析一次：`connection` 与本行的挂载先后不由我们决定。
   * 服务整体缺席（Electron/file:// 这类没有浏览器认证面的载体）时返回 undefined，
   * 退化成"没有认证面"的旧行为；但**解析抛错**（上下文已销毁）一律 401，宁可拒绝。
   */
  const authorize = (req) => {
    let connection
    try {
      connection = ctx.get('connection')
    } catch {
      return 401
    }
    if (connection === undefined || connection === null) return undefined
    if (typeof connection.requestRejection !== 'function') return undefined
    return connection.requestRejection(req)
  }

  const registerRoute = (webCtx) => {
    webCtx.effect(
      () => {
        const chartDispose = webCtx.webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler: createRouteHandler(store, { authorize }) })
        store.setRouteReady(true)
        return () => {
          store.setRouteReady(false)
          if (typeof chartDispose === 'function') chartDispose()
        }
      },
      'capital-charts: series route',
    )
  }
  if (ctx.get('webServer') === undefined) ctx.inject(['webServer'], registerRoute)
  else registerRoute(ctx)
}
