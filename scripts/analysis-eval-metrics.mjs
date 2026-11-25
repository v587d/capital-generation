#!/usr/bin/env node
/**
 * Phase 6 observation tool (design D8/§18.3): print per-session duration, turns, tool calls, tool
 * errors and token usage for one analysis workspace. Read-only — it never talks to the host or the
 * model. Numbers are trend observations; D8 forbids turning them into pass/fail thresholds.
 *
 * Usage:
 *   node scripts/analysis-eval-metrics.mjs --home .tmp-session/home-<tag> --cwd .tmp-session/<tag>/ws [--json]
 */
import { collectSessionMetrics, totalsOf } from './lib/session-metrics.mjs'

const arg = (name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : undefined
}

const home = arg('--home')
const cwd = arg('--cwd')
const asJson = process.argv.includes('--json')
if (home === undefined || cwd === undefined) {
  console.error('usage: node scripts/analysis-eval-metrics.mjs --home <DSH_HOME> --cwd <workspace> [--json]')
  process.exit(2)
}

const sessions = collectSessionMetrics(home, cwd)
if (sessions.length === 0) {
  console.error(`analysis-eval-metrics: ${home} 下没有 ${cwd} 的会话记录（这是可见的 skip，不是 0 指标通过）`)
  process.exit(1)
}

const totals = totalsOf(sessions)
const shortId = (id) => (typeof id === 'string' ? id.replace(/^session-/u, '').slice(0, 8) : '?')
const minutes = (ms) => (typeof ms === 'number' ? (ms / 60_000).toFixed(1) : '?')
const tokens = (value) => (typeof value === 'number' ? String(value) : '?')

if (asJson) {
  console.log(JSON.stringify({ sessions, totals }, null, 2))
} else {
  console.log(`analysis-eval-metrics: ${sessions.length} sessions in ${home} (cwd ${cwd})`)
  console.log('id       preset                    depth turns tools errors  in_tok out_tok cache_tok model                         min  chars')
  for (const session of sessions) {
    const usage = session.usage ?? {}
    console.log([
      shortId(session.id).padEnd(8),
      (session.preset ?? '?').padEnd(25),
      String(session.depth ?? 0).padStart(5),
      String(session.turns).padStart(5),
      String(session.toolCalls).padStart(5),
      String(session.toolErrors).padStart(6),
      String(tokens(usage.inputTokens)).padStart(7),
      String(tokens(usage.outputTokens)).padStart(7),
      String(tokens(usage.cacheReadTokens)).padStart(9),
      (session.models.join(',') || '(not recorded)').padEnd(29),
      minutes(session.durationMs).padStart(5),
      String(session.finalAnswerChars).padStart(6),
    ].join(' '))
  }
  console.log(
    `totals: sessions=${totals.sessions} turns=${totals.turns} tools=${totals.toolCalls} errors=${totals.toolErrors} `
    + `in_tok=${totals.usage.inputTokens} out_tok=${totals.usage.outputTokens} cache_tok=${totals.usage.cacheReadTokens}`,
  )
}
