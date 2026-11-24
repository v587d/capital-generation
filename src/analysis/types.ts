/**
 * Contracts shared by the `tools/analysis` family, the host validation layer and the Python module
 * protocol. Phase 0 fixes the shapes only: nothing here reads, writes or executes yet.
 *
 * Protocol versions are literals, not configuration: a module built for v1 must not be run under a
 * v2 request shape, and the mismatch has to fail loudly rather than be coerced.
 */

export const ANALYSIS_PROTOCOL = 'capital.analysis/v1'
export const AGENT_MESSAGE_PROTOCOL = 'capital.agent.message/v1'

/** Stable error codes (`docs/dev/senior-analysis.md` §1.9). Adding one is a protocol change. */
export const ANALYSIS_ERROR_CODES = [
  'analysis_snapshot_invalid',
  'analysis_snapshot_expired',
  'analysis_ref_unauthorized',
  'analysis_module_not_found',
  'analysis_module_not_applicable',
  'analysis_input_invalid',
  'analysis_runtime_not_ready',
  'analysis_timeout',
  'analysis_cancelled',
  'analysis_output_invalid',
  'analysis_result_too_large',
  'analysis_validation_failed',
  'analysis_peer_budget_exhausted',
  'analysis_not_implemented',
] as const
export type AnalysisErrorCode = (typeof ANALYSIS_ERROR_CODES)[number]

/** One tool failure. The code travels in the message so a model can act on it without a parser. */
export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode

  constructor(code: AnalysisErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'AnalysisError'
    this.code = code
  }
}

export type AnalysisStatus = 'completed' | 'partial' | 'blocked' | 'failed'
export type ArtifactStatus = Exclude<AnalysisStatus, 'failed'>
export type EvidenceLevel = 'sufficient' | 'limited' | 'insufficient'
export type ValidationStatus = 'pass' | 'warning'
export type EvidenceKind = 'filing' | 'news' | 'research' | 'user_material'
export type EvidenceVerification = 'verified_official' | 'unverified' | 'not_verified'
export type ClaimType = 'fact' | 'observation' | 'inference' | 'hypothesis'
export type Confidence = 'low' | 'medium' | 'high'
export type AnchorSourceKind = 'dataset' | 'profile' | 'evidence' | 'computation'

/** Bounded structured evidence item; the full document body stays with the retriever/OCR layer. */
export interface EvidenceItem {
  readonly source_id: string
  readonly kind: EvidenceKind
  readonly title: string
  readonly source?: string
  readonly published_at?: string
  readonly url?: string
  readonly excerpt?: string
  readonly verification: EvidenceVerification
}

/** Reference to a stored Dataset: the senior analyst never receives its rows. */
export interface DatasetRefLike {
  readonly dataset_id: string
  readonly params_digest?: string
  readonly captured_at?: number
}

export interface ProfileRefLike {
  readonly profile_id: string
  readonly created_at?: number
}

/** Frozen analysis input. Stores references and digests only — never raw rows. */
export interface AnalysisSnapshot {
  readonly analysis_id: string
  readonly task_id: string
  readonly question: string
  readonly instrument?: string
  readonly purpose: 'observe' | 'research' | 'holding_review'
  readonly horizon?: string
  readonly depth: 'quick' | 'standard' | 'deep'
  readonly as_of: string
  readonly data_cutoff?: string
  readonly dataset_refs: readonly DatasetRefLike[]
  readonly profile_refs: readonly ProfileRefLike[]
  readonly evidence: readonly EvidenceItem[]
  readonly prior_analysis_refs: readonly string[]
  readonly constraints: Readonly<Record<string, unknown>>
  readonly input_fingerprint: string
  readonly created_at: number
  /** `min(created_at + 7d, earliest input retention)`; past this the snapshot must not be run. */
  readonly expires_at: number
  readonly limitations: readonly string[]
}

export interface NumberAnchor {
  readonly value: number
  readonly unit: string
  readonly period?: string
  readonly source: { readonly kind: AnchorSourceKind; readonly ref: string }
  readonly precision?: number
}

export interface Calculation {
  readonly calculation_id: string
  readonly module_id: string
  readonly module_version: string
  readonly metric: string
  readonly value: number
  readonly unit: string
  readonly params_digest?: string
}

