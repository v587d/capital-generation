import type { Context } from '@deepseek-ai/cordis'
import { DataCollectorHub } from './hub.js'

type ToolRuntimeLike = { register(definition: unknown): () => void }
type AgentExecutionLike = { id: string }
type ToolExecLike = { agent?: AgentExecutionLike; signal: AbortSignal }

/** dc_status 诊断信息注入：探测凭据解析状态与最近一次注册错误（只含有无/source，不含密钥值）。 */
export interface DataCollectorDiagnostics {
  probeApiKey: () => Promise<{ present: boolean; source: string | null; error?: string }>
  getRegistrationError: () => string | undefined
  /** 每次 dc_status 真实执行时回调（写执行痕迹用；模型可伪造文本，但宿主文件痕迹与计数无法伪造）。 */
  onCall?: (snapshot: { at: number; call: number; apiKey: unknown; sources: string[]; error: string | null }) => void
}

const jsonObject = (properties: Record<string, unknown> = {}, required: string[] = []): object => ({ type: 'object', properties, required, additionalProperties: false })
const jsonResult = { type: 'object', additionalProperties: true }
const freeObject = { type: 'object', additionalProperties: true }
const MAX_ID_LENGTH = 256
const MAX_DATA_KEY_LENGTH = 512
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

/** CacheEntry 输出结构（get_latest / completed 结果共用）。 */
const cacheEntrySchema = (): object => jsonObject({
  data_key: { type: 'string' },
  data: {},
  schema: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
  source: { type: 'string' },
  from_cache: { type: 'boolean' },
  updated_at: { type: 'integer' },
  expires_at: { type: 'integer' },
  request_id: { type: 'string' },
}, ['data_key', 'data', 'schema', 'source', 'from_cache', 'updated_at', 'expires_at'])

/** RequestStatus 输出结构（get_request_status）。 */
const requestStatusSchema = (): object => ({
  oneOf: [
    jsonObject({ status: { type: 'string', const: 'enqueued' }, position: { type: 'integer' } }, ['status', 'position']),
    jsonObject({ status: { type: 'string', const: 'running' }, started_at: { type: 'integer' } }, ['status', 'started_at']),
    jsonObject({ status: { type: 'string', const: 'completed' }, result: cacheEntrySchema(), duration_ms: { type: 'integer' } }, ['status', 'result', 'duration_ms']),
    jsonObject({ status: { type: 'string', const: 'failed' }, error: { type: 'string' }, duration_ms: { type: 'integer' } }, ['status', 'error']),
  ],
})

