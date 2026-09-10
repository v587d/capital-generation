import type { Context } from '@deepseek-ai/cordis';
import type { DataSource } from '../data-collector/hub.js';
/** 每次执行时解析 API Key 的注入点：符合 credentials 服务「按次解析、不跨操作缓存」的约定。 */
export type FuyaoApiKeyResolver = () => Promise<string | undefined>;
export declare function createFuyaoRestSources(resolveApiKey: FuyaoApiKeyResolver, baseUrl?: string): DataSource[];
export declare function resolveFuyaoApiKey(ctx: Context): Promise<string | undefined>;
