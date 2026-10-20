#!/usr/bin/env node
/**
 * Contract-probe runner. Only production execute()/validateOutput() (no second URL or field list),
 * only the shared throttles (two chains on one egress IP is no throttle), and no retries (a retry
 * turns one blip into two authoritative points). ⛔ Output carries no secrets, query strings or
 * response bodies: issues are public.
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

/** Default auto: full on Beijing Saturday, daily otherwise; conversion lives only in resolveTier. */
const tier = flags.tier && flags.tier !== 'auto' ? flags.tier : resolveTier()

/** Hosted egress IPs rotate; this is the only trace for after-the-fact reconciliation. */
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
  // Only our own faults reach here (missing credentials, registry/runner mismatch, crash).
  // ⛔ Upstream faults must never become red: red = ours, Issue = upstream, never mixed.
  console.error(`::error::契约巡检未能完成：${String(error?.message ?? error).slice(0, 500)}`)
  process.exitCode = 1
  throw error
}

const markdown = renderReport(report)
if (flags.json) writeFileSync(flags.json, JSON.stringify(report, null, 2))
if (flags.markdown) writeFileSync(flags.markdown, markdown)
if (!flags.json && !flags.markdown) console.log(markdown)
console.error(`\n巡检完成：${report.counts.total} 条，不合格 ${report.counts.failing} 条（不合格走 Issue，不影响退出码）`)
