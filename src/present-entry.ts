/**
 * `tools/present` row: present_charts + the closing-answer delivery listener.
 *
 * The model only records which charts belong to the answer. The actual first-party
 * `deliverables/presented` append happens in the terminal assistant-stream chunk, before the closing
 * message commits, gated on an idle root (no actionable inbox input, no running direct children). That is the only
 * point where "the final answer" is knowable, so early/no `present_charts` calls cannot strand the
 * card in a folded process turn (rationale: docs/dev/chart-delivery-events.md §6.3).
 */
import type { Context } from '@deepseek-ai/cordis'

import { createChartDelivery, type AssistantStreamFrameLike, type DeliveryAgentLike } from './chart/delivery.js'
import { createChartEventPublisher } from './chart/events.js'
import { chartEventContextOf } from './chart/event-context.js'
import { registerPresentChartsTool } from './chart/present-tool.js'
import { createSettledWakeGuard, type WakeMessageLike } from './agents/settled-wake.js'
import { capitalSharedRuntimeOf } from './chart-source-entry.js'
import type { SessionLike } from './data-collector/store.js'

export const name = 'capital-present-tools'
export const inject = ['tools']

interface InboxState {
  'next-turn'?: readonly unknown[]
  'next-step'?: readonly unknown[]
}

interface DescendantRow {
  kind?: string
  activity?: string
}

interface ProjectionsLike {
  stateOf(session: SessionLike, key: string): unknown
}

interface SubagentsLike {
  listDescendants(rootSessionId: string, signal?: AbortSignal): Promise<readonly DescendantRow[]>
}

/**
 * Fallback only: when the stream listener never fires, immediate delivery still has to avoid a
 * pending turn. The normal path defers to the closing stream chunk and does not consult this.
 */
export async function chartDeliveryBlocker(ctx: Context, session: SessionLike): Promise<string | undefined> {
  const projections = ctx.get('sessionProjections') as ProjectionsLike | undefined
  try {
    const inbox = projections?.stateOf(session, 'inbox') as InboxState | undefined
    // A settlement notice can race the closing answer; it must not block the card. Any relay or
    // human input still means another model step is pending.
    const pending = [...(inbox?.['next-turn'] ?? []), ...(inbox?.['next-step'] ?? [])]
      .filter((message) => {
        const source = (message as { source?: { kind?: string } } | null)?.source
        return source?.kind !== 'subagent-settled'
      }).length
    if (pending > 0) {
      return `还有 ${pending} 条待处理消息（子 Agent 回传 / 结算）：现在登记会让卡片留在被折叠的中间轮。`
        + '等这些消息处理完、写最终答复的那一步再调用 present_charts（refs 记不清就传 task_id）。'
    }
  } catch {
    // Projection unavailable: delivery availability matters more than the guard.
  }
  const subagents = ctx.get('subagents') as SubagentsLike | undefined
  if (typeof subagents?.listDescendants === 'function') {
    try {
      const rows = await subagents.listDescendants(session.id)
      const running = rows.filter((row) => row?.kind === 'child' && row?.activity === 'running').length
      if (running > 0) {
        return `还有 ${running} 个子 Agent 在运行：现在登记会让卡片留在被折叠的中间轮。`
          + '等它们全部结算、写最终答复的那一步再调用 present_charts（refs 记不清就传 task_id）。'
      }
    } catch {
      // Subagent service unavailable: don't block delivery for a missing optional check.
    }
  }
  return undefined
}

function inboxOf(ctx: Context): ((session: SessionLike) => InboxState | undefined) {
  const projections = ctx.get('sessionProjections') as ProjectionsLike | undefined
  return (session) => {
    try {
      return projections?.stateOf(session, 'inbox') as InboxState | undefined
    } catch {
      return undefined
    }
  }
}

interface MaybeListenerContext {
  on?(event: string, listener: (...args: unknown[]) => void): unknown
  root?: unknown
}

export function apply(ctx: Context): void {
  const shared = capitalSharedRuntimeOf(ctx)
  const publisherOf = () => createChartEventPublisher(chartEventContextOf(ctx))
  const eventCtx = ctx as unknown as MaybeListenerContext
  const wakeGuard = createSettledWakeGuard()
  const delivery = createChartDelivery({
    artifacts: shared.artifacts,
    publish: (sessionId, inputs) => publisherOf()?.publishMany(sessionId, inputs) ?? false,
    inboxOf: inboxOf(ctx),
    onClosing: (_session, agent) => wakeGuard.acceptClosing(agent),
  })

  // The preset row is applied in the root agent's scope: these events are the root's own.
  const disposers: unknown[] = []
  if (typeof eventCtx.on === 'function') {
    disposers.push(eventCtx.on('agent/assistant-stream', (...args: unknown[]) => {
      const payload = args[0] as { agent?: DeliveryAgentLike; frame?: AssistantStreamFrameLike } | undefined
      if (payload?.frame === undefined) return
      delivery.acceptStream(payload.agent?.session, payload.frame, payload.agent)
    }))
    disposers.push(eventCtx.on('subagent/start', (...args: unknown[]) => {
      const info = args[0] as { id?: string } | undefined
      delivery.acceptSubagentStart(info ?? {})
      wakeGuard.acceptSubagentStart(info ?? {})
    }))
    disposers.push(eventCtx.on('subagent/end', (...args: unknown[]) => delivery.acceptSubagentEnd(args[0] as { id?: string })))
    // Scoped to the root agent: only the root inbox is inspected. A settled notice inserted after
    // the closing frame would otherwise make the loop open a step for a redundant "done" message.
    disposers.push(eventCtx.on('agent/inbox/inserted', (...args: unknown[]) => {
      const payload = args[0] as { agent?: DeliveryAgentLike; message?: WakeMessageLike } | undefined
      if (payload?.agent === undefined || payload.message === undefined) return
      wakeGuard.acceptInboxInserted(payload.agent, payload.message)
    }))
  }
  // Session events are not agent-scoped: listen on the unscoped root and filter by payload.
  const listen = (eventCtx.root ?? ctx) as MaybeListenerContext
  if (typeof listen.on === 'function') {
    disposers.push(listen.on('session/event', (...args: unknown[]) => {
      const session = args[0] as SessionLike | undefined
      const event = args[1] as {
        type?: string
        time?: number
        data?: { source?: { kind?: string; senderSessionId?: string } }
      } | undefined
      if (event?.type !== 'user/message') return
      const source = event.data?.source
      // The settlement notice is authoritative even when the lifecycle edge was missed; clearing
      // here keeps the stream-time idle check from waiting on a child that is already done.
      if (source?.kind === 'subagent-settled') {
        if (typeof source.senderSessionId === 'string') delivery.acceptSubagentEnd({ id: source.senderSessionId })
        return
      }
      if (typeof session?.id !== 'string' || source === undefined) return
      if (source.kind === 'user') {
        delivery.acceptUserMessage(session.id, typeof event.time === 'number' ? event.time : Date.now())
        wakeGuard.acceptUserMessage(session, source)
        return
      }
      // `user/message` is committed only when admitted, so this is exactly the "child already
      // reported its result" marker the closing guard needs.
      if (source.kind === 'agent-message') wakeGuard.acceptUserMessage(session, source)
    }))
  }
  ctx.effect(() => () => {
    for (const dispose of disposers) {
      if (typeof dispose === 'function') dispose()
    }
  }, 'capital-generation.chart-delivery()')

  registerPresentChartsTool(ctx, {
    artifacts: shared.artifacts,
    chartEvents: publisherOf,
    readiness: (session) => chartDeliveryBlocker(ctx, session),
    delivery,
  })
}
