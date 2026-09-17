import type { SessionLike } from '../data-collector/store.js';
/** 客户端 conversation definition 监听的事件名（`<domain>/<past-participle>`，与 deliverables 同风格）。 */
export declare const CHART_RENDERED_EVENT = "capital/chart-rendered";
/** 同一 (session, turn) 的事件上限：防模型循环，超出只告警。 */
export declare const MAX_CHARTS_PER_TURN = 8;
/** 向上找根会话的最大跳数（main → data_junior → specialist 只有一跳，留余量）。 */
export declare const MAX_OWNER_HOPS = 4;
/** warnings 只作展示：最多 3 条、每条 200 字符。 */
export declare const MAX_EVENT_WARNINGS = 3;
export declare const MAX_EVENT_WARNING_CHARS = 200;
interface AppendableSession extends SessionLike {
    append(type: string, data: unknown): unknown;
}
interface SessionsService {
    get(id: string): unknown;
}
/** 宿主 ctx 里本模块用到的部分；focused 结构类型便于单测注入假实现。 */
export interface ChartEventContext {
    get(name: string): unknown;
    /** 监听会话事件（`turn/start` 冲刷寄存的图表）。必须注册在未打 scope 标签的 root context 上。 */
    on?(event: string, listener: (...args: unknown[]) => void): unknown;
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
    chart_ref: string;
    title: string;
    kind: string;
    axis: 'time' | 'index';
    points: number;
    chart_url: string | null;
    html_path: string;
    source_label: string | null;
    captured_at: number | null;
    task_id: string | null;
    warnings: readonly unknown[];
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
/** 展示用 warnings：只留字符串、截断、限量。 */
export declare function sanitizeEventWarnings(warnings: readonly unknown[]): string[];
/** 事件的 JSON 载荷：全部是基本类型，不含 rows / series / 绝对路径。 */
export declare function buildChartEventPayload(input: ChartTurnEventInput, turn: number): Record<string, unknown>;
/**
 * 惰性构造发布器：`sessions` / `sessionProjections` 缺一不可（都是宿主平面服务，
 * 在 preset scope 里正常可解析；缺失表示宿主组合不完整，此时静默降级）。
 */
export declare function createChartEventPublisher(ctx: ChartEventContext): ChartEventPublisher | undefined;
/** 出图时的 owner scope：与 chart_ref 同源（specialist 出图时正好是主会话）。 */
export declare function chartEventOwnerSessionId(session: SessionLike, sourceSession?: SessionLike): string;
export {};
