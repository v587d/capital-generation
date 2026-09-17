/**
 * 图表 → 对话流的宿主侧事件通道。
 *
 * 问题：图表由 `visualization_specialist`（主 Agent 的**孙** Agent）生成，它的 tool call
 * 落在自己的会话里；用户在客户端看的是主会话，子会话的事件不会流过来。
 *
 * 做法（与官方 `present` / `deliverables/presented` 完全同形）：`render_chart` 成功后，
 * 宿主往**用户正在看的那条会话**追加一条小型非 surface 事件
 * `capital/chart-rendered`；客户端 conversation definition 把它折进 turn data，
 * `conversation.chat.turnTail` 的 selector 读它并渲染卡片。
 *
 * ⚠️ 回合归属（实测教训 2026-09-17）：DSH 的 turn-tail 是**按回合**渲染的，卡片只会出现在
 * 它所属回合的收尾位置。而主 Agent 在等子 Agent 时会**先结束自己的回合**，于是出图往往发生在
 * 两个回合之间——此时 `turnBoundary.lastTurn` 指向那个**已经结束**的回合，照抄它会把卡片挂到
 * 上一轮（表现：卡片出现在对话中段、或者干脆不在最终答复下方）。因此：
 *  - 有回合打开（`openTurnStartSeq` 是数字）→ 立即写入该回合；
 *  - 没有回合打开 → 先寄存，等 owner 的**下一个 `turn/start`** 再写入（那正是会消费这份
 *    子 Agent 结果、写下最终答复的回合）。
 * 寄存的冲刷必须延到微任务：`session/event` 观察者在 `Session.append` 的 appending 窗口内同步执行，
 * 在那里再次 append 会被 "session append cannot reenter" 拒绝。
 *
 * 为什么这不"污染 transcripts"：
 *  - `Session.append` 的事件若不在 surface 事件表里，`deriveEventMessage()` 返回 null，
 *    因此它**永不进入** `deriveMessages()`（模型看到的消息历史）；
 *  - payload 只有元数据（chart_id / title / 相对 html_path / chart_url），
 *    没有 rows、series、HTML、绝对路径；
 *  - 客户端从既有 `/capital-charts/<chart_id>.json` 旁路取序列，不进任何 Agent 上下文。
 *
 * 容错：`sessions` / `sessionProjections` 任一不可用、或 append 抛错，都只告警并跳过——
 * 出图本身绝不因此失败（文件已落盘、回执照样给 html_path）。
 */
import { chartSessionScopeId } from './artifact-ref.js'
import type { SessionLike } from '../data-collector/store.js'

/** 客户端 conversation definition 监听的事件名（`<domain>/<past-participle>`，与 deliverables 同风格）。 */
export const CHART_RENDERED_EVENT = 'capital/chart-rendered'
/** 同一 (session, turn) 的事件上限：防模型循环，超出只告警。 */
export const MAX_CHARTS_PER_TURN = 8
/** 向上找根会话的最大跳数（main → data_junior → specialist 只有一跳，留余量）。 */
export const MAX_OWNER_HOPS = 4
/** warnings 只作展示：最多 3 条、每条 200 字符。 */
export const MAX_EVENT_WARNINGS = 3
export const MAX_EVENT_WARNING_CHARS = 200

interface AppendableSession extends SessionLike {
  append(type: string, data: unknown): unknown
}

interface SessionsService {
  get(id: string): unknown
}

interface ProjectionsService {
  stateOf(session: unknown, key: string): unknown
}

/** 宿主 ctx 里本模块用到的部分；focused 结构类型便于单测注入假实现。 */
export interface ChartEventContext {
  get(name: string): unknown
  /** 监听会话事件（`turn/start` 冲刷寄存的图表）。必须注册在未打 scope 标签的 root context 上。 */
  on?(event: string, listener: (...args: unknown[]) => void): unknown
  effect?(callback: () => unknown, label?: string): unknown
  /** Root context（未打标签）；拿不到时退回自身（宿主平面行即未打标签）。 */
  readonly root?: ChartEventContext
  logger?: { warn(message: string): void }
}

