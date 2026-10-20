/**
 * Chart errors are model-visible contract: detail must name the missing field and list
 * candidates, not merely say "invalid".
 */
export type ChartErrorCode =
  | 'chart_source_invalid'
  | 'chart_source_expired'
  | 'chart_source_scope_mismatch'
  | 'chart_source_not_found'
  | 'chart_ref_invalid'
  | 'chart_ref_scope_mismatch'
  | 'chart_ref_task_mismatch'
  | 'chart_spec_invalid'
  | 'chart_field_not_found'
  | 'chart_no_rows'
  | 'chart_too_large'
  | 'chart_write_failed'
  | 'chart_runtime_unavailable'

export class ChartError extends Error {
  readonly code: ChartErrorCode
  /** Machine-readable extras (e.g. available fields), serialized back to the model. */
  readonly details: Record<string, unknown>

  constructor(code: ChartErrorCode, detail: string, details: Record<string, unknown> = {}) {
    super(`${code}: ${detail}`)
    this.name = 'ChartError'
    this.code = code
    this.details = details
  }

  toEnvelope(): Record<string, unknown> {
    return { error: this.code, detail: this.message.slice(this.message.indexOf(':') + 2), ...this.details }
  }
}
