/**
 * Issue body shape. This Markdown is the only human-read output of the probe suite, and it fails
 * quietly: misaligned tables, real failures folded into noise, or response bodies / query strings
 * leaking into a public Issue (that last one is a security issue, not formatting).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderReport, closeDecision } from '../scripts/lib/contract-report.mjs'

function report(overrides = {}) {
  return {
    at: '2026-10-08T23:00:00.000Z', tier: 'daily',
    egress: { ip: '20.83.175.155', country: 'US', city: 'Dulles', org: 'AS8075' },
    counts: { total: 4, pass: 1, slow: 0, empty: 1, transport: 1, skipped: 0, shadow: 1, failing: 1 },
    results: [
      { capability: 'quote', family: 'fuyao', state: 'active', verdict: 'PASS', ms: 90 },
      { capability: 'eastmoney_top_buy_sell_ticker', family: 'eastmoney', state: 'active', verdict: 'EMPTY', ms: 1900, detail: 'no billboard records' },
      { capability: 'eastmoney_sector_rotation', family: 'eastmoney', state: 'active', verdict: 'TRANSPORT', ms: 990, detail: 'fetch failed' },
      { capability: 'sseinfo_qa', family: 'retriever', state: 'shadow', verdict: 'HTTP_STATUS', ms: 120 },
    ],
    failing: [{ capability: 'eastmoney_cpi', family: 'eastmoney', state: 'active', verdict: 'GUARD', ms: 900, budgetMs: 20_000, detail: 'validateOutput false' }],
    ...overrides,
  }
}

test('真故障与噪声分开：不合格表只列 failing，抖动/空/影子各归各节', () => {
  const text = renderReport(report())
  assert.match(text, /## 不合格（1）/)
  assert.match(text, /`eastmoney_cpi`/)
  assert.ok(text.indexOf('eastmoney_sector_rotation') > text.indexOf('不进结论'), 'TRANSPORT 不许出现在不合格表里')
  assert.match(text, /## 本视角不判（影子中，1）/)
  assert.match(text, /`sseinfo_qa`/)
})

test('全绿那天没有"不合格"一节，但影子清单仍然要露脸', () => {
  const green = report({ failing: [], counts: { ...report().counts, failing: 0, pass: 2 } })
  const text = renderReport(green)
  assert.doesNotMatch(text, /## 不合格/)
  assert.match(text, /影子中，1/, '"我们其实没在测这个"必须每天早上可见')
})

test('核心字段证据只列键名，绝不带值', () => {
  const withDiff = report({
    failing: [{
      capability: 'eastmoney_cpi', family: 'eastmoney', state: 'active', verdict: 'GUARD',
      ms: 900, budgetMs: 20_000, keyDiff: { missing: ['national_yoy_pct'], added: ['NATIONAL_YOY_PCT'] },
    }],
  })
  const text = renderReport(withDiff)
  assert.match(text, /## 核心字段证据/)
  assert.match(text, /缺失键：national_yoy_pct/)
  assert.match(text, /多出键：NATIONAL_YOY_PCT/)
})

test('⛔ 渲染器只读白名单字段：报告里混进响应正文也不会被写进 Issue', () => {
  const leaky = report({
    failing: [{
      capability: 'quote', family: 'fuyao', state: 'active', verdict: 'HTTP_STATUS', ms: 10, budgetMs: 1000,
      detail: 'returned HTTP 401',
      // Even if a future caller stuffs a response body or credential into result, the renderer must not copy it.
      body: '{"data":{"item":[{"secret":"LEAKED-BODY-CONTENT"}]}}',
      url: 'https://fuyao.aicubes.cn/api/a-share/prices/snapshot?thscodes=600519.SH&x-api-key=LEAKED-KEY',
    }],
  })
  const text = renderReport(leaky)
  assert.doesNotMatch(text, /LEAKED-BODY-CONTENT/, '响应正文不许进 Issue')
  assert.doesNotMatch(text, /LEAKED-KEY/, '带凭据的 URL 不许进 Issue')
  assert.match(text, /returned HTTP 401/, '错误摘要本身是要的——它是"准确的报错"的一部分')
})

test('详情里的竖线被转义，不把表格劈开', () => {
  const text = renderReport(report({
    failing: [{ capability: 'x', family: 'fuyao', state: 'active', verdict: 'GUARD', ms: 1, budgetMs: 2, detail: 'a | b' }],
  }))
  const line = text.split('\n').find((l) => l.startsWith('|') && l.includes('`x`'))
  assert.ok(line, '没找到那条失败的行')
  assert.match(line, /a \\\| b/)
  assert.equal(line.split(/(?<!\\)\|/u).length - 1, 7, '表格行必须恰好 6 列')
})

/**
 * Close decision: an Issue closes only when every capability it names was actually exercised this
 * run and none is failing. A real misfire: on the daily tier a weekly capability was absent from
 * `report.results`, and "not among failures" closed the Issue, certifying something never rechecked
 * and resetting the streak counter.
 */
const ACTIVE = new Set(['quote', 'fund_manager'])
const passed = [{ capability: 'quote', family: 'fuyao', state: 'active', verdict: 'PASS', ms: 90 }]

test('提到的能力本次真打且通过 → 关，并列出复核了哪几条', () => {
  const d = closeDecision('不合格清单里有 `quote` 一条。', passed, ACTIVE)
  assert.equal(d.action, 'close')
  assert.deepEqual(d.mentioned, ['quote'])
})

test('其中一条本次仍不合格 → 不关，理由点名是哪条', () => {
  const rows = [...passed, { capability: 'fund_manager', family: 'fuyao', state: 'active', verdict: 'ENVELOPE', ms: 300 }]
  const d = closeDecision('`quote` 与 `fund_manager` 不合格', rows, ACTIVE)
  assert.equal(d.action, 'keep')
  assert.match(d.reason, /fund_manager 本次仍不合格/)
})

test('日档那天 weekly 能力没真打 → 不许当成"已通过"关单', () => {
  // The old logic closed here: fund_manager was simply absent from results, read as passing.
  const d = closeDecision('上周六 `fund_manager` 报 5003', passed, ACTIVE)
  assert.equal(d.action, 'keep')
  assert.match(d.reason, /没真打/)
})

test('SKIPPED（id 没解析出来所以没发请求）也不算复核过', () => {
  const rows = [{ capability: 'fund_manager', family: 'fuyao', state: 'active', verdict: 'SKIPPED', ms: 0 }]
  const d = closeDecision('`fund_manager` 报 5003', rows, ACTIVE)
  assert.equal(d.action, 'keep')
})

test('看门狗告警单只提文件名，巡检结果无权关它', () => {
  // Same label, so `opens` picks it up; the old logic silently closed a "scheduler did not run" alarm on any green morning.
  const d = closeDecision('`data-source-contract.yml` 没有 schedule 记录', passed, ACTIVE)
  assert.equal(d.action, 'keep')
  assert.deepEqual(d.mentioned, [])
})

test('正文的 run-date 用北京日期，不是 UTC 日期', () => {
  // The schedule is 04:00 Beijing = 20:00 UTC the previous day; Issue title, same-day dedupe and
  // close comments all read this string, so a UTC date would stamp every Issue with yesterday.
  const body = renderReport(report({ at: '2026-10-09T20:00:00.000Z' }))
  assert.match(body, /run-date 2026-10-10/, `正文首行应当是北京日期：${body.split('\n')[2] ?? ''}`)
  assert.doesNotMatch(body, /run-date 2026-10-09/)
})
