import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_UPSTREAM_ATTEMPTS,
  UpstreamRetryBudget,
  alternativesFor,
  classifyUpstreamFailure,
  retryBudgetKey,
  upstreamFailureError,
} from '../lib/data-collector/upstream-retry.js'

test('上游失败分类：限流、网络、超时、5xx 才算可重试', () => {
  assert.equal(classifyUpstreamFailure(Object.assign(new Error('Fuyao HTTP error 429'), { status: 429 }))?.kind, 'rate_limited')
  assert.equal(classifyUpstreamFailure(new Error('Fuyao API error 4001: request failed'))?.kind, 'rate_limited')
  assert.equal(classifyUpstreamFailure(new Error('Eastmoney request failed for sector rotation: eastmoney request failed: fetch failed'))?.kind, 'transport')
  assert.equal(classifyUpstreamFailure(new Error('request timed out'))?.kind, 'timeout')
  assert.equal(classifyUpstreamFailure(Object.assign(new Error('Fuyao HTTP error 502'), { status: 502 }))?.kind, 'server')
  assert.equal(classifyUpstreamFailure(new Error('Eastmoney HTTP 500 for sector rotation'))?.kind, 'server')
  // Eastmoney IP bans are transport-level 403s; ordinary 403s are plan/permission errors.
  assert.equal(classifyUpstreamFailure(new Error('Eastmoney HTTP 403 for sector rotation'))?.kind, 'rate_limited')
})

test('上游失败分类：参数、凭据、能力关闭、主动中止都不计数', () => {
  assert.equal(classifyUpstreamFailure(Object.assign(new Error('capability_closed: 2004'), { code: 'capability_closed' })), null)
  assert.equal(classifyUpstreamFailure(Object.assign(new Error('Fuyao API error 2004: closed'), { code: 2004 })), null)
  assert.equal(classifyUpstreamFailure(Object.assign(new Error('FTShare HTTP error 403'), { kind: 'plan_closed', status: 403 })), null)
  assert.equal(classifyUpstreamFailure(Object.assign(new Error('parameter ticker must be a string'), { code: 'request_params_invalid' })), null)
  assert.equal(classifyUpstreamFailure(Object.assign(new Error('request aborted'), { name: 'AbortError' })), null)
  assert.equal(classifyUpstreamFailure(Object.assign(new Error('已停止重试'), { code: 'upstream_retry_exhausted' })), null)
})

test('重试预算：同一 key 第 3 次失败即耗尽，成功或超时窗口清零', () => {
  let now = 1_000
  const budget = new UpstreamRetryBudget({ now: () => now })
  const key = retryBudgetKey('sess-1', 'index_quote')
  assert.equal(budget.inspect(key), undefined)
  assert.deepEqual(budget.record(key, { kind: 'transport', message: 'fetch failed' }), {
    attempts: 1,
    exhausted: false,
    failure: { kind: 'transport', message: 'fetch failed' },
  })
  assert.equal(budget.record(key, { kind: 'transport', message: 'fetch failed' }).exhausted, false)
  const third = budget.record(key, { kind: 'transport', message: 'fetch failed' })
  assert.equal(third.attempts, MAX_UPSTREAM_ATTEMPTS)
  assert.equal(third.exhausted, true)
  assert.equal(budget.inspect(key)?.exhausted, true)
  budget.reset(key)
  assert.equal(budget.inspect(key), undefined)
  // A gap longer than the window drops the old attempt count.
  budget.record(key, { kind: 'timeout', message: 'timeout' })
  now += 6 * 60_000
  assert.equal(budget.inspect(key), undefined)
  assert.equal(budget.record(key, { kind: 'timeout', message: 'timeout' }).attempts, 1)
  assert.equal(budget.inspect(retryBudgetKey('sess-2', 'index_quote')), undefined)
})

test('终止错误：带停止、替代与回传指令', () => {
  const retryable = upstreamFailureError({
    capability: 'index_quote',
    failure: { kind: 'transport', message: 'fetch failed' },
    attempts: 1,
    terminal: false,
  })
  assert.equal(retryable.code, 'upstream_retryable_failure')
  assert.match(retryable.message, /第 1\/3 次/)
  assert.match(retryable.message, /wait_agent/)
  assert.match(retryable.message, /tencent_quote/)

  const terminal = upstreamFailureError({
    capability: 'eastmoney_sector_rotation',
    failure: { kind: 'transport', message: 'fetch failed' },
    attempts: 3,
    terminal: true,
  })
  assert.equal(terminal.code, 'upstream_retry_exhausted')
  assert.match(terminal.message, /已连续 3 次/)
  assert.match(terminal.message, /没有已核对的等价上游/)
  assert.match(terminal.message, /data_failed/)
  assert.match(terminal.message, /data_collection_completed/)
  assert.match(terminal.message, /wait_agent/)
  assert.deepEqual(terminal.alternatives, [])
  assert.deepEqual(alternativesFor('index_quote'), ['tencent_quote'])
  assert.deepEqual(alternativesFor('eastmoney_sector_rotation'), [])
})