export interface Claim {
  readonly claim_id: string
  readonly type: ClaimType
  readonly statement: string
  readonly evidence_refs: readonly string[]
  readonly number_anchors: readonly NumberAnchor[]
  readonly confidence: Confidence
  readonly confidence_basis?: string
  readonly falsifier?: string
  readonly limitations?: readonly string[]
}

export interface PeerExchange {
  readonly peer: string
  readonly type: string
  readonly request_id: string
  readonly answered: boolean
}

export interface ValidationIssue {
  readonly code: string
  readonly severity: 'error' | 'warning' | 'notice'
  readonly field?: string
  readonly detail: string
}

/** What the senior analyst submits. `validation` is written by the host, not by the model. */
export interface AnalysisArtifact {
  readonly analysis_id: string
  readonly task_id: string
  readonly snapshot_id: string
  readonly status: ArtifactStatus
  readonly evidence_level: EvidenceLevel
  readonly headline: string
  readonly thesis: string
  readonly support_claims: readonly Claim[]
  readonly counter_claims: readonly Claim[]
  readonly alternative_explanations: readonly string[]
  readonly contradictions: readonly string[]
  readonly calculations: readonly Calculation[]
  readonly scenarios: readonly unknown[]
  readonly invalidation_conditions: readonly string[]
  readonly unresolved_gaps: readonly string[]
  readonly limitations: readonly string[]
  readonly methods_used: readonly { readonly module_id: string; readonly module_version: string }[]
  readonly peer_exchanges: readonly PeerExchange[]
  readonly validation?: { readonly status: ValidationStatus; readonly issues: readonly ValidationIssue[] }
}

/** `roles` uses the semantic key `senior_analyst`, never the preset id. */
export interface ModuleManifest {
  readonly id: string
  readonly version: string
  readonly entrypoint: string
  readonly runtime: 'python'
  readonly description: string
  readonly roles: readonly string[]
  /** Enforced whitelist: an undeclared capability makes the module not applicable. */
  readonly capabilities: readonly ('dataset.read' | 'profile.read' | 'evidence.read')[]
  readonly required_fields: readonly string[]
  readonly input_schema: Readonly<Record<string, unknown>>
  readonly output_schema: Readonly<Record<string, unknown>>
  readonly assumptions: readonly string[]
  readonly applicability: readonly string[]
  readonly limits: ModuleLimits
  readonly provenance: ModuleProvenance
}

export interface ModuleLimits {
  readonly timeout_ms: number
  readonly max_input_rows: number
  readonly max_output_bytes: number
  readonly max_log_bytes: number
}

export interface ModuleProvenance {
  readonly source_type: 'original' | 'adapted'
  readonly repository?: string
  readonly commit?: string
  readonly license: string
}

export interface ModuleRequest {
  readonly protocol: typeof ANALYSIS_PROTOCOL
  readonly task_id: string
  readonly analysis_id: string
  readonly module_run_id: string
  readonly snapshot_id: string
  readonly as_of: string
  readonly inputs: {
    readonly datasets: readonly DatasetRefLike[]
    readonly profiles: readonly ProfileRefLike[]
    readonly evidence: readonly EvidenceItem[]
  }
  readonly params: Readonly<Record<string, unknown>>
}

export interface ModuleResult {
  readonly status: AnalysisStatus
  readonly summary: string
  readonly metrics: Readonly<Record<string, number | string | null>>
  readonly claims: readonly Claim[]
  readonly assumptions: readonly string[]
  readonly methodology_log: readonly string[]
  readonly sensitivity: Readonly<Record<string, unknown>>
  readonly limitations: readonly string[]
  readonly data_gaps: readonly string[]
  readonly outputs: readonly { readonly name: string; readonly ref: string }[]
}

/** The six model-facing tools of the `tools/analysis` family, in registration order. */
export const ANALYSIS_TOOL_NAMES = [
  'create_analysis_snapshot',
  'read_profile',
  'list_analysis_modules',
  'describe_analysis_module',
  'run_analysis',
  'submit_analysis',
] as const
export type AnalysisToolName = (typeof ANALYSIS_TOOL_NAMES)[number]
