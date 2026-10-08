#!/usr/bin/env node
/**
 * 巡检看门狗：**独立 workflow** 调它，检查 `data-source-contract.yml` 今天到底跑没跑。
 *
 * 为什么必须独立：调度被 GitHub 静默停用（仓库 60 天无活动）时，写在同一个文件里的自查步骤
 * 也跟着不跑——两个独立调度器，其中一个才发现另一个死了。这也是 §9.7 那一族的运维版：
 * 「探针没跑」和「探针全绿」在 Actions 列表里长得一模一样。
 *
 * 判据是**运行记录**，不是"有没有发 Issue"：巡检全绿本来就不发单，拿 Issue 当心跳会把正常判成故障。
 */
import { parseArgs } from 'node:util'
import { appendFile } from 'node:fs/promises'
import { createGitHubApi, requireGitHubEnv } from './lib/github-api.mjs'

const { values: flags } = parseArgs({ options: { workflow: { type: 'string' }, slackHours: { type: 'string' } } })

const WORKFLOW = flags.workflow ?? 'data-source-contract.yml'
const SLACK_HOURS = Number(flags.slackHours ?? 26)
const LABEL = 'data-source-contract'
const MARKER = '巡检未运行'

const api = createGitHubApi(requireGitHubEnv())

const runs = await api.get(`/repos/${api.repo}/actions/workflows/${WORKFLOW}/runs?per_page=20`)
const list = runs.workflow_runs ?? []
const newest = list[0]
const fresh = list.filter((run) => run.status === 'completed'
  && Date.now() - new Date(run.created_at).getTime() < SLACK_HOURS * 3_600_000)
const ageHours = newest ? ((Date.now() - new Date(newest.created_at).getTime()) / 3_600_000).toFixed(1) : 'never'

// 无论有没有故障都留一行——看门狗自己静默停摆时，这是唯一能事后对账的痕迹。
const line = `看门狗自检（${new Date().toISOString()}）：\`${WORKFLOW}\` 最近一次记录于 ${ageHours} 小时前，`
  + `${SLACK_HOURS} 小时窗口内 completed 记录 ${fresh.length} 条。\n`
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, line)
else console.log(`[summary] ${line.trim()}`)

if (fresh.length > 0) {
  console.log(`${WORKFLOW} 在 ${SLACK_HOURS} 小时内跑过 ${fresh.length} 次，正常。`)
} else {
  const open = await api.get(`/repos/${api.repo}/issues?state=open&labels=${LABEL}&per_page=50`)
  const body = `## ${MARKER}\n\n\`${WORKFLOW}\` 在最近 ${SLACK_HOURS} 小时内没有任何 completed 运行记录。\n\n`
    + '两种可能：调度被 GitHub 静默停用（仓库 60 天无 commit/push 时会发生），或 workflow 文件本身出了问题。\n\n'
    + `去 [Actions 页面](/${api.repo}/actions/workflows/${WORKFLOW}) 看一眼，必要时手动 Run workflow 一次。\n`
  const existing = (open ?? []).find((issue) => !issue.pull_request && String(issue.title).includes(MARKER))
  if (existing) {
    await api.patch(`/repos/${api.repo}/issues/${existing.number}`, { body })
    console.log(`已有未运行告警 #${existing.number}，更新之`)
  } else {
    const created = await api.post(`/repos/${api.repo}/issues`, { title: `${MARKER}：${WORKFLOW} 超过 ${SLACK_HOURS} 小时未运行`, labels: [LABEL], body })
    console.log(`已开告警单 #${created.number}`)
  }
}
