import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChartStore, createRouteHandler, apply, ROUTE_PATH } from '../chart-ui/index.js'

/**
 * host 半边（`@v587d/capital-charts`）的契约测试。
 *
 * 这块代码不经过构建（纯 JS 嵌套包），也没有 TS 类型兜底，所以行为完全靠这里钉住。
 * 重点两条：
 *  - **URL 里没有路径成分**：路由只读登记过的文件，因此不存在目录穿越面；
 *  - **可选降级**：没有 webServer 的 profile 里本行仍要激活并提供服务，而不是变成死行。
 */

const CHART_ID = 'ch_11111111-2222-3333-4444-555555555555'

function fakeReq(url, method = 'GET') {
  return { url, method }
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    end(chunk) { this.body = chunk ?? '' },
  }
}

function makeStore(options = {}) {
  return createChartStore({ readFile: options.readFile ?? (() => '{"chart_id":"x"}') })
}

async function call(handler, url, method = 'GET') {
  const res = fakeRes()
  await handler(fakeReq(url, method), res)
  return res
}

test('图表登记表：publish 返回取数 URL，未知 id 不泄漏文件路径', () => {
  const store = makeStore()
  const url = store.publish({ chartId: CHART_ID, filePath: '/workspace/proj/capital-analysis/charts/x/series.json' })
  assert.equal(url, `${ROUTE_PATH}/${CHART_ID}.json`)
  assert.equal(store.filePathOf(CHART_ID), '/workspace/proj/capital-analysis/charts/x/series.json')
  assert.equal(store.filePathOf('ch_nope'), undefined)
})

test('图表登记表：非法 chart_id 或空路径必须响亮失败（否则就是一条永远 404 的 URL）', () => {
  const store = makeStore()
  assert.throws(() => store.publish({ chartId: '../etc/passwd', filePath: '/x' }), /chart_id is invalid/)
  assert.throws(() => store.publish({ chartId: 'ds_1', filePath: '/x' }), /chart_id is invalid/)
  assert.throws(() => store.publish({ chartId: CHART_ID, filePath: '' }), /filePath is required/)
})

test('图表登记表：容量有上限，超出按最旧淘汰', () => {
  const store = makeStore()
  for (let index = 0; index < 520; index += 1) store.publish({ chartId: `ch_${index}`, filePath: `/tmp/${index}.json` })
  assert.equal(store.size, 500)
  assert.equal(store.filePathOf('ch_0'), undefined, '最旧的应被淘汰')
  assert.equal(store.filePathOf('ch_519'), '/tmp/519.json')
})

test('路由：GET 已登记的图返回 200 + no-store 的 JSON', async () => {
  const store = makeStore({ readFile: () => '{"chart_id":"ch_1","series":[]}' })
  store.publish({ chartId: CHART_ID, filePath: '/anywhere/series.json' })
  const res = await call(createRouteHandler(store), `${ROUTE_PATH}/${CHART_ID}.json`)

  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['cache-control'], 'no-store', '图表数据是会话内产物，不能进浏览器缓存')
  assert.equal(res.body, '{"chart_id":"ch_1","series":[]}')
})

test('路由：未登记 / 形态非法 / 错方法 / 错路径都给出明确状态码', async () => {
  const store = makeStore()
  store.publish({ chartId: CHART_ID, filePath: '/anywhere/series.json' })
  const handler = createRouteHandler(store)

  const missing = await call(handler, `${ROUTE_PATH}/ch_unknown.json`)
  assert.equal(missing.statusCode, 404)
  assert.equal(JSON.parse(missing.body).error, 'chart_not_published')

  const traversal = await call(handler, `${ROUTE_PATH}/${encodeURIComponent('../secret')}.json`)
  assert.equal(traversal.statusCode, 400)
  assert.equal(JSON.parse(traversal.body).error, 'invalid_chart_id')

  const wrongMethod = await call(handler, `${ROUTE_PATH}/${CHART_ID}.json`, 'POST')
  assert.equal(wrongMethod.statusCode, 405)

  const wrongPath = await call(handler, `${ROUTE_PATH}/${CHART_ID}`)
  assert.equal(wrongPath.statusCode, 404)

  const nested = await call(handler, `${ROUTE_PATH}/${CHART_ID}.json/extra`)
  assert.equal(nested.statusCode, 404, '多余路径段不得被当作合法请求')
})

