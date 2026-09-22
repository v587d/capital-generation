#!/usr/bin/env node
/**
 * 工具失败信号审计（只读）：找出"失败了却记成成功"的 tool/result。
 *
 * 为什么需要它：DSH 用工具结果的 `isError` 表达失败，而 `dsh-tools` 的
 * `createSuccessResult` **硬编码 `isError: false`**——工具的**返回值没有办法标记失败**，
 * 唯一通道是从 `execute` 抛出（`dispatchToolBody` 的 catch → `toolErrorResult`）。
 * 所以一个工具只要"把失败做成 `{ ok: false, error }` 信封正常返回"，它在会话日志里
 * 就与成功调用**完全无法区分**：UI 卡片显示成功、模型容易误判、任何基于 `isError`
 * 的重试/统计/压缩逻辑一并失效。
 *
 * 2026-09 实例：`web_retriever_fetch` 11 次结果里 7 次实际失败，**全部 `isError: false`**
 * （见 `docs/design/tool-result-error-signal.md`）。本脚本把同一判据推广到**全部会话、
 * 全部工具**，用来定位同类缺陷，而不是靠逐个读代码猜。
 *
 * 判据（两条，任一命中即"疑似失败被记成成功"）：
 *   ① 结果文本能解析成 JSON，且 `ok === false`；
 *   ② 结果文本能解析成 JSON，且有非空 `error`，同时 `ok` 不是 `true`。
 * 这条判据是**启发式**，会漏掉非 JSON 回执、也会误报"把 error 当正常字段"的工具；
 * 它是线索生成器，不是断言。
 *
 * 用法：
 *   node scripts/audit-tool-errors.mjs [--dir <sessions 根>] [--tool <名字>] [--json]
 *   npm run audit:tool-errors
 * 退出码：0 = 脚本自身跑完（**发现疑似项不算失败**，这是报告不是断言）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { homedir } from 'node:os'
import { join } from 'node:path'

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const ROOT = argValue('--dir', join(DSH_HOME, 'sessions'))
const ONLY_TOOL = argValue('--tool', undefined)
const AS_JSON = process.argv.includes('--json')

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 逐帧解压：Node 的 zstd 解码只吃第一帧，会话文件是追加式多帧。 */
function decodeSession(file) {
  const buffer = readFileSync(file)
  const offsets = []
  let cursor = 0
  while ((cursor = buffer.indexOf(ZSTD_MAGIC, cursor)) >= 0) {
    offsets.push(cursor)
    cursor += ZSTD_MAGIC.length
  }
  offsets.push(buffer.length)
  let text = ''
  for (let index = 0; index < offsets.length - 1; index += 1) {
    try {
      text += zstdDecompressSync(buffer.subarray(offsets[index], offsets[index + 1])).toString('utf8')
    } catch {
      // 压缩数据里出现巧合的 magic 会切错帧，跳过即可。
    }
  }
  return text
}

/** 结果文本是否"看起来是失败"，但 `isError` 却是 false。 */
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
    const file = join(workspaceDir, sessionId, 'session.v3.jsonl.zstd')
    try {
      if (!statSync(file).isFile()) continue
    } catch {
      continue
    }
    scannedSessions += 1
    let events
    try {
      events = decodeSession(file)
        .split('\n')
        .filter(Boolean)
        .map((line) => { try { return JSON.parse(line) } catch { return null } })
        .filter(Boolean)
    } catch {
      continue
    }

    const callNames = new Map()
    for (const event of events) {
      if (event.type === 'tool/call' && event.data?.callId) callNames.set(event.data.callId, event.data.name)
    }
    for (const event of events) {
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
  console.log('      这是启发式线索，不是断言；确认后按 docs/design/tool-result-error-signal.md 处置。')
}
process.exit(0)
