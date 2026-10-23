import { createChartDelivery } from './chart/delivery.js';
import { createChartEventPublisher } from './chart/events.js';
import { chartEventContextOf } from './chart/event-context.js';
import { registerPresentChartsTool } from './chart/present-tool.js';
import { capitalSharedRuntimeOf } from './chart-source-entry.js';
export const name = 'capital-present-tools';
export const inject = ['tools'];
/**
 * Fallback only: when the stream listener never fires, immediate delivery still has to avoid a
 * pending turn. The normal path defers to the closing stream chunk and does not consult this.
 */
export async function chartDeliveryBlocker(ctx, session) {
    const projections = ctx.get('sessionProjections');
    try {
        const inbox = projections?.stateOf(session, 'inbox');
        // A settlement notice can race the closing answer; it must not block the card. Any relay or
        // human input still means another model step is pending.
        const pending = [...(inbox?.['next-turn'] ?? []), ...(inbox?.['next-step'] ?? [])]
            .filter((message) => {
            const source = message?.source;
            return source?.kind !== 'subagent-settled';
        }).length;
        if (pending > 0) {
            return `还有 ${pending} 条待处理消息（子 Agent 回传 / 结算）：现在登记会让卡片留在被折叠的中间轮。`
                + '等这些消息处理完、写最终答复的那一步再调用 present_charts（refs 记不清就传 task_id）。';
        }
    }
    catch {
        // Projection unavailable: delivery availability matters more than the guard.
    }
    const subagents = ctx.get('subagents');
    if (typeof subagents?.listDescendants === 'function') {
        try {
            const rows = await subagents.listDescendants(session.id);
            const running = rows.filter((row) => row?.kind === 'child' && row?.activity === 'running').length;
            if (running > 0) {
                return `还有 ${running} 个子 Agent 在运行：现在登记会让卡片留在被折叠的中间轮。`
                    + '等它们全部结算、写最终答复的那一步再调用 present_charts（refs 记不清就传 task_id）。';
            }
        }
        catch {
            // Subagent service unavailable: don't block delivery for a missing optional check.
        }
    }
    return undefined;
}
function inboxOf(ctx) {
    const projections = ctx.get('sessionProjections');
    return (session) => {
        try {
            return projections?.stateOf(session, 'inbox');
        }
        catch {
            return undefined;
        }
    };
}
export function apply(ctx) {
    const shared = capitalSharedRuntimeOf(ctx);
    const publisherOf = () => createChartEventPublisher(chartEventContextOf(ctx));
    const eventCtx = ctx;
    const delivery = createChartDelivery({
        artifacts: shared.artifacts,
        publish: (sessionId, inputs) => publisherOf()?.publishMany(sessionId, inputs) ?? false,
        inboxOf: inboxOf(ctx),
    });
    // The preset row is applied in the root agent's scope: these events are the root's own.
    const disposers = [];
    if (typeof eventCtx.on === 'function') {
        disposers.push(eventCtx.on('agent/assistant-stream', (...args) => {
            const payload = args[0];
            if (payload?.frame === undefined)
                return;
            delivery.acceptStream(payload.agent?.session, payload.frame);
        }));
        disposers.push(eventCtx.on('subagent/start', (...args) => delivery.acceptSubagentStart(args[0])));
        disposers.push(eventCtx.on('subagent/end', (...args) => delivery.acceptSubagentEnd(args[0])));
    }
    // Session events are not agent-scoped: listen on the unscoped root and filter by payload.
    const listen = (eventCtx.root ?? ctx);
    if (typeof listen.on === 'function') {
        disposers.push(listen.on('session/event', (...args) => {
            const session = args[0];
            const event = args[1];
            if (event?.type !== 'user/message')
                return;
            const source = event.data?.source;
            // The settlement notice is authoritative even when the lifecycle edge was missed; clearing
            // here keeps the stream-time idle check from waiting on a child that is already done.
            if (source?.kind === 'subagent-settled') {
                if (typeof source.senderSessionId === 'string')
                    delivery.acceptSubagentEnd({ id: source.senderSessionId });
                return;
            }
            if (source?.kind !== 'user')
                return;
            if (typeof session?.id !== 'string')
                return;
            delivery.acceptUserMessage(session.id, typeof event.time === 'number' ? event.time : Date.now());
        }));
    }
    ctx.effect(() => () => {
        for (const dispose of disposers) {
            if (typeof dispose === 'function')
                dispose();
        }
    }, 'capital-generation.chart-delivery()');
    registerPresentChartsTool(ctx, {
        artifacts: shared.artifacts,
        chartEvents: publisherOf,
        readiness: (session) => chartDeliveryBlocker(ctx, session),
        delivery,
    });
}
