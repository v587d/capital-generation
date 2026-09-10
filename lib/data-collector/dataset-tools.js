import { DatasetStoreError, DEFAULT_SLICE_ROWS, MAX_SLICE_ROWS, } from './store.js';
const jsonObject = (properties = {}, required = []) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
});
const datasetIdSchema = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' };
const profileStatisticSchema = jsonObject({
    min: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    max: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    mean: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    p25: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    p50: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    p75: { oneOf: [{ type: 'number' }, { type: 'null' }] },
});
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
    row_access: jsonObject({
        readable: { type: 'boolean' },
        shape: { type: 'string', enum: ['array', 'envelope_item', 'none'] },
        max_slice_rows: { type: 'integer' },
        reason: { type: 'string' },
    }, ['readable', 'shape', 'max_slice_rows']),
}, [
    'dataset_id', 'task_id', 'session_id', 'artifact_ref', 'format', 'capability',
    'source_label', 'schema', 'row_count', 'captured_at', 'retention_until',
    'params_digest', 'row_access',
]);
const sliceSchema = jsonObject({
    dataset_id: { type: 'string' },
    offset: { type: 'integer' },
    limit: { type: 'integer' },
    returned_count: { type: 'integer' },
    total_count: { type: 'integer' },
    has_more: { type: 'boolean' },
    rows: { type: 'array', items: {} },
}, ['dataset_id', 'offset', 'limit', 'returned_count', 'total_count', 'has_more', 'rows']);
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
    warnings: { type: 'array', items: { type: 'string' } },
}, ['profile_id', 'dataset_id', 'task_id', 'session_id', 'artifact_ref', 'created_at', 'retention_until', 'row_count', 'columns', 'quality', 'warnings']);
export function registerDatasetTools(ctx, store) {
    const tools = ctx.get('tools');
    if (!tools)
        return;
    const registrations = [
        tool('inspect_dataset', '读取当前 session 已授权 Dataset 的元数据和切片能力。只返回 DatasetRef 与可读性信息，不返回原始 rows，也不接受任何文件路径。', jsonObject({ dataset_id: datasetIdSchema }, ['dataset_id']), datasetRefWithAccessSchema, async (args, exec) => store.inspectDataset(datasetId(args.dataset_id), delegatedSession(exec, 'inspect_dataset'), exec.signal)),
        tool('read_dataset_slice', `按受限窗口读取当前 session 已授权 Dataset 的 rows。只支持 json_rows；默认 ${DEFAULT_SLICE_ROWS} 行，单次最多 ${MAX_SLICE_ROWS} 行。结果只供当前 data_junior 使用，禁止转发原始 rows。`, jsonObject({
            dataset_id: datasetIdSchema,
            offset: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: MAX_SLICE_ROWS },
            columns: { type: 'array', items: { type: 'string', maxLength: 128 }, maxItems: 64 },
        }, ['dataset_id']), sliceSchema, async (args, exec) => {
            const offset = args.offset === undefined ? undefined : args.offset;
            const limit = args.limit === undefined ? undefined : args.limit;
            const columns = args.columns === undefined ? undefined : args.columns;
            return store.readDatasetSlice(datasetId(args.dataset_id), delegatedSession(exec, 'read_dataset_slice'), {
                offset: offset,
                limit: limit,
                columns: columns,
            }, exec.signal);
        }),
        tool('profile_dataset', '对当前 session 已授权的 json_rows Dataset 执行宿主侧基础质量检查和统计；原始 rows 不进入模型上下文。返回不可变 profile_ref、行数、列、缺失值、重复项、时间顺序和数值分位数。可选指定 time_column 和 primary_key；不接受任何文件路径或脚本内容。', jsonObject({
            dataset_id: datasetIdSchema,
            task_id: { type: 'string', maxLength: 256 },
            time_column: { type: 'string', maxLength: 128 },
            primary_key: { type: 'string', maxLength: 128 },
        }, ['dataset_id']), profileDatasetResultSchema, async (args, exec) => store.profileDataset({
            session: delegatedSession(exec, 'profile_dataset'),
            dataset_id: datasetId(args.dataset_id),
            task_id: optionalTaskId(args.task_id),
            time_column: typeof args.time_column === 'string' ? args.time_column : undefined,
            primary_key: typeof args.primary_key === 'string' ? args.primary_key : undefined,
            signal: exec.signal,
        })),
        tool('write_profile', '将当前 session 对已授权 Dataset 生成的基础质量 profile 持久化到 workspace。宿主生成不可变 profile_ref；profile 不得包含原始 rows、文件路径、凭据或未定义字段。', jsonObject({
            dataset_id: datasetIdSchema,
            task_id: { type: 'string', maxLength: 256 },
            profile: jsonObject({
                row_count: { type: 'integer', minimum: 0 },
                columns: { type: 'array', items: { type: 'string', maxLength: 128 }, maxItems: 64 },
                quality: jsonObject({
                    missing_values: { type: 'integer', minimum: 0 },
                    duplicate_rows: { type: 'integer', minimum: 0 },
                    time_ordered: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
                }, ['missing_values', 'duplicate_rows', 'time_ordered']),
                statistics: { type: 'object', additionalProperties: true },
                warnings: { type: 'array', items: { type: 'string', maxLength: 512 }, maxItems: 32 },
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
