import type { Context } from '@deepseek-ai/cordis';
import { WebRetriever } from './retriever.js';
import type { WindClient } from './wind-client.js';
import type { LocalFetchOptions } from './local-fetch.js';
import { type AgentExecutionLike } from '../tool-exec.js';
import { type WorkspaceDatasetStore } from '../data-collector/store.js';
import { type PaddleOcrClient } from '../ocr/client.js';
/**
 * Use the framework's exec shape (`src/tool-exec.ts`): `ocr` needs the caller
 * session; a self-made shape would bypass the real `header.cwd` path.
 */
type ToolExecLike = AgentExecutionLike;
interface RetrievalTrace {
    provider: string;
    tool: string;
    query: string;
    at: number;
    via?: string;
}
/**
 * Per-caller-session, in-memory: capped recent retrievals plus per-provider tally.
 * Advisory only (never blocks); retriever/client stay stateless.
 */
interface RetrievalEcho {
    recent: RetrievalTrace[];
    tally: Record<string, number>;
    /** The stored trace just written, so callers can backfill `via`. */
    entry: RetrievalTrace;
    /** Fresh snapshot after backfilling `entry.via`. */
    snapshot: () => RetrievalTrace[];
}
/**
 * Search family: anysearch search/fetch plus the two wind_docs tools. `echo` is
 * per registration (one family row), so its receipts cover only this family.
 */
export declare function registerSearchTools(ctx: Context, retriever: WebRetriever, windClient: WindClient, echo?: (exec: ToolExecLike, entry: RetrievalTrace) => RetrievalEcho): void;
/**
 * Legacy single-bundle entry: search, wind and ocr tools share one echo, matching
 * the old monolith behavior.
 */
export declare function registerWebRetrieverTools(ctx: Context, retriever: WebRetriever, windClient: WindClient, ocr: OcrToolDependencies): void;
/** Register only `ocr` (root keeps local document parsing, no search/source tools). */
export declare function registerOcrTool(ctx: Context, ocr: OcrToolDependencies, echo?: (exec: ToolExecLike, entry: RetrievalTrace) => RetrievalEcho): void;
/** `ocr` deps: upstream client + workspace store (shared with Dataset). */
export interface OcrToolDependencies {
    store: WorkspaceDatasetStore;
    client: PaddleOcrClient;
    /** Injectable for tests pinning `created_at`. */
    now?: () => number;
    /** Test-only DNS override; production never sets it. */
    resolveAddresses?: LocalFetchOptions['resolveAddresses'];
}
/**
 * Source output budget = 75% of the host's 8192 tool-result pruning threshold.
 * Over that, the middle is silently pruned while `count` still claims the full total.
 */
export declare const SOURCE_OUTPUT_BUDGET_CHARS = 6144;
/**
 * Nine source tools depend only on HTTP egress, so they register independently of
 * AnySearch/Wind config. `enabled=false` still registers but each call fails loudly
 * naming the settings switch, so the switch semantics hold for user and model.
 */
export declare function registerSourceTools(ctx: Context, localFetchOptions: LocalFetchOptions & {
    enabled?: boolean;
}): void;
export {};