export interface ChartTurnEventInput {
  /** 出图时 chart_ref 的 owner scope（与 ChartArtifactRegistry 同一套语义）。 */
  ownerSessionId: string
  chart_id: string
  chart_ref: string
  title: string
  kind: string
  axis: 'time' | 'index'
  points: number
  chart_url: string | null
  html_path: string
  source_label: string | null
  captured_at: number | null
  task_id: string | null
  warnings: readonly unknown[]
}

export interface ChartEventPublisher {
  /**
   * 记录一张图。
   * @returns 是否已受理：立即写入、或已寄存等下一个回合都算受理。
   */
  publish(input: ChartTurnEventInput): boolean
  /** 诊断：还没拿到回合、寄存中的图表数。 */
  pendingCount?(ownerSessionId?: string): number
}

function isAppendableSession(value: unknown): value is AppendableSession {
  return Boolean(value)
    && typeof (value as { append?: unknown }).append === 'function'
    && typeof (value as { id?: unknown }).id === 'string'
}

function parentSessionOf(session: AppendableSession): string | undefined {
  const parent = session.header?.parentSession
  return typeof parent === 'string' && parent.length > 0 ? parent : undefined
}

/**
 * 从 owner scope 出发向上走到根会话：用户看的是根会话的对话流，卡片必须挂在它上面。
 * 找不到（会话已回收）时返回 undefined，调用方静默跳过。
 */
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

/** 展示用 warnings：只留字符串、截断、限量。 */
export function sanitizeEventWarnings(warnings: readonly unknown[]): string[] {
  const result: string[] = []
  for (const item of warnings) {
    if (typeof item !== 'string' || item.length === 0) continue
    result.push(item.length > MAX_EVENT_WARNING_CHARS ? item.slice(0, MAX_EVENT_WARNING_CHARS) : item)
    if (result.length >= MAX_EVENT_WARNINGS) break
  }
  return result
}

/** 事件的 JSON 载荷：全部是基本类型，不含 rows / series / 绝对路径。 */
export function buildChartEventPayload(input: ChartTurnEventInput, turn: number): Record<string, unknown> {
  return {
    turn,
    chart_id: input.chart_id,
    chart_ref: input.chart_ref,
    title: input.title,
    kind: input.kind,
    axis: input.axis,
    points: input.points,
    chart_url: input.chart_url,
    html_path: input.html_path,
    source_label: input.source_label,
    captured_at: input.captured_at,
    task_id: input.task_id,
    warnings: sanitizeEventWarnings(input.warnings),
  }
}

/**
 * 惰性构造发布器：`sessions` / `sessionProjections` 缺一不可（都是宿主平面服务，
 * 在 preset scope 里正常可解析；缺失表示宿主组合不完整，此时静默降级）。
 */
