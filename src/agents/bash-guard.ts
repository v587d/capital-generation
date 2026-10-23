/** Execution guard for bash/pwsh/run_code: blocks only doomed sandbox escalation; command/program
 * content is never inspected (the sandbox blocks writes, not reads/network). Delegated approvals
 * are fixed to `never`, so escalation auto-rejects with a misleading "user rejected"; block early
 * instead. Root escalation still uses ask; do not pin delegated sessions read-only
 * (`store.writeContext` needs workspace-write). `tools.guard` is monotonic; pre-execute is a
 * rewritable waterfall. */

import { agentSessionId, isCapitalPresetAgent, SHELL_TOOL_NAMES, type AgentLike, type GuardedExecution, type PolicyContext } from './root-tool-policy.js'

/** Both shell names on every platform plus the PTC transport: the preset mounts one shell pair for
 * the root and `run_code` for data_junior, so matching only the local platform kills the Windows gate. */
export const EXECUTION_ESCALATION_TOOL_NAMES = [...SHELL_TOOL_NAMES, 'run_code'] as const
const executionToolNames: ReadonlySet<string> = new Set(EXECUTION_ESCALATION_TOOL_NAMES)
/** One listener set per root context: host policy and legacy call sites install once. */
const installedRoots = new WeakSet<object>()

export type BashGuardExecution = GuardedExecution

/** States that the rejection is the system's, not the user's, and gives the recovery path. */
export const SHELL_ESCALATION_UNREACHABLE
  = '执行工具（bash / pwsh / run_code）的沙箱升级只有主 Agent 的会话能拿到用户审批：被委派的子会话拿不到'
    + '（框架把委派会话的审批策略固定为 never，不会去问用户），当前调用方也不是可确认的主 Agent 会话。'
    + '不要重试升级：缺数值用 describe_dataset / query_dataset，缺数据用 send_message 发 data_gap 回主 Agent。'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads identity plus `sandbox_permissions`/`justification`, never `command`/`code`; unknown identity fails closed. */
export function bashGuardReason(exec: BashGuardExecution | undefined): string | undefined {
  if (exec === undefined || typeof exec.name !== 'string' || !executionToolNames.has(exec.name)) return undefined
  const args = isRecord(exec.arguments) ? exec.arguments : undefined
  const escalated = args !== undefined && (args.sandbox_permissions !== undefined || args.justification !== undefined)
  if (!escalated) return undefined
  const parent = exec.agent?.session?.header?.parentSession
  const knownRoot = exec.agent?.session !== undefined && (typeof parent !== 'string' || parent.length === 0)
  return knownRoot ? undefined : SHELL_ESCALATION_UNREACHABLE
}

interface AgentEventPayload { readonly agent?: AgentLike }

type AgentToolRuntime = NonNullable<NonNullable<AgentLike['ctx']>['tools']>

function installAgentGuard(agent: AgentLike | undefined): (() => void) | undefined {
  let tools: AgentToolRuntime | undefined
  try {
    tools = agent?.ctx?.tools
  } catch {
    return undefined
  }
  if (tools === undefined || typeof tools.guard !== 'function') return undefined
  try {
    const dispose = tools.guard(bashGuardReason)
    return typeof dispose === 'function' ? (dispose as () => void) : undefined
  } catch {
    return undefined
  }
}

/** Installs on every Capital preset agent. Must listen on `ctx.root`: agent/created routes by
 * the agent object, so tagged standing-scope listeners never fire. Failures only warn. */
export function registerBashGuard(ctx: PolicyContext): void {
  const listenCtx = ctx.root ?? ctx
  if (typeof listenCtx.on !== 'function') return
  if (installedRoots.has(listenCtx)) return
  installedRoots.add(listenCtx)
  /** Session id -> disposer; released on agent/disposed to avoid cross-instance leaks. */
  const guards = new Map<string, () => void>()
  const install = () => {
    const stopCreated = listenCtx.on?.('agent/created', (payload: AgentEventPayload) => {
      try {
        const agent = payload?.agent
        if (!isCapitalPresetAgent(ctx, agent)) return
        const dispose = installAgentGuard(agent)
        if (dispose === undefined) {
          ctx.logger?.warn('capital-generation: 执行工具闸门未生效（agent scope 上没有 tools.guard）：沙箱升级拦截只剩 persona 软约束')
          return
        }
        const id = agentSessionId(agent)
        if (id !== undefined) guards.set(id, dispose)
      } catch (error) {
        ctx.logger?.warn(`capital-generation: 执行工具闸门安装异常：${error instanceof Error ? error.message : String(error)}`)
      }
    })
    const stopDisposed = listenCtx.on?.('agent/disposed', (payload: AgentEventPayload) => {
      try {
        const id = agentSessionId(payload?.agent)
        if (id === undefined) return
        const dispose = guards.get(id)
        if (dispose === undefined) return
        guards.delete(id)
        dispose()
      } catch { /* disposal must not break agent teardown */ }
    })
    return () => {
      try { if (typeof stopCreated === 'function') stopCreated() } catch { /* ignore */ }
      try { if (typeof stopDisposed === 'function') stopDisposed() } catch { /* ignore */ }
      for (const dispose of guards.values()) {
        try { dispose() } catch { /* ignore */ }
      }
      guards.clear()
    }
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const dispose = install()
      return () => {
        try { dispose() } finally { installedRoots.delete(listenCtx) }
      }
    }, 'capital-generation.bash-guard()')
    return
  }
  install()
}
