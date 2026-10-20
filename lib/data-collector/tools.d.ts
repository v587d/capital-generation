import type { Context } from '@deepseek-ai/cordis';
import { DataCollectorHub } from './hub.js';
/** dc_status diagnostics: credential presence only, never values. */
export interface DataCollectorDiagnostics {
    probeApiKey: () => Promise<{
        present: boolean;
        source: string | null;
        error?: string;
    }>;
    /**
       * Tool-surface restriction snapshot (root/role policies), restated locally so this layer does
       * not depend on the agents layer. `allowed` stays empty now that allow-lists are gone.
       */
    rootPolicy?: () => Array<{
        agentId: string | undefined;
        root: boolean;
        presetId: string;
        outcome: string;
        denied: string[];
        allowed?: string[];
        failed: string[];
    }>;
    onCall?: (snapshot: {
        at: number;
        call: number;
        apiKey: unknown;
        capabilities: string[];
    }) => void;
}
export declare function registerDataCollectorTools(ctx: Context, hub: DataCollectorHub, diagnostics?: DataCollectorDiagnostics): void;
/** Model-visible DatasetRef field whitelist (tests and host assertions). */
export declare const DATASET_REF_FIELDS: readonly ["dataset_id", "task_id", "session_id", "artifact_ref", "format", "capability", "source_label", "schema", "row_count", "captured_at", "retention_until", "params_digest"];