export function createChartEventPublisher(ctx: ChartEventContext): ChartEventPublisher | undefined {
  const sessions = ctx.get('sessions') as SessionsService | undefined
  if (sessions === undefined || typeof sessions.get !== 'function') return undefined
  const projections = ctx.get('sessionProjections') as ProjectionsService | undefined
  if (projections === undefined || typeof projections.stateOf !== 'function') return undefined

  /** ownerSessionId → 还没拿到回合的图表（等 owner 的下一个 turn/start）。 */
  const pending = new Map<string, ChartTurnEventInput[]>()
  const perTurn = new Map<string, number>()
  let warned = false
  const warn = (message: string): void => {
    if (warned) return
    warned = true
    ctx.logger?.warn(`capital-generation: ${message}`)
  }

  const boundaryOf = (owner: AppendableSession): { openTurnStartSeq?: unknown; lastTurn?: unknown } | undefined => {
    try {
      return projections.stateOf(owner, 'turnBoundary') as { openTurnStartSeq?: unknown; lastTurn?: unknown } | undefined
    } catch {
      return undefined
    }
  }

  /** 真正写一条事件；返回是否写入。 */
  const append = (owner: AppendableSession, turn: number, input: ChartTurnEventInput): boolean => {
    const key = `${owner.id}:${turn}`
    const used = perTurn.get(key) ?? 0
    if (used >= MAX_CHARTS_PER_TURN) {
      warn(`图表对话流事件跳过：turn ${turn} 已达到 ${MAX_CHARTS_PER_TURN} 张上限`)
      return false
    }
    try {
      owner.append(CHART_RENDERED_EVENT, buildChartEventPayload(input, turn))
    } catch (error) {
      warn(`图表对话流事件写入失败（图表已落盘）：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    perTurn.set(key, used + 1)
    return true
  }

  /** 把寄存的图表写进刚打开的回合。 */
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

  const listenCtx = ctx.root ?? ctx
  if (typeof listenCtx.on === 'function') {
    const install = () => listenCtx.on?.('session/event', (...args: unknown[]) => {
      try {
        const session = args[0] as { id?: unknown } | undefined
        const event = args[1] as { type?: unknown; data?: { turn?: unknown } } | undefined
        if (event?.type !== 'turn/start') return
        const sessionId = typeof session?.id === 'string' ? session.id : undefined
        const turn = event.data?.turn
        if (sessionId === undefined || !pending.has(sessionId)) return
        if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 1) return
        // 不能在 appending 窗口内重入 append，延到微任务。
        queueMicrotask(() => {
          try {
            flush(sessionId, turn)
          } catch (error) {
            warn(`图表对话流事件冲刷失败：${error instanceof Error ? error.message : String(error)}`)
          }
        })
      } catch {
        // 事件观察者永不抛出。
      }
    })
    const disposeListener = install()
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        if (typeof disposeListener === 'function') disposeListener()
      }, 'capital-generation.chart-turn-events()')
    }
  }

  return {
    publish(input) {
      const owner = resolveOwnerSession(sessions, input.ownerSessionId)
      if (owner === undefined) {
        warn(`图表对话流事件跳过：找不到 owner 会话 ${input.ownerSessionId}（图表已落盘，走 html_path 降级）`)
        return false
      }
      const boundary = boundaryOf(owner)
      const openSeq = boundary?.openTurnStartSeq
      const lastTurn = boundary?.lastTurn
      if (typeof openSeq !== 'number') {
        // 回合之间出图：寄存，等 owner 的下一个 turn/start（那才是写最终答复的回合）。
        const queued = pending.get(input.ownerSessionId) ?? []
        if (queued.length >= MAX_CHARTS_PER_TURN) {
          warn(`图表对话流事件跳过：${input.ownerSessionId} 已寄存 ${MAX_CHARTS_PER_TURN} 张，等不到新回合`)
          return false
        }
        queued.push(input)
        pending.set(input.ownerSessionId, queued)
        return true
      }
      // turn 0 / 非法值表示该会话还没真正开过回合。
      if (typeof lastTurn !== 'number' || !Number.isSafeInteger(lastTurn) || lastTurn < 1) {
        warn('图表对话流事件跳过：owner 会话没有打开中的 turn')
        return false
      }
      return append(owner, lastTurn, input)
    },

    /** 诊断/测试用：当前寄存未冲刷的图表数。 */
    pendingCount(ownerSessionId?: string): number {
      if (ownerSessionId !== undefined) return pending.get(ownerSessionId)?.length ?? 0
      let total = 0
      for (const list of pending.values()) total += list.length
      return total
    },
  } as ChartEventPublisher & { pendingCount(ownerSessionId?: string): number }
}

/** 出图时的 owner scope：与 chart_ref 同源（specialist 出图时正好是主会话）。 */
export function chartEventOwnerSessionId(session: SessionLike, sourceSession?: SessionLike): string {
  return chartSessionScopeId(sourceSession ?? session)
}
