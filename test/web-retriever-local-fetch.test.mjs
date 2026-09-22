import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  LOCAL_FETCH_CLIENT_VERSION,
  LOCAL_FETCH_MAX_URL_LENGTH,
  LocalFetchError,
  createLocalFetcher,
  isPublicIp,
} from '../lib/web-retriever/local-fetch.js'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/u, '')

function makeResponse(status, headers = {}, body = '') {
  const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(body)
  return {
    status,
    headers: {
      get(name) {
        const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
        return key === undefined ? null : headers[key]
      },
    },
    body: {
      getReader() {
        let done = false
        return {
          async read() {
            if (done) return { done: true, value: undefined }
            done = true
            return { done: false, value: bytes }
          },
          async cancel() {},
        }
      },
    },
  }
}

function makeFetcher(overrides = {}) {
  return createLocalFetcher({
    timeoutMs: 1_000,
    maxBytes: 1_000_000,
    maxContentChars: 20_000,
    maxRedirects: 3,
    userAgent: 'test-local-fetch',
    resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
    ...overrides,
  })
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof LocalFetchError)
    assert.equal(error.code, code)
    return true
  })
}

function installFetch(handler) {
  const original = globalThis.fetch
  globalThis.fetch = handler
  return () => {
    globalThis.fetch = original
  }
}

test('isPublicIp：拒绝保留 IPv4/IPv6 地址，允许公网地址', () => {
  for (const address of [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1',
    '100.64.0.1', '224.0.0.1', '0.0.0.0', '192.0.2.1', '198.18.0.1',
    '198.51.100.1', '203.0.113.1', '::', '::1', 'fe80::1', 'fd00::1',
    'ff02::1', '::ffff:127.0.0.1',
  ]) assert.equal(isPublicIp(address), false, address)
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) {
    assert.equal(isPublicIp(address), true, address)
  }
})

test('LOCAL_FETCH_CLIENT_VERSION 与 URL 长度常量稳定', async () => {
  const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(LOCAL_FETCH_CLIENT_VERSION, packageJson.version)
  assert.equal(LOCAL_FETCH_MAX_URL_LENGTH, 2048)
})

test('公网闸门先于网络：私网解析结果不会触发 fetch', async () => {
  let calls = 0
  const restore = installFetch(async () => {
    calls += 1
    return makeResponse(200, { 'content-type': 'text/html' }, '<p>bad</p>')
  })
  try {
    await expectCode(makeFetcher({
      resolveAddresses: async () => [{ address: '10.0.0.1', family: 4 }],
    }).fetch('https://private.test/'), 'BLOCKED_URL')
    assert.equal(calls, 0)
  } finally {
    restore()
  }
})

test('公网闸门拒绝混合 DNS 答案，不过滤后继续连接', async () => {
  let calls = 0
  const restore = installFetch(async () => {
    calls += 1
    return makeResponse(200, { 'content-type': 'text/html' }, '<p>bad</p>')
  })
  try {
    await expectCode(makeFetcher({
      resolveAddresses: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    }).fetch('https://mixed.test/'), 'BLOCKED_URL')
    assert.equal(calls, 0)
  } finally {
    restore()
  }
})

test('DNS 不可用时直接失败且不触网', async () => {
  const originalProcess = globalThis.process
  let calls = 0
  const restore = installFetch(async () => {
    calls += 1
    return makeResponse(200, { 'content-type': 'text/html' }, '<p>bad</p>')
  })
  try {
    globalThis.process = {}
    await expectCode(makeFetcher({ resolveAddresses: undefined }).fetch('https://no-dns.test/'), 'DNS')
    assert.equal(calls, 0)
  } finally {
    globalThis.process = originalProcess
    restore()
  }
})

test('allowPrivate 仅显式放行私网地址', async () => {
  const requests = []
  const restore = installFetch(async (url) => {
    requests.push(url)
    return makeResponse(200, { 'content-type': 'text/html' }, '<p>ok</p>')
  })
  try {
    const result = await makeFetcher({ allowPrivate: true }).fetch('http://127.0.0.1/')
    assert.equal(result.markdown, 'ok')
    assert.deepEqual(requests, ['http://127.0.0.1/'])
  } finally {
    restore()
  }
})

test('URL 校验拒绝非 HTTP、凭据和超长 URL', async () => {
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'text/html' }, '<p>bad</p>'))
  try {
    await expectCode(makeFetcher().fetch('ftp://example.test/'), 'INVALID_URL')
    await expectCode(makeFetcher().fetch('https://user:pass@example.test/'), 'INVALID_URL')
    await expectCode(makeFetcher().fetch(`https://example.test/${'x'.repeat(LOCAL_FETCH_MAX_URL_LENGTH)}`), 'INVALID_URL')
  } finally {
    restore()
  }
})