test('路由：登记的文件读不到时按 404 处理，不抛到 webServer', async () => {
  const store = createChartStore({ readFile: () => { throw new Error('ENOENT') } })
  store.publish({ chartId: CHART_ID, filePath: '/gone/series.json' })
  const res = await call(createRouteHandler(store), `${ROUTE_PATH}/${CHART_ID}.json`)
  assert.equal(res.statusCode, 404)
  assert.equal(JSON.parse(res.body).error, 'chart_file_unreadable')
})

/**
 * 认证围栏（2026-09 review，P0）：序列旁路以前直接挂在 webServer 上，
 * 绕过了平台自己的 trusted-Host + 浏览器 cookie 围栏（`connection.requestRejection`），
 * 于是知道 chart_id 的任何本机进程/页面都能读 series.json。
 */
test('路由：authorize 拒绝时返回 401/403，且绝不读取登记的文件', async () => {
  let reads = 0
  const store = createChartStore({ readFile: () => { reads += 1; return '{"series":[]}' } })
  store.publish({ chartId: CHART_ID, filePath: '/anywhere/series.json' })

  const unauthenticated = await call(createRouteHandler(store, { authorize: () => 401 }), `${ROUTE_PATH}/${CHART_ID}.json`)
  assert.equal(unauthenticated.statusCode, 401)
  assert.equal(unauthenticated.body, 'unauthorized')
  assert.equal(unauthenticated.headers['cache-control'], 'no-store')

  const forbidden = await call(createRouteHandler(store, { authorize: () => 403 }), `${ROUTE_PATH}/${CHART_ID}.json`)
  assert.equal(forbidden.statusCode, 403)
  assert.equal(forbidden.body, 'forbidden')

  assert.equal(reads, 0, '被拒请求不得触碰文件系统')
})

test('路由：认证先于方法/路径判定，未认证的探测拿不到路由信息', async () => {
  const store = makeStore()
  store.publish({ chartId: CHART_ID, filePath: '/anywhere/series.json' })
  const handler = createRouteHandler(store, { authorize: () => 401 })

  const post = await call(handler, `${ROUTE_PATH}/${CHART_ID}.json`, 'POST')
  assert.equal(post.statusCode, 401, '与平台 /api 一致：先认证再谈方法与路径')
  const badPath = await call(handler, `${ROUTE_PATH}/../secret.json`)
  assert.equal(badPath.statusCode, 401)
})

test('路由：authorize 抛错时 fail closed（401），不退化放行', async () => {
  const store = makeStore({ readFile: () => '{"series":[]}' })
  store.publish({ chartId: CHART_ID, filePath: '/anywhere/series.json' })
  const res = await call(createRouteHandler(store, { authorize: () => { throw new Error('connection disposed') } }), `${ROUTE_PATH}/${CHART_ID}.json`)
  assert.equal(res.statusCode, 401)
  assert.equal(res.body, 'unauthorized')
})

test('路由：authorize 返回 undefined（已认证）时照常 200', async () => {
  const store = makeStore({ readFile: () => '{"chart_id":"ch_1","series":[]}' })
  store.publish({ chartId: CHART_ID, filePath: '/anywhere/series.json' })
  const res = await call(createRouteHandler(store, { authorize: () => undefined }), `${ROUTE_PATH}/${CHART_ID}.json`)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body, '{"chart_id":"ch_1","series":[]}')
})


function fakeCtx({ webServer, connection } = {}) {
  const provided = new Map()
  const injected = []
  const ctx = {
    // 真实 cordis 里 webServer 既是 ctx.get('webServer') 也是 ctx.webServer。
    webServer,
    get: (name) => (name === 'webServer' ? webServer : name === 'connection' ? connection : provided.get(name)),
    provide: (name, value) => provided.set(name, value),
    effect: (callback) => { callback(); return () => {} },
    inject: (deps, callback) => { injected.push({ deps, callback }) },
    logger: { info() {}, warn() {}, error() {} },
  }
  return { provided, injected, ctx }
}


