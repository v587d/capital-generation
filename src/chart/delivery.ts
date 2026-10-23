/**
 * Chart delivery at the closing answer.
 *
 * DSH's deliverable card only replays `deliverables/presented` events whose seq is before the
 * turn's closing assistant message, and a turn is final only after the fact. The one place that is
 * provably before the closing message is the assistant stream's terminal `finish` chunk: the loop
 * appends the message after the stream ends. So delivery is deferred to that chunk, gated on the
 * root session being idle (no actionable inbox input, no running direct children), which is exactly
 * the shape of a closing turn. Waiting/aborted/tool-call responses never flush.
 *
 * `subagent-settled` notices are not actionable input: they can arrive while the closing answer is
 * already streaming. Counting them as pending would strand a card that the model has just selected,
 * because the follow-up step often has nothing new to say.
 */
import type { ChartArtifactRegistry } from './artifact-ref.js'
import type { ChartTurnEventInput } from './events.js'
import type { SessionLike } from '../data-collector/store.js'

/** Structural subset of `@deepseek-ai/dsh-llm` AssistantStreamFrame. */
export interface AssistantStreamFrameLike {
  readonly type?: string
  readonly attemptId?: string
  readonly turn?: number
  readonly chunk?: {
    readonly type?: string
    readonly reason?: { readonly kind?: string }
    readonly blockType?: string
    readonly block?: { readonly type?: string }
  }
}

interface InboxStateLike {
  'next-turn'?: readonly unknown[]
  'next-step'?: readonly unknown[]
}

interface InboxMessageLike {
  source?: { kind?: string; senderSessionId?: string }
}

/** Settlement notices race the closing answer; they do not require another model step before the card. */
function isSettledNotice(value: unknown): value is InboxMessageLike {
  return value !== null && typeof value === 'object'
    && (value as InboxMessageLike).source?.kind === 'subagent-settled'
}

function inboxMessages(inbox: InboxStateLike | undefined): unknown[] {
  return [...(inbox?.['next-turn'] ?? []), ...(inbox?.['next-step'] ?? [])]
}

export interface ChartDeliveryOptions {
  artifacts: ChartArtifactRegistry
  /** Writes one first-party deliverables/presented batch; must be synchronous (pre-message seq). */
  publish: (sessionId: string, inputs: ChartTurnEventInput[]) => boolean
  /** Durable pending input; synchronous projection read. Absent means "cannot tell" → proceed. */
  inboxOf?: (session: SessionLike) => InboxStateLike | undefined
  /** Bounded batch; the card collapses past four files and expands on demand. */
  maxCharts?: number
}

export interface ChartDelivery {
  /** `present_charts` selection; merged across calls because models often retry in batches. */
  request(session: SessionLike, inputs: ChartTurnEventInput[]): void
  acceptStream(session: SessionLike | undefined, frame: AssistantStreamFrameLike): void
  /** A new human message starts a new exchange: old charts must not ride into it. */
  acceptUserMessage(sessionId: string, time: number): void
  acceptSubagentStart(info: { id?: string }): void
  acceptSubagentEnd(info: { id?: string }): void
  /** False until any stream frame was observed: callers fall back to immediate delivery. */
  streaming(): boolean
  /** Diagnostics/tests: explicitly selected inputs for the current exchange. */
  pending(sessionId?: string): number
}

export const DEFAULT_MAX_DELIVERED_CHARTS = 32

