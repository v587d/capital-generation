/**
 * Programmatic selected-skill ledger: a load counts only after the host returned the
 * selected provider's body. The root prompt reads the tree; the report script re-derives
 * the same facts from durable session logs, so model self-report is never the source.
 */
import { agentSessionId, type AgentLike } from './root-tool-policy.js'

export interface SkillUsageRow {
  readonly sessionId: string
  readonly parentSession?: string
  readonly role: string
  readonly names: readonly string[]
}

interface UsageRecord {
  sessionId: string
  parentSession?: string
  role: string
  names: string[]
}

const records = new Map<string, UsageRecord>()

const bareSession = (id: string): string => id.replace(/^session-/, '')

function recordFor(agent: AgentLike | undefined, role: string): UsageRecord | undefined {
  const id = agentSessionId(agent)
  if (id === undefined) return undefined
  const key = bareSession(id)
  const parent = agent?.session?.header?.parentSession
  const parentId = typeof parent === 'string' && parent.length > 0 ? bareSession(parent) : undefined
  const existing = records.get(key)
  if (existing !== undefined) {
    existing.role = role
    if (parentId !== undefined) existing.parentSession = parentId
    return existing
  }
  const created: UsageRecord = {
    sessionId: key,
    ...(parentId === undefined ? {} : { parentSession: parentId }),
    role,
    names: [],
  }
  records.set(key, created)
  return created
}

/** Register a role Agent before it loads anything, so the tree edge survives an empty session. */
export function trackSelectedSkillUsage(agent: AgentLike | undefined, role: string): void {
  recordFor(agent, role)
}

export function recordSelectedSkillUsage(agent: AgentLike | undefined, role: string, name: string): void {
  if (name.length === 0) return
  const record = recordFor(agent, role)
  if (record === undefined) return
  if (!record.names.includes(name)) record.names.push(name)
}

function rootOf(sessionId: string): string {
  let cursor = records.get(sessionId)
  const seen = new Set<string>()
  while (cursor?.parentSession !== undefined && !seen.has(cursor.sessionId)) {
    seen.add(cursor.sessionId)
    const parent = records.get(cursor.parentSession)
    if (parent === undefined) break
    cursor = parent
  }
  return cursor?.sessionId ?? sessionId
}

/** A new user turn drops the previous turn's names but keeps the tree edges. */
export function resetSelectedSkillUsage(rootSessionId: string): void {
  const root = bareSession(rootSessionId)
  for (const record of records.values()) {
    if (rootOf(record.sessionId) === root) record.names.length = 0
  }
}

/** Agent teardown: the whole subtree's records are process-local and must not outlive it. */
export function clearSelectedSkillUsage(rootSessionId: string): void {
  const root = bareSession(rootSessionId)
  // Resolve every member BEFORE deleting: removing the root first would orphan its children
  // and the remaining loop would no longer see them.
  const doomed = [...records.values()]
    .filter((record) => rootOf(record.sessionId) === root)
    .map((record) => record.sessionId)
  for (const id of doomed) records.delete(id)
}

export function clearAllSelectedSkillUsage(): void {
  records.clear()
}

export function skillUsageRows(rootSessionId: string): SkillUsageRow[] {
  const root = bareSession(rootSessionId)
  return [...records.values()]
    .filter((record) => rootOf(record.sessionId) === root && record.names.length > 0)
    .map((record) => ({
      sessionId: record.sessionId,
      ...(record.parentSession === undefined ? {} : { parentSession: record.parentSession }),
      role: record.role,
      names: [...record.names],
    }))
}

export function skillUsageNamesForSession(sessionId: string): string[] {
  return [...(records.get(bareSession(sessionId))?.names ?? [])]
}
