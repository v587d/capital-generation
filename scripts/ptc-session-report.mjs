#!/usr/bin/env node
/**
 * Phase-3 read-only report for data_junior PTC sessions. Prints nested dispatch counts, whether
 * skill content was actually printed, whether too_large was retried inside a program, and whether
 * describe_dataset calls overlapped. Not an assertion: use it to decide what to fix, then roll back
 * or keep PTC per docs/design/data-junior-ptc.md §7 Phase 3.
 */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { findSessionRecords } from './lib/session-files.mjs'

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const ROOT = argValue('--dir', join(DSH_HOME, 'sessions'))
const SESSION_PREFIX = argValue('--session', undefined)
const LATEST = Number(argValue('--latest', '5'))
const AS_JSON = process.argv.includes('--json')

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Multi-frame zstd: Node decodes only the first frame; sessions append one frame per write. */
function decode(file) {
  const buffer = readFileSync(file)
  const offsets = []
  let cursor = 0
  while ((cursor = buffer.indexOf(MAGIC, cursor)) >= 0) {
    offsets.push(cursor)
    cursor += MAGIC.length
  }
  offsets.push(buffer.length)
  let text = ''
  for (let index = 0; index < offsets.length - 1; index += 1) {
    try {
      text += zstdDecompressSync(buffer.subarray(offsets[index], offsets[index + 1])).toString('utf8')
    } catch {
      // A coincidental magic inside compressed data splits the frame wrong; skip it.
    }
  }
  return text.split('\n').filter(Boolean)
    .map((line) => { try { return JSON.parse(line) } catch { return null } })
    .filter(Boolean)
}

const textOf = (blocks) => (blocks ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n')

function report(record) {
  const events = decode(record.file)
  const calls = new Map()
  for (const event of events) {
    if (event.type === 'tool/call') calls.set(event.data?.callId, event.data)
  }

  const dispatches = []
  const starts = new Map()
  for (const event of events) {
    if (event.type === 'tool/ptc-dispatch-start') {
      starts.set(event.data?.subCallId, event.time)
      continue
    }
    if (event.type !== 'tool/ptc-dispatch') continue
    const data = event.data ?? {}
    const content = textOf(data.content)
    dispatches.push({
      name: data.name,
      isError: data.isError === true,
      chars: content.length,
      startedAt: starts.get(data.subCallId) ?? null,
      endedAt: typeof event.time === 'number' ? event.time : null,
      durationMs: typeof starts.get(data.subCallId) === 'number' && typeof event.time === 'number'
        ? Math.max(0, event.time - starts.get(data.subCallId))
        : null,
      hasProtocol: /#\s*Capital\s+数据协议|#\s*Capital\s+可视化编排协议/.test(content),
      tooLarge: /"status"\s*:\s*"too_large"|too_large/.test(content),
    })
  }

  const runCodeCalls = []
  for (const call of calls.values()) {
    if (call.name !== 'run_code') continue
    let args
    try { args = JSON.parse(call.arguments) } catch { args = {} }
    runCodeCalls.push({ code: typeof args.code === 'string' ? args.code : '', description: args.description })
  }
  const runCodeResults = []
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    for (const block of event.data?.message?.content ?? []) {
      if (block.type !== 'tool-result') continue
      const call = calls.get(block.toolCallId)
      if (call?.name !== 'run_code') continue
      const text = textOf(block.content)
      runCodeResults.push({
        isError: block.isError === true,
        chars: text.length,
        hasProtocol: /#\s*Capital\s+数据协议|#\s*Capital\s+可视化编排协议/.test(text),
      })
    }
  }

  const describe = dispatches.filter((entry) => entry.name === 'describe_dataset')
  const overlaps = describe.some((entry, index) => describe.slice(index + 1)
    .some((other) => entry.startedAt !== null && entry.endedAt !== null
      && other.startedAt !== null && other.endedAt !== null
      && entry.startedAt < other.endedAt && other.startedAt < entry.endedAt))
  const byName = new Map()
  for (const entry of dispatches) {
    const row = byName.get(entry.name) ?? { name: entry.name, count: 0, errors: 0, protocolChars: 0 }
    row.count += 1
    if (entry.isError) row.errors += 1
    if (entry.hasProtocol) row.protocolChars += entry.chars
    byName.set(entry.name, row)
  }

  return {
    session: record.id,
    version: record.version,
    updatedAt: new Date(record.mtime).toISOString(),
    dispatches: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    runCodeCalls: runCodeCalls.length,
    runCodeWithPromiseAll: runCodeCalls.filter((call) => /Promise\.all/.test(call.code)).length,
    runCodeWithToolsBash: runCodeCalls.filter((call) => /tools\.bash/.test(call.code)).length,
    runCodeResults,
    tooLargeSeen: dispatches.filter((entry) => entry.tooLarge).length,
    describeCount: describe.length,
    describeOverlapWindow: overlaps,
    skillPrinted: dispatches.some((entry) => entry.name === 'skill' && entry.hasProtocol),
    protocolInRunCodeResult: runCodeResults.some((entry) => entry.hasProtocol),
  }
}

const records = findSessionRecords(ROOT)
  .filter((record) => SESSION_PREFIX === undefined || record.id.startsWith(SESSION_PREFIX))
  .sort((a, b) => b.mtime - a.mtime)
  .slice(0, Number.isFinite(LATEST) && LATEST > 0 ? LATEST : 5)

if (records.length === 0) {
  console.error(`ptc-session-report: ${ROOT} 下没有匹配的会话（--session ${SESSION_PREFIX ?? '未指定'}）。`)
  process.exit(2)
}

const reports = records.map(report)
if (AS_JSON) {
  console.log(JSON.stringify(reports, null, 2))
  process.exit(0)
}

for (const row of reports) {
  console.log(`\n=== ${row.session} (v${row.version}, ${row.updatedAt}) ===`)
  console.log(`run_code 程序 ${row.runCodeCalls} 段（Promise.all ${row.runCodeWithPromiseAll}，tools.bash ${row.runCodeWithToolsBash}）；`
    + `外层结果 ${row.runCodeResults.length} 条`)
  console.log(`skill 协议被打印：${row.skillPrinted ? '✅' : '❌'}；协议正文回到 run_code 结果：${row.protocolInRunCodeResult ? '✅' : '❌'}`)
  console.log(`describe_dataset ${row.describeCount} 次；too_large 出现 ${row.tooLargeSeen} 次；describe 并发窗口：${row.describeOverlapWindow ? '✅ 观察到重叠' : '未观察到重叠'}`)
  for (const entry of row.dispatches) {
    console.log(`  ${entry.name.padEnd(28)} 调用 ${String(entry.count).padStart(3)} 次，错误 ${String(entry.errors).padStart(2)}，协议正文 ${entry.protocolChars} 字符`)
  }
  for (const [index, result] of row.runCodeResults.entries()) {
    console.log(`  run_code#${index + 1}：${result.isError ? '错误' : '成功'}，外层 ${result.chars} 字符，含协议 ${result.hasProtocol ? '是' : '否'}`)
  }
}
console.log('\n提示：skillPrinted 只认 dispatch content 里的协议正文；<skill_content> 是 native render，不是 PTC 证据。')
