/**
 * Pure readers for the selected-skill usage feedback loop. The runtime ledger
 * answers "what did this turn use"; this module answers the same question from
 * durable session logs so a report can audit the prompt's claims.
 */

function nameFromArguments(args) {
  let value = args
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  if (value === null || typeof value !== 'object') return undefined
  const name = value.name
  return typeof name === 'string' && name.length > 0 ? name : undefined
}

/** Session v4 keeps the result on the message; older shapes nested a tool-result block. */
function toolResultBlocks(event) {
  const message = event?.data?.message
  if (message === undefined || message === null) return []
  if (typeof message.toolCallId === 'string') {
    return [{
      toolCallId: message.toolCallId,
      isError: message.isError === true,
    }]
  }
  return (message.content ?? []).filter((block) => block?.type === 'tool-result')
}

/**
 * Successful selected-skill loads in one session. `catalogNames` is the
 * allow-list; names outside it are ignored so a built-in protocol load never
 * pollutes the report.
 */
export function extractSelectedSkillUsage(events, catalogNames) {
  const allowed = catalogNames instanceof Set ? catalogNames : new Set(catalogNames)
  const calls = new Map()
  const used = new Map()
  const add = (name, via, at) => {
    if (typeof name !== 'string' || !allowed.has(name)) return
    const row = used.get(name) ?? { name, count: 0, via: new Set(), usedAt: 0 }
    row.count += 1
    row.via.add(via)
    row.usedAt = Math.max(row.usedAt, typeof at === 'number' ? at : 0)
    used.set(name, row)
  }
  for (const event of events) {
    const at = typeof event?.time === 'number' ? event.time : 0
    if (event?.type === 'tool/call') {
      if (event.data?.name !== 'skill') continue
      const name = nameFromArguments(event.data.arguments)
      if (name !== undefined) calls.set(event.data.callId, name)
      continue
    }
    if (event?.type === 'tool/result') {
      for (const block of toolResultBlocks(event)) {
        const name = calls.get(block.toolCallId)
        if (name !== undefined && block.isError !== true) add(name, 'tool', at)
      }
      continue
    }
    if (event?.type === 'tool/ptc-dispatch') {
      if (event.data?.name !== 'skill' || event.data?.isError === true) continue
      add(nameFromArguments(event.data.arguments), 'ptc', at)
      continue
    }
    if (event?.type === 'user/message') {
      const source = event.data?.source
      if (source?.kind === 'skill-invocation') add(source.name, 'user', at)
    }
  }
  return [...used.values()]
    .map((row) => ({ name: row.name, count: row.count, via: [...row.via].sort(), usedAt: row.usedAt }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** The session's creation catalog, from the host `skill-catalog` context message. */
export function extractSkillCatalog(events) {
  const event = events.find((candidate) => candidate?.type === 'user/message'
    && candidate.data?.source?.kind === 'skill-catalog')
  const entries = event?.data?.source?.entries
  if (!Array.isArray(entries)) return []
  return entries.map((entry) => entry?.name).filter((name) => typeof name === 'string' && name.length > 0)
}

/** Time of the last real user message: the runtime clears the usage ledger at exactly this point. */
export function lastUserTurnAt(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    if (event.data?.source?.kind === 'user') return typeof event.time === 'number' ? event.time : 0
  }
  return 0
}

/** The root's closing text in the LAST turn; older turns must not satisfy this turn's ledger. */
export function finalAssistantText(events) {
  let start = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'turn/start') {
      start = index
      break
    }
  }
  for (let index = events.length - 1; index >= start; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    const text = (event.data?.message?.content ?? [])
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim()
    if (text.length > 0) return text
  }
  return ''
}

/** Exact skill names often contain each other (`catalyst-calendar` / `china-catalyst-calendar`). */
function citesName(name, text) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9-])${escaped}(?=$|[^a-z0-9-])`, 'i').test(text)
}

export function missingCitations(names, text) {
  return names.filter((name) => !citesName(name, text))
}

/** One session's durable facts plus its selected-skill usage. */
export function summarizeSession(record, events, catalogNames) {
  const header = events.find((event) => event?.type === 'session') ?? {}
  const headerId = typeof header.id === 'string' ? header.id : record.id
  const parentSession = typeof header.parentSession === 'string' && header.parentSession.length > 0
    ? header.parentSession
    : undefined
  return {
    id: headerId,
    parentSession,
    preset: typeof header.agentPreset === 'string' ? header.agentPreset : undefined,
    origin: typeof header.origin === 'string' ? header.origin : parentSession === undefined ? 'root' : 'subagent',
    createdAt: typeof header.createdAt === 'number' ? header.createdAt : undefined,
    mtime: record.mtime,
    version: record.version,
    skills: extractSelectedSkillUsage(events, catalogNames),
    catalog: extractSkillCatalog(events),
    userTurnAt: lastUserTurnAt(events),
    finalText: finalAssistantText(events),
  }
}

const bare = (id) => String(id ?? '').replace(/^session-/, '')

/**
 * Group sessions by root via `parentSession`. A parent outside the scan window
 * makes that session its own root rather than dropping it.
 */
export function buildUsageTrees(sessions) {
  const byId = new Map(sessions.map((session) => [bare(session.id), session]))
  const children = new Map()
  const roots = []
  for (const session of sessions) {
    const parent = session.parentSession === undefined ? undefined : bare(session.parentSession)
    if (parent === undefined || !byId.has(parent)) {
      roots.push(session)
      continue
    }
    const list = children.get(parent) ?? []
    list.push(session)
    children.set(parent, list)
  }
  const treeOf = (root) => {
    const collected = [root]
    const pending = [...(children.get(bare(root.id)) ?? [])]
    while (pending.length > 0) {
      const session = pending.shift()
      collected.push(session)
      pending.push(...(children.get(bare(session.id)) ?? []))
    }
    return collected
  }
  return roots
    .map((root) => {
      const members = treeOf(root)
      const since = root.userTurnAt ?? 0
      // Mirrors the runtime ledger: work from earlier user turns is not cited again.
      const visible = members.map((session) => ({
        ...session,
        skills: session.skills
          .filter((skill) => !(skill.usedAt > 0 && skill.usedAt < since))
          .map(({ name, count, via }) => ({ name, count, via })),
      }))
      const used = new Map()
      for (const session of visible) {
        for (const skill of session.skills) {
          const row = used.get(skill.name) ?? { name: skill.name, count: 0, sessions: 0, roles: new Set() }
          row.count += skill.count
          row.sessions += 1
          row.roles.add(session.preset ?? session.origin)
          used.set(skill.name, row)
        }
      }
      const names = [...used.keys()].sort()
      const missing = missingCitations(names, root.finalText)
      return {
        root,
        sessions: visible,
        skills: [...used.values()]
          .map((row) => ({ name: row.name, count: row.count, sessions: row.sessions, roles: [...row.roles].sort() }))
          .sort((left, right) => left.name.localeCompare(right.name)),
        finalAnswer: { cited: names.length - missing.length, total: names.length, missing },
        updatedAt: Math.max(...visible.map((session) => session.mtime ?? 0)),
      }
    })
    .sort((left, right) => right.updatedAt - left.updatedAt)
}
