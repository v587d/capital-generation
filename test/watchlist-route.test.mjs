/**
 * `/capital-watchlist/*` 路由闸门。
 *
 * ⛔ 认证围栏是这个包存在的前提：`webServer.register({kind:'prefix'})` **不做任何认证**，
 * 不接 `connection.requestRejection` 就等于"任何本机进程凭路径即可读写用户的自选股"。
 * 所以这里第一条用例断言的就是"被拒时连服务都没碰"。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, createRouteHandler, createWatchlistService, ROUTE_PATH, SEED_ITEMS } from '../capital-watchlist/index.js'
import { fakeCtx } from './cordis-fake.mjs'
import { createFakeDomain, httpFixture, stubFuyao } from './watchlist-harness.mjs'

function harness(options = {}) {
  const fake = createFakeDomain()
  const service = createWatchlistService({
    openDomain: async () => fake.domain,
    resolveApiKey: async () => 'test-key',
    now: () => 1_790_586_000_000,
    ...(options.service ?? {}),
  })
  const handler = createRouteHandler(service, { authorize: options.authorize })
  return { service, fake, handler }
}

async function call(handler, input) {
  const { req, res } = httpFixture(input)
  await handler(req, res)
  return res
}

test('⛔ 缺 cookie（401）时绝不落到数据面：服务一次都没被调用', async () => {
  const stub = stubFuyao()
  let touched = 0
  const { handler } = harness({ authorize: () => 401 })
  const guarded = createRouteHandler({ list: async () => { touched += 1; return { ok: true, items: [] } } }, { authorize: () => 401 })
  try {
    const res = await call(guarded, { method: 'GET', url: '/capital-watchlist/list' })
    assert.equal(res.statusCode, 401)
    assert.equal(res.body, 'unauthorized')
    assert.equal(touched, 0, '被拒的请求不许读注册表，也不许泄露 thscode 是否存在')
    await call(handler, { method: 'POST', url: '/capital-watchlist/add', body: { thscode: '300750.SZ' } })
    assert.equal(stub.calls.length, 0)
  } finally {
    stub.restore()
  }
})

test('非受信 Host / Origin（403）与 authorizer 抛错都拒绝；抛错按 401 收口', async () => {
  const cases = [
    { authorize: () => 403, expected: 403, body: 'forbidden' },
    { authorize: () => { throw new Error('context destroyed') }, expected: 401, body: 'unauthorized' },
  ]
  for (const item of cases) {
    const handler = createRouteHandler({ list: async () => ({ ok: true, items: [{ thscode: '000001.SH' }] }) }, { authorize: item.authorize })
    const res = await call(handler, { method: 'GET', url: '/capital-watchlist/list' })
    assert.equal(res.statusCode, item.expected)
    assert.equal(res.body, item.body)
  }
})

test('没有认证面的载体（Electron / file://）不加围栏也不假装存在', async () => {
  const stub = stubFuyao()
  const { handler } = harness({ authorize: undefined })
  try {
    const res = await call(handler, { method: 'GET', url: '/capital-watchlist/list' })
    assert.equal(res.statusCode, 200, 'connection 缺席时按旧行为放行（host 侧本地进程本来就是可信边界）')
    assert.equal(res.json().items.length, SEED_ITEMS.length)
  } finally {
    stub.restore()
  }
})

test('只允许 GET / POST，其余 405；一律 no-store', async () => {
  const stub = stubFuyao()
  const { handler } = harness()
  try {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const res = await call(handler, { method, url: '/capital-watchlist/list', body: {} })
      assert.equal(res.statusCode, 405)
      assert.equal(res.json().code, 'method_not_allowed')
    }
    const res = await call(handler, { method: 'GET', url: '/capital-watchlist/list' })
    assert.equal(res.headers['cache-control'], 'no-store')
    assert.match(res.headers['content-type'], /application\/json/)
  } finally {
    stub.restore()
  }
})

test('未知子路径 404；前缀外的路径也不认领', async () => {
  const stub = stubFuyao()
  const { handler } = harness()
  try {
    const unknown = await call(handler, { method: 'GET', url: '/capital-watchlist/nope' })
    assert.equal(unknown.statusCode, 404)
    assert.equal(unknown.json().code, 'not_found')
    const outside = await call(handler, { method: 'GET', url: '/capital-watchlists/list' })
    assert.equal(outside.statusCode, 404, '前缀相似的路径不能被子路径匹配吞掉')
  } finally {
    stub.restore()
  }
})

test('GET /search：中文 query 可用；缺 q 是 400 invalid_query', async () => {
  const stub = stubFuyao()
  const { handler } = harness()
  try {
    const ok = await call(handler, { method: 'GET', url: `/capital-watchlist/search?q=${encodeURIComponent('宁德时代')}` })
    assert.equal(ok.statusCode, 200)
    assert.equal(ok.json().items[0].thscode, '300750.SZ')

    const missing = await call(handler, { method: 'GET', url: '/capital-watchlist/search' })
    assert.equal(missing.statusCode, 400)
    assert.equal(missing.json().code, 'invalid_query')

    const long = await call(handler, { method: 'GET', url: `/capital-watchlist/search?q=${'a'.repeat(65)}` })
    assert.equal(long.statusCode, 400, '越界入参在本地就被拒，不许转给上游')
  } finally {
    stub.restore()
  }
})

test('POST 的 JSON 体：合法就走业务，非法 JSON 是 400 而不是 500', async () => {
  const stub = stubFuyao()
  const { handler } = harness()
  try {
    const added = await call(handler, { method: 'POST', url: '/capital-watchlist/add', body: { thscode: '300750.SZ' } })
    assert.equal(added.statusCode, 200)
    assert.equal(added.json().item.name, '宁德时代')

    const broken = await call(handler, { method: 'POST', url: '/capital-watchlist/add', body: '{ not json' })
    assert.equal(broken.statusCode, 400)
    assert.equal(broken.json().code, 'invalid_query')

    const empty = await call(handler, { method: 'POST', url: '/capital-watchlist/refresh', body: undefined })
    assert.equal(empty.statusCode, 200, '空体对 refresh 是合法的（它没有入参）')
  } finally {
    stub.restore()
  }
})

test('业务失败用状态码表达：歧义与超限 409、未匹配 404', async () => {
  const stub = stubFuyao()
  const { handler } = harness()
  try {
    const ambiguous = await call(handler, { method: 'POST', url: '/capital-watchlist/add', body: { q: 'ETF' } })
    assert.equal(ambiguous.statusCode, 409)
    assert.equal(ambiguous.json().code, 'ambiguous')
    assert.equal(ambiguous.json().candidates.length, 2)

    const gone = await call(handler, { method: 'POST', url: '/capital-watchlist/add', body: { thscode: '000999.SZ' } })
    assert.equal(gone.statusCode, 404)
    assert.equal(gone.json().code, 'not_found')
  } finally {
    stub.restore()
  }
})
test('POST /pin：置顶那条排到最前；不在清单 404、裸代码 400，且一次网都不出', async () => {
  const stub = stubFuyao()
  const { handler } = harness()
  try {
    // 置顶一条**港美股键**：`remove` / `pin` 这一路零出网，只换 `normalizeThscode` 的接受形状（§4.2）。
    const pinned = await call(handler, { method: 'POST', url: '/capital-watchlist/pin', body: { thscode: 'INX.US' } })
    assert.equal(pinned.statusCode, 200)
    assert.equal(pinned.json().items[0].thscode, 'INX.US', '回包里就是新顺序（客户端照它贴）')
    assert.equal(typeof pinned.json().items[0].pinned_at, 'number')

    const again = await call(handler, { method: 'GET', url: '/capital-watchlist/list' })
    assert.equal(again.json().items[0].thscode, 'INX.US', '再读清单仍是置顶顺序')

    const missing = await call(handler, { method: 'POST', url: '/capital-watchlist/pin', body: { thscode: '600000.SH' } })
    assert.equal(missing.statusCode, 404)
    assert.equal(missing.json().code, 'not_found')

    const bare = await call(handler, { method: 'POST', url: '/capital-watchlist/pin', body: { thscode: '300750' } })
    assert.equal(bare.statusCode, 400)
    assert.equal(bare.json().code, 'invalid_query')
    assert.equal(stub.calls.length, 0, '置顶是纯本地动作：一次出网都不许有')
  } finally {
    stub.restore()
  }
})

test('refresh 回包里 always 有 items / failures / refreshed_at 三件（面板按这个形状渲染）', async () => {
  const stub = stubFuyao()
  const { handler } = harness()
  try {
    const res = await call(handler, { method: 'POST', url: '/capital-watchlist/refresh', body: {} })
    const payload = res.json()
    assert.equal(res.statusCode, 200)
    assert.ok(Array.isArray(payload.items))
    assert.ok(Array.isArray(payload.failures))
    assert.equal(typeof payload.refreshed_at, 'number')
    assert.equal(payload.error, undefined, '全部成功时不带整批 error 字段')
  } finally {
    stub.restore()
  }
})

/**
 * 存储失败的对外形态。**不靠任何"预热时记一笔、之后一律改口"的闩**：那条闩会把一次装配期
 * 抢跑（`storageDomain` 还没 provide）钉成进程一生的 `store_unavailable`。失败由每条路由
 * **逐次**从服务拿到，所以下面这些路径的 503 都是从真实调用里出来的。
 */
