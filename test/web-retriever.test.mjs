import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebRetriever } from '../lib/web-retriever/retriever.js'

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
  assert.deepEqual(result, { url: 'https://example.test/notice', ok: true, title: '公告', content: '正文' })

  const failed = new WebRetriever(fakeClient({ extract: async () => ({}) }))
  assert.equal((await failed.fetch('https://example.test/empty')).ok, false)
})
