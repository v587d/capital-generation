const jsonObject = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const freeObject = { type: 'object', additionalProperties: true };
const MAX_ID_LENGTH = 256;
const MAX_PARAMS_BYTES = 64 * 1024;
function boundedString(value, name, maxLength) {
    if (typeof value !== 'string' || value.length === 0)
        throw new Error(`${name} is required`);
    if (value.length > maxLength)
        throw new Error(`${name} exceeds maximum length ${maxLength}`);
    return value;
}
function boundedParams(value) {
    if (value === undefined)
        return {};
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('params must be an object');
    let encoded;
    try {
        encoded = JSON.stringify(value);
    }
    catch {
        throw new Error('params must be JSON-serializable');
    }
    if (encoded.length > MAX_PARAMS_BYTES)
        throw new Error(`params exceeds maximum size ${MAX_PARAMS_BYTES} bytes`);
    return value;
}
/**
 * DatasetRef 输出结构（模型可见协议）：只有元数据。任何 raw rows、内部
 * data_key、绝对路径字段都不允许出现。
 */
const datasetRefSchema = () => jsonObject({
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
}, ['dataset_id', 'task_id', 'session_id', 'artifact_ref', 'format', 'capability', 'source_label', 'schema', 'row_count', 'captured_at', 'retention_until', 'params_digest']);
function render(_args, value) {
    // ToolOutputDefinition.render(args, value)：第一参是入参、第二参才是返回值。
    return [{ type: 'text', text: JSON.stringify(value) }];
}
function tool(name, description, parameters, schema, execute) {
    return { name, description, parameters, output: { schema, render }, execute };
}
/**
 * 调用方 Agent session（官方注入，不可由模型伪造）。请求归属恒为当前调用者，
 * 不存在"代理请求"概念。workspace cwd 由 session.header.cwd 提供。
 */
const callerSession = (exec) => {
    const session = exec.agent?.session;
    if (session)
        return session;
    throw new Error('this tool requires a calling agent session (exec.agent.session was undefined)');
};
const delegatedSession = (exec, toolName) => {
    const session = callerSession(exec);
    if (typeof session.header?.parentSession !== 'string' || session.header.parentSession.length === 0) {
        throw new Error(`${toolName} is restricted to delegated data agents; the main Agent must delegate this request`);
    }
    return session;
};
/** dc_status 真实执行计数（进程内递增，返回给模型可见）。 */
const dcStatusCalls = { current: 0 };
export function registerDataCollectorTools(ctx, hub, diagnostics) {
    const tools = ctx.get('tools');
    if (!tools)
        return;
    const registrations = [
        tool('request_data', '向数据管道请求数据：宿主先按 capability+params 校验当前 session 的已验证 manifest；force_refresh=false 或省略且命中未过期 Dataset 时直接返回已有 DatasetRef，不访问上游；force_refresh=true 才重新取数并生成新的不可变 Dataset（默认保留 7 天），绝不覆盖旧 Dataset。本工具只返回 DatasetRef（dataset_id / artifact_ref / schema / row_count / captured_at / retention_until 等元数据），绝不返回原始数据行。capability 必须是 list_capabilities 返回的短能力名（如 ticker_search / quote / history / trading_calendar），params 按该能力的 input_schema 填写，task_id 可选用于关联本次任务。相同 capability+params 的并发请求合并为同一次执行。当前 workspace 只读或落盘失败时抛错 workspace_not_writable（绝不退化为内存假成功）。请求归属自动记为当前 delegated child session，不接收 requester_agent_id 参数。', jsonObject({
            capability: { type: 'string' },
            params: freeObject,
            force_refresh: { type: 'boolean' },
            task_id: { type: 'string' },
        }, ['capability', 'params']), datasetRefSchema(), async (args, exec) => hub.request({
            capability: boundedString(args.capability, 'capability', MAX_ID_LENGTH),
            params: boundedParams(args.params),
            force_refresh: args.force_refresh === true,
            task_id: typeof args.task_id === 'string' && args.task_id.length > 0 ? boundedString(args.task_id, 'task_id', MAX_ID_LENGTH) : undefined,
            session: delegatedSession(exec, 'request_data'),
        }, { signal: exec.signal })),
        tool('list_capabilities', '列出当前已注册的数据能力：短 capability 名、用途描述、参数 input_schema、输出结构 output_schema 与是否支持分页。capability 是模型侧唯一标识（短小、稳定、全局唯一）；宿主内部的数据源路由字段不在此返回。request_data 的 capability 必须以本工具返回的值为准，不要自行编造。', jsonObject(), { type: 'array', items: jsonObject({
                capability: { type: 'string' },
                description: { type: 'string' },
                input_schema: freeObject,
                output_schema: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
                paginated: { type: 'boolean' },
            }, ['capability', 'description', 'input_schema', 'output_schema', 'paginated']) }, async (_args, exec) => { delegatedSession(exec, 'list_capabilities'); return hub.listCapabilities(); }),
        ...(diagnostics ? [
            tool('dc_status', '诊断工具：返回数据管道运行状态 —— at/call 为本次真实执行的时间戳与计数（防伪）、api_key 解析结果（present/source，不含密钥值）、当前已注册 capability 列表、最近一次数据源注册错误（若有）。排障时优先调用。', jsonObject(), jsonObject({
                at: { type: 'integer' },
                call: { type: 'integer' },
                api_key: jsonObject({ present: { type: 'boolean' }, source: { oneOf: [{ type: 'string' }, { type: 'null' }] }, error: { oneOf: [{ type: 'string' }, { type: 'null' }] } }, ['present']),
                registered_capabilities: { type: 'array', items: { type: 'string' } },
                registration_error: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            }, ['at', 'call', 'api_key', 'registered_capabilities']), async (_args, exec) => {
                delegatedSession(exec, 'dc_status');
                const apiKey = await diagnostics.probeApiKey();
                const capabilities = hub.listCapabilities().map((capability) => capability.capability);
                const error = diagnostics.getRegistrationError() ?? null;
                const snapshot = { at: Date.now(), call: ++dcStatusCalls.current, apiKey, capabilities, error };
                diagnostics.onCall?.(snapshot);
                return {
                    at: snapshot.at,
                    call: snapshot.call,
                    api_key: apiKey,
                    registered_capabilities: capabilities,
                    registration_error: error,
                };
            }),
        ] : []),
    ];
    for (const definition of registrations)
        ctx.effect(() => tools.register(definition), `capital-generation.tool(${definition.name})`);
}
/** 供测试与宿主侧断言复用：模型可见的 DatasetRef 字段白名单。 */
export const DATASET_REF_FIELDS = [
    'dataset_id', 'task_id', 'session_id', 'artifact_ref', 'format',
    'capability', 'source_label', 'schema', 'row_count', 'captured_at',
    'retention_until', 'params_digest',
];
