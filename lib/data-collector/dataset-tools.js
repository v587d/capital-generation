import { MAX_QUERY_AGGREGATES, MAX_QUERY_FILTERS, MAX_QUERY_GROUP_BY, MAX_QUERY_LIMIT, MAX_QUERY_OUTPUT_BYTES, DatasetQueryError, } from './query.js';
import { coerceQueryShape, isRecord, parseJsonContainer, readDatasetId, readOptionalTaskId, } from './args.js';
import { MAX_DESCRIBE_QUERIES, SAFE_RESULT_CHARS, describeDataset, normalizeDescribeArgs, } from './describe.js';
import { normalizeQueryDates, withIsoTimeColumns } from './query-time.js';
import { authorizedSession } from '../tool-exec.js';
import { DATASET_READING_PRESET_IDS } from '../preset-ids.js';
const jsonObject = (properties = {}, required = []) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
});
const datasetIdSchema = { type: 'string' };
const profileStatisticSchema = jsonObject({
    count: { type: 'integer' },
    sum: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    min: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    max: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    mean: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    p25: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    p50: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    p75: { oneOf: [{ type: 'number' }, { type: 'null' }] },
});
const profileCategorySchema = jsonObject({
    distinct_count: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    top_values: { type: 'array', items: jsonObject({ value: { type: 'string' }, count: { type: 'integer' } }, ['value', 'count']) },
    truncated: { type: 'boolean' },
}, ['distinct_count', 'top_values', 'truncated']);
const profileTimeFactsSchema = jsonObject({
    time_column: { type: 'string' },
    ordered_ascending: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
    covered_from: {},
    covered_to: {},
    covered_from_iso: { type: 'string' },
    covered_to_iso: { type: 'string' },
    axis: jsonObject({
        column: { type: 'string' },
        value_format: { type: 'string', enum: ['epoch_ms', 'date_string', 'unknown'] },
        time_zone: { type: 'string' },
        utc_offset: { type: 'string' },
        aligned_to: { type: 'string', enum: ['local_midnight', 'calendar_day', 'unknown'] },
    }, ['column', 'value_format']),
    windows: {
        type: 'array',
        items: jsonObject({
            name: { type: 'string' },
            start_date: { type: 'string' },
            end_date: { type: 'string' },
            value_ge: {},
            value_le: {},
            data_from: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            data_to: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        }, ['name', 'start_date', 'end_date', 'value_ge', 'value_le']),
    },
    first: { type: 'object', additionalProperties: true },
    last: { type: 'object', additionalProperties: true },
}, ['time_column', 'ordered_ascending', 'covered_from', 'covered_to', 'axis', 'first', 'last']);
const profileDocumentSchema = jsonObject({
    content: {},
    truncated: { type: 'boolean' },
    omitted: { type: 'array', items: jsonObject({ path: { type: 'string' }, kept: { type: 'integer' }, omitted: { type: 'integer' } }, ['path', 'kept', 'omitted']) },
}, ['content', 'truncated', 'omitted']);
const profileStructureSchema = jsonObject({
    type: { type: 'string', enum: ['array', 'object'] },
    occurrences: { type: 'integer' },
    total_elements: { type: 'integer' },
    sampled_elements: { type: 'integer' },
    empty_count: { type: 'integer' },
    min_length: { type: 'integer' },
    max_length: { type: 'integer' },
    fields: { type: 'array', items: jsonObject({ name: { type: 'string' }, type: { type: 'string' } }, ['name', 'type']) },
}, ['type', 'occurrences', 'empty_count', 'min_length', 'max_length', 'fields']);
const profileColumnSchema = jsonObject({
    contract_type: { oneOf: [{ type: 'string', enum: ['string', 'number', 'integer', 'boolean', 'object', 'array', 'json'] }, { type: 'null' }] },
    inferred_type: { type: 'string', enum: ['missing', 'null', 'boolean', 'integer', 'number', 'string', 'object', 'array', 'mixed'] },
    observed_types: { type: 'object', additionalProperties: { type: 'integer' } },
    missing_count: { type: 'integer' },
    null_count: { type: 'integer' },
    non_null_count: { type: 'integer' },
    invalid_count: { type: 'integer' },
    nullable: { type: 'boolean' },
    contract_nullable: { type: 'boolean' },
    required: { type: 'boolean' },
    allow_numeric_string: { type: 'boolean' },
    numeric_string_count: { type: 'integer' },
}, ['contract_type', 'inferred_type', 'observed_types', 'missing_count', 'null_count', 'non_null_count', 'invalid_count', 'nullable']);
const profileValidationSchema = jsonObject({
    status: { type: 'string', enum: ['pass', 'fail'] },
    violations: { type: 'array', items: jsonObject({
            column: { type: 'string' },
            rule: { type: 'string', enum: ['required', 'nullable', 'type'] },
            expected: { oneOf: [{ type: 'string' }, { type: 'boolean' }] },
            observed: { type: 'string' },
            invalid_count: { type: 'integer' },
            severity: { type: 'string', enum: ['error', 'warning'] },
        }, ['column', 'rule', 'expected', 'observed', 'invalid_count', 'severity']) },
}, ['status', 'violations']);
function render(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value) }];
}
function tool(name, description, parameters, schema, execute, options = {}) {
    return {
        name,
        description,
        parameters,
        output: { schema, render },
        execute,
        // Framework concurrency pool: multiple calls in one assistant step run together and return
        // in the same next step. Mixed batches fall back to serial, so this is per-tool, not per-call.
        ...(options.concurrencySafe === true ? { isConcurrencySafe: () => true } : {}),
    };
}
/**
 * Lenient boundary parsing for stringified JSON arrays/objects, shared with describe.ts; the query
 * engine itself stays strict so migration between tools cannot change behavior.
 */
