import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAnySearchClient,
  envKey,
  normalizeFetchResponse,
  normalizeSearchHit,
  normalizeSearchResponse,
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
