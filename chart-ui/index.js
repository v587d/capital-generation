/**
 * `@v587d/capital-charts` 的**宿主半边**。
 *
 * 为什么这个包存在、为什么它必须是独立包、为什么它是纯 JS：
 *  - **独立包**：`dsh-client-modules` 认定"一个包 = 一份客户端 bundle"，同一个包名出现在
 *    两个 active Loader source 上是组合错误。工具在 preset 平面（会话级），图表 UI 必须在
 *    host 平面（页面启动时就在），所以只能是两个包。
 *  - **host 平面**：boot graph 在 index.html 渲染时确定，运行期新增 entry 没有送达浏览器的
 *    通道；挂在 preset 行的客户端 bundle 到不了页面。
 *  - **纯 JS 不构建**：宿主半边只有"登记 + 路由"两件事，没有类型密集的逻辑；让它保持零构建
 *    就不必给嵌套包再搭一套 tsc 流程。行为由 test/chart-host.test.mjs 覆盖。
 *
 * 职责边界：本包**不碰文件系统里的业务数据**。图表序列由 preset 半边的 render_chart 工具
 * 写进 workspace 后，把**已解析好的绝对路径**登记到这里；路由只读它登记过的文件，
 * 因此 URL 里没有任何用户可控的路径成分。
 */

/** Loader 行的稳定身份。 */
export const name = 'capital-charts'

/** 路由前缀；客户端半边与回执共用这一个常量，避免两处漂移。 */
export const ROUTE_PATH = '/capital-charts'

/** chart_id 形态：由 render_chart 生成（`ch_<uuid>`），这里只做白名单校验。 */
const CHART_ID_PATTERN = /^ch_[A-Za-z0-9._-]{1,80}$/

/** 登记表容量上限：图表是会话内产物，超出按最旧淘汰，防止长时间运行无界增长。 */
const MAX_ENTRIES = 500

/**
 * 取 Node 内建 fs。
 *
 * 与本仓其它地方同一个惯用法（`process.getBuiltinModule`）：只依赖运行时能力，
 * 不引入 `@types/node`。
 */
function defaultReadFile(path) {
  const processLike = globalThis.process
  const fs = processLike?.getBuiltinModule?.('node:fs')
  if (!fs || typeof fs.readFileSync !== 'function') throw new Error('capital-charts: Node fs is unavailable')
  return fs.readFileSync(path, 'utf8')
}

/**
 * 图表登记表：chart_id → 已解析的绝对文件路径。
 *
 * `readFile` 可注入，测试因此不必真的落盘。
 */
export function createChartStore(options = {}) {
  const readFile = options.readFile ?? defaultReadFile
  const files = new Map()

  return {
    /**
     * 登记一张图的序列文件，返回客户端可取数的 URL。
     * @throws 当 chart_id 形态非法或路径为空——宁可响亮失败，也不要登记一条永远 404 的 URL。
     */
    publish(input) {
      const chartId = input?.chartId
      const filePath = input?.filePath
      if (typeof chartId !== 'string' || !CHART_ID_PATTERN.test(chartId)) {
        throw new Error(`capital-charts: chart_id is invalid: ${String(chartId)}`)
      }
      if (typeof filePath !== 'string' || filePath.length === 0) {
        throw new Error('capital-charts: filePath is required')
      }
      // 重新登记同一个 id 时移到最新（等价于刷新 LRU 位置）。
      files.delete(chartId)
      files.set(chartId, filePath)
      while (files.size > MAX_ENTRIES) files.delete(files.keys().next().value)
      return `${ROUTE_PATH}/${chartId}.json`
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

/**
 * `/capital-charts/<chart_id>.json` 的处理器。
 *
 * 只服务**登记过的**文件：URL 里没有路径成分，因此不存在目录穿越面。
 */
export function createRouteHandler(store) {
  return async function handler(req, res) {
    if (req?.method !== 'GET') {
      send(res, 405, { error: 'method_not_allowed' })
      return
    }
    let pathname
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      send(res, 400, { error: 'bad_request' })
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

/**
 * 挂载宿主半边。
 *
 * `webServer` 走**可选**注入（与 dsh-client-modules 同一写法）：没有 Web 载体的
 * profile（headless 等）里本行仍然激活并正常提供 `capitalCharts` 服务，只是不注册路由，
 * 而不是变成一行永远 waiting 的死行。
 */
export function apply(ctx) {
  const store = createChartStore()
  ctx.provide('capitalCharts', {
    /** @returns 客户端取数 URL；路由未挂载（无 webServer）时调用方仍可用文件路径降级。 */
    publish: (input) => store.publish(input),
  })

  const registerRoute = (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler: createRouteHandler(store) }),
      'capital-charts: series route',
    )
  }
  if (ctx.get('webServer') === undefined) ctx.inject(['webServer'], registerRoute)
  else registerRoute(ctx)
}