const QUERY_ENVELOPE_FIELDS = ['type', 'task_id', 'time_column'];
function normalizeQueryArgs(args) {
    const outerDatasetId = readDatasetId(args.dataset_id);
    const envelope = isRecord(args.query) ? args.query : parseJsonContainer(args.query);
    if (isRecord(envelope)) {
        const query = coerceQueryShape(envelope);
        if (query.dataset_id === undefined)
            query.dataset_id = outerDatasetId;
        return { dataset_id: outerDatasetId, query: query };
    }
    if (args.query !== undefined) {
        throw new DatasetQueryError('query_spec_invalid', 'query must be an object (a JSON object string is also accepted)');
    }
    const flat = coerceQueryShape(args);
    for (const field of QUERY_ENVELOPE_FIELDS)
        delete flat[field];
    return { dataset_id: outerDatasetId, query: flat };
}
const datasetRefProperties = { dataset_id: { type: 'string' },
    task_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    session_id: { type: 'string' },
    artifact_ref: { type: 'string' },
    format: { type: 'string' },
    capability: { type: 'string' },
    source_label: { type: 'string' },
    schema: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
    row_count: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    captured_at: { type: 'integer' },
    retention_until: { type: 'integer' },
    params_digest: { type: 'string' },
};
const datasetRefWithAccessSchema = jsonObject({
    ...datasetRefProperties,
    query_access: jsonObject({
        readable: { type: 'boolean' },
        shape: { type: 'string', enum: ['array', 'envelope_item', 'document', 'none'] },
        reason: { type: 'string' },
    }, ['readable', 'shape']),
}, [
    'dataset_id', 'task_id', 'session_id', 'artifact_ref', 'format', 'capability',
    'source_label', 'schema', 'row_count', 'captured_at', 'retention_until',
    'params_digest', 'query_access',
]);
const profileRefSchema = jsonObject({
    profile_id: { type: 'string' },
    dataset_id: { type: 'string' },
    task_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    session_id: { type: 'string' },
    artifact_ref: { type: 'string' },
    created_at: { type: 'integer' },
    retention_until: { type: 'integer' },
}, ['profile_id', 'dataset_id', 'task_id', 'session_id', 'artifact_ref', 'created_at', 'retention_until']);
const profileDatasetResultSchema = jsonObject({
    profile_id: { type: 'string' },
    dataset_id: { type: 'string' },
    task_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    session_id: { type: 'string' },
    artifact_ref: { type: 'string' },
    created_at: { type: 'integer' },
    retention_until: { type: 'integer' },
    row_count: { type: 'integer' },
    columns: { type: 'array', items: { type: 'string' } },
    quality: jsonObject({
        missing_values: { type: 'integer' },
        duplicate_rows: { type: 'integer' },
        time_ordered: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
    }, ['missing_values', 'duplicate_rows', 'time_ordered']),
    statistics: { type: 'object', additionalProperties: true },
    categories: { type: 'object', additionalProperties: true },
    time_facts: profileTimeFactsSchema,
    structure: { type: 'object', additionalProperties: true },
    document: profileDocumentSchema,
    schema: { type: 'object', additionalProperties: true },
    validation: profileValidationSchema,
    warnings: { type: 'array', items: { type: 'string' } },
}, ['profile_id', 'dataset_id', 'task_id', 'session_id', 'artifact_ref', 'created_at', 'retention_until', 'row_count', 'columns', 'quality', 'warnings']);
const queryNameSchema = { type: 'string' };
const queryFilterSchema = {
    oneOf: [
        jsonObject({
            column: queryNameSchema,
            operator: { type: 'string', enum: ['is_null', 'not_null'] },
        }, ['column', 'operator']),
        jsonObject({
            column: queryNameSchema,
            operator: { type: 'string', enum: ['=', '!=', '>', '>=', '<', '<=', 'in'] },
            value: {},
        }, ['column', 'operator', 'value']),
    ],
};
const queryAggregateSchema = {
    oneOf: [
        jsonObject({
            function: { type: 'string', enum: ['count'] },
            column: queryNameSchema,
            as: queryNameSchema,
        }, ['function', 'as']),
        jsonObject({
            function: { type: 'string', enum: ['min', 'max', 'avg', 'sum'] },
            column: queryNameSchema,
            as: queryNameSchema,
        }, ['function', 'column', 'as']),
    ],
};
const queryOrderSchema = jsonObject({
    column: queryNameSchema,
    direction: { type: 'string', enum: ['asc', 'desc'] },
}, ['column', 'direction']);
const querySpecProperties = {
    dataset_id: datasetIdSchema,
    select: { type: 'array', items: queryNameSchema },
    filters: { type: 'array', items: queryFilterSchema },
    group_by: { type: 'array', items: queryNameSchema },
    aggregates: { type: 'array', items: queryAggregateSchema },
    order_by: { type: 'array', items: queryOrderSchema },
    limit: { type: 'integer' },
    error_policy: { type: 'string', enum: ['strict', 'skip_with_warning'] },
};
const querySpecSchema = jsonObject(querySpecProperties);
const queryEnvelopeProperties = {
    type: { type: 'string', enum: ['query_request'], description: '可选：声明使用 query_request envelope 形态' },
    task_id: { type: 'string' },
    query: querySpecSchema,
};
/**
 * Root parameters must be a single object: a root-level oneOf makes providers return HTTP 400
 * before the first token. Both forms are distinguished at the boundary, so list both field sets.
 */
