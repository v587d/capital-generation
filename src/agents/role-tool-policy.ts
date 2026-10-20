/**
 * Role tool surfaces by mounted role preset. `toolFilter` was removed upstream, so tools come
 * from family rows (composition) and there is no allow-list here. Restricting the agent scope
 * filters preset contributions; identity is the preset id, not root/child. Listeners on `ctx.root`.
 */

import type { AgentLike, GuardedExecution, PolicyContext } from './root-tool-policy.js'
import { agentSessionId, isRootAgent, recordGuardDecision } from './root-tool-policy.js'
import { readPresetClaim } from '../preset-claim.js'
import { ROLE_PRESET_ID_LIST, ROLE_PRESET_IDS, type RolePresetId } from '../preset-ids.js'

export { ROLE_PRESET_IDS, ROLE_PRESET_ID_LIST, type RolePresetId } from '../preset-ids.js'

/** Welded to `send_message` by `tool-subagent-control`; no host switch, so leaf roles deny it by name. */
export const SIBLING_DENIED_TOOLS = ['interrupt_agent'] as const

/** Residual surface; no allow list: family rows define the tool surface. */
export interface RoleSurface {
  /** Sibling names welded into a needed row that this persona must not have. */
  readonly denySiblings?: readonly string[]
}

/** Leaf roles need `send_message`, so they inherit the welded `interrupt_agent`; specialist
 * mounts no control row. Tolerant per-name deny records misses without failing open. */
export const ROLE_TOOL_SURFACES: Record<RolePresetId, RoleSurface> = {
  [ROLE_PRESET_IDS.collector]: { denySiblings: SIBLING_DENIED_TOOLS },
  [ROLE_PRESET_IDS.junior]: { denySiblings: SIBLING_DENIED_TOOLS },
  [ROLE_PRESET_IDS.retriever]: { denySiblings: SIBLING_DENIED_TOOLS },
  [ROLE_PRESET_IDS.specialist]: {},
  [ROLE_PRESET_IDS.analyst]: { denySiblings: SIBLING_DENIED_TOOLS },
}

interface ToolRestriction { allow?: readonly string[]; deny?: readonly string[] }
interface RestrictedToolRuntime {
  restrict?(filter: ToolRestriction): unknown
}

/** Role preset id only, undefined for root and other presets; failure means "do not converge". */
export function rolePresetIdOf(ctx: PolicyContext, agent: AgentLike | undefined): RolePresetId | undefined {
  const claim = readPresetClaim(ctx, agent).claim
  return claim !== undefined && ROLE_PRESET_ID_LIST.includes(claim) ? claim as RolePresetId : undefined
}

export interface RolePolicyProbe extends Omit<RolePolicyResult, 'outcome'> {
  agentId: string | undefined
  presetId: string
  /** True = manually opened root with a role preset, false = delegated child; the paths converge differently. */
  root: boolean
  /** Created-time restrict result, or a call-level guard denial. */
  outcome: 'restricted' | 'unavailable' | 'guard-denied'
}

export interface RolePolicyResult {
  outcome: 'restricted' | 'unavailable'
  denied: string[]
  /** Names invisible here and skipped harmlessly (their row is not mounted). */
  failed: string[]
}

const probes: RolePolicyProbe[] = []
const MAX_PROBES = 12
/** Session ids already converged: `apply()` runs once per mounted role preset. */
const handled = new Set<string>()
/** One listener set when both host policy and this plugin mount. */
const installedRoots = new WeakSet<object>()
/** Call-level guard installs independently of the listener. */
const installedGuardRoots = new WeakSet<object>()

interface GuardRuntime {
  guard?(guard: (execution: GuardedExecution) => string | undefined): unknown
}

export function rolePolicyProbes(): RolePolicyProbe[] {
  return probes.map((probe) => ({ ...probe, denied: [...probe.denied], failed: [...probe.failed] }))
}

/** Test-only: clears records and the dedupe table. */
export function resetRolePolicyProbes(): void {
  probes.length = 0
  handled.clear()
}

/** Tolerant per-name deny: invisible names are recorded, never thrown; called on agent creation. */
export function restrictRoleAgentTools(agent: AgentLike | undefined, surface: RoleSurface): RolePolicyResult {
  const denied: string[] = []
  const failed: string[] = []
  let tools: RestrictedToolRuntime | undefined
  try {
    tools = agent?.ctx?.tools as RestrictedToolRuntime | undefined
  } catch {
    return { outcome: 'unavailable', denied, failed }
  }
  if (tools === undefined || typeof tools.restrict !== 'function') {
    return { outcome: 'unavailable', denied, failed }
  }
  for (const name of surface.denySiblings ?? []) {
    try {
      tools.restrict({ deny: [name] })
      denied.push(name)
    } catch {
      failed.push(name)
    }
  }
  return { outcome: 'restricted', denied, failed }
}

