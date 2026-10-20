/**
 * Root Agent tool convergence on the root's own scope: preset-level deny would also hit
 * children. Listeners must live on `ctx.root`; tagged standing-scope listeners miss agent/created.
 */
/** Outbound tools (search 2 + wind 2 + named sources 9); `ocr` is excluded because only its url form is restricted. */
export declare const RETRIEVAL_DENIED_TOOLS: readonly ["anysearch_search", "web_retriever_fetch", "wind_docs_announcements", "wind_docs_news", "cls_telegraph", "wscn_lives", "cninfo_irm", "sseinfo_qa", "eastmoney_724", "eastmoney_stock_news", "eastmoney_reports", "sina_reports", "ths_eps_forecast"];
export declare const OCR_TOOL_NAME = "ocr";
/** Name-level deny cannot express the form distinction; this is a call-level guard. */
export declare const OCR_ROOT_URL_DENIED: string;
export declare function ocrUrlFormRequested(exec: GuardedExecution | undefined): boolean;
/** Read per call because a created-time gate misses manually opened modes; fail open unless a confirmed Capital root. */
export declare function ocrFormGuardReasonFor(ctx: PolicyContext): (exec: GuardedExecution | undefined) => string | undefined;
/** Mounted as a platform pair; recognize both everywhere or the other platform's gate is dead. */
export declare const SHELL_TOOL_NAMES: readonly ["bash", "pwsh"];
export declare const ROOT_AGENT_DENIED_TOOLS: readonly ["render_chart", "prepare_chart_source", "anysearch_search", "web_retriever_fetch", "wind_docs_announcements", "wind_docs_news", "cls_telegraph", "wscn_lives", "cninfo_irm", "sseinfo_qa", "eastmoney_724", "eastmoney_stock_news", "eastmoney_reports", "sina_reports", "ths_eps_forecast", "write", "edit"];
export declare const CAPITAL_PRESET_ID = "capital-generation";
interface ToolRestriction {
    allow?: readonly string[];
    deny?: readonly string[];
}
/** `guard` only returns a deny string, so listener order can never turn a deny into an allow. */
interface RestrictedToolRuntime {
    restrict?(filter: ToolRestriction): unknown;
    guard?(guard: (execution: GuardedExecution) => string | undefined): unknown;
}
export interface GuardedExecution {
    readonly name?: string;
    readonly arguments?: unknown;
    readonly agent?: AgentLike;
}
export interface AgentLike {
    readonly session?: {
        readonly id?: string;
        readonly header?: {
            readonly parentSession?: string;
        };
    };
    readonly ctx?: {
        readonly tools?: RestrictedToolRuntime;
        readonly [key: string]: unknown;
    };
}
export interface PolicyContext {
    on?(event: string, listener: (payload: {
        agent?: AgentLike;
    }) => void): unknown;
    effect?(callback: () => unknown, label?: string): unknown;
    get?(name: string): unknown;
    logger?: {
        warn(message: string): void;
    };
    readonly root?: PolicyContext;
    readonly [key: string]: unknown;
}
export type RootToolPolicyOutcome = 'restricted' | 'skipped' | 'unavailable';
export declare function isRootAgent(agent: AgentLike | undefined): boolean;
export declare function agentSessionId(agent: AgentLike | undefined): string | undefined;
export declare function isCapitalAgent(ctx: PolicyContext, agent: AgentLike | undefined): boolean;
/** Allows any Capital preset; guards for role children must use this, not the root id. */
export declare function isCapitalPresetAgent(ctx: PolicyContext, agent: AgentLike | undefined): boolean;
/** Diagnostic record surfaced via `dc_status`: silent convergence exits leave no other trace. */
export interface RootPolicyProbe {
    agentId: string | undefined;
    root: boolean;
    presetId: string;
    outcome: 'pending' | 'restricted' | 'unavailable' | 'skipped' | 'not-capital' | 'guard-denied';
    denied: string[];
    /** Non-empty means `restrict()` threw for those names and convergence was partial. */
    failed: string[];
}
/** Shares the convergence channel so opened-mode and call-level failures line up. */
export declare function recordGuardDecision(ctx: PolicyContext, exec: GuardedExecution | undefined, toolName: string): void;
export declare function rootPolicyProbes(): RootPolicyProbe[];
export declare function resetRootPolicyProbes(): void;
/** Per-name deny on the root only; name-not-visible throws become harmless skips. Never throws: called on agent creation. */
export declare function restrictRootAgentTools(agent: AgentLike | undefined, record?: {
    denied: string[];
    failed: string[];
}): RootToolPolicyOutcome;
/** Install globally once; created-time identity misses manually opened modes. */
export declare function registerRootOcrGuard(ctx: PolicyContext): void;
export declare const FS_WRITE_TOOL_NAMES: readonly ["write", "edit"];
/** Points at the allowed paths (read, tool returns) instead of leaving the caller stuck. */
export declare const FS_WRITE_READ_ONLY: string;
/** Global call-level fs guard: the host global layer registers write/edit, so per-name restrict
 * only shrinks children. Fail open unless a Capital preset is confirmed. */
export declare function fsWriteGuardReasonFor(ctx: PolicyContext): (execution: GuardedExecution) => string | undefined;
export declare function registerFsWriteGuard(ctx: PolicyContext): void;
export interface RootToolPolicyOptions {
    /** Host policy passes false: family rows already close the surface, so record only. */
    deny?: boolean;
}
export declare function registerRootToolPolicy(ctx: PolicyContext, options?: RootToolPolicyOptions): void;
export {};
