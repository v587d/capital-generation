// Throttle + shared eastmoney client regression.
// Eastmoney rate-limits by egress IP (community-measured: >5 req/s, >=200/min, >=300/5min => temp ban),
// which is why the default minimum interval is 1000ms and both data planes must share ONE client.
// The hub's FIFO only guarantees one request in flight and carries no minimum gap: serial != throttled.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequestThrottle } from '../lib/net/throttle.js'
import {
  EASTMONEY_MIN_INTERVAL_MS,
  EastmoneyTransportError,
  createEastmoneyClient,
  sharedEastmoneyClient,
} from '../lib/net/eastmoney-client.js'

test('节流器：串行 + 最小间隔，且**并发**进入时仍然守间隔', async () => {
  const throttle = createRequestThrottle(60)
  const startedAt = []
  const task = (index) => throttle(async () => {
    startedAt.push(Date.now())
    return index
  })
  // 5 submitted at once, mirroring a model calling several tools in a single message
  const results = await Promise.all([0, 1, 2, 3, 4].map(task))
  assert.deepEqual(results, [0, 1, 2, 3, 4], '顺序必须保持')
  assert.equal(startedAt.length, 5)
  for (let index = 1; index < startedAt.length; index += 1) {
    const gap = startedAt[index] - startedAt[index - 1]
    assert.ok(gap >= 55, `第 ${index} 次与上一次的间隔 ${gap}ms 小于最小间隔（并发时最容易退化成同时发出）`)
  }
})

test('节流器：某个任务失败不会断开链（后续请求仍守间隔）', async () => {
  const throttle = createRequestThrottle(40)
  const startedAt = []
  const attempt = (index, fail) => throttle(async () => {
    startedAt.push(Date.now())
    if (fail) throw new Error(`boom ${index}`)
    return index
  })
  await assert.rejects(attempt(0, true), /boom 0/)
  assert.equal(await attempt(1, false), 1)
  assert.equal(await attempt(2, false), 2)
  for (let index = 1; index < startedAt.length; index += 1) {
    assert.ok(startedAt[index] - startedAt[index - 1] >= 35, '失败后链必须继续守间隔')
  }
})

test('节流器：配错的间隔必须响亮失败（静默失效等于没有节流）', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.throws(() => createRequestThrottle(bad), /non-negative finite number/)
  }
})

test('东财客户端：共享单例只有一份（两条数据面必须拿到同一个节流器）', () => {
  assert.equal(sharedEastmoneyClient(), sharedEastmoneyClient())
  assert.notEqual(sharedEastmoneyClient(), createEastmoneyClient(), '显式新建的实例与单例不同（测试用）')
})

test('东财客户端：HTTP 错误状态归类为带 status 的传输错误，429 可被识别', async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return {
      ok: false,
      status: 429,
      headers: new Headers(),
      text: async () => '',
      json: async () => ({}),
    }
  }
  try {
    const client = createEastmoneyClient({ minIntervalMs: 0 })
    await assert.rejects(client.fetchJson('https://push2.eastmoney.com/api/qt/stock/get'), (error) => {
      assert.ok(error instanceof EastmoneyTransportError)
      assert.equal(error.status, 429)
      return true
    })
    // Default UA must be sent: upstream rate-limits empty UA / missing browser fingerprint
    assert.match(calls[0].init.headers['user-agent'], /Mozilla/)
  } finally {
    globalThis.fetch = original
  }
})

test('东财客户端：调用方取消原样抛 AbortError，不包装成传输错误', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    const error = new Error('aborted')
    error.name = 'AbortError'
    throw error
  }
  try {
    const client = createEastmoneyClient({ minIntervalMs: 0 })
    await assert.rejects(client.fetchText('https://push2.eastmoney.com/x'), (error) => {
      assert.equal(error.name, 'AbortError')
      assert.ok(!(error instanceof EastmoneyTransportError), '取消不是传输失败')
      return true
    })
  } finally {
    globalThis.fetch = original
  }
})

test('东财客户端：节流等待前已取消仍原样抛 AbortError', async () => {
  const controller = new AbortController()
  controller.abort()
  const client = createEastmoneyClient({ minIntervalMs: 1000 })
  await assert.rejects(client.fetchJson('https://push2.eastmoney.com/api/qt/stock/get', { signal: controller.signal }), (error) => {
    assert.equal(error.name, 'AbortError')
    assert.ok(!(error instanceof EastmoneyTransportError), '调用方取消不是传输失败')
    return true
  })
})

test('东财客户端：默认最小间隔覆盖秒级和累计窗口口径', () => {
  assert.equal(EASTMONEY_MIN_INTERVAL_MS, 1000)
})
