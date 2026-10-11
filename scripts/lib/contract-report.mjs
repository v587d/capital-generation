/**
 * 巡检的两份用户可见产物：每日报告正文（Issue 正文的唯一形状来源）+ 看门狗的心跳判据与告警单标识。
 *
 * 单独成模块的理由：这些是**用户每天读的那份东西**，格式坏了等于整套巡检失效，
 * 但它原先长在 CLI 里没法被测。拆出来就能拿一份假报告直接断言形状。
 * 看门狗的判据同理住这里：脚本只在 CI 跑，lib 才能被离线测试钉住——而"该不该报警/该关哪张单"
 * 恰恰是最不能等到 CI 才发现写错的那一类。
 *
 * ⛔ 只渲染 `report.failing`（结构/状态级）。`TRANSPORT` / `SLOW` / `EMPTY` 一律进
 * 「不进结论」一节——把它们和真故障混在一张表里，是这套东西被忽略的第一原因。
 * ⛔ 不输出响应正文、不输出 query string、不输出密钥；只有键名与 code。
 */

import { ISSUE_VERDICTS, beijingDateOf, previousScheduledDue } from './contract-registry.mjs'

const cell = (text) => String(text ?? '-').replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ')
const row = (...cells) => `| ${cells.map(cell).join(' | ')} |`

export function renderReport(report) {
  const egress = report.egress ?? {}
  const out = [
    '## 巡检结论', '',
    `run-date ${beijingDateOf(report.at)} · tier ${report.tier} · 视角 ${egress.ip ?? 'unknown'}`
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

/**
 * 要不要关一张旧的巡检单：**只有这一单提到的、当前真在巡检的能力，本次全部真打过且都没判不合格，才关**。
 *
 * 不能只看"本次没有不合格"：`report.results` 只装**本档位真打过**的那些条目。日档那天，周六才打的
 * weekly 能力根本不在里面——按"没出现在失败里"就关单，等于给没复核过的东西发通过证明，还顺手把
 * 「连续第 N 天」的历史清零。看门狗那张告警单同理：它提的是 workflow 文件名、一个能力都不提，
 * 照旧逻辑会在任何一个全绿早晨被偷偷收掉——那正是把"调度没跑"的警报关掉。
 * `SKIPPED`（id 没解析出来所以没真打）也不算复核过。
 *
 * 关单的判据住在 lib 而不是脚本里：脚本只在 CI 跑，lib 才能被离线测试钉住。
 */
export function closeDecision(issueBody, results, activeCapabilities) {
  const mentioned = [...new Set((issueBody.match(/`([a-z0-9_]+)`/gu) ?? []).map((token) => token.slice(1, -1)))]
    .filter((capability) => activeCapabilities.has(capability))
  if (mentioned.length === 0) {
    return { action: 'keep', mentioned, reason: '本单没提到任何在巡检的能力（看门狗告警就是这种），巡检结果无权关它' }
  }
  const byCap = new Map(results.map((row) => [row.capability, row]))
  const verdictOf = (capability) => (byCap.get(capability)?.state === 'active' ? byCap.get(capability).verdict : undefined)
  const failing = mentioned.filter((capability) => ISSUE_VERDICTS.includes(verdictOf(capability)))
  const unverified = mentioned.filter((capability) => !failing.includes(capability)
    && (!byCap.has(capability) || verdictOf(capability) === 'SKIPPED'))
  if (failing.length > 0) return { action: 'keep', mentioned, reason: `${failing.join(' / ')} 本次仍不合格` }
  if (unverified.length > 0) {
    return { action: 'keep', mentioned, reason: `${unverified.join(' / ')} 本次没真打（不在本档位，或 id 没解析出来），没复核就不关` }
  }
  return { action: 'close', mentioned, reason: `${mentioned.join(' / ')} 本次全部通过` }
}

/** 看门狗告警单的标识：开单、找旧单、关单三处共用同一个字符串，不许各自再写一遍。 */
export const WATCHDOG_MARKER = '巡检未运行'

/** 这张是不是看门狗自己开的单（不是巡检日报单、不是 PR）。 */
export function isWatchdogAlarm(issue) {
  return !issue.pull_request && String(issue.title ?? '').includes(WATCHDOG_MARKER)
}

/**
 * 心跳判据：**`schedule` 触发过 == 调度器还活着**。三条都是被实测逼出来的：
 *
 * 1. 只认 `event === 'schedule'`。一次手动 dispatch 就能把整周的调度停摆遮过去，而手动跑
 *    恰恰不是调度器活着的证据（2026-10-09 第一次遇到整档没按时出现）。
 * 2. **不看 `status` / `conclusion`**：跑挂了也算心跳。红 = 我方 harness 坏，Issue = 上游坏，
 *    未运行 = 调度死——三个信道各说各的事；把 failed 从心跳里剔掉，等于让一个天天红的巡检
 *    在看门狗这里判成"没跑"，两个信道当场混掉。
 * 3. 判**上一档**（`previousScheduledDue`）而不是"最近本该跑那一档"：实测 `schedule` 迟到 3~4 小时，
 *    探针的实际落地时刻晚于看门狗的名义时刻——按名义顺序看门狗每一天都会误报，它过去没误报
 *    纯粹因为自己也迟到得更多。把正确性押在"两条互不保证先后的 best-effort 调度器恰好按想要的
 *    顺序迟到"上，就是这套东西第一次真跑起来时踩到的那个坑。
 *
 * `newest` 取 schedule 里最晚的一条，不信 API 的顺序。
 */
export function heartbeatVerdict(runs, now = new Date()) {
  const due = previousScheduledDue(now)
  const scheduled = (runs ?? []).filter((run) => run.event === 'schedule' && run.created_at)
  const heartbeat = scheduled.filter((run) => new Date(run.created_at) >= due)
  const newest = scheduled.reduce((best, run) => (best && new Date(best.created_at) >= new Date(run.created_at) ? best : run), undefined)
  return { due, heartbeat, newest, ok: heartbeat.length > 0 }
}
