import type { DataSource } from '../data-collector/hub.js';
export type WindApiKeyResolver = () => Promise<string | undefined>;
export declare function createWindSources(resolveApiKey: WindApiKeyResolver): DataSource[];
