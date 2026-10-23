import type { SessionLike } from '../data-collector/store.js';
/** Must stay in `KNOWN_SESSION_EVENT_TYPES`; test/chart-turn-events.test.mjs pins it. */
export declare const CHART_DELIVERABLE_EVENT = "deliverables/presented";
/** `callId` only needs to be a non-empty string; carries the chart handle for log tracing. */
export declare const CHART_CALL_ID_PREFIX = "capital-chart:";
/** Per (session, turn) cap: stops model loops; overflow warns only. */
export declare const MAX_CHARTS_PER_TURN = 8;
/** Root lookup cap (main → data_junior → specialist is one hop, plus headroom). */
export declare const MAX_OWNER_HOPS = 4;
interface AppendableSession extends SessionLike {
    append(type: string, data: unknown): unknown;
}
interface SessionsService {
    get(id: string): unknown;
}
/** Subset of host ctx used here; structural so tests can inject fakes. */
export interface ChartEventContext {
    get(name: string): unknown;
    /** Fallback flush listener; must be registered on the unscoped root context. */
    on?(event: string, listener: (...args: unknown[]) => void): unknown;
    /** Preferred flush hook: open-but-closing turn, on the unscoped root ctx (scoped listeners miss
     * child events). A missing disposer must keep the turn/start fallback active. */
    onTurnStopping?(listener: (...args: unknown[]) => void): unknown;
    effect?(callback: () => unknown, label?: string): unknown;
    /** Unscoped root context; falls back to self when absent. */
    readonly root?: ChartEventContext;
    logger?: {
        warn(message: string): void;
    };
}
export interface ChartTurnEventInput {
    /** chart_ref owner scope (same semantics as ChartArtifactRegistry). */
    ownerSessionId: string;
    chart_id: string;
    title: string;
    /** Workspace-relative chart.html path; the official preview resolves it against session.cwd. */
    html_path: string;
}
export interface ChartEventPublisher {
    publish(input: ChartTurnEventInput): boolean;
    /** One first-party event carrying every file; the turn cap counts events, not files. */
    publishMany(ownerSessionId: string, inputs: ChartTurnEventInput[]): boolean;
    /** Diagnostics: queued charts not yet written. */
    pendingCount?(ownerSessionId?: string): number;
    /** Diagnostics: last publish trace, surfaced in receipts / disk so failures are visible without a terminal. */
    lastTrace?(): string;
}
export declare function chartEventPublishTrace(): string;
/** Diagnostic switch; off by default to keep terminals and workspaces clean. */
export declare function chartTraceEnabled(): boolean;
/** Walk up to the root session — the user watches the root conversation. Missing session → undefined. */
export declare function resolveOwnerSession(sessions: SessionsService, ownerSessionId: string, maxHops?: number): AppendableSession | undefined;
/** Matches `dsh-tool-present` ({ turn, callId, files }); files[].path must be workspace-relative
 * because the official open action resolves it against session.cwd. */
export declare function buildChartEventPayload(input: ChartTurnEventInput, turn: number): Record<string, unknown>;
/** Safety valve if flushing never fires; metadata only, bounded against unbounded growth. */
export declare const MAX_PENDING_CHARTS = 64;
/** Test-only: clear the shared queue between cases. */
export declare function resetChartEventPending(): void;
export declare function createChartEventPublisher(ctx: ChartEventContext): ChartEventPublisher | undefined;
/** Test-only: drop the singleton cache. */
export declare function resetChartEventPublisher(): void;
/** Owner scope at render time; same source as chart_ref (specialist renders land on the main session). */
export declare function chartEventOwnerSessionId(session: SessionLike, sourceSession?: SessionLike): string;
export {};
