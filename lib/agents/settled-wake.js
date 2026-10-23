function messageOf(value) {
    return value !== null && typeof value === 'object' ? value : undefined;
}
export function createSettledWakeGuard() {
    let rootSessionId;
    let closing = false;
    const admitted = new Set();
    const owns = (session) => {
        if (session?.id === undefined)
            return false;
        // A child's own user/message events must not clear the root's state.
        if (session.header?.origin === 'subagent')
            return false;
        rootSessionId ??= session.id;
        return session.id === rootSessionId;
    };
    const dropNotice = (agent, message) => {
        const childId = message.source?.senderSessionId;
        if (typeof childId !== 'string' || !admitted.has(childId))
            return false;
        if (agent?.inbox?.remove === undefined || typeof message.id !== 'string')
            return false;
        let removed = false;
        try {
            removed = agent.inbox.remove(message.id);
        }
        catch {
            removed = false;
        }
        if (removed)
            admitted.delete(childId);
        return removed;
    };
    const dropPending = (agent) => {
        if (agent?.inbox === undefined)
            return;
        for (const value of [...(agent.inbox.nextTurn ?? []), ...(agent.inbox.nextStep ?? [])]) {
            const message = messageOf(value);
            if (message?.source?.kind !== 'subagent-settled')
                continue;
            dropNotice(agent, message);
        }
    };
    return {
        acceptUserMessage(session, source) {
            if (!owns(session))
                return;
            if (source.kind === 'user') {
                admitted.clear();
                closing = false;
                return;
            }
            if (source.kind !== 'agent-message')
                return;
            if (typeof source.senderSessionId !== 'string' || source.senderSessionId.length === 0)
                return;
            admitted.add(source.senderSessionId);
            // The answer that follows this relay is not the previous closing answer.
            closing = false;
        },
        acceptClosing(agent) {
            if (agent?.session !== undefined && !owns(agent.session))
                return;
            closing = true;
            dropPending(agent);
        },
        acceptInboxInserted(agent, message) {
            if (agent?.session !== undefined && !owns(agent.session))
                return;
            if (message?.source?.kind !== 'subagent-settled' || !closing)
                return;
            dropNotice(agent, message);
        },
        acceptSubagentStart(info) {
            if (typeof info?.id === 'string' && info.id.length > 0)
                admitted.delete(info.id);
        },
        closing: () => closing,
        admitted: () => [...admitted],
    };
}
