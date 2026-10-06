import type { DataSource } from '../data-collector/hub.js';
export type WindApiKeyResolver = () => Promise<string | undefined>;
/**
 * §6.7 改口后的 P1 三条。`wind_edb_*` 是 P0（EDB 是唯一来源），`wind_stock_kline` 是 P1。
 * 不接的一概有理由：price_indicators 与全部 NL 工具（中文键 / 列名是 question 的函数）、
 * bond 与 fund/index（重叠或未测）、analytics_data（实测连 initialize 都挂）。
 */
export declare function createWindSources(resolveApiKey: WindApiKeyResolver): DataSource[];
