#!/usr/bin/env node
/**
 * Real REST smoke over every Fuyao endpoint. Params and verdicts live in
 * scripts/lib/contract-registry.mjs + contract-probe.mjs; this is only a human-friendly wrapper.
 * ⛔ No keys printed, no response data written. Consumes upstream quota: serial with a 400 ms gap.
 */
import { runContractProbes } from './lib/contract-probe.mjs'

const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined
const asJson = args.includes('--json')

// full = daily + weekly, same as iterating every registered capability.
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
// Manual smoke is stricter than CI: any transport blip is also red.
process.exitCode = report.counts.failing > 0 || report.counts.transport > 0 ? 1 : 0
