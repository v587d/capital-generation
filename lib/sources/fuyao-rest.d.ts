import type { Context } from '@deepseek-ai/cordis';
import type { DataSource } from '../data-collector/hub.js';
/** API key resolved per execution; credentials service caches nothing across calls. */
export type FuyaoApiKeyResolver = () => Promise<string | undefined>;
declare const MAX_BATCH_CODES = 100;
/** Upstream max end - start is 10 years (overrun returns 1003); 3660 days is a conservative pre-check. */
declare const MAX_HISTORY_WINDOW_MS: number;
export declare function createFuyaoRestSources(resolveApiKey: FuyaoApiKeyResolver, baseUrl?: string): DataSource[];
export declare function resolveFuyaoApiKey(ctx: Context, credentialRef?: string): Promise<string | undefined>;
export { MAX_HISTORY_WINDOW_MS, MAX_BATCH_CODES };
