#!/usr/bin/env node
/**
 * 观察 Capital 会话里主 Agent 与子 Agent 的行为。
 *
 * 只读：解压 `$DSH_HOME/sessions/<workspace-slug>/<session-id>/session.v3.jsonl.zstd`
 * （DSH 的追加式记录，每个 frame 是一段独立 zstd，所以要逐帧解），按
 * `header.parentSession` 还原委派树，再打印每个 Agent 的工具序列与 Agent 间消息。
 *
 * 用法：
 *   node scripts/session-trace.mjs                    # 当前工作目录最近的会话树
 *   node scripts/session-trace.mjs --session <id>     # 指定会话（前缀匹配即可）
 *   node scripts/session-trace.mjs --list             # 只列会话，不展开
 *   node scripts/session-trace.mjs --cwd /path/to/ws  # 指定工作目录
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

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
      // 压缩数据里出现巧合的 magic 会切错帧，跳过即可
    }
  }
  const events = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // 记录被截断时忽略残行
    }
  }
  return events
}

/**
 * DSH 把工作目录编码成会话目录名：去掉开头的 `/`，把 `/` 换成 `-`，两侧各加 `-`。
 * 例：`/home/shawn/projects/capital-generation` → `--home-shawn-projects-capital-generation--`
 * （目录名里的 `-` 与路径分隔符不可逆，所以只能正向编码后比对，不做反向还原。）
 */
function slugFor(cwd) {
  return `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`
}

function sessionsRoot() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions')
}

function loadSessions(cwd) {
  const root = join(sessionsRoot(), slugFor(cwd))
  let entries
  try {
    entries = readdirSync(root)
  } catch {
    return { root, sessions: [] }
  }
  const sessions = []
  for (const id of entries) {
    const file = join(root, id, 'session.v3.jsonl.zstd')
    try {
      const events = decodeSession(file)
      const header = events.find((event) => event.type === 'session')
      if (!header) continue
      sessions.push({ id, file, header, events, mtime: statSync(file).mtimeMs })
    } catch {
      // 正在写入或损坏的会话跳过
    }
  }
  return { root, sessions }
}

/** 主会话 id 带 `session-` 前缀、子会话目录是裸 uuid，显示时统一去掉前缀。 */
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

/** 父子关联：子会话 header.parentSession 指的是父会话 header.id（可能带/不带 session- 前缀）。 */
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
    // 指定子会话时，回溯到它的根，方便看整棵树
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
