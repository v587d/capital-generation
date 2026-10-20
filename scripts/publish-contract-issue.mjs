#!/usr/bin/env node
/**
 * Publishes probe results as one daily GitHub issue.
 * Only `report.failing` opens an issue; same-day reruns update the body instead of opening another;
 * "streak" and "recovered" are derived from open issues with the same label, no extra storage.
 * ⛔ Goes through scripts/lib/github-api.mjs (never spawn gh); the repo and issues are public, so no
 * secrets, query strings or response bodies in the body.
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { CONTRACT_PROBES, stateOf, beijingDateOf } from './lib/contract-registry.mjs'
import { closeDecision } from './lib/contract-report.mjs'
import { createGitHubApi, requireGitHubEnv } from './lib/github-api.mjs'

const LABEL = 'data-source-contract'

const { values: flags } = parseArgs({
  options: { report: { type: 'string' }, body: { type: 'string' } },
})

const report = JSON.parse(readFileSync(flags.report, 'utf8'))
const runDate = beijingDateOf(report.at)  // 北京的哪一天：04:00 北京 = UTC 前一天 20:00，切 UTC 日会天天盖成昨天
const worst = report.failing.map((row) => row.verdict).sort()[0] ?? '-'
const title = `数据源契约巡检 ${runDate}：${report.failing.length} 项不合格（${worst}）· 海外视角`

const api = createGitHubApi(requireGitHubEnv())

/** Open probe issues: the only history store, deliberately not duplicated elsewhere. */
async function openIssues() {
  const listed = await api.get(`/repos/${api.repo}/issues?state=open&labels=${LABEL}&per_page=100`)
  // /issues also returns PRs; filtering is cheaper than assuming it never happens.
  return (listed ?? []).filter((item) => !item.pull_request).map((item) => ({ number: item.number, body: item.body ?? '' }))
}

const opens = await openIssues()
const todayIssue = opens.find((issue) => issue.body.includes(`run-date ${runDate}`))
/** History = other days' issues. Today's must be excluded or a rerun counts the same day twice. */
const history = opens.filter((issue) => issue !== todayIssue)

/** Prior open issues mentioning a capability = streak days (today's issue excluded). */
const streakOf = (capability) => history.filter((issue) => issue.body.includes(`\`${capability}\``)).length
const withStreak = report.failing.map((row) => ({ ...row, days: streakOf(row.capability) + 1 }))

/** Mentioned before and passing now = recovered. Active entries only: shadows are not verdicts. */
const mentioned = new Set(history.flatMap((issue) => (issue.body.match(/`([a-z0-9_]+)`/gu) ?? []).map((t) => t.slice(1, -1))))
const recovered = [...mentioned].filter((capability) =>
  !withStreak.some((row) => row.capability === capability)
  && report.results.some((row) => row.capability === capability && row.state === 'active' && ['PASS', 'SLOW'].includes(row.verdict)))

const sections = [readFileSync(flags.body, 'utf8')]
if (withStreak.some((row) => row.days > 1)) {
  sections.push(`## 持续天数\n\n${withStreak.filter((row) => row.days > 1)
    .map((row) => `- \`${row.capability}\` 第 ${row.days} 天（从同 label 的未关闭单数出来，不另存状态）`).join('\n')}`)
}
if (recovered.length > 0) {
  sections.push(`## 已恢复（${recovered.length}）\n\n${recovered.map((c) => `- \`${c}\` 本次通过`).join('\n')}`)
}
sections.push(`<sub>由 ${process.env.GITHUB_WORKFLOW ?? '本地'} #${process.env.GITHUB_RUN_NUMBER ?? '-'} 生成。`
  + '本结论仅代表上述网络视角；只有国内出口才看得见的故障这里抓不到。</sub>')
const finalBody = sections.join('\n\n').slice(0, 90_000)

if (report.failing.length === 0) {
  console.log(`本次全部通过，不开单。`)
  // Close old issues whose capabilities were really re-probed this run; otherwise streaks pile up.
  // "Not failing" is not "verified" — see `closeDecision`.
  const activeCapabilities = new Set(CONTRACT_PROBES.filter((entry) => stateOf(entry) === 'active').map((e) => e.capability))
  for (const issue of opens) {
    const decision = closeDecision(issue.body, report.results, activeCapabilities)
    if (decision.action !== 'close') {
      console.log(`保留 #${issue.number}：${decision.reason}`)
      continue
    }
    await api.post(`/repos/${api.repo}/issues/${issue.number}/comments`, {
      body: `本次巡检（${runDate}）逐条复核了 ${decision.mentioned.join(' / ')}，均通过，关闭。`,
    })
    await api.patch(`/repos/${api.repo}/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' })
    console.log(`关闭 #${issue.number}`)
  }
} else if (todayIssue) {
  await api.patch(`/repos/${api.repo}/issues/${todayIssue.number}`, { body: finalBody })
  console.log(`今天已有单 #${todayIssue.number}，更新正文（${report.failing.length} 项不合格）`)
} else {
  const created = await api.post(`/repos/${api.repo}/issues`, { title, labels: [LABEL], body: finalBody })
  console.log(`已开单 #${created.number}（${report.failing.length} 项不合格）`)
}
