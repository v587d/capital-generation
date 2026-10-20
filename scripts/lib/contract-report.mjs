/**
 * The two user-visible outputs: the daily report body (sole source of issue body shape) and the
 * watchdog's heartbeat rule / alarm marker. Lives in lib so offline tests can assert the shapes.
 * ⛔ Render only `report.failing`; TRANSPORT / SLOW / EMPTY go into a separate "not a verdict"
 * section. ⛔ No response bodies, query strings or secrets — key names and codes only.
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
 * Close an old probe issue only if every capability it mentions is active and was really probed
 * this run, all passing. "Not in today's failures" is not enough: weekly entries are absent on
 * daily runs, and SKIPPED means it never ran — closing those would certify unverified coverage
 * and reset the streak counter. The watchdog alarm names a workflow, no capability, so it is kept.
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

/** One marker string shared by open / find / close for watchdog alarms. */
export const WATCHDOG_MARKER = '巡检未运行'

/** True for watchdog alarms only (not daily report issues, not PRs). */
export function isWatchdogAlarm(issue) {
  return !issue.pull_request && String(issue.title ?? '').includes(WATCHDOG_MARKER)
}

/**
 * Heartbeat: any `schedule`-triggered run means the scheduler is alive.
 * 1. Only `event === 'schedule'`: a manual dispatch would mask a dead week.
 * 2. Ignore status/conclusion: a failed run is still a heartbeat (red = harness, issue = upstream,
 *    no run = scheduler dead — three separate channels).
 * 3. Check the previous slot (`previousScheduledDue`), not the latest due one: `schedule` runs 3–4 h
 *    late, so the nominal slot races the watchdog and always false-alarms.
 * `newest` is the max created_at, not the API's first row.
 */
export function heartbeatVerdict(runs, now = new Date()) {
  const due = previousScheduledDue(now)
  const scheduled = (runs ?? []).filter((run) => run.event === 'schedule' && run.created_at)
  const heartbeat = scheduled.filter((run) => new Date(run.created_at) >= due)
  const newest = scheduled.reduce((best, run) => (best && new Date(best.created_at) >= new Date(run.created_at) ? best : run), undefined)
  return { due, heartbeat, newest, ok: heartbeat.length > 0 }
}
