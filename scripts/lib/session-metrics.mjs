/**
 * Read-only per-session metrics for analysis evaluation: duration, turns, tool calls, tool errors
 * and token usage. Cost numbers are trend data (design D8 forbids pass/fail thresholds); the report
 * exists so a Phase 6 run can be compared with earlier ones, not to score a model.
 *
 * The event vocabulary is the host's durable session log (v4). Field names are read defensively:
 * a missing usage chunk means "not recorded", not zero.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { latestSessionFile, workspaceSlug } from './session-files.mjs'
import { readSessionEvents } from './session-events.mjs'

const USAGE_FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'totalTokens']

function textOf(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks.filter((block) => block?.type === 'text').map((block) => block.text).join('')
}

/** Summarize one session's events. Exported for the regression test. */
export function summarizeSession(events) {
  const header = events.find((event) => event.type === 'session') ?? {}
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0, recorded: false }
  const models = new Set()
  const toolNames = {}
  let turns = 0
  let toolCalls = 0
  let toolErrors = 0
  let firstTime = Number.POSITIVE_INFINITY
  let lastTime = 0
  let assistantMessages = 0
  let finalAnswer = ''
  for (const event of events) {
    if (typeof event.time === 'number') {
      firstTime = Math.min(firstTime, event.time)
      lastTime = Math.max(lastTime, event.time)
    }
    if (event.type === 'turn/start') turns += 1
    if (event.type === 'assistant/message') {
      assistantMessages += 1
      const recorded = event.data?.usage
      if (recorded && typeof recorded === 'object') {
        usage.recorded = true
        for (const field of USAGE_FIELDS) {
          if (typeof recorded[field] === 'number') usage[field] += recorded[field]
        }
        const source = event.data?.message?.source
        if (typeof source?.provider === 'string' && typeof source?.model === 'string') {
          models.add(`${source.provider}/${source.model}`)
        }
      }
      const text = textOf(event.data?.message)
      if (text.length > 0) finalAnswer = text
    }
    if (event.type === 'tool/call') {
      toolCalls += 1
      const name = typeof event.data?.name === 'string' ? event.data.name : '?'
      toolNames[name] = (toolNames[name] ?? 0) + 1
    }
    if (event.type === 'tool/result' && event.data?.message?.isError === true) toolErrors += 1
  }
  return {
    id: typeof header.id === 'string' ? header.id : undefined,
    preset: typeof header.agentPreset === 'string' ? header.agentPreset : undefined,
    parent: typeof header.parentSession === 'string' ? header.parentSession : undefined,
    origin: typeof header.origin === 'string' ? header.origin : undefined,
    depth: typeof header.delegationDepth === 'number' ? header.delegationDepth : undefined,
    createdAt: typeof header.createdAt === 'number' ? header.createdAt : (Number.isFinite(firstTime) ? firstTime : undefined),
    durationMs: Number.isFinite(firstTime) && lastTime > 0 ? lastTime - firstTime : undefined,
    turns,
    assistantMessages,
    toolCalls,
    toolErrors,
    toolNames,
    models: [...models],
    usage: usage.recorded ? usage : undefined,
    finalAnswerChars: finalAnswer.length,
  }
}

/**
 * Read every session under `<home>/sessions/<workspaceSlug(cwd)>/`, newest first.
 * Returns [] when the workspace has no sessions; callers must print that as a visible skip.
 */
export function collectSessionMetrics(home, cwd) {
  const root = join(home, 'sessions', workspaceSlug(cwd))
  if (!existsSync(root)) return []
  const sessions = []
  for (const entry of readdirSync(root)) {
    const found = latestSessionFile(join(root, entry))
    if (found === undefined) continue
    let events
    try {
      events = readSessionEvents(found.file)
    } catch {
      continue
    }
    const summary = summarizeSession(events)
    if (summary.id === undefined) continue
    sessions.push({ ...summary, file: found.file })
  }
  sessions.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
  return sessions
}

/** Sum the per-session rows into the evaluation table's totals row. */
export function totalsOf(sessions) {
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0 }
  let turns = 0
  let toolCalls = 0
  let toolErrors = 0
  for (const session of sessions) {
    turns += session.turns
    toolCalls += session.toolCalls
    toolErrors += session.toolErrors
    if (session.usage !== undefined) {
      for (const field of USAGE_FIELDS) usage[field] += session.usage[field]
    }
  }
  return { sessions: sessions.length, turns, toolCalls, toolErrors, usage }
}