test('同源相对重定向重新校验并返回最终 URL', async () => {
  const requests = []
  const restore = installFetch(async (url, init) => {
    requests.push({ url, init })
    if (requests.length === 1) return makeResponse(302, { location: '/next' })
    return makeResponse(200, { 'content-type': 'text/html; charset=utf-8' }, '<title>Test</title><p>ok</p>')
  })
  try {
    const result = await makeFetcher().fetch('https://example.test/start')
    assert.equal(result.url, 'https://example.test/next')
    assert.equal(result.status, 200)
    assert.equal(result.title, 'Test')
    assert.equal(result.markdown, 'Test\n\nok')
    assert.equal(requests.length, 2)
    assert.equal(requests[0].init.redirect, 'manual')
    assert.equal(requests[0].init.method, 'GET')
    assert.equal(requests[0].init.headers.accept, 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8')
  } finally {
    restore()
  }
})

test('跨源公网重定向放行，但新主机重新走 DNS 闸门', async () => {
  const hosts = []
  const requests = []
  const restore = installFetch(async (url) => {
    requests.push(url)
    if (requests.length === 1) return makeResponse(302, { location: 'https://cdn.test/page' })
    return makeResponse(200, { 'content-type': 'text/html' }, '<p>cdn</p>')
  })
  try {
    const result = await makeFetcher({
      resolveAddresses: async (hostname) => {
        hosts.push(hostname)
        return [{ address: '93.184.216.34', family: 4 }]
      },
    }).fetch('https://origin.test/page')
    assert.equal(result.url, 'https://cdn.test/page')
    assert.deepEqual(hosts, ['origin.test', 'cdn.test'])
    assert.equal(requests.length, 2)
  } finally {
    restore()
  }
})

test('重定向到私网地址被阻止，且不请求目标；无 Location/超限也拒绝', async () => {
  let calls = 0
  const restore = installFetch(async () => {
    calls += 1
    return makeResponse(302, { location: 'http://127.0.0.1/secret' })
  })
  try {
    await expectCode(makeFetcher().fetch('https://origin.test/'), 'BLOCKED_URL')
    assert.equal(calls, 1)
  } finally {
    restore()
  }

  const noLocationRestore = installFetch(async () => makeResponse(302))
  try {
    await expectCode(makeFetcher().fetch('https://origin.test/'), 'REDIRECT')
  } finally {
    noLocationRestore()
  }

  const loopRestore = installFetch(async () => makeResponse(302, { location: '/loop' }))
  try {
    await expectCode(makeFetcher({ maxRedirects: 1 }).fetch('https://origin.test/'), 'REDIRECT')
  } finally {
    loopRestore()
  }
})

test('状态码与 Content-Type 闸门拒绝错误页和 PDF', async () => {
  const httpRestore = installFetch(async () => makeResponse(503, { 'content-type': 'text/html' }, '<p>error</p>'))
  try {
    await expectCode(makeFetcher().fetch('https://example.test/'), 'HTTP')
  } finally {
    httpRestore()
  }
  const typeRestore = installFetch(async () => makeResponse(200, { 'content-type': 'application/pdf' }, '%PDF'))
  try {
    await expectCode(makeFetcher().fetch('https://example.test/'), 'UNSUPPORTED_CONTENT_TYPE')
  } finally {
    typeRestore()
  }
})

test('缺 Content-Type 时按正文保守嗅探：HTML 放行（cls.cn 回归）', async () => {
  // 实测 https://www.cls.cn/detail/2188659 的 GET 响应不带任何 Content-Type，
  // 而同一 URL 的 HEAD 带 text/html；正文是完好的 SSR HTML。原实现"缺头即拒"
  // 把它误判成 UNSUPPORTED_CONTENT_TYPE。
  const restore = installFetch(async () => makeResponse(200, {}, '<!DOCTYPE html><html><head><title>财联社</title></head><body><p>正文</p></body></html>'))
  try {
    const result = await makeFetcher().fetch('https://example.test/detail')
    assert.equal(result.status, 200)
    assert.equal(result.title, '财联社')
    assert.match(result.markdown, /正文/)
  } finally {
    restore()
  }
})

test('缺 Content-Type 时按正文保守嗅探：JSON 与裸标签放行', async () => {
  for (const body of ['{"ok":true}', '<div>x</div>', '<?xml version="1.0"?><r/>']) {
    const restore = installFetch(async () => makeResponse(200, {}, body))
    try {
      const result = await makeFetcher().fetch('https://example.test/x')
      assert.equal(result.status, 200, `正文 ${JSON.stringify(body.slice(0, 12))} 应被嗅探放行`)
    } finally {
      restore()
    }
  }
})

test('缺 Content-Type 且正文认不出类型时仍拒绝（嗅探不放宽闸门）', async () => {
  const restore = installFetch(async () => makeResponse(200, {}, '%PDF-1.7 binary-ish payload'))
  try {
    await expectCode(makeFetcher().fetch('https://example.test/x'), 'UNSUPPORTED_CONTENT_TYPE')
  } finally {
    restore()
  }
})

test('响应头存在但不支持的类型仍然拒绝，不因嗅探放宽', async () => {
  // 嗅探只在**缺头**时启用：显式声明为二进制的响应必须照旧拒绝。
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'application/octet-stream' }, '<!DOCTYPE html><p>伪装成 HTML</p>'))
  try {
    await expectCode(makeFetcher().fetch('https://example.test/x'), 'UNSUPPORTED_CONTENT_TYPE')
  } finally {
    restore()
  }
})