test('域打不开时所有路径改口 store_unavailable，不返回空清单骗用户，也不烧出网配额', async () => {
  const stub = stubFuyao()
  const broken = () => Promise.reject(Object.assign(new Error('storage backend missing'), { code: 'backend-not-found' }))
  const { handler } = harness({ service: { openDomain: broken } })
  try {
    for (const input of [
      { method: 'GET', url: '/capital-watchlist/list' },
      { method: 'GET', url: '/capital-watchlist/search?q=%E5%AE%81%E5%BE%B7%E6%97%B6%E4%BB%A3' },
      { method: 'POST', url: '/capital-watchlist/add', body: { thscode: '300750.SZ' } },
      { method: 'POST', url: '/capital-watchlist/pin', body: { thscode: '000300.SH' } },
      { method: 'POST', url: '/capital-watchlist/refresh', body: {} },
    ]) {
      const res = await call(handler, input)
      assert.equal(res.statusCode, 503)
      assert.equal(res.json().code, 'store_unavailable')
      assert.match(res.json().cause, /backend-not-found/, '上游 code 要透出来，便于定位')
      assert.equal(res.json().items, undefined, '⛔ 不许把失败渲染成"清单是空的"')
    }
    assert.equal(stub.calls.length, 0, '存储不可用时不许再花一次出网配额（含 /search：它先碰域再出网）')
  } finally {
    stub.restore()
  }
})

