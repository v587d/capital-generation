/**
 * Root Agent tool convergence on the root's own scope: preset-level deny would also hit
 * children. Listeners must live on `ctx.root`; tagged standing-scope listeners miss agent/created.
 */

import { CAPITAL_PRESET_IDS, ROOT_PRESET_ID } from '../preset-ids.js'
import { readPresetClaim } from '../preset-claim.js'

/** Outbound tools (search 2 + wind 2 + named sources 9); `ocr` is excluded because only its url form is restricted. */
export const RETRIEVAL_DENIED_TOOLS = [
  'anysearch_search', 'web_retriever_fetch',
  'wind_docs_announcements', 'wind_docs_news',
  'cls_telegraph', 'wscn_lives', 'cninfo_irm', 'sseinfo_qa',
  'eastmoney_724', 'eastmoney_stock_news', 'eastmoney_reports', 'sina_reports', 'ths_eps_forecast',
] as const

export const OCR_TOOL_NAME = 'ocr'

/** Name-level deny cannot express the form distinction; this is a call-level guard. */
export const OCR_ROOT_URL_DENIED
  = 'ocr 的 url 形态只对被委派的 web_retriever 开放：外部 PDF 链接请委派 subagent_web_retriever 解析。'
    + '工作目录里的本地文档（file）与已解析产物（doc_id + pages/query）可以直接调用。'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function ocrUrlFormRequested(exec: GuardedExecution | undefined): boolean {
  if (exec?.name !== OCR_TOOL_NAME) return false
  const args = isRecord(exec.arguments) ? exec.arguments : undefined
  return args !== undefined && typeof args.url === 'string' && args.url.length > 0
}

/** Read per call because a created-time gate misses manually opened modes; fail open unless a confirmed Capital root. */
export function ocrFormGuardReasonFor(ctx: PolicyContext): (exec: GuardedExecution | undefined) => string | undefined {
  return (exec) => {
    if (!ocrUrlFormRequested(exec)) return undefined
    const claim = readPresetClaim(ctx, exec?.agent)
    // Global guard sees every process call; only a confirmed Capital root is blocked.
    if (claim.registryMissing || claim.failed || claim.claim !== CAPITAL_PRESET_ID) return undefined
    return OCR_ROOT_URL_DENIED
  }
}

/** Mounted as a platform pair; recognize both everywhere or the other platform's gate is dead. */
export const SHELL_TOOL_NAMES = ['bash', 'pwsh'] as const

export const ROOT_AGENT_DENIED_TOOLS = [
  /** Charts only flow through junior -> visualization_specialist. */
  'render_chart',
  'prepare_chart_source',
  ...RETRIEVAL_DENIED_TOOLS,
  /** Not a boundary (the host global layer registers them); the call-level fs guard is the real block. */
  'write',
  'edit',
] as const
// ⛔ `run_code` belongs nowhere in this list: it is a reserved PTC transport name, so `restrict()`
// throws on it. The root stays native; deployment-level `dsh-tools.mode` must not be set to ptc.

export const CAPITAL_PRESET_ID = ROOT_PRESET_ID
interface ToolRestriction { allow?: readonly string[]; deny?: readonly string[] }
/** `guard` only returns a deny string, so listener order can never turn a deny into an allow. */
interface RestrictedToolRuntime {
  restrict?(filter: ToolRestriction): unknown
  guard?(guard: (execution: GuardedExecution) => string | undefined): unknown
}

export interface GuardedExecution {
  readonly name?: string
  readonly arguments?: unknown
  readonly agent?: AgentLike
}

export interface AgentLike {
  readonly session?: { readonly id?: string; readonly header?: { readonly parentSession?: string } }
  readonly ctx?: { readonly tools?: RestrictedToolRuntime; readonly [key: string]: unknown }
}

export interface PolicyContext {
  on?(event: string, listener: (payload: { agent?: AgentLike }) => void): unknown
  effect?(callback: () => unknown, label?: string): unknown
  get?(name: string): unknown
  logger?: { warn(message: string): void }
  readonly root?: PolicyContext
  readonly [key: string]: unknown
}

export type RootToolPolicyOutcome = 'restricted' | 'skipped' | 'unavailable'
export function isRootAgent(agent: AgentLike | undefined): boolean {
  if (agent?.session === undefined) return false
  const parent = agent.session.header?.parentSession
  return typeof parent !== 'string' || parent.length === 0
}

