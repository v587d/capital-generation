import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebRetriever } from '../lib/web-retriever/retriever.js'
import { AnySearchError } from '../lib/web-retriever/engines.js'
import { LocalFetchError } from '../lib/web-retriever/local-fetch.js'

function fakeClient(overrides = {}) {
  let searches = 0
  let fetches = 0
  return {
    stats: () => ({ searches, fetches }),
    search: async (request) => {
      searches += 1
      return overrides.search?.(request) ?? { results: [{ url: `https://example.test/?q=${encodeURIComponent(request.query)}`, title: 'Result', snippet: 'Snippet' }] }
    },
    extract: async (request) => {
      fetches += 1
      return overrides.extract?.(request) ?? { title: 'Page', content: `content of ${request.url}` }
    },
  }
}

function fakeLocalFetcher(overrides = {}) {
  let calls = 0
  const seen = []
  return {
    calls: () => calls,
    seen: () => seen,
    fetch: async (url, signal) => {
      calls += 1
      seen.push(url)
      if (overrides.fetch) return overrides.fetch(url, signal)
      return { url, status: 200, title: 'Local page', markdown: 'local markdown', truncated: false }
    },
  }
}

function anysearchError(code, message = 'anysearch failed') {
  return async () => {
    throw new AnySearchError(code, '/v1/extract', message)
  }
}

test('WebRetriever：单次 search 直接调用 AnySearch，不缓存、不维护状态', async () => {
  const client = fakeClient()
  const retriever = new WebRetriever(client)
  const result = await retriever.search('茅台公告', 5)
  assert.equal(result.ok, true)
  assert.equal(result.sources.length, 1)
  assert.deepEqual(client.stats(), { searches: 1, fetches: 0 })
  await retriever.search('茅台公告', 5)
  assert.deepEqual(client.stats(), { searches: 2, fetches: 0 })
})

test('WebRetriever：fetch 单 URL，支持 envelope 与空正文失败', async () => {
  const retriever = new WebRetriever(fakeClient({
    extract: async () => ({ data: { title: '公告', content: '正文' } }),
  }))
  const result = await retriever.fetch('https://example.test/notice')
  assert.deepEqual(result, {
    url: 'https://example.test/notice',
    ok: true,
    via: 'anysearch',
    title: '公告',
    content: '正文',
  })

  const failed = new WebRetriever(fakeClient({ extract: async () => ({}) }))
  assert.equal((await failed.fetch('https://example.test/empty')).ok, false)
})

test('回退矩阵：AnySearch 成功时来源为 anysearch，本地抓取器一次都不调用', async () => {
  const local = fakeLocalFetcher()
  const retriever = new WebRetriever(fakeClient(), local)
  const result = await retriever.fetch('https://example.test/notice')
  assert.equal(result.ok, true)
  assert.equal(result.via, 'anysearch')
  assert.equal(result.fallback, undefined)
  assert.equal(result.local_error, undefined)
  assert.equal(local.calls(), 0)
})

test('回退矩阵：AnySearch 明确失败后本地回退成功并披露来源与触发原因', async () => {
  const local = fakeLocalFetcher()
  const retriever = new WebRetriever(fakeClient({ extract: anysearchError('TARGET_BLOCKED', 'blocked by target') }), local)
  const result = await retriever.fetch('https://example.test/blocked')
  assert.equal(result.ok, true)
  assert.equal(result.via, 'local-http')
  assert.equal(result.title, 'Local page')
  assert.equal(result.content, 'local markdown')
  assert.equal(result.fallback.from, 'anysearch')
  assert.equal(result.fallback.code, 'TARGET_BLOCKED')
  assert.match(result.fallback.error, /blocked by target/)
  assert.equal(result.local_error, undefined)
  assert.deepEqual(local.seen(), ['https://example.test/blocked'])
})

test('回退矩阵：本地抓取返回最终 URL 时回执采用最终 URL', async () => {
  const local = fakeLocalFetcher({
    fetch: async () => ({
      url: 'https://cdn.test/final',
      status: 200,
      markdown: 'moved body',
      truncated: false,
    }),
  })
  const retriever = new WebRetriever(fakeClient({ extract: anysearchError('TIMEOUT') }), local)
  const result = await retriever.fetch('https://example.test/start')
  assert.equal(result.url, 'https://cdn.test/final')
  assert.equal(result.via, 'local-http')
})

test('回退矩阵：非法 URL 与不支持的二进制不回退', async () => {
  for (const code of ['INVALID_URL', 'UNSUPPORTED_CONTENT']) {
    const local = fakeLocalFetcher()
    const retriever = new WebRetriever(fakeClient({ extract: anysearchError(code) }), local)
    const result = await retriever.fetch('https://example.test/x')
    assert.equal(result.ok, false)
    assert.equal(result.via, 'anysearch')
    assert.equal(result.code, code)
    assert.equal(local.calls(), 0)
  }
})

