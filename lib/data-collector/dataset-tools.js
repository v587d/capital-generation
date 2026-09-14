import { MAX_QUERY_AGGREGATES, MAX_QUERY_FILTERS, MAX_QUERY_GROUP_BY, MAX_QUERY_LIMIT, MAX_QUERY_ORDER_BY, MAX_QUERY_OUTPUT_BYTES, MAX_QUERY_SELECT, DatasetQueryError, } from './query.js';
import { DatasetStoreError, } from './store.js';
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
    first: { type: 'object', additionalProperties: true },
    last: { type: 'object', additionalProperties: true },
}, ['time_column', 'ordered_ascending', 'covered_from', 'covered_to', 'first', 'last']);
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
function tool(name, description, parameters, schema, execute) {
    return { name, description, parameters, output: { schema, render }, execute };
}
function callerSession(exec) {
    const session = exec.agent?.session;
    if (!session || typeof session.id !== 'string') {
        throw new DatasetStoreError('session_unavailable', 'the calling agent session was not provided');
    }
    return session;
}
function delegatedSession(exec, toolName) {
    const session = callerSession(exec);
    if (typeof session.header?.parentSession !== 'string' || session.header.parentSession.length === 0) {
        throw new DatasetStoreError('dataset_session_mismatch', `${toolName} is restricted to delegated data agents; the main Agent must delegate this request`);
    }
    return session;
}
function datasetId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
        throw new DatasetStoreError('dataset_id_invalid', 'dataset_id is invalid');
    return value;
}
function optionalTaskId(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value !== 'string' || value.length > 256)
        throw new DatasetStoreError('profile_invalid', 'task_id is invalid');
    return value;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
/**
 * 模型经常把数组/对象参数序列化成 JSON 字符串再传（实测：`"select": "[\"date_ms\"]"`、
 * `"group_by": "[]"`、`"aggregates": "[{...}]"`、`"limit": "1"`），于是参数其实是对的，
 * 却报 `query_spec_invalid: select must contain 1-32 column names`，模型只能反复试错。
 *
 * 这里在**工具边界**做一次宽容解析，查询引擎本身保持严格：能解析成正确类型就放行，
 * 解析不了就原样交给校验器报错（错误信息仍指向真实问题）。
 */
