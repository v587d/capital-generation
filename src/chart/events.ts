/**
 * 图表 → 对话流的宿主侧事件通道（**first-party 口径**）。
 *
 * 问题：图表由 `visualization_specialist`（主 Agent 的**孙** Agent）生成，它的 tool call
 * 落在自己的会话里；用户在客户端看的是主会话，子会话的事件不会流过来。
 *
 * 做法：`render_chart` 成功后，宿主往**用户正在看的那条会话**追加官方
 * `deliverables/presented` 事件（`present` 工具用的同一条通道），把
 * `capital-analysis/charts/<chart_id>/chart.html` 登记为本轮交付物。用户在收尾的
 * 「本轮文件改动 / 交付」行点开该文件，右侧即用官方 document preview 的
 * script-enabled iframe 渲染自包含图表。
 *
 * ⚠️ 为什么**绝不能**再发明自己的事件类型（2026-09-18 事故，实测根因）：
 * 会话日志的事件词汇表是**闭集**——`@deepseek-ai/dsh-session` 的
 * `KNOWN_SESSION_EVENT_TYPES` 由 harness 仓库自己的 `SessionEventMap` 生成，
 * 注释明写 "downstream (out-of-repo) plugin events are outside this list by
 * construction"。读取侧 `validateStoredEvents()` 是 fail-closed 的：
 *
 *   `KNOWN_SESSION_EVENT_TYPES.has(event.type) || event.ignorable === true`
 *
 * 否则抛 `SessionFormatUnsupportedError` 并拒绝解释**整份日志**。而 `Session.append`
 * 的 options 只转发 `sourceEventSeqs` / `surfaceOp`——**调用方无法设置 `ignorable`**
 * （实测 0.1.5-rc.2 与 0.1.6-alpha.2 都没有该选项）。于是自定义事件是"写时静默通过、
 * 冷加载时整份会话打不开"：本仓曾发 `capital/chart-rendered`，导致 6 份会话在重启后
 * 全部 `failed to observe session`。只有 first-party 事件能持久化。
 *
 * ⚠️ 回合归属（实测教训 2026-09-17）：交付行是**按回合**渲染的，只会出现在它所属回合的
 * 收尾位置。而主 Agent 在等子 Agent 时会**先结束自己的回合**，于是出图往往发生在两个回合
 * 之间——此时 `turnBoundary.lastTurn` 指向那个**已经结束**的回合，照抄它会把交付登记到
 * 上一轮。因此：
 *  - 有回合打开（`openTurnStartSeq` 是数字）→ 立即写入该回合；
 *  - 没有回合打开 → 先寄存，等 owner 的**下一个 `turn/start`** 再写入（那正是会消费这份
 *    子 Agent 结果、写下最终答复的回合）。
 * 寄存的冲刷必须延到微任务：`session/event` 观察者在 `Session.append` 的 appending 窗口内同步执行，
 * 在那里再次 append 会被 "session append cannot reenter" 拒绝。
 *
 * 为什么这不"污染 transcripts"：
 *  - `deliverables/presented` 不在 surface 事件表里，`deriveEventMessage()` 返回 null，
 *    因此它**永不进入** `deriveMessages()`（模型看到的消息历史）；
 *  - payload 只有 `turn` / `callId`（`capital-chart:<chart_id>` 句柄）/ `files[]`
 *    （工作区相对 `html_path` + 标题），没有 rows、series、HTML、绝对路径。
 *
 * 容错：`sessions` / `sessionProjections` 任一不可用、或 append 抛错，都只告警并跳过——
 * 出图本身绝不因此失败（文件已落盘、回执照样给 html_path）。
 */
import { chartSessionScopeId } from './artifact-ref.js'
import type { SessionLike } from '../data-collector/store.js'

/**
 * 登记本轮交付物用的官方事件名。
 *
 * 必须留在 `KNOWN_SESSION_EVENT_TYPES` 内——它是 `dsh-tool-present` 追加的同一类型，
 * 因此在**任何** harness 版本上都能被读回。改这里等于改会话日志契约，
 * `test/chart-turn-events.test.mjs` 有一条断言把它钉在 first-party 词汇表上。
 */
export const CHART_DELIVERABLE_EVENT = 'deliverables/presented'
/** `callId` 前缀：交付事件里携带的图表句柄（官方契约只要求非空字符串）。 */
export const CHART_CALL_ID_PREFIX = 'capital-chart:'
/** 同一 (session, turn) 的事件上限：防模型循环，超出只告警。 */
export const MAX_CHARTS_PER_TURN = 8
/** 向上找根会话的最大跳数（main → data_junior → specialist 只有一跳，留余量）。 */
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