test('apply()：提供 capitalCharts 服务并注册 prefix 路由', () => {
  const routes = []
  const webServer = { register: (route) => { routes.push(route); return () => {} } }
  const harness = fakeCtx({ webServer })
  apply(harness.ctx)

  const service = harness.provided.get('capitalCharts')
  assert.ok(service, '必须提供 capitalCharts 服务给 preset 半边登记序列')
  assert.equal(typeof service.publish, 'function')

  assert.equal(routes.length, 1, '只应注册图表序列路由（报告旁路已删除）')
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, ROUTE_PATH)
  assert.equal(typeof routes[0].handler, 'function')
  assert.equal(harness.injected.length, 0, 'webServer 已在时不应走 inject 等待分支')
  assert.equal(service.publishReport, undefined, 'capitalCharts 不应再有 publishReport')
})

test('apply()：没有 webServer 的 profile 仍激活并等待（不是死行）', () => {
  const harness = fakeCtx({})
  apply(harness.ctx)

  const service = harness.provided.get('capitalCharts')
  assert.ok(service, '无 Web 载体时服务仍要提供')
  assert.equal(harness.injected.length, 1, '应通过 ctx.inject 等 webServer 出现')
  assert.deepEqual(harness.injected[0].deps, ['webServer'])
  assert.equal(service.publish({ chartId: 'ch_before', filePath: '/tmp/before.json' }), null, '路由未挂载时不得返回不可访问的 URL')

  // webServer 出现后回调要真的把路由挂上。
  const routes = []
  harness.injected[0].callback({ effect: (callback) => callback(), webServer: { register: (route) => { routes.push(route); return () => {} } } })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, ROUTE_PATH)
  assert.equal(service.publish({ chartId: 'ch_after', filePath: '/tmp/after.json' }), `${ROUTE_PATH}/ch_after.json`)
})

test('apply()：路由接上 connection 的认证围栏（无 cookie → 401，已登录 → 200）', async () => {
  const routes = []
  const webServer = { register: (route) => { routes.push(route); return () => {} } }
  const seen = []
  const connection = {
    requestRejection: (req) => {
      seen.push(req)
      return req.headers?.cookie === 'dsh=ok' ? undefined : 401
    },
  }
  const harness = fakeCtx({ webServer, connection })
  apply(harness.ctx)

  const handler = routes[0].handler
  const service = harness.provided.get('capitalCharts')
  service.publish({ chartId: CHART_ID, filePath: '/tmp/x.json' })

  const rejected = await call(handler, `${ROUTE_PATH}/${CHART_ID}.json`)
  assert.equal(rejected.statusCode, 401, '未认证请求必须被 connection 围栏拦下')
  assert.equal(rejected.body, 'unauthorized')
  assert.equal(seen.length, 1, '每个请求都要过 requestRejection，而不是只在挂载时判一次')

  const authedRes = fakeRes()
  await handler({ url: `${ROUTE_PATH}/${CHART_ID}.json`, method: 'GET', headers: { cookie: 'dsh=ok' } }, authedRes)
  assert.equal(seen.length, 2)
  // 已认证请求继续走到 store.read（fake store 的默认 readFile 抛错 → 404 是数据侧的事，
  // 这里只断言它**没有**停在 401）。
  assert.notEqual(authedRes.statusCode, 401)
})

test('apply()：没有 connection 的组合退化成旧行为（无认证面时不拦）', async () => {
  const routes = []
  const webServer = { register: (route) => { routes.push(route); return () => {} } }
  const harness = fakeCtx({ webServer })
  apply(harness.ctx)
  harness.provided.get('capitalCharts').publish({ chartId: CHART_ID, filePath: '/tmp/x.json' })

  const res = await call(routes[0].handler, `${ROUTE_PATH}/${CHART_ID}.json`)
  // fake store 默认 readFile 抛错，所以数据侧是 404；关键是没被打成 401。
  assert.equal(res.statusCode, 404)
  assert.equal(JSON.parse(res.body).error, 'chart_file_unreadable')
})
