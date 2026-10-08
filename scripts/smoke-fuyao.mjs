#!/usr/bin/env node
/**
 * 真实 REST 冒烟：Fuyao 全端点各打一次最小请求。
 *
 * 参数表与判据都住在 `scripts/lib/contract-registry.mjs` + `contract-probe.mjs`——这里只是一层
 * 人名友好的包装。以前本文件自带一份 61 行 PARAMS，注册表又有一份，那就是"两份互不知情的实现"
 * 的老形状（`src/net/eastmoney-client.ts:6-8`）；改参数只能改一处。
 *
 *   node scripts/smoke-fuyao.mjs              # 全量（daily + weekly）
 *   node scripts/smoke-fuyao.mjs --only fund  # 只跑 capability 含该子串的
 *   node scripts/smoke-fuyao.mjs --json       # 输出 JSON
 *
 * 凭据来源：环境变量 `FUYAO_API_KEY`，或 `~/.dsh/.credentials.yaml` 的 refs。
 * ⛔ 不打印密钥、不落盘任何响应数据。会真实消耗上游配额；顺序执行并留间隔（注册表里 400 ms）。
 */
import { runContractProbes } from './lib/contract-probe.mjs'

const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined
const asJson = args.includes('--json')

// full = daily + weekly 两档，等价于旧版"遍历全部已注册 capability"。
const report = await runContractProbes({ tier: 'full', family: 'fuyao', only, log: asJson ? () => {} : (text) => console.error(text) })

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const rows = report.results
  console.log(`\n合计 ${rows.length} 个 Fuyao 端点：成功 ${report.counts.pass + report.counts.slow + report.counts.empty}，`
    + `上游/契约失败 ${report.counts.failing}，网络抖动 ${report.counts.transport}，跳过 ${report.counts.skipped}`)
  for (const row of rows.filter((r) => !['PASS', 'SLOW'].includes(r.verdict))) {
    console.log(`  ${row.verdict.padEnd(12)} ${row.capability}${row.upstreamCode ? ` code=${row.upstreamCode}` : ''} ${row.detail ?? ''}`)
  }
}
// 手动冒烟要的是"有任何一条不对我就知道"，比 CI 的判据严：网络抖动也算红。
process.exitCode = report.counts.failing > 0 || report.counts.transport > 0 ? 1 : 0
