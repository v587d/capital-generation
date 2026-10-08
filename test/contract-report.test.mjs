/**
 * Issue 正文形状的回归。
 *
 * 为什么值得钉：这份 Markdown 是整套巡检**唯一被人读的东西**。它坏法很安静——
 * 表格错位、真故障被并进噪声、或者把响应正文/查询串带进一张 public 仓库的公开 Issue。
 * 最后那一条是安全问题，不是格式问题。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderReport } from '../scripts/lib/contract-report.mjs'

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
      // 万一将来有人把响应体或凭据塞进 result，渲染器也不许把它抄进公开 Issue。
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
