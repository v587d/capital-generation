/**
 * `/capital-watchlist/*` 路由闸门。
 *
 * ⛔ 认证围栏是这个包存在的前提：`webServer.register({kind:'prefix'})` **不做任何认证**，
 * 不接 `connection.requestRejection` 就等于"任何本机进程凭路径即可读写用户的自选股"。
 * 所以这里第一条用例断言的就是"被拒时连服务都没碰"。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SEED_ITEMS, createRouteHandler, createWatchlistService } from '../capital-watchlist/index.js'
import { createFakeDomain, httpFixture, stubFuyao } from './watchlist-harness.mjs'

function harness(options = {}) {
  const fake = createFakeDomain()
  const service = createWatchlistService({
    openDomain: async () => fake.domain,
    resolveApiKey: async () => 'test-key',
    now: () => 1_790_586_000_000,
    ...(options.service ?? {}),
  })
  const handler = createRouteHandler(service, { authorize: options.authorize, storeError: () => options.storeError })
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

test('域打不开时所有路径改口 store_unavailable，不返回空清单骗用户', async () => {
  const stub = stubFuyao()
  const { handler } = harness({ storeError: 'backend-not-found' })
  try {
    for (const input of [
      { method: 'GET', url: '/capital-watchlist/list' },
      { method: 'POST', url: '/capital-watchlist/refresh', body: {} },
    ]) {
      const res = await call(handler, input)
      assert.equal(res.statusCode, 503)
      assert.equal(res.json().code, 'store_unavailable')
      assert.match(res.json().cause, /backend-not-found/, '上游 code 要透出来，便于定位')
    }
    assert.equal(stub.calls.length, 0, '存储不可用时不许再花一次出网配额')
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
