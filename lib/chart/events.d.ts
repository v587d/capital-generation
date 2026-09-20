import type { SessionLike } from '../data-collector/store.js';
/**
 * 登记本轮交付物用的官方事件名。
 *
 * 必须留在 `KNOWN_SESSION_EVENT_TYPES` 内——它是 `dsh-tool-present` 追加的同一类型，
 * 因此在**任何** harness 版本上都能被读回。改这里等于改会话日志契约，
 * `test/chart-turn-events.test.mjs` 有一条断言把它钉在 first-party 词汇表上。
 */
export declare const CHART_DELIVERABLE_EVENT = "deliverables/presented";
/** `callId` 前缀：交付事件里携带的图表句柄（官方契约只要求非空字符串）。 */
export declare const CHART_CALL_ID_PREFIX = "capital-chart:";
/** 同一 (session, turn) 的事件上限：防模型循环，超出只告警。 */
export declare const MAX_CHARTS_PER_TURN = 8;
/** 向上找根会话的最大跳数（main → data_junior → specialist 只有一跳，留余量）。 */
export declare const MAX_OWNER_HOPS = 4;
interface AppendableSession extends SessionLike {
    append(type: string, data: unknown): unknown;
}
interface SessionsService {
    get(id: string): unknown;
}
/** 宿主 ctx 里本模块用到的部分；focused 结构类型便于单测注入假实现。 */
export interface ChartEventContext {
    get(name: string): unknown;
    /** 监听会话事件（`turn/start`，仅作**兜底**冲刷）。必须注册在未打 scope 标签的 root context 上。 */
    on?(event: string, listener: (...args: unknown[]) => void): unknown;
    /**
     * 监听 `agent/turn-stopping`：**首选的冲刷时机**。
     *
     * 为什么必须是它而不是 `turn/start`：一轮是否"最终"在事件发生的那一刻不可知——子 Agent 的
     * 结算随时会再触发新一轮。实测（2026-09-20 真机 session `38bad3f9`）：图表在 turn 4 与 5 之间
     * 寄存，旧规则在下一次 `turn/start` 立刻冲刷，于是交付行落进了**空的过程轮** turn 5，而主 Agent
     * 写下总结答复的是 turn 6——卡片出现在中间步骤。`agent/turn-stopping` 是官方"该轮即将关闭"的
     * 钩子（`@mode serial`，轮仍打开、可安全 append），在它上面冲刷，交付行就落进**消费这份图的那一轮**。
     *
     * 必须注册在未打 scope 标签的 root context 上：`dsh-scope` 的准入规则会让 standing-scope 的
     * 监听器收不到子 Agent 的事件，而我们要的正是 owner 自己那轮关闭的事实。
     */
    onTurnStopping?(listener: (...args: unknown[]) => void): unknown;
    effect?(callback: () => unknown, label?: string): unknown;
    /** Root context（未打标签）；拿不到时退回自身（宿主平面行即未打标签）。 */
    readonly root?: ChartEventContext;
    logger?: {
        warn(message: string): void;
    };
}
export interface ChartTurnEventInput {
    /** 出图时 chart_ref 的 owner scope（与 ChartArtifactRegistry 同一套语义）。 */
    ownerSessionId: string;
    chart_id: string;
    title: string;
    /** 工作区相对的 chart.html 路径（官方 preview 按 session.cwd 解析它）。 */
    html_path: string;
}
export interface ChartEventPublisher {
    /**
     * 记录一张图。
     * @returns 是否已受理：立即写入、或已寄存等下一个回合都算受理。
     */
    publish(input: ChartTurnEventInput): boolean;
    /** 诊断：还没拿到回合、寄存中的图表数。 */
    pendingCount?(ownerSessionId?: string): number;
}
/**
 * 从 owner scope 出发向上走到根会话：用户看的是根会话的对话流，卡片必须挂在它上面。
 * 找不到（会话已回收）时返回 undefined，调用方静默跳过。
 */
export declare function resolveOwnerSession(sessions: SessionsService, ownerSessionId: string, maxHops?: number): AppendableSession | undefined;
/**
 * 官方 `deliverables/presented` 载荷。
 *
 * 形状与 `dsh-tool-present` 逐字段对齐（那边是 `{ turn, callId, files }`，
 * 客户端 `isPresentedData()` 要求 `turn` 是 >=1 的安全整数、`callId` 非空字符串、
 * `files` 是数组）。`files[].path` 必须是**工作区相对**路径：官方打开动作会拿它去
 * `workspaceFiles.stat({ sessionId, workspaceRoot: session.cwd })` 解析，绝对路径过不了
 * 「Presented file has no verified Host path」这一关。
 *
 * `callId` 只是官方契约里的一个非空字符串句柄，没有配对约束（`present` 那边用来关联
 * tool/result），这里借它携带 `chart_id`，便于在日志里把一条交付回溯到具体图表。
 */
export declare function buildChartEventPayload(input: ChartTurnEventInput, turn: number): Record<string, unknown>;
/**
 * 惰性构造发布器：`sessions` / `sessionProjections` 缺一不可（都是宿主平面服务，
 * 在 preset scope 里正常可解析；缺失表示宿主组合不完整，此时静默降级）。
 */
export declare function createChartEventPublisher(ctx: ChartEventContext): ChartEventPublisher | undefined;
/** 出图时的 owner scope：与 chart_ref 同源（specialist 出图时正好是主会话）。 */
export declare function chartEventOwnerSessionId(session: SessionLike, sourceSession?: SessionLike): string;
export {};
