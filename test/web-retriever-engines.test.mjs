import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AnySearchError,
  createAnySearchClient,
  envKey,
  normalizeFetchResponse,
  normalizeSearchHit,
  normalizeSearchResponse,
  shouldFallbackToLocalFetch,
} from '../lib/web-retriever/engines.js'

test('normalizeSearchHit：容错字段缺失；无 url 判空', () => {
  assert.deepEqual(normalizeSearchHit({ url: 'https://a.example', title: 'T', snippet: 'S' }), {
    url: 'https://a.example', title: 'T', snippet: 'S',
  })
  assert.deepEqual(normalizeSearchHit({ url: 'https://a.example' }), { url: 'https://a.example' })
  assert.equal(normalizeSearchHit({}), null)
  assert.equal(normalizeSearchHit('x'), null)
})

test('normalizeSearchResponse：支持 AnySearch envelope，坏响应明确失败', () => {
  const good = normalizeSearchResponse('q', {
    code: 0,
    data: { results: [{ url: 'https://a.example', title: 'A', snippet: 'a' }] },
  })
  assert.equal(good.ok, true)
  assert.equal(good.sources.length, 1)
  assert.equal(good.query, 'q')
  assert.equal(normalizeSearchResponse('q', { results: [] }).ok, true)
  assert.equal(normalizeSearchResponse('q', { unexpected: true }).ok, false)
})

test('normalizeFetchResponse：支持 envelope，正文按上限裁剪，空正文失败', () => {
  const item = normalizeFetchResponse('https://a.example', {
    data: { title: 'T', content: 'x'.repeat(30_000) },
  })
  assert.equal(item.ok, true)
  assert.equal(item.content.length, 20_000)
  assert.equal(item.title, 'T')
  assert.equal(normalizeFetchResponse('https://a.example', { title: '', content: '' }).ok, false)
})

test('envKey：无环境变量时返回 undefined', () => {
  const previous = process.env.ANYSEARCH_PROBE_KEY
  delete process.env.ANYSEARCH_PROBE_KEY
  assert.equal(envKey('ANYSEARCH_PROBE_KEY'), undefined)
  if (previous !== undefined) process.env.ANYSEARCH_PROBE_KEY = previous
})

test('createAnySearchClient：只接受 http(s) baseURL，且每次请求发送 AnySearch envelope', async () => {
  assert.throws(() => createAnySearchClient('not-a-url'), /invalid AnySearch baseURL/)
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: { results: [] } }) }
  }
  try {
    const client = createAnySearchClient('https://api.example', async () => 'secret')
    await client.search({ query: 'hello' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://api.example/v1/search')
    assert.match(calls[0].init.headers.authorization, /Bearer secret/)
    assert.deepEqual(JSON.parse(calls[0].init.body), { query: 'hello' })
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：业务错误透出 message 与 error_code', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ code: -1, message: 'Invalid tag', error_code: 'invalid_tag' }),
  })
  try {
    await assert.rejects(() => createAnySearchClient().search({ query: 'x' }), /Invalid tag \(invalid_tag\)/)
  } finally {
    globalThis.fetch = original
  }
})

test('shouldFallbackToLocalFetch：真值表覆盖全部 12 个取值', () => {
  const fallbackTrue = [
    'TIMEOUT', 'NETWORK', 'AUTH', 'RATE_LIMIT', 'HTTP', 'INVALID_RESPONSE',
    'TARGET_BLOCKED', 'CONTENT_TOO_LARGE', 'UPSTREAM',
  ]
  const fallbackFalse = ['ABORTED', 'INVALID_URL', 'UNSUPPORTED_CONTENT']
  for (const code of fallbackTrue) {
    assert.equal(shouldFallbackToLocalFetch(code), true, `${code} 应回退`)
  }
  for (const code of fallbackFalse) {
    assert.equal(shouldFallbackToLocalFetch(code), false, `${code} 不应回退`)
  }
  assert.equal(fallbackTrue.length + fallbackFalse.length, 12, '真值表必须覆盖全部 12 个取值')
})