export function agentSessionId(agent: AgentLike | undefined): string | undefined {
  const id = agent?.session?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

export function isCapitalAgent(ctx: PolicyContext, agent: AgentLike | undefined): boolean {
  const claim = readPresetClaim(ctx, agent)
  // Registry missing: conservative claim, because per-name restrict rejects unknown names harmlessly.
  if (claim.registryMissing) return true
  return claim.claim === CAPITAL_PRESET_ID
}

/** Allows any Capital preset; guards for role children must use this, not the root id. */
export function isCapitalPresetAgent(ctx: PolicyContext, agent: AgentLike | undefined): boolean {
  const claim = readPresetClaim(ctx, agent)
  if (claim.registryMissing) return true
  return claim.claim !== undefined && CAPITAL_PRESET_IDS.includes(claim.claim)
}

/** Diagnostic record surfaced via `dc_status`: silent convergence exits leave no other trace. */
export interface RootPolicyProbe {
  agentId: string | undefined
  root: boolean
  presetId: string
  outcome: 'pending' | 'restricted' | 'unavailable' | 'skipped' | 'not-capital' | 'guard-denied'
  denied: string[]
  /** Non-empty means `restrict()` threw for those names and convergence was partial. */
  failed: string[]
}

const probes: RootPolicyProbe[] = []
const MAX_PROBES = 8
const installedPolicyRoots = new WeakSet<object>()
const installedFsGuardRoots = new WeakSet<object>()
const installedOcrGuardRoots = new WeakSet<object>()

/** Shares the convergence channel so opened-mode and call-level failures line up. */
export function recordGuardDecision(ctx: PolicyContext, exec: GuardedExecution | undefined, toolName: string): void {
  const agent = exec?.agent
  probes.push({
    agentId: agentSessionId(agent),
    root: isRootAgent(agent),
    presetId: presetIdOf(ctx, agent),
    outcome: 'guard-denied',
    denied: [toolName],
    failed: [],
  })
  if (probes.length > MAX_PROBES) probes.shift()
}

export function rootPolicyProbes(): RootPolicyProbe[] {
  return probes.map((probe) => ({ ...probe, denied: [...probe.denied], failed: [...probe.failed] }))
}

export function resetRootPolicyProbes(): void {
  probes.length = 0
}

function presetIdOf(ctx: PolicyContext, agent: AgentLike | undefined): string {
  const claim = readPresetClaim(ctx, agent)
  if (claim.registryMissing) return 'no-registry'
  if (claim.failed) return 'error'
  return claim.claim ?? 'undefined'
}

/** Per-name deny on the root only; name-not-visible throws become harmless skips. Never throws: called on agent creation. */
export function restrictRootAgentTools(agent: AgentLike | undefined, record?: { denied: string[]; failed: string[] }): RootToolPolicyOutcome {
  if (!isRootAgent(agent)) return 'skipped'
  let tools: RestrictedToolRuntime | undefined
  try {
    tools = agent?.ctx?.tools
  } catch {
    return 'unavailable'
  }
  if (tools === undefined || typeof tools.restrict !== 'function') return 'unavailable'
  for (const name of ROOT_AGENT_DENIED_TOOLS) {
    try {
      tools.restrict({ deny: [name] })
      record?.denied.push(name)
    } catch {
      record?.failed.push(name)
    }
  }
  return 'restricted'
}

/** Install globally once; created-time identity misses manually opened modes. */
export function registerRootOcrGuard(ctx: PolicyContext): void {
  const ref = ctx.root ?? ctx
  if (installedOcrGuardRoots.has(ref)) return
  installedOcrGuardRoots.add(ref)
  const reason = ocrFormGuardReasonFor(ctx)
  const install = (): (() => void) | undefined => {
    let tools: RestrictedToolRuntime | undefined
    try {
      // `get` before property access: property access throws on fibers without inject.
      tools = (ctx.get?.('tools') ?? ctx.tools) as RestrictedToolRuntime | undefined
    } catch {
      return undefined
    }
    if (tools === undefined || typeof tools.guard !== 'function') {
      ctx.logger?.warn('capital-generation: `ocr` 的 url 形态闸门没装上（guard 面不可用）：主模式人设仍可自己抓外部 PDF')
      return undefined
    }
    try {
      const dispose = tools.guard((execution: GuardedExecution) => {
        const denied = reason(execution)
        if (denied !== undefined) recordGuardDecision(ctx, execution, OCR_TOOL_NAME)
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
        try { dispose() } finally { installedOcrGuardRoots.delete(ref) }
      }
    }, 'capital-generation.ocr-form-guard()')
    return
  }
  install()
}

export const FS_WRITE_TOOL_NAMES = ['write', 'edit'] as const

const fsWriteNames: ReadonlySet<string> = new Set(FS_WRITE_TOOL_NAMES)

/** Points at the allowed paths (read, tool returns) instead of leaving the caller stuck. */
export const FS_WRITE_READ_ONLY
  = 'write / edit 不开放（主 Agent 与子会话都不直接写文件）：读文件用 read；'
    + '数据与产物走工具回传（DatasetRef / chart_ref / send_message），需要落盘的由工具实现完成。'
    + '若你判断确需写文件，用 send_message 把 data_gap 与已有证据发回主 Agent 协调。'

/** Global call-level fs guard: the host global layer registers write/edit, so per-name restrict
 * only shrinks children. Fail open unless a Capital preset is confirmed. */
export function fsWriteGuardReasonFor(ctx: PolicyContext): (execution: GuardedExecution) => string | undefined {
  return (execution) => {
    const name = execution?.name
    if (typeof name !== 'string' || !fsWriteNames.has(name)) return undefined
    const claim = readPresetClaim(ctx, execution.agent)
    // One wrong denial would remove another preset's write access for the whole process.
    if (claim.registryMissing || claim.failed || claim.claim === undefined) return undefined
    if (!CAPITAL_PRESET_IDS.includes(claim.claim)) return undefined
    return FS_WRITE_READ_ONLY
  }
}

export function registerFsWriteGuard(ctx: PolicyContext): void {
  const ref = ctx.root ?? ctx
  if (installedFsGuardRoots.has(ref)) return
  installedFsGuardRoots.add(ref)
  const reason = fsWriteGuardReasonFor(ctx)
  const install = (): (() => void) | undefined => {
    let tools: RestrictedToolRuntime | undefined
    try {
      const viaGet = typeof ctx.get === 'function' ? ctx.get('tools') : undefined
      const candidate = viaGet !== undefined ? viaGet : ctx.tools
      tools = candidate as RestrictedToolRuntime | undefined
    } catch {
      return undefined
    }
    if (tools === undefined || typeof tools.guard !== 'function') {
      ctx.logger?.warn('capital-generation: fs 写口闸门没装上（guard 面不可用）：`write` / `edit` 只剩 `tool-fs` 那行的行级开关在拦')
      return undefined
    }
    try {
      const dispose = tools.guard((execution: GuardedExecution) => {
        const denied = reason(execution)
        // Desktop persists no host logs; a guard block otherwise looks like "no write tool".
        if (denied !== undefined && typeof execution?.name === 'string' && fsWriteNames.has(execution.name)) {
          recordGuardDecision(ctx, execution, execution.name)
        }
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
        try { dispose() } finally { installedFsGuardRoots.delete(ref) }
      }
    }, 'capital-generation.fs-write-guard()')
    return
  }
  install()
}

export interface RootToolPolicyOptions {
  /** Host policy passes false: family rows already close the surface, so record only. */
  deny?: boolean
}

export function registerRootToolPolicy(ctx: PolicyContext, options: RootToolPolicyOptions = {}): void {
  const listenCtx = ctx.root ?? ctx
  if (typeof listenCtx.on !== 'function') return
  if (installedPolicyRoots.has(listenCtx)) return
  installedPolicyRoots.add(listenCtx)
  const install = () => {
    const stopCreated = listenCtx.on?.('agent/created', (payload: { agent?: AgentLike }) => {
      try {
        const agent = payload?.agent
        const isRoot = isRootAgent(agent)
        // Root only: children always have a parentSession and would crowd the 8-entry window.
        const probe: RootPolicyProbe | undefined = isRoot
          ? { agentId: agentSessionId(agent), root: true, presetId: presetIdOf(ctx, agent), outcome: 'pending', denied: [], failed: [] }
          : undefined
        if (probe !== undefined) {
          probes.push(probe)
          if (probes.length > MAX_PROBES) probes.shift()
        }
        if (!isCapitalAgent(ctx, agent)) {
          if (probe !== undefined) probe.outcome = 'not-capital'
          return
        }
        if (options.deny === false) {
          // Composition already removed data/web/chart; per-name deny would only add `failed` noise.
          if (probe !== undefined) probe.outcome = 'skipped'
        } else {
          const outcome = restrictRootAgentTools(agent, probe)
          if (probe !== undefined) probe.outcome = outcome
          if (outcome === 'unavailable') {
            ctx.logger?.warn(`capital-generation: 根 Agent 工具收敛未生效（${outcome}）：主 Agent 仍会看到 ${ROOT_AGENT_DENIED_TOOLS.join(' / ')}`)
          }
        }
      } catch (error) {
        ctx.logger?.warn(`capital-generation: 根 Agent 工具收敛异常：${error instanceof Error ? error.message : String(error)}`)
      }
    })
    return () => {
      try { if (typeof stopCreated === 'function') stopCreated() } catch { /* ignore */ }
    }
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const dispose = install()
      return () => {
        try { if (typeof dispose === 'function') dispose() } finally { installedPolicyRoots.delete(listenCtx) }
      }
    }, 'capital-generation.root-tool-policy()')
    return
  }
  install()
}
