/**
 * Shared data_collector assembly (store + hub + 128 sources). Both `tools/collect` and
 * the monolith need it; duplicating would drift capability registration, credential
 * probes and time tools. Collector domain only — no dataset/chart/watchlist tools.
 */
import type { Context } from '@deepseek-ai/cordis';
import { provideDataCollectorHub } from './data-collector/hub.js';
import { type DataCollectorDiagnostics } from './data-collector/tools.js';
import { capitalDatasetStore } from './runtime.js';
export interface CollectorConfig {
    fuyaoCredentialRef?: string;
    ftshareCredentialRef?: string;
    /** Flat projection of `retriever.windDocs.credentialRef`. */
    windCredentialRef?: string;
}
export interface CollectorRuntime {
    store: ReturnType<typeof capitalDatasetStore>;
    hub: ReturnType<typeof provideDataCollectorHub>;
    /** Injected into `dc_status` by the caller that owns the `tools/collect` row. */
    diagnostics: DataCollectorDiagnostics;
}
export declare function createCollectorRuntime(ctx: Context, config?: CollectorConfig): CollectorRuntime;
