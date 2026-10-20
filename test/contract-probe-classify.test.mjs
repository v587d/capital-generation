/**
 * Verdict classifier regression. `classify()` alone decides whether a daily Issue opens, yet it
 * depends entirely on upstream error text and codes; a casual regex edit would either mute real
 * failures or alarm on noise. Every shape here was observed in real runs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classify, rowsOf, expectedRowKeys, ISSUE_VERDICTS } from '../scripts/lib/contract-probe.mjs'

const ok = { minRows: 1, ms: 100, budgetMs: 20_000 }

test('成功路径：PASS / SLOW / EMPTY / GUARD 互不吞并', () => {
  assert.equal(classify({ ...ok, guardOk: true, rowCount: 3 }), 'PASS')
  assert.equal(classify({ ...ok, guardOk: true, rowCount: 3, ms: 25_000 }), 'SLOW')
  assert.equal(classify({ ...ok, guardOk: true, rowCount: 0 }), 'EMPTY', 'minRows=1 而 0 行 = 空，不是坏')
  assert.equal(classify({ ...ok, guardOk: true, rowCount: 0, minRows: 0 }), 'PASS', '允许空的能力，0 行是合法成功')
  assert.equal(classify({ ...ok, guardOk: false, rowCount: 5 }), 'GUARD', '护栏失败优先于行数')
  assert.equal(classify({ ...ok, guardOk: true, rowCount: 1, identityMismatch: true }), 'GUARD',
    '拿回的不是请求的那个标的 = 结构级失败，不能算成功')
})

test('GUARD 与 SLOW/EMPTY 同时成立时取 GUARD——只有它意味着代码要改', () => {
  assert.equal(classify({ ...ok, guardOk: false, rowCount: 0, ms: 25_000 }), 'GUARD')
})

test('Fuyao 业务码骑在 HTTP 200 上，只出现在消息文本里', () => {
  const error = new Error('Fuyao API error 5003: data source unavailable')
  assert.equal(classify({ error, ...ok }), 'ENVELOPE')
  assert.equal(classify({ error, ...ok, knownCodes: ['5003'] }), 'PASS',
    '已知数据缺口（§10.4「不要反复重试」）不该每天开一张 Issue')
  assert.equal(classify({ error: new Error('Fuyao API error 2004: capability closed'), ...ok },), 'ENVELOPE')
})

test('网络抖动一律 TRANSPORT，绝不开单——hosted 是共享机房出口 IP', () => {
  const cases = [
    new Error('Eastmoney request failed for sector rotation: eastmoney request failed: fetch failed'),
    Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    Object.assign(new Error('超出 30000ms 预算被中止'), { code: 'TIMEOUT' }),
    Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) }),
  ]
  for (const error of cases) {
    assert.equal(classify({ error, ...ok }), 'TRANSPORT', `${error.message} 该判成 TRANSPORT`)
  }
  assert.ok(!ISSUE_VERDICTS.includes('TRANSPORT'), 'TRANSPORT 永远不该进开单集合')
})

test('HTTP 状态与限流算 HTTP_STATUS，会开单', () => {
  assert.equal(classify({ error: Object.assign(new Error('tencent 429'), { code: 'tencent_rate_limit' }), ...ok }), 'HTTP_STATUS')
  assert.equal(classify({ error: Object.assign(new Error('local fetch returned HTTP 403'), { status: 403 }), ...ok }), 'HTTP_STATUS')
  assert.equal(classify({ error: Object.assign(new Error('HTTP 500'), { status: 500 }), ...ok }), 'HTTP_STATUS')
})

test('合法空结果与参数被拒各有归属，不许混进 TRANSPORT', () => {
  // "no records" is a data gap, not a transport failure — a live run once misclassified it.
  const noBillboard = Object.assign(new Error('Eastmoney ticker 600519.SH has no billboard records'), { code: 'eastmoney_no_billboard_data' })
  assert.equal(classify({ error: noBillboard, ...ok }), 'EMPTY')
  const notFound = Object.assign(new Error('互动易查不到 600519'), { code: 'NOT_FOUND' })
  assert.equal(classify({ error: notFound, ...ok }), 'EMPTY')
  const badTicker = Object.assign(new Error('unknown ticker'), { code: 'eastmoney_invalid_ticker' })
  assert.equal(classify({ error: badTicker, ...ok }), 'ENVELOPE', '注册表样本写错了要看得见，别藏在噪声里')
})

test('AnySearch 替目标站报的错不算 AnySearch 坏——巡检测的不是 gov.cn 开不开门', () => {
  const extractFailed = Object.assign(new Error('AnySearch /v1/extract error: Unable to extract content from the URL. (extract_failed)'), { code: 'UPSTREAM' })
  assert.equal(classify({ error: extractFailed, ...ok }), 'PASS')
  // Auth and rate limits reported by AnySearch itself are real failures.
  assert.equal(classify({ error: Object.assign(new Error('AnySearch 401'), { code: 'AUTH', status: 401 }), ...ok }), 'HTTP_STATUS')
})

test('rowsOf 认 rowShape 的三种形状，不猜', () => {
  assert.deepEqual(rowsOf([{ a: 1 }], { rootArray: true }), [{ a: 1 }])
  assert.deepEqual(rowsOf({ item: [{ a: 1 }], pagination: {} }, { rowKey: 'item' }), [{ a: 1 }])
  assert.deepEqual(rowsOf({ rows: [{ a: 1 }] }, { rowKey: 'rows' }), [{ a: 1 }])
  assert.deepEqual(rowsOf(null, undefined), [], '空响应不许抛')
  assert.deepEqual(rowsOf('text', undefined), [], '非对象响应不许抛')
})

test('expectedRowKeys 从 output_schema 取，两种信封都要认', () => {
  const wrapped = { type: 'object', properties: { item: { type: 'array', items: { type: 'object', properties: { thscode: { type: 'string' }, price: { type: 'number' } } } } } }
  assert.deepEqual(expectedRowKeys(wrapped), ['thscode', 'price'])
  const rootArray = { type: 'array', items: { type: 'object', properties: { code: { type: 'string' } } } }
  assert.deepEqual(expectedRowKeys(rootArray), ['code'])
  assert.deepEqual(expectedRowKeys(undefined), [], '没声明 schema 时返回空，不抛')
})
