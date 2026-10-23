const DEFAULT_WAIT_SLICE_MS = 30_000;
const MAX_WAIT_SLICE_MS = 60_000;
const jsonObject = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
function render(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value) }];
}
function sourceKindOf(message) {
    if (message === null || typeof message !== 'object')
        return undefined;
    const source = message.source;
    if (source === null || typeof source !== 'object')
        return undefined;
    const kind = source.kind;
    return typeof kind === 'string' ? kind : undefined;
}
/** Settlement notices are lifecycle noise here; only a human or a relayed result is actionable. */
function pendingCounts(agent) {
    const messages = [...(agent.inbox?.nextTurn ?? []), ...(agent.inbox?.nextStep ?? [])];
    let users = 0;
    let children = 0;
    for (const message of messages) {
        const kind = sourceKindOf(message);
        if (kind === 'user')
            users += 1;
        else if (kind === 'agent-message')
            children += 1;
    }
    return { total: users + children, users, children };
}
function resolveSlice(value) {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : DEFAULT_WAIT_SLICE_MS;
    return Math.max(1, Math.min(MAX_WAIT_SLICE_MS, numeric));
}
function abortReason(signal) {
    return signal.reason instanceof Error ? signal.reason : new Error('wait_for_agents aborted');
}
function waitTimer(ms, signal) {
    let handle;
    let onAbort;
    const promise = new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(abortReason(signal));
            return;
        }
        handle = setTimeout(() => resolve('timeout'), ms);
        onAbort = () => {
            if (handle !== undefined)
                clearTimeout(handle);
            reject(abortReason(signal));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
    return {
        promise,
        dispose: () => {
            if (handle !== undefined)
                clearTimeout(handle);
            if (onAbort !== undefined)
                signal.removeEventListener('abort', onAbort);
        },
    };
}
async function runningRows(service, agentsOf, sessionId, signal) {
    if (typeof service.listDescendants !== 'function')
        return [];
    let rows;
    try {
        rows = await service.listDescendants(sessionId, signal);
    }
    catch {
        return [];
    }
    let agents;
    try {
        agents = agentsOf?.();
    }
    catch {
        agents = undefined;
    }
    const seen = new Set();
    const running = [];
    for (const row of rows ?? []) {
        if (row?.kind !== 'child' || typeof row.id !== 'string' || seen.has(row.id))
            continue;
        let live;
        try {
            live = agents?.get?.(row.id);
        }
        catch {
            live = undefined;
        }
        // A live idle child is not progressing; a catalog row alone is only a historical child.
        if (live?.status === 'idle')
            continue;
        if (row.activity !== 'running' && live?.status !== 'running')
            continue;
        seen.add(row.id);
        const label = typeof row.label === 'string' && row.label.length > 0 ? row.label : undefined;
        running.push({ id: row.id, ...(label === undefined ? {} : { label }) });
    }
    return running;
}
function hintFor(status, pending, running) {
    switch (status) {
        case 'all_settled':
            return '所有子 Agent 已结束。现在按对账表逐行核对；收齐后先 present_charts（有图）再写完整最终答复。';
        case 'message':
            return `有 ${pending} 条子 Agent 消息待处理，下一步会带上它们；处理完仍有未结算角色就再调用 wait_for_agents。`;
        case 'user_input':
            return `用户在等待期间发来消息；当前有 ${pending} 条可执行消息待处理，先处理用户输入，再决定是否继续等待。`;
        case 'timeout':
            return running > 0
                ? `本次等待窗口内未收敛，仍有 ${running} 个子 Agent 在运行；继续调用 wait_for_agents。running 已列出存活子树，不要再调用 list_agents，也不要 send_message 催运行中的子 Agent；只有用户要求进度或无法继续时才说明。`
                : '本次等待窗口内未收敛，也没有可报告的运行中子 Agent；再调用一次确认，不要调用 list_agents，不要当作完成。';
    }
}
export function waitForAgentsToolDefinition(deps) {
    const waitSliceMs = resolveSlice(deps.waitSliceMs);
    const now = deps.now ?? Date.now;
    const parameters = jsonObject({});
    const outputSchema = jsonObject({
        status: { type: 'string', enum: ['all_settled', 'message', 'user_input', 'timeout'] },
        waited_ms: { type: 'integer' },
        pending_messages: { type: 'integer' },
        running: {
            type: 'array',
            items: jsonObject({
                id: { type: 'string' },
                label: { type: 'string' },
            }, ['id']),
        },
        hint: { type: 'string' },
    }, ['status', 'waited_ms', 'pending_messages', 'running', 'hint']);
    return {
        name: 'wait_for_agents',
        description: '等待你的子 Agent 树完成当前工作，单次最多 30 秒；把“每个子 Agent 回传/结算各开一轮”收敛成同一轮。'
            + '创建、复用或 send_message 之后调用它，等待期间不写可见正文，也不要用“请稍候”式正文结束回合。'
            + '返回 message 或 user_input 时，下一步会带上这些消息；处理完继续调用。'
            + '返回 all_settled 才进入对账与最终答复；timeout 表示仍未收敛，仍有 running 时继续调用，不要仅因一次超时写等待行。'
            + '等待期间不要用 list_agents 轮询。只对主 Agent 开放；没有子 Agent 时会立即返回 all_settled。',
        parameters,
        output: { schema: outputSchema, render },
        // Deliberately no isConcurrencySafe: waiting is the ordering barrier between dispatch and synthesis.
        async execute(_args, exec) {
            const agent = exec.agent;
            const sessionId = agent?.session?.id;
            if (agent === undefined || sessionId === undefined) {
                throw new Error('wait_for_agents requires a calling agent (exec.agent was undefined)');
            }
            // `parentSession` alone is a user fork; only the subagent origin marks a delegated child.
            if (agent.session?.header?.origin === 'subagent') {
                throw new Error('wait_for_agents 只对主 Agent 开放：子 Agent 用 send_message 回传结果，不要等待其他 Agent。');
            }
            if (exec.signal.aborted)
                throw abortReason(exec.signal);
            const service = deps.subagents();
            if (service?.waitForChildren === undefined) {
                throw new Error('wait_for_agents 不可用：宿主 subagents 服务未挂载；不要用 list_agents 轮询代替。');
            }
            const started = now();
            const initial = pendingCounts(agent);
            if (initial.users > 0 || initial.children > 0) {
                const status = initial.users > 0 ? 'user_input' : 'message';
                const running = await runningRows(service, deps.agents, sessionId, exec.signal);
                return {
                    status,
                    waited_ms: Math.max(0, Math.round(now() - started)),
                    pending_messages: initial.total,
                    running,
                    hint: hintFor(status, initial.total, running.length),
                };
            }
            let resolveInbox;
            const inboxEvent = new Promise((resolve) => { resolveInbox = resolve; });
            const onInserted = (...args) => {
                const payload = args[0];
                if (payload?.agent?.session?.id !== sessionId)
                    return;
                const kind = sourceKindOf(payload.message);
                if (kind === 'agent-message')
                    resolveInbox('message');
                else if (kind === 'user')
                    resolveInbox('user_input');
            };
            let dispose;
            if (typeof deps.events?.on === 'function') {
                try {
                    dispose = deps.events.on('agent/inbox/inserted', onInserted);
                }
                catch {
                    dispose = undefined;
                }
            }
            let outcome;
            const slice = waitTimer(waitSliceMs, exec.signal);
            try {
                const wait = Promise.resolve(service.waitForChildren(agent));
                // The loser of the race must not become an unhandled rejection when the slice or a relay wins.
                wait.catch(() => undefined);
                outcome = await Promise.race([
                    wait.then(() => 'settled'),
                    inboxEvent,
                    slice.promise,
                ]);
            }
            finally {
                slice.dispose();
                if (typeof dispose === 'function')
                    dispose();
            }
            const pending = pendingCounts(agent);
            const status = pending.users > 0
                ? 'user_input'
                : pending.children > 0
                    ? 'message'
                    : outcome === 'timeout' ? 'timeout' : 'all_settled';
            const running = status === 'all_settled'
                ? []
                : await runningRows(service, deps.agents, sessionId, exec.signal);
            return {
                status,
                waited_ms: Math.max(0, Math.round(now() - started)),
                pending_messages: pending.total,
                running,
                hint: hintFor(status, pending.total, running.length),
            };
        },
    };
}
export function registerWaitForAgentsTool(ctx, options = {}) {
    const tools = ctx.get('tools');
    if (tools === undefined)
        return;
    const events = ctx;
    const definition = waitForAgentsToolDefinition({
        ...options,
        subagents: () => {
            try {
                return ctx.get('subagents');
            }
            catch {
                return undefined;
            }
        },
        events,
        agents: () => {
            try {
                return ctx.get('agents');
            }
            catch {
                return undefined;
            }
        },
    });
    ctx.effect(() => tools.register(definition), 'capital-generation.tool(wait_for_agents)');
}
