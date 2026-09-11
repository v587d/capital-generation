import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createWindClient,
  DEFAULT_WIND_ENDPOINT,
  WIND_MAX_CONTENT_CHARS,
} from '../lib/web-retriever/wind-client.js'

const okKey = async () => 'secret'

/** 替换 globalThis.fetch 并记录每次调用；用完必须 restore。 */
function stubFetch(impl) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) })
    return impl(calls.length, { url: String(url), init })
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

const rpcResponse = (result) => JSON.stringify({ jsonrpc: '2.0', id: 1, result })
const textResult = (value) => rpcResponse({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
})
const sseResponse = (obj) => `event: message\ndata: ${JSON.stringify(obj)}\n\n`

test('createWindClient：只接受 http(s) endpoint；缺省用官方端点', async () => {
  assert.throws(() => createWindClient({ endpoint: 'ftp://x', resolveApiKey: okKey }), /invalid Wind endpoint/)
  const stub = stubFetch(() => ({ ok: true, status: 200, text: async () => rpcResponse({}) }))
  try {
    const client = createWindClient({ resolveApiKey: okKey, retryDelaysMs: [0, 0] })
    await client.callTool('get_financial_news', { query: 'x' })
    assert.equal(stub.calls[0].url, DEFAULT_WIND_ENDPOINT)
  } finally {
    stub.restore()
  }
})

test('callTool：先 initialize 再 tools/call，Bearer 与 MCP 线头齐全，参数按 JSON-RPC envelope 透传', async () => {
  const stub = stubFetch((n) => (n === 1
    ? { ok: true, status: 200, text: async () => rpcResponse({}) }
    : { ok: true, status: 200, text: async () => textResult({ items: ['a'] }) }))
  try {
    const client = createWindClient({ resolveApiKey: okKey, retryDelaysMs: [0, 0] })
    const result = await client.callTool('get_company_announcements', { query: '茅台分红', top_k: 3 })
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, { items: ['a'] })
    assert.equal(stub.calls.length, 2)
    assert.equal(stub.calls[0].body.method, 'initialize')
    assert.equal(stub.calls[0].body.params.protocolVersion, '2025-03-26')
    assert.equal(stub.calls[1].body.method, 'tools/call')
    assert.deepEqual(stub.calls[1].body.params, {
      name: 'get_company_announcements',
      arguments: { query: '茅台分红', top_k: 3 },
      _meta: { clientVersion: '0.1.0' },
    })
    for (const call of stub.calls) {
      assert.match(call.init.headers.authorization, /Bearer secret/)
      assert.match(call.init.headers.accept, /text\/event-stream/)
      assert.equal(call.init.headers['content-type'], 'application/json')
    }
  } finally {
    stub.restore()
  }
})

test('响应解析：支持 SSE 与纯 JSON 双形态', async () => {
  const stub = stubFetch((n) => (n === 1
    ? { ok: true, status: 200, text: async () => rpcResponse({}) }
    : { ok: true, status: 200, text: async () => sseResponse(JSON.parse(textResult({ ok: 1 }))) }))
  try {
    const client = createWindClient({ resolveApiKey: okKey, retryDelaysMs: [0, 0] })
    const result = await client.callTool('get_financial_news', { query: 'x' })
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, { ok: 1 })
  } finally {
    stub.restore()
  }
})

test('三层错误解包：JSON-RPC error / isError / 内层业务错误都归 BACKEND', async () => {
  const cases = [
    { text: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'boom' } }), expected: 'boom' },
    { text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'quota exceeded' }] } }), expected: 'quota exceeded' },
    { text: textResult({ mcp_tool_error_code: 1001, mcp_tool_error_msg: 'no auth' }), expected: 'no auth' },
    { text: textResult({ error: { code: 'X', message: 'inner error' } }), expected: 'inner error' },
    { text: textResult({ data: { code: 500, message: 'backend down' } }), expected: 'backend down' },
  ]
  for (const item of cases) {
    const stub = stubFetch((n) => (n === 1
      ? { ok: true, status: 200, text: async () => rpcResponse({}) }
      : { ok: true, status: 200, text: async () => item.text }))
    try {
      const client = createWindClient({ resolveApiKey: okKey, retryDelaysMs: [0, 0] })
      const result = await client.callTool('get_company_announcements', { query: 'x' })
      assert.equal(result.ok, false)
      assert.equal(result.code, 'BACKEND')
      assert.equal(result.error, item.expected)
    } finally {
      stub.restore()
    }
  }
})

