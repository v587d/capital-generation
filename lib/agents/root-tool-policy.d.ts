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
/**
 * 出网工具名（唯一一份事实来源）：检索面 2 + wind 2 + 具名来源查询面 9。
 *
 * ⚠️ **不含 `ocr`**：主 Agent 保留它的本地形态（`file` / `doc_id`），只由
 * {@link rootOcrGuardReason} 关掉 `url` 形态——名字级 deny 做不到这个区分。
 *
 * 主 Agent 侧「外部检索只经 web_retriever 回传」必须是**结构件**，不能只写在 persona 里：
 * 2026-09-24 review 复现——persona 禁直连清单当时写的是 `web_retriever_*` 通配，工具改名后
 * 通配一个都不匹配，禁令名存实亡，而工具表里那 13 个入口始终摆着。逐名 deny 由本清单决定，
 * preset 与测试都从这里取名字（`test/persona.test.mjs` 交叉核验），新增来源只改这一处。
 */
export declare const RETRIEVAL_DENIED_TOOLS: readonly ["anysearch_search", "web_retriever_fetch", "wind_docs_announcements", "wind_docs_news", "cls_telegraph", "wscn_lives", "cninfo_irm", "sseinfo_qa", "eastmoney_724", "eastmoney_stock_news", "eastmoney_reports", "sina_reports", "ths_eps_forecast"];
/** 文档解析工具名（`web_retriever` 的第三个工作面）。 */
export declare const OCR_TOOL_NAME = "ocr";
/**
 * 根 Agent 的 `ocr` 只放行**本地形态**（`file` / `doc_id`），`url` 形态拒绝。
 *
 * 为什么不整名 deny：用户把 PDF 放在工作目录用 `@xxx.pdf` 推给主 Agent 是正当入口，
 * 解析它不需要经过委派；但 `url` 形态等于"主 Agent 自己决定去戳一个外部链接"，
 * 那是「外部检索只经 web_retriever」这条结构约束唯一被留的口子。名字级 deny 做不到
 * 这个区分（`render_chart` 的教训一样：可见性不是权限），所以用调用级 guard。
 */
export declare const OCR_ROOT_URL_DENIED: string;
/** 单次调用的判定：根 Agent 用 `ocr` 提交外部 `url` 才拒绝，其余一律放行。 */
export declare function rootOcrGuardReason(exec: GuardedExecution | undefined): string | undefined;
export declare const ROOT_AGENT_DENIED_TOOLS: readonly ["render_chart", "subagent_visualization_specialist", "prepare_chart_source", "anysearch_search", "web_retriever_fetch", "wind_docs_announcements", "wind_docs_news", "cls_telegraph", "wscn_lives", "cninfo_irm", "sseinfo_qa", "eastmoney_724", "eastmoney_stock_news", "eastmoney_reports", "sina_reports", "ths_eps_forecast", "web_search", "web_fetch", "bash", "pwsh"];
/** 本 preset 的 id（`composedPreset` 的返回值）。 */
export declare const CAPITAL_PRESET_ID = "capital-generation";
interface ToolRestriction {
    allow?: readonly string[];
    deny?: readonly string[];
}
/**
 * `ctx.tools` 里本仓真正用到的两个方法。
 *
 * `guard` 是单调执行闸门（`dsh-tools` 的 `ToolGuard`）：同步检查一次调用，返回字符串即拒绝，
 * **没有 allow 结果**，所以任何监听顺序都翻不回 allow。bash 闸门（`bash-guard.ts`）用它，
 * 因为「只按调用内容 deny」这件事只有这里有正确的语义。
 */
interface RestrictedToolRuntime {
    restrict?(filter: ToolRestriction): unknown;
    guard?(guard: (execution: GuardedExecution) => string | undefined): unknown;
}
/** 闸门看到的调用形状（`name` + 解析后的 `arguments` + 调用方 agent）。 */
export interface GuardedExecution {
    readonly name?: string;
    readonly arguments?: unknown;
    readonly agent?: AgentLike;
}
/** 事件载荷里我们真正用到的 Agent 形状。 */
export interface AgentLike {
    readonly session?: {
        readonly id?: string;
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
/** 会话 id（guard 归档用）；缺失或空串返回 undefined。 */
export declare function agentSessionId(agent: AgentLike | undefined): string | undefined;
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
 * 在**根 Agent 自己的 scope** 上装 `ocr` 的调用级闸门（子 Agent 不装：`url` 形态归它们）。
 *
 * 与 `restrictRootAgentTools` 同一个监听、同一份判据；guard 不可用或安装异常都不影响
 * 已经完成的 deny 收敛（宁可少一层闸门，不能挡住建 agent）。
 */
export declare function installRootOcrGuard(agent: AgentLike | undefined): (() => void) | undefined;
/**
 * 注册 `agent/created` 监听。监听器只做一件事：对本 preset 的根 Agent 收敛一次。
 *
 * 注册位置是 Root context（未打标签），因此能收到全部 agent；`agentPresets` 负责筛出本 preset。
 * Root 监听器不随本 fiber 卸载，所以显式用 `ctx.effect` 持有它的 disposer。
 */
export declare function registerRootToolPolicy(ctx: PolicyContext): void;
export {};
