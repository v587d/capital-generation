/**
 * Fuyao REST 的最小请求内核：**零 import 的叶子模块**。
 *
 * 为什么单独一份：host 平面的嵌套包（`capital-watchlist/index.js`）与插件侧的数据能力
 * （`fuyao-rest.ts`）必须共用同一套 base URL、鉴权头、信封 `code` 判定与错误文案——
 * "同一知识只有一份实现"（AGENTS.md §9.7）。这一层一旦被别的模块拖进来，host 半边
 * 就会顺带加载整棵插件依赖树，所以这里不放校验器、能力定义、也不放任何类型依赖。
 *
 * 错误文案逐字保持历史形态（Agent 与用户看到的字符串不能因抽取而漂移）；结构化的
 * `kind` / `code` 是给自选股那一类需要映射成自己错误码的消费者用的。
 */
export declare const DEFAULT_FUYAO_BASE_URL = "https://fuyao.aicubes.cn";
/** 单值参数长度上限；与历史 `MAX_PARAM_LENGTH` 同值。 */
export declare const FUYAO_MAX_PARAM_LENGTH = 2048;
export type FuyaoApiEnvelope = {
    code?: number;
    message?: string;
    request_id?: string;
    data?: unknown;
};
export type FuyaoParams = Record<string, unknown>;
/** 失败归类：`http_429` 与 `code=4001` 都是限流，`closed` 是能力级不可用（重试无意义）。 */
export type FuyaoFailureKind = 'credential_missing' | 'rate_limited' | 'capability_closed' | 'invalid_parameter' | 'http_error' | 'upstream_error';
export declare class FuyaoError extends Error {
    readonly kind: FuyaoFailureKind;
    readonly status?: number;
    readonly code?: number;
    readonly requestId?: string;
    constructor(kind: FuyaoFailureKind, message: string, details?: {
        status?: number;
        code?: number;
        requestId?: string;
    });
}
export declare function normalizeFuyaoBaseUrl(baseUrl: string): string;
/** 只带上声明过的参数；类型与长度不符就拒，绝不把拼写错误的键悄悄发上去。 */
export declare function fuyaoQuery(params: FuyaoParams, allowed: string[]): URLSearchParams;
/**
 * 发一次 Fuyao 请求并返回信封。调用方自己决定如何消费 `data`；
 * 非 0 信封、非 2xx HTTP、2004 能力封闭都以 `FuyaoError` 抛出，文案与历史一致。
 */
export declare function fuyaoRequest(input: {
    baseUrl: string;
    apiKey: string | undefined;
    path: string;
    search: URLSearchParams;
    signal: AbortSignal;
}): Promise<FuyaoApiEnvelope>;
/** 行数组位置：这些端点的行都在 `data.item` 下（信封里 `data` 可能为 null）。 */
export declare function fuyaoItems(envelope: FuyaoApiEnvelope): FuyaoParams[];
/** `data.timestamp`（毫秒）；无有效数据时上游给 null，不补零。 */
export declare function fuyaoTimestamp(envelope: FuyaoApiEnvelope): number | null;
