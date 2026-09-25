import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTencentSources } from '../lib/sources/tencent-http.js'
import { parseSecurityCode, normalizeSecurityCodes } from '../lib/sources/security-code.js'

const session = { id: 'smoke-test', header: { cwd: '/workspace/project' } }
const signal = new AbortController().signal

function response(text) {
  const bytes = new TextEncoder().encode(text)
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer }
}

function quoteText(symbol, values = {}) {
  const fields = Array.from({ length: 53 }, () => '')
  fields[1] = values.name ?? 'TEST'
  fields[3] = String(values.price ?? 10)
  fields[4] = String(values.lastClose ?? 9)
  fields[5] = String(values.open ?? 9.5)
  fields[30] = values.timestamp ?? '20260924100000'
  fields[31] = String(values.changeAmt ?? 1)
  fields[32] = String(values.changePct ?? 11.11)
  fields[33] = String(values.high ?? 10.5)
  fields[34] = String(values.low ?? 9.4)
  fields[35] = `10/1/${values.amount ?? 100}`
  fields[37] = String(values.amountWan ?? 100)
  fields[38] = '1.2'
  fields[39] = '12.3'
  fields[43] = '2.1'
  fields[44] = '100'
  fields[45] = '120'
  fields[46] = '1.1'
  fields[47] = '11'
  fields[48] = '8'
  fields[49] = '1.5'
  fields[52] = '13.1'
  return `v_${symbol}="${fields.join('~')}";`
}

function sourceMap() {
  return Object.fromEntries(createTencentSources().map((source) => [source.schema.capability, source]))
}

async function execute(source, params) {
  const normalized = source.normalizeParams(params)
  return source.execute({ capability: source.schema.capability, params: normalized, session }, signal)
}

test('security code normalization preserves exchange and rejects ambiguous bare 000xxx', () => {
  assert.deepEqual(parseSecurityCode('600519.SH'), {
    digits: '600519', market: 'SH', canonical: '600519.SH', tencentSymbol: 'sh600519', isIndex: false,
  })
  assert.equal(parseSecurityCode('000001.SH').isIndex, true)
  assert.equal(parseSecurityCode('000001.SZ').isIndex, false)
  assert.equal(parseSecurityCode('600519.XSHG').canonical, '600519.SH')
  assert.throws(() => parseSecurityCode('000001'), /explicit exchange/)
  assert.throws(() => parseSecurityCode('SZ600519'), /exchange conflicts/)
  assert.deepEqual(normalizeSecurityCodes(['600519.SH', '600519.XSHG', '000001.SZ']).map((code) => code.canonical), ['600519.SH', '000001.SZ'])
})

test('Tencent source registry uses three non-conflicting capabilities and source label', () => {
  const sources = createTencentSources()
  assert.deepEqual(sources.map((source) => source.schema.capability), ['tencent_quote', 'tencent_kline', 'tencent_ticks'])
  assert.deepEqual(sources.map((source) => source.schema.source_label), ['tencent', 'tencent', 'tencent'])
  assert.equal(new Set(sources.map((source) => source.schema.data_key)).size, 3)
  for (const source of sources) {
    assert.ok(source.schema.input_schema)
    assert.ok(source.schema.output_schema)
    assert.match(source.schema.description, /腾讯/)
  }
})

