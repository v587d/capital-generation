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
function capabilityError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
function resolveCapability(hub, value) {
    if (value === undefined || value === null || value === '') {
        throw capabilityError('capability_required', '缺少 capability 参数。请先调用一次 list_capabilities 取回能力目录，再把目录中的 capability 名原样传入。');
    }
    if (typeof value !== 'string') {
        throw capabilityError('capability_invalid', `capability 必须是字符串（收到 ${Array.isArray(value) ? 'array' : typeof value}）。一次只描述一个能力，名字从 list_capabilities 的目录里原样复制。`);
    }
    const name = value.trim();
    if (name.length === 0) {
        throw capabilityError('capability_required', 'capability 是空白字符串。请把 list_capabilities 返回的目录里的 capability 名原样传入。');
    }
    if (name.length > MAX_ID_LENGTH) {
        throw capabilityError('capability_invalid', `capability 超过 ${MAX_ID_LENGTH} 字符，不是合法能力名。请从 list_capabilities 的目录里原样复制。`);
    }
    if (name.includes(',')) {
        throw capabilityError('capability_invalid', `capability 不接受逗号分隔的多个名字（收到 "${name}"）。本工具一次只描述一个能力；需要多个就分多次调用，同一个能力不要重复描述。`);
    }
    if (!hub.describeCapability(name)) {
        const available = hub.capabilityNames();
        if (available.length === 0) {
            throw capabilityError('capability_catalog_empty', '当前没有任何已注册的数据能力（数据源未注册，常见原因是 API 凭据未配置或装配未生效）。本工具此刻对任何名字都会失败——不要反复重试，也不要编造能力名；请把该状态回告主 Agent，必要时用 dc_status 读取注册错误。');
        }
        throw capabilityError('capability_unknown', `未注册的能力 "${name}"。当前可用能力：${available.join(', ')}。请从 list_capabilities 返回的目录里原样复制能力名，不要自行编造、缩写或改写。`);
    }
    return name;
}
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
        tool('list_capabilities', '列出当前已注册的数据能力目录：每项只有 capability（短能力名）、summary（一行用途）与 paginated（是否分页）。目录是发现入口，**一个任务只需调用一次**：同一 session 的历史里已经保有这份目录，重复调用只会白占上下文。目录刻意不含参数与输出结构（完整 schema 约 23KB，会被剪枝截断）；确定要用的能力后，用 describe_capability 单独取那一个能力的 input_schema 后即可 request_data。request_data 的 capability 必须以本目录为准，不要自行编造。', jsonObject(), { type: 'array', items: jsonObject({
                capability: { type: 'string' },
                summary: { type: 'string' },
                paginated: { type: 'boolean' },
            }, ['capability', 'summary', 'paginated']) }, async (_args, exec) => { delegatedSession(exec, 'list_capabilities'); return hub.listCapabilities(); }),
        tool('describe_capability', '读取**一个**能力的完整契约：description（单位、null 语义、时间与分页口径）、input_schema（params 的取值与约束）、output_schema（返回字段）与 paginated。request_data 的 params 必须按这里返回的 input_schema 填写。一个能力描述一次即可：结果已在本 session 历史里，重复描述同一个能力只会白占上下文；需要几个能力就分别调用几次，不要用逗号把多个名字塞进一次调用。错误按 code 引导：capability_required（没给名字）、capability_invalid（不是字符串/超长/含逗号）、capability_catalog_empty（数据源未注册，别重试，回告主 Agent）、capability_unknown（名字不存在，错误里会列出全部可用能力名）。', jsonObject({ capability: { type: 'string' } }, ['capability']), jsonObject({
            capability: { type: 'string' },
            summary: { type: 'string' },
            paginated: { type: 'boolean' },
            description: { type: 'string' },
            input_schema: freeObject,
            output_schema: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
        }, ['capability', 'summary', 'paginated', 'description', 'input_schema', 'output_schema']), async (args, exec) => {
            delegatedSession(exec, 'describe_capability');
            const capability = resolveCapability(hub, args.capability);
            const detail = hub.describeCapability(capability);
            if (!detail)
                throw capabilityError('capability_unknown', `未注册的能力 "${capability}"。`);
            return detail;
        }),
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
                const capabilities = hub.capabilityNames();
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
