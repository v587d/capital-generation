#!/usr/bin/env node
/**
 * 巡检看门狗：**独立 workflow** 调它，检查 `data-source-contract.yml` 今天到底跑没跑。
 *
 * 为什么必须独立：调度被 GitHub 静默停用（仓库 60 天无活动）时，写在同一个文件里的自查步骤
 * 也跟着不跑——两个独立调度器，其中一个才发现另一个死了。这也是 §9.7 那一族的运维版：
 * 「探针没跑」和「探针全绿」在 Actions 列表里长得一模一样。
 *
 * 判据是**运行记录**，不是"有没有发 Issue"：巡检全绿本来就不发单，拿 Issue 当心跳会把正常判成故障。
 * 但只认 `event === 'schedule'` 的记录，且比 `lastScheduledDue()` 往后数——2026-10-09 第一次实测到
 * schedule 整档没跑，而当时"26 小时内跑过没有"会因为一次手动 dispatch 判成正常：**手动跑一次
 * 恰恰不是调度器还活着的证据**，把这个信道让给 dispatch 等于让看门狗只会替人遮丑。
 */
import { parseArgs } from 'node:util'
import { appendFile } from 'node:fs/promises'
import { createGitHubApi, requireGitHubEnv } from './lib/github-api.mjs'
import { lastScheduledDue } from './lib/contract-registry.mjs'

const { values: flags } = parseArgs({ options: { workflow: { type: 'string' } } })

const WORKFLOW = flags.workflow ?? 'data-source-contract.yml'
const LABEL = 'data-source-contract'
const MARKER = '巡检未运行'

const api = createGitHubApi(requireGitHubEnv())

const runs = await api.get(`/repos/${api.repo}/actions/workflows/${WORKFLOW}/runs?per_page=20`)
const list = runs.workflow_runs ?? []
const due = lastScheduledDue()
const heartbeat = list.filter((run) => run.event === 'schedule' && new Date(run.created_at) >= due)
const newest = list[0]
const newestAge = newest ? ((Date.now() - new Date(newest.created_at).getTime()) / 3_600_000).toFixed(1) : null
const beijing = (date) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
}).format(date)

// 无论有没有故障都留一行——看门狗自己静默停摆时，这是唯一能事后对账的痕迹。
const line = `看门狗自检（${new Date().toISOString()}）：应跑时刻 ${due.toISOString()}（北京 ${beijing(due)}）之后 `
  + `schedule 记录 ${heartbeat.length} 条；最近一次任意记录 ${newest ? `${newest.event} / ${newestAge} 小时前` : '无'}。\n`
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, line)
else console.log(`[summary] ${line.trim()}`)

if (heartbeat.length > 0) {
  console.log(`${WORKFLOW} 的调度在本档排程时刻之后跑过 ${heartbeat.length} 次，正常。`)
} else {
  const open = await api.get(`/repos/${api.repo}/issues?state=open&labels=${LABEL}&per_page=50`)
  const body = `## ${MARKER}\n\n\`${WORKFLOW}\` 自 ${due.toISOString()}（北京 ${beijing(due)}）那次排程以来，`
    + '**没有任何 `schedule` 触发的运行记录**。\n\n'
    + `最近一次运行：${newest ? `${newest.event}（${newestAge} 小时前）` : '从未'}——`
    + '手动 dispatch 不代替调度证据。\n\n'
    + '可能的原因（按 GitHub 官方口径，`schedule` 是 best-effort）：\n'
    + '1. 整点高负载时调度被延迟甚至跳过（每个整点是高峰）；\n'
    + '2. workflow 刚进默认分支，调度器还没把它收进去——新加的第一档最常见；\n'
    + '3. 调度被静默停用（仓库 60 天无 commit / push 时会发生）。\n\n'
    + `处理：打开 [Actions 页面](/${api.repo}/actions/workflows/${WORKFLOW}) 核对，`
    + '必要时手动 Run workflow 补上今天这一次；若连续几天都只有 dispatch 没有 schedule，`schedule` 那条 cron 就要重新验一遍。\n'
  const existing = (open ?? []).find((issue) => !issue.pull_request && String(issue.title).includes(MARKER))
  if (existing) {
    await api.patch(`/repos/${api.repo}/issues/${existing.number}`, { body })
    console.log(`已有未运行告警 #${existing.number}，更新之`)
  } else {
    const created = await api.post(`/repos/${api.repo}/issues`, {
      title: `${MARKER}：${WORKFLOW} 在本档排程时刻后没有 schedule 记录`, labels: [LABEL], body,
    })
    console.log(`已开告警单 #${created.number}`)
  }
}
