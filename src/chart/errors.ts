/**
 * 图表域的错误类型。
 *
 * 错误码是**模型可见契约**的一部分：模型据此修正一次即可重试（见
 * preset/capital-generation/skills/capital-chart-protocol/SKILL.md）。
 * 因此 detail 必须可操作（点名缺哪个字段、可用字段有哪些），而不是笼统的 invalid。
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
  /** 可选的机器可读补充（如 available 字段名列表），会随错误一起序列化回模型。 */
  readonly details: Record<string, unknown>

  constructor(code: ChartErrorCode, detail: string, details: Record<string, unknown> = {}) {
    super(`${code}: ${detail}`)
    this.name = 'ChartError'
    this.code = code
    this.details = details
  }

  /** 工具边界统一把错误转成结构化信封，让模型能一次修正。 */
  toEnvelope(): Record<string, unknown> {
    return { error: this.code, detail: this.message.slice(this.message.indexOf(':') + 2), ...this.details }
  }
}
