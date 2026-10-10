/**
 * Issue 正文形状的回归。
 *
 * 为什么值得钉：这份 Markdown 是整套巡检**唯一被人读的东西**。它坏法很安静——
 * 表格错位、真故障被并进噪声、或者把响应正文/查询串带进一张 public 仓库的公开 Issue。
 * 最后那一条是安全问题，不是格式问题。
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

/**
 * 关单判据。**只有"本单提到的能力，本次都真打过且都没判不合格"才关**。
 * 这一组用例存在的理由是一个真实的误关形状：日档那天 weekly 能力根本不在 `report.results` 里，
 * 按"没出现在失败中"就关单，等于给没复核过的东西发通过证明，还顺手清零「连续第 N 天」。
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
  // 旧逻辑在这里会把单关掉：results 里根本没有 fund_manager，"没出现在失败里"被当成了通过。
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
  // 它带同一个 label，会被 `opens` 捞进来；旧逻辑在任何全绿早晨都会把"调度没跑"的警报偷偷收掉。
  const d = closeDecision('`data-source-contract.yml` 没有 schedule 记录', passed, ACTIVE)
  assert.equal(d.action, 'keep')
  assert.deepEqual(d.mentioned, [])
})

test('正文的 run-date 用北京日期，不是 UTC 日期', () => {
  // 排程是北京 06:00 = UTC 前一天 22:00。Issue 标题、同天去重、关单留言都读这个字符串，
  // 切 UTC 日会让每天那张单都盖着昨天的日期（2026-10-09 那次定时跑就是这个形状）。
  const body = renderReport(report({ at: '2026-10-09T22:00:00.000Z' }))
  assert.match(body, /run-date 2026-10-10/, `正文首行应当是北京日期：${body.split('\n')[2] ?? ''}`)
  assert.doesNotMatch(body, /run-date 2026-10-09/)
})
