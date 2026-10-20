import { type WindClient } from './web-retriever/wind-client.js';
import { type PaddleOcrClient } from './ocr/client.js';
import { WebRetriever, type LocalFetcherLike } from './web-retriever/retriever.js';
import { type LocalFetchConfig, type RetrieverConfig } from './retriever-config.js';
interface CredentialContext {
    get(name: string): unknown;
}
/** credentials first, env var fallback; resolve per call, never cache (boot-time races). */
export declare function resolveRetrieverCredential(ctx: CredentialContext, ref: string): Promise<string | undefined>;
/** Wind ref + per-call resolver; `wind_docs` and `wind_*` market data share the key. */
export declare function createWindCredentialResolver(ctx: CredentialContext, credentialRef?: string): {
    credentialRef: string;
    resolve: () => Promise<string | undefined>;
};
export interface RetrieverRuntime {
    retriever: WebRetriever;
    windClient: WindClient;
    ocrClient: PaddleOcrClient;
    localFetchConfig: Required<LocalFetchConfig>;
    resolveWindApiKey: () => Promise<string | undefined>;
    /** Reference name only (for logs/diagnostics), never the secret. */
    windCredentialRef: string;
    /** Present only when localFetch.enabled is true. */
    localFetch?: LocalFetcherLike;
}
/**
 * `config` is the raw, unvalidated object from preset/settings, so every default must be
 * applied here rather than relying on Schemastery.
 */
export declare function createRetrieverRuntime(ctx: CredentialContext, config?: RetrieverConfig): RetrieverRuntime;
export {};
