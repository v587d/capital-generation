/**
 * Contracts shared by the `tools/analysis` family, the host validation layer and the Python module
 * protocol. Phase 0 fixes the shapes only: nothing here reads, writes or executes yet.
 *
 * Protocol versions are literals, not configuration: a module built for v1 must not be run under a
 * v2 request shape, and the mismatch has to fail loudly rather than be coerced.
 */
export const ANALYSIS_PROTOCOL = 'capital.analysis/v1';
export const AGENT_MESSAGE_PROTOCOL = 'capital.agent.message/v1';
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
];
/** One tool failure. The code travels in the message so a model can act on it without a parser. */
export class AnalysisError extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.name = 'AnalysisError';
        this.code = code;
    }
}
/** The six model-facing tools of the `tools/analysis` family, in registration order. */
export const ANALYSIS_TOOL_NAMES = [
    'create_analysis_snapshot',
    'read_profile',
    'list_analysis_modules',
    'describe_analysis_module',
    'run_analysis',
    'submit_analysis',
];
