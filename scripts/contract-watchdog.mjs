#!/usr/bin/env node
/**
 * Watchdog run from a separate workflow: it verifies `data-source-contract.yml` is still scheduled.
 * A silently disabled schedule also skips in-file self-checks, so only an independent scheduler
 * can notice; the criterion is run records, not issues (green runs open none).
 * ⛔ Close still-open alarms of our own when healthy: publish refuses to close them, and a
 * permanent first alarm dilutes every later real one.
 */
import { parseArgs } from 'node:util'
import { appendFile } from 'node:fs/promises'
import { createGitHubApi, requireGitHubEnv } from './lib/github-api.mjs'
import { WATCHDOG_MARKER, heartbeatVerdict, isWatchdogAlarm } from './lib/contract-report.mjs'

const { values: flags } = parseArgs({ options: { workflow: { type: 'string' } } })

const WORKFLOW = flags.workflow ?? 'data-source-contract.yml'
const LABEL = 'data-source-contract'

const api = createGitHubApi(requireGitHubEnv())
const beijing = (date) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
}).format(date)

const runs = await api.get(`/repos/${api.repo}/actions/workflows/${WORKFLOW}/runs?per_page=20`)
const verdict = heartbeatVerdict(runs.workflow_runs)
const newestAge = verdict.newest
  ? ((Date.now() - new Date(verdict.newest.created_at).getTime()) / 3_600_000).toFixed(1) : null

// Always append one line: if the watchdog itself stops, this is the only trail left.
const line = `看门狗自检（${new Date().toISOString()}）：上一档排程 ${verdict.due.toISOString()}`
  + `（北京 ${beijing(verdict.due)}）之后 \`schedule\` 记录 ${verdict.heartbeat.length} 条；`
  + `最近一次 schedule 记录 ${verdict.newest ? `${verdict.newest.created_at}（${newestAge} 小时前）` : '无'}。\n`
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, line)
else console.log(`[summary] ${line.trim()}`)

const opens = await api.get(`/repos/${api.repo}/issues?state=open&labels=${LABEL}&per_page=50`)
const alarms = (opens ?? []).filter(isWatchdogAlarm)

if (verdict.ok) {
  const last = verdict.heartbeat.map((run) => run.created_at).sort().at(-1)
  console.log(`${WORKFLOW} 在上一档（北京 ${beijing(verdict.due)}）之后有 ${verdict.heartbeat.length} 条 schedule 记录，调度器活着。`)
  // Only our own alarms: daily report issues are closed by the publish script per capability.
  for (const issue of alarms) {
    await api.post(`/repos/${api.repo}/issues/${issue.number}/comments`, {
      body: `调度器已确认在跑：\`${WORKFLOW}\` 最近一次 \`schedule\` 记录是 ${last}。本单关闭。`,
    })
    await api.patch(`/repos/${api.repo}/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' })
    console.log(`关闭 #${issue.number}（历史告警，调度已恢复）`)
  }
} else {
  const body = `## ${WATCHDOG_MARKER}\n\n\`${WORKFLOW}\` 自上一档排程 ${verdict.due.toISOString()}`
    + `（北京 ${beijing(verdict.due)}）以来，**没有任何 \`schedule\` 触发的运行记录**。\n\n`
    + `最近一次 \`schedule\` 记录：${verdict.newest ? `${verdict.newest.created_at}（${newestAge} 小时前）` : '从未'}。`
    + '手动 dispatch 不代替调度证据，运行失败也不影响本判据（红是另一个信道）。\n\n'
    + '判据只看**上一档**：本档在那一刻的余量只有 5.5 小时，而 `schedule` 实测迟到 3~6 小时且没有上界，'
    + '比"谁迟到得更少"就是误报的源头。\n\n'
    + '可能的原因（按 GitHub 官方口径，`schedule` 是 best-effort）：\n'
    + '1. 调度被静默停用（仓库 60 天无 commit / push 时会发生）；\n'
    + '2. workflow 刚进默认分支，调度器还没把它收进去；\n'
    + '3. 整点高负载时调度被延迟甚至跳过。\n\n'
    + `处理：打开 [Actions 页面](/${api.repo}/actions/workflows/${WORKFLOW}) 核对，`
    + '必要时手动 Run workflow 补上今天这一次；若连续几天都只有 dispatch 没有 schedule，'
    + '`schedule` 那条 cron 就要重新验一遍。\n'
  const existing = alarms[0]
  if (existing) {
    await api.patch(`/repos/${api.repo}/issues/${existing.number}`, { body })
    console.log(`已有未运行告警 #${existing.number}，更新之`)
  } else {
    const created = await api.post(`/repos/${api.repo}/issues`, {
      title: `${WATCHDOG_MARKER}：${WORKFLOW} 在上一档排程后没有 schedule 记录`, labels: [LABEL], body,
    })
    console.log(`已开告警单 #${created.number}`)
  }
}
