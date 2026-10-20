import { DatasetStoreError, type SessionLike } from './data-collector/store.js'
import { readPresetClaim } from './preset-claim.js'
import { ROOT_PRESET_ID } from './preset-ids.js'

/**
 * The single source of truth for caller identity and tool authorization.
 *
 * Only the framework shape `exec.agent.session` is accepted; no `exec.session` fallback,
 * so tests cannot bypass the real shape again.
 *
 * Authorization is by preset, not by session topology: a root session manually opened with
 * a role preset must be allowed, while the main Agent (`capital-generation`) stays denied.
 * Raw rows are protected by tool return shapes, not by this gate.
 *
 * When identity cannot be confirmed (registry unavailable or no preset), fall back to the
 * legacy parentSession check. That fallback must never be wider than the old behavior.
 */
export interface AgentExecutionLike {
  agent?: {
    session?: { id?: string; header?: { cwd?: string; parentSession?: string } }
    ctx?: unknown
  }
  signal: AbortSignal
}

/** Narrow the cordis context once here instead of asserting at every call site. */
type PresetReader = { get?(name: string): unknown }

/** Return the caller session; fail loudly when the framework shape is missing. */
export function callerSession(exec: AgentExecutionLike): SessionLike {
  const session = exec.agent?.session
  if (!session || typeof session.id !== 'string') {
    throw new DatasetStoreError('session_unavailable', 'the calling agent session was not provided')
  }
  return session as SessionLike
}

/** Result of {@link authorizeToolSession}; never throws so each domain keeps its own error. */
export interface ToolSessionDecision {
  readonly session: SessionLike
  readonly allowed: boolean
  /** `preset` = resolved identity; `topology` = legacy fallback when the registry is unavailable. */
  readonly via: 'preset' | 'topology'
  /** Matched preset id; undefined when `via === 'topology'`. */
  readonly presetId?: string
}

function hasParentSession(session: SessionLike): boolean {
  const parent = (session as { header?: { parentSession?: string } }).header?.parentSession
  return typeof parent === 'string' && parent.length > 0
}

/**
 * Decide whether this session may use a preset-restricted tool.
 *
 * Does not throw: callers own their error codes and messages. The only side effect is
 * recording the decision in a bounded ring buffer for diagnostics.
 */
export function authorizeToolSession(
  pluginCtx: unknown,
  exec: AgentExecutionLike,
  toolName: string,
  allowedPresetIds: readonly string[],
): ToolSessionDecision {
  const session = callerSession(exec)
  const claim = readPresetClaim(pluginCtx as PresetReader | undefined, exec.agent)
  const decision = (!claim.registryMissing && !claim.failed && typeof claim.claim === 'string' && claim.claim.length > 0)
    // Confirmed identity: the main Agent is not in any allow-list and stays denied.
    ? { session, allowed: allowedPresetIds.includes(claim.claim), via: 'preset' as const, presetId: claim.claim }
    // Unconfirmed identity: legacy topology check, never wider than before.
    : { session, allowed: hasParentSession(session), via: 'topology' as const }
  recordSessionAuth(toolName, decision)
  return decision
}

/**
 * Data-side gate: decide and throw `dataset_session_mismatch` when denied.
 *
 * Messages are model guidance: name the current preset on preset mismatch, or tell a role
 * agent to ask its caller instead of switching tools.
 */
export function authorizedSession(
  pluginCtx: unknown,
  exec: AgentExecutionLike,
  toolName: string,
  allowedPresetIds: readonly string[],
): SessionLike {
  const decision = authorizeToolSession(pluginCtx, exec, toolName, allowedPresetIds)
  if (decision.allowed) return decision.session
  if (decision.via === 'preset') {
    // "Delegate" is only correct for the main Agent; a role agent that hits this gate is
    // already delegated and must report back instead of switching tools.
    throw new DatasetStoreError(
      'dataset_session_mismatch',
      `${toolName} 不对人设 ${decision.presetId} 开放；它只属于 ${allowedPresetIds.join(' / ')}。`
      + (decision.presetId === ROOT_PRESET_ID ? '主 Agent 请委派相应角色。' : '你是角色越界：回告调用方改用相应模式，不要自己换工具硬做。'),
    )
  }
  throw new DatasetStoreError('dataset_session_mismatch', `${toolName} is restricted to delegated data agents; the main Agent must delegate this request`)
}

/** Bounded recent authorization decisions, exposed through `dc_status.session_identity`. */
export interface SessionAuthRecord {
  readonly tool: string
  readonly via: 'preset' | 'topology'
  readonly presetId: string | null
  readonly allowed: boolean
}

const MAX_SESSION_AUTH_RECORDS = 16
const sessionAuthRecords: SessionAuthRecord[] = []

function recordSessionAuth(toolName: string, decision: ToolSessionDecision): void {
  sessionAuthRecords.push({
    tool: toolName,
    via: decision.via,
    presetId: decision.presetId ?? null,
    allowed: decision.allowed,
  })
  if (sessionAuthRecords.length > MAX_SESSION_AUTH_RECORDS) sessionAuthRecords.shift()
}

/** Recent decisions as a shallow copy (JSON-safe for model output). */
export function sessionIdentityDecisions(): SessionAuthRecord[] {
  return sessionAuthRecords.map((record) => ({ ...record }))
}

/** Test-only: clear records between cases. */
export function resetSessionIdentityDecisions(): void {
  sessionAuthRecords.length = 0
}