/** Call-level residual guard: created-time restrict misses manually opened role modes, so
 * read identity per call. Fail open unless a role preset is confirmed. */
export function roleSiblingGuardReasonFor(ctx: PolicyContext): (exec: GuardedExecution | undefined) => string | undefined {
  return (exec) => {
    const name = exec?.name
    if (typeof name !== 'string' || !SIBLING_DENIED_TOOLS.includes(name as (typeof SIBLING_DENIED_TOOLS)[number])) return undefined
    const claim = readPresetClaim(ctx, exec?.agent)
    if (claim.registryMissing || claim.failed || claim.claim === undefined) return undefined
    if (!ROLE_PRESET_ID_LIST.includes(claim.claim)) return undefined
    return `${name} 不对人设 ${claim.claim} 开放：叶子角色只回传自己的结果，打断别的会话归主 Agent 决定。`
      + '需要别的 Agent 停下来，用 send_message 回告主 Agent；不要自己换工具硬做。'
  }
}

/** Installs the sibling guard globally once. */
export function registerRoleSiblingGuard(ctx: PolicyContext): void {
  const ref = ctx.root ?? ctx
  if (installedGuardRoots.has(ref)) return
  installedGuardRoots.add(ref)
  const reason = roleSiblingGuardReasonFor(ctx)
  const install = (): (() => void) | undefined => {
    let tools: GuardRuntime | undefined
    try {
      tools = (ctx.get?.('tools') ?? ctx.tools) as GuardRuntime | undefined
    } catch {
      return undefined
    }
    if (tools === undefined || typeof tools.guard !== 'function') {
      ctx.logger?.warn('capital-generation: 角色兄弟名字的调用级闸门没装上（guard 面不可用）：手开角色会话仍可 interrupt 兄弟')
      return undefined
    }
    try {
      // Same probe channel as restrict: one readout for both planes.
      const dispose = tools.guard((execution: GuardedExecution) => {
        const denied = reason(execution)
        if (denied !== undefined) recordGuardDecision(ctx, execution, String(execution?.name))
        return denied
      })
      return typeof dispose === 'function' ? (dispose as () => void) : undefined
    } catch {
      return undefined
    }
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const dispose = install() ?? (() => {})
      return () => {
        try { dispose() } finally { installedGuardRoots.delete(ref) }
      }
    }, 'capital-generation.role-sibling-guard()')
    return
  }
  install()
}

/** Dedupes by session id: `apply()` runs once per mounted role preset and duplicate probes would flood the readout. */
export function registerRoleToolPolicy(ctx: PolicyContext): void {
  const listenCtx = ctx.root ?? ctx
  if (typeof listenCtx.on !== 'function') return
  // Host policy and the monolith may both call this; one listener set per root.
  if (installedRoots.has(listenCtx)) return
  installedRoots.add(listenCtx)
  const install = () => {
    const stopCreated = listenCtx.on?.('agent/created', (payload: { agent?: AgentLike }) => {
      try {
        const agent = payload?.agent
        const id = typeof agent?.session?.id === 'string' ? agent.session.id : undefined
        if (id !== undefined && handled.has(id)) return
        const presetId = rolePresetIdOf(ctx, agent)
        if (presetId === undefined) return
        const surface = ROLE_TOOL_SURFACES[presetId]
        if (surface.denySiblings === undefined || surface.denySiblings.length === 0) {
          if (id !== undefined) handled.add(id)
          return
        }
        const result = restrictRoleAgentTools(agent, surface)
        if (id !== undefined) handled.add(id)
        probes.push({ agentId: id, root: isRootAgent(agent), presetId, ...result })
        if (probes.length > MAX_PROBES) probes.shift()
        if (result.outcome === 'unavailable') {
          ctx.logger?.warn(`capital-generation: 角色 ${presetId} 的兄弟名字收敛没装上（restrict 面不可用）：该 child 仍看得见 ${SIBLING_DENIED_TOOLS.join(' / ')}`)
        }
      } catch (error) {
        ctx.logger?.warn(`capital-generation: 角色工具面收敛异常：${error instanceof Error ? error.message : String(error)}`)
      }
    })
    const stopDisposed = listenCtx.on?.('agent/disposed', (payload: { agent?: AgentLike }) => {
      const id = typeof payload?.agent?.session?.id === 'string' ? payload.agent.session.id : undefined
      if (id !== undefined) handled.delete(id)
    })
    return () => {
      try { if (typeof stopCreated === 'function') stopCreated() } catch { /* ignore */ }
      try { if (typeof stopDisposed === 'function') stopDisposed() } catch { /* ignore */ }
    }
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const dispose = install()
      return () => {
        try { if (typeof dispose === 'function') dispose() } finally { installedRoots.delete(listenCtx) }
      }
    }, 'capital-generation.role-tool-policy()')
    return
  }
  install()
}
