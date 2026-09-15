import type { Context } from '@deepseek-ai/cordis'
import { DataCollectorHub } from './hub.js'
import type { DatasetRef, SessionLike } from './store.js'

type ToolRuntimeLike = { register(definition: unknown): () => void }
type AgentExecutionLike = {
  id: string
  /** 官方注入的调用方 session（exec.agent.session；与 dsh-tool-fs 取 workspace 同源）。 */
  session?: { id?: string; header?: { cwd?: string } }
}
type ToolExecLike = { agent?: AgentExecutionLike; signal: AbortSignal }

/** dc_status 诊断信息注入：探测凭据解析状态与最近一次注册错误（只含有无/source，不含密钥值）。 */
export interface DataCollectorDiagnostics {
  probeApiKey: () => Promise<{ present: boolean; source: string | null; error?: string }>
  getRegistrationError: () => string | undefined
  /** 每次 dc_status 真实执行时回调（写执行痕迹用；模型可伪造文本，但宿主文件痕迹与计数无法伪造）。 */
  onCall?: (snapshot: { at: number; call: number; apiKey: unknown; capabilities: string[]; error: string | null }) => void
}

const jsonObject = (properties: Record<string, unknown> = {}, required: string[] = []): object => ({ type: 'object', properties, required, additionalProperties: false })
const freeObject = { type: 'object', additionalProperties: true }
const MAX_ID_LENGTH = 256
const MAX_PARAMS_BYTES = 64 * 1024