test('响应里绝不出现密钥与上游原文', async () => {
  const stub = stubFuyao({ '/api/a-share-index/prices/snapshot': { status: 500, body: { code: 500, message: 'SECRET-UPSTREAM-TEXT', data: null } } })
  const { handler } = harness({ service: { resolveApiKey: async () => 'super-secret-key' } })
  try {
    const res = await call(handler, { method: 'POST', url: '/capital-watchlist/refresh', body: {} })
    const text = res.body
    assert.ok(!text.includes('super-secret-key'), '密钥永不进回包')
    assert.ok(!text.includes('SECRET-UPSTREAM-TEXT'), '上游原文不 echo')
    assert.ok(!text.includes('fuyao.aicubes.cn'), '端点也不进回包')
    assert.equal(JSON.parse(text).error.code, 'fuyao_unavailable')
  } finally {
    stub.restore()
  }
})

/**
 * 两颗 host 行的 webServer 取用形状（2026-09-30 桌面端实机：这行炸成 异常，
 * 而 chart 那颗同因同炸）。fake 用的是 cordis 真实语义，见 test/cordis-fake.mjs——
 * 之前这颗行**根本没有 apply() 用例**，所以错路只在真机上暴露。
 */
test('apply()：webServer 已就绪的载体（桌面端形状）当场挂上路由，不许炸在属性访问', () => {
  const routes = []
  const fake = createFakeDomain()
  const harness = fakeCtx({
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    services: { storageDomain: { open: () => fake.domain } },
  })
  apply(harness.ctx)

  assert.ok(harness.provided.get('capitalWatchlist'), '必须提供 capitalWatchlist 服务')
  assert.deepEqual(harness.injected[0].deps, ['webServer'], '取 webServer 只能经 inject')
  assert.equal(routes.length, 1, '依赖已就绪时 inject 立刻起子 fiber，路由当场挂上')
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, ROUTE_PATH)
})

test('⛔ apply()：认证围栏必须真的接到注册出去的那颗 handler 上', async () => {
  // 上面那些围栏用例是**自己造 authorize** 喂给 createRouteHandler 的——所以把 apply() 里
  // 从 `connection` 取 requestRejection、再传进去的那两行删掉，全套测试照样全绿，而真实宿主上
  // `/capital-watchlist/*` 就退化成"任何本机进程凭路径即可读写用户的自选股"（清单与报价快照是
  // 跨 workspace 的用户资产）。这条走完整装配：假 connection 说 401，注册出去的 handler 必须拒。
  const routes = []
  const fake = createFakeDomain()
  const asked = []
  const harness = fakeCtx({
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    connection: { requestRejection: (req) => { asked.push(req.url); return 401 } },
    services: { storageDomain: { open: () => fake.domain } },
  })
  apply(harness.ctx)
  assert.equal(routes.length, 1, 'webServer 就绪 ⇒ 路由当场挂上')

  const { req, res } = httpFixture({ method: 'GET', url: '/capital-watchlist/list' })
  await routes[0].handler(req, res)
  assert.deepEqual(asked, ['/capital-watchlist/list'], '每个请求都必须过 connection.requestRejection')
  assert.equal(res.statusCode, 401, '⛔ connection 判 401 却不生效 = 围栏没接上，这是个无认证端点')
  assert.equal(res.body, 'unauthorized')
  assert.equal(res.headers['cache-control'], 'no-store')
})