/** 宿主 ctx 里本模块用到的部分；focused 结构类型便于单测注入假实现。 */
export interface ChartEventContext {
  get(name: string): unknown
  /** 监听会话事件（`turn/start`，仅作**兜底**冲刷）。必须注册在未打 scope 标签的 root context 上。 */
  on?(event: string, listener: (...args: unknown[]) => void): unknown
  /**
   * 监听 `agent/turn-stopping`：**首选的冲刷时机**。
   *
   * 为什么必须是它而不是 `turn/start`：一轮是否"最终"在事件发生的那一刻不可知——子 Agent 的
   * 结算随时会再触发新一轮。实测（2026-09-20 真机 session `38bad3f9`）：图表在 turn 4 与 5 之间
   * 寄存，旧规则在下一次 `turn/start` 立刻冲刷，于是交付行落进了**空的过程轮** turn 5，而主 Agent
   * 写下总结答复的是 turn 6——卡片出现在中间步骤。`agent/turn-stopping` 是官方"该轮即将关闭"的
   * 钩子（`@mode serial`，轮仍打开、可安全 append），在它上面冲刷，交付行就落进**消费这份图的那一轮**。
   *
   * 必须注册在未打 scope 标签的 root context 上：`dsh-scope` 的准入规则会让 standing-scope 的
   * 监听器收不到子 Agent 的事件，而我们要的正是 owner 自己那轮关闭的事实。
   */
  onTurnStopping?(listener: (...args: unknown[]) => void): unknown
  effect?(callback: () => unknown, label?: string): unknown
  /** Root context（未打标签）；拿不到时退回自身（宿主平面行即未打标签）。 */
  readonly root?: ChartEventContext
  logger?: { warn(message: string): void }
}

export interface ChartTurnEventInput {
  /** 出图时 chart_ref 的 owner scope（与 ChartArtifactRegistry 同一套语义）。 */
  ownerSessionId: string
  chart_id: string
  title: string
  /** 工作区相对的 chart.html 路径（官方 preview 按 session.cwd 解析它）。 */
  html_path: string
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

/**
 * 官方 `deliverables/presented` 载荷。
 *
 * 形状与 `dsh-tool-present` 逐字段对齐（那边是 `{ turn, callId, files }`，
 * 客户端 `isPresentedData()` 要求 `turn` 是 >=1 的安全整数、`callId` 非空字符串、
 * `files` 是数组）。`files[].path` 必须是**工作区相对**路径：官方打开动作会拿它去
 * `workspaceFiles.stat({ sessionId, workspaceRoot: session.cwd })` 解析，绝对路径过不了
 * 「Presented file has no verified Host path」这一关。
 *
 * `callId` 只是官方契约里的一个非空字符串句柄，没有配对约束（`present` 那边用来关联
 * tool/result），这里借它携带 `chart_id`，便于在日志里把一条交付回溯到具体图表。
 */
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
      owner.append(CHART_DELIVERABLE_EVENT, buildChartEventPayload(input, turn))
    } catch (error) {
      warn(`图表对话流事件写入失败（图表已落盘）：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    perTurn.set(key, used + 1)
    return true
  }

  /**
   * 把寄存的图表写进某一轮。
   *
   * 冲刷时机决定交付行的落点：首选 `agent/turn-stopping`（该轮即将关闭），
   * 只有在拿不到这个钩子时才退回 `turn/start`。
   */
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

  /**
   * 首选时机是否可用。
   *
   * 关键：`turn-stopping` 缺席时**必须**退回 `turn/start`，否则寄存的图会永远不写（静默丢失）。
   * 安装成功才置 true；effect 卸载时复位，避免失效后仍以为首选可用。
   */
  let turnStoppingActive = false

  /** 不能在任何 appending 窗口内重入 append，统一延到微任务。 */
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
        // 首选钩子在场时，`turn/start` 不得抢跑：那一轮往往还是过程轮（2026-09-20 真机教训），
        // 交付行会被落到空轮里。只有拿不到 `agent/turn-stopping` 时才用它兜底。
        if (turnStoppingActive) return
        const sessionId = typeof session?.id === 'string' ? session.id : undefined
        const turn = event.data?.turn
        if (sessionId === undefined || !pending.has(sessionId)) return
        if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 1) return
        flushSoon(sessionId, turn)
      } catch {
        // 事件观察者永不抛出。
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
        // 事件观察者永不抛出。
      }
    })
    turnStoppingActive = true
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        // 卸载即视为"首选不可用"，让 `turn/start` 兜底重新接上，避免图静默丢失。
        turnStoppingActive = false
        if (typeof disposeTurnStopping === 'function') disposeTurnStopping()
      }, 'capital-generation.chart-turn-stopping()')
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
        // 回合之间出图（主 Agent 等子 Agent 时会先关轮）：寄存，等 owner 那一轮
        // **即将关闭**（`agent/turn-stopping`）时再写——那才是消费这份图、写下答复的回合。
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