function boundedString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`)
  if (value.length > maxLength) throw new Error(`${name} exceeds maximum length ${maxLength}`)
  return value
}

function boundedParams(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('params must be an object')
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new Error('params must be JSON-serializable')
  }
  if (encoded.length > MAX_PARAMS_BYTES) throw new Error(`params exceeds maximum size ${MAX_PARAMS_BYTES} bytes`)
  return value as Record<string, unknown>
}

/**
 * DatasetRef 输出结构（模型可见协议）：只有元数据。任何 raw rows、内部
 * data_key、绝对路径字段都不允许出现。
 */
const datasetRefSchema = (): object => jsonObject({
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
}, ['dataset_id', 'task_id', 'session_id', 'artifact_ref', 'format', 'capability', 'source_label', 'schema', 'row_count', 'captured_at', 'retention_until', 'params_digest'])

function render(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  // ToolOutputDefinition.render(args, value)：第一参是入参、第二参才是返回值。
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function tool(name: string, description: string, parameters: object, schema: object, execute: (args: Record<string, unknown>, exec: ToolExecLike) => Promise<unknown>) {
  return { name, description, parameters, output: { schema, render }, execute }
}

/**
 * 调用方 Agent session（官方注入，不可由模型伪造）。请求归属恒为当前调用者，
 * 不存在"代理请求"概念。workspace cwd 由 session.header.cwd 提供。
 */
const callerSession = (exec: ToolExecLike): SessionLike => {
  const session = exec.agent?.session
  if (session) return session as SessionLike
  throw new Error('this tool requires a calling agent session (exec.agent.session was undefined)')
}

const delegatedSession = (exec: ToolExecLike, toolName: string): SessionLike => {
  const session = callerSession(exec)
  if (typeof session.header?.parentSession !== 'string' || session.header.parentSession.length === 0) {
    throw new Error(`${toolName} is restricted to delegated data agents; the main Agent must delegate this request`)
  }
  return session
}

/** dc_status 真实执行计数（进程内递增，返回给模型可见）。 */
const dcStatusCalls: { current: number } = { current: 0 }

/**
 * describe_capability 的分类错误（稳定 code + 恢复指引）。
 *
 * 设计原则：这个名字来自模型而不是代码，所以失败必然是"模型写错了名字"或"数据源没注册"。
 * 两种情况的可恢复动作完全不同，因此不用模糊的 error message，而是给出：
 * - 稳定的 code，便于 persona/skill 与测试对照；
 * - 一句"下一步该做什么"的指引；
 * - 未知名字时附上全部可用能力名，让模型能自我纠正而不必猜。
 */
type CapabilityErrorCode =
  | 'capability_required'
  | 'capability_invalid'
  | 'capability_catalog_empty'
  | 'capability_unknown'

function capabilityError(code: CapabilityErrorCode, detail: string): Error {
  const error = new Error(`${code}: ${detail}`)
  ;(error as Error & { code?: string }).code = code
  return error
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
}

/**
 * 数据源在 normalizeParams 阶段抛出的错误对模型来说都是可修正的参数错误。
 * 保留数据源的字段级原因，同时把恢复动作固定成一次 describe -> 修正 -> 重试，
 * 避免子 Agent 只看到 "must be ..." 后凭记忆反复猜参数。
 */
function requestParamsError(error: unknown, capability: string): Error | undefined {
  if (errorCode(error)) return undefined
  const message = error instanceof Error ? error.message : String(error)
  if (!/(?:\bparameter\b|\bparams\b|missing required parameter|unsupported parameter|at least one of)/i.test(message)) return undefined
  const detail = `request_params_invalid: ${message}. 请先调用 describe_capability({ "capability": ${JSON.stringify(capability)} }) 重新读取该能力的 input_schema，再严格按 schema 修正 params 后重试 request_data；不要凭记忆猜测参数。 Please read describe_capability(${JSON.stringify(capability)}) before retrying request_data.`
  const failure = new Error(detail)
  ;(failure as Error & { code?: string }).code = 'request_params_invalid'
  return failure
}

function resolveCapability(hub: DataCollectorHub, value: unknown): string {
  if (value === undefined || value === null || value === '') {
    throw capabilityError('capability_required', '缺少 capability 参数。请先调用 list_capabilities() 取回能力目录，再调用 describe_capability({ "capability": "<目录中的名字>" }) 读取该能力契约。')
  }
  if (typeof value !== 'string') {
    throw capabilityError('capability_invalid', `capability 必须是字符串（收到 ${Array.isArray(value) ? 'array' : typeof value}）。一次只描述一个能力；请从 list_capabilities() 的目录中原样复制名字，再调用 describe_capability。`)
  }
  const name = value.trim()
  if (name.length === 0) {
    throw capabilityError('capability_required', 'capability 是空白字符串。请先调用 list_capabilities()，再把目录中的 capability 名原样传给 describe_capability。')
  }
  if (name.length > MAX_ID_LENGTH) {
    throw capabilityError('capability_invalid', `capability 超过 ${MAX_ID_LENGTH} 字符，不是合法能力名。请从 list_capabilities() 的目录里原样复制一个名字。`)
  }
  if (name.includes(',')) {
    throw capabilityError('capability_invalid', `capability 不接受逗号分隔的多个名字（收到 "${name}"）。一次只调用 describe_capability 描述一个能力；需要多个就分多次调用。`)
  }
  if (!hub.describeCapability(name)) {
    const available = hub.capabilityNames()
    if (available.length === 0) {
      throw capabilityError('capability_catalog_empty', '当前没有任何已注册的数据能力（数据源未注册，常见原因是 API 凭据未配置或装配未生效）。本工具此刻对任何名字都会失败——不要反复重试，也不要编造能力名；请把该状态回告主 Agent，必要时用 dc_status 读取注册错误。')
    }
    throw capabilityError('capability_unknown', `未注册的能力 "${name}"。当前可用能力：${available.join(', ')}。请从 list_capabilities() 返回的目录里原样复制一个名字，再调用 describe_capability；不要自行编造、缩写或改写。`)
  }
  return name
}

export function registerDataCollectorTools(ctx: Context, hub: DataCollectorHub, diagnostics?: DataCollectorDiagnostics): void {
  const tools = ctx.get('tools') as ToolRuntimeLike | undefined
  if (!tools) return
  const registrations = [
    tool(
      'request_data',
      '向数据管道请求数据：宿主先按 capability+params 校验当前 session 的已验证 manifest；force_refresh=false 或省略且命中未过期 Dataset 时直接返回已有 DatasetRef，不访问上游；force_refresh=true 才重新取数并生成新的不可变 Dataset（默认保留 7 天），绝不覆盖旧 Dataset。本工具只返回 DatasetRef（dataset_id / artifact_ref / schema / row_count / captured_at / retention_until 等元数据），绝不返回原始数据行。capability 必须是 list_capabilities 返回的短能力名（如 ticker_search / quote / history / trading_calendar），params 必须按 describe_capability({ capability }) 返回的 input_schema 填写。若返回 request_params_invalid，先重新调用 describe_capability({ capability: "<当前能力名>" })，再按 schema 修正并重试一次；不要凭记忆猜参数。task_id 可选用于关联本次任务。相同 capability+params 的并发请求合并为同一次执行。当前 workspace 只读或落盘失败时抛错 workspace_not_writable（绝不退化为内存假成功）。请求归属自动记为当前 delegated child session，不接收 requester_agent_id 参数。',
      jsonObject({
        capability: { type: 'string' },
        params: freeObject,
        force_refresh: { type: 'boolean' },
        task_id: { type: 'string' },
      }, ['capability', 'params']),
      datasetRefSchema(),
      async (args, exec) => {
        const requestedCapability = boundedString(args.capability, 'capability', MAX_ID_LENGTH)
        const session = delegatedSession(exec, 'request_data')
        try {
          const params = boundedParams(args.params)
          // Fail early with the same catalog guidance as describe_capability instead of
          // making the model infer a capability typo from a low-level Hub error.
          const capability = resolveCapability(hub, requestedCapability)
          return await hub.request({
            capability,
            params,
            force_refresh: args.force_refresh === true,
            task_id: typeof args.task_id === 'string' && args.task_id.length > 0 ? boundedString(args.task_id, 'task_id', MAX_ID_LENGTH) : undefined,
            session,
          }, { signal: exec.signal })
        } catch (error) {
          throw requestParamsError(error, requestedCapability) ?? error
        }
      },
    ),
    tool(
      'list_capabilities',
      '列出当前已注册的数据能力目录：每项只有 capability（短能力名）、summary（一行用途）与 paginated（是否分页）。目录是发现入口，**一个任务只需调用一次**：同一 session 的历史里已经保有这份目录，重复调用只会白占上下文。目录刻意不含参数与输出结构（完整 schema 约 23KB，会被剪枝截断）；确定要用的能力后，用 describe_capability 单独取那一个能力的 input_schema 后即可 request_data。request_data 的 capability 必须以本目录为准，不要自行编造。',
      jsonObject(),
      { type: 'array', items: jsonObject({
        capability: { type: 'string' },
        summary: { type: 'string' },
        paginated: { type: 'boolean' },
      }, ['capability', 'summary', 'paginated']) },
      async (_args, exec) => { delegatedSession(exec, 'list_capabilities'); return hub.listCapabilities() },
    ),
    tool(
      'describe_capability',
      '读取**一个**能力的完整契约：description（单位、null 语义、时间与分页口径）、input_schema（params 的取值与约束）、output_schema（返回字段）与 paginated。request_data 的 params 必须按这里返回的 input_schema 填写；request_data 若返回 request_params_invalid，应回到这里重新读取后再重试。一个能力描述一次即可：结果已在本 session 历史里，重复描述同一个能力只会白占上下文；需要几个能力就分别调用几次，不要用逗号把多个名字塞进一次调用。错误按 code 引导：capability_required（没给名字，先 list_capabilities()）、capability_invalid（不是字符串/超长/含逗号，改为目录中的单个名字）、capability_catalog_empty（数据源未注册，别重试，回告主 Agent）、capability_unknown（名字不存在，错误里会列出全部可用能力名并要求原样复制）。',
      jsonObject({ capability: { type: 'string' } }, ['capability']),
      jsonObject({
        capability: { type: 'string' },
        summary: { type: 'string' },
        paginated: { type: 'boolean' },
        description: { type: 'string' },
        input_schema: freeObject,
        output_schema: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
      }, ['capability', 'summary', 'paginated', 'description', 'input_schema', 'output_schema']),
      async (args, exec) => {
        delegatedSession(exec, 'describe_capability')
        const capability = resolveCapability(hub, args.capability)
        const detail = hub.describeCapability(capability)
        if (!detail) throw capabilityError('capability_unknown', `未注册的能力 "${capability}"。`)
        return detail
      },
    ),
    ...(diagnostics ? [
      tool('dc_status', '诊断工具：返回数据管道运行状态 —— at/call 为本次真实执行的时间戳与计数（防伪）、api_key 解析结果（present/source，不含密钥值）、当前已注册 capability 列表、最近一次数据源注册错误（若有）。排障时优先调用。', jsonObject(),
        jsonObject({
          at: { type: 'integer' },
          call: { type: 'integer' },
          api_key: jsonObject({ present: { type: 'boolean' }, source: { oneOf: [{ type: 'string' }, { type: 'null' }] }, error: { oneOf: [{ type: 'string' }, { type: 'null' }] } }, ['present']),
          registered_capabilities: { type: 'array', items: { type: 'string' } },
          registration_error: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        }, ['at', 'call', 'api_key', 'registered_capabilities']),
        async (_args, exec) => {
           delegatedSession(exec, 'dc_status')
          const apiKey = await diagnostics.probeApiKey()
          const capabilities = hub.capabilityNames()
          const error = diagnostics.getRegistrationError() ?? null
          const snapshot = { at: Date.now(), call: ++dcStatusCalls.current, apiKey, capabilities, error }
          diagnostics.onCall?.(snapshot)
          return {
            at: snapshot.at,
            call: snapshot.call,
            api_key: apiKey,
            registered_capabilities: capabilities,
            registration_error: error,
          }
        }),
    ] : []),
  ]
  for (const definition of registrations) ctx.effect(() => tools.register(definition), `capital-generation.tool(${definition.name})`)
}

/** 供测试与宿主侧断言复用：模型可见的 DatasetRef 字段白名单。 */
export const DATASET_REF_FIELDS = [
  'dataset_id', 'task_id', 'session_id', 'artifact_ref', 'format',
  'capability', 'source_label', 'schema', 'row_count', 'captured_at',
  'retention_until', 'params_digest',
] as const satisfies readonly (keyof DatasetRef)[]
