import type { Context } from '@deepseek-ai/cordis';
import type { DataSource } from '../data-collector/hub.js';
/** 每次执行时解析 API Key 的注入点：符合 credentials 服务「按次解析、不跨操作缓存」的约定。 */
export type FuyaoApiKeyResolver = () => Promise<string | undefined>;
/** 批量代码接口的原始 token 上限（按文档：去重前校验）。 */
declare const MAX_BATCH_CODES = 100;
/**
 * 历史 K 线 / 财务时间区间上限：上游规定 end - start 不超过 10 年（超出返回 1003）。
 * 本地用 3660 天（含闰日冗余）保守前置拦截，只挡明显越界，不与上游口径冲突。
 */
declare const MAX_HISTORY_WINDOW_MS: number;
export declare function createFuyaoRestSources(resolveApiKey: FuyaoApiKeyResolver, baseUrl?: string): DataSource[];
export declare function resolveFuyaoApiKey(ctx: Context): Promise<string | undefined>;
export { MAX_HISTORY_WINDOW_MS, MAX_BATCH_CODES };