const queryParametersSchema = jsonObject({
    ...querySpecProperties,
    ...queryEnvelopeProperties,
    time_column: { type: 'string' },
}, ['dataset_id']);
const queryResultSchema = jsonObject({
    dataset_id: { type: 'string' },
    columns: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array', items: { type: 'object', additionalProperties: true } },
    matched_row_count: { type: 'integer' },
    group_count: { type: 'integer' },
    returned_count: { type: 'integer' },
    limit: { type: 'integer' },
    warnings: { type: 'array', items: { type: 'string' } },
}, ['dataset_id', 'columns', 'rows', 'matched_row_count', 'group_count', 'returned_count', 'limit', 'warnings']);
/**
 * One dataset_id per call; multiple datasets go as multiple calls in one assistant message.
 * Merging them into one result is what the size budget exists to avoid.
 */
const describeParametersSchema = jsonObject({
    dataset_id: datasetIdSchema,
    task_id: { type: 'string' },
    time_column: { type: 'string' },
    primary_key: { type: 'string' },
    columns_of_interest: { type: 'array', items: queryNameSchema },
    queries: { type: 'array', items: querySpecSchema },
}, ['dataset_id']);
const describeQueryOutcomeSchema = jsonObject({
    index: { type: 'integer' },
    result: queryResultSchema,
    error: jsonObject({ code: { type: 'string' }, detail: { type: 'string' } }, ['code', 'detail']),
}, ['index']);
/** Single object root, listing both ok and too_large fields (root oneOf is rejected by providers). */
const describeResultSchema = jsonObject({
    status: { type: 'string', enum: ['ok', 'too_large'] },
    dataset_id: { type: 'string' },
    task_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    session_id: { type: 'string' },
    artifact_ref: { type: 'string' },
    format: { type: 'string' },
    capability: { type: 'string' },
    source_label: { type: 'string' },
    row_count: { type: 'integer' },
    captured_at: { type: 'integer' },
    retention_until: { type: 'integer' },
    params_digest: { type: 'string' },
    query_access: jsonObject({
        readable: { type: 'boolean' },
        shape: { type: 'string', enum: ['array', 'envelope_item', 'document', 'none'] },
        reason: { type: 'string' },
    }, ['readable', 'shape']),
    profile_id: { type: 'string' },
    profile_ref: { type: 'string' },
    columns: { type: 'array', items: { type: 'string' } },
    quality: jsonObject({
        missing_values: { type: 'integer' },
        duplicate_rows: { type: 'integer' },
        time_ordered: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
    }, ['missing_values', 'duplicate_rows', 'time_ordered']),
    statistics: { type: 'object', additionalProperties: true },
    categories: { type: 'object', additionalProperties: true },
    time_facts: profileTimeFactsSchema,
    structure: { type: 'object', additionalProperties: true },
    document: profileDocumentSchema,
    schema: { type: 'object', additionalProperties: true },
    validation: profileValidationSchema,
    warnings: { type: 'array', items: { type: 'string' } },
    queries: { type: 'array', items: describeQueryOutcomeSchema },
    /** Only for too_large: blocked shape, byte counts, attribution and retry hint. */
    shape: { type: 'string', enum: ['array', 'envelope_item', 'document', 'none'] },
    bytes: { type: 'integer' },
    facts_bytes: { type: 'integer' },
    queries_bytes: { type: 'integer' },
    hint: { type: 'string' },
}, ['status', 'dataset_id']);
/**
 * Dataset read family. writeProfile is off by default: profiles are host-computed, and the tool is
 * absent from every family row; the monolithic entry opts in explicitly.
 */