export function createChartDelivery(options: ChartDeliveryOptions): ChartDelivery {
  const maxCharts = options.maxCharts ?? DEFAULT_MAX_DELIVERED_CHARTS
  /** Plugin instances are per root agent, so one session id guards against child streams leaking in. */
  let sessionId: string | undefined
  let explicit: ChartTurnEventInput[] = []
  const exchangeStarts = new Map<string, number>()
  const fallbackStart = Date.now()
  let lastFlushedTurn: number | undefined
  let sawFrame = false
  const attempts = new Map<string, { toolCall: boolean }>()
  const running = new Map<string, number>()

  const owns = (session: SessionLike | undefined): session is SessionLike => {
    if (session?.id === undefined) return false
    // A leaked child frame must not bind the manager: the card belongs to the user-facing root.
    if (session.header?.origin === 'subagent') return false
    sessionId ??= session.id
    return session.id === sessionId
  }

  const autoInputs = (session: SessionLike): ChartTurnEventInput[] => options.artifacts
    .list({ session })
    .filter((artifact) => artifact.created_at >= (exchangeStarts.get(session.id) ?? fallbackStart))
    .map((artifact) => ({
      ownerSessionId: session.id,
      chart_id: artifact.chart_id,
      title: artifact.title,
      html_path: artifact.html_path,
    }))

  /** A settled notice proves the child is done even if the lifecycle edge was missed or the parent
   * observed it outside its scope. Reconciliating here keeps the stream-time gate synchronous. */
  const reconcileSettled = (inbox: InboxStateLike | undefined): void => {
    for (const message of inboxMessages(inbox)) {
      if (!isSettledNotice(message)) continue
      const childId = message.source?.senderSessionId
      if (typeof childId === 'string') running.delete(childId)
    }
  }

  const idle = (inbox: InboxStateLike | undefined): boolean => {
    if (running.size > 0) return false
    if (inbox === undefined) return true
    return inboxMessages(inbox).every(isSettledNotice)
  }

  const flush = (session: SessionLike, turn: number | undefined): void => {
    // A later step in the same exchange may omit `turn`; it still must not write a second card.
    if (lastFlushedTurn !== undefined && (turn === undefined || lastFlushedTurn === turn)) return
    const inbox = options.inboxOf?.(session)
    reconcileSettled(inbox)
    if (!idle(inbox)) return
    const inputs = (explicit.length > 0 ? explicit : autoInputs(session)).slice(0, maxCharts)
    if (inputs.length === 0) return
    let written = false
    try {
      written = options.publish(session.id, inputs)
    } catch {
      written = false
    }
    // Sentinel keeps a second turn-less finish in the same exchange from duplicating the card.
    if (written) lastFlushedTurn = turn ?? -1
  }

  return {
    request(session, inputs) {
      if (!owns(session) || inputs.length === 0) return
      const seen = new Set(explicit.map((item) => item.chart_id))
      for (const input of inputs) {
        if (seen.has(input.chart_id)) continue
        seen.add(input.chart_id)
        explicit.push(input)
      }
      if (explicit.length > maxCharts) explicit = explicit.slice(0, maxCharts)
    },
    acceptStream(session, frame) {
      if (!owns(session) || frame === undefined) return
      sawFrame = true
      const attemptId = frame.attemptId ?? '__default__'
      if (frame.type === 'start') {
        attempts.set(attemptId, { toolCall: false })
        return
      }
      if (frame.type === 'end') {
        attempts.delete(attemptId)
        return
      }
      const chunk = frame.chunk
      if (frame.type !== 'chunk' || chunk === undefined) return
      const attempt = attempts.get(attemptId) ?? { toolCall: false }
      attempts.set(attemptId, attempt)
      if (chunk.type === 'tool-call-delta'
        || (chunk.type === 'block-start' && chunk.blockType === 'tool-call')
        || (chunk.type === 'block-end' && chunk.block?.type === 'tool-call')) {
        attempt.toolCall = true
        return
      }
      if (chunk.type !== 'finish' || chunk.reason?.kind !== 'stop' || attempt.toolCall) return
      flush(session, frame.turn)
    },
    acceptUserMessage(id, time) {
      exchangeStarts.set(id, time)
      if (id !== sessionId) return
      explicit = []
      lastFlushedTurn = undefined
    },
    acceptSubagentStart(info) {
      if (typeof info?.id !== 'string' || info.id.length === 0) return
      running.set(info.id, 1)
    },
    acceptSubagentEnd(info) {
      if (typeof info?.id !== 'string') return
      // One child session runs one activation at a time; deleting also clears duplicate starts.
      running.delete(info.id)
    },
    streaming() {
      return sawFrame
    },
    pending(id) {
      if (id !== undefined && id !== sessionId) return 0
      return explicit.length
    },
  }
}
