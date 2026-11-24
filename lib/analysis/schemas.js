/**
 * JSON Schemas for the analysis family and the module protocol. One carrier per shape: tools,
 * host validation and the worker all read these, so a hand-written second copy would drift.
 *
 * `additionalProperties: false` everywhere is deliberate — an undeclared field is a protocol
 * change, and silently accepting it would make the artifact contract a suggestion.
 */
const jsonObject = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const strings = (description) => ({ type: 'array', items: { type: 'string' }, ...(description === undefined ? {} : { description }) });
// `oneOf`, not `anyOf`: the host's enforced JSON-Schema subset (dsh-tools) accepts exact-one only,
// and a tool definition outside that subset makes the whole family row unsupported at boot.
const nullable = (schema) => ({ oneOf: [schema, { type: 'null' }] });
/** Submit-time budgets; exceeding one names the offending section (`analysis_result_too_large`). */
export const ARTIFACT_MAX_CHARS = 20_000;
export const HEADLINE_MAX_CHARS = 300;
export const THESIS_MAX_CHARS = 1_200;
export const STATEMENT_MAX_CHARS = 600;
export const MAX_CLAIMS = 20;
export const MAX_SCENARIOS = 8;
/** Bounded evidence intake: single item bytes and total count. */
export const EVIDENCE_ITEM_MAX_BYTES = 2_048;
export const EVIDENCE_MAX_ITEMS = 20;
/** `expires_at = min(created_at + 7d, earliest input retention)`. */
export const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
/** Module limits when a manifest omits one; the manifest may only tighten them. */
export const MODULE_DEFAULT_LIMITS = {
    timeout_ms: 30_000,
    max_input_rows: 200_000,
    max_output_bytes: 1_048_576,
    max_log_bytes: 65_536,
};
export const EVIDENCE_SCHEMA = jsonObject({
    source_id: { type: 'string' },
    kind: { type: 'string', enum: ['filing', 'news', 'research', 'user_material'] },
    title: { type: 'string' },
    source: { type: 'string' },
    published_at: { type: 'string' },
    url: { type: 'string' },
    excerpt: { type: 'string' },
    verification: { type: 'string', enum: ['verified_official', 'unverified', 'not_verified'] },
}, ['source_id', 'kind', 'title', 'verification']);
export const NUMBER_ANCHOR_SCHEMA = jsonObject({
    value: { type: 'number' },
    unit: { type: 'string' },
    period: { type: 'string' },
    source: jsonObject({
        kind: { type: 'string', enum: ['dataset', 'profile', 'evidence', 'computation'] },
        ref: { type: 'string' },
    }, ['kind', 'ref']),
    precision: { type: 'integer' },
}, ['value', 'unit', 'source']);
export const CLAIM_SCHEMA = jsonObject({
    claim_id: { type: 'string' },
    type: { type: 'string', enum: ['fact', 'observation', 'inference', 'hypothesis'] },
    statement: { type: 'string' },
    evidence_refs: strings(),
    number_anchors: { type: 'array', items: NUMBER_ANCHOR_SCHEMA },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    confidence_basis: { type: 'string' },
    falsifier: { type: 'string' },
    limitations: strings(),
}, ['claim_id', 'type', 'statement', 'confidence']);
export const CALCULATION_SCHEMA = jsonObject({
    calculation_id: { type: 'string' },
    module_id: { type: 'string' },
    module_version: { type: 'string' },
    metric: { type: 'string' },
    value: { type: 'number' },
    unit: { type: 'string' },
    params_digest: { type: 'string' },
}, ['calculation_id', 'module_id', 'module_version', 'metric', 'value', 'unit']);
export const PEER_EXCHANGE_SCHEMA = jsonObject({
    peer: { type: 'string' },
    type: { type: 'string' },
    request_id: { type: 'string' },
    answered: { type: 'boolean' },
}, ['peer', 'type', 'request_id', 'answered']);
export const SCENARIO_SCHEMA = jsonObject({
    name: { type: 'string' },
    assumptions: strings(),
    outcome: { type: 'string' },
    triggers: strings(),
}, ['name', 'assumptions']);
/** `submit_analysis` parameters: the final artifact, minus the host-written `validation`. */
export const ANALYSIS_ARTIFACT_SCHEMA = jsonObject({
    analysis_id: { type: 'string' },
    task_id: { type: 'string' },
    snapshot_id: { type: 'string' },
    status: { type: 'string', enum: ['completed', 'partial', 'blocked'] },
    evidence_level: { type: 'string', enum: ['sufficient', 'limited', 'insufficient'] },
    headline: { type: 'string' },
    thesis: { type: 'string' },
    support_claims: { type: 'array', items: CLAIM_SCHEMA },
    counter_claims: { type: 'array', items: CLAIM_SCHEMA },
    alternative_explanations: strings(),
    contradictions: strings(),
    calculations: { type: 'array', items: CALCULATION_SCHEMA },
    scenarios: { type: 'array', items: SCENARIO_SCHEMA },
    invalidation_conditions: strings(),
    unresolved_gaps: strings(),
    limitations: strings(),
    methods_used: {
        type: 'array',
        items: jsonObject({ module_id: { type: 'string' }, module_version: { type: 'string' } }, ['module_id', 'module_version']),
    },
    peer_exchanges: { type: 'array', items: PEER_EXCHANGE_SCHEMA },
}, [
    'analysis_id', 'task_id', 'snapshot_id', 'status', 'evidence_level', 'headline', 'thesis',
    'support_claims', 'counter_claims', 'alternative_explanations', 'contradictions', 'calculations',
    'scenarios', 'invalidation_conditions', 'unresolved_gaps', 'limitations', 'methods_used', 'peer_exchanges',
]);
export const MODULE_MANIFEST_SCHEMA = jsonObject({
    id: { type: 'string' },
    version: { type: 'string' },
    entrypoint: { type: 'string' },
    runtime: { type: 'string', enum: ['python'] },
    description: { type: 'string' },
    roles: strings(),
    capabilities: { type: 'array', items: { type: 'string', enum: ['dataset.read', 'profile.read', 'evidence.read'] } },
    required_fields: strings(),
    input_schema: { type: 'object' },
    output_schema: { type: 'object' },
    assumptions: strings(),
    applicability: strings(),
    limits: jsonObject({
        timeout_ms: { type: 'integer' },
        max_input_rows: { type: 'integer' },
        max_output_bytes: { type: 'integer' },
        max_log_bytes: { type: 'integer' },
    }, ['timeout_ms', 'max_input_rows', 'max_output_bytes', 'max_log_bytes']),
    provenance: jsonObject({
        source_type: { type: 'string', enum: ['original', 'adapted'] },
        repository: { type: 'string' },
        commit: { type: 'string' },
        license: { type: 'string' },
    }, ['source_type', 'license']),
}, ['id', 'version', 'entrypoint', 'runtime', 'description', 'roles', 'capabilities', 'limits', 'provenance']);
export const MODULE_REQUEST_SCHEMA = jsonObject({
    protocol: { type: 'string', enum: ['capital.analysis/v1'] },
    task_id: { type: 'string' },
    analysis_id: { type: 'string' },
    module_run_id: { type: 'string' },
    snapshot_id: { type: 'string' },
    as_of: { type: 'string' },
    inputs: jsonObject({
        datasets: { type: 'array', items: jsonObject({ dataset_id: { type: 'string' } }, ['dataset_id']) },
        profiles: { type: 'array', items: jsonObject({ profile_id: { type: 'string' } }, ['profile_id']) },
        evidence: { type: 'array', items: EVIDENCE_SCHEMA },
    }, ['datasets', 'profiles', 'evidence']),
    params: { type: 'object' },
}, ['protocol', 'task_id', 'analysis_id', 'module_run_id', 'snapshot_id', 'as_of', 'inputs', 'params']);
/** Worker result. `outputs` carry refs only; large payloads live under `modules/<id>/outputs/`. */
export const MODULE_RESULT_SCHEMA = jsonObject({
    status: { type: 'string', enum: ['completed', 'partial', 'blocked', 'failed'] },
    summary: { type: 'string' },
    metrics: { type: 'object' },
    claims: { type: 'array', items: CLAIM_SCHEMA },
    assumptions: strings(),
    methodology_log: strings(),
    sensitivity: { type: 'object' },
    limitations: strings(),
    data_gaps: strings(),
    outputs: { type: 'array', items: jsonObject({ name: { type: 'string' }, ref: { type: 'string' } }, ['name', 'ref']) },
}, [
    'status', 'summary', 'metrics', 'claims', 'assumptions', 'methodology_log', 'sensitivity',
    'limitations', 'data_gaps', 'outputs',
]);
/** `context.read_dataset` shape handed to a module; `rows` never crosses the tool boundary. */
export const DATASET_VIEW_SCHEMA = jsonObject({
    shape: { type: 'string', enum: ['rows', 'document'] },
    columns: { type: 'array', items: jsonObject({ name: { type: 'string' }, type: { type: 'string' }, nullable: { type: 'boolean' } }, ['name', 'type', 'nullable']) },
    row_count: { type: 'integer' },
    rows: { type: 'array', items: { type: 'object' } },
    envelope: nullable({ type: 'object' }),
    time_axis: nullable(jsonObject({ column: { type: 'string' }, unit: { type: 'string' }, tz: { type: 'string' } }, ['column', 'unit', 'tz'])),
    truncated: { type: 'boolean' },
    source: jsonObject({ dataset_id: { type: 'string' }, captured_at: { type: 'integer' }, params_digest: { type: 'string' } }, ['dataset_id', 'captured_at', 'params_digest']),
}, ['shape', 'columns', 'row_count', 'rows', 'truncated', 'source']);
export const CREATE_SNAPSHOT_PARAMETERS = jsonObject({
    task_id: { type: 'string' },
    question: { type: 'string' },
    instrument: { type: 'string' },
    purpose: { type: 'string', enum: ['observe', 'research', 'holding_review'] },
    horizon: { type: 'string' },
    depth: { type: 'string', enum: ['quick', 'standard', 'deep'] },
    as_of: { type: 'string' },
    data_cutoff: { type: 'string' },
    dataset_refs: { type: 'array', items: jsonObject({ dataset_id: { type: 'string' } }, ['dataset_id']) },
    profile_refs: { type: 'array', items: jsonObject({ profile_id: { type: 'string' } }, ['profile_id']) },
    evidence: { type: 'array', items: EVIDENCE_SCHEMA },
    prior_analysis_refs: strings(),
    constraints: { type: 'object' },
}, ['task_id', 'question', 'purpose', 'depth', 'as_of']);
export const CREATE_SNAPSHOT_OUTPUT = jsonObject({
    analysis_snapshot_ref: { type: 'string' },
    analysis_id: { type: 'string' },
    input_fingerprint: { type: 'string' },
    expires_at: { type: 'string' },
    coverage: { type: 'object' },
    limitations: strings(),
}, ['analysis_snapshot_ref', 'analysis_id', 'input_fingerprint', 'expires_at', 'coverage', 'limitations']);
export const READ_PROFILE_PARAMETERS = jsonObject({
    profile_ref: { type: 'string' },
    columns_of_interest: strings(),
}, ['profile_ref']);
/** Bounded profile facts; `hint` is present when the payload was cut by the shared size gate. */
export const READ_PROFILE_OUTPUT = jsonObject({
    profile_ref: { type: 'string' },
    columns: strings(),
    facts: { type: 'object' },
    time_axis: nullable(jsonObject({ column: { type: 'string' }, unit: { type: 'string' }, tz: { type: 'string' } }, ['column', 'unit', 'tz'])),
    hint: { type: 'string' },
}, ['profile_ref', 'columns']);
export const LIST_MODULES_OUTPUT = jsonObject({
    modules: {
        type: 'array',
        items: jsonObject({
            id: { type: 'string' },
            version: { type: 'string' },
            description: { type: 'string' },
            capabilities: strings(),
            applicability: strings(),
            limits: { type: 'object' },
        }, ['id', 'version', 'description', 'capabilities', 'applicability', 'limits']),
    },
}, ['modules']);
export const DESCRIBE_MODULE_OUTPUT = jsonObject({
    module_id: { type: 'string' },
    version: { type: 'string' },
    input_schema: { type: 'object' },
    output_schema: { type: 'object' },
    required_fields: strings(),
    assumptions: strings(),
    capabilities: strings(),
    limits: { type: 'object' },
}, ['module_id', 'version', 'input_schema', 'output_schema', 'required_fields', 'assumptions', 'capabilities', 'limits']);
export const LIST_MODULES_PARAMETERS = jsonObject({});
export const DESCRIBE_MODULE_PARAMETERS = jsonObject({ module_id: { type: 'string' } }, ['module_id']);
export const RUN_ANALYSIS_PARAMETERS = jsonObject({
    analysis_snapshot_ref: { type: 'string' },
    module_id: { type: 'string' },
    params: { type: 'object' },
}, ['analysis_snapshot_ref', 'module_id']);
export const RUN_ANALYSIS_OUTPUT = jsonObject({
    analysis_run_ref: { type: 'string' },
    module_id: { type: 'string' },
    module_version: { type: 'string' },
    status: { type: 'string', enum: ['completed', 'partial', 'blocked', 'failed'] },
    summary: { type: 'string' },
    metrics: { type: 'object' },
    assumptions: strings(),
    limitations: strings(),
    data_gaps: strings(),
    validation: jsonObject({
        status: { type: 'string', enum: ['pass', 'warning'] },
        issues: { type: 'array', items: { type: 'object' } },
    }, ['status', 'issues']),
    reused: { type: 'boolean' },
}, [
    'analysis_run_ref', 'module_id', 'module_version', 'status', 'summary', 'metrics', 'assumptions',
    'limitations', 'data_gaps', 'validation', 'reused',
]);
export const SUBMIT_ANALYSIS_OUTPUT = jsonObject({
    analysis_ref: { type: 'string' },
    status: { type: 'string', enum: ['accepted'] },
    validation: jsonObject({
        status: { type: 'string', enum: ['pass', 'warning'] },
        issues: { type: 'array', items: { type: 'object' } },
    }, ['status', 'issues']),
}, ['analysis_ref', 'status', 'validation']);