test('normalizeFetchResponse：超上限正文披露 truncated，未超上限不含该字段', () => {
  const big = normalizeFetchResponse('https://a.example', {
    data: { title: 'T', content: 'x'.repeat(30_000) },
  })
  assert.equal(big.ok, true)
  assert.equal(big.truncated, true)
  const small = normalizeFetchResponse('https://a.example', {
    data: { title: 'T', content: 'y'.repeat(100) },
  })
  assert.equal(small.ok, true)
  assert.ok(!('truncated' in small), '未超上限不得携带 truncated 字段')
})

test('AnySearch client：401/403 → AUTH，带 status 且无 upstreamCode', async () => {
  const original = globalThis.fetch
  try {
    for (const status of [401, 403]) {
      globalThis.fetch = async () => ({ ok: false, status, text: async () => 'Unauthorized' })
      await assert.rejects(() => createAnySearchClient().search({ query: 'x' }), (error) => {
        assert.ok(error instanceof AnySearchError, '必须是 AnySearchError')
        assert.equal(error.code, 'AUTH')
        assert.equal(error.status, status)
        assert.equal(error.upstreamCode, undefined)
        return true
      })
    }
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：429 → RATE_LIMIT', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 429, text: async () => 'Too Many Requests' })
  try {
    await assert.rejects(() => createAnySearchClient().search({ query: 'x' }), (error) => {
      assert.ok(error instanceof AnySearchError)
      assert.equal(error.code, 'RATE_LIMIT')
      assert.equal(error.status, 429)
      assert.equal(error.upstreamCode, undefined)
      return true
    })
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：500 → HTTP', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'Internal Server Error' })
  try {
    await assert.rejects(() => createAnySearchClient().search({ query: 'x' }), (error) => {
      assert.ok(error instanceof AnySearchError)
      assert.equal(error.code, 'HTTP')
      assert.equal(error.status, 500)
      assert.equal(error.upstreamCode, undefined)
      return true
    })
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：非 JSON 正文 → INVALID_RESPONSE', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '<html>oops</html>' })
  try {
    await assert.rejects(() => createAnySearchClient().search({ query: 'x' }), (error) => {
      assert.ok(error instanceof AnySearchError)
      assert.equal(error.code, 'INVALID_RESPONSE')
      assert.equal(error.status, undefined)
      assert.equal(error.upstreamCode, undefined)
      return true
    })
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：未知 error_code → UPSTREAM 且保留 upstreamCode', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: -1, message: 'weird', error_code: 'extract_weird' }),
  })
  try {
    await assert.rejects(() => createAnySearchClient().extract({ url: 'https://a.example' }), (error) => {
      assert.ok(error instanceof AnySearchError)
      assert.equal(error.code, 'UPSTREAM')
      assert.equal(error.upstreamCode, 'extract_weird')
      return true
    })
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：invalid_extract_url → INVALID_URL', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: -1, message: 'bad url', error_code: 'invalid_extract_url' }),
  })
  try {
    await assert.rejects(() => createAnySearchClient().extract({ url: 'not a url' }), (error) => {
      assert.ok(error instanceof AnySearchError)
      assert.equal(error.code, 'INVALID_URL')
      assert.equal(error.upstreamCode, 'invalid_extract_url')
      return true
    })
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：extract_target_blocked → TARGET_BLOCKED', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: -1, message: 'target blocked', error_code: 'extract_target_blocked' }),
  })
  try {
    await assert.rejects(() => createAnySearchClient().extract({ url: 'https://blocked.example' }), (error) => {
      assert.ok(error instanceof AnySearchError)
      assert.equal(error.code, 'TARGET_BLOCKED')
      assert.equal(error.upstreamCode, 'extract_target_blocked')
      return true
    })
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：extract_content_too_large → CONTENT_TOO_LARGE', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: -1, message: 'too large', error_code: 'extract_content_too_large' }),
  })
  try {
    await assert.rejects(() => createAnySearchClient().extract({ url: 'https://big.example' }), (error) => {
      assert.ok(error instanceof AnySearchError)
      assert.equal(error.code, 'CONTENT_TOO_LARGE')
      assert.equal(error.upstreamCode, 'extract_content_too_large')
      return true
    })
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：extract_unsupported_content → UNSUPPORTED_CONTENT', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: -1, message: 'pdf', error_code: 'extract_unsupported_content' }),
  })
  try {
    await assert.rejects(() => createAnySearchClient().extract({ url: 'https://pdf.example' }), (error) => {
      assert.ok(error instanceof AnySearchError)
      assert.equal(error.code, 'UNSUPPORTED_CONTENT')
      assert.equal(error.upstreamCode, 'extract_unsupported_content')
      return true
    })
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：extract_timeout → TIMEOUT（信封映射）', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: -1, message: 'slow', error_code: 'extract_timeout' }),
  })
  try {
    await assert.rejects(() => createAnySearchClient().extract({ url: 'https://slow.example' }), (error) => {
      assert.ok(error instanceof AnySearchError)
      assert.equal(error.code, 'TIMEOUT')
      assert.equal(error.upstreamCode, 'extract_timeout')
      return true
    })
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：自身超时触发 → TIMEOUT（mock timers，不等真实 60s）', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const original = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    await new Promise((_resolve, reject) => {
      if (init.signal.aborted) return reject(init.signal.reason ?? new Error('aborted'))
      init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')))
    })
    throw new Error('unreachable')
  }
  try {
    const client = createAnySearchClient('https://api.example', async () => 'secret')
    const pending = client.search({ query: 'x' })
    t.mock.timers.tick(60_001)
    await assert.rejects(pending, (error) => {
      assert.ok(error instanceof AnySearchError)
      assert.equal(error.code, 'TIMEOUT')
      assert.equal(error.upstreamCode, undefined)
      return true
    })
  } finally {
    t.mock.timers.reset()
    globalThis.fetch = original
  }
})