test('tencent_quote parses GBK-text-compatible snapshot fields and preserves stale signal', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => response(
    quoteText('sh600519', { amountWan: 0, price: 10, lastClose: 10 }) + quoteText('sz000001', { amountWan: 100, name: 'TEST2' }),
  )
  try {
    const result = await execute(sources.tencent_quote, { codes: ['600519.SH', '000001.SZ'] })
    assert.equal(result.data.length, 2)
    assert.equal(result.data[0].code, '600519.SH')
    assert.equal(result.data[0].is_stale, true)
    assert.equal(result.data[1].name, 'TEST2')
    assert.equal(sources.tencent_quote.validateOutput(result.data), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tencent_kline rotates empty host and parses raw daily rows', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (url) => {
    calls += 1
    if (calls === 1) return response(JSON.stringify({ code: 0, data: {} }))
    return response(JSON.stringify({
      code: 0,
      data: { sh600519: { day: [['2026-09-22', '10', '10.5', '10.8', '9.9', '123'], ['2026-09-23', '10.5', '10.6', '10.9', '10.2', '456']] } },
    }))
  }
  try {
    const result = await execute(sources.tencent_kline, { code: '600519.SH', period: 'day', adjust: 'none', count: 2 })
    assert.equal(calls, 2)
    assert.deepEqual(result.data.map((row) => row.date), ['2026-09-22', '2026-09-23'])
    assert.equal(result.data[0].volume, 123)
    assert.equal(result.data[0].adjust, 'none')
    assert.equal(sources.tencent_kline.validateOutput(result.data), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tencent_kline 取消原样抛出：不拉黑任何入口、不降级成 tencent_kline_unavailable（§4.2）', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  const aborted = new Error('This operation was aborted')
  aborted.name = 'AbortError'
  globalThis.fetch = async () => { throw aborted }
  try {
    await assert.rejects(
      execute(sources.tencent_kline, { code: '600519.SH', period: 'day', adjust: 'none', count: 2 }),
      (error) => error.name === 'AbortError',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
  // 取消不得把入口写进 hostDownUntil：紧随其后的正常调用一次命中。
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return response(JSON.stringify({ code: 0, data: { sh600519: { day: [['2026-09-22', '10', '10.5', '10.8', '9.9', '123']] } } }))
  }
  try {
    const result = await execute(sources.tencent_kline, { code: '600519.SH', period: 'day', adjust: 'none', count: 1 })
    assert.equal(calls, 1, '取消不该造成连带拉黑后的换机或整表不可用')
    assert.deepEqual(result.data.map((row) => row.date), ['2026-09-22'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('腾讯出口只有一条节流链：并发调用被串开，不重叠打到上游', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  let inFlight = 0
  let maxConcurrent = 0
  const startedAt = []
  globalThis.fetch = async () => {
    inFlight += 1
    maxConcurrent = Math.max(maxConcurrent, inFlight)
    startedAt.push(Date.now())
    await new Promise((resolve) => setTimeout(resolve, 5))
    inFlight -= 1
    return response(quoteText('sh600519'))
  }
  try {
    // 模型在一条消息里发多个调用时框架会并发执行——各自 sleep 仍会同时到达上游。
    await Promise.all([
      execute(sources.tencent_quote, { codes: ['600519.SH'] }),
      execute(sources.tencent_quote, { codes: ['600519.SH'] }),
      execute(sources.tencent_quote, { codes: ['600519.SH'] }),
    ])
    assert.equal(maxConcurrent, 1, '腾讯出口必须串行：同一时刻只允许一个请求在飞')
    assert.equal(startedAt.length, 3)
    for (const gap of [startedAt[1] - startedAt[0], startedAt[2] - startedAt[1]]) {
      assert.ok(gap >= 110, `相邻两次请求之间必须留出一个最小间隔，实测 ${gap}ms`)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('腾讯出口：信号已取消时不排队，直接原样抛 AbortError（§4.2）', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return response(quoteText('sh600519')) }
  const controller = new AbortController()
  controller.abort()
  try {
    await assert.rejects(
      sources.tencent_quote.execute(
        { capability: 'tencent_quote', params: { codes: ['600519.SH'] }, session },
        controller.signal,
      ),
      (error) => error.name === 'AbortError',
    )
    assert.equal(calls, 0, '已取消的调用不得排进节流链（队首挂住时会把这次取消吞掉）')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tencent_ticks parses paged rows and verifies continuous-session amount', async () => {
  const sources = sourceMap()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const text = String(url)
    if (text.includes('qt.gtimg.cn')) return response(quoteText('sz000001', { timestamp: '20260924100000', amount: 100, amountWan: 100 }))
    if (text.includes('p=0')) return response('v_detail_data_sz000001=[0,"0/09:30:00/10/0/1/100/M"];')
    return response('v_detail_data_sz000001=[1,""];')
  }
  try {
    const result = await execute(sources.tencent_ticks, { code: '000001.SZ' })
    assert.equal(result.data.date, '2026-09-24')
    assert.equal(result.data.rows.length, 1)
    assert.equal(result.data.rows[0].side, 'M')
    assert.deepEqual(result.data.missing_seq, [])
    assert.equal(sources.tencent_ticks.validateOutput(result.data), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
