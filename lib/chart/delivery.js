/** Settlement notices race the closing answer; they do not require another model step before the card. */
function isSettledNotice(value) {
    return value !== null && typeof value === 'object'
        && value.source?.kind === 'subagent-settled';
}
function inboxMessages(inbox) {
    return [...(inbox?.['next-turn'] ?? []), ...(inbox?.['next-step'] ?? [])];
}
export const DEFAULT_MAX_DELIVERED_CHARTS = 32;
export function createChartDelivery(options) {
    const maxCharts = options.maxCharts ?? DEFAULT_MAX_DELIVERED_CHARTS;
    /** Plugin instances are per root agent, so one session id guards against child streams leaking in. */
    let sessionId;
    let explicit = [];
    const exchangeStarts = new Map();
    const fallbackStart = Date.now();
    /** One card per exchange. `turn` is unreliable: a later finish in the same turn may omit it. */
    let flushed = false;
    let sawFrame = false;
    const attempts = new Map();
    const running = new Map();
    const owns = (session) => {
        if (session?.id === undefined)
            return false;
        // A leaked child frame must not bind the manager: the card belongs to the user-facing root.
        if (session.header?.origin === 'subagent')
            return false;
        sessionId ??= session.id;
        return session.id === sessionId;
    };
    const autoInputs = (session) => options.artifacts
        .list({ session })
        .filter((artifact) => artifact.created_at >= (exchangeStarts.get(session.id) ?? fallbackStart))
        .map((artifact) => ({
        ownerSessionId: session.id,
        chart_id: artifact.chart_id,
        title: artifact.title,
        html_path: artifact.html_path,
    }));
    /** A settled notice proves the child is done even if the lifecycle edge was missed or the parent
     * observed it outside its scope. Reconciliating here keeps the stream-time gate synchronous. */
    const reconcileSettled = (inbox) => {
        for (const message of inboxMessages(inbox)) {
            if (!isSettledNotice(message))
                continue;
            const childId = message.source?.senderSessionId;
            if (typeof childId === 'string')
                running.delete(childId);
        }
    };
    const idle = (inbox) => {
        if (running.size > 0)
            return false;
        if (inbox === undefined)
            return true;
        return inboxMessages(inbox).every(isSettledNotice);
    };
    const flush = (session, turn, agent) => {
        // A later step in the same exchange may omit `turn`; it still must not write a second card.
        if (flushed)
            return;
        const inbox = options.inboxOf?.(session);
        reconcileSettled(inbox);
        if (!idle(inbox))
            return;
        // The wake guard drops notices that would otherwise make the loop open another step after
        // this answer. Run it even when no chart is selected, and never let it block delivery.
        try {
            options.onClosing?.(session, agent, turn);
        }
        catch {
            // A guard failure must not strand an already-selected card.
        }
        const inputs = (explicit.length > 0 ? explicit : autoInputs(session)).slice(0, maxCharts);
        if (inputs.length === 0)
            return;
        let written = false;
        try {
            written = options.publish(session.id, inputs);
        }
        catch {
            written = false;
        }
        // A failed write keeps the exchange open so a later closing finish can retry.
        if (written)
            flushed = true;
    };
    return {
        request(session, inputs) {
            if (!owns(session) || inputs.length === 0)
                return;
            const seen = new Set(explicit.map((item) => item.chart_id));
            for (const input of inputs) {
                if (seen.has(input.chart_id))
                    continue;
                seen.add(input.chart_id);
                explicit.push(input);
            }
            if (explicit.length > maxCharts)
                explicit = explicit.slice(0, maxCharts);
        },
        acceptStream(session, frame, agent) {
            if (!owns(session) || frame === undefined)
                return;
            sawFrame = true;
            const attemptId = frame.attemptId ?? '__default__';
            if (frame.type === 'start') {
                attempts.set(attemptId, { toolCall: false });
                return;
            }
            if (frame.type === 'end') {
                attempts.delete(attemptId);
                return;
            }
            const chunk = frame.chunk;
            if (frame.type !== 'chunk' || chunk === undefined)
                return;
            const attempt = attempts.get(attemptId) ?? { toolCall: false };
            attempts.set(attemptId, attempt);
            if (chunk.type === 'tool-call-delta'
                || (chunk.type === 'block-start' && chunk.blockType === 'tool-call')
                || (chunk.type === 'block-end' && chunk.block?.type === 'tool-call')) {
                attempt.toolCall = true;
                return;
            }
            if (chunk.type !== 'finish' || chunk.reason?.kind !== 'stop' || attempt.toolCall)
                return;
            flush(session, frame.turn, agent);
        },
        acceptUserMessage(id, time) {
            exchangeStarts.set(id, time);
            if (id !== sessionId)
                return;
            explicit = [];
            flushed = false;
        },
        acceptSubagentStart(info) {
            if (typeof info?.id !== 'string' || info.id.length === 0)
                return;
            running.set(info.id, 1);
        },
        acceptSubagentEnd(info) {
            if (typeof info?.id !== 'string')
                return;
            // One child session runs one activation at a time; deleting also clears duplicate starts.
            running.delete(info.id);
        },
        streaming() {
            return sawFrame;
        },
        pending(id) {
            if (id !== undefined && id !== sessionId)
                return 0;
            return explicit.length;
        },
    };
}
