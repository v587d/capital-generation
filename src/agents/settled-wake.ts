/**
 * Removes redundant `subagent-settled` notices at the closing frame; otherwise the host loop opens
 * another step after a complete answer and folds it. Only children with an admitted relay are
 * dropped — a silent child may carry its only outcome in the notice.
 * Rationale: docs/dev/chart-delivery-events.md §6.3.
 */
import type { SessionLike } from '../data-collector/store.js'

export interface WakeMessageLike {
  readonly id?: string
  readonly source?: { readonly kind?: string; readonly senderSessionId?: string }
}

interface InboxLike {
  readonly nextTurn?: readonly unknown[]
  readonly nextStep?: readonly unknown[]
  remove?(messageId: string): boolean
}

function messageOf(value: unknown): WakeMessageLike | undefined {
  return value !== null && typeof value === 'object' ? value as WakeMessageLike : undefined
}

export interface WakeAgentLike {
  readonly session?: SessionLike
  readonly inbox?: InboxLike
}

export interface SettledWakeGuard {
  /** `user/message` events: human resets the exchange, an admitted child relay marks that child. */
  acceptUserMessage(session: SessionLike, source: { kind?: string; senderSessionId?: string }): void
  /** Terminal assistant-stream frame: the closing answer is being written. */
  acceptClosing(agent: WakeAgentLike | undefined): void
  /** A notice inserted after the closing frame must not wake a new step. */
  acceptInboxInserted(agent: WakeAgentLike | undefined, message: WakeMessageLike | undefined): void
  /** A fresh activation invalidates the previous exchange's relay marker. */
  acceptSubagentStart(info: { id?: string }): void
  /** Diagnostics/tests. */
  closing(): boolean
  admitted(): readonly string[]
}

export function createSettledWakeGuard(): SettledWakeGuard {
  let rootSessionId: string | undefined
  let closing = false
  const admitted = new Set<string>()

  const owns = (session: SessionLike | undefined): session is SessionLike => {
    if (session?.id === undefined) return false
    // A child's own user/message events must not clear the root's state.
    if (session.header?.origin === 'subagent') return false
    rootSessionId ??= session.id
    return session.id === rootSessionId
  }

  const dropNotice = (agent: WakeAgentLike | undefined, message: WakeMessageLike): boolean => {
    const childId = message.source?.senderSessionId
    if (typeof childId !== 'string' || !admitted.has(childId)) return false
    if (agent?.inbox?.remove === undefined || typeof message.id !== 'string') return false
    let removed = false
    try {
      removed = agent.inbox.remove(message.id)
    } catch {
      removed = false
    }
    if (removed) admitted.delete(childId)
    return removed
  }

  const dropPending = (agent: WakeAgentLike | undefined): void => {
    if (agent?.inbox === undefined) return
    for (const value of [...(agent.inbox.nextTurn ?? []), ...(agent.inbox.nextStep ?? [])]) {
      const message = messageOf(value)
      if (message?.source?.kind !== 'subagent-settled') continue
      dropNotice(agent, message)
    }
  }

  return {
    acceptUserMessage(session, source) {
      if (!owns(session)) return
      if (source.kind === 'user') {
        admitted.clear()
        closing = false
        return
      }
      if (source.kind !== 'agent-message') return
      if (typeof source.senderSessionId !== 'string' || source.senderSessionId.length === 0) return
      admitted.add(source.senderSessionId)
      // The answer that follows this relay is not the previous closing answer.
      closing = false
    },
    acceptClosing(agent) {
      if (agent?.session !== undefined && !owns(agent.session)) return
      closing = true
      dropPending(agent)
    },
    acceptInboxInserted(agent, message) {
      if (agent?.session !== undefined && !owns(agent.session)) return
      if (message?.source?.kind !== 'subagent-settled' || !closing) return
      dropNotice(agent, message)
    },
    acceptSubagentStart(info) {
      if (typeof info?.id === 'string' && info.id.length > 0) admitted.delete(info.id)
    },
    closing: () => closing,
    admitted: () => [...admitted],
  }
}
