import { HEADLINE_MAX_CHARS, MAX_CLAIMS, MAX_SCENARIOS, STATEMENT_MAX_CHARS, THESIS_MAX_CHARS } from './schemas.js';
/** Subset of JSON Schema used by the protocol: types, properties, required, items, enum, bounds. */
export function validateAgainstSchema(value, schema, path = '$') {
    if (schema === undefined || Object.keys(schema).length === 0)
        return [];
    const issues = [];
    if (Array.isArray(schema.anyOf)) {
        const failures = schema.anyOf.map((option) => validateAgainstSchema(value, option, path));
        if (failures.every((items) => items.length > 0))
            issues.push(`${path} 不满足任何允许的形态`);
        return issues;
    }
    const type = schema.type;
    if (typeof type === 'string' && !matchesType(value, type)) {
        issues.push(`${path} 应为 ${type}，实际是 ${describeType(value)}`);
        return issues;
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) {
        issues.push(`${path} 必须是 ${schema.enum.join(' / ')} 之一`);
    }
    if (typeof value === 'string') {
        const maxLength = schema.maxLength;
        if (typeof maxLength === 'number' && value.length > maxLength)
            issues.push(`${path} 超长：${value.length} > ${maxLength}`);
    }
    if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum) {
        issues.push(`${path} 小于最小值 ${schema.minimum}`);
    }
    if (Array.isArray(value)) {
        if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
            issues.push(`${path} 条目过多：${value.length} > ${schema.maxItems}`);
        }
        if (schema.items !== undefined) {
            value.forEach((item, index) => issues.push(...validateAgainstSchema(item, schema.items, `${path}[${index}]`)));
        }
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const record = value;
        const properties = (schema.properties ?? {});
        const required = Array.isArray(schema.required) ? schema.required : [];
        for (const key of required) {
            if (record[key] === undefined)
                issues.push(`${path}.${key} 是必填字段`);
        }
        if (schema.additionalProperties === false) {
            for (const key of Object.keys(record)) {
                if (!(key in properties))
                    issues.push(`${path}.${key} 是未声明的字段`);
            }
        }
        for (const [key, childSchema] of Object.entries(properties)) {
            if (record[key] !== undefined)
                issues.push(...validateAgainstSchema(record[key], childSchema, `${path}.${key}`));
        }
    }
    return issues;
}
function matchesType(value, type) {
    switch (type) {
        case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
        case 'array': return Array.isArray(value);
        case 'string': return typeof value === 'string';
        case 'boolean': return typeof value === 'boolean';
        case 'integer': return typeof value === 'number' && Number.isInteger(value);
        case 'number': return typeof value === 'number' && Number.isFinite(value);
        case 'null': return value === null;
        default: return true;
    }
}
function describeType(value) {
    if (value === null)
        return 'null';
    if (Array.isArray(value))
        return 'array';
    if (typeof value === 'number' && !Number.isFinite(value))
        return 'non-finite number';
    return typeof value;
}
/** Lossless JSON: `undefined`, `NaN`, `Infinity` and array holes must not cross the boundary. */
export function losslessIssues(value, path = '$') {
    if (value === undefined)
        return [`${path} 是 undefined`];
    if (typeof value === 'number' && !Number.isFinite(value))
        return [`${path} 是 ${String(value)}（非有限数）`];
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint')
        return [`${path} 是 ${typeof value}`];
    if (Array.isArray(value)) {
        const issues = [];
        for (let index = 0; index < value.length; index += 1) {
            if (!(index in value))
                issues.push(`${path}[${index}] 是数组空洞`);
            else
                issues.push(...losslessIssues(value[index], `${path}[${index}]`));
        }
        return issues;
    }
    if (value !== null && typeof value === 'object') {
        const issues = [];
        for (const [key, item] of Object.entries(value))
            issues.push(...losslessIssues(item, `${path}.${key}`));
        return issues;
    }
    return [];
}
/** Validate the worker's result object: lossless, then the manifest's declared output schema. */
export function validateModuleResult(value, manifest) {
    const issues = [];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return {
            ok: false,
            issues: [{ code: 'analysis_output_invalid', severity: 'error', detail: '模块结果必须是 JSON 对象' }],
            result: undefined,
        };
    }
    for (const detail of losslessIssues(value)) {
        issues.push({ code: 'analysis_output_invalid', severity: 'error', detail });
    }
    const schema = (manifest.output_schema ?? {});
    for (const detail of validateAgainstSchema(value, schema)) {
        issues.push({ code: 'analysis_output_invalid', severity: 'error', detail });
    }
    const result = value;
    if (typeof result.status !== 'string')
        issues.push({ code: 'analysis_output_invalid', severity: 'error', field: 'status', detail: '模块结果缺 status' });
    if (typeof result.summary !== 'string')
        issues.push({ code: 'analysis_output_invalid', severity: 'error', field: 'summary', detail: '模块结果缺 summary' });
    if (!Array.isArray(result.limitations))
        issues.push({ code: 'analysis_output_invalid', severity: 'error', field: 'limitations', detail: '模块结果缺 limitations 数组' });
    if (!Array.isArray(result.data_gaps))
        issues.push({ code: 'analysis_output_invalid', severity: 'error', field: 'data_gaps', detail: '模块结果缺 data_gaps 数组' });
    // §12.2: a result without assumptions or a method log is not reproducible, so it cannot be audited.
    for (const [field, label] of [['assumptions', '假设'], ['methodology_log', '方法日志']]) {
        const items = result[field];
        if (!Array.isArray(items) || items.length === 0) {
            issues.push({ code: 'analysis_output_invalid', severity: 'error', field, detail: `模块结果必须写明${label}（至少一条）` });
        }
        else if (items.some((item) => typeof item !== 'string' || item.trim() === '')) {
            issues.push({ code: 'analysis_output_invalid', severity: 'error', field, detail: `${label}里不能有空串或非字符串` });
        }
    }
    return { ok: issues.every((issue) => issue.severity !== 'error'), issues, result };
}
const UNIT_CONSTANTS = new Set([1e4, 1e6, 1e8, 1e12]);
const YEAR = /^(?:19|20)\d{2}$/u;
const NUMBER_TOKEN = /-?\d+(?:\.\d+)?/gu;
const PERCENT_AFTER = /^\s*[%％]/u;
/** Numeric tokens with just enough context to honour the exemption set. */
export function numberTokens(text) {
    const tokens = [];
    for (const match of text.matchAll(NUMBER_TOKEN)) {
        const start = match.index ?? 0;
        const raw = match[0];
        const value = Number(raw);
        if (!Number.isFinite(value))
            continue;
        tokens.push({ text: raw, value, percent: PERCENT_AFTER.test(text.slice(start + raw.length)), start });
    }
    return tokens;
}
function tolerance(precision) {
    const digits = typeof precision === 'number' && precision >= 0 && precision <= 12 ? precision : 4;
    return 0.5 * 10 ** -digits;
}
function exemptToken(text, token, source) {
    // Digits inside an identifier (`claim_1`, `FY2025`) are not quantities.
    const before = source[token.start - 1];
    const after = source[token.start + token.text.length];
    if ((before !== undefined && /[A-Za-z_]/u.test(before)) || (after !== undefined && /[A-Za-z_]/u.test(after)))
        return true;
    if (!token.percent && YEAR.test(token.text))
        return true;
    if (Number.isInteger(token.value) && Math.abs(token.value) <= 20) {
        const before = source.slice(Math.max(0, token.start - 2), token.start);
        if (/[第期条项]/u.test(before))
            return true;
    }
    if (UNIT_CONSTANTS.has(token.value) && /^\d+$/u.test(token.text))
        return true;
    return false;
}
function anchoredNumbers(artifact) {
    const anchors = [];
    const values = [];
    for (const claim of [...artifact.support_claims, ...artifact.counter_claims]) {
        for (const anchor of claim.number_anchors ?? []) {
            if (typeof anchor?.value === 'number' && Number.isFinite(anchor.value))
                anchors.push(anchor);
        }
    }
    for (const calculation of artifact.calculations ?? []) {
        if (typeof calculation?.value === 'number' && Number.isFinite(calculation.value))
            values.push(calculation.value);
    }
    return { anchors, values };
}
function unmatchedNumbers(text, anchors, calculations) {
    const misses = [];
    for (const token of numberTokens(text)) {
        if (exemptToken(text, token, text))
            continue;
        const hit = anchors.some((anchor) => {
            const tol = tolerance(anchor.precision);
            if (Math.abs(anchor.value - token.value) <= tol)
                return true;
            // Ratio written as a percentage (0.1823 ↔ 18.23) — same precision, scaled by 100.
            return Math.abs(anchor.value * 100 - token.value) <= Math.max(tol * 100, 0.5 * 10 ** -2);
        });
        if (hit)
            continue;
        if (calculations.some((value) => Math.abs(value - token.value) <= tolerance(undefined)))
            continue;
        misses.push(token.text);
    }
    return misses;
}
function claimIssues(claim, path, tier1, tier2) {
    if (typeof claim?.statement === 'string' && claim.statement.length > STATEMENT_MAX_CHARS) {
        tier1.push({ code: 'analysis_result_too_large', severity: 'error', field: `${path}.statement`, detail: `单条 statement 超过 ${STATEMENT_MAX_CHARS} 字符` });
    }
    if (typeof claim?.confidence_basis !== 'string' || claim.confidence_basis.trim() === '') {
        tier2.push({ code: 'confidence_basis_missing', severity: 'warning', field: `${path}.confidence_basis`, detail: 'confidence 必须带一句依据' });
    }
}
/**
 * Artifact validation in the three tiers of the design (Tier 1 rejects, Tier 2 downgrades to
 * `partial`, Tier 3 is advisory). Returns issues; persistence is the caller's decision.
 */
