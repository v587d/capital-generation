/**
 * JSON Schemas for the analysis family and the module protocol. One carrier per shape: tools,
 * host validation and the worker all read these, so a hand-written second copy would drift.
 *
 * `additionalProperties: false` everywhere is deliberate — an undeclared field is a protocol
 * change, and silently accepting it would make the artifact contract a suggestion.
 */
/**
 * Submit-time budgets; exceeding one names the offending section (`analysis_result_too_large`).
 * 30k: a comprehensive multi-period artifact naturally lands at 20–22k, and a 20k cap made the
 * model rewrite the same artifact for minutes instead of finishing (2026-11-25 real session).
 */
export declare const ARTIFACT_MAX_CHARS = 30000;
export declare const HEADLINE_MAX_CHARS = 300;
export declare const THESIS_MAX_CHARS = 1200;
export declare const STATEMENT_MAX_CHARS = 600;
export declare const MAX_CLAIMS = 20;
export declare const MAX_SCENARIOS = 8;
/** §5.6-2 peer round-trip budget per task_id. The send edge stops the fourth request; this is the record check. */
export declare const MAX_PEER_EXCHANGES = 3;
/** Bounded evidence intake: single item bytes and total count. */
export declare const EVIDENCE_ITEM_MAX_BYTES = 2048;
export declare const EVIDENCE_MAX_ITEMS = 20;
/** `expires_at = min(created_at + 7d, earliest input retention)`. */
export declare const SNAPSHOT_TTL_MS: number;
/** Module limits when a manifest omits one; the manifest may only tighten them. */
export declare const MODULE_DEFAULT_LIMITS: {
    readonly timeout_ms: 30000;
    readonly max_input_rows: 200000;
    readonly max_output_bytes: 1048576;
    readonly max_log_bytes: 65536;
};
export declare const EVIDENCE_SCHEMA: Record<string, unknown>;
export declare const NUMBER_ANCHOR_SCHEMA: Record<string, unknown>;
export declare const CLAIM_SCHEMA: Record<string, unknown>;
export declare const CALCULATION_SCHEMA: Record<string, unknown>;
export declare const PEER_EXCHANGE_SCHEMA: Record<string, unknown>;
export declare const SCENARIO_SCHEMA: Record<string, unknown>;
/** `submit_analysis` parameters: the final artifact, minus the host-written `validation`. */
export declare const ANALYSIS_ARTIFACT_SCHEMA: Record<string, unknown>;
export declare const MODULE_MANIFEST_SCHEMA: Record<string, unknown>;
export declare const MODULE_REQUEST_SCHEMA: Record<string, unknown>;
/** Worker result. `outputs` carry refs only; large payloads live under `modules/<id>/outputs/`. */
export declare const MODULE_RESULT_SCHEMA: Record<string, unknown>;
/** `context.read_dataset` shape handed to a module; `rows` never crosses the tool boundary. */
export declare const DATASET_VIEW_SCHEMA: Record<string, unknown>;
export declare const CREATE_SNAPSHOT_PARAMETERS: Record<string, unknown>;
export declare const CREATE_SNAPSHOT_OUTPUT: Record<string, unknown>;
export declare const READ_PROFILE_PARAMETERS: Record<string, unknown>;
/** Bounded profile facts; `hint` is present when the payload was cut by the shared size gate. */
export declare const READ_PROFILE_OUTPUT: Record<string, unknown>;
export declare const LIST_MODULES_OUTPUT: Record<string, unknown>;
export declare const DESCRIBE_MODULE_OUTPUT: Record<string, unknown>;
export declare const LIST_MODULES_PARAMETERS: Record<string, unknown>;
export declare const DESCRIBE_MODULE_PARAMETERS: Record<string, unknown>;
export declare const RUN_ANALYSIS_PARAMETERS: Record<string, unknown>;
export declare const RUN_ANALYSIS_OUTPUT: Record<string, unknown>;
export declare const SUBMIT_ANALYSIS_OUTPUT: Record<string, unknown>;
