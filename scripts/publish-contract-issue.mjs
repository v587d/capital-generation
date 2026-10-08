#!/usr/bin/env node
/**
 * 把巡检结果发成 GitHub Issue（每天一张汇总单）。
 *
 * 三条规矩：
 * 1. **只有结构/状态级失败才开单**——`classify()` 已经筛过一轮，这里只认 `report.failing`。
 * 2. **同一天不重复开**：`schedule` + 手动 dispatch + 失败重跑都会撞同一天，命中就改正文而不是新建。
 * 3. **不引入任何新存储**：「连续第 N 天」与「已恢复」都从同 label 的未关闭 Issue 里数出来。
 *
 * ⛔ 走 `scripts/lib/github-api.mjs`（与看门狗同一份实现），不 spawn `gh`；正文里也不许出现
 * 密钥、query string 或响应正文——仓库是 public，Issue 也是。
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { ISSUE_VERDICTS } from './lib/contract-registry.mjs'
import { createGitHubApi, requireGitHubEnv } from './lib/github-api.mjs'

const LABEL = 'data-source-contract'

const { values: flags } = parseArgs({
  options: { report: { type: 'string' }, body: { type: 'string' } },
})

const report = JSON.parse(readFileSync(flags.report, 'utf8'))
const runDate = report.at.slice(0, 10)
const worst = report.failing.map((row) => row.verdict).sort()[0] ?? '-'
const title = `数据源契约巡检 ${runDate}：${report.failing.length} 项不合格（${worst}）· 海外视角`

const api = createGitHubApi(requireGitHubEnv())

/** 未关闭的巡检单。这是唯一的"历史存储"，故意不另建一份。 */
async function openIssues() {
  const listed = await api.get(`/repos/${api.repo}/issues?state=open&labels=${LABEL}&per_page=100`)
  // /issues 也会返回 PR；本仓库不用 PR 巡检，但过滤一下比假设它不会发生便宜。
  return (listed ?? []).filter((item) => !item.pull_request).map((item) => ({ number: item.number, body: item.body ?? '' }))
}

const opens = await openIssues()
const todayIssue = opens.find((issue) => issue.body.includes(`run-date ${runDate}`))

/** 某个能力已经被几张未关闭的巡检单提到 = 连续第几天。 */
const streakOf = (capability) => opens.filter((issue) => issue.body.includes(`\`${capability}\``)).length
const withStreak = report.failing.map((row) => ({ ...row, days: streakOf(row.capability) + 1 }))

/** 过去有单、今天通过 = 已恢复。只认 active 条目：影子项本来就不算结论。 */
const mentioned = new Set(opens.flatMap((issue) => (issue.body.match(/`([a-z0-9_]+)`/gu) ?? []).map((t) => t.slice(1, -1))))
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
  // 全绿那天把仍未恢复的旧单关掉——否则「持续第 N 天」会一直累加，历史也就不可信了。
  for (const issue of opens) {
    const stillFailing = report.results.some((row) => row.state === 'active' && ISSUE_VERDICTS.includes(row.verdict)
      && issue.body.includes(`\`${row.capability}\``))
    if (stillFailing) continue
    await api.post(`/repos/${api.repo}/issues/${issue.number}/comments`, { body: `本次巡检（${runDate}）该单涉及的能力已通过，关闭。` })
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