export function validateArtifact(artifact, snapshot) {
    const tier1 = [];
    const tier2 = [];
    const tier3 = [];
    if (typeof artifact.headline === 'string' && artifact.headline.length > HEADLINE_MAX_CHARS) {
        tier1.push({ code: 'analysis_result_too_large', severity: 'error', field: 'headline', detail: `headline 超过 ${HEADLINE_MAX_CHARS} 字符` });
    }
    if (typeof artifact.thesis === 'string' && artifact.thesis.length > THESIS_MAX_CHARS) {
        tier1.push({ code: 'analysis_result_too_large', severity: 'error', field: 'thesis', detail: `thesis 超过 ${THESIS_MAX_CHARS} 字符` });
    }
    const claims = [...(artifact.support_claims ?? []), ...(artifact.counter_claims ?? [])];
    if (claims.length > MAX_CLAIMS * 2) {
        tier1.push({ code: 'analysis_result_too_large', severity: 'error', field: 'support_claims', detail: `正反论据合计 ${claims.length} 条，超过 ${MAX_CLAIMS * 2} 条上限` });
    }
    // §10.6 budgets live here, not in the tool schema: the host's JSON-Schema subset has no `maxItems`,
    // so a schema keyword would cost the whole family row at boot.
    for (const [field, list, limit] of [
        ['support_claims', artifact.support_claims, MAX_CLAIMS],
        ['counter_claims', artifact.counter_claims, MAX_CLAIMS],
        ['scenarios', artifact.scenarios, MAX_SCENARIOS],
    ]) {
        if (Array.isArray(list) && list.length > limit) {
            tier1.push({ code: 'analysis_result_too_large', severity: 'error', field, detail: `${field} ${list.length} 条，超过 ${limit} 条上限` });
        }
    }
    claims.forEach((claim, index) => claimIssues(claim, `claims[${index}]`, tier1, tier2));
    // Hard rule: a conclusion with no invalidation condition is not a judgement, it is a slogan.
    if (!Array.isArray(artifact.invalidation_conditions) || artifact.invalidation_conditions.length === 0) {
        tier1.push({ code: 'invalidation_missing', severity: 'error', field: 'invalidation_conditions', detail: '至少要一条能推翻主判断的条件' });
    }
    else {
        const ids = [...claims.map((claim) => claim.claim_id), ...(artifact.calculations ?? []).map((item) => item.calculation_id)]
            .filter((id) => typeof id === 'string' && id !== '');
        const references = artifact.invalidation_conditions.some((condition) => ids.some((id) => condition.includes(id)));
        if (!references) {
            tier2.push({ code: 'invalidation_unreferenced', severity: 'warning', field: 'invalidation_conditions', detail: '失效条件没有引用任何 claim_id / calculation_id，无法核对它推翻的是哪一条' });
        }
    }
    // Evidence level and status must agree; `completed` also requires a clean validation.
    if (artifact.evidence_level === 'insufficient' && artifact.status === 'completed') {
        tier1.push({ code: 'evidence_level_conflict', severity: 'error', field: 'status', detail: 'evidence_level=insufficient 时 status 只能是 partial / blocked' });
    }
    if (artifact.status === 'completed' && !Array.isArray(artifact.limitations)) {
        tier1.push({ code: 'limitations_missing', severity: 'error', field: 'limitations', detail: 'completed 的产物必须有 limitations 字段（可以为空数组，但不能缺）' });
    }
    if (Array.isArray(artifact.limitations) && artifact.limitations.length === 0) {
        tier2.push({ code: 'limitations_empty', severity: 'warning', field: 'limitations', detail: 'limitations 为空：至少写明一条口径或数据限制' });
    }
    // Refs must exist inside this snapshot.
    const datasetIds = new Set(snapshot.dataset_refs.map((item) => item.dataset_id));
    const profileIds = new Set(snapshot.profile_refs.map((item) => item.profile_id));
    const evidenceIds = new Set(snapshot.evidence.map((item) => item.source_id));
    const calcIds = new Set((artifact.calculations ?? []).map((item) => item.calculation_id));
    for (const claim of claims) {
        for (const ref of claim.evidence_refs ?? []) {
            if (!evidenceIds.has(ref)) {
                tier1.push({ code: 'evidence_ref_missing', severity: 'error', field: claim.claim_id, detail: `引用的证据 ${ref} 不在本次快照里` });
            }
        }
        for (const anchor of claim.number_anchors ?? []) {
            const ref = anchor?.source?.ref;
            if (typeof ref !== 'string')
                continue;
            const known = anchor.source.kind === 'dataset' ? datasetIds.has(ref)
                : anchor.source.kind === 'profile' ? profileIds.has(ref)
                    : anchor.source.kind === 'evidence' ? evidenceIds.has(ref)
                        : calcIds.has(ref);
            if (!known) {
                tier1.push({ code: 'anchor_ref_missing', severity: 'error', field: claim.claim_id, detail: `数字锚点引用的 ${ref} 不在本次快照/计算里` });
            }
        }
    }
    // Number traceability on the conclusion fields only (Tier 1) and on calculations (Tier 2).
    const { anchors, values } = anchoredNumbers(artifact);
    const conclusionTexts = [
        { field: 'headline', text: artifact.headline ?? '' },
        { field: 'thesis', text: artifact.thesis ?? '' },
        ...claims.map((claim, index) => ({ field: `claims[${index}].statement`, text: claim.statement ?? '' })),
        ...(artifact.invalidation_conditions ?? []).map((condition, index) => ({ field: `invalidation_conditions[${index}]`, text: condition })),
    ];
    for (const { field, text } of conclusionTexts) {
        const misses = unmatchedNumbers(text, anchors, values);
        if (misses.length > 0) {
            tier1.push({ code: 'number_without_anchor', severity: 'error', field, detail: `这些数字没有来源锚点：${misses.slice(0, 6).join('、')}` });
        }
    }
    for (const [index, calculation] of (artifact.calculations ?? []).entries()) {
        const known = anchors.some((anchor) => Math.abs(anchor.value - calculation.value) <= tolerance(anchor.precision));
        if (!known) {
            tier2.push({ code: 'calculation_without_anchor', severity: 'warning', field: `calculations[${index}]`, detail: `计算结果 ${calculation.metric}=${calculation.value} 没有对应锚点` });
        }
    }
    // Peer exchanges: an unanswered peer request means the result is not final.
    const unanswered = (artifact.peer_exchanges ?? []).filter((item) => item?.answered !== true);
    if (unanswered.length > 0) {
        tier2.push({ code: 'peer_unanswered', severity: 'warning', field: 'peer_exchanges', detail: `${unanswered.length} 条 peer 请求没有回执；产物最多 partial` });
    }
    if (artifact.status === 'completed' && unanswered.length > 0) {
        tier1.push({ code: 'peer_unanswered_completed', severity: 'error', field: 'status', detail: '存在未回执的 peer 请求时不能写 completed' });
    }
    for (const [index, scenario] of (artifact.scenarios ?? []).entries()) {
        const assumptions = scenario?.assumptions;
        if (!Array.isArray(assumptions) || assumptions.length === 0) {
            tier2.push({ code: 'scenario_assumptions_missing', severity: 'warning', field: `scenarios[${index}]`, detail: '情景必须写明假设' });
        }
    }
    if ((artifact.alternative_explanations ?? []).length === 0) {
        tier3.push({ code: 'no_alternative_explanation', severity: 'notice', field: 'alternative_explanations', detail: '没有替代解释：审阅者会问"还可能是别的什么"' });
    }
    return { tier1, tier2, tier3 };
}
