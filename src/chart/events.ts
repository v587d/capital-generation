/**
 * Chart → conversation deliverable channel (first-party events only).
 * Event types are a closed set: anything outside KNOWN_SESSION_EVENT_TYPES without `ignorable`
 * makes the whole log unreadable on cold load, and append() cannot set it.
 * Only `deliverables/presented` is safe; attribution and the owner-keyed queue are the invariants.
 */
import { chartSessionScopeId } from './artifact-ref.js'
import type { SessionLike } from '../data-collector/store.js'

/** Must stay in `KNOWN_SESSION_EVENT_TYPES`; test/chart-turn-events.test.mjs pins it. */
export const CHART_DELIVERABLE_EVENT = 'deliverables/presented'
/** `callId` only needs to be a non-empty string; carries the chart handle for log tracing. */
export const CHART_CALL_ID_PREFIX = 'capital-chart:'
/** Per (session, turn) cap: stops model loops; overflow warns only. */
export const MAX_CHARTS_PER_TURN = 8
/** Root lookup cap (main → data_junior → specialist is one hop, plus headroom). */
export const MAX_OWNER_HOPS = 4

interface AppendableSession extends SessionLike {
  append(type: string, data: unknown): unknown
}

interface SessionsService {
  get(id: string): unknown
}

interface ProjectionsService {
  stateOf(session: unknown, key: string): unknown
}

/** Subset of host ctx used here; structural so tests can inject fakes. */
export interface ChartEventContext {
  get(name: string): unknown
  /** Fallback flush listener; must be registered on the unscoped root context. */
  on?(event: string, listener: (...args: unknown[]) => void): unknown
  /** Preferred flush hook: open-but-closing turn, on the unscoped root ctx (scoped listeners miss
   * child events). A missing disposer must keep the turn/start fallback active. */
  onTurnStopping?(listener: (...args: unknown[]) => void): unknown
  effect?(callback: () => unknown, label?: string): unknown
  /** Unscoped root context; falls back to self when absent. */
  readonly root?: ChartEventContext
  logger?: { warn(message: string): void }
}

export interface ChartTurnEventInput {
  /** chart_ref owner scope (same semantics as ChartArtifactRegistry). */
  ownerSessionId: string
  chart_id: string
  title: string
  /** Workspace-relative self-contained HTML path; the official preview resolves it against session.cwd. */
  html_path: string
}

export interface ChartEventPublisher {
  publish(input: ChartTurnEventInput): boolean
  /** One first-party event carrying every file; the turn cap counts events, not files. */
  publishMany(ownerSessionId: string, inputs: ChartTurnEventInput[]): boolean
  /** Diagnostics: queued charts not yet written. */
  pendingCount?(ownerSessionId?: string): number
  /** Diagnostics: last publish trace, surfaced in receipts / disk so failures are visible without a terminal. */
  lastTrace?(): string
}

let lastPublishTrace = ''

export function chartEventPublishTrace(): string {
  return lastPublishTrace
}

/** Diagnostic switch; off by default to keep terminals and workspaces clean. */
export function chartTraceEnabled(): boolean {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    const value = env?.CAPITAL_CHART_TRACE
    return value === '1' || value === 'true'
  } catch {
    return false
  }
}

function isAppendableSession(value: unknown): value is AppendableSession {
  return Boolean(value)
    && typeof (value as { append?: unknown }).append === 'function'
    && typeof (value as { id?: unknown }).id === 'string'
}

/** `parentSession` alone is seed lineage (a user fork); only `origin: 'subagent'` is delegation. */
function parentSessionOf(session: AppendableSession): string | undefined {
  if (session.header?.origin !== 'subagent') return undefined
  const parent = session.header?.parentSession
  return typeof parent === 'string' && parent.length > 0 ? parent : undefined
}

/** Walk up to the root session — the user watches the root conversation. Missing session → undefined. */
export function resolveOwnerSession(
  sessions: SessionsService,
  ownerSessionId: string,
  maxHops = MAX_OWNER_HOPS,
): AppendableSession | undefined {
  let current: AppendableSession | undefined
  try {
    const first = sessions.get(ownerSessionId)
    current = isAppendableSession(first) ? first : undefined
  } catch {
    return undefined
  }
  if (current === undefined) return undefined
  for (let hop = 0; hop < maxHops; hop += 1) {
    const parentId = parentSessionOf(current)
    if (parentId === undefined) break
    let parent: unknown
    try {
      parent = sessions.get(parentId)
    } catch {
      break
    }
    if (!isAppendableSession(parent)) break
    current = parent
  }
  return current
}