const QUERY_NAME_LIST_FIELDS = ['select', 'group_by'];
const QUERY_OBJECT_LIST_FIELDS = ['filters', 'aggregates', 'order_by'];
/** envelope 自身的元数据字段，不属于 QuerySpec；模型按协议原样传 envelope 时忽略它们。 */
const QUERY_ENVELOPE_FIELDS = ['type', 'task_id'];
function parseJsonContainer(value) {
    if (typeof value !== 'string')
        return undefined;
    const text = value.trim();
    if (text.length === 0 || (text[0] !== '[' && text[0] !== '{'))
        return undefined;
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
/** 列名数组：接受真数组、JSON 数组字符串，或单个列名字符串。 */
function coerceNameList(value) {
    if (Array.isArray(value))
        return value;
    const parsed = parseJsonContainer(value);
    if (Array.isArray(parsed))
        return parsed;
    if (typeof value === 'string' && parsed === undefined) {
        const text = value.trim();
        if (text.length > 0 && !text.startsWith('[') && !text.startsWith('{'))
            return [value];
    }
    return value;
}
/** 对象数组：接受真数组、JSON 数组字符串，或单个对象（对象本身或其 JSON 字符串）。 */
function coerceObjectList(value) {
    if (Array.isArray(value))
        return value;
    const parsed = parseJsonContainer(value);
    if (Array.isArray(parsed))
        return parsed;
    if (isRecord(parsed))
        return [parsed];
    if (isRecord(value))
        return [value];
    return value;
}
function coerceLimit(value) {
    if (typeof value !== 'string')
        return value;
    const text = value.trim();
    return /^\d+$/.test(text) ? Number(text) : value;
}
function coerceQueryShape(input) {
    const shape = { ...input };
    for (const field of QUERY_NAME_LIST_FIELDS)
        if (field in shape)
            shape[field] = coerceNameList(shape[field]);
    for (const field of QUERY_OBJECT_LIST_FIELDS)
        if (field in shape)
            shape[field] = coerceObjectList(shape[field]);
    if ('limit' in shape)
        shape.limit = coerceLimit(shape.limit);
    return shape;
}
function normalizeQueryArgs(args) {
    const outerDatasetId = datasetId(args.dataset_id);
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
const datasetRefProperties = {
    dataset_id: { type: 'string' },
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
const queryNameSchema = { type: 'string', minLength: 1, maxLength: 128 };
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
    select: { type: 'array', items: queryNameSchema, minItems: 1, maxItems: MAX_QUERY_SELECT },
    filters: { type: 'array', items: queryFilterSchema, maxItems: MAX_QUERY_FILTERS },
    group_by: { type: 'array', items: queryNameSchema, maxItems: MAX_QUERY_GROUP_BY },
    aggregates: { type: 'array', items: queryAggregateSchema, maxItems: MAX_QUERY_AGGREGATES },
    order_by: { type: 'array', items: queryOrderSchema, maxItems: MAX_QUERY_ORDER_BY },
    limit: { type: 'integer', minimum: 1, maximum: MAX_QUERY_LIMIT },
    error_policy: { type: 'string', enum: ['strict', 'skip_with_warning'] },
};
const querySpecSchema = jsonObject(querySpecProperties);
/** envelope 形态独有的三个字段；flat 形态把它们视为 QuerySpec 之外的元数据。 */
const queryEnvelopeProperties = {
    type: { type: 'string', enum: ['query_request'], description: '可选：声明使用 query_request envelope 形态' },
    task_id: { type: 'string' },
    query: querySpecSchema,
};
/**
 * 工具参数 schema 的根**只能**是 `{ type: 'object', properties, required }`。
 *
 * 事故（2026-09-14）：这里原本是根级 `{ oneOf: [flat, envelope] }`，没有 `type`。
 * 模型供应商在请求进入时就整体校验 `tools[].function.parameters`，直接返回
 * `Invalid schema for function 'query_dataset': schema must be a JSON Schema of
 * 'type: "object"', got 'type: null'`（HTTP 400）。这一步发生在模型生成第一个
 * token 之前，而这套工具表在会话组作用域里**主 Agent 也带着**，于是每个 Capital
 * 会话都在第 1 轮第 1 步整体失败，与用户问什么无关。
 *
 * flat 与 envelope 的判定本来就在工具边界由 normalizeQueryArgs 完成（query 存在即
 * envelope），所以 schema 用「一个对象 + 两边字段都列出（都非必需，dataset_id 除外）」
 * 描述即可——这比根级 oneOf 更准确：oneOf 的两个分支都带 additionalProperties:false，
 * 混合传参（如 query + limit）在任何分支下都不合法，而宿主其实接受。
 * 回归测试：test/apply-integration.test.mjs（所有注册工具的 parameters 根必须是 object）。
 */
const queryParametersSchema = jsonObject({
    ...querySpecProperties,
    ...queryEnvelopeProperties,
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
export function registerDatasetTools(ctx, store) {
    const tools = ctx.get('tools');
    if (!tools)
        return;
    const registrations = [
        tool('inspect_dataset', '读取当前 session 已授权 Dataset 的元数据和可读性。只返回 DatasetRef 与可读性信息，不返回原始 rows，也不接受任何文件路径。query_access.shape 取值：array / envelope_item = 行集合，可 profile 也可 query；document = 顶层是文档对象（财务指标、回测结果这类），可 profile（宿主给结构摘要与有界内容）但不能 query；none = 不可读，reason 说明原因。', jsonObject({ dataset_id: datasetIdSchema }, ['dataset_id']), datasetRefWithAccessSchema, async (args, exec) => store.inspectDataset(datasetId(args.dataset_id), delegatedSession(exec, 'inspect_dataset'), exec.signal)),
        tool('profile_dataset', `由宿主读取 Dataset 并返回基础质量检查与四类事实；原始 rows 不进入模型上下文。行集合返回：① schema/quality——字段 observed/contract 类型、missing/null/invalid 计数、重复行、时间顺序；② statistics——数值字段的 count/sum/min/max/mean/分位数；③ categories——字符串字段的 distinct_count 与最多 5 个高频取值（truncated=true 表示未列全）；④ time_facts——时间列覆盖范围与首行/末行的数值取值（回答"最新值、区间涨跌"必须用它，不要用 min/max 代替首末值）；⑤ structure——行内数组/对象的路径摘要（对象字段用 .name、数组元素用 []；未抽样时用 total_elements，超过 50 项时用 sampled_elements，后者明确表示只是抽样，不能据此回答完整数量）。文档型 Dataset（顶层是文档对象，没有行数组）返回 structure 结构摘要 + document 有界内容，不返回行列统计。time_column 可显式指定，省略时按列名候选并只在取值全为数字或日期样式时采用。不接受任何文件路径、脚本内容或额外 schema。`, jsonObject({
            dataset_id: datasetIdSchema,
            task_id: { type: 'string' },
            time_column: { type: 'string' },
            primary_key: { type: 'string' },
        }, ['dataset_id']), profileDatasetResultSchema, async (args, exec) => store.profileDataset({
            session: delegatedSession(exec, 'profile_dataset'),
            dataset_id: datasetId(args.dataset_id),
            task_id: optionalTaskId(args.task_id),
            time_column: typeof args.time_column === 'string' ? args.time_column : undefined,
            primary_key: typeof args.primary_key === 'string' ? args.primary_key : undefined,
            signal: exec.signal,
        })),
        tool('query_dataset', `对当前 session 已授权的 json_rows Dataset 执行固定 QuerySpec：参数是一个 JSON 对象，QuerySpec 字段既可平铺在根上（flat），也可整体放进 query（query_request envelope，宿主自动展开）；两种形态同时给出时以 query 为准。支持受限 filter、group_by、count/min/max/avg/sum、asc/desc 和 limit。必须返回聚合或分组结果，禁止原始行投影；select 可省略，默认返回分组列和聚合别名。默认 error_policy=skip_with_warning，脏值会被排除并在 warnings 披露；需要全量类型一致性时显式使用 strict。最多 ${MAX_QUERY_FILTERS} 个条件、${MAX_QUERY_GROUP_BY} 个分组列、${MAX_QUERY_AGGREGATES} 个聚合、${MAX_QUERY_LIMIT} 行，结果最多 ${MAX_QUERY_OUTPUT_BYTES} 字节。数值字符串只在 Dataset schema 明确为 number/integer 时兼容。query_dataset 是受控分组/聚合工具，不是通用 raw.json 读取或自定义分析工具：select 只能引用 group_by 列或聚合别名，取不到原始行（首末/最新值请用 profile 的 time_facts）。select/group_by/aggregates/order_by 请传真正的 JSON 数组（宿主也兼容 JSON 字符串，但不要依赖）。`, queryParametersSchema, queryResultSchema, async (args, exec) => {
            const normalized = normalizeQueryArgs(args);
            return store.queryDataset({
                session: delegatedSession(exec, 'query_dataset'),
                dataset_id: normalized.dataset_id,
                query: normalized.query,
                signal: exec.signal,
            });
        }),
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
            session: delegatedSession(exec, 'write_profile'),
            dataset_id: datasetId(args.dataset_id),
            task_id: optionalTaskId(args.task_id),
            profile: args.profile,
            signal: exec.signal,
        })),
    ];
    for (const definition of registrations) {
        ctx.effect(() => tools.register(definition), `capital-generation.dataset-tool(${definition.name})`);
    }
}
