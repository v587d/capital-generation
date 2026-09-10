import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerWebRetrieverTools } from '../lib/web-retriever/tools.js'
import { WebRetriever } from '../lib/web-retriever/retriever.js'

function fakeToolRuntime() {
  const definitions = []
  return {
    definitions,
    register: (definition) => {
      definitions.push(definition)
      return () => {}
    },
  }
}

function fakeCtx(toolRuntime) {
  const services = { tools: toolRuntime }
  return {
    get: (name) => services[name],
    effect: (fn) => fn(),
  }
}

function fakeRetriever() {
  const calls = { search: [], fetch: [] }
  const retriever = new WebRetriever({
    search: async (request) => {
      calls.search.push(request)
      return { results: [{ url: 'https://example.test/result', title: 'Title', snippet: 'Snippet' }] }
    },
    extract: async (request) => {
      calls.fetch.push(request)
      return { title: 'Page', content: 'Body' }
    },
  })
  return { retriever, calls }
}

function runTool(runtime, name, args) {
  const definition = runtime.definitions.find((item) => item.name === name)
  assert.ok(definition, `tool ${name} should be registered`)
  return definition.execute(args, { signal: new AbortController().signal })
}

test('工具注册：只保留 web_retriever_search 和 web_retriever_fetch', () => {
  const runtime = fakeToolRuntime()
  registerWebRetrieverTools(fakeCtx(runtime), fakeRetriever().retriever)
  assert.deepEqual(runtime.definitions.map((item) => item.name), ['web_retriever_search', 'web_retriever_fetch'])
})

test('web_retriever_search：单查询、参数有界、直接返回结果', async () => {
  const runtime = fakeToolRuntime()
  const { retriever, calls } = fakeRetriever()
  registerWebRetrieverTools(fakeCtx(runtime), retriever)
  const result = await runTool(runtime, 'web_retriever_search', { query: '贵州茅台公告', max_results: 3 })
  assert.equal(result.ok, true)
  assert.equal(result.sources[0].url, 'https://example.test/result')
  assert.deepEqual(calls.search, [{ query: '贵州茅台公告', max_results: 3 }])
  await assert.rejects(() => runTool(runtime, 'web_retriever_search', { query: '' }), /query is required/)
  await assert.rejects(() => runTool(runtime, 'web_retriever_search', { query: 'x', max_results: 21 }), /between 1 and 20/)
})

test('web_retriever_fetch：严格单 URL，拒绝非 http(s)，不支持 URL 数组', async () => {
  const runtime = fakeToolRuntime()
  const { retriever, calls } = fakeRetriever()
  registerWebRetrieverTools(fakeCtx(runtime), retriever)
  const result = await runTool(runtime, 'web_retriever_fetch', { url: 'https://example.test/notice' })
  assert.deepEqual(result, {
    url: 'https://example.test/notice', ok: true, title: 'Page', content: 'Body', content_chars: 4,
  })
  assert.deepEqual(calls.fetch, [{ url: 'https://example.test/notice' }])
  await assert.rejects(() => runTool(runtime, 'web_retriever_fetch', { url: 'file:///tmp/a' }), /only http\(s\) URLs are allowed/)
  await assert.rejects(() => runTool(runtime, 'web_retriever_fetch', { url: ['https://a.test', 'https://b.test'] }), /url is required/)
})
