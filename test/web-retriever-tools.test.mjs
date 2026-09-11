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

function fakeWindClient(overrides = {}) {
  const calls = []
  const client = {
    callTool: async (toolName, args) => {
      calls.push({ toolName, args })
      return overrides.callTool?.(toolName, args) ?? { ok: true, data: { items: ['doc'] } }
    },
  }
  return { client, calls }
}

function registerAll(retriever, windClient) {
  const runtime = fakeToolRuntime()
  registerWebRetrieverTools(fakeCtx(runtime), retriever, windClient)
  return runtime
}

function runTool(runtime, name, args, sessionId) {
  const definition = runtime.definitions.find((item) => item.name === name)
  assert.ok(definition, `tool ${name} should be registered`)
  return definition.execute(args, {
    signal: new AbortController().signal,
    ...(sessionId ? { agent: { session: { id: sessionId } } } : {}),
  })
}

test('工具注册：anysearch 两工具 + wind_docs 两工具，无条件注册', () => {
  const runtime = registerAll(fakeRetriever().retriever, fakeWindClient().client)
  assert.deepEqual(runtime.definitions.map((item) => item.name), [
    'web_retriever_search', 'web_retriever_fetch', 'wind_docs_announcements', 'wind_docs_news',
  ])
})

test('web_retriever_search：单查询、参数有界、信封带 provider 与 recent_retrievals', async () => {
  const { retriever, calls } = fakeRetriever()
  const runtime = registerAll(retriever, fakeWindClient().client)
  const result = await runTool(runtime, 'web_retriever_search', { query: '贵州茅台公告', max_results: 3 }, 's1')
  assert.equal(result.ok, true)
  assert.equal(result.provider, 'anysearch')
  assert.equal(result.sources[0].url, 'https://example.test/result')
  assert.equal(result.recent_retrievals.length, 1)
  assert.equal(result.recent_retrievals[0].tool, 'web_retriever_search')
  assert.deepEqual(calls.search, [{ query: '贵州茅台公告', max_results: 3 }])
  await assert.rejects(() => runTool(runtime, 'web_retriever_search', { query: '' }), /query is required/)
  await assert.rejects(() => runTool(runtime, 'web_retriever_search', { query: 'x', max_results: 21 }), /between 1 and 20/)
})

test('web_retriever_fetch：严格单 URL，信封带 provider 与回声', async () => {
  const { retriever, calls } = fakeRetriever()
  const runtime = registerAll(retriever, fakeWindClient().client)
  const result = await runTool(runtime, 'web_retriever_fetch', { url: 'https://example.test/notice' }, 's1')
  const { recent_retrievals, provider_tally, ...rest } = result
  assert.deepEqual(rest, {
    provider: 'anysearch', url: 'https://example.test/notice', ok: true, title: 'Page', content: 'Body', content_chars: 4,
  })
  assert.equal(recent_retrievals.length, 1)
  assert.equal(recent_retrievals[0].tool, 'web_retriever_fetch')
  assert.deepEqual(provider_tally, { anysearch: 1 })
  assert.deepEqual(calls.fetch, [{ url: 'https://example.test/notice' }])
  await assert.rejects(() => runTool(runtime, 'web_retriever_fetch', { url: 'file:///tmp/a' }), /only http\(s\) URLs are allowed/)
  await assert.rejects(() => runTool(runtime, 'web_retriever_fetch', { url: ['https://a.test', 'https://b.test'] }), /url is required/)
})

test('recent_retrievals 与 provider_tally：跨 provider 累计、按调用方 session 隔离、回声上限 8 而计数不封顶', async () => {
  const { retriever } = fakeRetriever()
  const runtime = registerAll(retriever, fakeWindClient().client)
  await runTool(runtime, 'web_retriever_search', { query: 'q1' }, 's1')
  await runTool(runtime, 'wind_docs_announcements', { query: 'q2' }, 's1')
  const third = await runTool(runtime, 'web_retriever_search', { query: 'q3' }, 's1')
  assert.deepEqual(third.recent_retrievals.map((item) => [item.provider, item.tool, item.query]), [
    ['anysearch', 'web_retriever_search', 'q1'],
    ['wind_docs', 'wind_docs_announcements', 'q2'],
    ['anysearch', 'web_retriever_search', 'q3'],
  ])
  assert.deepEqual(third.provider_tally, { anysearch: 2, wind_docs: 1 }, 'tally 按 provider 累计且含本次')

  const other = await runTool(runtime, 'web_retriever_search', { query: 'other-session' }, 's2')
  assert.equal(other.recent_retrievals.length, 1, '不同调用方 session 的回声相互隔离')
  assert.deepEqual(other.provider_tally, { anysearch: 1 }, '不同调用方 session 的计数相互隔离')

  let last
  for (let i = 0; i < 10; i += 1) {
    last = await runTool(runtime, 'web_retriever_search', { query: `loop-${i}` }, 's3')
  }
  assert.equal(last.recent_retrievals.length, 8, '回声最多保留最近 8 条')
  assert.equal(last.recent_retrievals[7].query, 'loop-9')
  assert.deepEqual(last.provider_tally, { anysearch: 10 }, 'tally 累计不随回声截断而丢失')
})

test('wind_docs_announcements：透传上游工具名与参数，成功返回 data', async () => {
  const { retriever } = fakeRetriever()
  const wind = fakeWindClient()
  const runtime = registerAll(retriever, wind.client)
  const result = await runTool(runtime, 'wind_docs_announcements', { query: '茅台分红公告', top_k: 3 }, 's1')
  assert.equal(result.ok, true)
  assert.equal(result.provider, 'wind_docs')
  assert.equal(result.tool, 'wind_docs_announcements')
  assert.equal(result.query, '茅台分红公告')
  assert.deepEqual(result.data, { items: ['doc'] })
  assert.deepEqual(wind.calls, [{ toolName: 'get_company_announcements', args: { query: '茅台分红公告', top_k: 3 } }])
  assert.ok(result.recent_retrievals.some((item) => item.tool === 'wind_docs_announcements'))

  const noTopK = await runTool(runtime, 'wind_docs_announcements', { query: 'x' }, 's1')
  assert.deepEqual(wind.calls.at(-1).args, { query: 'x' }, 'top_k 省略时不透传默认值')
  assert.equal(noTopK.ok, true)

  const news = await runTool(runtime, 'wind_docs_news', { query: '固态电池新闻' }, 's1')
  assert.equal(news.tool, 'wind_docs_news')
  assert.equal(wind.calls.at(-1).toolName, 'get_financial_news')
})

test('wind_docs：失败返回结构化错误信封而非抛错；参数校验拒绝越界', async () => {
  const { retriever } = fakeRetriever()
  const failing = fakeWindClient({ callTool: async () => ({ ok: false, code: 'AUTH', error: 'Wind API Key 未配置' }) })
  const runtime = registerAll(retriever, failing.client)
  const result = await runTool(runtime, 'wind_docs_announcements', { query: 'x' }, 's1')
  assert.deepEqual({ ok: result.ok, code: result.code, error: result.error }, {
    ok: false, code: 'AUTH', error: 'Wind API Key 未配置',
  })

  await assert.rejects(() => runTool(runtime, 'wind_docs_announcements', { query: '' }), /query is required/)
  await assert.rejects(() => runTool(runtime, 'wind_docs_announcements', { query: 'x', top_k: 0 }), /between 1 and 10/)
  await assert.rejects(() => runTool(runtime, 'wind_docs_news', { query: 'x', top_k: 11 }), /between 1 and 10/)
})
