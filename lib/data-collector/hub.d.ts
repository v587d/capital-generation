import type { Context } from '@deepseek-ai/cordis';
import type { DatasetRef, SaveDatasetInput, SessionLike } from './store.js';
/**
 * 规范化内部 data_key 片段：斜杠/冒号等路径分隔符一律映射为点，其余非常规
 * 字符折叠为点、合并连续点、去掉首尾点。data_key 只是宿主内部路由/审计身份，
 * 不出现在模型可见协议、人设或工具输出中。
 */
export declare function normalizeKeyToken(value: string): string;
/**
 * 生成内部 data_key：provider.kind.resource（例如
 * buildDataKey('fuyao', 'api', '/api/a-share/prices/snapshot')
 * => 'fuyao.api.api.a-share.prices.snapshot'）。
 */
export declare function buildDataKey(provider: string, kind: string, resource: string): string;
/**
 * 数据请求：capability 是模型可见的短能力名（全局唯一），session 由工具层以
 * exec.agent.session 注入，不接受模型传参。内部 data_key 不出现在请求协议里。
 */
export interface DataRequest {
    capability: string;
    params: Record<string, unknown>;
    /** force_refresh=true 绕过已验证 manifest 并生成新的不可变 Dataset。 */
    force_refresh?: boolean;
    /** 本次用户任务关联 id（可复用）；只用于追溯，不要求模型理解。 */
    task_id?: string;
    session: SessionLike;
}
/**
 * 数据源契约：capability 为唯一注册键与模型可见名；name/source/data_key
 * 均为宿主内部字段（日志、路由、审计），不得进入工具 schema、输出或人设。
 */
export interface SchemaDescriptor {
    capability: string;
    name: string;
    source: string;
    data_key: string;
    source_label?: string;
    paginated?: boolean;
    description?: string;
    input_schema: object;
    output_schema?: object;
}
export interface DataSource {
    schema: SchemaDescriptor;
    execute(request: DataRequest, signal: AbortSignal): Promise<{
        data: unknown;
        schema?: object | null;
    }>;
    /** Optional source-specific output guard; false rejects the result before persistence. */
    validateOutput?: (data: unknown) => boolean;
}
/** Dataset 落盘器（Hub 的唯一成功出口）。 */
export interface DatasetStoreLike {
    save(input: SaveDatasetInput): Promise<DatasetRef>;
    /** Optional for compatibility with lightweight test stores; production store implements manifest lookup. */
    findLatest?(input: {
        session: SessionLike;
        capability: string;
        params_digest: string;
        signal?: AbortSignal;
    }): Promise<DatasetRef | undefined>;
}
export interface DataCollectorHubOptions {
    /** 必需：宿主侧 Dataset store；缺失时 request 直接失败。 */
    store: DatasetStoreLike;
    /** 队列最大长度；默认 50。 */
    maxQueueLength?: number;
    /** 传输层执行超时；默认 30_000 ms。只是请求超时，不是数据生命周期。 */
    requestTimeoutMs?: number;
    /** 时钟注入（测试用）；默认 Date.now。 */
    now?: () => number;
}
/**
 * Phase 1 数据执行器：FIFO 串行执行外部数据源，成功后由宿主 store 立即
 * 原子落盘为不可变 Dataset，只回传 DatasetRef。
 *
 * 明确不做：长期 raw data 内存缓存、按 data_key 的查询、source_preference 路由。
 * 已验证 DatasetRef 的复用由 workspace manifest 提供，内存只保留 in-flight 队列。
 */
export declare class DataCollectorHub {
    private readonly queue;
    /** 正在执行的队列项（执行期间不在 queue 中，但仍参与合并与容量判断）。 */
    private active;
    private readonly sources;
    private readonly cacheLookups;
    private readonly store;
    private running;
    private readonly maxQueueLength;
    private readonly requestTimeoutMs;
    private readonly now;
    constructor(options: DataCollectorHubOptions);
    registerSource(source: DataSource): () => void;
    /**
     * 入队并阻塞等待完成：先按 capability+params_digest 查找当前 session 下仍有效的
     * manifest；force_refresh=true 或没有可复用 Dataset 时才进入数据源队列。相同的
     * in-flight 请求仍共享一次执行，成功后立即由宿主 store 原子落盘。
     */
    request(request: DataRequest, options?: {
        signal?: AbortSignal;
    }): Promise<DatasetRef>;
    /** 挂一个等待者并返回其结算承诺；signal 触发时摘除等待者并拒绝（不影响共享执行）。 */
    private awaitSettlement;
    /** 结算一个等待者：无论成败都摘除监听，防止重复结算。 */
    private settleWaiter;
    /**
     * 列出模型可见的能力目录：只含 capability、描述、参数/输出结构与分页能力，
     * 不含任何内部路由字段（name/source/data_key/source_label）。
     */
    listCapabilities(): Array<{
        capability: string;
        description: string;
        input_schema: object;
        output_schema: object | null;
        paginated: boolean;
    }>;
    private processNext;
}
export declare function provideDataCollectorHub(ctx: Context, options: DataCollectorHubOptions): DataCollectorHub;
declare module '@deepseek-ai/cordis' {
    interface Context {
        dataCollectorHub: DataCollectorHub;
    }
}