test('AnySearch client：调用前已 abort → ABORTED 且不发请求', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new Error('should not be called')
  }
  try {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      () => createAnySearchClient().search({ query: 'x' }, controller.signal),
      (error) => {
        assert.ok(error instanceof AnySearchError)
        assert.equal(error.code, 'ABORTED')
        return true
      },
    )
    assert.equal(calls, 0, '已取消的请求不得发起 fetch')
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：在途 abort → ABORTED', async () => {
  const original = globalThis.fetch
  let startedResolve
  const started = new Promise((resolve) => { startedResolve = resolve })
  globalThis.fetch = async (_url, init) => {
    startedResolve()
    await new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')))
    })
    throw new Error('unreachable')
  }
  try {
    const controller = new AbortController()
    const pending = createAnySearchClient().search({ query: 'x' }, controller.signal)
    await started
    controller.abort()
    await assert.rejects(pending, (error) => {
      assert.ok(error instanceof AnySearchError)
      assert.equal(error.code, 'ABORTED')
      return true
    })
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：fetch 拒绝（无 HTTP 响应）→ NETWORK', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('fetch failed') }
  try {
    await assert.rejects(() => createAnySearchClient().search({ query: 'x' }), (error) => {
      assert.ok(error instanceof AnySearchError)
      assert.equal(error.code, 'NETWORK')
      assert.equal(error.status, undefined)
      assert.equal(error.upstreamCode, undefined)
      return true
    })
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：畸形响应体归类为 INVALID_RESPONSE 而非崩溃', async () => {
  const original = globalThis.fetch
  const bodies = ['', '<html>oops</html>', '{"code":']
  try {
    for (const body of bodies) {
      globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => body })
      await assert.rejects(() => createAnySearchClient().search({ query: 'x' }), (error) => {
        assert.ok(error instanceof AnySearchError)
        assert.equal(error.code, 'INVALID_RESPONSE')
        return true
      })
    }
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：error_code 非字符串 → UPSTREAM 且不存 upstreamCode', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: -1, message: 'weird', error_code: 123 }),
  })
  try {
    await assert.rejects(() => createAnySearchClient().search({ query: 'x' }), (error) => {
      assert.ok(error instanceof AnySearchError)
      assert.equal(error.code, 'UPSTREAM')
      assert.equal(error.upstreamCode, undefined)
      return true
    })
  } finally {
    globalThis.fetch = original
  }
})

test('AnySearch client：信封 code 0 但无 data → 原样返回信封（不抛错，由下游判空）', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ code: 0 }) })
  try {
    const result = await createAnySearchClient().extract({ url: 'https://a.example' })
    assert.deepEqual(result, { code: 0 })
  } finally {
    globalThis.fetch = original
  }
})
