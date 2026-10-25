#!/usr/bin/env node
/**
 * Read-only audit for tool results that failed but were recorded as success (isError false).
 * dsh-tools' createSuccessResult hardcodes isError:false, so only a thrown error marks failure;
 * a returned `{ ok:false }` envelope is indistinguishable from success in the session log.
 * PTC hides nested calls from `tool/call`: they are persisted as `tool/ptc-dispatch`.
 * Heuristic lead generator, not an assertion: exit code stays 0 even when suspects are found.
 */
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { latestSessionFile } from './lib/session-files.mjs'
import { readSessionEvents } from './lib/session-events.mjs'

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const ROOT = argValue('--dir', join(DSH_HOME, 'sessions'))
const ONLY_TOOL = argValue('--tool', undefined)
const AS_JSON = process.argv.includes('--json')

function looksLikeUnmarkedFailure(text) {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  let value
  try {
    value = JSON.parse(trimmed)
  } catch {
    return false
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.ok === false) return true
  const hasError = typeof value.error === 'string' && value.error.length > 0
  return hasError && value.ok !== true
}

const stats = new Map()
const samples = []

function record(tool, kind, sample) {
  const entry = stats.get(tool) ?? { total: 0, isError: 0, unmarked: 0 }
  entry.total += 1
  if (kind !== undefined) entry[kind] += 1
  stats.set(tool, entry)
  if (kind === 'unmarked' && samples.length < 20 && sample !== undefined) samples.push(sample)
}

let scannedSessions = 0
for (const workspace of readdirSync(ROOT)) {
  const workspaceDir = join(ROOT, workspace)
  let entries
  try {
    if (!statSync(workspaceDir).isDirectory()) continue
    entries = readdirSync(workspaceDir)
  } catch {
    continue
  }
  for (const sessionId of entries) {
    // The host moved v3 → v4; a hardcoded name scans 0 sessions and prints a clean report.
    const found = latestSessionFile(join(workspaceDir, sessionId))
    if (found === undefined) continue
    scannedSessions += 1
    let events
    try {
      events = readSessionEvents(found.file)
    } catch {
      continue
    }

    const callNames = new Map()
    for (const event of events) {
      if (event.type === 'tool/call' && event.data?.callId) callNames.set(event.data.callId, event.data.name)
    }
    for (const event of events) {
      // Nested PTC calls never emit tool/call: the dispatch event is the only trace.
      if (event.type === 'tool/ptc-dispatch') {
        const data = event.data ?? {}
        const tool = typeof data.name === 'string' ? data.name : '(unknown)'
        if (ONLY_TOOL !== undefined && tool !== ONLY_TOOL) continue
        if (data.isError === true) {
          record(tool, 'isError')
          continue
        }
        const text = (data.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n')
        if (looksLikeUnmarkedFailure(text)) {
          record(tool, 'unmarked', { workspace, sessionId, tool, text: text.slice(0, 240) })
        } else {
          record(tool, undefined)
        }
        continue
      }
      if (event.type !== 'tool/result') continue
      for (const block of event.data?.message?.content ?? []) {
        if (block.type !== 'tool-result') continue
        const tool = callNames.get(block.toolCallId) ?? '(unknown)'
        if (ONLY_TOOL !== undefined && tool !== ONLY_TOOL) continue
        if (block.isError === true) {
          record(tool, 'isError')
          continue
        }
        const text = (block.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n')
        if (looksLikeUnmarkedFailure(text)) {
          record(tool, 'unmarked', { workspace, sessionId, tool, text: text.slice(0, 240) })
        } else {
          record(tool, undefined)
        }
      }
    }
  }
}

const rows = [...stats.entries()]
  .map(([tool, entry]) => ({ tool, ...entry, unmarkedRate: entry.total === 0 ? 0 : entry.unmarked / entry.total }))
  .sort((a, b) => b.unmarked - a.unmarked || b.total - a.total)

if (AS_JSON) {
  console.log(JSON.stringify({ scannedSessions, rows, samples }, null, 2))
} else {
  console.log(`audit-tool-errors: 扫描 ${scannedSessions} 份会话（${ROOT}）`)
  console.log('')
  console.log('工具'.padEnd(30) + '结果数'.padStart(8) + 'isError'.padStart(9) + '疑似未标记'.padStart(12) + '占比'.padStart(9))
  console.log('-'.repeat(70))
  for (const row of rows) {
    if (row.unmarked === 0 && row.total < 5) continue
    console.log(
      row.tool.padEnd(30)
      + String(row.total).padStart(8)
      + String(row.isError).padStart(9)
      + String(row.unmarked).padStart(12)
      + `${(row.unmarkedRate * 100).toFixed(1)}%`.padStart(9),
    )
  }
  if (samples.length > 0) {
    console.log('')
    console.log('疑似样本（最多 20 条）：')
    for (const sample of samples) console.log(`  [${sample.tool}] ${sample.workspace}/${sample.sessionId.slice(0, 8)}\n    ${sample.text.replace(/\s+/gu, ' ').slice(0, 180)}`)
  }
  console.log('')
  console.log('说明：疑似未标记 = 结果 JSON 里 ok:false 或有 error 且 ok 不为 true，但 isError 是 false。')
  console.log('      来源同时包括 tool/result 与 PTC 嵌套的 tool/ptc-dispatch；这是启发式线索，不是断言。')
}
process.exit(0)