test('字节截断使用增量解码，不产生 U+FFFD，并披露 truncated', async () => {
  const source = '<p>中</p>'
  const bytes = new TextEncoder().encode(source)
  const hanByte = bytes.indexOf(0xe4)
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'text/html' }, bytes))
  try {
    const result = await makeFetcher({ maxBytes: hanByte + 1 }).fetch('https://example.test/')
    assert.equal(result.truncated, true)
    assert.ok(!result.markdown.includes('\ufffd'))
  } finally {
    restore()
  }
})

test('字符上限和 HTML 转换省略都披露 truncated', async () => {
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'text/html' }, '<p>hello world</p>'))
  try {
    const result = await makeFetcher({ maxContentChars: 5 }).fetch('https://example.test/')
    assert.equal(result.truncated, true)
    assert.ok(result.markdown.length <= 5)
  } finally {
    restore()
  }
  const deep = '<div>'.repeat(513) + 'x'
  const deepRestore = installFetch(async () => makeResponse(200, { 'content-type': 'text/html' }, deep))
  try {
    const result = await makeFetcher().fetch('https://example.test/')
    assert.equal(result.truncated, true)
  } finally {
    deepRestore()
  }
})

test('未知 charset 归类为 UNSUPPORTED_CONTENT_TYPE', async () => {
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'text/html; charset=x-unknown' }, '<p>x</p>'))
  try {
    await expectCode(makeFetcher().fetch('https://example.test/'), 'UNSUPPORTED_CONTENT_TYPE')
  } finally {
    restore()
  }
})

test('调用方预先取消不会解析 DNS 或发起请求', async () => {
  const controller = new AbortController()
  controller.abort()
  let resolved = 0
  let calls = 0
  const restore = installFetch(async () => {
    calls += 1
    return makeResponse(200, { 'content-type': 'text/html' }, '<p>bad</p>')
  })
  try {
    await expectCode(makeFetcher({
      resolveAddresses: async () => {
        resolved += 1
        return [{ address: '93.184.216.34', family: 4 }]
      },
    }).fetch('https://example.test/', controller.signal), 'ABORTED')
    assert.equal(resolved, 0)
    assert.equal(calls, 0)
  } finally {
    restore()
  }
})

test('调用方 abort 与内部超时区分错误码', async () => {
  const abortRestore = installFetch(async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  try {
    const controller = new AbortController()
    const pending = makeFetcher({ timeoutMs: 1_000 }).fetch('https://example.test/', controller.signal)
    setTimeout(() => controller.abort(), 5)
    await expectCode(pending, 'ABORTED')
  } finally {
    abortRestore()
  }

  const timeoutRestore = installFetch(async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('timed out')), { once: true })
  }))
  try {
    await expectCode(makeFetcher({ timeoutMs: 5 }).fetch('https://example.test/'), 'TIMEOUT')
  } finally {
    timeoutRestore()
  }
})

test('src/web-retriever 不使用静态 node: 导入，依赖不引入 @types/node', async () => {
  const sourceDir = join(ROOT, 'src', 'web-retriever')
  const entries = await (await import('node:fs/promises')).readdir(sourceDir)
  for (const entry of entries.filter((name) => name.endsWith('.ts'))) {
    const source = await readFile(join(sourceDir, entry), 'utf8')
    assert.doesNotMatch(source, /from\s+['"]node:/u, entry)
  }
  const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  assert.ok(!('@types/node' in packageJson.dependencies))
  assert.ok(!('@types/node' in packageJson.devDependencies))
})
