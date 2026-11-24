import { SAFE_RESULT_CHARS } from '../data-collector/describe.js';
import { ANALYSIS_PRESET_IDS } from '../preset-ids.js';
import { authorizedSession } from '../tool-exec.js';
import { analysisModuleById, listAnalysisModules } from './registry.js';
import { ANALYSIS_ARTIFACT_SCHEMA, ARTIFACT_MAX_CHARS, CREATE_SNAPSHOT_OUTPUT, CREATE_SNAPSHOT_PARAMETERS, DESCRIBE_MODULE_OUTPUT, DESCRIBE_MODULE_PARAMETERS, HEADLINE_MAX_CHARS, LIST_MODULES_OUTPUT, LIST_MODULES_PARAMETERS, MAX_CLAIMS, MAX_SCENARIOS, READ_PROFILE_OUTPUT, READ_PROFILE_PARAMETERS, RUN_ANALYSIS_OUTPUT, RUN_ANALYSIS_PARAMETERS, STATEMENT_MAX_CHARS, SUBMIT_ANALYSIS_OUTPUT, THESIS_MAX_CHARS, } from './schemas.js';
import { analysisRuntimeFrom, runModuleOnSnapshot } from './runtime.js';
import { createSnapshot, loadSnapshot, snapshotCoverage } from './snapshot.js';
import { ARTIFACT_FILE, analysisDir, artifactRef, parseSnapshotRef, parseArtifactRef, writeFiles, } from './storage.js';
import { ANALYSIS_TOOL_NAMES, AnalysisError, } from './types.js';
import { validateAgainstSchema, validateArtifact } from './validation.js';
function render(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value) }];
}
// ── argument normalization ─────────────────────────────────────────────────────────────────────
function text(value, field, maxLength = 400) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new AnalysisError('analysis_input_invalid', `${field} 必须是非空字符串`);
    }
    const trimmed = value.trim();
    if (trimmed.length > maxLength)
        throw new AnalysisError('analysis_input_invalid', `${field} 超过 ${maxLength} 字符`);
    return trimmed;
}
function optionalText(value, field, maxLength = 400) {
    if (value === undefined || value === null || value === '')
        return undefined;
    return text(value, field, maxLength);
}
function recordOf(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function stringArray(value, field) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new AnalysisError('analysis_input_invalid', `${field} 必须是字符串数组`);
    }
    return value;
}
function oneOf(value, allowed, field) {
    if (typeof value !== 'string' || !allowed.includes(value)) {
        throw new AnalysisError('analysis_input_invalid', `${field} 必须是 ${allowed.join(' / ')} 之一`);
    }
    return value;
}
/** Dataset/profile refs arrive as objects or bare ids; only the id is used. */
function refId(value, field) {
    const raw = typeof value === 'string' ? value : recordOf(value)[field];
    if (typeof raw !== 'string' || raw.trim() === '') {
        throw new AnalysisError('analysis_snapshot_invalid', `${field} 缺失或为空`);
    }
    const id = raw.trim().split('/').at(-1) ?? '';
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id))
        throw new AnalysisError('analysis_snapshot_invalid', `${field} 不合法：${raw.slice(0, 80)}`);
    return id;
}
function evidenceOf(value) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value))
        throw new AnalysisError('analysis_input_invalid', 'evidence 必须是数组');
    return value.map((item, index) => {
        const record = recordOf(item);
        return {
            source_id: text(record.source_id, `evidence[${index}].source_id`, 128),
            kind: oneOf(record.kind, ['filing', 'news', 'research', 'user_material'], `evidence[${index}].kind`),
            title: text(record.title, `evidence[${index}].title`, 300),
            ...(optionalText(record.source, 'source', 200) === undefined ? {} : { source: String(record.source) }),
            ...(optionalText(record.published_at, 'published_at', 64) === undefined ? {} : { published_at: String(record.published_at) }),
            ...(optionalText(record.url, 'url', 2000) === undefined ? {} : { url: String(record.url) }),
            ...(optionalText(record.excerpt, 'excerpt', 2000) === undefined ? {} : { excerpt: String(record.excerpt) }),
            verification: oneOf(record.verification, ['verified_official', 'unverified', 'not_verified'], `evidence[${index}].verification`),
        };
    });
}
// ── handlers ───────────────────────────────────────────────────────────────────────────────────
function createSnapshotInput(args) {
    return {
        task_id: text(args.task_id, 'task_id', 120),
        question: text(args.question, 'question', 2000),
        ...(optionalText(args.instrument, 'instrument', 120) === undefined ? {} : { instrument: String(args.instrument) }),
        purpose: oneOf(args.purpose, ['observe', 'research', 'holding_review'], 'purpose'),
        ...(optionalText(args.horizon, 'horizon', 120) === undefined ? {} : { horizon: String(args.horizon) }),
        depth: oneOf(args.depth, ['quick', 'standard', 'deep'], 'depth'),
        as_of: text(args.as_of, 'as_of', 64),
        ...(optionalText(args.data_cutoff, 'data_cutoff', 64) === undefined ? {} : { data_cutoff: String(args.data_cutoff) }),
        dataset_refs: (Array.isArray(args.dataset_refs) ? args.dataset_refs : []).map((item) => ({ dataset_id: refId(item, 'dataset_id') })),
        profile_refs: (Array.isArray(args.profile_refs) ? args.profile_refs : []).map((item) => ({ profile_id: refId(item, 'profile_id') })),
        evidence: evidenceOf(args.evidence),
        prior_analysis_refs: stringArray(args.prior_analysis_refs, 'prior_analysis_refs'),
        constraints: recordOf(args.constraints),
    };
}
function profileIdOf(ref) {
    const raw = text(ref, 'profile_ref', 400);
    const id = raw.split('/').filter(Boolean).at(-1) ?? '';
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id))
        throw new AnalysisError('analysis_input_invalid', `profile_ref 不合法：${raw.slice(0, 80)}`);
    return id;
}
function moduleSummary(entry) {
    return {
        id: entry.manifest.id,
        version: entry.manifest.version,
        description: entry.manifest.description,
        capabilities: entry.manifest.capabilities,
        applicability: entry.manifest.applicability,
        limits: entry.manifest.limits,
    };
}
/** Serialized size by section, so a rejected artifact says which part to cut. */
function oversizedSection(artifact) {
    const sections = [
        ['headline', artifact.headline],
        ['thesis', artifact.thesis],
        ['support_claims', artifact.support_claims],
        ['counter_claims', artifact.counter_claims],
        ['calculations', artifact.calculations],
        ['scenarios', artifact.scenarios],
        ['invalidation_conditions', artifact.invalidation_conditions],
        ['limitations', artifact.limitations],
    ];
    const sized = sections
        .map(([name, value]) => [name, JSON.stringify(value ?? null)?.length ?? 0])
        .sort((a, b) => b[1] - a[1]);
    return sized[0]?.[0] ?? 'artifact';
}
function artifactOf(args) {
    const artifact = {
        analysis_id: text(args.analysis_id, 'analysis_id', 120),
        task_id: text(args.task_id, 'task_id', 120),
        snapshot_id: text(args.snapshot_id, 'snapshot_id', 120),
        status: oneOf(args.status, ['completed', 'partial', 'blocked'], 'status'),
        evidence_level: oneOf(args.evidence_level, ['sufficient', 'limited', 'insufficient'], 'evidence_level'),
        headline: typeof args.headline === 'string' ? args.headline : '',
        thesis: typeof args.thesis === 'string' ? args.thesis : '',
        support_claims: Array.isArray(args.support_claims) ? args.support_claims : [],
        counter_claims: Array.isArray(args.counter_claims) ? args.counter_claims : [],
        alternative_explanations: stringArray(args.alternative_explanations, 'alternative_explanations'),
        contradictions: stringArray(args.contradictions, 'contradictions'),
        calculations: Array.isArray(args.calculations) ? args.calculations : [],
        scenarios: Array.isArray(args.scenarios) ? args.scenarios : [],
        invalidation_conditions: stringArray(args.invalidation_conditions, 'invalidation_conditions'),
        unresolved_gaps: stringArray(args.unresolved_gaps, 'unresolved_gaps'),
        limitations: stringArray(args.limitations, 'limitations'),
        methods_used: Array.isArray(args.methods_used) ? args.methods_used : [],
        peer_exchanges: Array.isArray(args.peer_exchanges) ? args.peer_exchanges : [],
    };
    return artifact;
}
export function registerAnalysisTools(deps) {
    const { ctx, store } = deps;
    const now = deps.now ?? (() => Date.now());
    const tools = ctx.get('tools');
    if (!tools)
        return;
    const authorize = (exec, tool) => authorizedSession(ctx, exec, tool, ANALYSIS_PRESET_IDS);
    const definitions = [
        {
            name: 'create_analysis_snapshot',
            description: '冻结本次分析的输入版本：把 Dataset / profile / 证据引用连同研究问题、口径与时间点打包成不可变快照，'
                + '返回 snapshot 引用与到期时间。分析前必须先建快照；快照只存引用与摘要，不包含原始数据行。',
            parameters: CREATE_SNAPSHOT_PARAMETERS,
            output: { schema: CREATE_SNAPSHOT_OUTPUT, render },
            async execute(args, exec) {
                const session = authorize(exec, 'create_analysis_snapshot');
                const input = createSnapshotInput(args);
                const { record, ref } = await createSnapshot({
                    reader: store,
                    writer: store,
                    session,
                    input,
                    ...(exec.signal === undefined ? {} : { signal: exec.signal }),
                    now: now(),
                });
                return {
                    analysis_snapshot_ref: ref,
                    analysis_id: record.analysis_id,
                    input_fingerprint: record.input_fingerprint,
                    expires_at: new Date(record.expires_at).toISOString(),
                    coverage: snapshotCoverage(record),
                    limitations: [...record.limitations],
                };
            },
        },
        {
            name: 'read_profile',
            description: '读取一份数据档案（profile）的有界事实：行数、列、缺失、分布摘要与时间事实。用于判断这份数据能不能支撑结论；'
                + '不返回原始数据行，超预算时返回小回执与收窄提示。',
            parameters: READ_PROFILE_PARAMETERS,
            output: { schema: READ_PROFILE_OUTPUT, render },
            async execute(args, exec) {
                const session = authorize(exec, 'read_profile');
                const profileId = profileIdOf(args.profile_ref);
                const loaded = await store.readProfile({
                    session,
                    profile_id: profileId,
                    ...(exec.signal === undefined ? {} : { signal: exec.signal }),
                });
                const columnsOfInterest = stringArray(args.columns_of_interest, 'columns_of_interest');
                const profile = loaded.profile;
                const facts = columnsOfInterest.length === 0
                    ? profile
                    : Object.fromEntries(Object.entries(profile).filter(([key]) => key === 'row_count' || key === 'quality' || columnsOfInterest.includes(key)));
                const factsText = JSON.stringify(facts);
                if (factsText.length > SAFE_RESULT_CHARS) {
                    return {
                        profile_ref: loaded.ref.artifact_ref,
                        columns: [...loaded.profile.columns],
                        facts: { row_count: loaded.profile.row_count, quality: loaded.profile.quality },
                        hint: `profile 事实 ${factsText.length} 字符，超过单次回执预算 ${SAFE_RESULT_CHARS}：用 columns_of_interest 收窄后再读`,
                    };
                }
                return {
                    profile_ref: loaded.ref.artifact_ref,
                    columns: [...loaded.profile.columns],
                    facts,
                };
            },
        },
        {
            name: 'list_analysis_modules',
            description: '列出当前可用的受控分析模块：id、版本、能力、适用条件与数据要求。选模块前先看这张表，不要凭记忆假定存在某个模块。',
            parameters: LIST_MODULES_PARAMETERS,
            output: { schema: LIST_MODULES_OUTPUT, render },
            async execute(_args, exec) {
                authorize(exec, 'list_analysis_modules');
                return { modules: listAnalysisModules().map((entry) => moduleSummary(entry)) };
            },
        },
        {
            name: 'describe_analysis_module',
            description: '查看单个分析模块的完整输入输出契约、假设与限制。参数必须符合模块声明的输入结构，否则运行会被拒绝。',
            parameters: DESCRIBE_MODULE_PARAMETERS,
            output: { schema: DESCRIBE_MODULE_OUTPUT, render },
            async execute(args, exec) {
                authorize(exec, 'describe_analysis_module');
                const moduleId = text(args.module_id, 'module_id', 64);
                const entry = analysisModuleById(moduleId);
                if (entry === undefined) {
                    throw new AnalysisError('analysis_module_not_found', `没有登记名为 ${moduleId} 的分析模块；先调用 list_analysis_modules 看可用清单`);
                }
                return {
                    module_id: entry.manifest.id,
                    version: entry.manifest.version,
                    input_schema: entry.manifest.input_schema,
                    output_schema: entry.manifest.output_schema,
                    required_fields: entry.manifest.required_fields,
                    assumptions: entry.manifest.assumptions,
                    capabilities: entry.manifest.capabilities,
                    limits: entry.manifest.limits,
                };
            },
        },
        {
            name: 'run_analysis',
            description: '在快照上运行一个分析模块，返回指标、假设、数据缺口与校验结论。同一快照内输入与参数不变时会复用已有结果；'
                + '模块未声明的能力（如读数据集）会在运行前被拒绝。',
            parameters: RUN_ANALYSIS_PARAMETERS,
            output: { schema: RUN_ANALYSIS_OUTPUT, render },
            async execute(args, exec) {
                const session = authorize(exec, 'run_analysis');
                const analysisId = parseSnapshotRef(args.analysis_snapshot_ref);
                const snapshot = await loadSnapshot({
                    reader: store,
                    session,
                    analysisId,
                    ...(exec.signal === undefined ? {} : { signal: exec.signal }),
                    now: now(),
                });
                const moduleId = text(args.module_id, 'module_id', 64);
                const module = analysisModuleById(moduleId);
                if (module === undefined) {
                    throw new AnalysisError('analysis_module_not_found', `没有登记名为 ${moduleId} 的分析模块；先调用 list_analysis_modules 看可用清单`);
                }
                const outcome = await runModuleOnSnapshot({
                    writer: store,
                    runtime: analysisRuntimeFrom(ctx),
                    session,
                    snapshot,
                    module,
                    params: recordOf(args.params),
                    ...(exec.signal === undefined ? {} : { signal: exec.signal }),
                    now: now(),
                });
                return { ...outcome };
            },
        },
        {
            name: 'submit_analysis',
            description: '提交最终分析产物：结论、正反论据、替代解释、失效条件与数字锚点。宿主会校验结论里的每个数字能否追到锚点；'
                + '缺失效条件、引用不存在或数字无来源会被拒绝，警告级问题会让产物降级为 partial。',
            parameters: ANALYSIS_ARTIFACT_SCHEMA,
            output: { schema: SUBMIT_ANALYSIS_OUTPUT, render },
            async execute(args, exec) {
                const session = authorize(exec, 'submit_analysis');
                const artifact = artifactOf(args);
                const serialized = JSON.stringify(artifact);
                if (serialized.length > ARTIFACT_MAX_CHARS) {
                    throw new AnalysisError('analysis_result_too_large', `产物 ${serialized.length} 字符，超过 ${ARTIFACT_MAX_CHARS} 上限；先压缩 ${oversizedSection(artifact)} 再重发（上限：headline ${HEADLINE_MAX_CHARS} / thesis ${THESIS_MAX_CHARS} / 单条 statement ${STATEMENT_MAX_CHARS} / claims ${MAX_CLAIMS} / scenarios ${MAX_SCENARIOS}）`);
                }
                // §11.4 Tier 1 covers "schema mismatch" too: the artifact schema is the contract the model
                // reads, so an undeclared field or an over-long claim list must be rejected here, not ignored.
                const schemaIssues = validateAgainstSchema(artifact, ANALYSIS_ARTIFACT_SCHEMA);
                if (schemaIssues.length > 0) {
                    throw new AnalysisError('analysis_validation_failed', `产物不符合 artifact schema（${schemaIssues.length} 条）：${schemaIssues.slice(0, 6).join('；')}`);
                }
                const analysisId = parseArtifactRef(`analysis_artifact:${artifact.analysis_id}`);
                if (artifact.snapshot_id !== artifact.analysis_id) {
                    throw new AnalysisError('analysis_snapshot_invalid', 'snapshot_id 必须等于建快照时返回的 analysis_id');
                }
                const snapshot = await loadSnapshot({
                    reader: store,
                    session,
                    analysisId,
                    ...(exec.signal === undefined ? {} : { signal: exec.signal }),
                    now: now(),
                });
                const validation = validateArtifact(artifact, snapshot);
                if (validation.tier1.length > 0) {
                    throw new AnalysisError('analysis_validation_failed', `产物未通过硬校验（${validation.tier1.length} 条）：${validation.tier1.slice(0, 6).map((issue) => `${issue.code} ${issue.detail}`).join('；')}`);
                }
                const downgraded = validation.tier2.length > 0 && artifact.status === 'completed' ? 'partial' : artifact.status;
                const persisted = {
                    ...artifact,
                    status: downgraded,
                    validation: {
                        status: validation.tier2.length > 0 ? 'warning' : 'pass',
                        issues: [...validation.tier1, ...validation.tier2, ...validation.tier3],
                    },
                };
                await writeFiles(store, session, analysisDir(analysisId), [{
                        name: ARTIFACT_FILE,
                        content: JSON.stringify(persisted),
                    }], {
                    ...(exec.signal === undefined ? {} : { signal: exec.signal }),
                    overwrite: true,
                    what: '写入 artifact.json 失败',
                });
                return {
                    analysis_ref: artifactRef(analysisId),
                    status: 'accepted',
                    validation: persisted.validation,
                };
            },
        },
    ];
    for (const definition of definitions) {
        ctx.effect(() => tools.register(definition), `capital-generation.tool(${definition.name})`);
    }
}
export { ANALYSIS_TOOL_NAMES };