test('回退矩阵：AnySearch 成功但空正文也触发回退', async () => {
  const local = fakeLocalFetcher()
  const retriever = new WebRetriever(fakeClient({ extract: async () => ({}) }), local)
  const result = await retriever.fetch('https://example.test/empty')
  assert.equal(result.ok, true)
  assert.equal(result.via, 'local-http')
  assert.equal(result.fallback.code, 'UPSTREAM')
  assert.equal(local.calls(), 1)
})

test('回退矩阵：AnySearch 取消原样抛出，不吞不回退', async () => {
  const local = fakeLocalFetcher()
  const retriever = new WebRetriever(fakeClient({ extract: anysearchError('ABORTED', 'request aborted') }), local)
  await assert.rejects(retriever.fetch('https://example.test/x'), (error) => {
    assert.ok(error instanceof AnySearchError)
    assert.equal(error.code, 'ABORTED')
    return true
  })
  assert.equal(local.calls(), 0)
})

test('回退矩阵：本地抓取取消同样原样抛出，不降级成失败信封', async () => {
  const local = fakeLocalFetcher({
    fetch: async () => { throw new LocalFetchError('ABORTED', 'request aborted') },
  })
  const retriever = new WebRetriever(fakeClient({ extract: anysearchError('TARGET_BLOCKED') }), local)
  await assert.rejects(retriever.fetch('https://example.test/x'), (error) => {
    assert.ok(error instanceof LocalFetchError)
    assert.equal(error.code, 'ABORTED')
    return true
  })
  assert.equal(local.calls(), 1)
})

test('回退矩阵：取消优先于回退（AnySearch 非取消失败但调用方已取消）', async () => {
  const controller = new AbortController()
  const local = fakeLocalFetcher()
  const retriever = new WebRetriever(fakeClient({
    extract: async () => {
      controller.abort()
      throw new AnySearchError('TARGET_BLOCKED', '/v1/extract', 'blocked')
    },
  }), local)
  await assert.rejects(retriever.fetch('https://example.test/x', controller.signal))
  assert.equal(local.calls(), 0)
})

test('回退矩阵：未配置本地抓取器时 AnySearch 失败返回信封而非抛错', async () => {
  const retriever = new WebRetriever(fakeClient({ extract: anysearchError('TARGET_BLOCKED', 'blocked') }))
  const result = await retriever.fetch('https://example.test/x')
  assert.equal(result.ok, false)
  assert.equal(result.via, 'anysearch')
  assert.equal(result.code, 'TARGET_BLOCKED')
  assert.match(result.error, /blocked/)
  assert.equal(result.fallback, undefined)
  assert.equal(result.local_error, undefined)
})

test('回退矩阵：两边都失败时同时给出两条原因且不混淆', async () => {
  const local = fakeLocalFetcher({
    fetch: async () => { throw new LocalFetchError('TIMEOUT', 'local fetch timed out') },
  })
  const retriever = new WebRetriever(fakeClient({ extract: anysearchError('TARGET_BLOCKED', 'blocked by target') }), local)
  const result = await retriever.fetch('https://example.test/x')
  assert.equal(result.ok, false)
  assert.equal(result.via, 'anysearch')
  assert.equal(result.code, 'TARGET_BLOCKED')
  assert.equal(result.local_error.code, 'TIMEOUT')
  assert.match(result.error, /blocked by target/)
  assert.match(result.error, /local fetch timed out/)
  assert.notEqual(result.fallback.error, result.local_error.error)
})

test('回退矩阵：AnySearch 侧截断与本地侧截断都披露 truncated', async () => {
  const anysearch = new WebRetriever(fakeClient({
    extract: async () => ({ title: 'Long', content: 'x'.repeat(30_000) }),
  }))
  const truncatedByAnySearch = await anysearch.fetch('https://example.test/long')
  assert.equal(truncatedByAnySearch.via, 'anysearch')
  assert.equal(truncatedByAnySearch.truncated, true)

  const local = fakeLocalFetcher({
    fetch: async (url) => ({ url, status: 200, markdown: 'partial', truncated: true }),
  })
  const retriever = new WebRetriever(fakeClient({ extract: anysearchError('TIMEOUT') }), local)
  const truncatedLocally = await retriever.fetch('https://example.test/x')
  assert.equal(truncatedLocally.via, 'local-http')
  assert.equal(truncatedLocally.truncated, true)
})

test('回退矩阵：非 AnySearchError 失败按 UPSTREAM 归类并回退', async () => {
  const local = fakeLocalFetcher()
  const retriever = new WebRetriever(fakeClient({
    extract: async () => { throw new Error('socket hang up') },
  }), local)
  const result = await retriever.fetch('https://example.test/x')
  assert.equal(result.ok, true)
  assert.equal(result.via, 'local-http')
  assert.equal(result.fallback.code, 'UPSTREAM')
  assert.match(result.fallback.error, /socket hang up/)
})