/** Matches `dsh-tool-present` ({ turn, callId, files }); files[].path must be workspace-relative
 * because the official open action resolves it against session.cwd. */
export function buildChartEventPayload(input: ChartTurnEventInput, turn: number): Record<string, unknown> {
  return {
    turn,
    callId: `${CHART_CALL_ID_PREFIX}${input.chart_id}`,
    files: [
      {
        path: input.html_path,
        description: input.title,
      },
    ],
  }
}

/** Process-level, not per publisher (which is rebuilt per render): keyed by owner (root) session
 * id — the id flush events carry — and cleared only by flushing or an explicit reset. */
const pending = new Map<string, ChartTurnEventInput[]>()

/** Safety valve if flushing never fires; metadata only, bounded against unbounded growth. */
export const MAX_PENDING_CHARTS = 64

/** Test-only: clear the shared queue between cases. */
export function resetChartEventPending(): void {
  pending.clear()
}

/** Process-wide singleton (queue, listeners, per-turn counts) keyed by `ctx.root ?? ctx`;
 * never cache a failed build so later-mounting host services can be picked up. */
let cachedPublisher: { ref: unknown; publisher: ChartEventPublisher } | undefined

export function createChartEventPublisher(ctx: ChartEventContext): ChartEventPublisher | undefined {
  const ref = ctx.root ?? ctx
  if (cachedPublisher !== undefined && cachedPublisher.ref === ref) return cachedPublisher.publisher
  const publisher = buildChartEventPublisher(ctx)
  if (publisher !== undefined) cachedPublisher = { ref, publisher }
  return publisher
}

/** Test-only: drop the singleton cache. */
export function resetChartEventPublisher(): void {
  cachedPublisher = undefined
}

