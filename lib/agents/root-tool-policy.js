/**
 * 根 Agent 的工具收敛：把"只有子 Agent 该用"的工具从**主 Agent**的工具表里拿掉。
 *
 * 为什么需要它：preset 行注册在 standing composition 层，而主 Agent 与子 Agent 的
 * scope 都是 standing 的**子节点（兄弟）**。因此：
 *  - 在 preset 层用 `tools.restrict({deny})` 会把子 Agent 一起 deny
 *    （`dsh-tools` 的 `view()` 里 allow/deny 只是交集过滤，永远不能把祖先 deny 掉的名字加回来），
 *    连 `visualization_specialist` 的 `toolFilter.allow: [render_chart]` 都会失效；
 *  - 只在**根 Agent 自己的 scope** 上 deny，才既拿掉主 Agent 的入口、又不影响子 Agent。
 *
 * ⚠️ 监听必须注册在**未打 scope 标签的 context**（`ctx.root`）上。
 * 实测（2026-09-17，dsh 0.1.5-rc.1）：`agent/created` 的路由键是 **agent 对象本身**
 * （`dsh-agent` 的 `agentCarrier(agent) = scopeTarget(agent, agent)`），不是 agent 的 scope key。
 * `dsh-scope` 的准入规则只放行"未打标签的监听器"或"键在 carrier key 祖先链上"的监听器，
 * 所以注册在 standing scope 上的监听器**收不到**这个事件——表现是主 Agent 的工具表照旧有
 * `render_chart`，而且没有任何报错（静默失效）。宿主平面行之所以能用 `ctx.on('agent/created')`，
 * 正是因为它们未打标签。因此这里取 `ctx.root`，再用 `agentPresets.composedPreset(agent.ctx)`
 * 筛出本 preset 的 agent。
 */
export const ROOT_AGENT_DENIED_TOOLS = [
    /** 出图只走 data_junior 的可视化 gate（main → junior → specialist）。 */
    'render_chart',
    /** 孙 Agent 的创建工具只属于 data_junior：主 Agent 拿到它只会绕过 gate。 */
    'subagent_visualization_specialist',
    /** 只签发给 delegated data agent（运行时本就拒绝根会话），留在表里只会诱导误调。 */
    'prepare_chart_source',
    /**
     * bash 只给 data_junior（它是数据侧的"纯计算兜底"）。主 Agent 不需要它，而且一旦拥有
     * 就等于拿到通用执行 + 整机读 + 出网能力，会绕过数据调度与出图两道结构 gate。
     * 注意 preset 里那两行 shell 是**平台成对**挂载的（Windows 上是 pwsh），名字由平台决定。
     */
    'bash', 'pwsh',
];
/** 本 preset 的 id（`composedPreset` 的返回值）。 */
export const CAPITAL_PRESET_ID = 'capital-generation';
/** 根 Agent 判据：没有 parentSession。子 Agent 一律有（spawn provider 写入）。 */
export function isRootAgent(agent) {
    if (agent?.session === undefined)
        return false;
    const parent = agent.session.header?.parentSession;
    return typeof parent !== 'string' || parent.length === 0;
}
/** 只有本 preset 的 agent 才收敛：别的 preset 的 agent 不该被我们碰。 */
export function isCapitalAgent(ctx, agent) {
    let presets;
    try {
        presets = ctx.get?.('agentPresets');
    }
    catch {
        presets = undefined;
    }
    if (presets === undefined || typeof presets.composedPreset !== 'function') {
        // 读不到 registry 时保守放行：逐名 restrict 本身会拒绝未知工具名，不会误伤别的 preset。
        return true;
    }
    try {
        return presets.composedPreset(agent?.ctx) === CAPITAL_PRESET_ID;
    }
    catch {
        return false;
    }
}
/**
 * 只对根 Agent 生效地 deny {@link ROOT_AGENT_DENIED_TOOLS}。
 *
 * 逐名 restrict：`tools.restrict()` 对"本 scope 看不到的名字"会抛错（别的 preset、或行还没挂载），
 * 逐名调用把这种"本来就不该有"的情况变成无害跳过，而不是整批失败。
 * 任何异常都不抛出：调用方是 agent 创建路径，宁可少收敛也不能挡住建 agent。
 */
export function restrictRootAgentTools(agent) {
    if (!isRootAgent(agent))
        return 'skipped';
    let tools;
    try {
        tools = agent?.ctx?.tools;
    }
    catch {
        return 'unavailable';
    }
    if (tools === undefined || typeof tools.restrict !== 'function')
        return 'unavailable';
    for (const name of ROOT_AGENT_DENIED_TOOLS) {
        try {
            tools.restrict({ deny: [name] });
        }
        catch {
            // 这个 scope 本来就没有这个名字（别的 preset / 该行未挂载）：跳过即可。
        }
    }
    return 'restricted';
}
/**
 * 注册 `agent/created` 监听。监听器只做一件事：对本 preset 的根 Agent 收敛一次。
 *
 * 注册位置是 Root context（未打标签），因此能收到全部 agent；`agentPresets` 负责筛出本 preset。
 * Root 监听器不随本 fiber 卸载，所以显式用 `ctx.effect` 持有它的 disposer。
 */
export function registerRootToolPolicy(ctx) {
    const listenCtx = ctx.root ?? ctx;
    if (typeof listenCtx.on !== 'function')
        return;
    const install = () => listenCtx.on?.('agent/created', (payload) => {
        try {
            const agent = payload?.agent;
            if (!isCapitalAgent(ctx, agent))
                return;
            const outcome = restrictRootAgentTools(agent);
            if (outcome === 'unavailable') {
                ctx.logger?.warn(`capital-generation: 根 Agent 工具收敛未生效（${outcome}）：主 Agent 仍会看到 ${ROOT_AGENT_DENIED_TOOLS.join(' / ')}`);
            }
        }
        catch (error) {
            ctx.logger?.warn(`capital-generation: 根 Agent 工具收敛异常：${error instanceof Error ? error.message : String(error)}`);
        }
    });
    if (typeof ctx.effect === 'function') {
        ctx.effect(() => {
            const dispose = install();
            return () => {
                if (typeof dispose === 'function')
                    dispose();
            };
        }, 'capital-generation.root-tool-policy()');
        return;
    }
    install();
}