test('成功路径：非 JSON 文本按原文透传；长字符串字段裁剪到 20k', async () => {
  const plainStub = stubFetch((n) => (n === 1
    ? { ok: true, status: 200, text: async () => rpcResponse({}) }
    : { ok: true, status: 200, text: async () => textResult('plain announcement body') }))
  try {
    const client = createWindClient({ resolveApiKey: okKey, retryDelaysMs: [0, 0] })
    const result = await client.callTool('get_company_announcements', { query: 'x' })
    assert.equal(result.ok, true)
    assert.equal(result.content, 'plain announcement body')
    assert.equal(result.content_chars, 'plain announcement body'.length)
  } finally {
    plainStub.restore()
  }

  const long = 'x'.repeat(WIND_MAX_CONTENT_CHARS + 5_000)
  const trimStub = stubFetch((n) => (n === 1
    ? { ok: true, status: 200, text: async () => rpcResponse({}) }
    : { ok: true, status: 200, text: async () => textResult({ rows: [{ body: long }] }) }))
  try {
    const client = createWindClient({ resolveApiKey: okKey, retryDelaysMs: [0, 0] })
    const result = await client.callTool('get_company_announcements', { query: 'x' })
    assert.equal(result.ok, true)
    assert.equal(result.data.rows[0].body.length, WIND_MAX_CONTENT_CHARS)
  } finally {
    trimStub.restore()
  }
})

test('HTTP 状态映射：401→AUTH、429→RATE_LIMIT、500→NETWORK；HTTP 错误不重试', async () => {
  const cases = [[401, 'AUTH'], [429, 'RATE_LIMIT'], [500, 'NETWORK']]
  for (const [status, code] of cases) {
    const stub = stubFetch(() => ({ ok: false, status, text: async () => 'denied' }))
    try {
      const client = createWindClient({ resolveApiKey: okKey, retryDelaysMs: [0, 0] })
      const result = await client.callTool('get_financial_news', { query: 'x' })
      assert.equal(result.ok, false)
      assert.equal(result.code, code)
      assert.equal(stub.calls.length, 1, `HTTP ${status} 不应重试`)
    } finally {
      stub.restore()
    }
  }
})

test('网络错误按退避重试，最终成功；Key 缺失直接 AUTH 不触网', async () => {
  let attempts = 0
  const retryStub = stubFetch(() => {
    attempts += 1
    if (attempts < 3) throw new Error('ECONNRESET')
    return { ok: true, status: 200, text: async () => textResult({ items: [1] }) }
  })
  try {
    const client = createWindClient({ resolveApiKey: okKey, retryDelaysMs: [0, 0] })
    const result = await client.callTool('get_financial_news', { query: 'x' })
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, { items: [1] })
    // initialize 网络错误重试 2 次后成功（3 次请求），tools/call 首次即成功（第 4 次请求）。
    assert.equal(retryStub.calls.length, 4)
  } finally {
    retryStub.restore()
  }

  const noKeyCalls = []
  const original = globalThis.fetch
  globalThis.fetch = async () => { noKeyCalls.push(1); throw new Error('should not be called') }
  try {
    const client = createWindClient({ resolveApiKey: async () => undefined, retryDelaysMs: [0, 0] })
    const result = await client.callTool('get_financial_news', { query: 'x' })
    assert.deepEqual({ ok: result.ok, code: result.code }, { ok: false, code: 'AUTH' })
    assert.equal(noKeyCalls.length, 0)
  } finally {
    globalThis.fetch = original
  }
})

test('超时归 NETWORK；调用方取消时不重试', async () => {
  const timeoutStub = stubFetch((_n, { init }) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')))
  }))
  try {
    const client = createWindClient({ resolveApiKey: okKey, timeoutMs: 20, retryDelaysMs: [0, 0] })
    const result = await client.callTool('get_financial_news', { query: 'x' })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'NETWORK')
    assert.match(result.error, /超时/)
  } finally {
    timeoutStub.restore()
  }

  const controller = new AbortController()
  const cancelStub = stubFetch((_n, { init }) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')))
  }))
  try {
    const client = createWindClient({ resolveApiKey: okKey, timeoutMs: 5_000, retryDelaysMs: [0, 0] })
    controller.abort()
    const result = await client.callTool('get_financial_news', { query: 'x' }, controller.signal)
    assert.equal(result.ok, false)
    assert.equal(cancelStub.calls.length, 0, '已取消的调用不应发出任何请求')
  } finally {
    cancelStub.restore()
  }
})
