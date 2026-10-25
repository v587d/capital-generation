#!/usr/bin/env node
/**
 * Prints main/sub-agent behaviour from a Capital session: tool sequences and inter-agent messages,
 * read-only. Session files are appended frame by frame (one zstd frame per write), so each must be
 * decompressed frame by frame; the tree comes from `header.parentSession`.
 */
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { latestSessionFile, workspaceSlug } from './lib/session-files.mjs'
import { readSessionEvents } from './lib/session-events.mjs'

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function sessionsRoot() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions')
}

function loadSessions(cwd) {
  const root = join(sessionsRoot(), workspaceSlug(cwd))
  let entries
  try {
    entries = readdirSync(root)
  } catch {
    return { root, sessions: [] }
  }
  const sessions = []
  for (const id of entries) {
    // Version-agnostic: the host moved v3 → v4, so a literal name silently scans 0 sessions.
    const found = latestSessionFile(join(root, id))
    if (found === undefined) continue
    try {
      const events = readSessionEvents(found.file)
      const header = events.find((event) => event.type === 'session')
      if (!header) continue
      sessions.push({ id, file: found.file, header, events, mtime: found.mtime })
    } catch {
      // Skip sessions that are still being written or are corrupt.
    }
  }
  return { root, sessions }
}

/** Main session ids carry a `session-` prefix, child dirs are bare uuids; display both bare. */
const shortId = (id) => String(id ?? '').replace(/^session-/, '').slice(0, 8)

const compact = (value, limit = 110) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const flat = (text ?? '').replace(/\s+/g, ' ')
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

function agentMessages(events) {
  const traffic = []
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const content = event.data?.content ?? []
    const text = content.filter((block) => block.type === 'text').map((block) => block.text).join('')
    const source = event.data?.source
    if (source?.kind === 'agent-message') {
      traffic.push({ direction: 'in', who: shortId(source.senderSessionId), text: text.replace(/^Agent [^ ]+ sent a message:\s*/, '') })
    } else if (source?.kind === 'subagent-settled') {
      traffic.push({ direction: 'settled', who: shortId(source.senderSessionId), text })
    }
  }
  return traffic
}

function toolCalls(events) {
  const calls = []
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    calls.push({ name: event.data?.name ?? '?', args: event.data?.arguments ?? '' })
  }
  return calls
}

function renderSession(session, sessions, options, depth) {
  const { header, events, id } = session
  const indent = '  '.repeat(depth)
  const label = events.find((event) => event.type === 'subagent/descriptor')?.data?.label
  const origin = header.origin === 'subagent' ? '子 Agent' : '主 Agent'
  const calls = toolCalls(events)
  const turns = events.filter((event) => event.type === 'turn/start').length
  const model = events.find((event) => event.type === 'request/header')?.data?.model ?? ''
  console.log(`${indent}${depth === 0 ? '●' : '○'} ${origin} ${shortId(id)}${label ? `  label=${label}` : ''}${header.delegationDepth ? `  depth=${header.delegationDepth}` : ''}${model ? `  ${model}` : ''}`)
  console.log(`${indent}   轮数 ${turns} · 工具调用 ${calls.length}`)

  if (options.tools && calls.length > 0) {
    const counts = new Map()
    for (const call of calls) counts.set(call.name, (counts.get(call.name) ?? 0) + 1)
    console.log(`${indent}   工具: ${[...counts].map(([name, count]) => (count > 1 ? `${name}×${count}` : name)).join(', ')}`)
  }
  if (options.args) {
    console.log(`${indent}   调用序列:`)
    for (const call of calls) console.log(`${indent}     ${call.name}  ${compact(call.args, options.width)}`)
  }

  const traffic = options.messages ? agentMessages(events) : []
  if (traffic.length > 0) {
    console.log(`${indent}   Agent 间消息:`)
    for (const item of traffic) {
      const arrow = item.direction === 'in' ? '←收' : item.direction === 'settled' ? '←结算' : '→发'
      console.log(`${indent}     ${arrow} ${item.who}  ${compact(item.text, options.width)}`)
    }
  }

  const children = sessions.filter((other) => sameSession(session, other.header.parentSession))
  for (const child of children) renderSession(child, sessions, options, depth + 1)
}

/** parentSession points at the parent header.id, with or without the `session-` prefix. */
function sameSession(session, id) {
  if (!id) return false
  const bare = (value) => String(value).replace(/^session-/, '')
  return session.id === id || bare(session.id) === bare(id)
}

function main() {
  const cwd = argValue('--cwd', process.cwd())
  const { root, sessions } = loadSessions(cwd)
  if (sessions.length === 0) {
    console.log(`没有找到会话：${root}`)
    console.log('（DSH_HOME 不是默认值时用环境变量指定；工作目录必须与会话一致）')
    return
  }
  sessions.sort((left, right) => left.mtime - right.mtime)

  if (process.argv.includes('--list')) {
    console.log(`会话目录：${root}`)
    for (const session of sessions) {
      const origin = session.header.origin === 'subagent' ? '子' : '主'
      const parent = session.header.parentSession ? ` parent=${shortId(session.header.parentSession)}` : ''
      console.log(`  [${origin}] ${(session.header.agentPreset ?? '-').padEnd(18)} ${shortId(session.id)}${parent}  ${new Date(session.header.createdAt).toISOString()}`)
    }
    return
  }

  const preset = argValue('--preset', undefined)
  const pool = preset === undefined ? sessions : sessions.filter((session) => session.header.agentPreset === preset)
  if (pool.length === 0) {
    console.log(`没有匹配的会话（--preset ${preset}）`)
    return
  }

  const wanted = argValue('--session', undefined)
  const roots = pool.filter((session) => !session.header.parentSession)
  let tree = roots
  if (wanted) {
    const match = pool.find((session) => session.id.startsWith(wanted) || session.id.includes(wanted))
    if (!match) {
      console.log(`找不到会话 ${wanted}；用 --list 看可用 id`)
      return
    }
    // A named child still shows the whole tree: walk up to its root.
    let cursor = match
    while (cursor.header.parentSession) {
      const parent = sessions.find((session) => sameSession(session, cursor.header.parentSession))
      if (!parent) break
      cursor = parent
    }
    tree = [cursor]
  } else if (tree.length > 1) {
    tree = [tree[tree.length - 1]]
  }

  const options = {
    tools: !process.argv.includes('--no-tools'),
    messages: !process.argv.includes('--no-messages'),
    args: process.argv.includes('--args'),
    width: Number(argValue('--width', '160')),
  }
  console.log(`会话目录：${root}`)
  for (const session of tree) {
    renderSession(session, sessions, options, 0)
    console.log('')
  }
}

main()