function render(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  // ToolOutputDefinition.render(args, value)：第一参是入参、第二参才是返回值。
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function tool(name: string, description: string, parameters: object, schema: object, execute: (args: Record<string, unknown>, exec: ToolExecLike) => Promise<unknown>) {
  return { name, description, parameters, output: { schema, render }, execute }
}

/**
 * 调用方 Agent 身份（官方注入，不可由模型伪造）。请求归属恒为当前调用者，
 * 不存在"代理请求"概念：数据请求与回传都走官方 Agent 消息原语。
 */
const callerId = (exec: ToolExecLike): string => {
  const derived = exec.agent?.id
  if (typeof derived === 'string' && derived) return derived
  throw new Error('this tool requires a calling agent (exec.agent was undefined)')
}

/** dc_status 真实执行计数（进程内递增，返回给模型可见）。 */
const dcStatusCalls: { current: number } = { current: 0 }

export function registerDataCollectorTools(ctx: Context, hub: DataCollectorHub, diagnostics?: DataCollectorDiagnostics): void {
  const tools = ctx.get('tools') as ToolRuntimeLike | undefined
  if (!tools) return
  const registrations = [
    tool(
      'request_data',
      '向共享数据 Hub 入队一个数据提取请求，立即返回入队结果；之后用 get_request_status 查询状态（completed 后可用 get_latest 取数据）。请求归属自动记为当前调用 Agent，不接收 requester_agent_id 参数。优先使用缓存；force_refresh=true 才强制拉取数据源。',
      jsonObject({ request_id: { type: 'string' }, data_key: { type: 'string' }, source_preference: { type: 'array', items: { type: 'string' } }, params: freeObject, force_refresh: { type: 'boolean' }, schema_hint: freeObject }, ['request_id', 'data_key', 'params']),
      jsonObject({ request_id: { type: 'string' }, status: { type: 'string', const: 'enqueued' }, position: { type: 'integer' } }, ['request_id', 'status', 'position']),
      async (args, exec) => {
        const rawRequestId = boundedString(args.request_id, 'request_id', MAX_ID_LENGTH)
        const rawDataKey = boundedString(args.data_key, 'data_key', MAX_DATA_KEY_LENGTH)
        const sourcePreference = Array.isArray(args.source_preference)
          ? args.source_preference.map((value) => boundedString(value, 'source_preference item', MAX_ID_LENGTH)).slice(0, 16)
          : undefined
        return hub.enqueue({
          request_id: rawRequestId,
          data_key: rawDataKey,
          source_preference: sourcePreference,
          params: boundedParams(args.params),
          force_refresh: args.force_refresh === true,
          requester_agent_id: callerId(exec),
          schema_hint: args.schema_hint && typeof args.schema_hint === 'object' ? args.schema_hint as object : undefined,
        })
      },
    ),
    tool('get_request_status', '按 request_id 查询数据请求状态（enqueued/running/completed/failed）。completed 时 result 为 CacheEntry。', jsonObject({ request_id: { type: 'string' } }, ['request_id']), { oneOf: [requestStatusSchema(), { type: 'null' }] }, async (args) => hub.getStatus(boundedString(args.request_id, 'request_id', MAX_ID_LENGTH))),
    tool('get_latest', '查询缓存中某个 data_key 的最新数据；传入 params 时只匹配该参数组合，否则返回该 data_key 的最新变体。返回 CacheEntry 或 null。', jsonObject({ data_key: { type: 'string' }, params: freeObject }, ['data_key']), { oneOf: [cacheEntrySchema(), { type: 'null' }] }, async (args) => hub.getLatest(String(args.data_key), args.params && typeof args.params === 'object' ? args.params as Record<string, unknown> : undefined)),
    tool('list_schemas', '列出当前已挂载的数据源及其独立 input/output schema；每个数据源自带契约，不做统一适配。', jsonObject(), { type: 'array', items: jsonObject({ name: { type: 'string' }, source: { type: 'string' }, input_schema: freeObject, output_schema: freeObject, data_key_patterns: { type: 'array', items: { type: 'string' } }, description: { type: 'string' } }, ['name', 'source', 'input_schema']) }, async () => hub.listSchemas()),
    ...(diagnostics ? [
      tool('dc_status', '诊断工具：返回数据收集 Hub 的运行状态 —— at/call 为本次真实执行的时间戳与计数（防伪）、api_key 解析结果（present/source，不含密钥值）、当前已注册数据源列表、最近一次数据源注册错误（若有）。排障时优先调用。', jsonObject(),
        jsonObject({ at: { type: 'integer' }, call: { type: 'integer' }, api_key: jsonObject({ present: { type: 'boolean' }, source: { oneOf: [{ type: 'string' }, { type: 'null' }] }, error: { oneOf: [{ type: 'string' }, { type: 'null' }] } }, ['present']), registered_sources: { type: 'array', items: { type: 'string' } }, registration_error: { oneOf: [{ type: 'string' }, { type: 'null' }] } }, ['at', 'call', 'api_key', 'registered_sources']),
        async () => {
          const apiKey = await diagnostics.probeApiKey()
          const sources = hub.listSchemas().map((s) => s.name)
          const error = diagnostics.getRegistrationError() ?? null
          const snapshot = { at: Date.now(), call: ++dcStatusCalls.current, apiKey, sources, error }
          diagnostics.onCall?.(snapshot)
          return {
            at: snapshot.at,
            call: snapshot.call,
            api_key: apiKey,
            registered_sources: sources,
            registration_error: error,
          }
        }),
    ] : []),
  ]
  for (const definition of registrations) ctx.effect(() => tools.register(definition), `capital-generation.tool(${definition.name})`)
}