test('apply()：connection 判可放行时，围栏不许自己把请求拦死', async () => {
  const routes = []
  const fake = createFakeDomain()
  const stub = stubFuyao()
  const harness = fakeCtx({
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    connection: { requestRejection: () => undefined },
    services: { storageDomain: { open: () => fake.domain } },
  })
  apply(harness.ctx)
  try {
    const { req, res } = httpFixture({ method: 'GET', url: '/capital-watchlist/list' })
    await routes[0].handler(req, res)
    assert.equal(res.statusCode, 200, 'requestRejection 回 undefined 就是放行')
    assert.equal(res.json().items.length, SEED_ITEMS.length, '放行之后走的还是同一条服务路径')
  } finally {
    stub.restore()
  }
})

test('apply()：webServer 缺席的载体（web profile 形状）仍激活，出现后才挂', () => {
  const fake = createFakeDomain()
  const harness = fakeCtx({ services: { storageDomain: { open: () => fake.domain } } })
  apply(harness.ctx)

  assert.ok(harness.provided.get('capitalWatchlist'), '没有 Web 载体时服务仍要提供（不许成死行）')
  assert.equal(harness.injected.length, 1)
  const routes = []
  harness.injected[0].callback({
    effect: (callback) => { callback(); return () => {} },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
  })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, ROUTE_PATH)
})

test('tencent_unavailable 的 HTTP 映射与 scope：两路上游的错误码各有各的状态位', async () => {
  // 闭集里新增的那一条必须有独立文案位与独立状态码：混进 `fuyao_unavailable` 就叫用户去配
  // 一个本来不需要的密钥（港美股那一路无密钥可查）。
  const failing = (result) => createRouteHandler({ search: async () => result }, {})
  for (const [code, expected] of [['tencent_unavailable', 502], ['fuyao_unavailable', 502], ['rate_limited', 429], ['credential_missing', 503], ['invalid_query', 400]]) {
    const res = await call(failing({ ok: false, code, message: code, scope: 'all' }), { method: 'GET', url: '/capital-watchlist/search?q=腾讯' })
    assert.equal(res.statusCode, expected, `${code} 的对外状态位`)
    assert.equal(res.json().code, code)
    assert.equal(res.headers['cache-control'], 'no-store', '每条映射都要带 no-store：自选股回包不许缓存')
  }
})

test('refresh 即使半边失败也回 200 + items：error.scope 说清是哪一路（面板据此不占居中位）', async () => {
  const stub = stubFuyao({ '/api/a-share-index/prices/snapshot': { code: 4001, message: '请求频率超限', data: null } })
  const { handler, service } = harness()
  try {
    await service.add({ thscode: '00700.HK' })
    const res = await call(handler, { method: 'POST', url: '/capital-watchlist/refresh', body: {} })
    assert.equal(res.statusCode, 200, '整批失败也不清空列表、不换状态码：行还在，画上一次成功的值')
    const payload = res.json()
    assert.equal(payload.error.code, 'rate_limited')
    assert.equal(payload.error.scope, 'a-share', '⛔ 港美股这次是好的，回包不许说成整块不可用')
    assert.ok(payload.items.some((item) => item.thscode === '00700.HK' && item.quote !== null), '港那一路照常落地')
    assert.deepEqual(payload.failures.map((failure) => failure.thscode), ['000001.SH'])
  } finally {
    stub.restore()
  }
})

test('search 的回包带 partial 时状态码仍是 200：一路挂了不是"查询失败"', async () => {
  const stub = stubFuyao({ '/api/meta/tickers/search': { status: 503, body: {} } })
  const { handler } = harness()
  try {
    const res = await call(handler, { method: 'GET', url: '/capital-watchlist/search?q=%E8%85%BE%E8%AE%AF' })
    assert.equal(res.statusCode, 200)
    const payload = res.json()
    assert.equal(payload.ok, true)
    assert.deepEqual(payload.partial, [{ market: 'a-share', code: 'fuyao_unavailable' }])
    assert.ok(payload.items.some((item) => item.exchange === 'HK'), '候选照常给其余两路')
  } finally {
    stub.restore()
  }
})
