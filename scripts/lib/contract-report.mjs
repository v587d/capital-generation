/**
 * 巡检报告的 Markdown 渲染——Issue 正文的唯一形状来源。
 *
 * 单独成模块的理由：这是**用户每天读的那份东西**，格式坏了等于整套巡检失效，
 * 但它原先长在 CLI 里没法被测。拆出来就能拿一份假报告直接断言形状。
 *
 * ⛔ 只渲染 `report.failing`（结构/状态级）。`TRANSPORT` / `SLOW` / `EMPTY` 一律进
 * 「不进结论」一节——把它们和真故障混在一张表里，是这套东西被忽略的第一原因。
 * ⛔ 不输出响应正文、不输出 query string、不输出密钥；只有键名与 code。
 */

const cell = (text) => String(text ?? '-').replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ')
const row = (...cells) => `| ${cells.map(cell).join(' | ')} |`

export function renderReport(report) {
  const egress = report.egress ?? {}
  const out = [
    '## 巡检结论', '',
    `run-date ${report.at.slice(0, 10)} · tier ${report.tier} · 视角 ${egress.ip ?? 'unknown'}`
    + (egress.country ? `（${egress.city ?? ''} ${egress.country}${egress.org ? ` · ${egress.org}` : ''}）` : ''),
    '**本结论仅代表上述网络视角**：只有其它出口才看得见的故障，这里抓不到。', '',
    `共 ${report.counts.total} 条：合格 ${report.counts.pass} · 慢 ${report.counts.slow} · 空 ${report.counts.empty}`
    + ` · 网络抖动 ${report.counts.transport} · 跳过 ${report.counts.skipped} · 影子 ${report.counts.shadow}`,
  ]

  if (report.failing.length > 0) {
    out.push('', `## 不合格（${report.failing.length}）`, '',
      row('判据', '能力', '家族', 'HTTP / 上游 code', '耗时 vs 预算', '详情'),
      row('---', '---', '---', '---', '---', '---'))
    for (const item of report.failing) {
      const codes = [item.httpStatus && `HTTP ${item.httpStatus}`, item.upstreamCode && `code=${item.upstreamCode}`]
        .filter(Boolean).join(' / ') || '-'
      out.push(row(item.verdict, `\`${item.capability}\``, item.family, codes, `${item.ms}ms / ${item.budgetMs}ms`, item.detail))
    }
    const evidenced = report.failing.filter((item) => item.keyDiff)
    if (evidenced.length > 0) {
      out.push('', '## 核心字段证据', '',
        '期望键取自 `output_schema`，实得键取自今天真报文的首行——**只有键名，没有值**。', '')
      for (const item of evidenced) {
        out.push(`\`${item.capability}\``,
          `- 缺失键：${item.keyDiff.missing.join(', ') || '（无）'}`,
          `- 多出键：${item.keyDiff.added.join(', ') || '（无）'}`)
      }
    }
  }

  const shadow = report.results.filter((item) => item.state === 'shadow')
  if (shadow.length > 0) {
    out.push('', `## 本视角不判（影子中，${shadow.length}）`, '',
      '这些能力**当前无人监控**：本视角测不了，等用户报障。复核日期见 `scripts/lib/contract-registry.mjs`。', '')
    for (const item of shadow) out.push(`- \`${item.capability}\` 今天实测 ${item.verdict}`)
  }
  const noisy = report.results.filter((item) => ['TRANSPORT', 'SLOW', 'EMPTY', 'SKIPPED'].includes(item.verdict))
  if (noisy.length > 0) {
    out.push('', `## 抖动 / 空 / 跳过（不进结论，${noisy.length}）`, '')
    for (const item of noisy) out.push(`- ${item.verdict} \`${item.capability}\` ${item.ms}ms${item.detail ? ` — ${item.detail}` : ''}`)
  }
  return out.join('\n')
}
