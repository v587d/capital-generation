#!/usr/bin/env node
/**
 * 数据源契约巡检 CLI。默认打 daily 档，`--tier full` 打全量。
 *
 *   npm run contract:probe                    # daily 档，人读输出
 *   npm run contract:probe -- --tier full     # 周六全量
 *   npm run contract:probe -- --only fund     # 只跑 capability 含该子串的
 *   npm run contract:probe -- --json out.json --markdown issue.md
 *
 * 退出码是**有分工**的（设计 §6.4）：
 *   0  巡检跑完了（哪怕有不合格项——上游的事走 Issue，不走红）
 *   1  我方工具有问题：缺凭据、注册表与 runner 对不上、未捕获异常
 * 这条分工让「红 = 我们的错」「Issue = 上游的错」两个信道永远不混。
 *
 * ⛔ 不打印密钥、不落盘响应正文；报告里只有 host / path / 上游 code / 键名 / 行数 / 耗时。
 */
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { runContractProbes } from './lib/contract-probe.mjs'
import { renderReport } from './lib/contract-report.mjs'
import { resolveTier } from './lib/contract-registry.mjs'

const { values: flags } = parseArgs({
  options: {
    tier: { type: 'string' }, only: { type: 'string' }, family: { type: 'string' },
    json: { type: 'string' }, markdown: { type: 'string' },
  },
})

/** 默认 `auto`：北京周六打全量，其余打日档。换算只此一处，见 resolveTier 的注释。 */
const tier = flags.tier && flags.tier !== 'auto' ? flags.tier : resolveTier()

/** 出口身份：hosted 的出口 IP 是会换的，事后对账只有这一条线索。 */
async function egressInfo() {
  try {
    const response = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(10_000) })
    const body = await response.json()
    return { ip: body.ip, country: body.country, city: body.city, org: body.org }
  } catch {
    return { ip: 'unknown' }
  }
}

let report
try {
  const egress = await egressInfo()
  report = await runContractProbes({ tier, only: flags.only, family: flags.family })
  report.egress = egress
} catch (error) {
  // 走到这里只可能是我方问题（缺凭据 / 注册表与 runner 对不上 / 未捕获异常）。
  // ⛔ 绝不把上游故障写成红：红 = 我们的错，Issue = 上游的错，两个信道不许混。
  console.error(`::error::契约巡检未能完成：${String(error?.message ?? error).slice(0, 500)}`)
  process.exitCode = 1
  throw error
}

const markdown = renderReport(report)
if (flags.json) writeFileSync(flags.json, JSON.stringify(report, null, 2))
if (flags.markdown) writeFileSync(flags.markdown, markdown)
if (!flags.json && !flags.markdown) console.log(markdown)
console.error(`\n巡检完成：${report.counts.total} 条，不合格 ${report.counts.failing} 条（不合格走 Issue，不影响退出码）`)