export function registerDatasetTools(ctx, store, options = {}) {
    const tools = ctx.get('tools');
    if (!tools)
        return;
    const registrations = [
        tool('inspect_dataset', '读取当前 session 已授权 Dataset 的元数据和可读性。只返回 DatasetRef 与可读性信息，不返回原始 rows，也不接受任何文件路径。query_access.shape 取值：array / envelope_item = 行集合，可 profile 也可 query；document = 顶层是文档对象（财务指标、回测结果这类），可 profile（宿主给结构摘要与有界内容）但不能 query；none = 不可读，reason 说明原因。批量描述多份 Dataset 请用 describe_dataset（一次一份、可并发）；本工具用于单点复核。', jsonObject({ dataset_id: datasetIdSchema }, ['dataset_id']), datasetRefWithAccessSchema, async (args, exec) => store.inspectDataset(readDatasetId(args.dataset_id), authorizedSession(ctx, exec, 'inspect_dataset', DATASET_READING_PRESET_IDS), exec.signal)),
        tool('profile_dataset', `由宿主读取 Dataset 并返回基础质量检查与四类事实；原始 rows 不进入模型上下文。行集合返回：① schema/quality——字段 observed/contract 类型、missing/null/invalid 计数、重复行、时间顺序；② statistics——数值字段的 count/sum/min/max/mean/分位数；③ categories——字符串字段的 distinct_count 与最多 5 个高频取值（truncated=true 表示未列全）；④ time_facts——时间列覆盖范围与首行/末行的数值取值（回答"最新值、区间涨跌"必须用它，不要用 min/max 代替首末值）；⑤ structure——行内数组/对象的路径摘要（对象字段用 .name、数组元素用 []；未抽样时用 total_elements，超过 50 项时用 sampled_elements，后者明确表示只是抽样，不能据此回答完整数量）。文档型 Dataset（顶层是文档对象，没有行数组）返回 structure 结构摘要 + document 有界内容，不返回行列统计。time_column 可显式指定，省略时按列名候选并只在取值全为数字或日期样式时采用。不接受任何文件路径、脚本内容或额外 schema。批量描述请用 describe_dataset（一次一份、可并发）；本工具用于单点复核或补取一份完整 profile。`, jsonObject({
            dataset_id: datasetIdSchema,
            task_id: { type: 'string' },
            time_column: { type: 'string' },
            primary_key: { type: 'string' },
        }, ['dataset_id']), profileDatasetResultSchema, async (args, exec) => store.profileDataset({
            session: authorizedSession(ctx, exec, 'profile_dataset', DATASET_READING_PRESET_IDS),
            dataset_id: readDatasetId(args.dataset_id),
            task_id: readOptionalTaskId(args.task_id),
            time_column: typeof args.time_column === 'string' ? args.time_column : undefined,
            primary_key: typeof args.primary_key === 'string' ? args.primary_key : undefined,
            signal: exec.signal,
        })),
        // Deliberately not concurrency-safe: parsing raw.json and aggregating is CPU-bound on Node's
        // single thread, so parallel calls cannot overlap; describe_dataset covers multi-query needs.
        tool('query_dataset', `对当前 session 已授权的 json_rows Dataset 执行固定 QuerySpec：参数是一个 JSON 对象，QuerySpec 字段既可平铺在根上（flat），也可整体放进 query（query_request envelope，宿主自动展开）；两种形态同时给出时以 query 为准。支持受限 filter、group_by、count/min/max/avg/sum、asc/desc 和 limit。必须返回聚合或分组结果，禁止原始行投影；select 可省略，默认返回分组列和聚合别名。默认 error_policy=skip_with_warning，脏值会被排除并在 warnings 披露；需要全量类型一致性时显式使用 strict。**时间筛选直接写日期**：时间列（如 date_ms）的 filter 值可写 "2026-08-23" / "2026-08" / "2026" 或 {period:"last_3_months"}（period 省略锚点时以该 Dataset 最后一天为准），宿主按该列自身的时区偏移换算成边界，不要自己算毫秒；日期写法配 >、<、!= 无意义会报 query_type_conflict（用 >= / <= / =）。结果里时间列会附 *_iso 可读日期。最多 ${MAX_QUERY_FILTERS} 个条件、${MAX_QUERY_GROUP_BY} 个分组列、${MAX_QUERY_AGGREGATES} 个聚合、${MAX_QUERY_LIMIT} 行，结果最多 ${MAX_QUERY_OUTPUT_BYTES} 字节。数值字符串只在 Dataset schema 明确为 number/integer 时兼容。query_dataset 是受控分组/聚合工具，不是通用 raw.json 读取或自定义分析工具：select 只能引用 group_by 列或聚合别名，取不到原始行（首末/最新值请用 profile 的 time_facts）。select/group_by/aggregates/order_by 请传真正的 JSON 数组（宿主也兼容 JSON 字符串，但不要依赖）。若还要 profile/元数据，可用 describe_dataset 的 queries 参数一次拿到；本工具用于单点补查。`, queryParametersSchema, queryResultSchema, async (args, exec) => {
            const normalized = normalizeQueryArgs(args);
            const session = authorizedSession(ctx, exec, 'query_dataset', DATASET_READING_PRESET_IDS);
            const timeColumn = typeof args.time_column === 'string' && args.time_column.length > 0 ? args.time_column : undefined;
            const prepared = await normalizeQueryDates({
                store,
                session,
                dataset_id: normalized.dataset_id,
                query: normalized.query,
                time_column: timeColumn,
                signal: exec.signal,
            });
            const result = await store.queryDataset({
                session,
                dataset_id: normalized.dataset_id,
                query: prepared.query,
                signal: exec.signal,
            });
            if (prepared.axis !== undefined)
                withIsoTimeColumns(result, prepared.axis);
            return result;
        }),
        tool('describe_dataset', `读取一份 Dataset 的**默认入口**：一次调用完成 inspect（元数据与可读性/形状）、profile（宿主算基础质量与四类事实，写入 profile_ref）与受控 query（可选）；原始 rows 不进入模型上下文。一次只处理一个 dataset_id——本轮有多份数据时，请在**同一条消息里一次发出多个调用**（本工具可并发执行，结果会一起返回），不要一份一份等。行集合返回：① 元数据 artifact_ref/capability/source_label/captured_at/retention_until 与 query_access.shape（array / envelope_item = 行集合；document = 顶层文档对象，只能 profile，queries 由宿主跳过）；② profile 四类事实——statistics（count/sum/min/max/mean/分位数）、categories（distinct + 最多 5 个高频取值）、time_facts（覆盖范围与首行/末行取值；回答"最新值、区间涨跌"必须用它，不要用 min/max 代替）、structure（嵌套路径摘要）；③ queries——每条的 QueryResult，或该条自己的 error（单条失败不影响其余）。columns_of_interest 只对这些列返回 statistics/categories/schema（并同样收窄 time_facts 的首末值投影，时间列永远保留），是收窄结果体积的唯一手段。结果超过 ${SAFE_RESULT_CHARS} 码点时宿主不返回超长载荷，而返回 {status:'too_large', profile_ref, columns, bytes, facts_bytes, queries_bytes, hint}：facts_bytes/queries_bytes 是体积归因（哪边大砍哪边），按 hint 重发一次即可——queries 大就先去掉 queries（聚合改单独走 query_dataset），facts 大就用 columns_of_interest 收窄列（或减少 queries，最多 ${MAX_DESCRIBE_QUERIES} 条）。单点复核仍可用 inspect_dataset / profile_dataset / query_dataset；不接受任何文件路径、脚本内容或自定义表达式。`, describeParametersSchema, describeResultSchema, async (args, exec) => describeDataset({
            store,
            session: authorizedSession(ctx, exec, 'describe_dataset', DATASET_READING_PRESET_IDS),
            request: normalizeDescribeArgs(args),
            signal: exec.signal,
        }), 
        // This is the mechanism that saves round trips: multiple describes run in one pool.
        { concurrencySafe: true }),
        tool('write_profile', '将当前 session 对已授权 Dataset 生成的基础质量 profile 持久化到 workspace。宿主生成不可变 profile_ref；profile 不得包含原始 rows、文件路径、凭据或未定义字段。', jsonObject({
            dataset_id: datasetIdSchema,
            task_id: { type: 'string' },
            profile: jsonObject({
                row_count: { type: 'integer' },
                columns: { type: 'array', items: { type: 'string' } },
                quality: jsonObject({
                    missing_values: { type: 'integer' },
                    duplicate_rows: { type: 'integer' },
                    time_ordered: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
                }, ['missing_values', 'duplicate_rows', 'time_ordered']),
                statistics: { type: 'object', additionalProperties: true },
                schema: { type: 'object', additionalProperties: true },
                validation: profileValidationSchema,
                warnings: { type: 'array', items: { type: 'string' } },
            }, ['row_count', 'columns', 'quality', 'warnings']),
        }, ['dataset_id', 'profile']), profileRefSchema, async (args, exec) => store.writeProfile({
            session: authorizedSession(ctx, exec, 'write_profile', DATASET_READING_PRESET_IDS),
            dataset_id: readDatasetId(args.dataset_id),
            task_id: readOptionalTaskId(args.task_id),
            profile: args.profile,
            signal: exec.signal,
        })),
    ];
    const withWriteProfile = options.writeProfile === true;
    for (const definition of registrations.filter((item) => withWriteProfile || item.name !== 'write_profile')) {
        ctx.effect(() => tools.register(definition), `capital-generation.dataset-tool(${definition.name})`);
    }
}
