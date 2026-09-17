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
export declare const ROOT_AGENT_DENIED_TOOLS: readonly ["render_chart", "subagent_visualization_specialist", "prepare_chart_source"];
/** 本 preset 的 id（`composedPreset` 的返回值）。 */
export declare const CAPITAL_PRESET_ID = "capital-generation";
interface ToolRestriction {
    allow?: readonly string[];
    deny?: readonly string[];
}
interface RestrictedToolRuntime {
    restrict?(filter: ToolRestriction): unknown;
}
/** 事件载荷里我们真正用到的 Agent 形状。 */
export interface AgentLike {
    readonly session?: {
        readonly header?: {
            readonly parentSession?: string;
        };
    };
    readonly ctx?: {
        readonly tools?: RestrictedToolRuntime;
        readonly [key: string]: unknown;
    };
}
/** 监听用的 context 形状（结构类型，便于单测注入假实现）。 */
export interface PolicyContext {
    on?(event: string, listener: (payload: {
        agent?: AgentLike;
    }) => void): unknown;
    effect?(callback: () => unknown, label?: string): unknown;
    get?(name: string): unknown;
    logger?: {
        warn(message: string): void;
    };
    readonly root?: PolicyContext;
    readonly [key: string]: unknown;
}
export type RootToolPolicyOutcome = 'restricted' | 'skipped' | 'unavailable';
/** 根 Agent 判据：没有 parentSession。子 Agent 一律有（spawn provider 写入）。 */
export declare function isRootAgent(agent: AgentLike | undefined): boolean;
/** 只有本 preset 的 agent 才收敛：别的 preset 的 agent 不该被我们碰。 */
export declare function isCapitalAgent(ctx: PolicyContext, agent: AgentLike | undefined): boolean;
/**
 * 只对根 Agent 生效地 deny {@link ROOT_AGENT_DENIED_TOOLS}。
 *
 * 逐名 restrict：`tools.restrict()` 对"本 scope 看不到的名字"会抛错（别的 preset、或行还没挂载），
 * 逐名调用把这种"本来就不该有"的情况变成无害跳过，而不是整批失败。
 * 任何异常都不抛出：调用方是 agent 创建路径，宁可少收敛也不能挡住建 agent。
 */
export declare function restrictRootAgentTools(agent: AgentLike | undefined): RootToolPolicyOutcome;
/**
 * 注册 `agent/created` 监听。监听器只做一件事：对本 preset 的根 Agent 收敛一次。
 *
 * 注册位置是 Root context（未打标签），因此能收到全部 agent；`agentPresets` 负责筛出本 preset。
 * Root 监听器不随本 fiber 卸载，所以显式用 `ctx.effect` 持有它的 disposer。
 */
export declare function registerRootToolPolicy(ctx: PolicyContext): void;
export {};