function buildChartEventPublisher(ctx: ChartEventContext): ChartEventPublisher | undefined {
  const sessions = ctx.get('sessions') as SessionsService | undefined
  if (sessions === undefined || typeof sessions.get !== 'function') return undefined
  const projections = ctx.get('sessionProjections') as ProjectionsService | undefined
  if (projections === undefined || typeof projections.stateOf !== 'function') return undefined

  const perTurn = new Map<string, number>()
  let warned = false

  /** `ctx.logger` only buffers in memory (no console exporter), so also write stderr; otherwise
   * delivery failures are invisible. */
  const emit = (message: string): void => {
    const line = `capital-generation: ${message}`
    try {
      ctx.logger?.warn(line)
    } catch {
      // Logger unavailable; diagnostics still go to stderr below.
    }
    try {
      const stderr = (globalThis as { process?: { stderr?: { write?: (text: string) => void } } }).process?.stderr
      if (typeof stderr?.write === 'function') stderr.write(`${line}\n`)
    } catch {
      // No process (non-Node host).
    }
  }

  const warn = (message: string): void => {
    if (warned) return
    warned = true
    emit(message)
  }

  /** Progress log only under CAPITAL_CHART_TRACE=1; warnings bypass the switch. */
  const note = (message: string): void => {
    if (!chartTraceEnabled()) return
    emit(message)
  }

  const boundaryOf = (owner: AppendableSession): { openTurnStartSeq?: unknown; lastTurn?: unknown } | undefined => {
    try {
      return projections.stateOf(owner, 'turnBoundary') as { openTurnStartSeq?: unknown; lastTurn?: unknown } | undefined
    } catch {
      return undefined
    }
  }

  const append = (owner: AppendableSession, turn: number, input: ChartTurnEventInput): boolean => {
    const key = `${owner.id}:${turn}`
    const used = perTurn.get(key) ?? 0
    if (used >= MAX_CHARTS_PER_TURN) {
      warn(`图表对话流事件跳过：turn ${turn} 已达到 ${MAX_CHARTS_PER_TURN} 次上限`)
      return false
    }
    try {
      owner.append(CHART_DELIVERABLE_EVENT, buildChartEventPayload(input, turn))
    } catch (error) {
      warn(`图表对话流事件写入失败（图表已落盘）：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    perTurn.set(key, used + 1)
    note(`图表已登记为本轮交付（owner=${owner.id}，turn=${turn}，${input.chart_id}）`)
    return true
  }

  const appendMany = (owner: AppendableSession, turn: number, inputs: ChartTurnEventInput[]): boolean => {
    if (inputs.length === 0) return false
    const key = `${owner.id}:${turn}`
    const used = perTurn.get(key) ?? 0
    if (used >= MAX_CHARTS_PER_TURN) {
      warn(`图表对话流事件跳过：turn ${turn} 已达到 ${MAX_CHARTS_PER_TURN} 次上限`)
      return false
    }
    const first = inputs[0]
    if (first === undefined) return false
    const payload = buildChartEventPayload(first, turn) as { files: Array<{ path: string; description: string }> }
    payload.files = inputs.map((item) => ({ path: item.html_path, description: item.title }))
    try {
      owner.append(CHART_DELIVERABLE_EVENT, payload)
    } catch (error) {
      warn(`图表对话流事件写入失败（图表已落盘）：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    perTurn.set(key, used + 1)
    note(`图表已登记为本轮交付（owner=${owner.id}，turn=${turn}，${inputs.length} 张）`)
    return true
  }

  /** Flush queued charts into a turn; the preferred hook is turn-stopping. */
  const flush = (ownerSessionId: string, turn: number): void => {
    const queued = pending.get(ownerSessionId)
    if (queued === undefined || queued.length === 0) return
    const owner = resolveOwnerSession(sessions, ownerSessionId)
    if (owner === undefined) {
      pending.delete(ownerSessionId)
      return
    }
    pending.delete(ownerSessionId)
    for (const item of queued) append(owner, turn, item)
  }

  /** Only a real registration may flip this; otherwise turn/start fallback stays live. */
  let turnStoppingActive = false

  /** Never append inside the appending window; defer to a microtask. */
  const flushSoon = (ownerSessionId: string, turn: number): void => {
    queueMicrotask(() => {
      try {
        flush(ownerSessionId, turn)
      } catch (error) {
        warn(`图表对话流事件冲刷失败：${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }

  const listenCtx = ctx.root ?? ctx
  if (typeof listenCtx.on === 'function') {
    const sessionEventDispose = listenCtx.on('session/event', (...args: unknown[]) => {
      try {
        const session = args[0] as { id?: unknown } | undefined
        const event = args[1] as { type?: unknown; data?: { turn?: unknown } } | undefined
        if (event?.type !== 'turn/start') return
        // turn/start must not race ahead while turn-stopping is active; it is only the fallback.
        if (turnStoppingActive) return
        const sessionId = typeof session?.id === 'string' ? session.id : undefined
        const turn = event.data?.turn
        if (sessionId === undefined || !pending.has(sessionId)) return
        if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 1) return
        flushSoon(sessionId, turn)
      } catch {
        // Observers never throw.
      }
    })
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        if (typeof sessionEventDispose === 'function') sessionEventDispose()
      }, 'capital-generation.chart-turn-events()')
    }
  }

  if (typeof listenCtx.onTurnStopping === 'function') {
    const disposeTurnStopping = listenCtx.onTurnStopping((...args: unknown[]) => {
      try {
        const payload = args[0] as { agent?: { session?: { id?: unknown } }; turn?: unknown } | undefined
        const sessionId = payload?.agent?.session?.id
        const turn = payload?.turn
        if (typeof sessionId !== 'string' || !pending.has(sessionId)) return
        if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 1) return
        flushSoon(sessionId, turn)
      } catch {
        // Observers must not throw.
      }
    })
    // Only a real disposer means the preferred hook is active; failed registration must leave
    // the turn/start fallback on, or queued charts stay pending forever.
    if (typeof disposeTurnStopping === 'function') turnStoppingActive = true
    else warn('交付行的首选冲刷时机不可用（agent/turn-stopping 注册失败），已退回 turn/start 兜底；落点可能偏早一轮')
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        // Teardown re-enables the fallback so queued charts are not lost.
        turnStoppingActive = false
        if (typeof disposeTurnStopping === 'function') disposeTurnStopping()
      }, 'capital-generation.chart-turn-stopping()')
    }
  }

  return {
    publish(input) {
      const trace: string[] = []
      const owner = resolveOwnerSession(sessions, input.ownerSessionId)
      if (owner === undefined) {
        lastPublishTrace = `owner 未解析：ownerSessionId=${input.ownerSessionId}（sessions.get 拿不到可直接 append 的会话）`
        warn(`图表对话流事件跳过：找不到 owner 会话 ${input.ownerSessionId}（图表已落盘，走 html_path 降级）`)
        return false
      }
      trace.push(`owner=${owner.id}`)
      const boundary = boundaryOf(owner)
      const openSeq = boundary?.openTurnStartSeq
      const lastTurn = boundary?.lastTurn
      if (typeof openSeq !== 'number') {
        // Between turns (main agent closes its turn while waiting on children): queue until
        // the owner's turn closes. Key by owner.id — flush events carry that id; a caller-scope
        // key would never match and strands charts forever.
        const queued = pending.get(owner.id) ?? []
        if (queued.length >= MAX_CHARTS_PER_TURN) {
          warn(`图表对话流事件跳过：${owner.id} 已寄存 ${MAX_CHARTS_PER_TURN} 张，等不到新回合`)
          return false
        }
        // Unreachable in normal flow; bound memory if flushing is broken.
        let total = 0
        for (const list of pending.values()) total += list.length
        if (total >= MAX_PENDING_CHARTS) {
          warn(`图表对话流事件跳过：进程内已寄存 ${total} 张仍未登记（冲刷链路异常），超出 ${MAX_PENDING_CHARTS} 上限`)
          return false
        }
        queued.push(input)
        pending.set(owner.id, queued)
        note(`图表已寄存，待 owner 回合关闭时登记（owner=${owner.id}，lastTurn=${String(lastTurn)}，寄存 ${queued.length} 张）`)
        lastPublishTrace = `${trace.join(' ')} 回合未打开(openTurnStartSeq=${String(openSeq)} lastTurn=${String(lastTurn)}) → 已寄存 ${queued.length} 张，等 turn-stopping/turn-start 冲刷`
        return true
      }
      // turn 0 / invalid means the session never really opened a turn.
      if (typeof lastTurn !== 'number' || !Number.isSafeInteger(lastTurn) || lastTurn < 1) {
        lastPublishTrace = `${trace.join(' ')} 回合号非法(lastTurn=${String(lastTurn)}) → 未写入`
        warn('图表对话流事件跳过：owner 会话没有打开中的 turn')
        return false
      }
      const written = append(owner, lastTurn, input)
      lastPublishTrace = `${trace.join(' ')} 回合打开(turn=${lastTurn}) → ${written ? '已直接登记' : '写入失败'}`
      return written
    },

    publishMany(ownerSessionId, inputs) {
      const owner = resolveOwnerSession(sessions, ownerSessionId)
      if (owner === undefined) {
        lastPublishTrace = `owner 未解析：批量交付缺少可用 owner 会话`
        warn('图表对话流事件跳过：找不到批量交付的 owner 会话（图表已落盘，走 html_path 降级）')
        return false
      }
      const boundary = boundaryOf(owner)
      const turn = boundary?.lastTurn
      if (typeof boundary?.openTurnStartSeq !== 'number' || typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 1) {
        // Between turns: queue each input so the existing flush path still delivers them later.
        const queued = pending.get(owner.id) ?? []
        if (queued.length + inputs.length > MAX_PENDING_CHARTS) {
          lastPublishTrace = `owner=${owner.id} 批量寄存超限（${queued.length}+${inputs.length} > ${MAX_PENDING_CHARTS}）→ 未写入`
          warn('图表对话流事件跳过：进程内寄存已超出上限（冲刷链路异常）')
          return false
        }
        queued.push(...inputs)
        pending.set(owner.id, queued)
        lastPublishTrace = `owner=${owner.id} 回合未打开 → 已寄存 ${inputs.length} 张，等 turn-stopping/turn-start 冲刷`
        return true
      }
      const written = appendMany(owner, turn, inputs)
      lastPublishTrace = `owner=${owner.id} 回合打开(turn=${turn}) → ${written ? `已批量登记 ${inputs.length} 张` : '写入失败'}`
      return written
    },

    /** Diagnostics/tests: queued charts not yet flushed. */
    pendingCount(ownerSessionId?: string): number {
      if (ownerSessionId !== undefined) return pending.get(ownerSessionId)?.length ?? 0
      let total = 0
      for (const list of pending.values()) total += list.length
      return total
    },
  } as ChartEventPublisher & { pendingCount(ownerSessionId?: string): number }
}

/** Owner scope at render time; same source as chart_ref (specialist renders land on the main session). */
export function chartEventOwnerSessionId(session: SessionLike, sourceSession?: SessionLike): string {
  return chartSessionScopeId(sourceSession ?? session)
}
