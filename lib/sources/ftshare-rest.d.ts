/**
 * FTShare（非凸科技 `market.ft.tech/gateway`）REST source —— **资金流 + 行情/日 K 截面 + 快照与日历
 * + 大宗与披露 + 申万行业**。
 *
 * 为什么接这一族（2026-10-15 逐条真报文实测）：
 * - 同花顺 `capital-flow/*` 对我们是 `code=2004` 永久关闭，东财 `eastmoney_main_capital_snapshot`
 *   实测**只有查询日一股一行**——个股资金流的历史序列在本仓一直是空的。这一族给到最近约 45 个交易日
 *   （T-45 仍有 5199 行、T-50 起 total=0），主力五档更给到约 187 个交易日。
 * - 板块（行业）资金滚动此前只有 `eastmoney_cashflow_rotation` 一条，上游一抖就没有第二家。
 * - 北交所行情此前是**零**：腾讯那一路在参数层明确拒 BJ，而这一族实测含 349 只北证票。
 * 上游分别是同花顺与同花顺 daec，与现有能力**不是同一条抓取路径**，才够称 plan B。
 *
 * ⛔ 本模块的 description 与注释**只允许写有原始报文可回查的数字**。2026-10-15 曾有一批"实测计数"
 * （行数在 3766/3864/5450/5574 之间跳、`ys` 返回 309 行、业务码 100605、页码回显谎报）事后逐条回查
 * **在任何一次真报文里都不存在**，是我把不同接口的读数串成了因果；据此撤掉的两颗能力已于当晚复验注册回来。
 * 教训写进 `docs/design/ftshare-source-survey.md` §7.5–§7.7：**没打进日志的数字不算实测**。
 *
 * ⛔ 免费档限流 **10 QPS / burst 20**（官方口径）。`DataCollectorHub` 的 FIFO 只保证同一时刻
 * 一个请求，**不含最小间隔**——串行 ≠ 节流（`src/net/eastmoney-client.ts` 同一条教训）。
 * 本模块用进程级节流链把上限压到 ~8 QPS，留突发余量。
 *
 * ⛔ 凭据一律**调用期解析**，注册只看结构（AGENTS.md §9.7，2026-09-30 桌面端 61 能力静默缺席
 * 那一族事故）。套餐外路由返回 403 `route_not_allowed`，归类成 `plan_closed` 且不重试——
 * 它和 Fuyao 的 `2004` 是同一件事：能力级不可用，重试只白烧回合。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { DataSource } from '../data-collector/hub.js';
type JsonRecord = Record<string, unknown>;
/** 10 QPS 的 80% 上限：120ms 最小间隔 ⇒ 稳态 ~8.3 次/秒，突发也不会越过 20。 */
export declare const FTSHARE_MIN_INTERVAL_MS = 120;
/** 失败归类：与 `FuyaoFailureKind` 同一套语汇，`plan_closed` 对应 Fuyao 的 `capability_closed`。 */
type FtshareFailureKind = 'credential_missing' | 'rate_limited' | 'plan_closed' | 'invalid_parameter' | 'http_error' | 'upstream_error' | 'invalid_response';
export declare class FtshareError extends Error {
    readonly kind: FtshareFailureKind;
    readonly status?: number;
    readonly code?: number;
    constructor(kind: FtshareFailureKind, message: string, details?: {
        status?: number;
        code?: number;
    });
}
export interface FtshareRequester {
    getJson(path: string, search: URLSearchParams, signal: AbortSignal): Promise<JsonRecord>;
}
/** key 每次调用现取（`resolveApiKey` 由装配层注入），构造客户端不依赖 key。 */
export declare function createFtshareClient(resolveApiKey: () => Promise<string | undefined>, baseUrl?: string): FtshareRequester;
/**
 * key 每次调用现取（与 `resolveFuyaoApiKey` 同一口径）：credentials 优先、环境变量兜底。
 * ⛔ 注册面**不得**以"装配期读到 key"为条件（AGENTS.md §9.7），也不要把这里的 rejection 缓存住——
 * 一次装配期抢跑会把这个能力钉到进程结束。
 */
export declare function resolveFtshareApiKey(ctx: Context, credentialRef?: string): Promise<string | undefined>;
export declare function createFtshareSources(resolveApiKey: () => Promise<string | undefined>): DataSource[];
export {};
